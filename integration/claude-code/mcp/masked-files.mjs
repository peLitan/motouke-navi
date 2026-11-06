#!/usr/bin/env node
// 置き換えた後の中身だけを返す手元の MCP の道具(F13)。標準入出力で JSON-RPC 2.0(1行に1通)を話す。外部とは通信しない。
//
// 道具:
//   read_masked { path }  raw/ の中の文のファイルを読み、人名・会社名・メール・電話・住所・許可番号などを〔会社名1〕のような記号に置き換えて返す。
//                         2つ目の文に、架空の見本の語を混ぜて全部置き換わったかを確かめた結果を付ける(F28a。見本は中身に入れない)。
//                         返すのは置き換えた後の中身だけ。対応表(元の語)は返さない。raw/ の外のパスは断る。
//   list_masked { dir? }  raw/ の中のファイルの名前(作業フォルダからのパス)だけを返す。中身は返さない。raw/ の外は返さない。
//                         ファイルの名前は置き換えない(read_masked に渡すため)。名前に人名・会社名が入っていれば、そのまま返る。
//   check_articles { text }  指摘の文(文か JSON)に書かれた条番号が、取得した原文にあるかを確かめる(F56a)。ファイルは読まない。
//                         返すのは check-articles.mjs の CLI と同じ文(条番号ごとの「ある」「無い」「確かめられない」と数)だけで、原文の全文は返さない。
//                         確かめるのは条・項・号・細分があるかだけ。指摘の中身が条の文に合っているかは確かめない。
//
// 環境変数(どれも任意):
//   MASK_ROOT      作業フォルダ(raw/ のある所)。既定は起動したときのフォルダ(Claude Code はプロジェクトのフォルダで起動する)
//   MASK_TOOL_DIR  このツール(src/mask/ のあるフォルダ)。既定はこのファイルから3つ上(リポジトリの integration/claude-code/mcp/ に置いたときの直下)。
//                  作業フォルダに写したときは指定する。plugin/mcp/ の写しは .mcp.json がプラグインの直下を渡す
//   MASK_MAP       画面の「対応表を書き出す」で保存した対応表の JSON。指定すると、その語(人名・現場名など)も同じ記号で置き換える
//   MASK_DICT      画面の「辞書を書き出す」で保存した辞書の JSON(format: "mask-dict")。指定すると、足した語(人名・現場名など)も置き換える(F28c)。
//                  MASK_MAP と両方を指定したときは、対応表を読んでから辞書の語を加える。読めないときは理由の種類だけを返し、辞書の中身(語)は返事にも記録にも出さない
//
// 限界: 置き換えの漏れは0にならない(README の「文の置き換え」)。読めるのは文のファイル(.txt .md .csv .tsv .json)だけ。文字は UTF-8(BOM の有無どちらも)か Shift_JIS(F63a)。

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TOOL_DIR = process.env.MASK_TOOL_DIR || path.resolve(HERE, '..', '..', '..');
const { createMasker } = await import(pathToFileURL(path.join(TOOL_DIR, 'src', 'mask', 'core.mjs')).href);
const { CONSTRUCTION_DICT } = await import(pathToFileURL(path.join(TOOL_DIR, 'src', 'mask', 'dict-construction.mjs')).href);
const { checkDecoys, decoyMessage } = await import(pathToFileURL(path.join(TOOL_DIR, 'src', 'mask', 'decoy.mjs')).href);

export const SERVER_INFO = { name: 'masked-files', version: '0.2.0' };
export const PROTOCOL_VERSION = '2025-06-18';
export const TEXT_EXT = ['.txt', '.md', '.csv', '.tsv', '.json'];
const MAX_BYTES = 1024 * 1024;

export const TOOLS = [
  {
    name: 'read_masked',
    description: 'raw/ の中の文のファイルを読み、人名・会社名・メール・電話・住所・許可番号などを〔会社名1〕のような記号に置き換えた後の中身だけを返す。元の語と対応表は返さない。raw/ の外は読めない。2つ目の文は、見えない所で混ぜた架空の見本の語(書類の中身ではない)が全部置き換わったかの確かめの結果。',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string', description: '作業フォルダからのパス(例 raw/台帳.txt)' } },
      required: ['path'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_masked',
    description: 'raw/ の中のファイルの名前(作業フォルダからのパス。例 raw/台帳.txt)の一覧だけを返す。中身は返さない。点検する書類の名前が分からないときに使い、返った名前を read_masked に渡す。名前は置き換えないので、名前に人名・会社名が入っていればそのまま返る。',
    inputSchema: {
      type: 'object',
      properties: { dir: { type: 'string', description: '一覧にする raw/ の中のフォルダ(例 raw/工事A)。省くと raw/ 全体' } },
      additionalProperties: false,
    },
  },
  {
    name: 'check_articles',
    description: '指摘の文に書かれた条番号が、取得した法令の原文にあるかを確かめ、条番号ごとの「ある」「無い」「確かめられない」と数を返す。確かめるのは条・項・号・細分があるかだけで、指摘の中身が条の文に合っているかは確かめない。原文の全文は返さない。ファイルは読まない。',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string', description: '指摘の文(文か JSON)。根拠の条番号は法令名から書く(例 建設業法第24条の8第1項)' } },
      required: ['text'],
      additionalProperties: false,
    },
  },
];

class ToolError extends Error {}

const within = (dir, p) => { const r = path.relative(dir, p); return r !== '' && !r.startsWith('..') && !path.isAbsolute(r); };

// raw/ の中のファイルだけを許す(.. やシンボリックリンクで外へ出るものは断る)
export function resolveRawFile(root, rel) {
  if (typeof rel !== 'string' || !rel.trim()) throw new ToolError('path がありません。');
  const rawDir = path.resolve(root, 'raw');
  const target = path.resolve(root, rel.replace(/\\/g, '/'));
  if (!within(rawDir, target)) throw new ToolError('raw/ の中のファイルだけを読めます。');
  let real;
  try {
    real = fs.realpathSync(target);
  } catch {
    throw new ToolError('ファイルがありません: ' + rel);
  }
  let realRaw;
  try { realRaw = fs.realpathSync(rawDir); } catch { throw new ToolError('raw/ がありません。'); }
  if (!within(realRaw, real)) throw new ToolError('raw/ の中のファイルだけを読めます。');
  const st = fs.statSync(real);
  if (!st.isFile()) throw new ToolError('ファイルではありません: ' + rel);
  if (!TEXT_EXT.includes(path.extname(real).toLowerCase())) throw new ToolError('読めるのは文のファイル(' + TEXT_EXT.join(' ') + ')だけです。Excel・Word は画面か表計算で文にしてから raw/ に置いてください。');
  if (st.size > MAX_BYTES) throw new ToolError('ファイルが大きすぎます(1MB まで)。');
  return real;
}

const LIST_MAX = 500;
const LIST_DEPTH = 8;

// raw/ の中のファイルの名前だけを集める(中身は開かない)。シンボリックリンクは実体が raw/ の中のファイルのときだけ挙げ、フォルダへのリンクはたどらない
export function listRawFiles(root, dir = 'raw') {
  const rawDir = path.resolve(root, 'raw');
  let realRaw;
  try { realRaw = fs.realpathSync(rawDir); } catch { throw new ToolError('raw/ がありません。'); }
  const rel = typeof dir === 'string' && dir.trim() ? dir.trim().replace(/\\/g, '/') : 'raw';
  const start = path.resolve(root, rel);
  if (start !== rawDir && !within(rawDir, start)) throw new ToolError('raw/ の中だけを一覧にできます。');
  let realStart;
  try { realStart = fs.realpathSync(start); } catch { throw new ToolError('フォルダがありません: ' + rel); }
  if (realStart !== realRaw && !within(realRaw, realStart)) throw new ToolError('raw/ の中だけを一覧にできます。');
  if (!fs.statSync(realStart).isDirectory()) throw new ToolError('フォルダではありません: ' + rel);
  const files = [];
  let truncated = false;
  const walk = (absDir, depth) => {
    let entries;
    try { entries = fs.readdirSync(absDir, { withFileTypes: true }); } catch { return; }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const e of entries) {
      if (files.length >= LIST_MAX) { truncated = true; return; }
      const abs = path.join(absDir, e.name);
      if (e.isDirectory()) {
        if (depth < LIST_DEPTH) walk(abs, depth + 1); else truncated = true;
        continue;
      }
      let isFile = e.isFile();
      if (e.isSymbolicLink()) {
        try {
          const real = fs.realpathSync(abs);
          isFile = within(realRaw, real) && fs.statSync(real).isFile();
        } catch { isFile = false; }
      }
      if (!isFile) continue;
      const shown = path.relative(path.resolve(root), abs).split(path.sep).join('/');
      files.push({ path: shown, readable: TEXT_EXT.includes(path.extname(e.name).toLowerCase()) });
    }
  };
  walk(realStart === realRaw ? rawDir : start, 0);
  return { files, truncated };
}

export function formatList({ files, truncated }) {
  if (!files.length) return 'raw/ の中にファイルはありません。';
  const ok = files.filter((f) => f.readable).map((f) => f.path);
  const ng = files.filter((f) => !f.readable).map((f) => f.path);
  const out = [];
  if (ok.length) out.push('read_masked で読めるファイル:', ...ok);
  if (ng.length) out.push((ok.length ? '\n' : '') + '読めない形のファイル(文のファイル ' + TEXT_EXT.join(' ') + ' にしてから置く):', ...ng);
  if (truncated) out.push('\n(多いか深いので、一部だけを挙げた。dir でフォルダを絞ってください)');
  return out.join('\n');
}

// 辞書のファイル(F28c)を読む。読めないときの文には、ファイルの名前・語・core.mjs の理由の文(語が入ることがある)を入れない
function readDictFile(dictPath) {
  let st;
  try { st = fs.statSync(dictPath); } catch { throw new ToolError('MASK_DICT の辞書のファイルがありません。パスを確かめてください。'); }
  if (!st.isFile()) throw new ToolError('MASK_DICT の辞書がファイルではありません。パスを確かめてください。');
  if (st.size > MAX_BYTES) throw new ToolError('MASK_DICT の辞書のファイルが大きすぎます(1MB まで)。');
  try {
    return fs.readFileSync(dictPath, 'utf8');
  } catch {
    throw new ToolError('MASK_DICT の辞書のファイルを開けませんでした。');
  }
}

export function makeMasker(mapPath, dictPath) {
  const m = createMasker({ dictionaries: [CONSTRUCTION_DICT] });
  if (mapPath) {
    try {
      m.importMap(fs.readFileSync(mapPath, 'utf8'));
    } catch (e) {
      // 元の語が入るおそれがあるので、理由の文は出さない
      throw new ToolError('MASK_MAP の対応表を読めませんでした。ファイルを確かめてください。');
    }
  }
  // importMap は足した語を入れ替えるので、辞書は対応表の後に加える
  if (dictPath) {
    const text = readDictFile(dictPath);
    try {
      m.importDict(text);
    } catch {
      // core.mjs の理由の文には語が入ることがあるので出さない
      throw new ToolError('MASK_DICT の辞書を読めませんでした。画面の「辞書を書き出す」で保存したファイル(format: "mask-dict")か確かめてください。');
    }
  }
  return m;
}

// バイト列を文にする(F63a)。UTF-8 → Shift_JIS の順にどちらも fatal で読み、どちらでも読めなければ断る(化けた文を Claude に渡さない)
// 画面の src/mask/extract.mjs の decodeText と同じ順。extract.mjs は zip の処理も含み plugin/ に写していないので、読み込まずにここに書く
function decodeFile(bytes) {
  const hasBom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  const body = hasBom ? bytes.subarray(3) : bytes;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(body);
  } catch { /* UTF-8 ではない。Shift_JIS を試す */ }
  let sjis;
  // 小さい ICU の Node には shift_jis が無く、作るときに投げる
  try {
    sjis = new TextDecoder('shift_jis', { fatal: true });
  } catch {
    throw new ToolError('この Node では Shift_JIS を読めません。UTF-8 で保存してください。');
  }
  try {
    return sjis.decode(body);
  } catch {
    throw new ToolError('文字のファイルとして読めません(UTF-8 か Shift_JIS で保存してください)。');
  }
}

// 置き換えた中身と、見本の語の確かめ(F28a)の結果を返す。見本は置き換えた中身にも対応表にも入らない
export function readMaskedWithCheck(root, rel, { mapPath = process.env.MASK_MAP, dictPath = process.env.MASK_DICT, rand } = {}) {
  const file = resolveRawFile(root, rel);
  const text = decodeFile(fs.readFileSync(file));
  if (text.includes('\u0000')) throw new ToolError('文のファイルではないようです。');
  const m = makeMasker(mapPath, dictPath);
  const { masked } = m.mask(text);
  const check = checkDecoys(m, text, rand ? { rand } : {});
  return { masked, check };
}

export function readMasked(root, rel, opts = {}) {
  return readMaskedWithCheck(root, rel, opts).masked;
}

// check-articles.mjs の場所。リポジトリでは plugin/ の下、入れた後ではプラグインの直下にある(F56a)
const CHECK_ARTICLES_PLACES = [
  ['plugin', 'skills', 'construction-check', 'scripts', 'check-articles.mjs'],
  ['skills', 'construction-check', 'scripts', 'check-articles.mjs'],
];

// 呼ばれたときに場所を順に試す(読み込みの時に解くと、部品の無い所で tools/list まで落ちる)。原文の場所は check-articles.mjs が自分の位置から決める
// 原文が1つも読めないときに次へ進むのは、そのまま確かめるとどの条も「無い」と出て、書き間違いと見分けられないため
export async function checkArticlesText(text, { toolDir = TOOL_DIR } = {}) {
  if (typeof text !== 'string' || !text.trim()) throw new ToolError('text がありません。指摘の文を渡してください。');
  for (const place of CHECK_ARTICLES_PLACES) {
    try {
      const { checkArticles, formatResults, loadSources } = await import(pathToFileURL(path.join(toolDir, ...place)).href);
      const sources = loadSources();
      if (sources.length) return formatResults(checkArticles(text, sources));
    } catch { /* この場所には無い。次を試す */ }
  }
  throw new ToolError('確かめられない: 条番号を確かめる部品か取得した原文が見つからず、どの条番号も確かめていません。プラグインの入れ方を確かめてください。');
}

const ok = (id, result) => ({ jsonrpc: '2.0', id, result });
const err = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });

// 1通の JSON-RPC を処理して返事を返す(通知なら null)
export async function handleMessage(msg, { root = process.env.MASK_ROOT || process.cwd(), mapPath, dictPath } = {}) {
  if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0') return err(msg?.id ?? null, -32600, 'Invalid Request');
  const { id, method, params } = msg;
  const isNotice = id === undefined || id === null;
  if (isNotice) return null;
  switch (method) {
    case 'initialize':
      return ok(id, {
        protocolVersion: typeof params?.protocolVersion === 'string' ? params.protocolVersion : PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
        instructions: 'raw/ の生のファイルは直接読まず、read_masked で置き換えた後の中身を読んでください。ファイルの名前が分からないときは list_masked で名前の一覧を見てください。記号(〔人名1〕など)の元の名前は推測しないでください。指摘の条番号は check_articles で確かめてください。',
      });
    case 'ping':
      return ok(id, {});
    case 'tools/list':
      return ok(id, { tools: TOOLS });
    case 'tools/call': {
      const name = params?.name;
      if (!TOOLS.some((t) => t.name === name)) return err(id, -32602, '知らない道具です: ' + String(name));
      try {
        if (name === 'list_masked') {
          return ok(id, { content: [{ type: 'text', text: formatList(listRawFiles(root, params?.arguments?.dir)) }], isError: false });
        }
        // 「無い」があっても道具としては成功。確かめられなかったときだけ isError にする
        if (name === 'check_articles') {
          return ok(id, { content: [{ type: 'text', text: await checkArticlesText(params?.arguments?.text) }], isError: false });
        }
        const opts = {};
        if (mapPath !== undefined) opts.mapPath = mapPath;
        if (dictPath !== undefined) opts.dictPath = dictPath;
        const { masked, check } = readMaskedWithCheck(root, params?.arguments?.path, opts);
        // 1つ目は置き換えた中身(今までどおり)、2つ目は見本の語の確かめの結果(F28a)
        return ok(id, { content: [{ type: 'text', text: masked }, { type: 'text', text: decoyMessage(check) }], isError: false });
      } catch (e) {
        const message = e instanceof ToolError ? e.message : '読めませんでした。';
        return ok(id, { content: [{ type: 'text', text: message }], isError: true });
      }
    }
    default:
      return err(id, -32601, 'Method not found');
  }
}

async function main() {
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      process.stdout.write(JSON.stringify(err(null, -32700, 'Parse error')) + '\n');
      continue;
    }
    const res = await handleMessage(msg);
    if (res) process.stdout.write(JSON.stringify(res) + '\n');
  }
}

const isMain = Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();

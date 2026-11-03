#!/usr/bin/env node
// 置き換えた後の中身だけを返す手元の MCP の道具(F13)。標準入出力で JSON-RPC 2.0(1行に1通)を話す。外部とは通信しない。
//
// 道具:
//   read_masked { path }  raw/ の中の文のファイルを読み、人名・会社名・メール・電話・住所・許可番号などを〔会社名1〕のような記号に置き換えて返す。
//                         返すのは置き換えた後の中身だけ。対応表(元の語)は返さない。raw/ の外のパスは断る。
//   list_masked { dir? }  raw/ の中のファイルの名前(作業フォルダからのパス)だけを返す。中身は返さない。raw/ の外は返さない。
//                         ファイルの名前は置き換えない(read_masked に渡すため)。名前に人名・会社名が入っていれば、そのまま返る。
//
// 環境変数(どれも任意):
//   MASK_ROOT      作業フォルダ(raw/ のある所)。既定は起動したときのフォルダ(Claude Code はプロジェクトのフォルダで起動する)
//   MASK_TOOL_DIR  このツール(src/mask/ のあるリポジトリ)のフォルダ。既定はこのファイルから3つ上。作業フォルダに写したときは指定する
//   MASK_MAP       画面の「対応表を書き出す」で保存した対応表の JSON。指定すると、その語(人名・現場名など)も同じ記号で置き換える
//
// 限界: 置き換えの漏れは0にならない(README の「文の置き換え」)。読めるのは文のファイル(.txt .md .csv .tsv .json)だけ。

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TOOL_DIR = process.env.MASK_TOOL_DIR || path.resolve(HERE, '..', '..', '..');
const { createMasker } = await import(pathToFileURL(path.join(TOOL_DIR, 'src', 'mask', 'core.mjs')).href);
const { CONSTRUCTION_DICT } = await import(pathToFileURL(path.join(TOOL_DIR, 'src', 'mask', 'dict-construction.mjs')).href);

export const SERVER_INFO = { name: 'masked-files', version: '0.1.0' };
export const PROTOCOL_VERSION = '2025-06-18';
export const TEXT_EXT = ['.txt', '.md', '.csv', '.tsv', '.json'];
const MAX_BYTES = 1024 * 1024;

export const TOOLS = [
  {
    name: 'read_masked',
    description: 'raw/ の中の文のファイルを読み、人名・会社名・メール・電話・住所・許可番号などを〔会社名1〕のような記号に置き換えた後の中身だけを返す。元の語と対応表は返さない。raw/ の外は読めない。',
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

function makeMasker(mapPath) {
  const m = createMasker({ dictionaries: [CONSTRUCTION_DICT] });
  if (mapPath) {
    try {
      m.importMap(fs.readFileSync(mapPath, 'utf8'));
    } catch (e) {
      // 元の語が入るおそれがあるので、理由の文は出さない
      throw new ToolError('MASK_MAP の対応表を読めませんでした。ファイルを確かめてください。');
    }
  }
  return m;
}

export function readMasked(root, rel, { mapPath = process.env.MASK_MAP } = {}) {
  const file = resolveRawFile(root, rel);
  const text = fs.readFileSync(file, 'utf8');
  if (text.includes('\u0000')) throw new ToolError('文のファイルではないようです。');
  const { masked } = makeMasker(mapPath).mask(text);
  return masked;
}

const ok = (id, result) => ({ jsonrpc: '2.0', id, result });
const err = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });

// 1通の JSON-RPC を処理して返事を返す(通知なら null)
export async function handleMessage(msg, { root = process.env.MASK_ROOT || process.cwd(), mapPath } = {}) {
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
        instructions: 'raw/ の生のファイルは直接読まず、read_masked で置き換えた後の中身を読んでください。ファイルの名前が分からないときは list_masked で名前の一覧を見てください。記号(〔人名1〕など)の元の名前は推測しないでください。',
      });
    case 'ping':
      return ok(id, {});
    case 'tools/list':
      return ok(id, { tools: TOOLS });
    case 'tools/call': {
      const name = params?.name;
      if (name !== 'read_masked' && name !== 'list_masked') return err(id, -32602, '知らない道具です: ' + String(name));
      try {
        if (name === 'list_masked') {
          return ok(id, { content: [{ type: 'text', text: formatList(listRawFiles(root, params?.arguments?.dir)) }], isError: false });
        }
        const masked = readMasked(root, params?.arguments?.path, mapPath === undefined ? {} : { mapPath });
        return ok(id, { content: [{ type: 'text', text: masked }], isError: false });
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

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
//   check_conditions { data, files }  公告から拾った条件の JSON の文(data)を、原文のファイル(files。作業フォルダからのパスの配列)と照らす(F76a)。
//                         原文はこの道具が読む(Claude が写した文を照合に持ち込まないため)。読めるのは作業フォルダの中の文のファイルだけで、
//                         raw/・secrets/・.claude/・.git/ の下と、名前が . で始まる部分のあるパスは断る。
//                         read_masked と同じく、名前に : のあるパスと Windows のデバイス名のパスも断る(F83b3)。
//                         1つ目の文は check-conditions.mjs の CLI の --md の表と最後の行、2つ目の文は --out と同じ形の JSON。
//
// 環境変数(どれも任意):
//   MASK_ROOT      作業フォルダ(raw/ のある所)。既定は起動したときのフォルダ(Claude Code はプロジェクトのフォルダで起動する)
//   MASK_TOOL_DIR  このツール(src/mask/ のあるフォルダ)。既定はこのファイルから3つ上(リポジトリの integration/claude-code/mcp/ に置いたときの直下)。
//                  作業フォルダに写したときは指定する。plugin/mcp/ の写しは .mcp.json がプラグインの直下を渡す
//   MASK_MAP       画面の「対応表を書き出す」で保存した対応表の JSON。指定すると、その語(人名・現場名など)も同じ記号で置き換える。
//                  相対パスは作業フォルダから解く(MASK_DICT も同じ。F83b3)
//   MASK_DICT      画面の「辞書を書き出す」で保存した辞書の JSON(format: "mask-dict")。指定すると、足した語(人名・現場名など)も置き換える(F28c)。
//                  MASK_MAP と両方を指定したときは、対応表を読んでから辞書の語を加える。読めないときは理由の種類だけを返し、辞書の中身(語)は返事にも記録にも出さない
//
// 限界: 置き換えの漏れは0にならない(README の「文の置き換え」)。読めるのは文のファイル(.txt .md .csv .tsv .json)だけ。文字は UTF-8(BOM の有無どちらも)か Shift_JIS(F63a)。
//       リンクの数が2以上のファイル(ハードリンク)と、ファイルの番号を返さないドライブ(exFAT の USB など)のファイルは読まない(F83b1)。

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
  {
    name: 'check_conditions',
    description: '公告から拾った条件の JSON を原文のファイルと照らす。原文はこの道具が読む。1つ目の文は人が読む表(外した値と確かめが要る理由、画面に入る値)と最後の行、2つ目の文は画面に読み込める JSON。読めるのは作業フォルダの中の文のファイルだけで、raw/・secrets/・.claude/・.git/ の下と、名前が . で始まる部分のあるパスは断る。',
    inputSchema: {
      type: 'object',
      properties: {
        data: { type: 'string', description: '拾った条件の JSON の文(Skill bid-intake の「ファイルの形」)' },
        files: { type: 'array', items: { type: 'string' }, minItems: 1, description: '原文のファイルの、作業フォルダからのパスの配列(例 公告/入札公告.txt)。raw/ の下は渡せない' },
      },
      required: ['data', 'files'],
      additionalProperties: false,
    },
  },
];

class ToolError extends Error {}

// 試験の口(F83b1)。本番では null のまま。afterOpen は開いて fstat で確かめた直後、afterResolve は実体のパスの確かめが通った直後に呼ぶ(F83b6 が使う)
export const __testHooks = { afterOpen: null, afterResolve: null };

const within = (dir, p) => { const r = path.relative(dir, p); return r !== '' && !r.startsWith('..') && !path.isAbsolute(r); };

// Windows のデバイス名。拡張子が付いても、末尾に点や空白があっても同じ名前として開かれる
const DEVICE_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

// 作業フォルダからのパスの名前の決まり(F83b3)。read_masked と check_conditions の両方で、開く前の字と開いた後の実体のパスに当てる。
// 作業フォルダからの相対のパスだけを見るので、絶対パスのドライブの C: には当たらない。
// : は Windows の代替データストリーム。raw:s.txt は raw という名前のファイルの別の中身で、パスの字では raw/ の下に見えない。どの OS でも断る
// デバイス名は開くだけで止まるおそれがある。Windows は名前の最初の点より後を見ない(CON.a.txt も CON)
function refuseBadName(relPath, rel) {
  if (relPath.includes(':')) throw new ToolError('名前に : のあるパスは読めません: ' + rel);
  const isDevice = (part) => DEVICE_NAME.test(part.split('.')[0].replace(/ +$/, ''));
  if (relPath.split(/[\\/]/).some(isDevice)) throw new ToolError('Windows のデバイス名(CON・PRN・AUX・NUL・COM1〜COM9・LPT1〜LPT9)のパスは読めません: ' + rel);
}

// MASK_MAP・MASK_DICT のパスを作業フォルダから絶対パスに解く1つの関数(F83b3)。読むファイルと読まないファイルが分かれないよう、makeMasker に渡す値と確かめの両方がこれを通る。指定なしはそのまま返す
const maskFilePath = (root, p) => (p ? path.resolve(root, p) : p);

const OUTSIDE_RAW = 'raw/ の中のファイルだけを読めます。';

// read_masked の決まり: raw/ の中のファイルだけを許す(.. やシンボリックリンクで外へ出るものは断る)。返す物の形は sourceRule と同じ
function rawRule(root, rel) {
  if (typeof rel !== 'string' || !rel.trim()) throw new ToolError('path がありません。');
  const rawDir = path.resolve(root, 'raw');
  const target = path.resolve(root, rel.replace(/\\/g, '/'));
  if (!within(rawDir, target)) throw new ToolError(OUTSIDE_RAW);
  refuseBadName(path.relative(path.resolve(root), target), rel);
  const checkReal = (real) => {
    let realRaw;
    try { realRaw = fs.realpathSync.native(rawDir); } catch { throw new ToolError('raw/ がありません。'); }
    if (!within(realRaw, real)) throw new ToolError(OUTSIDE_RAW);
    // raw/ そのものがリンクでもよいので、実体の raw/ からのパスを見る
    refuseBadName(path.relative(realRaw, real), rel);
    if (!TEXT_EXT.includes(path.extname(real).toLowerCase())) throw new ToolError('読めるのは文のファイル(' + TEXT_EXT.join(' ') + ')だけです。Excel・Word は画面か表計算で文にしてから raw/ に置いてください。');
  };
  return { target, checkReal, tooLarge: 'ファイルが大きすぎます(1MB まで)。' };
}

const OUTSIDE_WORK = '作業フォルダの中のファイルだけを読めます。';
// check_conditions が読まない所。permissions.deny は MCP の道に効かないので、道具の中で断る
const DENIED_DIRS = ['raw', 'secrets', '.claude', '.git'];
const MAX_SOURCES = 50;

// 作業フォルダからのパスに読まない部分があれば断る。どの階層でも見る。guard-raw と同じく RAW・Raw も raw とみなす(大文字と小文字を分けないファイルシステムで同じ所を指す)
function refuseDeniedPart(relPath) {
  const parts = relPath.split(path.sep).map((p) => p.toLowerCase());
  if (parts.includes('raw')) throw new ToolError('raw/ の書類は check_conditions に渡せません。公告は raw/ の外に置いてください。');
  if (parts.includes('secrets') || parts.some((p) => p.startsWith('.'))) throw new ToolError('secrets/・.claude/・.git/ の下と、名前が . で始まる部分のあるパスは読めません。');
}

// check_conditions の決まり(F76a)。先に字で断るので、字で断る所の下にファイルがあるかは返事から分からない(リンクを通すパスでは、無いファイルは「ファイルがありません」になる)。
// 開いた後に実体でも同じことを確かめる(リンクで外や raw/ へ出る形、Windows の末尾の点・短い名前のように字が違っても同じ所を指す形)
function sourceRule(root, rel) {
  const base = path.resolve(root);
  const target = path.resolve(base, rel.replace(/\\/g, '/'));
  if (!within(base, target)) throw new ToolError(OUTSIDE_WORK);
  refuseBadName(path.relative(base, target), rel);
  refuseDeniedPart(path.relative(base, target));
  let realBase;
  try { realBase = fs.realpathSync.native(base); } catch { throw new ToolError('作業フォルダがありません。'); }
  // 作業フォルダそのものが断る所のとき。guard-raw も作業フォルダが raw/ の中なら止める。.git はどの階層でも断り、.claude は worktree の置き場(.claude/worktrees/<名前>)の下だけ許す
  const baseParts = realBase.split(path.sep).map((p) => p.toLowerCase());
  if (baseParts.includes('raw')) refuseDeniedPart('raw');
  const outsideWorktree = (p, i) => p === '.claude' && (baseParts[i + 1] !== 'worktrees' || baseParts[i + 2] === undefined);
  if (baseParts.includes('secrets') || baseParts.includes('.git') || baseParts.some(outsideWorktree)) refuseDeniedPart('secrets');
  const checkReal = (real) => {
    if (!within(realBase, real)) throw new ToolError(OUTSIDE_WORK);
    refuseBadName(path.relative(realBase, real), rel);
    refuseDeniedPart(path.relative(realBase, real));
    // raw/ などそのものが作業フォルダの中の別のフォルダへのリンクのとき、実体のパスに raw の字が出ないので、リンクの先と比べる
    for (const dir of DENIED_DIRS) {
      let realDir;
      try { realDir = fs.realpathSync.native(path.join(base, dir)); } catch { continue; }
      if (within(realDir, real)) refuseDeniedPart(dir);
    }
    // 対応表と辞書には元の語が入るので、raw/ の外に置かれていても読まない
    for (const p of [process.env.MASK_MAP, process.env.MASK_DICT]) {
      let realMask;
      try { realMask = p ? fs.realpathSync.native(maskFilePath(base, p)) : null; } catch { continue; }
      if (real === realMask) throw new ToolError('MASK_MAP・MASK_DICT のファイルは読めません。');
    }
    if (!TEXT_EXT.includes(path.extname(real).toLowerCase())) throw new ToolError('読めるのは文のファイル(' + TEXT_EXT.join(' ') + ')だけです: ' + rel);
  };
  return { target, checkReal, tooLarge: 'ファイルが大きすぎます(1MB まで): ' + rel };
}

const READ_RULES = { raw: rawRule, source: sourceRule };
// FIFO を開いて止まらないため。Windows の Node にはこの2つが無く、付かない。O_NOFOLLOW は使わない(作業フォルダの中のファイルへのリンクを読むので、リンクの先は開いた後に確かめる)
const OPEN_FLAGS = fs.constants.O_RDONLY | (fs.constants.O_NONBLOCK ?? 0) | (fs.constants.O_NOCTTY ?? 0);
const NOT_THERE = ['ENOENT', 'ENOTDIR', 'ELOOP', 'ENAMETOOLONG'];
const REPLACED = '読む間にファイルが替わりました。もう一度呼んでください';

// 開いた fd から読む。大きさ+1 バイトまで読み、fstat の大きさと違えば読む間に書き換えられたものとして断る(fstat で上限の内なので、上限を超えた分もここで止まる)
function readOpened(fd, size) {
  const bytes = Buffer.alloc(size + 1);
  let got = 0;
  while (got < bytes.length) {
    const n = fs.readSync(fd, bytes, got, bytes.length - got, got);
    if (n === 0) break;
    got += n;
  }
  if (got !== size) throw new ToolError(REPLACED);
  return bytes.subarray(0, size);
}

// 道具がファイルを読む1つの読み口(F83b1)。kind は read_masked の 'raw' と check_conditions の 'source'。読んだバイト列を返す。
// 確かめてから名前で読み直すと、その間の差し替えで読まない所が読める(CWE-367・CWE-59)ので、先に開き、開いた物を確かめ、開いた fd から読む
function readChecked(root, rel, kind) {
  const { target, checkReal, tooLarge } = READ_RULES[kind](root, rel);
  let fd;
  try {
    fd = fs.openSync(target, OPEN_FLAGS);
  } catch (e) {
    if (NOT_THERE.includes(e.code)) throw new ToolError('ファイルがありません: ' + rel);
    throw e;
  }
  try {
    const st = fs.fstatSync(fd, { bigint: true });
    if (!st.isFile()) throw new ToolError('ファイルではありません: ' + rel);
    // raw/x が secrets/ や MASK_MAP へのハードリンクでも、パスからは見分けられない。リンクの数で断る
    if (st.nlink !== 1n) throw new ToolError('リンクの数が2以上のファイル(ハードリンク)は読みません。写し(コピー)を置いてください: ' + rel);
    // 下の dev と ino の比べができないドライブ
    if (st.ino === 0n) throw new ToolError('このドライブではファイルの番号が取れないので読めません。作業フォルダを NTFS などのドライブに置いてください');
    __testHooks.afterOpen?.(target);
    let real;
    try { real = fs.realpathSync.native(target); } catch { throw new ToolError('ファイルがありません: ' + rel); }
    checkReal(real);
    __testHooks.afterResolve?.(target);
    // 確かめた実体のパスと開いた物が同じファイルか。開いた後に名前を替えられると、確かめは替えた先を見ている
    // 開いた後に同じ実体のハードリンクへ替えられると dev と ino が合い、上の fstat の数は替える前の物なので、リンクの数も今の物を見る
    const now = fs.statSync(real, { bigint: true, throwIfNoEntry: false });
    if (now?.dev !== st.dev || now?.ino !== st.ino || now?.nlink !== 1n) throw new ToolError(REPLACED);
    // 上限は実体の確かめの後で見る。先に見ると 1MB を超える Excel に「大きすぎます」と返して文にして置く案内が出ず、リンクの先の大きさも返事から分かる
    if (st.size > MAX_BYTES) throw new ToolError(tooLarge);
    return readOpened(fd, Number(st.size));
  } finally {
    fs.closeSync(fd);
  }
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

// ISO-2022-JP の文字集合を切り替える印(F83b2)。0x1B は UTF-8 でも Shift_JIS でも2バイトの字の途中に現れないので、バイトのまま探してよい
const ISO2022_MARKS = ['\x1b$B', '\x1b$@', '\x1b(J', '\x1b(B'];

// バイト列を文にする(F63a)。UTF-8 → Shift_JIS の順にどちらも fatal で読み、どちらでも読めなければ断る(UTF-16 など)
// fatal でも化けた文を全部は止められない。ISO-2022-JP は全部が 7bit で UTF-8 として読めるので下の toText が先に断る。EUC-JP の短い文は Shift_JIS として読めて化けたまま返る(manual に書いた)
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

function toText(bytes) {
  // 読むと漢字が JIS の符号の ASCII になり、会社名と人名が辞書にも規則にも当たらず置き換わらないまま返る。読む前に断る
  if (ISO2022_MARKS.some((mark) => bytes.includes(mark))) throw new ToolError('ISO-2022-JP のファイルは読めません。UTF-8 か Shift_JIS で保存し直してください');
  const text = decodeFile(bytes);
  if (text.includes('\u0000')) throw new ToolError('文のファイルではないようです。');
  return text;
}

// 置き換えた中身と、見本の語の確かめ(F28a)の結果を返す。見本は置き換えた中身にも対応表にも入らない
export function readMaskedWithCheck(root, rel, { mapPath = process.env.MASK_MAP, dictPath = process.env.MASK_DICT, rand } = {}) {
  const text = toText(readChecked(root, rel, 'raw'));
  // 空の返事を「書類が白紙」と読まれないように断る。check_conditions の readSource と同じ見方(BOM だけ・空白だけも空)
  if (!text.trim()) throw new ToolError('ファイルが空です');
  const m = makeMasker(maskFilePath(root, mapPath), maskFilePath(root, dictPath));
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

// check-conditions.mjs の場所。check-articles.mjs と同じ2通り(F76a)
const CHECK_CONDITIONS_PLACES = [
  ['plugin', 'skills', 'bid-intake', 'scripts', 'check-conditions.mjs'],
  ['skills', 'bid-intake', 'scripts', 'check-conditions.mjs'],
];

// 原文を1つ読む。file は CLI と同じくファイルの名前だけ。文字で読めないときは、どのファイルかを添える
function readSource(root, rel) {
  const bytes = readChecked(root, rel, 'source');
  try {
    const text = toText(bytes);
    if (!text.trim()) throw new ToolError('中身がありません。');
    return { file: path.basename(rel.replace(/\\/g, '/')), text };
  } catch (e) {
    throw e instanceof ToolError ? new ToolError(rel + ': ' + e.message) : e;
  }
}

// 拾った条件を原文と照らし、CLI の --md の表と最後の行(table)、--out と同じ形の JSON(json)を返す(F76a)
// 読めない原文(空のファイルを含む)が1つでもあれば全体を断る。その原文を飛ばして照らすと、そこにしかない条件を「公告に書いていない」と言ってしまう(CLI も止まる)
export async function checkConditionsFiles(root, data, files, { toolDir = TOOL_DIR } = {}) {
  if (typeof data !== 'string' || !data.trim()) throw new ToolError('data がありません。拾った条件の JSON の文を渡してください。');
  let parsed;
  try { parsed = JSON.parse(data); } catch { throw new ToolError('data が JSON として読めません。拾った条件の JSON の文を渡してください。'); }
  if (!Array.isArray(parsed?.conditions)) throw new ToolError('data に conditions の配列がありません。Skill bid-intake の「ファイルの形」に合わせてください。');
  if (!Array.isArray(files) || !files.length || !files.every((f) => typeof f === 'string' && f.trim())) throw new ToolError('files がありません。原文のファイルの、作業フォルダからのパスの配列を渡してください。');
  if (files.length > MAX_SOURCES) throw new ToolError('files が多すぎます(' + MAX_SOURCES + ' ファイルまで)。');
  const sources = files.map((f) => readSource(root, f));
  for (const place of CHECK_CONDITIONS_PLACES) {
    let tool;
    try {
      tool = await import(pathToFileURL(path.join(toolDir, ...place)).href);
    } catch { continue; /* この場所には無い。次を試す */ }
    let r;
    try {
      r = tool.checkConditions(parsed, sources);
    } catch {
      throw new ToolError('拾った条件を照らせませんでした。data の形を Skill bid-intake の「ファイルの形」に合わせてください。');
    }
    return { table: tool.renderMarkdown(r) + tool.summaryLine(r), json: JSON.stringify(r, null, 2) + '\n' };
  }
  throw new ToolError('照らせない: 照合の部品が見つからず、どの値も照らしていません。プラグインの入れ方を確かめてください。');
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
        instructions: 'raw/ の生のファイルは直接読まず、read_masked で置き換えた後の中身を読んでください。ファイルの名前が分からないときは list_masked で名前の一覧を見てください。記号(〔人名1〕など)の元の名前は推測しないでください。指摘の条番号は check_articles で確かめてください。公告から拾った条件は check_conditions で照らしてください。',
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
        // 外した値があっても道具としては成功。照らせなかったときだけ isError にする
        if (name === 'check_conditions') {
          const { table, json } = await checkConditionsFiles(root, params?.arguments?.data, params?.arguments?.files);
          return ok(id, { content: [{ type: 'text', text: table }, { type: 'text', text: json }], isError: false });
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

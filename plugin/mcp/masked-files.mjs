#!/usr/bin/env node
// 置き換えた後の中身だけを返す手元の MCP の道具(F13)。標準入出力で JSON-RPC 2.0(1行に1通)を話す。外部とは通信しない。
//
// 道具:
//   read_masked { path }  raw/ の中の文のファイルを読み、人名・会社名・メール・電話・住所・許可番号などを〔会社名1〕のような記号に置き換えて返す。
//                         返すのは置き換えた後の中身だけ。対応表(元の語)は返さない。raw/ の外のパスは断る。
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
];

class ToolError extends Error {}

// raw/ の中のファイルだけを許す(.. やシンボリックリンクで外へ出るものは断る)
export function resolveRawFile(root, rel) {
  if (typeof rel !== 'string' || !rel.trim()) throw new ToolError('path がありません。');
  const rawDir = path.resolve(root, 'raw');
  const target = path.resolve(root, rel.replace(/\\/g, '/'));
  const within = (dir, p) => { const r = path.relative(dir, p); return r !== '' && !r.startsWith('..') && !path.isAbsolute(r); };
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
        instructions: 'raw/ の生のファイルは直接読まず、read_masked で置き換えた後の中身を読んでください。記号(〔人名1〕など)の元の名前は推測しないでください。',
      });
    case 'ping':
      return ok(id, {});
    case 'tools/list':
      return ok(id, { tools: TOOLS });
    case 'tools/call': {
      const name = params?.name;
      if (name !== 'read_masked') return err(id, -32602, '知らない道具です: ' + String(name));
      try {
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

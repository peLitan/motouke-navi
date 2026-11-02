#!/usr/bin/env node
// raw/ の生のファイルを Claude Code に読ませないためのフック(F13)。
// 使う所: .claude/settings.json の PreToolUse(Read・Grep・Glob・Bash など)と UserPromptSubmit(@ でのファイルの取り込み)。
// 止めるときは終了コード 2 で終わり、理由を標準エラーに出す(Claude Code はこれで道具の実行・プロンプトの送信を止める)。
// 入力の JSON が読めないなど、判断できないときも止める(止める側に倒す)。
//
// 限界(README にも書く):
// - Bash のコマンドは文字列で「raw/」を探すだけ。変数・cd してからの相対パス・別名などでは見落とす
// - Grep・Glob は、探す場所の直下に raw/ があるときだけ止める。深い所の raw/ は permissions.deny に任せる
// - フックは Claude Code の道具だけを見る。人が端末で開いたファイルや、別のプログラムは止められない

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export const RAW_DIR = 'raw';

// パスを、区切りを / にそろえて、cwd からの部分に分ける。cwd の外なら絶対パスのまま分ける
function segmentsOf(p, cwd) {
  const s = String(p ?? '').replace(/\\/g, '/').replace(/^["']|["']$/g, '');
  if (!s) return [];
  const base = String(cwd || '/').replace(/\\/g, '/');
  const abs = path.posix.resolve(base, s);
  const rel = path.posix.relative(base, abs);
  const inside = rel === '' || (!rel.startsWith('..') && !path.posix.isAbsolute(rel));
  return (inside ? rel : abs).split('/').filter(Boolean);
}

// パスが raw/ の中(または raw そのもの)を指すか。途中に「raw」という名前の部分があれば止める(docs/rawdata-note.md のような名前は通す)
export function isRawPath(p, cwd) {
  return segmentsOf(p, cwd).includes(RAW_DIR);
}

// グロブの形(raw/**/* や **/raw/*.txt)が raw/ を指すか
function isRawPattern(pattern) {
  return String(pattern ?? '').replace(/\\/g, '/').split('/').includes(RAW_DIR);
}

// 探す場所の直下に raw/ があるか(Grep で場所を指定しないと raw/ の中まで探すため)
function hasRawChild(dir, cwd) {
  try {
    const abs = path.resolve(String(cwd || '.'), String(dir || '.'));
    return fs.statSync(path.join(abs, RAW_DIR)).isDirectory();
  } catch {
    return false;
  }
}

// Bash のコマンドの中の raw/ の指定(cat raw/a.txt、"./raw/a.txt"、C:\work\raw\a.txt など)
const RAW_IN_COMMAND = /(^|[\s'"=(:;|&<>/\\])raw([/\\]|(?=[\s'";|&)<>]|$))/;

const block = (reason) => ({ block: true, reason });
const pass = () => ({ block: false });

const REASON_TOOL = 'raw/ の生のファイルは読めません(個人情報が入っているため)。置き換えた後の中身は MCP の道具 masked-files の read_masked で読んでください。';

// PreToolUse の判断。input は Claude Code がフックに渡す JSON({ tool_name, tool_input, cwd, ... })
export function decideTool(input) {
  if (!input || typeof input !== 'object') return block('フックの入力が読めないので止めました。');
  const cwd = input.cwd || process.cwd();
  const name = String(input.tool_name || '');
  const ti = input.tool_input || {};
  switch (name) {
    case 'Read':
    case 'Edit':
    case 'Write':
    case 'NotebookEdit':
    case 'NotebookRead':
      if (isRawPath(ti.file_path ?? ti.notebook_path ?? ti.path, cwd)) return block(REASON_TOOL);
      return pass();
    case 'Grep':
      if (isRawPath(ti.path, cwd) || isRawPattern(ti.glob)) return block(REASON_TOOL);
      if (hasRawChild(ti.path, cwd)) return block('探す場所の直下に raw/ があるので止めました。path に masked/ など raw/ を含まない場所を指定してください。');
      return pass();
    case 'Glob':
      if (isRawPath(ti.path, cwd) || isRawPattern(ti.pattern)) return block(REASON_TOOL);
      return pass();
    case 'Bash':
    case 'PowerShell':
      if (RAW_IN_COMMAND.test(String(ti.command ?? ''))) return block('コマンドの中に raw/ の指定があるので止めました。' + REASON_TOOL);
      return pass();
    default:
      return pass();
  }
}

// プロンプトの中の @ でのファイルの指定を取り出す(@raw/a.txt、@./raw/a.docx、@"raw/名前 空白.txt")
export function mentionsOf(prompt) {
  const out = [];
  const re = /(^|[\s(（「『])@(?:"([^"]+)"|(\S+))/gu;
  for (const m of String(prompt ?? '').matchAll(re)) out.push(m[2] ?? m[3]);
  return out;
}

// UserPromptSubmit の判断
export function decidePrompt(input) {
  if (!input || typeof input !== 'object') return block('フックの入力が読めないので止めました。');
  const cwd = input.cwd || process.cwd();
  for (const m of mentionsOf(input.prompt)) {
    if (isRawPath(m, cwd)) return block('@ で raw/ のファイルを入れようとしたので止めました(個人情報が入っているため)。置き換えた後のファイル(masked/ など)を指定するか、MCP の道具 masked-files の read_masked を使ってください。');
  }
  return pass();
}

export function decide(input) {
  if (input && input.hook_event_name === 'UserPromptSubmit') return decidePrompt(input);
  if (input && typeof input.prompt === 'string' && !input.tool_name) return decidePrompt(input);
  return decideTool(input);
}

async function main() {
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    process.stderr.write('フックの入力(JSON)が読めないので止めました。\n');
    process.exit(2);
  }
  const r = decide(input);
  if (r.block) {
    process.stderr.write(r.reason + '\n');
    process.exit(2);
  }
  process.exit(0);
}

const isMain = Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main().catch(() => { process.stderr.write('フックが失敗したので止めました。\n'); process.exit(2); });

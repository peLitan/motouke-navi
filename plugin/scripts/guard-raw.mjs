#!/usr/bin/env node
// raw/ の生のファイルを Claude Code の道具で読む操作を止めるためのフック(F13・F27a)。
// 使う所: .claude/settings.json(またはプラグインの hooks/hooks.json)の PreToolUse(Read・Grep・Glob・Bash など)と UserPromptSubmit(@ でのファイルの取り込み)。
// 止めるときは終了コード 2 で終わり、理由を標準エラーに出す(Claude Code はこれで道具の実行・プロンプトの送信を止める)。
// 入力の JSON が読めないなど、判断できないときも止める(止める側に倒す)。
//
// F27a で足したこと(作業フォルダに raw/ があるとき):
// - 「raw」の文字を含まないコマンドも見る: グロブ(r?w/・*/・** など raw に当たる形)、再帰の検索(grep -r・rg・find・Get-ChildItem -Recurse など)、
//   書いたスクリプトの実行(中身にファイルの読み取り・別のコマンドの起動があれば止める)、node -e・python -c などのその場のコード、変数・コマンドの置き換え
// - シンボリックリンクは実体のパスで判断する。RAW・Raw のような大文字も raw とみなす
// - Write・Edit は、書く中身に raw/ の読み取りの形があれば止める
// - 止めたときは「人が中身を確かめて、自分の端末で実行してください」と人に回す文を出す
//
// 限界(README にも書く。止めきれない操作):
// - コマンドの読み方は簡単なもの。別名(alias)・関数・npm run や make などのタスクの中身・sed の r コマンド・標準入力からパスを受ける道具などは見ていない
// - raw/ を探すのは作業フォルダから3階層まで。それより深い所の raw/ は、パスに raw の文字があるときだけ止める
// - プラグインのフォルダ(CLAUDE_PLUGIN_ROOT)のスクリプトは中身を見ずに通す(点検の Skill のスクリプトを止めないため)
// - フックは Claude Code の道具だけを見る。人が端末で開いたファイルや、別のプログラム、MCP の道具は止められない

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export const RAW_DIR = 'raw';

const isRawName = (s) => String(s).toLowerCase() === RAW_DIR;
const slash = (s) => String(s ?? '').replace(/\\/g, '/');
const unquote = (s) => slash(s).replace(/^["']|["']$/g, '');

// パスを、cwd からの部分(cwd の外なら絶対パス)に分ける
function partsFrom(abs, base) {
  const rel = path.posix.relative(base, abs);
  const inside = rel === '' || (!rel.startsWith('..') && !path.posix.isAbsolute(rel));
  return (inside ? rel : abs).split('/').filter(Boolean);
}

function resolveAbs(p, cwd) {
  return path.posix.resolve(slash(cwd || '/'), unquote(p));
}

// 一番長い、実在する先頭の部分を実体のパスにする(シンボリックリンクをたどる)。何も無ければ null
function realOf(abs) {
  let cur = abs;
  const rest = [];
  for (let i = 0; i < 64; i++) {
    try {
      const real = slash(fs.realpathSync(cur));
      return rest.length ? path.posix.join(real, ...rest.reverse()) : real;
    } catch {
      const parent = path.posix.dirname(cur);
      if (parent === cur) return null;
      rest.push(path.posix.basename(cur));
      cur = parent;
    }
  }
  return null;
}

function realCwd(cwd) {
  const c = slash(cwd || '/');
  return realOf(c) || c;
}

// パスが raw/ の中(または raw そのもの)を指すか。途中に「raw」という名前の部分があれば止める(docs/rawdata-note.md のような名前は通す)
// シンボリックリンクは実体のパスでも確かめる。大文字・小文字は区別しない
export function isRawPath(p, cwd) {
  const s = unquote(p);
  if (!s) return false;
  const base = slash(cwd || '/');
  const abs = resolveAbs(s, base);
  if (partsFrom(abs, base).some(isRawName)) return true;
  const real = realOf(abs);
  if (real && partsFrom(real, realCwd(base)).some(isRawName)) return true;
  return false;
}

// グロブの1つの部分(r?w・*・[r]aw・{raw,x} など)を正規表現にする
function segRegex(seg) {
  let re = '';
  for (let i = 0; i < seg.length; i++) {
    const c = seg[i];
    if (c === '*') re += '.*';
    else if (c === '?') re += '.';
    else if (c === '[') {
      const j = seg.indexOf(']', i + 2);
      if (j < 0) { re += '\\['; continue; }
      let body = seg.slice(i + 1, j);
      if (body.startsWith('!')) body = '^' + body.slice(1);
      re += '[' + body.replace(/\\/g, '\\\\') + ']';
      i = j;
    } else if (c === '{') {
      const j = seg.indexOf('}', i);
      if (j < 0) { re += '\\{'; continue; }
      re += '(?:' + seg.slice(i + 1, j).split(',').map((x) => segRegex(x)).join('|') + ')';
      i = j;
    } else re += c.replace(/[.+^$()|\\]/g, '\\$&');
  }
  return re;
}

export const hasGlobChars = (s) => /[*?[{]/.test(String(s));

// グロブの1つの部分が「raw」という名前に当たるか
export function globSegMatchesRaw(seg) {
  if (!hasGlobChars(seg)) return isRawName(seg);
  try {
    return new RegExp('^' + segRegex(seg) + '$', 'i').test(RAW_DIR);
  } catch {
    return true; // 読めない形は当たるものとして扱う
  }
}

// グロブの形(raw/**/* や **/raw/*.txt)が raw/ を名前で指すか
function isRawPattern(pattern) {
  return slash(pattern).split('/').some(isRawName);
}

// base から depth 階層までの raw/(名前が raw のフォルダ、または実体が raw のフォルダを指すリンク)を探す
const SKIP_DIRS = new Set(['node_modules', '.git']);
export function findRawDirs(base, depth = 3) {
  const out = [];
  let budget = 3000;
  const walk = (dir, d) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (--budget < 0) return;
      const full = path.posix.join(dir, e.name);
      let isDir = e.isDirectory();
      let real = full;
      if (e.isSymbolicLink()) {
        try { real = slash(fs.realpathSync(full)); isDir = fs.statSync(full).isDirectory(); } catch { isDir = false; }
      }
      if (!isDir) continue;
      if (isRawName(e.name) || isRawName(path.posix.basename(real))) { out.push(full); continue; }
      if (d < depth && !SKIP_DIRS.has(e.name) && !e.isSymbolicLink()) walk(full, d + 1);
    }
  };
  walk(slash(base), 1);
  return out;
}

// 作業フォルダ(cwd)に raw/ があるか、cwd が raw/ の中か
export function rawWorkspace(cwd) {
  const c = slash(cwd || '/');
  if (c.split('/').some(isRawName)) return true;
  const real = realOf(c);
  if (real && real.split('/').some(isRawName)) return true;
  return findRawDirs(c).length > 0;
}

// dir(パス)が raw/ そのもの、または raw/ を下に持つか(再帰の検索の起点として危ないか)
function coversRaw(p, cwd) {
  if (isRawPath(p, cwd)) return true;
  const abs = resolveAbs(p, cwd);
  let st;
  try { st = fs.statSync(abs); } catch { return false; }
  if (!st.isDirectory()) return false;
  return findRawDirs(abs).length > 0;
}

// グロブの語が、展開すると raw/ に当たりうるか(r?w/a.txt・*/a.txt・**/*.txt など)
function globHitsRaw(token, cwd) {
  const t = unquote(token);
  if (!hasGlobChars(t)) return false;
  const segs = t.split('/');
  const lit = [];
  let i = 0;
  if (t.startsWith('/')) { lit.push(''); i = 1; }
  for (; i < segs.length && !hasGlobChars(segs[i]); i++) lit.push(segs[i]);
  const rest = segs.slice(i);
  if (!rest.some((s) => globSegMatchesRaw(s))) return false;
  const prefix = lit.length ? (lit.join('/') || '/') : '.';
  if (isRawPath(prefix, cwd)) return true;
  const abs = resolveAbs(prefix, cwd);
  return findRawDirs(abs).length > 0;
}

// ---- コマンドの読み方(簡単なもの) ----

// コマンドを、演算子(; & | && || 改行 括弧)で区切った単純なコマンドの並びにする。各語は { text(引用符を外した文字), glob(引用符の外にグロブの文字があるか) }
export function splitCommand(cmd) {
  const cmds = [];
  let words = [];
  let cur = null;
  const push = () => { if (cur) { words.push(cur); cur = null; } };
  const end = () => { push(); if (words.length) cmds.push(words); words = []; };
  const s = String(cmd ?? '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "'") {
      cur = cur || { text: '', glob: false };
      const j = s.indexOf("'", i + 1);
      cur.text += s.slice(i + 1, j < 0 ? s.length : j);
      i = j < 0 ? s.length : j;
    } else if (c === '"') {
      cur = cur || { text: '', glob: false };
      let j = i + 1;
      while (j < s.length && s[j] !== '"') { if (s[j] === '\\' && j + 1 < s.length) j++; cur.text += s[j]; j++; }
      i = j;
    } else if (c === '\\' && i + 1 < s.length && /[\s'"\\;&|()<>]/.test(s[i + 1])) {
      cur = cur || { text: '', glob: false };
      cur.text += s[i + 1];
      i++;
    } else if (c === '#' && !cur) {
      const j = s.indexOf('\n', i); // 語の頭の # から行の終わりまでは注釈
      i = (j < 0 ? s.length : j) - 1;
    } else if (/\s/.test(c)) {
      if (c === '\n') end(); else push();
    } else if (/[;&|()]/.test(c)) {
      end();
    } else if (c === '<' || c === '>') {
      push(); // リダイレクトの先は次の語として残す
    } else {
      cur = cur || { text: '', glob: false };
      if (/[*?[{]/.test(c)) cur.glob = true;
      cur.text += c;
    }
  }
  end();
  return cmds;
}

const cmdName = (w) => path.posix.basename(slash(w)).toLowerCase().replace(/\.exe$/, '');

const WRAPPERS = new Set(['sudo', 'env', 'time', 'nice', 'nohup', 'command', 'builtin', 'exec', 'timeout', 'stdbuf', 'ionice', 'doas', 'strace', 'chronic']);
const STDIN_RUNNERS = new Set(['xargs', 'parallel', 'foreach-object', '%', 'invoke-expression', 'iex']);
const INTERP = {
  node: ['-e', '--eval', '-p', '--print'], nodejs: ['-e', '--eval', '-p', '--print'], deno: ['eval'], bun: ['-e', '--eval', '-p', '--print'],
  python: ['-c'], python3: ['-c'], py: ['-c'], perl: ['-e', '-E'], ruby: ['-e'], php: ['-r'],
  bash: ['-c'], sh: ['-c'], zsh: ['-c'], dash: ['-c'], ksh: ['-c'], fish: ['-c'],
  pwsh: ['-command', '-c', '-encodedcommand', '-ec', '-e'], powershell: ['-command', '-c', '-encodedcommand', '-ec', '-e'],
  cmd: ['/c', '/k'], osascript: ['-e'], tsx: ['-e'], 'ts-node': ['-e'],
};
const SCRIPT_EXT = /\.(m?js|cjs|ts|mts|cts|py|sh|bash|zsh|ps1|psm1|rb|pl|php|bat|cmd|lua|r|jl|awk)$/i;
// ファイルの読み取り・一覧・別のコマンドの起動・その場のコードの実行の関数(スクリプトの中身・書く中身で探す。シェルのスクリプトはコマンドとして読む)
export const READ_API = /readFile|createReadStream|readdir|opendir|openSync|\bfs\.|node:fs|['"]fs['"]|\bopen\s*\(|ReadAll(Text|Lines|Bytes)|StreamReader|Get-Content|Get-ChildItem|Select-String|child_process|execSync|execFile|spawn|\bexec\s*\(|\beval\s*\(|subprocess|os\.system|popen|\bglob\b|os\.walk|scandir|listdir|pathlib|Deno\.(read|open|run|Command)|Bun\.(file|spawn|\$)|File\.(read|open|foreach)|IO\.(read|foreach|popen)|getline|import\s*\(|require\s*\(\s*[^'"\s]/;
const SHELL_EXT = /\.(sh|bash|zsh|ps1|psm1|bat|cmd)$/i;

// このフックを配ったプラグインのフォルダ(スクリプトを中身を見ずに通す所)。プラグインでないときは null
export function trustedRoot(env = process.env) {
  if (env.CLAUDE_PLUGIN_ROOT) return slash(path.resolve(env.CLAUDE_PLUGIN_ROOT));
  const here = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  return fs.existsSync(path.join(here, '.claude-plugin', 'plugin.json')) ? slash(here) : null;
}

function insideDir(abs, dir) {
  const rel = path.posix.relative(dir, abs);
  return rel === '' || (!rel.startsWith('..') && !path.posix.isAbsolute(rel));
}

// 再帰の検索・一覧・写しの道具か(作業フォルダの下の raw/ まで降りる)
function isRecursive(name, args) {
  const lower = args.map((a) => a.toLowerCase());
  const flag = (re) => args.some((a) => re.test(a));
  switch (name) {
    case 'grep': case 'egrep': case 'fgrep': case 'zgrep':
      return flag(/^-[a-zA-Z]*[rR][a-zA-Z]*$/) || flag(/^--(recursive|dereference-recursive|directories=recurse)$/) || (lower.includes('-d') && lower.includes('recurse'));
    case 'rg': case 'ag': case 'ack': case 'ack-grep': case 'find': case 'fd': case 'fdfind': case 'tree': case 'du': case 'tar': case 'zip': case '7z': case 'rsync': case 'scp':
      return true;
    case 'ls': case 'dir': case 'get-childitem': case 'gci':
      return flag(/^-[a-zA-Z]*R[a-zA-Z]*$/) || lower.some((a) => ['-recurse', '-r', '-s', '/s', '-depth'].includes(a) || a.startsWith('-recurse'));
    case 'cp': case 'copy-item': case 'robocopy': case 'xcopy':
      return flag(/^-[a-zA-Z]*[rRa][a-zA-Z]*$/) || lower.some((a) => ['--recursive', '--archive', '-recurse', '/s', '/e', '/mir'].includes(a));
    case 'select-string': case 'sls': case 'findstr':
      return lower.some((a) => ['/s', '-recurse'].includes(a));
    case 'git':
      return lower[0] === 'grep' && lower.some((a) => ['--no-index', '--untracked'].includes(a));
    default:
      return false;
  }
}

// 検索の道具の、探す型(パターン)を除いた残りの語(パスの候補)
function pathCandidates(name, args) {
  const nonOpt = args.filter((a) => !a.startsWith('-') && !(a.startsWith('/') && a.length <= 3 && /^\/[a-z]$/i.test(a)));
  if (['grep', 'egrep', 'fgrep', 'zgrep', 'rg', 'ag', 'ack', 'ack-grep', 'fd', 'fdfind', 'findstr'].includes(name)) {
    const hasPatOpt = args.some((a) => /^(-e|-f|--regexp|--file)(=|$)/.test(a) || /^-[a-zA-Z]*e$/.test(a));
    return hasPatOpt ? nonOpt : nonOpt.slice(1);
  }
  if (name === 'git') return nonOpt.slice(2);
  if (name === 'find') {
    const out = [];
    for (const a of args) { if (a.startsWith('-') || a === '(' || a === '!') break; out.push(a); }
    return out;
  }
  return nonOpt;
}

const HUMAN = '人が中身を確かめて、必要なら自分の端末で実行してください。';
const REASON_TOOL = 'raw/ の生のファイルは読めません(個人情報が入っているため)。置き換えた後の中身は MCP の道具 masked-files の read_masked で読んでください。';

const block = (reason) => ({ block: true, reason });
const pass = () => ({ block: false });

// Bash のコマンドの中の raw/ の指定(cat raw/a.txt、"./raw/a.txt"、C:\work\raw\a.txt など)。大文字・小文字は区別しない
const RAW_IN_COMMAND = /(^|[\s'"=(:;|&<>/\\`])raw([/\\]|(?=[\s'";|&)<>`]|$))/i;

// 変数・コマンドの置き換え・エスケープの形(どのファイルを読むか、文字からは分からない)。よく使う変数は除く
const SAFE_VARS = new Set(['HOME', 'PWD', 'TMPDIR', 'CLAUDE_PLUGIN_ROOT', 'CLAUDE_PROJECT_DIR', 'CLAUDE_PLUGIN_DATA']);
function dynamicPart(cmd) {
  if (/\$'/.test(String(cmd))) return 'エスケープ($\'…\')';
  const s = String(cmd).replace(/'[^']*'/g, "''"); // 一重の引用符の中は置き換えられない
  if (/\$\(|`|<\(|>\(/.test(s)) return 'コマンドの置き換え';
  for (const m of s.matchAll(/\$\{?([A-Za-z_][A-Za-z0-9_:]*)/g)) {
    if (!SAFE_VARS.has(m[1])) return '変数($' + m[1] + ')';
  }
  return null;
}

function expandVars(s, env) {
  return String(s).replace(/\$\{?(HOME|PWD|TMPDIR|CLAUDE_PLUGIN_ROOT|CLAUDE_PROJECT_DIR|CLAUDE_PLUGIN_DATA)\}?/g, (m, k) => env[k] ?? m);
}

// 書いたスクリプトの中身が、ファイルを読む・別のコマンドを起こす形か。シェルのスクリプトは中身をコマンドとして判断する
function scriptLooksReading(abs, here, env, depth) {
  let st;
  try { st = fs.statSync(abs); } catch { return 'スクリプトのファイルが見つからない'; }
  if (!st.isFile()) return null;
  if (st.size > 1024 * 1024) return 'スクリプトが大きすぎて中身を確かめられない';
  const text = fs.readFileSync(abs, 'utf8');
  if (RAW_IN_COMMAND.test(text)) return 'スクリプトの中に raw/ の指定がある';
  if (SHELL_EXT.test(abs) || /^#!.*\b(ba|z|da|k)?sh\b/.test(text)) {
    if (depth >= 3) return 'スクリプトが別のスクリプトを深く呼んでいて確かめきれない';
    const r = decideCommand(text, here, env, depth + 1);
    return r.block ? 'シェルのスクリプトの中のコマンドが止める形(' + r.reason.split('ので止めました')[0] + ')' : null;
  }
  if (READ_API.test(text)) return 'スクリプトの中にファイルの読み取り・コマンドの起動がある';
  return null;
}

// Bash・PowerShell のコマンドの判断
export function decideCommand(command, cwd, env = process.env, depth = 0) {
  const cmd = String(command ?? '');
  if (RAW_IN_COMMAND.test(cmd)) return block('コマンドの中に raw/ の指定があるので止めました。' + REASON_TOOL);
  const startCwd = slash(cwd || process.cwd());
  if (!rawWorkspace(startCwd)) return pass();
  if (startCwd.split('/').some(isRawName)) return block('作業フォルダが raw/ の中なので、コマンドを止めました。' + REASON_TOOL);

  const dyn = dynamicPart(cmd);
  if (dyn) return block(`作業フォルダに raw/ があり、コマンドに${dyn}が入っていて、どのファイルを読むか分からないので止めました。` + HUMAN);

  const trust = trustedRoot(env);
  let here = startCwd;
  for (const words of splitCommand(expandVars(cmd, env))) {
    let ws = words.map((w) => ({ ...w, text: slash(w.text) }));
    // 前に付く VAR=値 と、包むだけのコマンド(sudo・env・time など)を外す
    while (ws.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(ws[0].text) || WRAPPERS.has(cmdName(ws[0].text)))) {
      const n = cmdName(ws[0].text);
      ws = ws.slice(1);
      if (n === 'timeout' && ws.length && /^\d/.test(ws[0].text)) ws = ws.slice(1);
      while (ws.length && n !== 'command' && ws[0].text.startsWith('-')) ws = ws.slice(1);
    }
    if (!ws.length) continue;
    const name = cmdName(ws[0].text);
    const args = ws.slice(1).map((w) => w.text);

    // 語ごと: リンクの実体が raw/ を指す・グロブが raw/ に当たる
    for (const w of ws) {
      if (w.glob && globHitsRaw(w.text, here)) return block(`グロブ(${w.text})が raw/ に当たるので止めました。読むファイルを masked/ など raw/ を含まないパスで指定してください。` + REASON_TOOL);
      if (!w.text.startsWith('-') && w.text.length < 4096 && isRawPath(w.text, here)) return block(`「${w.text}」の実体が raw/ を指すので止めました。` + REASON_TOOL);
    }

    if (name === 'cd' || name === 'pushd' || name === 'set-location' || name === 'sl' || name === 'chdir') {
      const to = args.find((a) => !a.startsWith('-'));
      here = to ? resolveAbs(to, here) : (env.HOME ? slash(env.HOME) : here);
      continue;
    }
    if (STDIN_RUNNERS.has(name)) return block(`作業フォルダに raw/ があり、${name} は読むファイルを前のコマンドから受け取るので、どのファイルを読むか分からず止めました。` + HUMAN);
    if (name === 'eval' || name === 'source' || name === '.' || name === 'invoke-command' || name === 'start-process') {
      const target = args[0];
      if ((name === 'source' || name === '.') && target) {
        const why = scriptLooksReading(resolveAbs(target, here), here, env, depth);
        if (why) return block(`作業フォルダに raw/ があり、${why}ので止めました。` + HUMAN);
        continue;
      }
      return block(`作業フォルダに raw/ があり、${name} は何を動かすか文字から分からないので止めました。` + HUMAN);
    }
    if (isRecursive(name, args)) {
      const cands = pathCandidates(name, args);
      const existing = cands.filter((c) => { try { fs.statSync(resolveAbs(c, here)); return true; } catch { return false; } });
      if (!existing.length) return block(`作業フォルダに raw/ があり、${name} が探す場所を指定していない(作業フォルダ全体を探す)ので止めました。探す場所を masked/ など raw/ を含まないフォルダで指定してください。`);
      const bad = existing.find((c) => coversRaw(c, here));
      if (bad) return block(`作業フォルダに raw/ があり、${name} が「${bad}」の下の raw/ まで探すので止めました。探す場所を masked/ など raw/ を含まないフォルダで指定してください。`);
    }
    if (name === 'awk' || name === 'gawk' || name === 'mawk') {
      if (/getline|system\s*\(/.test(args.join(' '))) return block('作業フォルダに raw/ があり、awk のプログラムがファイルを読む・コマンドを起こす形なので止めました。' + HUMAN);
    }

    // スクリプトの実行(node a.mjs、python a.py、bash a.sh、./a.sh、pwsh -File a.ps1)
    let script = null;
    const inline = INTERP[name];
    if (inline) {
      const lower = args.map((a) => a.toLowerCase());
      if (lower.some((a) => inline.includes(a))) return block(`作業フォルダに raw/ があり、${name} にその場のコードを渡す形なので止めました(中身から読むファイルが分からないため)。` + HUMAN);
      const fileIdx = lower.findIndex((a) => a === '-file' || a === '-f');
      if ((name === 'pwsh' || name === 'powershell') && fileIdx >= 0) script = args[fileIdx + 1];
      else script = args.find((a) => !a.startsWith('-'));
      if (!script && name !== 'cmd') return block(`作業フォルダに raw/ があり、${name} がコードを標準入力から読む形なので止めました。` + HUMAN);
    } else if (SCRIPT_EXT.test(ws[0].text) || ws[0].text.startsWith('./') || ws[0].text.startsWith('../')) {
      script = ws[0].text;
    }
    if (script) {
      const abs = resolveAbs(script, here);
      const real = realOf(abs) || abs;
      if (trust && insideDir(real, realOf(trust) || trust)) continue;
      const why = scriptLooksReading(real, here, env, depth);
      if (why) return block(`作業フォルダに raw/ があり、${why}ので止めました(書いたスクリプトから raw/ を読む道を止めるため)。` + HUMAN);
    }
  }
  return pass();
}

// Write・Edit で書く中身(新しい文)
function contentsOf(name, ti) {
  if (name === 'Write') return [ti.content];
  if (name === 'Edit') return [ti.new_string];
  if (name === 'MultiEdit') return (ti.edits || []).map((e) => e?.new_string);
  if (name === 'NotebookEdit') return [ti.new_source];
  return [];
}

// 書く中身に raw/ の読み取りの形があるか(raw/ の指定+スクリプトのファイル、または raw/ の指定+読み取りの関数)
export function contentReadsRaw(filePath, text) {
  const t = String(text ?? '');
  if (!RAW_IN_COMMAND.test(t)) return false;
  return SCRIPT_EXT.test(String(filePath ?? '')) || READ_API.test(t) || /^#!/.test(t);
}

// PreToolUse の判断。input は Claude Code がフックに渡す JSON({ tool_name, tool_input, cwd, ... })
export function decideTool(input, env = process.env) {
  if (!input || typeof input !== 'object') return block('フックの入力が読めないので止めました。');
  const cwd = input.cwd || process.cwd();
  const name = String(input.tool_name || '');
  const ti = input.tool_input || {};
  switch (name) {
    case 'Read':
    case 'Edit':
    case 'MultiEdit':
    case 'Write':
    case 'NotebookEdit':
    case 'NotebookRead': {
      const p = ti.file_path ?? ti.notebook_path ?? ti.path;
      if (isRawPath(p, cwd)) return block(REASON_TOOL);
      if (contentsOf(name, ti).some((c) => contentReadsRaw(p, c))) return block('書く中身に raw/ を読む形があるので止めました(書いたスクリプトから raw/ を読む道を止めるため)。' + HUMAN);
      return pass();
    }
    case 'Grep': {
      if (isRawPath(ti.path, cwd) || isRawPattern(ti.glob)) return block(REASON_TOOL);
      if (ti.glob && globHitsRaw(ti.glob, ti.path ? resolveAbs(ti.path, cwd) : cwd)) return block(REASON_TOOL);
      if (coversRaw(ti.path || '.', cwd)) return block('探す場所の下に raw/ があるので止めました。path に masked/ など raw/ を含まない場所を指定してください。');
      return pass();
    }
    case 'Glob': {
      if (isRawPath(ti.path, cwd) || isRawPattern(ti.pattern)) return block(REASON_TOOL);
      const base = ti.path ? resolveAbs(ti.path, cwd) : slash(cwd);
      const segs = slash(ti.pattern).split('/').filter((s) => s !== '**');
      if (segs.some((s) => hasGlobChars(s) && globSegMatchesRaw(s)) && findRawDirs(base).length) return block('グロブが raw/ に当たるので止めました。' + REASON_TOOL);
      return pass();
    }
    case 'Bash':
    case 'PowerShell':
      return decideCommand(ti.command, cwd, env);
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
    if (isRawPath(m, cwd) || (hasGlobChars(m) && globHitsRaw(m, cwd))) return block('@ で raw/ のファイルを入れようとしたので止めました(個人情報が入っているため)。置き換えた後のファイル(masked/ など)を指定するか、MCP の道具 masked-files の read_masked を使ってください。');
  }
  return pass();
}

export function decide(input, env = process.env) {
  if (input && input.hook_event_name === 'UserPromptSubmit') return decidePrompt(input);
  if (input && typeof input.prompt === 'string' && !input.tool_name) return decidePrompt(input);
  return decideTool(input, env);
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

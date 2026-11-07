#!/usr/bin/env node
// Claude で点検の、画面なしの入口(F35e): Claude Code を claude -p で動かし、プラグイン plugin/ の Skill・道具・反証の係で書類を点検する。
// API の版(tools/claude-check.mjs)と違い、鍵を使わず Claude Code のログインで動く。
//
// 守ること:
// - ANTHROPIC_API_KEY などの鍵は、動かす claude に渡さない(渡すとログインではなく鍵で動くため)
// - 道具は既定で断る(--permission-mode dontAsk)。--allowedTools に挙げた物だけを許す
// - --disallowedTools は raw/ の Read・Edit と WebFetch・WebSearch を断る(フックに重ねる断り。raw/ の読み取りを止める主はフック guard-raw で、Bash などは --allowedTools に無いので断られる)
// - 作業フォルダはプラグインのフォルダと重ねない(plugin/evals の仕込みの一覧を読めないように)
// - 記録(stream-json)は作業フォルダの raw/ の外に新しいファイルで残し、上書きしない。セッションの保存はしない
// - 係の本文も記録に残す(CLAUDE_CODE_FORWARD_SUBAGENT_TEXT)。プラグインか MCP の masked-files の読み込みに失敗した記録は失敗(ok: false)にする
//
// 使い方(コマンド):
//   node scripts/claude-headless.mjs --work <作業フォルダ> [--doc raw/書類.txt]... [--log <記録.jsonl>] [--max-budget-usd 3]
//   作業フォルダには raw/ を置く。答えは標準出力へ、道具の数え上げは標準エラーへ出す
//   --help・-h で使い方。知らない引数は claude を動かさず何も書かずに終了コード 2(F83b9)

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { handleArgs, defaultIo } from './cli.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PLUGIN_DIR = path.join(ROOT, 'plugin');
export const PLUGIN_NAME = 'motouke-navi-guard';
export const READ_MASKED = `mcp__plugin_${PLUGIN_NAME}_masked-files__read_masked`;
export const LIST_MASKED = `mcp__plugin_${PLUGIN_NAME}_masked-files__list_masked`;
export const CHECK_ARTICLES = `mcp__plugin_${PLUGIN_NAME}_masked-files__check_articles`;
export const DEFAULT_BUDGET_USD = 3;

// 鍵を外す環境変数。外さないと claude -p はログインより鍵を優先する
const KEY_VARS = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'];

const posix = (p) => String(p).split(path.sep).join('/');
const isInside = (child, parent) => {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

// 許す道具。プラグインのフォルダの読み取りは点検の Skill のフォルダだけにする
export function allowedTools(pluginDir = PLUGIN_DIR) {
  const skill = `${posix(pluginDir)}/skills/construction-check`;
  return [
    `Skill(${PLUGIN_NAME}:construction-check)`,
    READ_MASKED,
    LIST_MASKED,
    CHECK_ARTICLES,
    `Agent(${PLUGIN_NAME}:refuter)`,
    `Task(${PLUGIN_NAME}:refuter)`, // 2.1.317 の道具の一覧では Task の名前で出るので、両方を挙げる
    `Read(//${skill.replace(/^\/+/, '')}/**)`,
    'Edit(./tmp/**)',
    'Read(./tmp/**)',
  ];
}

export const DISALLOWED_TOOLS = ['Read(./raw/**)', 'Edit(./raw/**)', 'WebFetch', 'WebSearch'];

// docs が空なら raw/ の書類をすべて点検する。-p では聞き返しに答えられないので、質問で止まらないよう頼む
export function buildPrompt(docs = []) {
  const target = docs.length ? docs.join('、') : 'raw/ の書類すべて';
  return `${target} を、Skill construction-check の手順で点検し、法令に照らした抜けや食い違いの候補を、1件ずつ「何が」「どう見えたか」「根拠(法令名・条・項・号と原文の短い抜き書き)」「確かさ」「人がすること」の形で挙げてください。画面なしで動かしているので、質問には答えられません。分からないことは聞き返さず、「判断できない」と書いて進めてください。`;
}

// claude に渡す引数。--allowedTools などは値をいくつも取るので、頼む文は先頭に置き、値の後ろは必ず別の指定にする
export function buildArgs({ prompt, pluginDir = PLUGIN_DIR, maxBudgetUsd = DEFAULT_BUDGET_USD }) {
  return [
    '-p', prompt,
    '--plugin-dir', pluginDir,
    '--permission-mode', 'dontAsk',
    '--allowedTools', ...allowedTools(pluginDir),
    '--disallowedTools', ...DISALLOWED_TOOLS,
    '--output-format', 'stream-json',
    '--verbose', // -p の stream-json に必要
    '--max-budget-usd', String(maxBudgetUsd),
    '--no-session-persistence',
  ];
}

// 鍵を外した環境。道具が raw/ を探す作業フォルダは MASK_ROOT で渡す。
// 係(反証の係)の本文を記録に残すため CLAUDE_CODE_FORWARD_SUBAGENT_TEXT を付ける(公式の headless のページの環境変数。引数の指定にしないのは buildArgs を変えないため)
export function buildEnv(env, work) {
  const out = { ...env, MASK_ROOT: work, CLAUDE_CODE_FORWARD_SUBAGENT_TEXT: '1' };
  for (const k of KEY_VARS) delete out[k];
  return out;
}

export function validateWork(work, pluginDir = PLUGIN_DIR) {
  const w = path.resolve(work);
  if (!fs.existsSync(path.join(w, 'raw'))) throw new Error('作業フォルダに raw/ がありません: ' + w);
  if (isInside(w, pluginDir) || isInside(pluginDir, w)) throw new Error('作業フォルダはプラグインのフォルダと重ねないでください(仕込みの一覧を読めてしまいます)。');
  return w;
}

export function validateDocs(docs, work) {
  return docs.map((d) => {
    if (path.isAbsolute(d)) throw new Error('--doc は作業フォルダからのパスで書いてください: ' + d);
    const norm = posix(path.normalize(d));
    if (!norm.startsWith('raw/')) throw new Error('--doc は raw/ の中のファイルにしてください: ' + d);
    if (!fs.existsSync(path.join(work, norm))) throw new Error('ファイルがありません: ' + d);
    return norm;
  });
}

export function validateLog(log, work) {
  const abs = path.resolve(log);
  if (isInside(abs, path.join(work, 'raw'))) throw new Error('記録は raw/ の外に置いてください: ' + log);
  return abs;
}

// MCP の status(公式 Agent SDK の TypeScript の参照の5つ)。道具が使えない3つは失敗にし、pending は注意だけにする
const MCP_UNUSABLE = new Set(['failed', 'needs-auth', 'disabled']);
const MCP_KNOWN = new Set(['connected', 'pending', ...MCP_UNUSABLE]);
const MASKED_FILES = 'masked-files';

const bump = (counts, name) => { counts[name] = (counts[name] ?? 0) + 1; };

// init の欄。plugin_errors は誤りが無いと欄ごと省かれるので、無ければ []。
// mcp_servers は無ければ null(欄の無い版の記録では確かめない)。配列でなければ要素が無いと読み、黙って通さない
function readInit(init) {
  const errs = init?.plugin_errors;
  const pluginErrors = Array.isArray(errs) ? errs : errs ? [errs] : [];
  const ms = init?.mcp_servers;
  const str = (v) => (typeof v === 'string' ? v : null); // 文字でない名前・状態は無いものとして読む
  const mcpServers = ms == null ? null : (Array.isArray(ms) ? ms : []).map((s) => ({ name: str(s?.name), status: str(s?.status) }));
  // plugins は名前だけを取る(パスは返さない)
  const plugins = Array.isArray(init?.plugins) ? init.plugins.map((p) => (typeof p === 'string' ? p : p?.name)).filter((n) => typeof n === 'string') : null;
  return { plugins, pluginErrors, mcpServers };
}

// 読み込みの失敗(公式の headless のページの「Fail CI when a plugin or MCP server doesn't load」)。failed が true なら ok: false にする
function loadWarnings({ pluginErrors, mcpServers }) {
  const warnings = [];
  let failed = false;
  if (pluginErrors.length) {
    failed = true;
    warnings.push(`プラグインの読み込みに失敗しました(${pluginErrors.map((e) => (typeof e === 'string' ? e : JSON.stringify(e))).join('、')})。`);
  }
  if (!mcpServers) return { warnings, failed };
  const masked = mcpServers.filter((s) => String(s.name ?? '').includes(MASKED_FILES));
  if (!masked.length) {
    failed = true;
    warnings.push(`MCP の ${MASKED_FILES} が読み込まれていません(記録の init の mcp_servers に無い)。`);
  }
  for (const s of masked) {
    const label = `MCP の ${s.name}(status: ${s.status ?? '無し'})`;
    if (MCP_UNUSABLE.has(s.status)) {
      failed = true;
      warnings.push(`${label} が使えない状態でした。`);
    } else if (s.status === 'pending') warnings.push(`${label} は始まりの時点で接続の途中でした。`);
    else if (!MCP_KNOWN.has(s.status)) warnings.push(`${label} の状態が分かりません。`);
  }
  return { warnings, failed };
}

// 記録の文(1行に1つの JSON)から、どの道具・Skill・係を呼んだかを数える。書類の中身は返さない。
// 道具の数は主(parent_tool_use_id が null か無い)と係(null でない)に分けても数える。tools は今までどおり両方の合計
export function summarize(text) {
  const tools = {};
  const mainTools = {};
  const subagentTools = {};
  const skills = [];
  const agents = [];
  let init = null;
  let result = null;
  let badLines = 0;
  const subIds = new Set();
  let subNoId = 0;
  let subagentText = false;
  for (const line of String(text).split('\n')) {
    if (!line.trim()) continue;
    let ev;
    try { ev = JSON.parse(line); } catch { badLines++; continue; }
    if (!ev || typeof ev !== 'object') { badLines++; continue; } // null・数・文字の行は事象ではない
    const sub = ev.parent_tool_use_id != null;
    // init と result は主の行だけから取る。init は始まりの1行目(読み込みの結果はそこに出る)
    if (!sub && ev.type === 'system' && ev.subtype === 'init' && !init) init = ev;
    if (!sub && ev.type === 'result') result = ev;
    if (ev.type !== 'assistant') continue;
    const content = Array.isArray(ev.message?.content) ? ev.message.content : [];
    if (sub) {
      // 1つの message が block ごとの行に分かれて出るので、message の id で数える(id の無い行は1行を1つに数える)
      if (typeof ev.message?.id === 'string') subIds.add(ev.message.id);
      else subNoId++;
      if (content.some((b) => b?.type === 'text' && typeof b.text === 'string' && b.text.trim())) subagentText = true;
    }
    for (const b of content) {
      if (b?.type !== 'tool_use') continue;
      bump(tools, b.name);
      bump(sub ? subagentTools : mainTools, b.name);
      if (b.name === 'Skill' && b.input?.skill) skills.push(String(b.input.skill));
      if ((b.name === 'Agent' || b.name === 'Task') && b.input?.subagent_type) agents.push(String(b.input.subagent_type));
    }
  }
  const apiKeySource = init?.apiKeySource ?? null;
  const { plugins, pluginErrors, mcpServers } = readInit(init);
  const load = loadWarnings({ pluginErrors, mcpServers });
  const denied = (result?.permission_denials ?? []).map((d) => String(d?.tool_name ?? '?'));
  const warnings = [...load.warnings];
  if (!result) warnings.push('終わりの知らせ(result)が記録にありません。途中で止まったおそれがあります。');
  else if (result.is_error) warnings.push(result.subtype && result.subtype !== 'success' ? `失敗で終わりました(${String(result.subtype)})。` : '失敗で終わりました。');
  // 主の会話の呼び出しで見る(係の中の read_masked だけでは、点検した側が書類を読んだことにならない)
  if (!mainTools[READ_MASKED]) warnings.push('read_masked を呼んでいません。書類を読まずに答えたおそれがあります。');
  if (!agents.some((a) => a.endsWith('refuter'))) warnings.push('反証の係 refuter を呼んでいません。');
  if (apiKeySource && apiKeySource !== 'none') warnings.push(`ログインではなく鍵で動いたおそれがあります(apiKeySource: ${String(apiKeySource)})。`);
  if (denied.length) warnings.push(`断られた道具があります: ${[...new Set(denied)].join('、')}`);
  if (badLines) warnings.push(`読めない行が ${badLines} 行ありました。`);
  return {
    tools, mainTools, subagentTools, skills, agents, denied, apiKeySource,
    plugins, pluginErrors, mcpServers,
    // num_turns・duration_ms は公式 Agent SDK の TypeScript の参照の SDKResultMessage の欄。usage は取らない
    numTurns: result?.num_turns ?? null, durationMs: result?.duration_ms ?? null,
    subagentMessages: subIds.size + subNoId, subagentText,
    answer: typeof result?.result === 'string' ? result.result : '',
    ok: Boolean(result) && !result.is_error && !load.failed,
    costUsd: result?.total_cost_usd ?? null,
    warnings,
  };
}

const countsText = (counts) => Object.entries(counts).map(([k, v]) => `${k} ${v}回`).join('、') || '無し';
const orMissing = (v, f) => (v == null ? '記録に無い' : f(v));

// 標準エラーに出す数え上げ(manual の走らせた記録の表の欄に合わせる)。書類の中身は入らない
export function summaryLines(s) {
  const seconds = (ms) => (typeof ms === 'number' ? String(Math.round(ms / 1000)) : String(ms));
  const servers = (list) => list.map((x) => `${x.name ?? '名前なし'} ${x.status ?? '状態なし'}`).join('、') || '無し';
  return [
    '呼んだ道具(主): ' + countsText(s.mainTools),
    '呼んだ道具(係の中): ' + countsText(s.subagentTools),
    'Skill: ' + (s.skills.join('、') || '無し') + ' / 係: ' + (s.agents.join('、') || '無し'),
    `係の本文: ${s.subagentText ? 'あり' : '無し'}(係の message ${s.subagentMessages}件)`,
    `往復: ${orMissing(s.numTurns, String)} / 秒: ${orMissing(s.durationMs, seconds)} / 費用(記録の見積もり): ${orMissing(s.costUsd, (c) => '$' + c)}`,
    'プラグイン: ' + orMissing(s.plugins, (p) => p.join('、') || '無し') + ' / MCP: ' + orMissing(s.mcpServers, servers),
  ];
}

// claude を1回動かし、標準出力をそのまま記録のファイルへ書く。spawnImpl は試験で模したものに差し替える
export async function runHeadless({ work, log, docs = [], maxBudgetUsd = DEFAULT_BUDGET_USD, env = process.env, spawnImpl = spawn, pluginDir = PLUGIN_DIR }) {
  fs.mkdirSync(path.dirname(log), { recursive: true });
  const fd = fs.openSync(log, 'wx', 0o600); // 既にあれば止まる
  const args = buildArgs({ prompt: buildPrompt(docs), pluginDir, maxBudgetUsd });
  const code = await new Promise((resolve, reject) => {
    const child = spawnImpl('claude', args, { cwd: work, env: buildEnv(env, work), stdio: ['ignore', fd, 'inherit'] });
    child.on('error', (e) => reject(e.code === 'ENOENT' ? new Error('claude のコマンドが見つかりません。Claude Code を入れてください。') : e));
    child.on('close', resolve);
  }).finally(() => fs.closeSync(fd));
  return { code, summary: summarize(fs.readFileSync(log, 'utf8')) };
}

// ---- コマンドとして動かすとき ----
export const USAGE_LINE = '使い方: node scripts/claude-headless.mjs --work <作業フォルダ> [--doc raw/書類.txt]... [--log <記録.jsonl>] [--max-budget-usd 3]';
export const USAGE = [
  USAGE_LINE,
  '',
  'Claude Code(claude -p)を画面なしで動かし、プラグイン plugin/ の Skill で書類を点検します。Claude Code のログインで動き、鍵は渡しません。--help では claude を動かしません。',
  '読むもの: 作業フォルダの raw/ の書類(claude が道具を通して、置き換えた後の中身を読みます)',
  '書くもの: 記録のファイル(既定は 作業フォルダ/headless-logs/<日時>.jsonl。既にあれば止まります)。答えは標準出力へ、道具の数え上げは標準エラーへ出します',
  '終わり方: 点検が終われば 0。claude の失敗・記録の注意で失敗にしたとき・止まったときは 1。引数の誤りと --work が無いときは 2',
  '',
  '引数:',
  '  --work 作業フォルダ      raw/ のあるフォルダ。plugin/ と重ねない',
  '  --doc raw/書類.txt       点検する書類。いくつでも書ける。省くと raw/ の書類すべて',
  '  --log 記録.jsonl         記録の置き場所。raw/ の外にする',
  '  --max-budget-usd 3       1回の上限の額。0 より大きい数',
  '  --help, -h               この使い方を出す',
  '',
  '例: node scripts/claude-headless.mjs --work tmp/点検 --doc raw/書類.txt',
].join('\n');

// cli.mjs の readArgs は同じオプションを2回取れないので(--doc はいくつでも書ける)、ここで読み、結果の形だけをそろえる。
// --max-budget-usd の値は - で始まってもよい(負の数は下の決まりで止める)
function parseArgs(argv) {
  if (argv.some((a) => a === '--help' || a === '-h')) return { help: true };
  const out = { work: null, docs: [], log: null, maxBudgetUsd: DEFAULT_BUDGET_USD };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!['--work', '--doc', '--log', '--max-budget-usd'].includes(a)) return { error: '知らない引数: ' + a };
    const v = argv[++i];
    if (v === undefined || (v.startsWith('-') && a !== '--max-budget-usd')) return { error: '値がありません: ' + a };
    if (a === '--work') out.work = v;
    else if (a === '--doc') out.docs.push(v);
    else if (a === '--log') out.log = v;
    else out.maxBudgetUsd = Number(v);
  }
  if (!(out.maxBudgetUsd > 0)) throw new Error('--max-budget-usd は 0 より大きい数にしてください。');
  return out;
}

// 終了コードを返す。run は試験で本物の claude を呼ばないものに差し替える
export async function main(argv, io, run = runHeadless) {
  const args = parseArgs(argv);
  const done = handleArgs(args, io, { usage: USAGE, usageLine: USAGE_LINE });
  if (done !== null) return done;
  if (!args.work) {
    io.log(USAGE_LINE);
    return 2;
  }
  const work = validateWork(args.work);
  const docs = validateDocs(args.docs, work);
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*$/, '');
  const log = validateLog(args.log ?? path.join(work, 'headless-logs', `${stamp}.jsonl`), work);
  const { code, summary: s } = await run({ work, log, docs, maxBudgetUsd: args.maxBudgetUsd });
  if (s.answer) io.log(s.answer);
  io.error('記録: ' + log + '(置き換えた後の書類の中身が入ります。外へ渡さないでください)');
  for (const l of summaryLines(s)) io.error(l);
  for (const w of s.warnings) io.error('注意: ' + w);
  if (code !== 0 || !s.ok) {
    const hint = s.warnings.length ? '上の「注意:」を見てください。' : '';
    io.error(`失敗しました(終了コード ${code})。${hint}ログインしていないときは claude auth login を動かしてください。`);
    return 1;
  }
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2), defaultIo()).then((c) => { process.exitCode = c; }, (e) => { console.error('止まりました: ' + e.message); process.exitCode = 1; });
}

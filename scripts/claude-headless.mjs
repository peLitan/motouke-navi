#!/usr/bin/env node
// Claude で点検の、画面なしの入口(F35e): Claude Code を claude -p で動かし、プラグイン plugin/ の Skill・道具・反証の係で書類を点検する。
// API の版(tools/claude-check.mjs)と違い、鍵を使わず Claude Code のログインで動く。
//
// 守ること:
// - ANTHROPIC_API_KEY などの鍵は、動かす claude に渡さない(渡すとログインではなく鍵で動くため)
// - 道具は既定で断る(--permission-mode dontAsk)。--allowedTools に挙げた物だけを許す
// - raw/ の直接の読み書きは --disallowedTools でも断る(プラグインのフックに重ねる2つ目の守り)
// - 作業フォルダはプラグインのフォルダと重ねない(plugin/evals の仕込みの一覧を読めないように)
// - 記録(stream-json)は作業フォルダの raw/ の外に新しいファイルで残し、上書きしない。セッションの保存はしない
//
// 使い方(コマンド):
//   node scripts/claude-headless.mjs --work <作業フォルダ> [--doc raw/書類.txt]... [--log <記録.jsonl>] [--max-budget-usd 3]
//   作業フォルダには raw/ を置く。答えは標準出力へ、道具の数え上げは標準エラーへ出す

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

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

// 鍵を外した環境。道具が raw/ を探す作業フォルダは MASK_ROOT で渡す
export function buildEnv(env, work) {
  const out = { ...env, MASK_ROOT: work };
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

// 記録の文(1行に1つの JSON)から、どの道具・Skill・係を呼んだかを数える。書類の中身は返さない
export function summarize(text) {
  const tools = {};
  const skills = [];
  const agents = [];
  let apiKeySource = null;
  let result = null;
  let badLines = 0;
  for (const line of String(text).split('\n')) {
    if (!line.trim()) continue;
    let ev;
    try { ev = JSON.parse(line); } catch { badLines++; continue; }
    if (ev.type === 'system' && ev.subtype === 'init') apiKeySource = ev.apiKeySource ?? null;
    if (ev.type === 'result') result = ev;
    if (ev.type !== 'assistant') continue;
    for (const b of ev.message?.content ?? []) {
      if (b?.type !== 'tool_use') continue;
      tools[b.name] = (tools[b.name] ?? 0) + 1;
      if (b.name === 'Skill' && b.input?.skill) skills.push(String(b.input.skill));
      if ((b.name === 'Agent' || b.name === 'Task') && b.input?.subagent_type) agents.push(String(b.input.subagent_type));
    }
  }
  const denied = (result?.permission_denials ?? []).map((d) => String(d?.tool_name ?? '?'));
  const warnings = [];
  if (!result) warnings.push('終わりの知らせ(result)が記録にありません。途中で止まったおそれがあります。');
  else if (result.is_error) warnings.push(result.subtype && result.subtype !== 'success' ? `失敗で終わりました(${String(result.subtype)})。` : '失敗で終わりました。');
  if (!tools[READ_MASKED]) warnings.push('read_masked を呼んでいません。書類を読まずに答えたおそれがあります。');
  if (!agents.some((a) => a.endsWith('refuter'))) warnings.push('反証の係 refuter を呼んでいません。');
  if (apiKeySource && apiKeySource !== 'none') warnings.push(`ログインではなく鍵で動いたおそれがあります(apiKeySource: ${String(apiKeySource)})。`);
  if (denied.length) warnings.push(`断られた道具があります: ${[...new Set(denied)].join('、')}`);
  if (badLines) warnings.push(`読めない行が ${badLines} 行ありました。`);
  return { tools, skills, agents, denied, apiKeySource, answer: typeof result?.result === 'string' ? result.result : '', ok: Boolean(result) && !result.is_error, costUsd: result?.total_cost_usd ?? null, warnings };
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
function parseArgs(argv) {
  const out = { work: null, docs: [], log: null, maxBudgetUsd: DEFAULT_BUDGET_USD };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--work') out.work = argv[++i];
    else if (a === '--doc') out.docs.push(argv[++i]);
    else if (a === '--log') out.log = argv[++i];
    else if (a === '--max-budget-usd') out.maxBudgetUsd = Number(argv[++i]);
    else throw new Error('知らない指定: ' + a);
  }
  if (!(out.maxBudgetUsd > 0)) throw new Error('--max-budget-usd は 0 より大きい数にしてください。');
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.work) {
    console.log('使い方: node scripts/claude-headless.mjs --work <作業フォルダ> [--doc raw/書類.txt]... [--log <記録.jsonl>] [--max-budget-usd 3]');
    process.exitCode = 2;
    return;
  }
  const work = validateWork(args.work);
  const docs = validateDocs(args.docs, work);
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*$/, '');
  const log = validateLog(args.log ?? path.join(work, 'headless-logs', `${stamp}.jsonl`), work);
  const { code, summary: s } = await runHeadless({ work, log, docs, maxBudgetUsd: args.maxBudgetUsd });
  if (s.answer) console.log(s.answer);
  console.error('記録: ' + log + '(置き換えた後の書類の中身が入ります。外へ渡さないでください)');
  console.error('呼んだ道具: ' + (Object.entries(s.tools).map(([k, v]) => `${k} ${v}回`).join('、') || '無し'));
  console.error('Skill: ' + (s.skills.join('、') || '無し') + ' / 係: ' + (s.agents.join('、') || '無し'));
  for (const w of s.warnings) console.error('注意: ' + w);
  if (code !== 0 || !s.ok) {
    console.error(`失敗しました(終了コード ${code})。ログインしていないときは claude auth login を動かしてください。`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error('止まりました: ' + e.message); process.exitCode = 1; });
}

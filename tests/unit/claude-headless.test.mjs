// scripts/claude-headless.mjs の単体の試験(本物の claude は呼ばない。値はすべて架空)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import {
  allowedTools, buildArgs, buildEnv, buildPrompt, summarize, runHeadless, validateWork, validateDocs, validateLog,
  DISALLOWED_TOOLS, PLUGIN_DIR, READ_MASKED, LIST_MASKED,
} from '../../scripts/claude-headless.mjs';
import { decide } from '../../plugin/scripts/guard-raw.mjs';

const valuesOf = (args, flag) => {
  const i = args.indexOf(flag);
  assert.ok(i >= 0, flag);
  const out = [];
  for (let j = i + 1; j < args.length && !args[j].startsWith('--'); j++) out.push(args[j]);
  return out;
};

const TMP = path.resolve('tmp');
const tempDir = () => { fs.mkdirSync(TMP, { recursive: true }); return fs.mkdtempSync(path.join(TMP, 'headless-')); };

const workspace = (t) => {
  const dir = tempDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'raw'));
  fs.writeFileSync(path.join(dir, 'raw', '台帳.txt'), '架空の書類');
  return dir;
};

test('buildArgs: 頼む文を -p の直後に置き、プラグイン・許可・stream-json を渡す', () => {
  const args = buildArgs({ prompt: '点検', pluginDir: '/x/plugin', maxBudgetUsd: 2 });
  assert.deepEqual(args.slice(0, 2), ['-p', '点検']);
  assert.deepEqual(valuesOf(args, '--plugin-dir'), ['/x/plugin']);
  assert.deepEqual(valuesOf(args, '--output-format'), ['stream-json']);
  assert.ok(args.includes('--verbose'));
  assert.deepEqual(valuesOf(args, '--permission-mode'), ['dontAsk']);
  assert.deepEqual(valuesOf(args, '--max-budget-usd'), ['2']);
  assert.deepEqual(valuesOf(args, '--allowedTools'), allowedTools('/x/plugin'));
  assert.deepEqual(valuesOf(args, '--disallowedTools'), DISALLOWED_TOOLS);
  assert.ok(args.includes('--no-session-persistence'));
});

test('allowedTools: 点検に要る物だけで、道具まるごとの許可が無い', () => {
  const tools = allowedTools('/x/plugin');
  for (const t of [READ_MASKED, LIST_MASKED, 'Skill(motouke-navi-guard:construction-check)', 'Agent(motouke-navi-guard:refuter)', 'Task(motouke-navi-guard:refuter)']) assert.ok(tools.includes(t), t);
  for (const bare of ['Bash', 'Read', 'Edit', 'Write', 'Skill', 'Agent', 'Task']) assert.ok(!tools.includes(bare), bare);
  assert.ok(tools.includes('Read(//x/plugin/skills/construction-check/**)'));
  assert.ok(tools.includes('Bash(node /x/plugin/skills/construction-check/scripts/check-articles.mjs *)'));
  assert.ok(!tools.some((t) => t.includes('evals')));
});

test('DISALLOWED_TOOLS: raw/ の直接の読み書きと Web を断る', () => {
  for (const t of ['Read(./raw/**)', 'Edit(./raw/**)', 'WebFetch', 'WebSearch']) assert.ok(DISALLOWED_TOOLS.includes(t), t);
});

test('buildEnv: 鍵を外し、ログインで動くようにする。元の環境は変えない', () => {
  const env = { ANTHROPIC_API_KEY: 'xxxx', ANTHROPIC_AUTH_TOKEN: 'xxxx', PATH: '/bin', MASK_DICT: '/x/d.json' };
  const out = buildEnv(env, '/w');
  assert.ok(!('ANTHROPIC_API_KEY' in out));
  assert.ok(!('ANTHROPIC_AUTH_TOKEN' in out));
  assert.equal(out.MASK_ROOT, '/w');
  assert.equal(out.MASK_DICT, '/x/d.json');
  assert.equal(env.ANTHROPIC_API_KEY, 'xxxx');
});

test('本物のフック: 頼む文と、許した条番号の確かめのコマンドは止まらず、raw/ の Read は止まる', (t) => {
  const cwd = workspace(t);
  const env = { CLAUDE_PLUGIN_ROOT: PLUGIN_DIR };
  for (const prompt of [buildPrompt(), buildPrompt(['raw/台帳.txt'])]) {
    assert.equal(decide({ hook_event_name: 'UserPromptSubmit', prompt, cwd }, env).block, false);
  }
  const command = `node ${PLUGIN_DIR}/skills/construction-check/scripts/check-articles.mjs tmp/指摘.md`;
  assert.equal(decide({ tool_name: 'Bash', tool_input: { command }, cwd }, env).block, false);
  assert.equal(decide({ tool_name: 'Read', tool_input: { file_path: path.join(cwd, 'raw', '台帳.txt') }, cwd }, env).block, true);
});

test('validate: raw/ の無いフォルダ・プラグインと重なるフォルダ・raw/ の外の書類・raw/ の中の記録は止める', (t) => {
  const work = workspace(t);
  const plain = tempDir();
  t.after(() => fs.rmSync(plain, { recursive: true, force: true }));
  assert.equal(validateWork(work), work);
  assert.throws(() => validateWork(plain), /raw/);
  const plugin = path.join(work, 'plugin');
  fs.mkdirSync(path.join(plugin, 'raw'), { recursive: true });
  assert.throws(() => validateWork(plugin, plugin), /重ねない/);
  assert.throws(() => validateWork(work, plugin), /重ねない/);
  assert.deepEqual(validateDocs(['raw/台帳.txt'], work), ['raw/台帳.txt']);
  assert.throws(() => validateDocs(['raw/../秘.txt'], work), /raw/);
  assert.throws(() => validateDocs([path.join(work, 'raw', '台帳.txt')], work), /作業フォルダ/);
  assert.throws(() => validateDocs(['raw/無い.txt'], work), /ありません/);
  assert.throws(() => validateLog(path.join(work, 'raw', 'x.jsonl'), work), /raw/);
});

const line = (o) => JSON.stringify(o);
const use = (name, input = {}) => line({ type: 'assistant', message: { content: [{ type: 'tool_use', name, input }] } });

test('summarize: 道具・Skill・係を数え、記録の中身の文は返さない', () => {
  const s = summarize([
    line({ type: 'system', subtype: 'init', apiKeySource: 'none' }),
    use('Skill', { skill: 'motouke-navi-guard:construction-check' }),
    use(READ_MASKED, { path: 'raw/台帳.txt' }),
    line({ type: 'user', message: { content: [{ type: 'tool_result', content: '〔会社名1〕の台帳' }] } }),
    use('Agent', { subagent_type: 'motouke-navi-guard:refuter' }),
    line({ type: 'result', subtype: 'success', is_error: false, result: '候補', total_cost_usd: 0.5, permission_denials: [] }),
  ].join('\n'));
  assert.equal(s.tools[READ_MASKED], 1);
  assert.deepEqual(s.skills, ['motouke-navi-guard:construction-check']);
  assert.deepEqual(s.agents, ['motouke-navi-guard:refuter']);
  assert.equal(s.answer, '候補');
  assert.equal(s.ok, true);
  assert.deepEqual(s.warnings, []);
  assert.ok(!JSON.stringify(s).includes('会社名1'));
});

test('summarize: 終わりが無い・失敗・鍵・断られた道具・係なしを注意に出す', () => {
  assert.equal(summarize('{壊れた行').ok, false);
  const s = summarize([
    line({ type: 'system', subtype: 'init', apiKeySource: 'ANTHROPIC_API_KEY' }),
    line({ type: 'result', subtype: 'error_max_budget_usd', is_error: true, permission_denials: [{ tool_name: 'Bash' }] }),
  ].join('\n'));
  assert.equal(s.ok, false);
  const all = s.warnings.join('\n');
  for (const w of ['error_max_budget_usd', 'read_masked', 'refuter', '鍵で動いた', 'Bash']) assert.ok(all.includes(w), w);
});

test('runHeadless: 作業フォルダで claude を動かし、記録を残し、鍵を渡さず、上書きしない', async (t) => {
  const work = workspace(t);
  const log = path.join(work, 'logs', 'a.jsonl');
  const calls = [];
  const spawnImpl = (bin, args, opts) => {
    calls.push({ bin, args, opts });
    const child = new EventEmitter();
    fs.writeSync(opts.stdio[1], JSON.stringify({ type: 'result', is_error: false, result: '候補' }) + '\n');
    setImmediate(() => child.emit('close', 0));
    return child;
  };
  const opts = { work, log, docs: ['raw/台帳.txt'], env: { ANTHROPIC_API_KEY: 'xxxx', PATH: '/bin' }, spawnImpl };
  const { code, summary } = await runHeadless(opts);
  assert.equal(code, 0);
  assert.equal(summary.answer, '候補');
  assert.equal(calls[0].bin, 'claude');
  assert.equal(calls[0].opts.cwd, work);
  assert.ok(!('ANTHROPIC_API_KEY' in calls[0].opts.env));
  assert.ok(calls[0].args.includes('stream-json'));
  assert.ok(calls[0].args[1].startsWith('raw/台帳.txt を'));
  assert.ok(fs.readFileSync(log, 'utf8').includes('"type":"result"'));
  await assert.rejects(runHeadless(opts), /EEXIST/);
  assert.equal(calls.length, 1);
});

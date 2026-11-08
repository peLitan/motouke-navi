// scripts/claude-headless.mjs の単体の試験(本物の claude は呼ばない。値はすべて架空)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import {
  allowedTools, buildArgs, buildEnv, buildPrompt, summarize, runHeadless, validateWork, validateDocs, validateLog,
  DISALLOWED_TOOLS, PLUGIN_DIR, READ_MASKED, LIST_MASKED, CHECK_ARTICLES,
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
  for (const t of [READ_MASKED, LIST_MASKED, CHECK_ARTICLES, 'Skill(motouke-navi-guard:construction-check)', 'Agent(motouke-navi-guard:refuter)', 'Task(motouke-navi-guard:refuter)']) assert.ok(tools.includes(t), t);
  for (const bare of ['Bash', 'Read', 'Edit', 'Write', 'Skill', 'Agent', 'Task']) assert.ok(!tools.includes(bare), bare);
  assert.ok(tools.includes('Read(//x/plugin/skills/construction-check/**)'));
  assert.ok(!tools.some((t) => t.startsWith('Bash(')), '条番号の確かめは道具で行うので Bash を許さない');
  assert.ok(!tools.some((t) => t.includes('evals')));
});

// F36c: 断られた件は Skill の手順で直す。許す道具を広げて直していないことを、一覧の全部で見る
test('allowedTools: 許す道具の一覧は決めたとおりで、増えていない', () => {
  assert.deepEqual(allowedTools('/x/plugin'), [
    'Skill(motouke-navi-guard:construction-check)',
    'mcp__plugin_motouke-navi-guard_masked-files__read_masked',
    'mcp__plugin_motouke-navi-guard_masked-files__list_masked',
    'mcp__plugin_motouke-navi-guard_masked-files__check_articles',
    'Agent(motouke-navi-guard:refuter)',
    'Task(motouke-navi-guard:refuter)',
    'Read(//x/plugin/skills/construction-check/**)',
    'Edit(./tmp/**)',
    'Read(./tmp/**)',
  ]);
});

test('SKILL.md: 条番号の確かめは道具 check_articles で行い、Bash の命令の行が無い', () => {
  const skill = fs.readFileSync(path.join(PLUGIN_DIR, 'skills', 'construction-check', 'SKILL.md'), 'utf8');
  const shown = skill.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('node ') && l.includes('check-articles.mjs'));
  assert.deepEqual(shown, []);
  assert.doesNotMatch(skill, /単独で呼ぶ/);
  const steps = /## 手順\n([\s\S]*?)\n## /.exec(skill)[1].split(/^(?=\d+\. )/m);
  const step = (n) => steps.find((p) => p.startsWith(`${n}. `));
  assert.match(step(6), /`check_articles`/);
  assert.match(step(8), /手順 6 の `check_articles` をもう一度呼ぶ/);
  assert.match(step(9), /`check_articles` の結果/);
  assert.doesNotMatch(skill, /スクリプト/);
  // 手順が呼ぶ道具を、画面なしの入口が許している
  assert.ok(allowedTools('/x/plugin').some((t) => t.endsWith('__check_articles')));
});

test('DISALLOWED_TOOLS: raw/ の直接の読み書きと Web を断る', () => {
  assert.deepEqual(DISALLOWED_TOOLS, ['Read(./raw/**)', 'Edit(./raw/**)', 'WebFetch', 'WebSearch']);
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

// ---- F80c: 記録の欄(プラグインと MCP の読み込み・往復と時間・係の本文・主と係の道具の数) ----
// 欄の名前は公式の headless のページと Agent SDK の TypeScript の参照による(作る係は開いていない)。値はすべて架空
import * as headless from '../../scripts/claude-headless.mjs';

const MF = 'plugin:motouke-navi-guard:masked-files'; // 実物の名前は未確認。masked-files を含むかで見る
const initLine = (extra = {}) => line({ type: 'system', subtype: 'init', apiKeySource: 'none', ...extra });
const doneLine = (extra = {}) => line({ type: 'result', subtype: 'success', is_error: false, result: '候補', total_cost_usd: 0.5, permission_denials: [], ...extra });
// 点検が通った記録(read_masked と refuter を呼んでいるので、読み込みのほかの注意は出ない)
const record = (initExtra = {}, resultExtra = {}, more = []) => [
  initLine(initExtra),
  use(READ_MASKED, { path: 'raw/台帳.txt' }),
  use('Agent', { subagent_type: 'motouke-navi-guard:refuter' }),
  ...more,
  doneLine(resultExtra),
].join('\n');
const subLine = (parent, content) => line({ type: 'assistant', parent_tool_use_id: parent, message: { content } });

test('F80c summarize: init に plugin_errors があれば ok: false と注意。無いか空なら [] で注意なし', () => {
  for (const errs of [[{ plugin: 'motouke-navi-guard', error: '架空の読み込みの誤り' }], ['架空の読み込みの誤り']]) {
    const s = summarize(record({ plugin_errors: errs }));
    assert.equal(s.ok, false);
    assert.deepEqual(s.pluginErrors, errs);
    const w = s.warnings.filter((x) => x.includes('プラグインの読み込みに失敗'));
    assert.equal(w.length, 1);
    assert.ok(w[0].includes('架空の読み込みの誤り'));
  }
  for (const extra of [{}, { plugin_errors: [] }]) {
    const s = summarize(record(extra));
    assert.equal(s.ok, true);
    assert.deepEqual(s.pluginErrors, []);
    assert.deepEqual(s.warnings, []);
  }
});

test('F80c summarize: mcp_servers の masked-files が connected なら注意なし、failed・needs-auth・disabled は ok: false', () => {
  const servers = [{ name: MF, status: 'connected' }, { name: '架空の別のサーバー', status: 'failed' }];
  const good = summarize(record({ mcp_servers: servers }));
  assert.equal(good.ok, true);
  assert.deepEqual(good.warnings, [], 'masked-files のほかのサーバーは見ない');
  assert.deepEqual(good.mcpServers, servers);
  for (const status of ['failed', 'needs-auth', 'disabled']) {
    const s = summarize(record({ mcp_servers: [{ name: MF, status }] }));
    assert.equal(s.ok, false, status);
    assert.equal(s.warnings.length, 1, status);
    assert.ok(s.warnings[0].includes(MF) && s.warnings[0].includes(status), status);
  }
  // masked-files を含む要素が2つあり、1つでも使えなければ ok: false
  assert.equal(summarize(record({ mcp_servers: [{ name: MF, status: 'connected' }, { name: 'masked-files', status: 'failed' }] })).ok, false);
});

test('F80c summarize: pending は注意だけで ok は変わらない。masked-files の要素が無ければ ok: false', () => {
  const p = summarize(record({ mcp_servers: [{ name: MF, status: 'pending' }] }));
  assert.equal(p.ok, true);
  assert.equal(p.warnings.length, 1);
  assert.ok(p.warnings[0].includes(MF) && p.warnings[0].includes('pending'));
  // 終わりが失敗なら pending があっても ok: false のまま
  assert.equal(summarize(record({ mcp_servers: [{ name: MF, status: 'pending' }] }, { is_error: true, subtype: 'error_during_execution' })).ok, false);
  for (const servers of [[], [{ name: '架空の別のサーバー', status: 'connected' }]]) {
    const s = summarize(record({ mcp_servers: servers }));
    assert.equal(s.ok, false);
    assert.equal(s.warnings.length, 1);
    assert.ok(s.warnings[0].includes('masked-files'));
  }
  // 配列でない mcp_servers は要素が無いと読む(黙って通さない)
  const odd = summarize(record({ mcp_servers: { name: MF, status: 'connected' } }));
  assert.equal(odd.ok, false);
  assert.deepEqual(odd.mcpServers, []);
});

test('F80c summarize: masked-files の状態が公式の5つのどれでもないときは、注意だけで ok は変わらない', () => {
  for (const extra of [{ status: 'connecting' }, {}]) {
    const s = summarize(record({ mcp_servers: [{ name: MF, ...extra }] }));
    assert.equal(s.ok, true, JSON.stringify(extra));
    assert.equal(s.warnings.length, 1, JSON.stringify(extra));
    assert.ok(s.warnings[0].includes(MF));
  }
});

test('F80c summarize: mcp_servers が無い記録は mcpServers が null で、注意を出さない', () => {
  const s = summarize(record());
  assert.equal(s.mcpServers, null);
  assert.equal(s.ok, true);
  assert.deepEqual(s.warnings, []);
  // init の無い記録も同じ
  const t = summarize([use(READ_MASKED), use('Agent', { subagent_type: 'motouke-navi-guard:refuter' }), doneLine()].join('\n'));
  assert.equal(t.mcpServers, null);
  assert.deepEqual(t.pluginErrors, []);
  assert.equal(t.plugins, null);
  assert.equal(t.ok, true);
  assert.deepEqual(t.warnings, []);
});

test('F80c summarize: init の plugins から名前だけを取る(パスは返さない)', () => {
  const s = summarize(record({ plugins: [{ name: 'motouke-navi-guard', path: '/x/架空/plugin' }] }));
  assert.deepEqual(s.plugins, ['motouke-navi-guard']);
  assert.ok(!JSON.stringify(s).includes('/x/架空/plugin'));
  assert.deepEqual(summarize(record({ plugins: ['motouke-navi-guard'] })).plugins, ['motouke-navi-guard']);
  assert.deepEqual(summarize(record({ plugins: [] })).plugins, []);
  assert.equal(summarize(record()).plugins, null);
});

test('F80c summarize: result の num_turns・duration_ms を取る。無ければ null', () => {
  const s = summarize(record({}, { num_turns: 37, duration_ms: 526000 }));
  assert.equal(s.numTurns, 37);
  assert.equal(s.durationMs, 526000);
  const t = summarize(record());
  assert.equal(t.numTurns, null);
  assert.equal(t.durationMs, null);
  assert.equal(summarize('{壊れた行').numTurns, null);
});

test('F80c summarize: parent_tool_use_id のある assistant を係として本文の有無と数を取り、道具の数を主と係で分ける', () => {
  const s = summarize(record({}, {}, [
    line({ type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'tool_use', name: READ_MASKED, input: {} }, { type: 'text', text: '主の架空の文' }] } }),
    subLine('toolu_架空1', [{ type: 'tool_use', name: READ_MASKED, input: { path: 'raw/台帳.txt' } }]),
    line({ type: 'user', parent_tool_use_id: 'toolu_架空1', message: { content: [{ type: 'tool_result', content: '〔会社名1〕の台帳' }] } }),
    subLine('toolu_架空1', [{ type: 'tool_use', name: CHECK_ARTICLES, input: {} }]),
    subLine('toolu_架空1', [{ type: 'text', text: '係の架空の本文: 残る 1・崩れた 0・確かめられない 0' }]),
  ]));
  assert.deepEqual(s.mainTools, { [READ_MASKED]: 2, Agent: 1 });
  assert.deepEqual(s.subagentTools, { [READ_MASKED]: 1, [CHECK_ARTICLES]: 1 });
  assert.equal(s.tools[READ_MASKED], 3, 'tools は今までどおり全部の数');
  assert.equal(s.subagentMessages, 3);
  assert.equal(s.subagentText, true);
  assert.deepEqual(s.warnings, []);
  const json = JSON.stringify(s);
  for (const t of ['会社名1', '係の架空の本文', '主の架空の文']) assert.ok(!json.includes(t), t);
});

test('F80c summarize: 係の message に本文が無いとき・係が無いときは、係の本文なし', () => {
  const toolsOnly = summarize(record({}, {}, [
    subLine('toolu_架空2', [{ type: 'tool_use', name: READ_MASKED, input: {} }]),
    subLine('toolu_架空2', [{ type: 'text', text: '  ' }]),
  ]));
  assert.equal(toolsOnly.subagentMessages, 2);
  assert.equal(toolsOnly.subagentText, false);
  const none = summarize(record({}, {}, [line({ type: 'assistant', message: { content: [{ type: 'text', text: '主の架空の文' }] } })]));
  assert.equal(none.subagentMessages, 0);
  assert.equal(none.subagentText, false);
  assert.deepEqual(none.subagentTools, {});
});

test('F80c summarize: 事象でない行(null・数・文字)で止まらず、読めない行に数える', () => {
  const s = summarize(['null', '5', '"x"', record()].join('\n'));
  assert.equal(s.ok, true);
  assert.ok(s.warnings.some((w) => w.includes('読めない行が 3 行')));
});

test('F80c buildEnv: 係の本文を記録に残す CLAUDE_CODE_FORWARD_SUBAGENT_TEXT を 1 にし、元の環境は変えない', () => {
  const env = { ANTHROPIC_API_KEY: 'xxxx', PATH: '/bin' };
  const out = buildEnv(env, '/w');
  assert.equal(out.CLAUDE_CODE_FORWARD_SUBAGENT_TEXT, '1');
  assert.ok(!('CLAUDE_CODE_FORWARD_SUBAGENT_TEXT' in env));
  assert.ok(!('ANTHROPIC_API_KEY' in out));
  assert.equal(out.MASK_ROOT, '/w');
  assert.equal(buildEnv({ CLAUDE_CODE_FORWARD_SUBAGENT_TEXT: '0' }, '/w').CLAUDE_CODE_FORWARD_SUBAGENT_TEXT, '1');
});

test('F80c runHeadless: 動かす claude の環境に CLAUDE_CODE_FORWARD_SUBAGENT_TEXT があり、引数は buildArgs のまま', async (t) => {
  const work = workspace(t);
  let seen;
  const spawnImpl = (bin, args, opts) => {
    seen = { args, opts };
    const child = new EventEmitter();
    setImmediate(() => child.emit('close', 0));
    return child;
  };
  await runHeadless({ work, log: path.join(work, 'logs', 'b.jsonl'), env: { PATH: '/bin' }, spawnImpl });
  assert.equal(seen.opts.env.CLAUDE_CODE_FORWARD_SUBAGENT_TEXT, '1');
  assert.deepEqual(seen.args, buildArgs({ prompt: buildPrompt([]), pluginDir: PLUGIN_DIR }));
  assert.ok(!seen.args.some((a) => a.includes('forward-subagent')));
});

test('F80c summaryLines: 標準エラーの数え上げに主と係の道具・係の本文・往復と秒と費用・プラグインと MCP を出す', () => {
  assert.equal(typeof headless.summaryLines, 'function');
  const s = summarize(record(
    { plugins: [{ name: 'motouke-navi-guard', path: '/x' }], mcp_servers: [{ name: MF, status: 'connected' }] },
    { num_turns: 37, duration_ms: 526400 },
    [subLine('toolu_架空3', [{ type: 'tool_use', name: READ_MASKED, input: {} }, { type: 'tool_use', name: CHECK_ARTICLES, input: {} }, { type: 'text', text: '係の架空の文' }])],
  ));
  const lines = headless.summaryLines(s);
  assert.ok(lines.includes(`呼んだ道具(主): ${READ_MASKED} 1回、Agent 1回`), lines.join('\n'));
  assert.ok(lines.includes(`呼んだ道具(係の中): ${READ_MASKED} 1回、${CHECK_ARTICLES} 1回`), lines.join('\n'));
  const text = lines.join('\n');
  assert.match(text, /係の本文: あり/);
  assert.match(text, /往復: 37 /);
  assert.match(text, /秒: 526 /);
  assert.match(text, /費用\(記録の見積もり\): \$0\.5/);
  assert.ok(text.includes('プラグイン: motouke-navi-guard'));
  assert.ok(text.includes(`${MF} connected`));
  assert.ok(!text.includes('係の架空の文'));
  // 欄の無い記録でも止まらない
  const empty = headless.summaryLines(summarize(''));
  assert.ok(empty.every((l) => typeof l === 'string'));
  assert.match(empty.join('\n'), /呼んだ道具\(係の中\): 無し/);
  assert.match(empty.join('\n'), /往復: 記録に無い/);
  assert.match(empty.join('\n'), /MCP: 記録に無い/);
});

test('F80c 文書: コメント・manual の走らせた記録の見出しと参照と表の枠・公式の2行・出典・CHANGELOG が今の動きに合う', () => {
  const src = fs.readFileSync(path.resolve('scripts/claude-headless.mjs'), 'utf8');
  assert.ok(!src.includes('2つ目の守り'));
  assert.match(src, /^\/\/ .*--disallowedTools.*guard-raw/m, '断りの主はフック guard-raw と書く');
  const manual = fs.readFileSync(path.resolve('docs/manual.md'), 'utf8');
  const heads = [...manual.matchAll(/^\*\*(走らせた記録\([^*]*\))\*\*/gm)].map((m) => m[1]);
  assert.equal(heads.length, 1);
  const head = heads[0];
  assert.ok(!head.includes('今の版'));
  assert.ok(head.includes('2026-11-05') && head.includes('版 156b15c'));
  assert.ok(head.includes('F56a で替えた後の版の走らせは、下の表'));
  assert.ok(!manual.includes('走らせた記録(今の版'));
  assert.ok(!manual.includes('今の版の回'));
  assert.ok(manual.includes(`上の「${head}」にある`), '参照が見出しと同じ');
  // 表の枠: 見出しの行と区切りの行の次に、値の行が1行(値は manual-run-1107.test.mjs が見る)
  const lines = manual.split('\n');
  const i = lines.findIndex((l) => l.startsWith('| 版 | 日時 | 往復 | 秒 | 費用 |'));
  assert.ok(i > lines.findIndex((l) => l.startsWith(`**${head}**`)));
  assert.deepEqual(lines[i].split('|').slice(1, -1).map((c) => c.trim()), ['版', '日時', '往復', '秒', '費用', '道具の呼び出し(主と係を分けて名前ごと)', '断られた道具', '係の本文の有無', 'plugin_errors', 'mcp_servers', 'Stop の催促']);
  assert.match(lines[i + 1], /^\|(---\|){11}$/);
  assert.ok(lines[i + 2].startsWith('| 17b7bc2 |'), '値の行は走らせた版');
  assert.ok(!lines[i + 3].startsWith('|'), '値の行は1行');
  // 画面なしの入口の節に公式の2行
  const section = manual.split('## Claude で点検(画面なしの Claude Code)')[1].split('\n## ')[0];
  const rows = section.split('\n');
  assert.equal(rows.filter((l) => l.includes('CLAUDE_CODE_FORWARD_SUBAGENT_TEXT') && l.includes('Follow subagent messages')).length, 1);
  assert.equal(rows.filter((l) => l.includes("Fail CI when a plugin or MCP server doesn't load") && l.includes('plugin_errors') && l.includes('mcp_servers') && l.includes('ok: false')).length, 1);
  const readme = fs.readFileSync(path.resolve('docs/details.md'), 'utf8');
  for (const u of ['https://code.claude.com/docs/en/headless', 'https://code.claude.com/docs/en/agent-sdk/typescript']) assert.ok(readme.includes(u), u);
  assert.match(fs.readFileSync(path.resolve('CHANGELOG.md'), 'utf8'), /^- F80c: /m);
});

test('F80c 直し: read_masked の注意は主の呼び出しで見る。init と result は主の行だけ、init は最初の1行', () => {
  const subOnly = summarize([initLine(), use('Agent', { subagent_type: 'motouke-navi-guard:refuter' }), subLine('toolu_架空4', [{ type: 'tool_use', name: READ_MASKED, input: {} }]), doneLine()].join('\n'));
  assert.ok(subOnly.warnings.some((w) => w.includes('read_masked')));
  const twoInits = summarize([initLine({ plugin_errors: ['架空の誤り'] }), initLine(), use(READ_MASKED), use('Agent', { subagent_type: 'motouke-navi-guard:refuter' }), doneLine()].join('\n'));
  assert.equal(twoInits.ok, false);
  const subInit = summarize([initLine({ mcp_servers: [{ name: MF, status: 'connected' }] }), line({ type: 'system', subtype: 'init', parent_tool_use_id: 'toolu_架空5', mcp_servers: [{ name: MF, status: 'failed' }] }), use(READ_MASKED), use('Agent', { subagent_type: 'motouke-navi-guard:refuter' }), doneLine()].join('\n'));
  assert.equal(subInit.ok, true);
  assert.deepEqual(subInit.mcpServers, [{ name: MF, status: 'connected' }]);
});

test('F80c 直し: 係の message は id で数え、文字でない name・status で止まらない', () => {
  const s = summarize(record({}, {}, [
    line({ type: 'assistant', parent_tool_use_id: 'toolu_架空6', message: { id: 'msg_架空1', content: [{ type: 'tool_use', name: READ_MASKED, input: {} }] } }),
    line({ type: 'assistant', parent_tool_use_id: 'toolu_架空6', message: { id: 'msg_架空1', content: [{ type: 'text', text: '係の架空の文' }] } }),
  ]));
  assert.equal(s.subagentMessages, 1);
  assert.equal(s.subagentText, true);
  const odd = summarize(record({ mcp_servers: [{ name: { toString: 1 }, status: { toString: 1 } }] }));
  assert.equal(odd.ok, false);
  assert.deepEqual(odd.mcpServers, [{ name: null, status: null }]);
});

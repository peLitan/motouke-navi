// F56b の単体の試験: 手順6・7 の抜けを Stop で1回催促するフックの判断。記録はすべて架空
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decide, REMINDER, REMINDER_NO_AGENT } from '../../plugin/skills/construction-check/scripts/check-done.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TMP = path.join(ROOT, 'tmp', 'f56b-check-done');

const PLUGIN_TOOL = 'mcp__plugin_motouke-navi-guard_masked-files__read_masked';
const PROJECT_TOOL = 'mcp__masked-files__read_masked';
const COUNTS = '元の18件のうち 残る 15・崩れた 2・確かめられない 1';

const said = (text) => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text }] } });
const called = (name) => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'x', name, input: { path: 'raw/a.txt' } }] } });
const user = (text) => JSON.stringify({ type: 'user', message: { content: text } });
const lines = (...l) => l.join('\n') + '\n';

// 合成の記録を tmp/ の下に書き、既定の読み方で decide に渡す
function withTranscript(text, fn) {
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(TMP, { recursive: true });
  const file = path.join(TMP, 'transcript.jsonl');
  fs.writeFileSync(file, text);
  try {
    return fn(file);
  } finally {
    fs.rmSync(TMP, { recursive: true, force: true });
  }
}

const run = (transcript, message, extra = {}) => withTranscript(transcript, (file) => decide({
  hook_event_name: 'Stop',
  stop_hook_active: false,
  transcript_path: file,
  last_assistant_message: message,
  ...extra,
}));

const READ = lines(user('台帳を点検して'), called(PLUGIN_TOOL), said('読みました'));

test('記録に read_masked が無い(読み込みの前の停止)→ 何もしない', () => {
  assert.equal(run(lines(user('台帳を点検して'), said('どの書類ですか')), 'どの書類を点検しますか'), null);
});

test('read_masked があり最後の返事に数が無い → 催促する。形は additionalContext で decision が無い', () => {
  const out = run(READ, '指摘を3件書きました。');
  assert.deepEqual(Object.keys(out), ['hookSpecificOutput']);
  assert.deepEqual(out, { hookSpecificOutput: { hookEventName: 'Stop', additionalContext: REMINDER } });
  assert.equal(out.decision, undefined);
  for (const w of ['check_articles', 'refuter', '残る', '崩れた', '確かめられない', '反証の見直しをしていない']) assert.ok(REMINDER.includes(w), w);
});

test('read_masked と係(Agent)の呼び出しがあり、最後の返事に係の結果の数がある → 何もしない', () => {
  for (const message of [
    COUNTS,
    '係の結果: 残る: 15件 / 崩れた: 0件 / 確かめられない: 1件',
    '| 残る | 15 |\n| 崩れた | 2 |\n| 確かめられない | 1 |',
    '**残る** 3、**崩れた** 0、**確かめられない** 0',
    '15件が残る、2件が崩れた、1件は確かめられない',
    '残る １５・崩れた ２・確かめられない ０',
  ]) assert.equal(run(READ + lines(agentCall('Agent')), message), null, message);
});

test('「反証の見直しをしていない」がある → 何もしない', () => {
  assert.equal(run(READ, '係を呼べなかったので、反証の見直しをしていない。指摘は3件です。'), null);
});

test('stop_hook_active が true → 何もしない(記録を読まない)', () => {
  const input = { stop_hook_active: true, transcript_path: 'x', last_assistant_message: '指摘を3件書きました。' };
  assert.equal(decide(input, () => { throw new Error('読まない'); }), null);
  assert.equal(run(READ, '指摘を3件書きました。', { stop_hook_active: true }), null);
});

test('壊れた入力・読めない記録 → 何もしない', () => {
  const ok = { transcript_path: 'x', last_assistant_message: '指摘を3件書きました。' };
  const read = () => READ;
  assert.ok(decide(ok, read), '壊していない入力は催促する');
  for (const input of [null, undefined, 'x', 42, [], {}, { ...ok, transcript_path: undefined }, { ...ok, transcript_path: 3 }, { ...ok, last_assistant_message: undefined }, { ...ok, last_assistant_message: null }]) {
    assert.equal(decide(input, read), null, JSON.stringify(input));
  }
  assert.equal(decide(ok, () => { throw new Error('読めない'); }), null);
  assert.equal(decide({ ...ok, transcript_path: path.join(TMP, '無いファイル.jsonl') }), null);
  for (const broken of ['', 'JSON ではない文\n{"type":', '[]\nnull\n3\n"x"\n', lines('{"type":"assistant"}', '{"type":"assistant","message":{"content":"read_masked"}}')]) {
    assert.equal(run(broken, '指摘を3件書きました。'), null, broken);
  }
});

test('道具の名前は終わりで見る: プラグインとプロジェクトの両方を読み、ほかの名前や文の中の語は数えない', () => {
  assert.ok(run(lines(called(PROJECT_TOOL)), '指摘を書きました'));
  assert.ok(run(lines(called(PLUGIN_TOOL)), '指摘を書きました'));
  for (const transcript of [
    lines(called('mcp__masked-files__read_masked_old')),
    lines(called('mcp__masked-files__list_masked')),
    lines(called('read_masked')),
    lines(user(`${PLUGIN_TOOL} を使って`)),
    lines(said(`${PLUGIN_TOOL} で読みます`)),
    lines(JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_use', name: PLUGIN_TOOL }] } })),
    lines(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', name: PLUGIN_TOOL, text: '読みます' }] } })),
  ]) assert.equal(run(transcript, '指摘を書きました'), null, transcript);
});

test('書きかけの行が混ざっても、読める行で判断する。read_masked が前の方にあっても見つける', () => {
  const half = called(PLUGIN_TOOL).slice(0, 30);
  assert.ok(run(lines(called(PLUGIN_TOOL), said('続きです'), half), '指摘を書きました'));
  assert.equal(run(lines(said('続きです'), half), '指摘を書きました'), null);
  assert.ok(run(lines(half, '', called(PLUGIN_TOOL)), '指摘を書きました'), '壊れた行のあとの呼び出しも見る');
  const many = Array.from({ length: 200 }, (_, i) => said(`途中の文 ${i}`));
  assert.ok(run(lines(called(PLUGIN_TOOL), ...many), '指摘を書きました'));
  // 1行に道具がいくつか並ぶときも見る
  const both = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: '読みます' }, { type: 'tool_use', name: 'Read' }, { type: 'tool_use', name: PROJECT_TOOL }] } });
  assert.ok(run(lines(both), '指摘を書きました'));
});

test('手順6 の結果だけでは通さない: 3語の数がそろって手順7 の結果と読む', () => {
  for (const message of [
    '条番号は ある 5・無い 0・確かめられない 1 でした。',
    '残る 15・崩れた 2',
    '残る・崩れた・確かめられないで返します。',
    '手順は残る。崩れた所は無い。確かめられない所も無い。',
    '書類に 15 件の下請けがあります。',
  ]) assert.ok(run(READ, message), message);
});

test('数を見るのは最後の返事だけ: 記録の途中の文に数があっても、最後の返事に無ければ催促する', () => {
  assert.ok(run(lines(called(PLUGIN_TOOL), said(COUNTS)), 'お疲れさまでした。'));
});

test('文書: overview の表に4列の1行、manual に限界がある。check-done について言い切りの語を書かない', () => {
  const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const rows = read('docs/overview.md').split('\n').filter((l) => l.startsWith('| hook `check-done`'));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].split(' | ').length, 4);
  const manual = read('docs/manual.md');
  const section = manual.split('### 手順の抜けの催促の限界')[1].split('\n## ')[0];
  for (const w of ['一度だけの催促', '記録の遅れ', '8回', 'stop_hook_active']) assert.ok(section.includes(w), w);
  const item = manual.split('\n').filter((l) => l.includes('scripts/check-done.mjs'));
  assert.equal(item.length, 1);
  const script = read('plugin/skills/construction-check/scripts/check-done.mjs');
  for (const text of [rows[0], section, item[0], script, REMINDER]) assert.doesNotMatch(text, /必ず|保証/);
});

// F80a: 係(refuter)の呼び出しも見る。記録の1行は Claude Code の記録の形を模した架空の物
function agentCall(name, input = { description: '候補の見直し', prompt: '候補を1件ずつ崩しにかかってください', subagent_type: 'motouke-navi-guard:refuter' }) {
  return JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'y', name, input }] } });
}
const remindWith = (text) => ({ hookSpecificOutput: { hookEventName: 'Stop', additionalContext: text } });
const NO_COUNTS = '指摘を3件書きました。';

test('F80a: 係を Agent か Task で呼んだ記録 + 3語の数 → 何もしない。係の名前の形と記録の中の位置を問わない', () => {
  for (const name of ['Agent', 'Task']) {
    assert.equal(run(READ + lines(agentCall(name)), COUNTS), null, name);
    assert.equal(run(READ + lines(agentCall(name, { subagent_type: 'refuter', prompt: '見直して' })), COUNTS), null, `${name} プロジェクトの係`);
    assert.equal(run(READ + lines(agentCall(name, { prompt: 'refuter として候補を崩して' })), COUNTS), null, `${name} 頼む文の中の語`);
    assert.equal(run(lines(agentCall(name), called(PROJECT_TOOL)), COUNTS), null, `${name} read_masked より前の呼び出し`);
    assert.equal(run(READ + lines(agentCall(name, { description: 'refuter の見直し', prompt: '候補を崩して', subagent_type: 'general-purpose' })), COUNTS), null, `${name} description の語`);
  }
  // 1行に道具がいくつか並ぶときも見る
  const both = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: '見直します' }, { type: 'tool_use', name: 'Agent', input: { subagent_type: 'motouke-navi-guard:refuter' } }] } });
  assert.equal(run(READ + lines(both), COUNTS), null);
});

test('F80a: read_masked はあるが係の呼び出しが無い記録 + 3語の数 → REMINDER_NO_AGENT を additionalContext で返す。decision は無い', () => {
  const out = run(READ, COUNTS);
  assert.deepEqual(out, remindWith(REMINDER_NO_AGENT));
  assert.deepEqual(Object.keys(out), ['hookSpecificOutput']);
  assert.equal(out.decision, undefined);
  assert.notEqual(REMINDER_NO_AGENT, REMINDER);
  for (const w of ['係の結果の数', 'refuter', '反証の見直しをしていない', '記録の遅れ']) assert.ok(REMINDER_NO_AGENT.includes(w), w);
  assert.doesNotMatch(REMINDER_NO_AGENT, /必ず|保証/);
  // 係の呼び出しと数えない物: 入力に refuter が無い係、名前が Agent・Task でない道具、利用者の行、文の中の語、道具の返事
  for (const extra of [
    lines(agentCall('Agent', { subagent_type: 'general-purpose', prompt: '台帳を読んで' })),
    lines(agentCall('Task', { description: '下請けの一覧' })),
    lines(agentCall('TaskCreate', { subject: 'refuter を呼ぶ' })),
    lines(agentCall('TodoWrite', { todos: [{ content: 'refuter で見直す' }] })),
    lines(agentCall('mcp__masked-files__refuter')),
    lines(agentCall('agent')),
    lines(JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_use', name: 'Agent', input: { subagent_type: 'refuter' } }] } })),
    lines(JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'y', content: 'refuter の結果: 残る 15' }] } })),
    lines(said('反証の係 refuter を Agent で呼びました')),
    lines(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', name: 'Agent', text: 'refuter' }] } })),
    lines(agentCall('Agent').slice(0, 40)),
  ]) assert.deepEqual(run(READ + extra, COUNTS), remindWith(REMINDER_NO_AGENT), extra);
  // 数の書き方を変えても、係の呼び出しが無ければ同じ
  for (const message of ['係の結果: 残る: 15件 / 崩れた: 0件 / 確かめられない: 1件', '15件が残る、2件が崩れた、1件は確かめられない', '残る １５・崩れた ２・確かめられない ０']) {
    assert.deepEqual(run(READ, message), remindWith(REMINDER_NO_AGENT), message);
  }
});

test('F80a: 係の呼び出しが無く数も無い → REMINDER。係を呼んでいても数が無ければ REMINDER', () => {
  assert.deepEqual(run(READ, NO_COUNTS), remindWith(REMINDER));
  assert.deepEqual(run(READ, '残る 15・崩れた 2'), remindWith(REMINDER));
  assert.deepEqual(run(lines(agentCall('Agent'), called(PLUGIN_TOOL)), NO_COUNTS), remindWith(REMINDER), '係の呼び出しが read_masked より前');
  for (const name of ['Agent', 'Task']) assert.deepEqual(run(READ + lines(agentCall(name)), NO_COUNTS), remindWith(REMINDER), name);
});

test('F80a: 記録が読めない → 何もしない(返事に数だけがあっても)', () => {
  const ok = { transcript_path: 'x', last_assistant_message: COUNTS };
  assert.deepEqual(decide(ok, () => READ), remindWith(REMINDER_NO_AGENT), '読めれば催促する');
  assert.equal(decide(ok, () => { throw new Error('読めない'); }), null);
  assert.equal(decide({ ...ok, transcript_path: path.join(TMP, '無いファイル.jsonl') }), null);
  for (const broken of ['', 'JSON ではない文\n{"type":', '[]\nnull\n3\n"x"\n']) assert.equal(run(broken, COUNTS), null, broken);
});

test('F80a: read_masked の無い記録 → どんな返事でも何もしない(係の呼び出しがあっても)', () => {
  for (const transcript of [
    lines(user('台帳を点検して'), said('どの書類ですか')),
    lines(user('入札の公告を読んで'), agentCall('Agent')),
    lines(called('mcp__masked-files__list_masked'), agentCall('Task')),
    lines(called('mcp__masked-files__check_articles')),
  ]) {
    for (const message of ['', NO_COUNTS, COUNTS, '残る 15・崩れた 2', '反証の見直しをしていない', 'お疲れさまでした。']) {
      assert.equal(run(transcript, message), null, `${transcript} / ${message}`);
    }
  }
});

test('F80a: 『反証の見直しをしていない』 → 何もしない(係の呼び出しが無く、数があっても無くても)', () => {
  for (const message of ['反証の見直しをしていない', `${COUNTS}。係は呼べず、反証の見直しをしていない`, '係を呼べなかったので、反証の見直しをしていない。指摘は3件です。']) {
    assert.equal(run(READ, message), null, message);
  }
});

test('F80a: stop_hook_active → 何もしない(係の呼び出しが無く数だけの返事でも。記録を読まない)', () => {
  assert.equal(run(READ, COUNTS, { stop_hook_active: true }), null);
  let reads = 0;
  assert.equal(decide({ stop_hook_active: true, transcript_path: 'x', last_assistant_message: COUNTS }, () => { reads += 1; return READ; }), null);
  assert.equal(reads, 0, '記録を読まない');
});

test('F80a: decision: block を返す枝が無い。返すのは null か2つの文のどちらかの additionalContext だけ', () => {
  const transcripts = ['', READ, READ + lines(agentCall('Agent')), READ + lines(agentCall('Task')), lines(agentCall('Agent')), lines(user('こんにちは'))];
  const messages = ['', NO_COUNTS, COUNTS, '反証の見直しをしていない', '残る 15・崩れた 2'];
  const seen = new Set();
  for (const t of transcripts) for (const m of messages) for (const active of [false, true]) {
    const out = run(t, m, { stop_hook_active: active });
    if (out === null) { seen.add('null'); continue; }
    assert.deepEqual(Object.keys(out), ['hookSpecificOutput']);
    assert.equal(out.decision, undefined);
    assert.ok([REMINDER, REMINDER_NO_AGENT].includes(out.hookSpecificOutput.additionalContext));
    assert.deepEqual(out, remindWith(out.hookSpecificOutput.additionalContext));
    seen.add(out.hookSpecificOutput.additionalContext === REMINDER ? 'REMINDER' : 'REMINDER_NO_AGENT');
  }
  assert.deepEqual([...seen].sort(), ['REMINDER', 'REMINDER_NO_AGENT', 'null']);
  const script = fs.readFileSync(path.join(ROOT, 'plugin/skills/construction-check/scripts/check-done.mjs'), 'utf8');
  assert.doesNotMatch(script.replace(/^\s*\/\/.*$/gm, ''), /decision/);
});

test('F80a 文書: check-done.mjs のコメント、manual の登録の行・限界の節・Task の行、overview の行が今の動きと置き場に合う', () => {
  const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const head = read('plugin/skills/construction-check/scripts/check-done.mjs').split('\nimport ')[0];
  assert.ok(!head.includes('道具や係を実際に呼んだかは見ない'));
  for (const w of ['記録の read_masked と係(Agent/Task)の呼び出し', '記録の遅れで余分に出る', 'hooks/hooks.json の Stop']) assert.ok(head.includes(w), w);
  const manual = read('docs/manual.md');
  const item = manual.split('\n').filter((l) => l.includes('scripts/check-done.mjs'));
  assert.equal(item.length, 1);
  assert.ok(item[0].includes('hooks/hooks.json'));
  assert.ok(!item[0].includes('frontmatter'));
  assert.ok(!manual.includes('skills/construction-check/scripts/check-done.mjs'), 'hooks.json の command の文字列を写さない');
  // 書式の ` を外して語を探す
  const section = manual.split('### 手順の抜けの催促の限界')[1].split('\n## ')[0];
  const plain = section.replaceAll('`', '');
  for (const w of ['係の呼び出しが無く数だけ書いた返事には1回催促', '催促の後に数だけ書けば通ります', 'hooks/hooks.json', '/hooks で確かめ', '直に呼んだ', '一度だけの催促', '記録の遅れ', '8回', 'stop_hook_active']) {
    assert.ok(plain.includes(w), w);
  }
  for (const w of ['文しか見ません', '必ず', '保証', '置き換えの表', '手順を守らせる']) assert.ok(!section.includes(w), w);
  const taskLines = manual.split('\n').filter((l) => l.includes('`Task` の名前で出る'));
  assert.equal(taskLines.length, 1);
  assert.ok(taskLines[0].includes('公式の名前は `Agent`'));
  const rows = read('docs/overview.md').split('\n').filter((l) => l.startsWith('| hook `check-done`'));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].split(' | ').length, 4);
  for (const w of ['係の呼び出しが記録に無いときも', '置き場は公式の既定の `hooks/hooks.json`', '`/hooks` での登録の確かめは統括']) assert.ok(rows[0].includes(w), w);
  for (const text of [rows[0], item[0], section, REMINDER_NO_AGENT]) assert.doesNotMatch(text, /必ず|保証/);
});

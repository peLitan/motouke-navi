// F56b の単体の試験: 手順6・7 の抜けを Stop で1回催促するフックの判断。記録はすべて架空
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decide, REMINDER } from '../../plugin/skills/construction-check/scripts/check-done.mjs';

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

test('read_masked があり最後の返事に係の結果の数がある → 何もしない', () => {
  for (const message of [
    COUNTS,
    '係の結果: 残る: 15件 / 崩れた: 0件 / 確かめられない: 1件',
    '| 残る | 15 |\n| 崩れた | 2 |\n| 確かめられない | 1 |',
    '**残る** 3、**崩れた** 0、**確かめられない** 0',
    '15件が残る、2件が崩れた、1件は確かめられない',
    '残る １５・崩れた ２・確かめられない ０',
  ]) assert.equal(run(READ, message), null, message);
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

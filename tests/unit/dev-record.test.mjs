// 開発の記録 docs/development.md と overview の数・版の印(F77b)の単体テスト
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (f) => fs.readFileSync(new URL('../../' + f, import.meta.url), 'utf8');
const record = read('docs/development.md');
const overview = read('docs/overview.md');
const FULL = /\| すべてのコミット \| (\d+) \|/;
const CO = /\| Claude の共著の印があるコミット \| (\d+) \|/;
const REST = /\| 残り\(別の担当が走らせた記録を足したもの\) \| (\d+) \|/;
const AT = /コミットを数えた日時: (\d{4}-\d{2}-\d{2} \d{2}:\d{2})/;
const featureRows = () => record.split('\n').filter((l) => /^\| F\d+ \| \d+ \| \d{4}-\d{2}-\d{2} \d{2}:\d{2} \| \d{4}-\d{2}-\d{2} \d{2}:\d{2} \| /.test(l)).map((l) => l.split(' | '));
const rowOf = (name) => overview.split('\n').find((l) => l.startsWith('| ' + name));

test('overview のコミットの数と日時は、記録の数と日時に一致し、記録へのリンクがある', () => {
  assert.equal(overview.match(AT)[1], record.match(AT)[1]);
  const line = overview.split('\n').find((l) => l.startsWith('**Claude Code で何ができたか**'));
  const m = line.match(/コミットは (\S+ \S+) から (\S+ \S+) までに (\d+) 件で\(`git rev-list --count HEAD`。この数を書くコミットの前の数\)、うち (\d+) 件に Claude の共著の印があり、残る (\d+) 件は/);
  assert.ok(m, line.slice(0, 120));
  assert.equal(m[3], record.match(FULL)[1]);
  assert.equal(m[4], record.match(CO)[1]);
  assert.equal(m[5], record.match(REST)[1]);
  assert.ok(record.includes('| 最初のコミット | ' + m[1] + ' |'));
  assert.ok(record.includes('| 最後のコミット | ' + m[2] + ' |'));
  assert.ok(overview.includes('[開発の記録](development.md)'));
});

test('記録の番号ごとの件数の和と残りが、すべてのコミットの数になり、日ごとの数の和も同じ', () => {
  const rows = featureRows();
  assert.ok(rows.length > 0);
  const sum = rows.reduce((a, r) => a + Number(r[1]), 0);
  const total = Number(record.match(FULL)[1]);
  assert.equal(sum + Number(record.match(REST)[1]), total);
  assert.equal(sum, Number(record.match(CO)[1]));
  const days = record.split('\n').filter((l) => /^\| \d{4}-\d{2}-\d{2} \| \d+ \|$/.test(l)).reduce((a, l) => a + parseInt(l.split(' | ')[1], 10), 0);
  assert.equal(days, total);
  for (const r of rows) assert.ok(r[2] <= r[3], r[0]);
});

test('記録に、走らせ直しの流れと反証の数がある。反証の数は overview の 34 行・33 行と合う', () => {
  for (const s of ['6706949', 'd5a0458', '46c6c2c', '丁山', '7/8', '8/8', '未測']) assert.ok(record.includes(s), s);
  assert.ok(overview.includes('指摘の 34 行のうち 33 行'));
  const rows = record.split('\n').filter((l) => /^\| (番号の無い回|第[1-4]弾) \|/.test(l)).map((l) => l.split(' | '));
  assert.equal(rows.length, 5);
  const upTo3 = rows.slice(0, 4);
  assert.equal(upTo3.reduce((a, r) => a + Number(r[2]), 0), 34);
  assert.equal(upTo3.reduce((a, r) => a + parseInt(r[3], 10), 0), 33);
});

test('記録に開発の道具の説明が無い(overview の1文より書かない)', () => {
  for (const s of ['キット', 'ループ', 'features.json', 'init.mjs', 'progress.md', 'exceptions.md', 'report.md', '.claude', 'prep/', 'reader', 'checker']) {
    assert.ok(!record.includes(s), s);
  }
});

test('証拠の列: 値のある行で版の印が無かった行に印があり、前から版のある行と値の無い行には足していない', () => {
  const marked = { 'hook `guard-raw`': ['af1dc3a'], 'MCP `list_masked`': ['14edd9a', '46c6c2c'], 'Skill `spec-to-rules`': ['e0604fa'], 'Skill `bid-intake`': ['d43289b', '106cc8f'], 'Skill `estimate`': ['a94c5bb'], '評価 `plugin/evals/`': ['14edd9a', '46c6c2c', '6706949'] };
  for (const [name, hashes] of Object.entries(marked)) {
    const row = rowOf(name);
    assert.deepEqual([...row.matchAll(/\(版 ([0-9a-f]{7}) の値。今の版では測り直していない\)/g)].map((m) => m[1]), hashes, name);
  }
  for (const name of ['MCP `read_masked`', 'Skill `construction-check`', '反証の係 `refuter`', 'hook `check-done`', 'MCP `check_articles`', 'モデルの選び方']) {
    assert.ok(!rowOf(name).includes('(版 '), name);
  }
  assert.ok(rowOf('MCP `read_masked`').includes('520ced6'));
  assert.ok(rowOf('Skill `construction-check`').includes('156b15c'));
  assert.ok(rowOf('反証の係 `refuter`').includes('156b15c'));
});

test('記録の版の印の表は、overview の印と同じ hash を挙げ、git の時刻から決めたことを断る', () => {
  for (const h of ['af1dc3a', '14edd9a', '46c6c2c', '6706949', 'e0604fa', 'd43289b', '106cc8f', 'a94c5bb']) {
    assert.ok(record.includes('| ' + h + ' |'), h);
    assert.ok(overview.includes('(版 ' + h + ' の値。'), h);
  }
  assert.ok(record.includes('git の時刻から決めたもので、走らせた担当の記録ではありません'));
});

test('critic.md の指摘5 の項に、候補に回したことと残る限りの1行がある', () => {
  const critic = read('docs/critic.md');
  assert.ok(critic.includes('  - F77b で、見出しの一部にだけ当たる項目を候補に回した(言い換えの語の取り違えと、別の語で書かれた見出しの取りこぼしは残る)'));
  const at = critic.indexOf('critic の指摘 5(目次の同じ意味の見出し)');
  assert.ok(at >= 0 && at < critic.indexOf('  - F77b で、'));
});

test('manual に、一部にだけ当たる見出しの扱いと残る限界がある', () => {
  const manual = read('docs/manual.md');
  assert.ok(manual.includes('一部にだけ当たります'));
  assert.ok(manual.includes('言い換えの語を含むだけで当たった見出しの取り違えは残ります'));
});

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
  // 公式の資料の URL の code.claude.com は開発の道具の説明ではないので外して見る
  const body = record.replaceAll('code.claude.com', '');
  for (const s of ['キット', 'ループ', 'features.json', 'init.mjs', 'progress.md', 'exceptions.md', 'report.md', '.claude', 'prep/', 'reader', 'checker']) {
    assert.ok(!body.includes(s), s);
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

// 見出しの節の表の行を、列に分けて返す。見出しと区切りの行は外す
const section = (title) => {
  const from = record.indexOf('## ' + title);
  assert.ok(from >= 0, title);
  const to = record.indexOf('\n## ', from + 1);
  return record.slice(from, to < 0 ? undefined : to);
};
const tableRows = (title) => section(title).split('\n').filter((l) => l.startsWith('|')).slice(2)
  .map((l) => l.replace(/^\| | \|$/g, '').split(' | '));
const FLOW = '見つけた → 直した → 測り直した';
const LEFT = '残っていること(未測・直していない)';

test('見つけた → 直した → 測り直した: 7列で、決めた行がある', () => {
  const rows = tableRows(FLOW);
  for (const r of rows) assert.equal(r.length, 7, r[2]);
  for (const s of ['指摘1', '指摘2', '指摘3', '指摘4', '指摘5', '5→7→9', '丁山', '架空電設サービス', 'Bash', '元請けの実績', '置き換えの漏れ', 'check-done']) {
    assert.ok(rows.some((r) => r[2].includes(s)), s);
  }
  for (const s of ['7/8', '8/8', 'F36a']) assert.ok(rows.flat().join(' ').includes(s), s);
});

test('再現の試験の欄: 挙げたファイルと試験の名前が実在する', () => {
  for (const r of tableRows(FLOW)) {
    const cell = r[3];
    if (cell.startsWith('未')) continue;
    const file = cell.match(/^`(tests\/unit\/[^`]+)`/)[1];
    const title = cell.slice(cell.indexOf('「') + 1, cell.lastIndexOf('」'));
    assert.ok(read(file).includes("test('" + title + "'"), file + ': ' + title);
  }
});

test('置き換えの漏れの行: 前後は2組で、同じ版の2条件を前後にせず、未再測と書く', () => {
  const row = tableRows(FLOW).find((r) => r[2].includes('置き換えの漏れ'));
  assert.ok(row[5].includes('58.2% → 37.8%'));
  assert.ok(row[5].includes('29.6% → 14.3%'));
  assert.ok(row[5].includes('c7cb8f7') && row[5].includes('520ced6'));
  assert.ok(row[6].includes('未再測'));
  assert.ok(!record.includes('37.8% → 14.3%'));
});

test('方針を変えた所: 4列の時系列で、F23a・F36a・F56a・F56b・F75a・F80a の順', () => {
  const rows = tableRows('方針を変えた所');
  for (const r of rows) assert.equal(r.length, 4, r[2]);
  assert.deepEqual(rows.map((r) => r[1].match(/F\d+[a-z]/)[0]), ['F23a', 'F36a', 'F56a', 'F56b', 'F75a', 'F80a']);
  const dated = rows.filter((r) => /^\d{4}-/.test(r[0])).map((r) => r[0]);
  assert.deepEqual(dated, [...dated].sort());
});

test('残っていること: 1か所にあり、番号が続き、ほかの表の(残 n)はどれも一覧の番号を指す', () => {
  assert.equal(record.split('\n').filter((l) => l.startsWith('## 残っていること')).length, 1);
  const rows = tableRows(LEFT);
  assert.deepEqual(rows.map((r) => r[0]), rows.map((_, i) => '残 ' + (i + 1)));
  for (const s of ['漏れの率', '反証の第5弾', '/hooks', '新しい組', 'E3・E4', '画面なしの入口', 'ISO-2022-JP']) {
    assert.ok(rows.some((r) => r[2].includes(s)), s);
  }
  const others = record.replace(section(LEFT), '');
  const refs = [...others.matchAll(/残 (\d+)/g)].map((m) => Number(m[1]));
  assert.ok(refs.length > 0);
  for (const n of refs) assert.ok(n >= 1 && n <= rows.length, String(n));
  for (const title of [FLOW, '方針を変えた所']) {
    for (const r of tableRows(title)) {
      for (const c of r) if (/^未/.test(c) && c !== '未') assert.match(c, /残 \d+/, c);
    }
  }
});

test('評価の推移: 9列で、古い組の2行は評価.md の値で、E1〜E4 は版の印つきの値', () => {
  const rows = tableRows('評価の推移');
  for (const r of rows) assert.equal(r.length, 9, r[2]);
  const [first, second, ...rest] = rows;
  assert.deepEqual([first[0], first[2], first[4], first[5], first[6]], ['6706949', 'E1 古い組', '7/8', '0/8', '不合格']);
  assert.deepEqual([second[0], second[2], second[4], second[5]], ['46c6c2c', 'E1 古い組', '8/8', '0/8']);
  const eval7 = read('docs/評価.md');
  for (const v of ['$3.54', '$3.70', '965秒', '1042秒']) assert.ok(eval7.includes(v), v);
  assert.deepEqual(rest.map((r) => r[2].slice(0, 2)), ['E1', 'E2', 'E3', 'E4']);
  // F85j: 走らせたので値に替えた。どの欄も未測でなく、版は走らせた版で、判定は評価.md の行の判定と同じ(値は eval-values-1107 が見る)
  for (const r of rest) {
    assert.equal(r[0], '17b7bc2', r[2]);
    for (const i of [4, 5, 6, 7, 8]) assert.notEqual(r[i], '未測', r[2]);
    const row = eval7.split('\n').find((l) => l.startsWith(`| ${r[2].slice(0, 2)} | 17b7bc2、`));
    assert.ok(row && row.includes(`| ${r[6]} |`), r[2]);
  }
  for (const s of ['pass^3', 'pass@3', 'scored: true', 'partial: true', 'skippedPaidGraders', 'arm: with-only', '退行の評価', '能力の評価']) {
    assert.ok(section('評価の推移').includes(s), s);
  }
});

test('検討して選ばなかった仕組み: 4行で、どの行も公式の題名と URL があり、言い過ぎの語が無い', () => {
  const rows = tableRows('検討して選ばなかった仕組み');
  assert.equal(rows.length, 4);
  for (const r of rows) {
    assert.equal(r.length, 3, r[0]);
    assert.match(r[2], /^[A-Z][A-Za-z ]+ https:\/\/code\.claude\.com\/docs\/en\//, r[0]);
  }
  assert.ok(section('検討して選ばなかった仕組み').includes('公式の資料で検討して選ばなかった'));
  for (const s of ['試した', '置き換えの表', '安心して', '初心者', 'Claude Code で全部作った']) assert.ok(!record.includes(s), s);
});

test('数の命令が3つとも本文にあり、id の種類の数と overview の判定役の文がある', () => {
  for (const s of ['git rev-list --count HEAD\n', "git rev-list --count HEAD --grep='Co-Authored-By: Claude'\n", "git log --format=%s | grep -oE '^F[0-9]+[a-z]?' | sort -u | wc -l\n"]) {
    assert.ok(record.includes(s), s);
  }
  assert.match(record, /\| F の id の種類 \| \d+ \|/);
  const row = rowOf('モデルの選び方');
  assert.equal(row.split(' | ').length, 4);
  assert.ok(row.includes('--judge-model'));
  assert.ok(row.includes('比べてはいない'));
});

test('README の作り方の段落の末尾に、記録と残っていることへのリンクがある', () => {
  const lines = read('README.md').split('\n');
  const para = lines[lines.indexOf('## Claude Code での作り方') + 1];
  assert.ok(para.includes('[開発の記録](docs/development.md)'));
  assert.ok(para.endsWith('[残っていること](docs/development.md#残っていること未測直していない) の一覧にあります。'));
});

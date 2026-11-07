// F85j の単体の試験: 版 17b7bc2 の公式の評価の値を、docs/評価.md の 7・docs/development.md の評価の推移・docs/evals/2026-11-07_17b7bc2/ の3か所で確かめる。
// 文書の値を、この試験の期待の値と集計の JSON の両方に照らす。合計は表の行を足して出す(合計の字だけを見ない)。不合格を合格に書き換えると落ちる。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const DOC = read('docs/評価.md');
const DEV = read('docs/development.md');
const SECTION7 = DOC.slice(DOC.indexOf('## 7. '), DOC.indexOf('## 8. '));
const sub = (title) => {
  const i = SECTION7.indexOf(`\n### ${title}\n`);
  assert.ok(i > 0, title);
  const j = SECTION7.indexOf('\n### ', i + 1);
  return SECTION7.slice(i, j > 0 ? j : undefined);
};
const devSection = (title) => {
  const i = DEV.indexOf(`\n## ${title}\n`);
  assert.ok(i > 0, title);
  const j = DEV.indexOf('\n## ', i + 1);
  return DEV.slice(i, j > 0 ? j : undefined);
};
const cells = (l) => l.replace(/^\| | \|$/g, '').split(' | ');
const rowsOf = (text) => text.split('\n').filter((l) => l.startsWith('|')).filter((l) => !/^\|[-|]+\|$/.test(l)).map(cells);

const HEAD = ['ケース', '版・日時', 'あり の点(3回)', 'なし の点(3回)', 'Δ', '判定', '手順の印(Skill・refuter・順)', '費用', '時間'];
const TOOL_MARK = 'Skill・refuter・順 すべて通った';
const WANT = {
  E1: ['E1', '17b7bc2、2026-11-07 15:08', '0.933・1.000・1.000', '0.333・0.333・0.400', '+0.622', '不合格(あり 2/3・なし 0/3)', TOOL_MARK, '$1.76', '581秒'],
  E2: ['E2', '17b7bc2、2026-11-07 15:08', '0.944・0.944・1.000', '0.333・0.278・0.278', '+0.667', '不合格(あり 1/3・なし 0/3)', TOOL_MARK, '$2.25', '828秒'],
  E3: ['E3', '17b7bc2、2026-11-07 15:32', '1.000 ×3', '1.000 ×3', '0.00', '合格(3/3・3/3)', 'Skill・check_conditions は通った、手順の最後の行は3回とも落ちた(点に入らない検査)', '$0.51', '310秒'],
  E4: ['E4', '17b7bc2、2026-11-07 15:37', '1.000 ×3', '—', '—', '合格(3/3)', '—', '$1.17', '372秒'],
};
const resultRows = () => rowsOf(sub('新しい組の結果'));

test('評価.md の 7: 結果の表は9列で、4行の点・Δ・判定・手順の印・費用・時間が走らせた値のまま', () => {
  const rows = resultRows();
  assert.deepEqual(rows[0], HEAD);
  for (const id of Object.keys(WANT)) {
    const row = rows.find((r) => r[0] === id);
    assert.ok(row, id);
    assert.deepEqual(row, WANT[id]);
  }
});

test('評価.md の 7: 走らせた版・日・道具の版・モデルを1文に書き、「未測です」の文が無い', () => {
  const frame = sub('新しい組の結果');
  for (const w of ['17b7bc2940b92604f248afe36172574124413ba2', '2026-11-07', 'Claude Code 2.1.319', 'motouke-navi-guard 0.2.0', '`--model claude-sonnet-5-5`', '`--judge-model claude-opus-5-5`']) {
    assert.ok(frame.includes(w), w);
  }
  assert.equal(frame.includes('未測です。走らせたら'), false);
});

test('評価.md の 7: 表の下の箇条に、閾値・落ちた検査・名前の漏れ・E3 の差・費用・ケースの少なさがある', () => {
  const frame = sub('新しい組の結果');
  for (const w of ['threshold 1.0', '`planted-judge`', 'あり 6回のうち3回', 'PASS か FAIL', '測った範囲で 0', 'E1 8つ', 'E2 11', 'なしでは全回で出', '点に入る検査で差が出ていません', 'pass^3 は E3・E4', 'pass@3 は E1・E2 の あり', '請求の額ではありません', '`partial`', '`skippedPaidGraders`', '4件', '各3回']) {
    assert.ok(frame.includes(w), w);
  }
});

test('評価.md の 7: モデルの比べは未測のまま(走らせていない値を書かない)', () => {
  const frame = sub('新しい組の結果');
  const models = rowsOf(frame.slice(frame.indexOf('モデルの比べ')));
  assert.equal(models.length, 3);
  for (const r of models.slice(1)) assert.deepEqual(r, ['未測', '未測', '未測', '未測', '未測']);
});

test('評価.md の 7: 7 の頭と E2 の節とケースの種類に、走らせていないという古い文が残っていない', () => {
  for (const w of ['走らせた値があるのは E1 の古い組', 'E2・E3・E4 のケースは未測です', 'E2 はまだ走らせていません', '新しい組は未測です']) {
    assert.equal(SECTION7.includes(w), false, w);
  }
});

test('条の正しさ: 表の行を足すと、書いた合計と同じになる', () => {
  const part = sub('新しい組の条の正しさと不合格の読み方');
  const rows = rowsOf(part);
  assert.deepEqual(rows[0].slice(0, 2), ['回', '見落とし']);
  const body = rows.slice(1);
  assert.equal(body.length, 10);
  const frac = (s) => s.split('/').map(Number);
  const sum = (arm) => {
    const t = [0, 0, 0, 0];
    for (const r of body.filter((x) => x[0].includes(arm))) {
      const [a, b] = frac(r[2]);
      const [c, d] = frac(r[4]);
      t[0] += a; t[1] += b; t[2] += c; t[3] += d;
    }
    return t;
  };
  assert.deepEqual(sum('あり'), [79, 117, 57, 73]);
  assert.deepEqual(sum('なし'), [26, 43, 2, 11]);
  assert.ok(part.includes('あり は 条 79/117・抜き書き 57/73'));
  assert.ok(part.includes('なし は 条 26/43・抜き書き 2/11'));
});

test('条の正しさ: 読むときの注意、見立てと書いた不合格の理由、見ていないことがある', () => {
  const part = sub('新しい組の条の正しさと不合格の読み方');
  for (const w of ['そのまま比べられません', '`extractRefs`', '「法第26条」', '32件のうち31件', '人の見直しはしていません', '比べていません']) {
    assert.ok(part.includes(w), w);
  }
  assert.ok(part.includes('見立て'));
  assert.ok(part.includes('判定役の理由そのものではありません'));
  assert.ok(part.includes('E1 あり 1'));
  assert.ok(part.includes('E2 あり 1・2'));
  const notSeen = part.slice(part.indexOf('見ていないこと'));
  for (const w of ['判定役の理由', 'trace', 'E3 の答え', 'E3 の最後の行', '指摘の中身の正しさ', '公開の公告の PDF', 'Windows']) {
    assert.ok(notSeen.includes(w), w);
  }
});

test('development の評価の推移: 下の4行が評価.md と同じ値で、未測が残っていない', () => {
  const text = devSection('評価の推移');
  const rows = rowsOf(text).slice(1);
  assert.equal(rows.length, 6);
  const rest = rows.slice(2);
  const want = {
    E1: ['8/8(点 0.933・1.000・1.000)', '0/8(点 0.333・0.333・0.400)'],
    E2: ['11/11(点 0.944・0.944・1.000)', '0/11(点 0.333・0.278・0.278)'],
    E3: ['点 1.000 ×3', '点 1.000 ×3'],
    E4: ['点 1.000 ×3', '—'],
  };
  for (const r of rest) {
    const id = r[2].slice(0, 2);
    assert.equal(r.length, 9, id);
    assert.equal(r[0], '17b7bc2', id);
    assert.equal(r[1], '2026-11-07', id);
    assert.deepEqual(r.slice(4, 6), want[id], id);
    assert.equal(r[6], WANT[id][5], id);
    assert.equal(r[7], WANT[id][7], id);
    assert.equal(r[8], WANT[id][8], id);
    assert.equal(r.join(' ').includes('未測'), false, id);
  }
  assert.equal(rest.find((r) => r[2].startsWith('E4'))[3], '点に入る 4');
  assert.equal(text.includes('まだ走らせていません'), false);
  assert.ok(text.includes('E2 は11'), 'あり・なしの数の説明が名前の数を2つとも書く');
});

test('development の残っていること: 残 2・残 3 は行を残し、走らせたことと残っていない物を書く', () => {
  const rows = rowsOf(devSection('残っていること(未測・直していない)')).slice(1);
  for (const [no, word] of [['残 2', '新しい組'], ['残 3', 'E3・E4']]) {
    const row = rows.find((r) => r[0] === no);
    assert.ok(row, no);
    assert.equal(row[1], '走らせた', no);
    assert.ok(row[2].includes(word), no);
    assert.ok(row[2].includes('値は `docs/評価.md` の 7'), no);
    assert.ok(row[2].includes('判定役の理由と E3 の答えは残っていない'), no);
  }
  assert.equal(rows.find((r) => r[0] === '残 4')[1], '未測', 'モデルの比べは未測のまま');
  assert.equal(DEV.includes('E2 のケースは未測です(残 2)'), false);
  assert.equal(DEV.includes('未測(残 2)'), false);
});

const EVAL_DIR = 'docs/evals/2026-11-07_17b7bc2';
const FILES = ['e1e2', 'e3', 'e4'];
const json = (n) => JSON.parse(read(`${EVAL_DIR}/${n}.json`));
const allCases = () => FILES.flatMap((n) => json(n).cases);
const armsOf = (c) => Object.values(c.arms).flat();
const fix3 = (x) => x.toFixed(3);
const jst = (iso) => new Date(Date.parse(iso) + 9 * 3600 * 1000).toISOString().slice(0, 16).replace('T', ' ');
const CASE_OF = { E1: 'e1-trace-masked', E2: 'e2-trace-masked', E3: 'e3-bid-intake', E4: 'e4-no-planted' };

test('集計の写し: 3つが JSON として読め、走らせた版の道具・モデル・閾値のままで、途中の回が無い', () => {
  for (const n of FILES) {
    const j = json(n);
    assert.equal(j.claudeVersion, '2.1.319', n);
    assert.equal(j.partial, false, n);
    assert.equal(j.suite.modelOverride, 'claude-sonnet-5-5', n);
    assert.equal(j.suite.judgeModel, 'claude-opus-5-5', n);
    assert.equal(j.suite.threshold, 1, n);
    assert.equal(j.suite.plugins[0].version, '0.2.0', n);
    for (const c of j.cases) for (const r of armsOf(c)) {
      assert.equal(r.skippedPaidGraders, false, c.name);
      assert.equal(r.error, null, c.name);
    }
  }
});

test('集計の写し: パスは伏せてあり、伏せた欄のほかにパスが残らない', () => {
  for (const n of FILES) {
    const raw = read(`${EVAL_DIR}/${n}.json`);
    for (const w of ['/home/', '/tmp/', 'claude-eval-', 'hackathon-tool']) assert.equal(raw.includes(w), false, `${n}: ${w}`);
    const j = json(n);
    assert.equal(j.suite.root, 'plugin', n);
    assert.equal(j.suite.plugins[0].path, 'plugin', n);
    for (const c of j.cases) for (const r of armsOf(c)) assert.equal(r.tracePath, '', c.name);
  }
});

test('集計の写し: 評価.md の4行の点・Δ・費用・時間・開始の時刻・通った回は、集計から出した値と同じ', () => {
  const rows = resultRows();
  const cases = allCases();
  for (const [id, name] of Object.entries(CASE_OF)) {
    const c = cases.find((x) => x.name === name);
    assert.ok(c, name);
    const row = rows.find((r) => r[0] === id);
    const withArm = c.arms.with;
    const without = c.arms.without || [];
    const scores = (a) => a.map((r) => fix3(r.score));
    const shown = (s) => (s.startsWith('—') ? [] : s.includes('×') ? Array(3).fill(s.split(' ')[0]) : s.split('・'));
    assert.deepEqual(shown(row[2]), scores(withArm), id);
    assert.deepEqual(shown(row[3]), scores(without), id);
    if (row[4] !== '—') assert.equal(Number(row[4]).toFixed(3), fix3(c.aggregates.delta), id);
    const runs = armsOf(c);
    assert.equal(row[7], `$${runs.reduce((a, r) => a + r.costUsd, 0).toFixed(2)}`, id);
    // 時間: ケース1件のファイルは集計の頭の値(回の間の時間を含むので E3 は回の合計 306 より長い)。2件が入る e1e2 は頭が2件の合計なので回を足す
    const file = FILES.map(json).find((j) => j.cases.some((x) => x.name === name));
    const seconds = file.cases.length === 1 ? file.durationSeconds : runs.reduce((a, r) => a + r.durationSeconds, 0);
    assert.equal(row[8], `${seconds}秒`, id);
    const passed = (a) => `${a.filter((r) => r.passed).length}/${a.length}`;
    assert.ok(row[5].includes(passed(withArm)), id);
    if (without.length) assert.ok(row[5].includes(passed(without)), id);
    // threshold 1.0 の判定: 3回とも通ったケースだけが合格
    assert.equal(row[5].startsWith('合格'), withArm.every((r) => r.score === 1), id);
    assert.ok(row[1].endsWith(jst(file.startedAt)), id);
  }
});

test('文書の置き場: 評価.md から3つの集計へ相対リンクがあり、先のファイルがある', () => {
  const frame = sub('新しい組の結果');
  for (const n of FILES) {
    assert.ok(frame.includes(`](evals/2026-11-07_17b7bc2/${n}.json)`), n);
    assert.ok(fs.existsSync(path.join(ROOT, EVAL_DIR, `${n}.json`)), n);
  }
});

test('公開の文書から、公開しないフォルダを指さない', () => {
  const texts = [['docs/評価.md', DOC], ['docs/development.md', DEV], ...FILES.map((n) => [n, read(`${EVAL_DIR}/${n}.json`)])];
  for (const [name, s] of texts) {
    assert.equal(s.includes('prep/'), false, name);
    assert.equal(s.includes('eval-1107'), false, name);
  }
});

// F44a: 工種の選択。土木の出力は足す前と同じ。工種を変えると出典の表示が変わり、表の無い工種は「見ていない」と出す
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHtml } from '../../build.mjs';
import { civilOutputs, hashes, readGolden } from './_work-kind-outputs.mjs';
import { WORK_KINDS, NOT_READ, DEFAULT_WORK_KIND, hasKindTable, workKindLabel } from '../../src/work-kinds.mjs';
import { kindSource, kindSourceText } from '../../src/work-kind-tables.mjs';
import { buildScheduleDetail } from '../../src/schedule.mjs';
import { checkPlanToc } from '../../src/plan-check.mjs';
import { renderSchedule, renderPlanResult } from '../../src/ui/view.mjs';
import { scheduleRows, planRows, workKindRows, toCsv, COLUMNS } from '../../src/export.mjs';
import { bidCheck } from '../../src/bid-check.mjs';
import { readBidForm, readWorkKind } from '../../src/ui/form.mjs';
import { SAMPLE } from '../../src/sample.mjs';
import { checkEstimate, renderMarkdown, exitCodeOf, loadTables } from '../../plugin/skills/estimate/scripts/check-estimate.mjs';
import { runPage } from '../acceptance/_helpers.mjs';

// 段取りの表も無い工種(建築の段取りは F44b で足した。建築の目次と積算はまだ無い)
const OTHERS = WORK_KINDS.filter((k) => !hasKindTable(k.id, 'schedule'));
const body = buildHtml();

test('固定: 土木の段取り・目次・積算の出力が、工種を足す前の基準と同じ', () => {
  assert.deepEqual(hashes(civilOutputs()), readGolden());
});

test('固定: 工種に土木を明示しても、工種なしと同じ行が出る', () => {
  const form = readBidForm(SAMPLE.form);
  assert.deepEqual(buildScheduleDetail({ ...form, workKind: 'doboku' }), buildScheduleDetail(form));
  assert.deepEqual(checkPlanToc('1. 工事概要', { workType: 'other', workKind: 'doboku' }), checkPlanToc('1. 工事概要', { workType: 'other' }));
});

test('固定: CSV の土木の行は変えず、工種の行を最後に足すだけ', () => {
  const rows = buildScheduleDetail(readBidForm(SAMPLE.form)).rows;
  const plain = scheduleRows(rows);
  const withKind = scheduleRows(rows, new Map(), 'doboku');
  assert.deepEqual(withKind.slice(0, -1), plain);
  assert.equal(withKind.length, plain.length + 1);
  assert.equal(withKind.at(-1).length, plain[0].length, '列の数が同じ');
  assert.ok(toCsv(withKind).includes('土木(建設機械施工を含む)'));
  const out = checkPlanToc('1. 工事概要', { workType: 'other' });
  assert.deepEqual(planRows(out, 'kenchiku').slice(0, -1), planRows(out));
  assert.equal(planRows(out, 'kenchiku').at(-1).length, planRows(out)[0].length);
  assert.ok(toCsv(planRows(out, 'kenchiku')).includes('工種: 建築'));
  assert.equal(workKindRows('kan')[0].length, COLUMNS.length);
});

test('7種目が画面の選択肢と同じで、既定は土木', () => {
  assert.deepEqual(WORK_KINDS.map((k) => k.label), ['土木(建設機械施工を含む)', '建築', '電気工事', '管工事', '電気通信工事', '造園', 'その他']);
  const select = body.match(/<select id="work-kind"[\s\S]*?<\/select>/)[0];
  assert.deepEqual([...select.matchAll(/<option value="([^"]+)"[^>]*>([^<]+)</g)].map((m) => [m[1], m[2]]), WORK_KINDS.map((k) => [k.id, k.label]));
  assert.match(select, /^<select[^>]*>\s*<option value="doboku"/); // 先頭の選択肢が既定
  for (const v of [undefined, '', 'x', 'constructor']) assert.equal(readWorkKind({ 'work-kind': v }), 'doboku');
  assert.equal(readWorkKind({ 'work-kind': 'kan' }), 'kan');
});

test('工種を変えると出典の表示が変わる。土木は題・版・取得日を出す', () => {
  const civil = kindSource('doboku', 'schedule');
  assert.equal(civil.title, '土木工事共通仕様書(案)令和8年3月');
  assert.equal(civil.fetchedAt, '2026-11-02');
  assert.equal(civil.version, '令和8年3月 の版');
  const text = kindSourceText('doboku', 'schedule');
  for (const w of [civil.title, civil.fetchedAt, civil.version]) assert.ok(text.includes(w), w);
  assert.ok(kindSource('doboku', 'estimate').title.includes('土木工事工事費積算要領'));
  for (const k of OTHERS) {
    for (const part of ['schedule', 'plan']) {
      const other = kindSourceText(k.id, part);
      assert.notEqual(other, kindSourceText('doboku', part));
      assert.ok(other.includes(k.label) && other.includes(NOT_READ) && other.includes('工種を問わず'), other);
      assert.ok(!other.includes('土木工事共通仕様書'));
    }
  }
});

for (const k of OTHERS) {
  test(`表の無い工種(${k.label})は土木の表で埋めず「見ていない」と出す`, () => {
    assert.equal(hasKindTable(k.id, 'schedule'), false);
    const detail = buildScheduleDetail({ ...readBidForm(SAMPLE.form), workKind: k.id });
    assert.equal(detail.notRead, true);
    assert.deepEqual(detail.rows, []);
    const html = renderSchedule(detail.rows, detail);
    assert.ok(html.includes(NOT_READ) && html.includes(k.label));
    assert.ok(!html.includes('国の直轄の例です'));
    assert.equal(buildScheduleDetail({ workKind: k.id }, null, { all: true }).notRead, true);
    const plan = checkPlanToc('1. 工事概要', { workType: 'other', workKind: k.id });
    assert.equal(plan.notRead, true);
    assert.deepEqual(plan.candidates, []);
    assert.ok(renderPlanResult(plan).includes(NOT_READ));
  });
}

test('読み込んだ表は工種を問わず使う', () => {
  const table = { label: '', schedule: [], planItems: [{ no: 1, label: '架空の項目', section: '1', quote: 'x', aliases: [] }], source: { title: '架空', edition: '架空', url: '', fetchedAt: '2026-01-01' } };
  const out = checkPlanToc('1. 工事概要', { workKind: 'kenchiku', table });
  assert.ok(!out.notRead);
  assert.equal(out.candidates[0].item, '架空の項目');
});

test('法令の判定は工種で変わらない', () => {
  const form = readBidForm(SAMPLE.form);
  assert.deepEqual(bidCheck({ ...form, workKind: 'kenchiku' }), bidCheck(form));
});

test('積算: 表の無い工種は額を出さず、どの行も合計に入れない。分からない id は止める', () => {
  const tables = loadTables('docs/samples/estimate/架空の標準単価表');
  const file = '数量.md';
  const quote = '| 掘削 | 土砂 | m3 | 1,200 |';
  const data = (workKind) => ({ source: { title: '架空' }, conditions: { workKind }, lines: [{ name: '掘削', quantity: 1200, unit: 'm3', quote, file, match: { no: 1, tableQuote: '掘削 ｍ３ 土砂 架空の方法A' } }] });
  const r = checkEstimate(data('tsushin'), [{ file, text: quote }], tables);
  assert.equal(r.amount, null);
  assert.equal(r.notIncluded.length, 1);
  assert.equal(exitCodeOf(r), 1);
  assert.ok(renderMarkdown(r).includes(NOT_READ) && renderMarkdown(r).includes(workKindLabel('tsushin')));
  assert.throws(() => checkEstimate(data('x'), [], tables), RangeError);
});

test('画面: 土木の見本は出典の行を出し、その他に変えて確認すると切り替わる。見本・CSV・まとめ・安全の候補も通る', async () => {
  const page = runPage();
  await page.click('sample-load');
  await page.click('confirm-go').catch(() => {});
  const line = () => page.el('work-kind-schedule').textContent;
  assert.ok(page.el('work-kind').value === 'doboku');
  assert.ok(line().includes('土木工事共通仕様書(案)令和8年3月') && line().includes('取得日 2026-11-02'), line());
  assert.ok(page.text('schedule-result').includes('受注後の段取りは'));
  assert.equal(page.el('rules-wakayama').hidden, false);
  page.el('work-kind').value = 'other';
  page.el('work-kind').dispatchEvent({ type: 'change' });
  assert.ok(line().includes('土木工事共通仕様書'), '確認を押す前は、出ている結果の出典のまま');
  await page.click('bid-run');
  assert.ok(line().includes('工種: その他') && line().includes(NOT_READ), line());
  assert.ok(page.text('schedule-result').includes(NOT_READ));
  assert.ok(page.el('schedule-notice').textContent.includes(NOT_READ));
  assert.equal(page.el('schedule-about').hidden, true);
  assert.equal(page.el('rules-wakayama').hidden, true);
  assert.ok(page.el('summary').innerHTML.includes(NOT_READ));
  assert.ok(page.text('bid-result').length > 0 && !page.text('bid-result').includes(NOT_READ), '法令の判定は出る');
  await page.click('schedule-csv-btn');
  const csv = await page.blobs.at(-1).text();
  assert.ok(csv.includes('工種') && csv.includes('その他') && csv.includes(NOT_READ));
  await page.click('plan-run');
  assert.ok(page.text('plan-result').includes(NOT_READ));
  assert.ok(page.el('work-kind-plan').textContent.includes(NOT_READ));
  await page.click('sample-load');
  assert.equal(page.el('work-kind').value, 'doboku', '見本は土木に戻す');
});

test('画面: 土木に戻すと和歌山県の例がまた使える。もう受注した人の一覧も工種に従う', async () => {
  const page = runPage();
  await page.click('rules-wakayama');
  page.el('work-kind').value = 'other';
  await page.click('entry-awarded');
  assert.ok(page.text('schedule-result').includes(NOT_READ));
  assert.ok(page.el('awarded-notice-text').textContent.includes(NOT_READ));
  page.el('work-kind').value = 'doboku';
  await page.click('entry-awarded');
  assert.ok(page.el('schedule-notice').textContent.includes('和歌山県'));
  assert.ok(!page.text('schedule-result').includes(NOT_READ));
});

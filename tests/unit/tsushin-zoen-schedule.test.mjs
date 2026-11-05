// F44g: 電気通信工事の段取りと、造園に土木の表を当てること。行は原文で照らし、造園は土木の表を当てたことと版の違いを必ず出す
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { checkKindSchedule, checkZoenBasis } from '../../src/kind-schedule-check.mjs';
import { buildScheduleDetail, deadlineText } from '../../src/schedule.mjs';
import { renderSchedule } from '../../src/ui/view.mjs';
import { scheduleRows, toCsv } from '../../src/export.mjs';
import { kindNote, kindSource, kindSourceText, kindTable } from '../../src/work-kind-tables.mjs';
import { NOT_READ, hasKindTable } from '../../src/work-kinds.mjs';
import { streamLines, tsushinText, parkText } from '../../scripts/fetch-tsushin-park-spec.mjs';
import { runPage } from '../acceptance/_helpers.mjs';

const read = (p) => fs.readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const data = JSON.parse(read('data/schedule-tsushin.json'));
const text = read('data/sources/mlit-tsushin-spec-r8-ch1.txt');
const zoen = JSON.parse(read('data/zoen-basis.json'));
const parkSource = read('data/sources/mlit-park-spec-r6-notes.txt');
const rule = (d, id) => d.rules.find((r) => r.id === id);
const has = (d, id, word) => checkKindSchedule(d, text).some((e) => e.startsWith(id + ':') && e.includes(word));
const edited = (id, change) => { const d = structuredClone(data); change(rule(d, id)); return d; };

test('電気通信: 全行が原文の節の号の中で照らせる', () => {
  assert.deepEqual(checkKindSchedule(data, text), []);
  assert.equal(data.rules.length, 21);
  assert.ok(data.rules.every((r) => r.id.startsWith('ts-') && r.section.startsWith('1-1-1-')));
});

test('電気通信: 点検は外れた行を見つける', () => {
  assert.ok(has(edited('ts-start-plan', (r) => { r.quote += 'を変えた'; }), 'ts-start-plan', '抜き書きが箇所の中に無い'));
  assert.ok(has(edited('ts-start-plan', (r) => { r.section = '1-1-1-7'; }), 'ts-start-plan', '題名が原文の見出しと違う'));
  assert.ok(has(edited('ts-start-plan', (r) => { r.section = '1-1-1-99'; }), 'ts-start-plan', '箇所の見出しが原文に無い'));
  assert.ok(has(edited('ts-start-plan', (r) => { r.title = '施工計画書'; }), 'ts-start-plan', '号のある節なのに'));
  assert.ok(has(edited('ts-start-plan', (r) => { r.title = '施工計画書(2.変更施工計画書)'; }), 'ts-start-plan', '抜き書きが箇所の中に無い'), '同じ節の別の号');
  assert.ok(has(edited('ts-start-plan', (r) => { r.title = '施工計画書(1.別の見出し)'; }), 'ts-start-plan', '号が原文に無い'));
  assert.ok(has(edited('ts-start-plan', (r) => { r.when = '着手の14日前まで'; }), 'ts-start-plan', '手で書いた期間'));
  assert.ok(has(edited('ts-work-report', (r) => { r.quote += '次の文。'; }), 'ts-work-report', '抜き書きが'));
});

test('電気通信: かっこの中の句点は文の数に入れないが、2文は通さない', () => {
  assert.ok(rule(data, 'ts-done-supplied').quote.includes('。）'));
  const two = edited('ts-start-subcontract-terms', (r) => { r.quote = r.quote + r.quote; });
  assert.ok(has(two, 'ts-start-subcontract-terms', '1文を超える'));
});

test('電気通信: 期日は抜き書きから読み、数字を手で書かない', () => {
  assert.deepEqual(data.rules.filter((r) => r.deadline).map((r) => deadlineText(r)), ['契約後、土曜日、日曜日、祝日等を除き10日以内', '工事完成後、土曜日、日曜日、祝日等を除き10日以内']);
  const d = structuredClone(rule(data, 'ts-start-corins'));
  d.deadline.quote = d.deadline.quote.replace('受注時は契約後、土曜日、日曜日、祝日等を除き10', '受注時は契約後、土曜日、日曜日、祝日等を除き20');
  assert.equal(deadlineText(d), '契約後、土曜日、日曜日、祝日等を除き20日以内');
  assert.ok(buildScheduleDetail({ workKind: 'tsushin' }).rows.every((r) => !r.when.includes('{')));
});

test('電気通信: 下請・金額の条件が土木と同じ型で当たる。施工体系図の写しは措置があっても出す(この仕様書の文の違い)', () => {
  const on = { workKind: 'tsushin', hasSubcontract: true, ictMeasure: true, contractAmount: 10000000 };
  const ids = (input) => buildScheduleDetail(input).rows.map((r) => r.id);
  assert.ok(!ids(on).includes('ts-start-taicho-copy'), '台帳の写しは措置があれば要らない');
  assert.ok(ids(on).includes('ts-start-taikeizu-copy'), '体系図の写しの文に除外が無い');
  assert.ok(!/情報通信技術/.test(rule(data, 'ts-start-taikeizu-copy').quote));
  assert.ok(!ids({ ...on, hasSubcontract: false }).includes('ts-start-taicho'));
  assert.ok(!ids({ ...on, contractAmount: 4990000 }).includes('ts-start-corins'), '境目は抜き書きの500万円');
  assert.ok(ids({ ...on, contractAmount: 5000000 }).includes('ts-start-corins'));
  assert.deepEqual(buildScheduleDetail({ workKind: 'tsushin', direct: false }).rows, []);
});

test('電気通信: 行はこの仕様書の根拠で出て、建築の文は混ざらない。出典は切り替わり、目次と共通費は見ていないと出る', () => {
  const detail = buildScheduleDetail({ workKind: 'tsushin', hasSubcontract: true });
  const html = renderSchedule(detail.rows, detail);
  const csv = toCsv(scheduleRows(detail.rows, new Map(), 'tsushin'));
  assert.deepEqual([...new Set(detail.rows.map((r) => r.phase))], ['start', 'work', 'completion']);
  for (const r of detail.rows) {
    assert.equal(r.basis.url, 'https://www.mlit.go.jp/tec/it/denki/gijyutukijyun/R0803kouji.pdf');
    assert.equal(r.basis.fetchedAt, '2026-11-06');
    assert.equal(r.basis.version, '令和8年 の版');
    assert.equal(r.basis.doc, '電気通信設備工事共通仕様書 令和8年版');
  }
  for (const w of ['標準仕様書', '官庁営繕', '土木工事共通仕様書(案)']) assert.ok(!html.includes(w) && !csv.includes(w), w);
  assert.ok(html.includes('国の直轄の例') && csv.includes('電気通信設備工事共通仕様書'));
  assert.ok(detail.notes.some((n) => n.includes('土木工事に係る電気通信設備工事')));
  assert.ok(kindSourceText('tsushin', 'schedule').includes('電気通信設備工事共通仕様書 令和8年版'));
  assert.ok(kindSourceText('tsushin', 'plan').includes(NOT_READ));
  assert.equal(kindSource('tsushin', 'estimate'), null);
  assert.ok(kindSourceText('tsushin', 'estimate').includes(NOT_READ));
});

test('電気通信: 画面で選ぶと段取りと出典・注記が切り替わり、CSV も通る', async () => {
  const page = runPage();
  await page.click('sample-load');
  await page.click('confirm-go').catch(() => {});
  page.el('work-kind').value = 'tsushin';
  await page.click('bid-run');
  assert.ok(page.text('schedule-result').includes('施工計画書') && !page.text('schedule-result').includes(NOT_READ));
  assert.ok(page.el('work-kind-schedule').textContent.includes('電気通信設備工事共通仕様書'));
  assert.ok(page.el('schedule-notice').textContent.includes('国の直轄の電気通信設備工事の例'));
  assert.equal(page.el('schedule-about').hidden, true, '土木の説明の文を出さない');
  await page.click('schedule-csv-btn');
  assert.ok((await page.blobs.at(-1).text()).includes('電気通信工事'));
  await page.click('plan-run');
  assert.ok(page.text('plan-result').includes(NOT_READ), '目次の表は作っていない');
});

test('電気通信: 置いた原文は第1編 第1章だけ', () => {
  assert.ok(/^1-1-1-47 石綿使用の有無$/m.test(text));
  assert.ok(!/^第2章/m.test(text) && !text.includes('器材の品質'));
  assert.ok(!/^\d+-\d+$/m.test(text), '頁の番号が混ざらない');
});

test('造園: 土木の表をそのまま当て、行は土木の根拠で出す', () => {
  assert.equal(kindTable('zoen', 'schedule'), kindTable('doboku', 'schedule'));
  const input = { hasSubcontract: true, contractAmount: 10000000 };
  assert.deepEqual(buildScheduleDetail({ ...input, workKind: 'zoen' }).rows, buildScheduleDetail({ ...input, workKind: 'doboku' }).rows);
  assert.equal(hasKindTable('zoen', 'plan'), false);
  assert.equal(hasKindTable('zoen', 'estimate'), false);
});

test('造園: 土木の表を当てたことと版の違いを、出典の行と CSV に必ず出す。土木を選んだときは出さない', () => {
  const note = kindNote('zoen', 'schedule');
  for (const w of ['公園緑地工事共通仕様書', '令和6年度版', '令和8年3月', '版が違います', '土木の表を当てました', 'このツールの整理', '見ていない', 'https://www.mlit.go.jp/toshi/park/content/001742862.pdf', '2026-11-06']) assert.ok(note.includes(w), w);
  assert.ok(kindSourceText('zoen', 'schedule').includes(note));
  assert.ok(kindSourceText('zoen', 'schedule').includes('土木工事共通仕様書(案)令和8年3月'));
  const detail = buildScheduleDetail({ workKind: 'zoen' });
  assert.ok(toCsv(scheduleRows(detail.rows, new Map(), 'zoen')).includes('令和6年度版'));
  assert.equal(kindNote('doboku', 'schedule'), '');
  assert.equal(kindNote('zoen', 'plan'), '');
  assert.ok(!kindSourceText('doboku', 'schedule').includes('公園緑地'));
  assert.ok(!toCsv(scheduleRows(buildScheduleDetail({}).rows, new Map(), 'doboku')).includes('公園緑地'));
});

test('造園: 画面で選ぶと土木の行と説明が出る', async () => {
  const page = runPage();
  await page.click('sample-load');
  await page.click('confirm-go').catch(() => {});
  page.el('work-kind').value = 'zoen';
  await page.click('bid-run');
  assert.ok(!page.text('schedule-result').includes(NOT_READ));
  const line = page.el('work-kind-schedule').textContent;
  assert.ok(line.includes('工種: 造園') && line.includes('公園緑地工事共通仕様書') && line.includes('版が違います'), line);
  await page.click('plan-run');
  assert.ok(page.text('plan-result').includes(NOT_READ), '目次は土木の項目で比べない');
});

test('造園: 注の抜き書きは原文で照らせ、外れた抜き書きと頁を見つける', () => {
  assert.deepEqual(checkZoenBasis(zoen, parkSource), []);
  const q = structuredClone(zoen); q.quotes[0].quote = q.quotes[0].quote.replace('令和6年度版', '令和8年度版');
  assert.ok(checkZoenBasis(q, parkSource)[0].includes('原文に無い'));
  const p = structuredClone(zoen); p.quotes[0].page = 1;
  assert.ok(checkZoenBasis(p, parkSource)[0].includes('ページが違う'));
  assert.ok(!/総則/.test(parkSource.split('（注1）')[0]), '目次に総則の章が無い');
});

const item = (y, t) => ({ x: 10, y, text: t });
const lines = (no, ...ls) => ({ page: no, items: ls.map((l, i) => item(700 - i * 1.7, l)) });

test('取得: 行の間隔が狭い PDF でも流れの順のまま行に分ける', () => {
  assert.deepEqual(streamLines([item(700, '1-1-1-6'), item(700, ' 施工計画書'), item(698.3, '本文'), item(50, '1-9')]), ['1-1-1-6 施工計画書', '本文', '1-9']);
});

test('取得: 電気通信は 1-1-1-1 から第2章の手前までで、頁の番号を除く。目次の頁は使わない', () => {
  const pages = [
    lines(2, '目次', '1-1-1-1 適用 ···'),
    lines(34, '電気通信設備工事共通仕様書', '第1節 総  則', '1-1-1-1 適  用', '文。', '1-1'),
    lines(35, '続きの文。', '第2章 土木工事部分', '別の文'),
    lines(36, '第2編の文'),
  ];
  assert.equal(tsushinText(pages), '--- PDF の 34 ページ ---\n1-1-1-1 適  用\n文。\n--- PDF の 35 ページ ---\n続きの文。\n');
  assert.throws(() => tsushinText([lines(1, '別の文書')]), /範囲/);
  assert.throws(() => tsushinText([lines(1, '1-1-1-1 適用')]), /範囲/);
});

test('取得: 公園緑地は表紙と目次の頁だけで、本文を取り込まない', () => {
  const pages = [lines(1, '題名'), lines(2), lines(3, '目次', '（注1）注の文'), lines(4, '本文')];
  assert.equal(parkText(pages), '--- PDF の 1 ページ ---\n題名\n--- PDF の 3 ページ ---\n目次\n（注1）注の文\n');
  assert.throws(() => parkText([lines(1, '題名')]), /注/);
});

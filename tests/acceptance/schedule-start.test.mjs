// F06a: 段取り(着手まで、国の直轄の例)(条件 F06-1・F06-2)
import test from 'node:test';
import assert from 'node:assert/strict';
import { load, indexHtml, scriptsOf, withoutScripts, hasId, runPage } from './_helpers.mjs';
import { CONDS, assertRow, loadSources } from './_schedule-common.mjs';

test('着手までの行が3つ以上あり、各行に いつ・何を・誰に・根拠(共通仕様書の箇所と原文)がある', async () => {
  const { buildSchedule } = await load('src/schedule.mjs');
  const src = loadSources();
  for (const c of CONDS) {
    const rows = buildSchedule(c).filter((r) => r.phase === 'start');
    assert.ok(rows.length >= 3, '着手までの行が少ない');
    for (const r of rows) assertRow(r, src);
  }
});

test('表示: 行の いつ・何を・誰に・箇所が出る', async () => {
  const { buildSchedule } = await load('src/schedule.mjs');
  const { renderSchedule } = await load('src/ui/view.mjs');
  const rows = buildSchedule(CONDS[0]);
  const html = renderSchedule(rows);
  for (const r of rows.filter((x) => x.phase === 'start')) {
    for (const k of ['when', 'what', 'to']) assert.ok(html.includes(r[k].replace(/&/g, '&amp;').replace(/</g, '&lt;')), k + ' が出ない');
    assert.ok(html.includes(r.basis.section));
  }
});

test('画面を動かす: 条件を入れて確認のボタンを押すと、段取りの一覧も出る', async () => {
  const { buildSchedule } = await load('src/schedule.mjs');
  const page = runPage();
  await page.set('orderer', 'public'); await page.set('subcontract-total', '60,000,000'); await page.set('contract-amount', '300,000,000');
  await page.set('license', 'tokutei'); await page.set('engineer-qualification', 'kanri'); await page.set('work-type', 'other'); await page.set('direct', true); await page.set('ict-measure', false);
  await page.click('bid-run');
  const out = page.text('schedule-result');
  const first = buildSchedule(CONDS[0]).find((r) => r.phase === 'start');
  assert.ok(out.includes(first.what), '段取りが画面に出ない');
});

test('段取りを CSV に書き出す行(いつ・何を・誰に・根拠の箇所)', async () => {
  const { scheduleRows } = await load('src/export.mjs');
  const { buildSchedule } = await load('src/schedule.mjs');
  const rows = buildSchedule(CONDS[0]);
  const csv = scheduleRows(rows);
  assert.equal(csv.length, rows.length + 1);
  rows.forEach((r, i) => { const line = csv[i + 1].join(' '); for (const v of [r.when, r.what, r.to, r.basis.section]) assert.ok(line.includes(v)); });
});

test('画面に段取りの一覧と「国の直轄の例」の断りが出る', () => {
  const html = indexHtml();
  assert.ok(hasId(html, 'schedule-result'));
  assert.ok(scriptsOf(html).map((s) => s.code).join('\n').includes('buildSchedule'));
  const body = withoutScripts(html).replace(/<[^>]+>/g, '').replace(/\s+/g, '');
  assert.ok(body.includes('国の直轄の例。自治体・民間は発注者の仕様書・契約書で置き換えてください'));
});

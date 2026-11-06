// 書き出し(src/export.mjs)と、画面の印刷・CSV のつながりの単体テスト(値はすべて架空)
import test from 'node:test';
import assert from 'node:assert/strict';
import { toCsv, stage1Rows, COLUMNS, bidCheckRows, bidRows, checkRows, scheduleRows, SCHEDULE_COLUMNS, planRows, PLAN_COLUMNS, checklistRows, CHECKLIST_COLUMNS } from '../../src/export.mjs';
import { bidCheck } from '../../src/bid-check.mjs';
import { judgeTaicho } from '../../src/taicho.mjs';
import { runPage } from '../acceptance/_helpers.mjs';

const input = { orderer: 'private', direct: true, workType: 'kenchiku-ikkatsu', contractAmount: 900000000, hasSubcontract: true, subcontractTotal: 85000000, license: 'ippan', engineerQualification: 'shunin', ictMeasure: false };

test('stage1Rows: すべての行の列の数が見出しと同じ。確認が要る点・注意の行が入る', () => {
  const bid = bidCheck(input);
  const rows = stage1Rows(bid, judgeTaicho(input), '指摘の候補です');
  assert.deepEqual(rows[0], COLUMNS);
  for (const r of rows) assert.equal(r.length, COLUMNS.length);
  assert.equal(rows.filter((r) => r[0] === '確認が要る点').length, bidCheckRows(bid).length);
  assert.ok(bid.checks.length > 0, 'この入力では確認が要る点が出るはず');
  assert.equal(rows.at(-1)[0], '注意');
  assert.match(rows.at(-1)[3], /指摘の候補です/);
});

test('toCsv: 欄の中の CRLF も引用し、空の行も書ける', () => {
  assert.equal(toCsv([['a\r\nb'], []]), '﻿"a\r\nb"\r\n\r\n');
});

test('画面: 確認する前の CSV は書き出さず、案内を出す', async () => {
  const page = runPage();
  await page.click('csv-btn');
  assert.equal(page.blobs.length, 0);
  assert.match(page.text('export-status'), /確認する/);
});

test('画面: 確認のあとに条件を変えたら、前の結果は書き出さない', async () => {
  const page = runPage();
  await page.set('orderer', 'public'); await page.set('subcontract-total', '60,000,000');
  await page.click('bid-run');
  await page.set('subcontract-total', '10,000,000');
  await page.click('csv-btn');
  assert.equal(page.blobs.length, 0);
  assert.match(page.text('export-status'), /条件が変わりました/);
  await page.click('bid-run');
  await page.click('csv-btn');
  assert.equal(page.blobs.length, 1);
  assert.ok(page.blobs[0].parts.join('').startsWith('﻿区分,項目,状態'));
});

// F61a: 5つの行の作りと「注意」行
const NOTE = '架空の断り書きです';
const scheduleSample = [{ phase: 'start', when: '着手前', what: '架空の書類', to: '発注者', status: 'needed', basis: { doc: '架空の仕様書', section: '1-1', quote: '架空の抜き書き' } }];
const planSample = { candidates: [{ item: '架空の項目', message: '見出しが無い', basis: { doc: '架空の仕様書', section: '1-1', quote: '架空の抜き書き' } }] };

test('5つの行の作りすべて: notice を渡すと最後が「注意」行で、列の数は見出しと同じ(F61a)', () => {
  const bid = bidCheck(input);
  const cases = [
    ['stage1Rows', stage1Rows(bid, judgeTaicho(input), NOTE), COLUMNS],
    ['checkRows', checkRows({ candidates: [] }, NOTE), COLUMNS],
    ['scheduleRows', scheduleRows(scheduleSample, new Map(), null, NOTE), SCHEDULE_COLUMNS],
    ['planRows', planRows(planSample, null, NOTE), PLAN_COLUMNS],
    ['checklistRows', checklistRows({ rows: [] }, new Set(), NOTE), CHECKLIST_COLUMNS],
  ];
  for (const [name, rows, columns] of cases) {
    assert.equal(rows.at(-1)[0], '注意', name);
    assert.ok(rows.at(-1).join('').includes(NOTE), name + ': 断り書きが無い');
    for (const r of rows) assert.equal(r.length, columns.length, name + ': 列の数');
  }
});

test('段取りと目次: 断り書きは決まった列に入り、工種の行のあとに来る(F61a)', () => {
  const s = scheduleRows(scheduleSample, new Map(), 'doboku', NOTE);
  assert.equal(s.at(-1)[SCHEDULE_COLUMNS.indexOf('注意')], NOTE);
  assert.equal(s.at(-2)[0], '工種');
  const p = planRows(planSample, 'kenchiku', NOTE);
  assert.equal(p.at(-1)[PLAN_COLUMNS.indexOf('説明')], NOTE);
  assert.equal(p.at(-2)[0], '工種');
});

test('段取りと目次: notice を渡さなければ、渡したときの注意の行を除いた形と同じ(F61a)', () => {
  assert.deepEqual(scheduleRows(scheduleSample), scheduleRows(scheduleSample, new Map(), null, NOTE).slice(0, -1));
  assert.deepEqual(planRows(planSample), planRows(planSample, null, NOTE).slice(0, -1));
  assert.equal(scheduleRows(scheduleSample).length, scheduleSample.length + 1);
  assert.equal(planRows(planSample).length, planSample.candidates.length + 1);
  for (const rows of [scheduleRows(scheduleSample, new Map(), 'doboku'), planRows(planSample, 'kenchiku')]) {
    assert.ok(!rows.some((r) => r[0] === '注意'), '渡していないのに注意の行がある');
  }
});

test('bidRows: 行の数は項目の数 + 1 のまま(F61a は足さない)', () => {
  const bid = bidCheck(input);
  assert.equal(bidRows(bid).length, bid.items.length + 1);
  assert.ok(!bidRows(bid).some((r) => r[0] === '注意'));
});

test('画面: 段取りと目次の CSV の最後は「注意」行で、BOM・CRLF のまま(F61a)', async () => {
  const page = runPage();
  await page.click('entry-awarded');
  await page.click('schedule-csv-btn');
  await page.set('plan-input', '目次\n1. 工事概要');
  await page.click('plan-run');
  await page.click('plan-csv-btn');
  assert.equal(page.blobs.length, 2);
  for (const blob of page.blobs) {
    const csv = await blob.text();
    assert.ok(csv.startsWith('\uFEFF'), 'BOM が無い');
    // 引用符で囲んだ欄の中の改行は欄の中身なので、それを除いた行の区切りを見る
    const outside = csv.replace(/"(?:[^"]|"")*"/g, '');
    assert.ok(csv.endsWith('\r\n') && !/[^\r]\n/.test(outside), '行の区切りが CRLF でない');
    const last = csv.trim().split('\r\n').at(-1);
    assert.ok(last.startsWith('注意,'), last);
    assert.ok(last.includes('保証や合否ではありません'), last);
  }
});

test('画面: 入札前の CSV は、注意の行のあとに工種の行が続く(注意が最後なのは stage1Rows の中の話)', async () => {
  const page = runPage();
  await page.set('orderer', 'public'); await page.set('subcontract-total', '60,000,000');
  await page.click('bid-run');
  await page.click('csv-btn');
  const lines = (await page.blobs[0].text()).trim().split('\r\n');
  const at = lines.findIndex((l) => l.startsWith('注意,'));
  assert.ok(at > 0, '注意の行が無い');
  assert.ok(lines.slice(at + 1).some((l) => l.startsWith('工種,')), '注意の行のあとに工種の行が無い');
});

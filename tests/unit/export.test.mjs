// 書き出し(src/export.mjs)と、画面の印刷・CSV のつながりの単体テスト(値はすべて架空)
import test from 'node:test';
import assert from 'node:assert/strict';
import { toCsv, stage1Rows, COLUMNS, bidCheckRows } from '../../src/export.mjs';
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

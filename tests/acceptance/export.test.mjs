// F05e: 結果の印刷と CSV の書き出し(条件 F05-6)
import test from 'node:test';
import assert from 'node:assert/strict';
import { load, indexHtml, scriptsOf, hasId, articleLabel, runPage } from './_helpers.mjs';

const input = { orderer: 'public', direct: true, workType: 'other', contractAmount: 300000000, hasSubcontract: true, subcontractTotal: 60000000, license: 'tokutei', engineerQualification: 'kanri', ictMeasure: false };

test('toCsv: BOM つき UTF-8、CRLF、カンマ・引用符・改行を含む欄を引用する', async () => {
  const { toCsv } = await load('src/export.mjs');
  assert.equal(toCsv([['項目', '状態'], ['a,b', 'x"y'], ['1行目\n2行目', '']]),
    '﻿項目,状態\r\n"a,b","x""y"\r\n"1行目\n2行目",\r\n');
  assert.equal(toCsv([[1, null]]), '﻿1,\r\n');
});

test('bidRows・taichoRows: 見出しの行と、項目ごとの行(根拠の条と抜き書きを含む)', async () => {
  const { bidRows, taichoRows } = await load('src/export.mjs');
  const { bidCheck } = await load('src/bid-check.mjs');
  const { judgeTaicho } = await load('src/taicho.mjs');
  const bid = bidCheck(input);
  const rows = bidRows(bid);
  assert.equal(rows.length, bid.items.length + 1);
  for (const r of rows) assert.ok(Array.isArray(r) && r.length === rows[0].length, '列の数がそろっていない');
  bid.items.forEach((it, i) => {
    const line = rows[i + 1].join(' ');
    assert.ok(line.includes(it.label));
    for (const b of it.basis) { assert.ok(line.includes(articleLabel(b.article))); assert.ok(line.includes(b.quote)); }
  });
  const t = judgeTaicho(input);
  const tr = taichoRows(t);
  assert.ok(tr.length >= 2);
  assert.ok(tr.slice(1).map((r) => r.join(' ')).join('\n').includes(articleLabel(t.reasons[0].basis[0].article)));
});

test('画面に印刷と CSV の書き出しがあり、通信しない(Blob とダウンロード)', () => {
  const html = indexHtml();
  assert.ok(hasId(html, 'print-btn') && hasId(html, 'csv-btn'));
  const code = scriptsOf(html).map((s) => s.code).join('\n');
  assert.ok(/\bprint\s*\(\s*\)/.test(code), '印刷の呼び出しが無い');
  assert.ok(/new\s+Blob\b/.test(code) && /\.download\s*=|setAttribute\(\s*["']download/.test(code), 'ファイルに書き出す仕組みが無い');
  assert.ok(/@media\s+print/.test(html), '印刷用の CSS が無い');
  assert.ok(code.includes('bidRows') && code.includes('toCsv'), '書き出しが src/export.mjs を使っていない');
});

test('画面を動かす: 確認のあとに印刷のボタンで印刷が呼ばれ、CSV のボタンで BOM と見出しつきの CSV を書き出す', async () => {
  const page = runPage();
  await page.set('orderer', 'public'); await page.set('subcontract-total', '60,000,000');
  await page.click('bid-run');
  await page.click('print-btn');
  assert.equal(page.printed.count, 1, '印刷が呼ばれない');
  await page.click('csv-btn');
  const csv = page.blobs.map((b) => b.parts.join('')).find((t) => t.startsWith('﻿'));
  assert.ok(csv, 'BOM つきの CSV が書き出されない');
  assert.ok(csv.split('\r\n').length >= 3, 'CSV に見出しと行が無い');
});

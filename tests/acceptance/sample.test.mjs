// F05f: 見本の読み込みと、README の開き方・試し方(条件 F05-7・F05-8)
import test from 'node:test';
import assert from 'node:assert/strict';
import { load, exists, readText, indexHtml, hasId, runPage } from './_helpers.mjs';

test('SAMPLE: 画面の入力欄に入る架空の条件と、架空の書類(台帳・施工計画書の目次)', async () => {
  const { SAMPLE } = await load('src/sample.mjs');
  const html = indexHtml();
  assert.ok(SAMPLE.form && Object.keys(SAMPLE.form).length >= 6);
  for (const id of Object.keys(SAMPLE.form)) assert.ok(hasId(html, id), '見本の値の入る欄が画面に無い: ' + id);
  assert.ok(typeof SAMPLE.documents?.ledger === 'string' && SAMPLE.documents.ledger.length > 100, '見本の台帳が無い');
  assert.ok(typeof SAMPLE.documents?.planToc === 'string' && SAMPLE.documents.planToc.length > 30, '見本の目次が無い');
  const all = JSON.stringify(SAMPLE);
  assert.ok(/架空/.test(all), '架空であることが分からない');
  for (const m of all.matchAll(/[\w.+-]+@([\w-]+\.)+[\w-]+/g)) assert.ok(/@example\.(com|jp|org)$/.test(m[0]), '仮でないメール: ' + m[0]);
});

test('見本の条件で、入札前の確認と台帳が要るかがそのまま出る', async () => {
  const { SAMPLE } = await load('src/sample.mjs');
  const { readBidForm } = await load('src/ui/form.mjs');
  const { bidCheck } = await load('src/bid-check.mjs');
  const { judgeTaicho } = await load('src/taicho.mjs');
  const input = readBidForm(SAMPLE.form);
  const bid = bidCheck(input);
  assert.ok(bid.items.length >= 6);
  const t = judgeTaicho(input);
  assert.ok(['required', 'not_required', 'needs_check'].includes(t.status));
});

test('画面に「見本を読み込む」ボタンがあり、見本を組み込んでいる', () => {
  const html = indexHtml();
  assert.ok(hasId(html, 'sample-load'));
  assert.ok(html.includes('見本を読み込む'));
  assert.ok(html.includes('SAMPLE'), '見本のデータが画面に組み込まれていない');
});

test('画面を動かす: 「見本を読み込む」を押すと見本の値が欄に入り、そのまま確認できる', async () => {
  const { SAMPLE } = await load('src/sample.mjs');
  const page = runPage();
  await page.click('sample-load');
  for (const [id, v] of Object.entries(SAMPLE.form)) {
    const e = page.el(id);
    if (typeof v === 'boolean') assert.equal(e.checked, v, id);
    else assert.equal(String(e.value), String(v), id + ' に見本の値が入らない');
  }
  await page.click('bid-run');
  assert.ok(page.text('bid-result').trim().length > 0, '見本で確認しても結果が出ない');
});

test('README.md に開き方と試し方がある', () => {
  assert.ok(exists('README.md'));
  const md = readText('README.md');
  assert.ok(/^#+\s.*開き方/m.test(md), '開き方の見出しが無い');
  assert.ok(/^#+\s.*試し方/m.test(md), '試し方の見出しが無い');
  assert.ok(md.includes('index.html') && md.includes('見本を読み込む'));
});

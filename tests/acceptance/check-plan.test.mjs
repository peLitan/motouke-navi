// F07: 施工計画書の目次の点検(条件 F07-1)
import test from 'node:test';
import assert from 'node:assert/strict';
import { load, readJson, indexHtml, scriptsOf, hasId, quoteInText, norm, runPage } from './_helpers.mjs';
import { specSource, loadSources } from './_schedule-common.mjs';

test('記載項目の表: 共通仕様書 1-1-1-6 の項目ごとに、ページと原文の抜き書きがある', () => {
  const src = loadSources();
  const d = readJson('data/plan-items.json');
  assert.equal(d.section, '1-1-1-6');
  specSource(src, d.sourceId);
  assert.ok(Array.isArray(d.items) && d.items.length >= 10, '項目が少ない');
  for (const it of d.items) {
    assert.ok(it.id && it.label, '欄が足りない');
    assert.ok(Number.isInteger(it.page) && it.page > 0, 'ページが無い: ' + it.label);
    assert.ok(quoteInText(it.quote, src.texts[d.sourceId]), '原文に無い抜き書き: ' + it.label);
    assert.ok(norm(it.quote).includes(norm(it.label)), '抜き書きに項目名が無い: ' + it.label);
  }
});

test('全部の項目がある目次には候補を出さず、1つ抜くとその項目だけを根拠のページつきで出す', async () => {
  const { checkPlanToc } = await load('src/plan-check.mjs');
  const { items } = readJson('data/plan-items.json');
  const toc = (list) => '施工計画書 目次\n' + list.map((it, i) => `${i + 1}. ${it.label}`).join('\n');
  assert.deepEqual(checkPlanToc(toc(items)).candidates, []);
  for (const k of [0, Math.floor(items.length / 2), items.length - 1]) {
    const out = checkPlanToc(toc(items.filter((_, i) => i !== k)));
    assert.equal(out.candidates.length, 1, items[k].label + ' を抜いたとき: ' + JSON.stringify(out.candidates));
    const c = out.candidates[0];
    assert.equal(c.item, items[k].label);
    assert.equal(c.basis.section, '1-1-1-6');
    assert.equal(c.basis.page, items[k].page);
    assert.ok(/令和8年3月/.test(c.basis.doc));
  }
});

test('画面を動かす: 目次を貼って点検を押すと、抜けた項目が出る。CSV の行にもなる', async () => {
  const { items } = readJson('data/plan-items.json');
  const { checkPlanToc } = await load('src/plan-check.mjs');
  const { planRows } = await load('src/export.mjs');
  const k = Math.floor(items.length / 2);
  const toc = '目次\n' + items.filter((_, i) => i !== k).map((it, i) => `${i + 1}. ${it.label}`).join('\n');
  const page = runPage();
  await page.set('plan-input', toc);
  await page.click('plan-run');
  assert.ok(page.text('plan-result').includes(items[k].label), '抜けた項目が画面に出ない');
  const rows = planRows(checkPlanToc(toc));
  assert.equal(rows.length, 2);
  assert.ok(rows[1].join(' ').includes(items[k].label) && rows[1].join(' ').includes('1-1-1-6'));
});

test('画面に目次の入力と点検の結果の欄がある', async () => {
  const html = indexHtml();
  for (const id of ['plan-input', 'plan-run', 'plan-result']) assert.ok(hasId(html, id), 'id が無い: ' + id);
  assert.ok(scriptsOf(html).map((s) => s.code).join('\n').includes('checkPlanToc'));
  const { renderPlanResult } = await load('src/ui/view.mjs');
  const h = renderPlanResult({ candidates: [{ item: '架空の項目', basis: { doc: '土木工事共通仕様書(案)令和8年3月版', section: '1-1-1-6', page: 12, quote: '架空' } }] });
  assert.ok(h.includes('架空の項目') && h.includes('1-1-1-6') && h.includes('12'));
});

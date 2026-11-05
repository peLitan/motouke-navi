// F37a: 入口の3択と段の切り替え。段は hidden で1つずつ見せ、段階の表示は入口を選ぶまで押せない。印刷は段をまたいで全部出す
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildHtml } from '../../build.mjs';
import { runPage } from '../acceptance/_helpers.mjs';
import { showPanel, showEntry, openPanelForLink } from '../../src/ui/app.mjs';
import { SAMPLE } from '../../src/sample.mjs';

const html = buildHtml();
const body = html.slice(html.indexOf('<body>')).replace(/<script\b[\s\S]*?<\/script>/g, '');
const css = html.match(/<style>([\s\S]*?)<\/style>/)[1].replace(/\/\*[\s\S]*?\*\//g, '');
const printCss = css.match(/@media print \{([\s\S]*)\n {2}\}/)[1];
const PANELS = ['panel-1', 'panel-2', 'panel-3'];
const STEPS = ['step-1', 'step-2', 'step-3'];

// 開いている段の番号(1つだけのはず)
const shown = (page) => PANELS.filter((id) => !page.el(id).hidden);
const current = (page) => STEPS.filter((id) => page.el(id).getAttribute('aria-current') === 'step');
function assertOn(page, n) {
  assert.deepEqual(shown(page), ['panel-' + n]);
  assert.deepEqual(current(page), ['step-' + n]);
  for (const id of STEPS) assert.equal(page.el(id).disabled, false, id + ' が押せない');
  assert.equal(page.el('entry').hidden, true, '3択が残っている');
  assert.equal(page.el('entry-back').hidden, false);
}

test('開いた直後: 段は全部隠れ、段階は塗らず押せない。3択が見える', () => {
  for (const id of PANELS) assert.match(body, new RegExp('<section id="' + id + '" hidden>'), id);
  for (const id of STEPS) assert.match(body, new RegExp('<button type="button" id="' + id + '" disabled[ >]'), id);
  assert.ok(!/<ol class="steps"[\s\S]*?<\/ol>/.exec(body)[0].includes('aria-current'), '選ぶ前から印が付いている');
  assert.match(body, /<div id="entry">/, '3択が最初から隠れている');
  assert.match(body, /<button type="button" id="entry-back" hidden>/);
  const page = runPage();
  assert.deepEqual(shown(page), []);
  assert.deepEqual(current(page), []);
  for (const id of STEPS) assert.equal(page.el(id).disabled, true);
  // 押せない形は色でも分かる(塗らない)
  assert.match(css, /\.steps button:disabled \{[^}]*background: transparent/);
  assert.match(css, /\.steps button\[aria-current="step"\] \.step-dot \{[^}]*background: var\(--primary\)/);
});

test('段の中身: 既存の id はそれぞれの段にあり、1つだけ。断り書き・出典・取得日は段の外で常に見える', () => {
  const range = (id) => {
    const from = body.indexOf('<section id="' + id + '"');
    const to = id === 'panel-3' ? body.indexOf('id="other-tools"') : body.indexOf('<section id="panel-' + (Number(id.slice(-1)) + 1) + '"');
    return body.slice(from, to);
  };
  const has = (panel, id) => range(panel).includes('id="' + id + '"');
  for (const id of ['bid', 'bid-form', 'bid-run']) assert.ok(has('panel-1', id), id);
  for (const id of ['summary', 'bid-result', 'taicho-result', 'schedule-result', 'open-items', 'print-btn', 'csv-btn', 'sample-banner', 'next-step-3']) assert.ok(has('panel-2', id), id);
  for (const id of ['ledger-check', 'ledger-input', 'plan-check', 'plan-input', 'check-result', 'plan-result']) assert.ok(has('panel-3', id), id);
  const firstPanel = body.indexOf('<section id="panel-1"');
  const panelsEnd = body.indexOf('id="other-tools"');
  assert.ok(body.indexOf('id="disclaimer"') < firstPanel);
  assert.ok(body.indexOf('この画面は外部と通信しません') < firstPanel);
  assert.ok(body.indexOf('id="sources-dates"') > panelsEnd);
  assert.ok(body.indexOf('id="credits"') > panelsEnd);
  assert.ok(!/<section id="panel-\d"[^>]*no-print/.test(body), '段が印刷から外れている');
  const ids = [...body.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(ids.filter((x, i) => ids.indexOf(x) !== i), [], 'id が重なっている');
});

test('3択: それぞれの段が開き、1つだけ見える。段階は押せるようになる', async () => {
  let page = runPage();
  await page.click('entry-bid');
  assertOn(page, 1);
  page = runPage();
  await page.click('entry-awarded');
  assertOn(page, 2);
  page = runPage();
  await page.click('sample-load');
  assertOn(page, 2);
});

test('段の移り方: 確認する→段2、次へ→段3、段階のボタンで行き来でき、入口に戻ると選ぶ前の形になる', async () => {
  const page = runPage();
  await page.click('entry-bid');
  await page.click('bid-run');
  assertOn(page, 2);
  assert.ok(page.text('bid-result').length > 0, '結果が書かれない');
  await page.click('next-step-3');
  assertOn(page, 3);
  await page.click('step-1');
  assertOn(page, 1);
  await page.click('entry-back');
  assert.deepEqual(shown(page), []);
  assert.deepEqual(current(page), []);
  for (const id of STEPS) assert.equal(page.el(id).disabled, true);
  assert.equal(page.el('entry').hidden, false);
  assert.equal(page.el('entry-back').hidden, true);
});

test('showPanel・showEntry は要素が無い画面でも落ちない', () => {
  const doc = { getElementById: () => null };
  showPanel(doc, 2);
  showEntry(doc);
  openPanelForLink(doc, '#check-result');
});

test('隠れた段の中へのリンク: 行き先の段を開く。開いている段や段の外では何もしない', () => {
  const panels = { 'panel-2': { id: 'panel-2', hidden: false }, 'panel-3': { id: 'panel-3', hidden: true } };
  const targets = {
    'check-result': { closest: () => panels['panel-3'] },
    'summary': { closest: () => panels['panel-2'] },
    'mask': { closest: () => null },
  };
  const calls = [];
  const doc = { getElementById: (id) => targets[id] ?? panels[id] ?? null };
  const spy = new Proxy(doc, { get: (o, k) => (k === 'getElementById' ? (id) => { calls.push(id); return o.getElementById(id); } : o[k]) });
  openPanelForLink(spy, '#summary');
  assert.equal(panels['panel-3'].hidden, true);
  openPanelForLink(spy, '#mask');
  openPanelForLink(spy, '#無い');
  assert.equal(panels['panel-3'].hidden, true);
  openPanelForLink(spy, '#check-result');
  assert.equal(panels['panel-3'].hidden, false);
  assert.equal(panels['panel-2'].hidden, true);
});

test('リンクの受け取りは #main で委譲し、まとめの動的なリンクも通る', () => {
  assert.ok(/<main id="main">/.test(body));
  const page = runPage();
  const panel3 = page.el('panel-3');
  page.el('check-result').closest = () => panel3;
  const anchor = { getAttribute: () => '#check-result' };
  page.el('main').dispatchEvent({ type: 'click', bubbles: false, target: { closest: () => anchor } });
  assertOn(page, 3);
});

test('見本のあと: 「自分の工事で入れ直す」が見え、押すと見本の値と結果が消えて段1 が開く', async () => {
  const page = runPage();
  assert.equal(page.el('sample-banner').hidden, true, '見本の前から出ている');
  assert.match(body, /<div id="sample-banner" class="[^"]*no-print[^"]*" hidden>/);
  await page.click('sample-load');
  assert.equal(page.el('sample-banner').hidden, false);
  assert.ok(page.text('sample-status').includes('見本'));
  assert.equal(page.el('summary').hidden, false);
  assert.ok(page.text('bid-result').length > 0 && page.text('check-result').length > 0 && page.text('plan-result').length > 0);
  assert.ok(page.text('summary').includes('まとめ'));

  await page.click('sample-reenter');
  assertOn(page, 1);
  assert.equal(page.el('sample-banner').hidden, true);
  assert.equal(page.text('sample-status').trim(), '');
  assert.equal(page.el('summary').hidden, true);
  assert.equal(page.text('summary').trim(), '');
  assert.equal(page.el('sample-docs').hidden, true);
  // 欄は開いた直後の値に戻る(「選んでいない」のように最初から印の付いた欄も含む)
  const fresh = runPage();
  for (const [id, v] of Object.entries(SAMPLE.form)) {
    const el = page.el(id);
    if (typeof v === 'boolean') assert.equal(el.checked, fresh.el(id).checked, id);
    else assert.equal(String(el.value), String(fresh.el(id).value), id + ' に見本の値が残る');
  }
  assert.equal(page.el('ledger-input').value, '');
  assert.equal(page.el('plan-input').value, '');
  for (const id of ['bid-result', 'taicho-result', 'schedule-result', 'open-items', 'check-result', 'plan-result', 'checklist-result']) {
    assert.ok(!page.text(id).includes('架空'), id + ' に見本の結果が残る');
  }
  // 入れ直した後は、見本の結果を印刷・書き出しに使わない
  await page.click('csv-btn');
  assert.equal(page.blobs.length, 0, '見本の結果が書き出された');
  assert.ok(page.text('export-status').length > 0);
});

test('入れ直しても、見本のあとに自分で貼り替えた台帳と目次は消さない。見本の条件で出した台帳の点検は書き出さない', async () => {
  const page = runPage();
  await page.click('sample-load');
  await page.set('ledger-input', '工事名: 架空の自分の工事');
  await page.set('plan-input', '1. 工事概要');
  await page.click('sample-reenter');
  assert.equal(page.el('ledger-input').value, '工事名: 架空の自分の工事');
  assert.equal(page.el('plan-input').value, '1. 工事概要');
  await page.set('ledger-input', SAMPLE.documents.ledger);
  await page.click('ledger-run');
  await page.click('sample-reenter');
  assert.equal(page.el('ledger-input').value, '');
  await page.click('check-csv-btn');
  assert.equal(page.blobs.length, 0);
});

test('入れ直したあと、もう一度見本を読み込める', async () => {
  const page = runPage();
  await page.click('sample-load');
  await page.click('sample-reenter');
  await page.click('entry-back');
  await page.click('sample-load');
  assertOn(page, 2);
  assert.equal(page.el('sample-banner').hidden, false);
  assert.equal(page.el('summary').hidden, false);
  assert.ok(page.el('ledger-input').value.length > 0);
});

test('印刷: 隠れた段も紙に出す(CSS)。段を切り替えずに印刷が1回呼ばれる', async () => {
  for (const id of PANELS) assert.ok(printCss.includes('#' + id + '[hidden]'), id + ' が印刷の決まりに無い');
  assert.match(printCss, /#panel-1\[hidden\], #panel-2\[hidden\], #panel-3\[hidden\] \{ display: block; \}/);
  // 入口の枠・見本の知らせ・次へは紙に出さない
  assert.match(body, /<div class="start no-print" id="start">/);
  assert.match(body, /<div class="row no-print"><button type="button" id="next-step-3">/);
  const page = runPage();
  await page.click('sample-load');
  await page.click('print-btn');
  assert.equal(page.printed.count, 1);
  assertOn(page, 2);
});

test('07 の決まりは崩さない: 断り書き・PDL の表示・CSP で通信先無し・外部の読み込み無し・保存しない・index.html 1つ', () => {
  assert.ok(body.includes('id="disclaimer"'));
  assert.ok(body.includes('PDL1.0'));
  assert.match(html, /Content-Security-Policy" content="[^"]*default-src 'none'/);
  assert.ok(!/<(script|link|img)[^>]*\s(src|href)="https?:/i.test(html), '外部の読み込みがある');
  assert.ok(!/localStorage|sessionStorage|indexedDB|document\.cookie/.test(html), '保存の道がある');
  assert.equal(fs.readFileSync(new URL('../../index.html', import.meta.url), 'utf8'), html, 'index.html が作り直されていない');
});

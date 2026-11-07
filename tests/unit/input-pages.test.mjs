// F86g: 条件を5ページと確かめに分ける。値はすべて架空。1画面に収まるかは Edge でしか測れないので、ここでは測らない(統括)
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHtml } from '../../build.mjs';
import { runPage } from '../acceptance/_helpers.mjs';
import { CONFIRM_ROWS } from '../../src/ui/confirm.mjs';
import { PAGES, pageOfLink } from '../../src/ui/pager.mjs';

const html = buildHtml();
const body = html.slice(html.indexOf('<body>')).replace(/<script\b[\s\S]*?<\/script>/g, '');
const css = html.match(/<style>([\s\S]*?)<\/style>/)[1].replace(/\/\*[\s\S]*?\*\//g, '');
const screenCss = css.slice(0, css.indexOf('@media print'));
const panel1 = body.slice(body.indexOf('<section id="panel-1"'), body.indexOf('<section id="panel-confirm"'));
const confirmHtml = body.slice(body.indexOf('<section id="panel-confirm"'), body.indexOf('<section id="panel-2"'));

const ORDER = [
  ['pg-1', '発注者と立場'],
  ['pg-1-work', '工事の種類'],
  ['pg-1-amount', '金額'],
  ['pg-1-license', '許可と技術者'],
  ['pg-1-notice', '公告'],
];
// 確かめの行 → 欄のあるページ → 焦点が移る欄(役は何も選んでいないときの欄)
const FIELD_OF = {
  orderer: ['pg-1', 'orderer'],
  role: ['pg-1', 'direct-unset'],
  'work-type': ['pg-1-work', 'work-type'],
  'work-kind': ['pg-1-work', 'work-kind'],
  'contract-amount': ['pg-1-amount', 'contract-amount'],
  'subcontract-total': ['pg-1-amount', 'subcontract-total'],
  license: ['pg-1-license', 'license'],
  'engineer-qualification': ['pg-1-license', 'engineer-qualification'],
  'ict-measure': ['pg-1-license', 'ict-measure'],
  'participation-conditions': ['pg-1-notice', 'participation-conditions'],
};
const conditionPages = PAGES[1].map(([id]) => id);
const allPages = Object.values(PAGES).flat().map(([id]) => id);
const openPages = (page) => allPages.filter((id) => !page.el(id).hidden);
const pageHtml = (id) => {
  const at = conditionPages.indexOf(id);
  const from = panel1.indexOf('id="' + id + '"');
  const next = conditionPages[at + 1];
  return panel1.slice(from, next ? panel1.indexOf('id="' + next + '"') : panel1.length);
};
const clickLink = async (page, id) => {
  page.el('main').dispatchEvent({ type: 'click', bubbles: true, target: { closest: () => ({ getAttribute: () => '#' + id }) }, preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {} });
  await new Promise((r) => setTimeout(r));
};
const nextHref = (page) => page.el('result-top').innerHTML.match(/class="next-go" href="#([\w-]+)"/)[1];
const fillAll = async (page, over = {}) => {
  const values = { orderer: 'public', 'work-type': 'other', 'contract-amount': '50,000,000', 'subcontract-total': '10,000,000', license: 'tokutei', 'engineer-qualification': 'kanri', ...over };
  for (const [id, v] of Object.entries(values)) await page.set(id, v);
  await page.set('direct', true);
};

test('5ページの順: 07 の順で、DOM の順と同じ。.pg の見出しに名前がある', () => {
  assert.deepEqual(PAGES[1].map(([id, name]) => [id, name]), ORDER);
  const at = conditionPages.map((id) => panel1.indexOf('id="' + id + '"'));
  assert.ok(at.every((x) => x >= 0), JSON.stringify(at));
  assert.deepEqual(at, [...at].sort((a, b) => a - b));
  for (const [id, name, title] of PAGES[1]) assert.match(pageHtml(id), new RegExp('<h2 id="' + title + '" class="pg-title no-print" tabindex="-1">' + name + '</h2>'));
  // 最初のページの他は閉じて始まる
  for (const id of conditionPages.slice(1)) assert.match(panel1, new RegExp('class="pg" id="' + id + '" hidden'));
});

test('必須の欄と任意の欄のどれもが、どれか1つのページにある', () => {
  const must = [...panel1.matchAll(/<label for="([\w-]+)">[^<]*<span class="req req-must">/g)].map((m) => m[1]);
  assert.ok(must.length >= 6, must.join());
  const fields = [...must, 'orderer', 'direct', 'direct-sub', 'direct-unknown', 'direct-unset', 'work-kind', 'ict-measure', 'participation-conditions'];
  for (const id of new Set(fields)) {
    const on = conditionPages.filter((pg) => pageHtml(pg).includes(' id="' + id + '"'));
    assert.equal(on.length, 1, id + ' のページ: ' + on.join());
  }
  // 必須の印の付いた役の欄も数える
  assert.match(pageHtml('pg-1'), /<legend>元請けか下請けか<span class="req req-must">/);
});

test('form は1つのままで、5ページとも中にある(紙の順とタブの順のため)', () => {
  assert.equal(panel1.split('<form ').length - 1, 1);
  const open = panel1.indexOf('<form '), close = panel1.indexOf('</form>');
  for (const id of conditionPages) { const at = panel1.indexOf('id="' + id + '"'); assert.ok(open < at && at < close, id); }
});

for (const r of CONFIRM_ROWS) {
  test('「' + r.label + 'を変更」: 欄のあるページを開いて、欄へ焦点を移す', async () => {
    const [pg, field] = FIELD_OF[r.key];
    assert.ok(pageHtml(pg).includes(' id="' + field + '"'), field + ' が ' + pg + ' に無い');
    const page = runPage(html);
    await page.click('sample-load');
    if (r.key === 'role') await page.set('direct-unset', true); // 見本の役を外した形で見る
    if (r.key === 'role') { page.el('direct').checked = false; page.el('direct-sub').checked = false; page.el('direct-unknown').checked = false; }
    const calls = [];
    page.el(field).focus = (o) => calls.push(o);
    await page.click('confirm-change-' + r.key);
    assert.deepEqual(openPages(page), [pg]);
    assert.equal(page.el('panel-1').hidden, false);
    assert.equal(calls.length, 1, '焦点が移っていない');
    assert.equal(calls[0].preventScroll, true);
  });
}

test('金額の欄が「分からない」なら、その印へ焦点を移す(ページは金額)', async () => {
  const page = runPage(html);
  await page.click('entry-bid');
  await page.set('subcontract-total-unknown', true);
  await page.click('bid-run');
  const calls = [];
  page.el('subcontract-total-unknown').focus = (o) => calls.push(o);
  await page.click('confirm-change-subcontract-total');
  assert.deepEqual(openPages(page), ['pg-1-amount']);
  assert.equal(calls.length, 1);
});

test('公告: 入口の「公告を読み込む」は公告のページを開き、折りたたみを開いて、読み込みの口へ焦点を移す', async () => {
  const page = runPage(html);
  const calls = [];
  page.el('intake-load').focus = (o) => calls.push(o);
  await page.click('entry-intake');
  assert.deepEqual(openPages(page), ['pg-1-notice']);
  assert.equal(page.el('intake-more').open, true);
  assert.equal(calls.length, 1);
  for (const id of ['intake-more', 'intake-load', 'intake-status', 'intake-result', 'participation-conditions']) assert.ok(pageHtml('pg-1-notice').includes(' id="' + id + '"'), id);
  for (const pg of conditionPages.slice(0, -1)) assert.ok(!pageHtml(pg).includes('id="intake-more"'), pg);
});

test('公告: 読み込んだ知らせは、見えているページの欄に出て、右の席は「確認する」', async () => {
  const page = runPage(html);
  await page.click('entry-intake');
  page.el('intake-load').files = [{ name: '壊れた.json', text: async () => '{', size: 1, type: 'application/json' }];
  await page.set('intake-load', '');
  await new Promise((r) => setTimeout(r));
  assert.deepEqual(openPages(page), ['pg-1-notice']);
  assert.notEqual(page.el('intake-status').textContent, '');
  assert.equal(page.el('bid-run').hidden, false);
  assert.equal(page.el('pg-next').hidden, true);
});

test('公告: 別のページで枠の外に落としたら、公告のページへ移して知らせを見せる', async () => {
  const page = runPage(html);
  await page.click('entry-bid');
  assert.deepEqual(openPages(page), ['pg-1']);
  page.el('main').dispatchEvent({ type: 'drop', bubbles: true, target: { closest: () => null }, dataTransfer: { types: ['Files'], files: [{ name: '架空.json' }] }, preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {} });
  assert.deepEqual(openPages(page), ['pg-1-notice']);
  assert.match(page.el('intake-status').textContent, /この段の枠/);
  assert.equal(page.el('intake-more').open, true);
});

test('確かめ: 本文のボタンは閉じた折りたたみの中だけで、表は読むだけ', () => {
  const fold = confirmHtml.match(/<details class="fold" id="confirm-edit"><summary>条件を直す<\/summary>[\s\S]*?<\/details>/);
  assert.ok(fold, '閉じた #confirm-edit が無い');
  assert.ok(!confirmHtml.replace(fold[0], '').includes('<button'), '折りたたみの外にボタンがある');
  assert.equal(fold[0].match(/<button/g).length, 10);
  assert.ok(!/class="confirm-change"/.test(confirmHtml), '表に「変更」の列が残っている');
  assert.match(confirmHtml, /<div class="ref-frame">\s*<dl class="confirm" id="confirm-rows">/);
  assert.match(confirmHtml, /class="pg pg-framed" id="pg-confirm"/);
  assert.match(confirmHtml, /違うときは「条件を直す」から直せます/);
});

test('確かめ: 直して戻ると、折りたたみは閉じた形に戻り、表が新しい値になる', async () => {
  const page = runPage(html);
  await page.click('sample-load');
  page.el('confirm-edit').open = true;
  await page.click('confirm-change-contract-amount');
  await page.set('contract-amount', '40,000,000');
  await page.click('pg-next');
  await page.click('pg-next');
  await page.click('bid-run');
  assert.deepEqual(openPages(page), ['pg-confirm']);
  assert.equal(page.el('confirm-edit').open, false);
  assert.match(page.el('confirm-value-contract-amount').innerHTML, /40,000,000円/);
});

test('見本: 5ページを飛ばして確かめを開き、押すのは2回で要点に着く。「戻る」で公告のページが見える', async () => {
  const page = runPage(html);
  await page.click('sample-load');
  assert.deepEqual(openPages(page), ['pg-confirm']);
  await page.click('confirm-back');
  assert.deepEqual(openPages(page), ['pg-1-notice']);
  await page.click('bid-run');
  await page.click('confirm-go');
  assert.deepEqual(openPages(page), ['pg-2-top']);
  const direct = runPage(html);
  await direct.click('sample-load');
  await direct.click('confirm-go');
  assert.deepEqual(openPages(direct), ['pg-2-top']);
});

test('読めない金額: 要点の次にすることから金額のページに着き、誤りの文が見える', async () => {
  const page = runPage(html);
  await page.click('entry-bid');
  await fillAll(page, { 'contract-amount': 'abc' });
  await page.click('bid-run');
  await page.click('confirm-go');
  assert.deepEqual(openPages(page), ['pg-2-top']);
  assert.match(page.el('result-top').innerHTML, /金額の欄を直す/);
  await clickLink(page, nextHref(page));
  assert.deepEqual(openPages(page), ['pg-1-amount']);
  assert.ok(pageHtml('pg-1-amount').includes('id="contract-amount-error"'));
  assert.equal(page.el('contract-amount-error').hidden, false);
  assert.notEqual(page.el('contract-amount-error').textContent, '');
  // 「戻る」は押す前の要点へ
  await page.click('pg-back');
  assert.deepEqual(openPages(page), ['pg-2-top']);
});

test('未回答の欄: 次にすることは、その問いの欄のページへ着く(1つ目が許可なら許可のページ)', async () => {
  const page = runPage(html);
  await page.click('entry-bid');
  await fillAll(page, { license: '', 'engineer-qualification': '' });
  await page.click('bid-run');
  await page.click('confirm-go');
  await clickLink(page, nextHref(page));
  assert.deepEqual(openPages(page), ['pg-1-license']);
});

test('「もう一度「確認する」を押す」は、ボタンの出る公告のページへ着く', async () => {
  const page = runPage(html);
  await page.click('sample-load');
  await page.click('confirm-go');
  await page.set('contract-amount', '40,000,000');
  await clickLink(page, 'bid-run');
  assert.deepEqual(openPages(page), ['pg-1-notice']);
  assert.equal(page.el('bid-run').hidden, false);
});

test('リンクの行き先: 欄の id は欄のあるページへ。5ページのどれも表から引ける', () => {
  assert.deepEqual(pageOfLink('subcontract-total'), { group: 1, index: 2 });
  assert.deepEqual(pageOfLink('bid-run'), { group: 1, index: 4 });
  assert.deepEqual(pageOfLink('intake-more'), { group: 1, index: 4 });
  assert.deepEqual(pageOfLink('bid-form'), { group: 1, index: 0 });
  for (const [key, [pg]] of Object.entries(FIELD_OF)) assert.equal(PAGES[1][pageOfLink(key).index][0], pg, key);
});

test('安全の問いの「「条件を入れる」で直す」のリンクは、金額のページへ着く', async () => {
  const page = runPage(html);
  await page.click('sample-load');
  await page.click('confirm-go');
  await clickLink(page, 'subcontract-total');
  assert.deepEqual(openPages(page), ['pg-1-amount']);
});

test('紙: 見出しと頭の文は画面の決まりで隠すだけで紙に残る。ページの見出しは紙に出ない', () => {
  const bidAt = panel1.indexOf('id="bid-title"'), introAt = panel1.indexOf('<p class="print-only" id="bid-intro">'), formAt = panel1.indexOf('<form ');
  assert.ok(bidAt >= 0 && bidAt < introAt && introAt < formAt, '紙の順が変わった');
  assert.match(screenCss, /body\.in-pages #bid-title \{ display: none; \}/);
  // 頭の文は画面では折りたたみの中で読める(紙に二重に出さない)
  const sentence = panel1.match(/<p class="print-only" id="bid-intro">([^<]+)<\/p>/)[1];
  assert.match(sentence, /入札するかどうかは出しません/);
  const more = panel1.match(/<details class="fold" id="form-lead-more">[\s\S]*?<\/details>/)[0];
  assert.ok(more.includes('<p class="no-print">' + sentence + '</p>'));
  assert.equal(panel1.split(sentence).length - 1, 2);
});

test('枠: 段1 の入れ子も高さを渡し、背の低い画面の逃げ道にも載る', () => {
  assert.match(screenCss, /#bid:not\(\[hidden\]\), #bid-form:not\(\[hidden\]\) \{ flex: 1; overflow: hidden; display: flex; flex-direction: column; \}/);
  const low = screenCss.slice(screenCss.indexOf('@media screen and (max-height: 30rem)'));
  assert.match(low, /#bid-form:not\(\[hidden\]\)[^{]*\{ display: block;/);
});

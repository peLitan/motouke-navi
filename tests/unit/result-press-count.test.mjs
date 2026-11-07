// F86f: 結果のページの押せる物を減らす。飛ぶリンクは文にし、主の動作は1つにして、ほかは折りたたみへ移す。消さない。
// ブラウザが無いので見た目は測らない(押せる物の一覧の測り直しは統括)。ここでは組み立てた画面の HTML・CSS と、押したときの hidden を見る
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHtml } from '../../build.mjs';
import { runPage } from '../acceptance/_helpers.mjs';
import { openDetailsForPrint, openSummaryForPrint, restoreDetailsAfterPrint } from '../../src/ui/app.mjs';
import { renderBidResult } from '../../src/ui/view.mjs';
import { renderSafetyResult } from '../../src/ui/safety-view.mjs';

const html = buildHtml();
const body = html.slice(html.indexOf('<body>')).replace(/<script\b[\s\S]*?<\/script>/g, '');
const css = html.match(/<style>([\s\S]*?)<\/style>/)[1].replace(/\/\*[\s\S]*?\*\//g, '');
const printCss = css.slice(css.indexOf('@media print'));
// 架空の発注者の表(ui-rules-switch と同じ形)
const OWN = JSON.stringify({
  source: { publisher: '架空県', title: '架空の仕様書', edition: '令和9年1月' },
  rows: [{ kind: 'schedule', phase: 'start', when: '着手前', what: '架空の書類を出す', to: '監督員', section: '1-1', quote: '出す' }],
});
const PAGES = ['pg-2-top', 'pg-2-need', 'pg-2-open', 'pg-2-schedule', 'pg-2-safety', 'pg-2-candidates', 'pg-2-save'];
const pageHtml = (id) => {
  const from = body.indexOf('id="' + id + '"');
  const ends = [body.indexOf('<div class="pg', from), body.indexOf('</section>', from)].filter((x) => x > 0);
  return body.slice(from, Math.min(...ends));
};
// 入れ子の折りたたみも内側から順に除く
function outsideFolds(s) {
  let out = s;
  for (let prev; prev !== out;) { prev = out; out = out.replace(/<details\b(?:(?!<details\b)[\s\S])*?<\/details>/g, ''); }
  return out;
}
const count = (s, re) => (s.match(re) ?? []).length;
const presses = (s) => count(s, /<button\b/g) + count(s, /<a\b[^>]*href="#/g);
// 組み立てた HTML の中で、id の要素を囲む折りたたみの id(開いていて閉じていない <details> を数える)
function foldsAround(id) {
  const before = body.slice(0, body.indexOf('id="' + id + '"'));
  const stack = [];
  for (const m of before.matchAll(/<details\b([^>]*)>|<\/details>/g)) {
    if (m[0] === '</details>') stack.pop();
    else stack.push(m[1].match(/id="([^"]+)"/)?.[1] ?? '');
  }
  return stack;
}

async function samplePage() {
  const page = runPage(html);
  await page.click('sample-load');
  await page.click('confirm-go');
  return page;
}
const clickLink = async (page, id) => {
  page.el('main').dispatchEvent({ type: 'click', bubbles: true, target: { closest: () => ({ getAttribute: () => '#' + id }) }, preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {} });
  await new Promise((r) => setTimeout(r));
};
const goToPage = async (page, id) => { for (let i = 0; i < PAGES.indexOf(id); i++) await page.click('pg-next'); };
const shownPages = (page) => PAGES.filter((id) => !page.el(id).hidden);

// ---- (1) 飛ぶリンクを文に ----
test('見本の結果の #bid-result・#safety-result と、要るものから安全の候補までの結果に飛ぶ <a> が無い', async () => {
  const page = await samplePage();
  await page.click('safety-sub-yes');
  for (const id of ['bid-result', 'taicho-result', 'open-items', 'schedule-result', 'safety-result']) {
    const out = page.el(id).innerHTML;
    assert.ok(out.length > 100, id + ' が空');
    assert.equal(count(out, /<a\b[^>]*href="#/g), 0, id + ' に飛ぶ <a> がある: ' + (out.match(/<a\b[^>]*href="#[^>]*>[^<]*/) ?? [''])[0]);
  }
});

test('項目の「確認が要る点」の文: 画面はページの語で、紙の文は今のまま', () => {
  const bid = { items: [{ key: 'a', label: 'a', status: 'required', basis: [] }, { key: 'b', label: 'b', status: 'required', basis: [] }], checks: [{ key: 'a', label: 'a', message: 'x', changes: true }, { key: 'b', label: 'b', message: 'x' }] };
  const out = renderBidResult(bid);
  assert.equal(count(out, /<a\b/g), 0);
  const lines = out.match(/<p class="item-depends">[\s\S]*?<\/p>/g);
  assert.equal(lines.length, 2);
  const paper = (s) => s.replace(/<span class="no-print">[^<]*<\/span>/g, '').replace(/<[^>]+>/g, '');
  const screen = (s) => s.replace(/<[^>]+>/g, '');
  assert.deepEqual(lines.map(screen), ['＊ この「要る」は、次のページの「確認が要る点」の答えで変わることがあります。', '＊ この項目には次のページの「確認が要る点」があります。']);
  assert.deepEqual(lines.map(paper), ['＊ この「要る」は、確認が要る点の答えで変わることがあります。', '＊ この項目には確認が要る点があります。']);
});

test('候補の「分かると判断できます」の文: 画面は前のページの問いを指し、紙の文は今のまま', () => {
  const needs = [{ field: 'workers', label: '同じ場所で常時働く人の数', state: 'unknown' }];
  const candidates = [{ id: 'c1', status: 'needs_check', label: '候補1', needs, basis: [] }, { id: 'c2', status: 'needs_check', label: '候補2', needs, basis: [] }];
  const out = renderSafetyResult({ started: true, candidates, counts: { total: 2, needs_check: 2 }, notOnList: 'x' });
  assert.equal(count(out, /<a\b/g), 0);
  const first = out.slice(out.indexOf('id="c1"'), out.indexOf('id="c2"'));
  assert.ok(first.includes('＊「同じ場所で常時働く人の数」が分かると判断できます<span class="no-print">(前のページの問いで答えます)</span>'), first);
  const second = out.slice(out.indexOf('id="c2"'));
  assert.ok(second.includes('→ 上の「候補1」を見てください'), second);
  assert.ok(second.includes('<span class="print-inline">＊「同じ場所で常時働く人の数」が分かると判断できます</span>'), second);
});

// ---- 各ページの押せる物 ----
test('各ページの本文の折りたたみの外の押せる物が1つまで(見本の結果を描いたあと)', async () => {
  const page = await samplePage();
  const drawn = { 'pg-2-top': 'result-top', 'pg-2-need': 'bid-result', 'pg-2-open': 'open-items', 'pg-2-schedule': 'schedule-result', 'pg-2-candidates': 'safety-result' };
  for (const id of PAGES) {
    const fixed = presses(outsideFolds(pageHtml(id)));
    const inner = drawn[id] ? presses(outsideFolds(page.el(drawn[id]).innerHTML)) : 0;
    assert.ok(fixed + inner <= 1, id + ' の押せる物が ' + (fixed + inner));
  }
});

test('主の動作: 要点は次にすること、段取りは CSV、結果を残すは PDF で保存・印刷', async () => {
  const page = await samplePage();
  assert.equal(count(page.el('result-top').innerHTML, /class="next-go"/g), 1);
  assert.deepEqual(outsideFolds(pageHtml('pg-2-schedule')).match(/<button[^>]*id="[^"]+"/g).map((s) => s.match(/id="([^"]+)"/)[1]), ['schedule-csv-btn']);
  assert.deepEqual(outsideFolds(pageHtml('pg-2-save')).match(/<button[^>]*id="[^"]+"/g).map((s) => s.match(/id="([^"]+)"/)[1]), ['print-btn']);
});

// ---- (2) 段取り ----
test('段取り: 切り替えと知らせは「例を切り替える・自分の表を読み込む」の中。読み込んだ表の知らせは折りたたみの外', () => {
  assert.match(body, /<details class="fold no-print" id="rules-more"><summary>例を切り替える・自分の表を読み込む<\/summary>/);
  for (const id of ['rules-national', 'rules-wakayama', 'rules-clear', 'rules-status', 'rules-load']) assert.deepEqual(foldsAround(id), ['rules-more'], id);
  assert.deepEqual(foldsAround('rules-file-on'), []);
  assert.ok(pageHtml('pg-2-schedule').includes('id="rules-file-on"'));
});

test('読み込んだ表を使っている知らせは、折りたたみが閉じていても見える', async () => {
  const page = await samplePage();
  await goToPage(page, 'pg-2-schedule');
  assert.ok(!page.el('rules-more').open);
  assert.equal(page.el('rules-file-on').hidden, true);
  const input = page.el('rules-load');
  input.files = [{ size: OWN.length, text: async () => OWN }];
  input.dispatchEvent({ type: 'change' });
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(!page.el('rules-more').open);
  assert.equal(page.el('rules-file-on').hidden, false, page.el('rules-status').textContent);
});

test('例の切り替えの働きが残る', async () => {
  const page = await samplePage();
  await page.click('rules-wakayama');
  assert.equal(page.el('rules-wakayama').getAttribute('aria-pressed'), 'true');
  assert.match(page.el('schedule-notice').textContent, /7つの節だけ/);
  await page.click('rules-national');
  assert.equal(page.el('rules-national').getAttribute('aria-pressed'), 'true');
});

// ---- (3) 結果を残す ----
test('結果を残す: 全部の印刷と CSV は「ほかの残し方」の中、まとめは「まとめを見る」の中の枠、知らせは折りたたみの外', () => {
  assert.match(body, /<details class="fold" id="export-more"><summary>ほかの残し方<\/summary>/);
  assert.match(body, /<details class="fold" id="summary-fold" hidden><summary>まとめを見る<\/summary>\n<div class="ref-frame">\n<div id="summary"/);
  for (const id of ['print-all-btn', 'csv-btn']) assert.deepEqual(foldsAround(id), ['export-more'], id);
  assert.deepEqual(foldsAround('summary'), ['summary-fold']);
  for (const id of ['print-btn', 'export-status', 'export-lead']) assert.deepEqual(foldsAround(id), [], id);
  assert.ok(!/id="(export-more|summary-fold)"[^>]*\bopen\b/.test(body), '閉じて始まらない');
});

test('print-all-btn・csv-btn の働きが残り、知らせは折りたたみの外に出る', async () => {
  const page = await samplePage();
  await page.click('csv-btn');
  assert.match(page.el('export-status').textContent, /CSV をこの端末に保存しました/);
  await page.click('print-all-btn');
  assert.equal(page.printed.count, 1);
});

test('結果が無いときの「PDF で保存・印刷」の知らせが指す「全部を印刷する」が見えるよう、「ほかの残し方」を開く', async () => {
  const page = runPage(html);
  await page.click('print-btn');
  assert.match(page.el('export-status').textContent, /全部を印刷する/);
  assert.equal(page.el('export-more').open, true);
});

test('まとめの枠は結果が出るまで隠れ、結果が出ると見え、閉じて始まる', async () => {
  const page = runPage(html);
  assert.equal(page.el('summary-fold').hidden, true);
  await page.click('sample-load');
  await page.click('confirm-go');
  assert.equal(page.el('summary-fold').hidden, false);
  assert.ok(!page.el('summary-fold').open);
});

test('まとめの全部のリンクは id → ページの表に載り、押すと着いたページが見え、「戻る」で結果を残すへ帰る', async () => {
  const page = await samplePage();
  await goToPage(page, 'pg-2-save');
  const links = [...new Set([...page.el('summary').innerHTML.matchAll(/href="#([\w-]+)"/g)].map((m) => m[1]))];
  assert.ok(links.length >= 7, links.join(' '));
  for (const id of ['open-items', 'taicho-result', 'schedule-result', 'safety-heading', 'check-result', 'plan-result']) assert.ok(links.includes(id), id);
  const WHERE = { 'open-items': 'pg-2-open', 'taicho-result': 'pg-2-need', 'schedule-result': 'pg-2-schedule', 'safety-heading': 'pg-2-safety', 'check-result': 'pg-3-check', 'plan-result': 'pg-3-plan-result' }; // F86h: 書類を分けたので候補のページへ
  for (const id of links) {
    const want = WHERE[id] ?? (id.startsWith('bid-item-') ? 'pg-2-need' : null);
    assert.ok(want, '表に無い行き先: ' + id);
    await clickLink(page, id);
    assert.equal(page.el(want).hidden, false, id + ' で ' + want + ' が見えない');
    if (want.startsWith('pg-3')) assert.equal(page.el('panel-3').hidden, false, id);
    else assert.deepEqual(shownPages(page), [want], id);
    await page.click('pg-back');
    assert.equal(page.el('panel-2').hidden, false, id);
    assert.deepEqual(shownPages(page), ['pg-2-save'], id + ' の「戻る」');
  }
});

// ---- (4) 見本の帯 ----
test('見本の帯は要点から結果を残すの折りたたみ「見本について」へ移り、#field-note も結果を残すにある', () => {
  assert.ok(!pageHtml('pg-2-top').includes('id="sample-banner"'));
  assert.ok(!pageHtml('pg-2-top').includes('id="field-note"'));
  const save = pageHtml('pg-2-save');
  assert.ok(save.includes('id="field-note"'));
  assert.match(save, /<details class="fold no-print" id="sample-more"><summary>見本について<\/summary>\n<div id="sample-banner" class="sample-banner no-print" hidden>/);
  for (const id of ['sample-status', 'sample-reenter']) assert.deepEqual(foldsAround(id), ['sample-more'], id);
  // 見本でないときは見出しごと出さない
  assert.match(css, /#sample-more:has\(> #sample-banner\[hidden\]\) \{ display: none; \}/);
});

test('sample-reenter の働きが残る', async () => {
  const page = await samplePage();
  await page.click('sample-reenter');
  assert.equal(page.el('sample-banner').hidden, true);
  assert.equal(page.el('panel-1').hidden, false);
  assert.equal(page.el('panel-2').hidden, true);
});

// ---- (5) 段取りの全部の行 ----
test('段取りの全部の行: ページは段取りの1枚だけで、右の席は「条件を入れる」、「戻る」は入口', async () => {
  const page = runPage(html);
  await page.click('entry-awarded');
  assert.deepEqual(shownPages(page), ['pg-2-schedule']);
  assert.equal(page.el('awarded-notice').hidden, false);
  assert.equal(page.el('awarded-conditions').hidden, false);
  assert.equal(page.el('pg-next').hidden, true);
  assert.equal(page.el('next-step-3').hidden, true);
  assert.equal(page.el('pg-num').textContent, '');
  await page.click('pg-back');
  assert.equal(page.el('entry').hidden, false);
  await page.click('entry-awarded');
  await page.click('awarded-conditions');
  assert.equal(page.el('panel-1').hidden, false);
  assert.equal(page.el('awarded-conditions').hidden, true);
});

test('#awarded-conditions は下の帯の席にあり、ほかの席と同じ形', () => {
  const pager = body.slice(body.indexOf('id="pager"'), body.indexOf('</nav>', body.indexOf('id="pager"')));
  assert.ok(pager.includes('<button type="button" id="awarded-conditions" hidden>条件を入れる</button>'));
  assert.ok(!pageHtml('pg-2-schedule').includes('id="awarded-conditions"'));
  assert.match(css, /#pager #entry-back, #pager #awarded-conditions \{ margin-left: auto; \}/);
  assert.match(css, /#entry-back::after, #awarded-conditions::after \{/);
});

test('段取りの全部の行のページからも全部を印刷でき、知らせはそのページに出る', async () => {
  const page = runPage(html);
  await page.click('entry-awarded');
  assert.deepEqual(foldsAround('awarded-print-all'), ['awarded-print']);
  assert.ok(pageHtml('pg-2-schedule').includes('id="awarded-print-all"'));
  await page.click('awarded-print-all');
  assert.equal(page.printed.count, 1);
  assert.match(page.el('schedule-status').textContent, /結果がまだありません/);
});

test('結果があるときの「もう受注した方は」は今の一覧の4ページ目に着き、次へ進める', async () => {
  const page = await samplePage();
  await page.click('entry-awarded');
  assert.deepEqual(shownPages(page), ['pg-2-schedule']);
  assert.equal(page.el('pg-next').hidden, false);
  assert.equal(page.el('awarded-conditions').hidden, true);
  assert.equal(page.el('pg-num').textContent, '4/7');
});

test('全部の行のあとに条件を入れて結果を出すと、7ページに戻る', async () => {
  const page = runPage(html);
  await page.click('entry-awarded');
  await page.click('awarded-conditions');
  await page.click('bid-run');
  await page.click('confirm-go');
  assert.deepEqual(shownPages(page), ['pg-2-top']);
  assert.equal(page.el('pg-num').textContent, '1/7');
  await page.click('pg-next');
  assert.deepEqual(shownPages(page), ['pg-2-need']);
});

// ---- 紙 ----
test('紙: まとめの折りたたみは紙に出す物で、まとめの紙でも全部の紙でも開き、印刷のあと閉じ直す', () => {
  assert.ok(!/id="summary-fold"[^>]*no-print/.test(body));
  const fold = { open: false };
  const doc = { getElementById: (id) => (id === 'summary-fold' ? fold : null), querySelectorAll: () => [fold] };
  openSummaryForPrint(doc);
  assert.equal(fold.open, true);
  restoreDetailsAfterPrint();
  assert.equal(fold.open, false);
  openDetailsForPrint(doc);
  assert.equal(fold.open, true);
  restoreDetailsAfterPrint();
  // 枠を足しても紙の余白を増やさない
  assert.match(printCss, /details\.safety-fold, details#summary-fold \{ margin: 0; border: none; padding: 0; \}/);
});

test('紙: 画面だけの参照の文と語は紙に出ず、紙の文は残る', async () => {
  const page = await samplePage();
  await page.click('safety-sub-yes');
  const paper = (s) => s.replace(/<span class="see-(above|next)">[^<]*<\/span>/g, '').replace(/<(p|span) class="no-print">[^<]*<\/\1>/g, '').replace(/<(p|span) class="no-print"><\/\1>/g, '').replace(/<[^>]+>/g, '');
  const bid = paper(page.el('bid-result').innerHTML);
  const safety = paper(page.el('safety-result').innerHTML);
  assert.ok(!bid.includes('次のページ') && !safety.includes('前のページ'));
  assert.ok(bid.includes('確認が要る点の答えで変わることがあります'), '項目の文が紙から消えた');
  // 画面で参照の行にした文は、紙では候補ごとに残る
  for (const s of ['技能講習を修了した者などのうちから作業主任者', '第十四条の義務は「事業者」に掛かります']) assert.ok(safety.split(s).length - 1 >= 2, s);
  // 確認が要る点の全文は紙の一覧に残り、まとめは紙から隠さない
  assert.match(page.el('bid-result').innerHTML, /<div class="print-only"><ul class="checks">/);
  assert.ok(page.el('open-items').innerHTML.length > 500);
  assert.ok(!/id="(summary|summary-fold)"[^>]*no-print/.test(body));
  assert.equal(page.el('summary').hidden, false);
});

// F86d: 結果を7ページに分ける。画面の順は pager.mjs の PAGES だけで決め、DOM の順(紙の順)は変えない。
// ブラウザが無いので、1画面に収まるかは測らない(Edge の確かめは統括)。ここでは組み立てた画面の HTML・CSS と、押したときの hidden を見る
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHtml } from '../../build.mjs';
import { runPage } from '../acceptance/_helpers.mjs';
import { PAGES, pageOfLink } from '../../src/ui/pager.mjs';
import { handleFileDrop } from '../../src/ui/app.mjs';

const html = buildHtml();
const body = html.slice(html.indexOf('<body>')).replace(/<script\b[\s\S]*?<\/script>/g, '');
const css = html.match(/<style>([\s\S]*?)<\/style>/)[1].replace(/\/\*[\s\S]*?\*\//g, '');
const printCss = css.slice(css.indexOf('@media print'));
const screenCss = css.slice(0, css.indexOf('@media print'));
const panel = body.slice(body.indexOf('<section id="panel-2"'), body.indexOf('<section id="panel-3"'));

// 名前と見出しと、そのページにある id(07 の F86d)
const RESULT_PAGES = [
  ['pg-2-top', '要点', 'result-title', ['bid-status', 'result-top']],
  ['pg-2-need', '要るもの', 'need-title', ['bid-fold', 'bid-result', 'taicho-result']],
  ['pg-2-open', '確認が要る点', 'open-title', ['open-items']],
  ['pg-2-schedule', '受注後の段取り', 'schedule-heading', ['schedule-frame', 'schedule-result', 'schedule-csv-btn']],
  ['pg-2-safety', '安全の問い', 'safety-heading', ['safety-note', 'safety-fold', 'safety-questions', 'safety-status']],
  ['pg-2-candidates', '安全の候補', 'safety-result-title', ['safety-result', 'safety-version']],
  ['pg-2-save', '結果を残す', 'save-title', ['summary', 'export-status', 'print-btn', 'print-all-btn', 'csv-btn']],
];
const pageIds = RESULT_PAGES.map((p) => p[0]);
// そのページの開くタグから次の .pg の開くタグの手前まで
function pageHtml(id) {
  const at = panel.indexOf('id="' + id + '"');
  assert.ok(at >= 0, id + ' が無い');
  const next = panel.slice(at + 1).search(/<div class="pg[ "]/);
  return next < 0 ? panel.slice(at) : panel.slice(at, at + 1 + next);
}
const visible = (page) => pageIds.filter((id) => !page.el(id).hidden);
// #main の中のリンクを押す。受けるのは #main なので、押された要素の形だけ渡す
const clickLink = async (page, id) => {
  page.el('main').dispatchEvent({ type: 'click', bubbles: true, target: { closest: () => ({ getAttribute: () => '#' + id }) }, preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {} });
  await new Promise((r) => setTimeout(r));
};
async function sampleResult() {
  const page = runPage(html);
  await page.click('sample-load');
  await page.click('confirm-go');
  return page;
}

test('PAGES: 結果は7ページで、順と名前と見出しは決めたとおり', () => {
  assert.deepEqual(PAGES[2], RESULT_PAGES.map(([id, name, title]) => [id, name, title]));
});

test('各ページに見出しと 07 に挙げた id があり、見出しは焦点を受ける', () => {
  for (const [id, , title, ids] of RESULT_PAGES) {
    const h = pageHtml(id);
    assert.match(h, new RegExp('<h[23]\\b[^>]*\\bid="' + title + '"[^>]*\\btabindex="-1"'), title);
    for (const inner of ids) assert.ok(h.includes('id="' + inner + '"'), id + ' に ' + inner + ' が無い');
  }
});

test('紙の順は DOM の順のまま: 確認が要る点は DOM では安全の後ろで、画面の順だけが前に来る', () => {
  const order = ['result-title', 'bid-status', 'brief-note', 'result-top', 'bid-fold', 'bid-result', 'taicho-result',
    'schedule-heading', 'work-kind-schedule', 'awarded-notice', 'schedule-notice', 'schedule-about-fold', 'schedule-result', 'schedule-csv-btn',
    'safety-heading', 'safety-note', 'safety-prime-note', 'safety-fold', 'safety-questions', 'safety-status', 'safety-result', 'safety-version',
    'open-items', 'field-note', 'export-lead', 'print-btn', 'print-all-btn', 'csv-btn', 'summary', 'sample-banner', 'sample-docs'];
  const at = order.map((id) => panel.indexOf('id="' + id + '"'));
  at.forEach((n, i) => { assert.ok(n >= 0, order[i]); if (i) assert.ok(at[i - 1] < n, order[i - 1] + ' → ' + order[i]); });
  assert.ok(panel.indexOf('id="pg-2-candidates"') < panel.indexOf('id="pg-2-open"'), '#open-items を DOM で動かしている');
  assert.ok(panel.indexOf('id="pg-2-open"') < panel.indexOf('id="pg-2-save"'));
});

test('画面だけの見出しは紙に出さない。紙に出す物に文を足していない', () => {
  for (const id of ['need-title', 'open-title', 'safety-result-title', 'save-title']) {
    assert.match(panel, new RegExp('<h[23]\\b[^>]*id="' + id + '"[^>]*class="[^"]*no-print|<h[23]\\b[^>]*class="[^"]*no-print[^"]*"[^>]*id="' + id + '"'), id);
  }
});

test('見本の結果で7ページを順に押し、戻るで順に帰る。最後の右の席は「次へ: 書類を確かめる」', async () => {
  const page = await sampleResult();
  for (let i = 0; i < 7; i++) {
    assert.deepEqual(visible(page), [pageIds[i]], (i + 1) + ' ページ目');
    assert.equal(page.el('pg-num').textContent, (i + 1) + '/7');
    assert.equal(page.el('pg-name').textContent, RESULT_PAGES[i][1]);
    assert.ok(page.text(RESULT_PAGES[i][2]).length > 0, RESULT_PAGES[i][2] + ' が空');
    if (i < 6) {
      assert.equal(page.el('pg-next').hidden, false);
      assert.equal(page.el('pg-next').textContent, '次へ: ' + RESULT_PAGES[i + 1][1]);
      assert.equal(page.el('next-step-3').hidden, true);
      await page.click('pg-next');
    }
  }
  assert.equal(page.el('pg-next').hidden, true);
  assert.equal(page.el('next-step-3').hidden, false);
  await page.click('next-step-3');
  assert.equal(page.el('panel-3').hidden, false);
  await page.click('pg-back');
  assert.deepEqual(visible(page), ['pg-2-save'], '書類の「戻る」は結果の最後のページへ');
  for (let i = 5; i >= 0; i--) {
    await page.click('pg-back');
    assert.deepEqual(visible(page), [pageIds[i]]);
  }
  await page.click('pg-back');
  assert.equal(page.el('panel-confirm').hidden, false, '結果の1ページ目の「戻る」は確かめへ');
});

test('見本の結果の中身は、それぞれのページの要素に書かれる', async () => {
  const page = await sampleResult();
  assert.match(page.text('bid-result'), /受注したら要るもの/);
  assert.match(page.text('taicho-result'), /台帳/);
  assert.match(page.text('open-items'), /確認が要る点/);
  assert.match(page.text('schedule-result'), /受注後の段取りは/);
  assert.match(page.text('safety-result'), /土止め支保工/);
  assert.match(page.text('summary'), /入れた条件/);
});

test('2つの折りたたみは閉じて始まり、そのページを開くと開く。見出しは画面で隠し紙の決まりは変えない', async () => {
  for (const id of ['bid-fold', 'safety-fold']) {
    assert.doesNotMatch(body.match(new RegExp('<details[^>]*id="' + id + '"[^>]*>'))[0], /\sopen/, id);
  }
  const page = await sampleResult();
  page.el('bid-fold').open = false;
  assert.ok(!page.el('safety-fold').open, '安全の問いのページの前に開いている');
  await page.click('pg-next');
  assert.equal(page.el('bid-fold').open, true, '要るもののページで開かない');
  for (let i = 0; i < 3; i++) await page.click('pg-next');
  assert.deepEqual(visible(page), ['pg-2-safety']);
  assert.equal(page.el('safety-fold').open, true, '安全の問いのページで開かない');
  assert.match(screenCss, /body\.in-pages #bid-fold > summary, body\.in-pages #safety-fold > summary \{ display: none; \}/);
  assert.doesNotMatch(printCss, /in-pages/);
});

test('安全の問いを変えると、その場で次のページの候補と題と知らせが変わる。問いと知らせは同じページにある', async () => {
  const page = await sampleResult();
  for (let i = 0; i < 4; i++) await page.click('pg-next');
  assert.deepEqual(visible(page), ['pg-2-safety']);
  const before = page.text('safety-result');
  const title = page.text('safety-result-title');
  assert.equal(title, page.text('safety-title'), '候補のページの題が折りたたみの題と違う');
  await page.set('safety-work-shoring', false);
  assert.notEqual(page.text('safety-result'), before, '候補が変わらない');
  assert.match(page.text('safety-status'), /候補を描き直しました/);
  assert.equal(page.text('safety-result-title'), page.text('safety-title'), '問いを変えても題が合っていない');
  await page.click('pg-next');
  assert.deepEqual(visible(page), ['pg-2-candidates']);
});

test('要るものは枠で動かさない(作者の答え): 項目は1行で、根拠は閉じた「根拠を見る」の中', async () => {
  assert.ok(!pageHtml('pg-2-need').includes('ref-frame'), '要るもののページに枠がある');
  assert.match(screenCss, /#bid-result \.item:has\(> details\.basis:not\(\[open\]\)\) > \.item-next \{ display: none; \}/);
  assert.doesNotMatch(printCss, /item-next[^{}]*\{[^{}]*display: none/);
  const page = await sampleResult();
  const out = page.el('bid-result').innerHTML;
  assert.ok(out.includes('<details class="basis">'));
  assert.ok(!/<details class="basis" open/.test(out), '根拠が開いて始まる');
  assert.match(out, /<h4>[^<]+: <span class="status">/);
});

test('枠: 確認が要る点・段取り・安全の問い・安全の候補は枠の中で動き、段取りの CSV のボタンは枠の外', () => {
  for (const id of ['pg-2-open', 'pg-2-schedule', 'pg-2-safety', 'pg-2-candidates']) assert.ok(pageHtml(id).includes('class="ref-frame"'), id);
  const frame = pageHtml('pg-2-schedule').match(/<div class="ref-frame" id="schedule-frame">([\s\S]*?)\n<\/div>/);
  assert.ok(frame && frame[1].includes('id="schedule-result"'), frame?.[1]);
  assert.ok(!frame[1].includes('schedule-csv-btn'), 'CSV のボタンが枠の中にある');
  const flex = screenCss.match(/([^{}]*)\{ display: flex; flex-direction: column; \}/g).join('');
  assert.match(flex, /\.pg-framed:not\(\[hidden\]\)/);
  for (const id of ['pg-2-open', 'pg-2-schedule', 'pg-2-safety', 'pg-2-candidates']) assert.match(panel, new RegExp('<div class="pg pg-framed" id="' + id + '"'), id);
  // 背の低い画面では枠も外す
  const low = screenCss.slice(screenCss.indexOf('@media screen and (max-height: 30rem)'));
  assert.match(low, /\.pg-framed:not\(\[hidden\]\)[^{}]*\{ display: block; overflow: visible; \}/);
});

test('まとめの紙: 折りたたみの外へ移った候補と版の行も隠す', () => {
  const rule = printCss.match(/body\.print-brief #lead,[^{}]*\{/)[0];
  for (const id of ['safety-result', 'safety-version', 'safety-fold']) assert.ok(rule.includes('body.print-brief #' + id), id);
});

test('飛び先: 結果の中のリンクは行き先のあるページへ替わり、閉じた折りたたみを開く', async () => {
  const cases = { 'open-items': 'pg-2-open', 'bid-result': 'pg-2-need', 'taicho-result': 'pg-2-need', 'bid-item-x': 'pg-2-need', 'schedule-heading': 'pg-2-schedule', 'schedule-result': 'pg-2-schedule',
    'safety-fold': 'pg-2-safety', 'safety-heading': 'pg-2-safety', 'safety-q-works': 'pg-2-safety', 'safety-result': 'pg-2-candidates', summary: 'pg-2-save' };
  for (const [id, pg] of Object.entries(cases)) assert.equal(PAGES[2][pageOfLink(id).index][0], pg, id);
  assert.deepEqual(pageOfLink('check-result'), { group: 3, index: 0 }, 'F86f: まとめのリンクの行き先は全部表に載せる');
  // 表の id はどれも実際にそのページにある(動的な項目の id と問いの id の頭を除く)
  for (const [id, pg] of Object.entries(cases)) {
    if (id === 'bid-item-x') continue;
    assert.ok(pageHtml(pg).includes('id="' + id + '"'), id);
  }
  const page = await sampleResult();
  const links = [...page.el('result-top').innerHTML.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]);
  assert.ok(links.includes('open-items'), links.join());
  page.el('safety-fold').open = false;
  await clickLink(page, 'safety-fold');
  assert.deepEqual(visible(page), ['pg-2-safety']);
  assert.equal(page.el('safety-fold').open, true);
  await clickLink(page, 'open-items');
  assert.deepEqual(visible(page), ['pg-2-open']);
});

test('「もう受注した」: 段取りのページに着き、知らせとボタンがそのページで見える', async () => {
  const page = runPage(html);
  await page.click('entry-awarded');
  assert.deepEqual(visible(page), ['pg-2-schedule']);
  assert.equal(page.el('awarded-notice').hidden, false);
  assert.equal(page.el('awarded-conditions').hidden, false); // F86f: ボタンは下の帯の右の席
  assert.equal(page.el('bid-fold').open, false, '段取りのページで入札前の確認を開いている');
  assert.equal(page.el('pg-num').textContent, '', 'F86f: 一覧は段取りの1ページだけ');
});

test('「もう受注した」: 金額を読めないときは、失敗の文のある要点のページに着く', async () => {
  const page = runPage(html);
  await page.set('contract-amount', '約2億円');
  await page.click('bid-run');
  await page.click('entry-back');
  await page.click('entry-awarded');
  assert.deepEqual(visible(page), ['pg-2-top']);
  assert.match(page.text('bid-status'), /金額の欄を読めませんでした/);
});

test('結果のページで枠の外にファイルを置くと、段取りのページへ移って知らせを見せる', async () => {
  const els = {};
  const doc = {
    getElementById: (id) => (els[id] ??= { id, hidden: /^panel-|^entry$/.test(id) && id !== 'panel-2', open: false, focus() {}, scrollIntoView() {}, textContent: '', parentNode: null, classList: { add() {}, remove() {} }, setAttribute() {}, removeAttribute() {}, getAttribute: () => null, querySelector: () => null }),
    body: { classList: { add() {}, remove() {} } },
  };
  await handleFileDrop(doc, { target: { id: 'body', parentNode: null, getAttribute: () => null }, preventDefault() {}, dataTransfer: { types: ['Files'], files: [{ name: '公告.pdf', size: 1, text: async () => 'x' }] } });
  assert.equal(doc.getElementById('pg-2-schedule').hidden, false);
  assert.equal(doc.getElementById('pg-2-top').hidden, true);
  assert.match(doc.getElementById('rules-status').textContent, /この段の枠/);
});

test('形の決まり: <body> の字のまま、CSS の order を使わず、@media print は1つ', () => {
  assert.ok(html.includes('<body>'));
  assert.doesNotMatch(css, /(^|[;{\s])order:/);
  assert.equal(css.split('@media print').length - 1, 1);
});

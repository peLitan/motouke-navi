// F86a: ページの枠と下の帯。段は1つずつのページとして動き、順は src/ui/pager.mjs の PAGES だけで決める。
// ブラウザが無いので、1画面に収まるかは測らない(Edge の確かめは統括)。ここでは組み立てた画面の HTML・CSS と、押したときの hidden を見る
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHtml } from '../../build.mjs';
import { runPage } from '../acceptance/_helpers.mjs';

const html = buildHtml();
const shell = html.slice(html.indexOf('<body'));
const body = shell.replace(/<script\b[\s\S]*?<\/script>/g, '');
const css = html.match(/<style>([\s\S]*?)<\/style>/)[1].replace(/\/\*[\s\S]*?\*\//g, '');
const printCss = css.match(/@media print \{([\s\S]*)\n {2}\}/)[1];
const screenCss = css.slice(0, css.indexOf('@media print'));
const pager = () => import('../../src/ui/pager.mjs');

const SEATS = ['pg-next', 'bid-run', 'confirm-go', 'next-step-3', 'ledger-run', 'plan-run', 'mask-run', 'entry-back'];
const allPages = async () => Object.values((await pager()).PAGES).flat().map(([id]) => id);
const seen = (page, ids) => ids.filter((id) => !page.el(id).hidden);
// 右の席は1つだけ見える。bid-run などの主のボタンも同じ席に出る
function assertSeat(page, id) {
  assert.equal(page.el('pager').hidden, false, '下の帯が隠れている');
  assert.deepEqual(seen(page, SEATS), [id]);
}
async function assertOn(page, pg, seat) {
  assert.deepEqual(seen(page, await allPages()), [pg]);
  assertSeat(page, seat);
  assert.equal(page.el('entry').hidden, true, '入口が残っている');
}
function assertEntry(page) {
  assert.equal(page.el('entry').hidden, false);
  assert.equal(page.el('pager').hidden, true, '入口に下の帯が出ている');
  for (const id of ['panel-1', 'panel-2', 'panel-3', 'panel-confirm']) assert.equal(page.el(id).hidden, true, id);
}

test('PAGES: どの id も HTML に1つずつあり、.pg はどれか1つの一覧に載る', async () => {
  const ids = await allPages();
  assert.deepEqual(ids.filter((x, i) => ids.indexOf(x) !== i), [], '一覧に重なりがある');
  for (const id of ids) {
    assert.match(id, /^pg-/);
    assert.equal(body.split('id="' + id + '"').length - 1, 1, id);
  }
  const pg = [...body.matchAll(/<[a-z]+\b[^>]*\bclass="(?:[^"]*\s)?pg(?:\s[^"]*)?"[^>]*>/g)].map((m) => m[0].match(/\bid="([^"]+)"/)?.[1]);
  assert.ok(pg.length >= 5, '.pg が足りない');
  assert.deepEqual([...pg].sort(), [...ids].sort());
});

test('見出し: どのページも頭に焦点を受ける見出しがある', async () => {
  const { PAGES } = await pager();
  for (const [id, , title] of Object.values(PAGES).flat()) {
    assert.ok(title, id + ' の見出しの id が無い');
    assert.match(body, new RegExp('<h[23]\\b[^>]*\\bid="' + title + '"[^>]*\\btabindex="-1"|<h[23]\\b[^>]*\\btabindex="-1"[^>]*\\bid="' + title + '"'), id);
    const pgAt = body.indexOf('id="' + id + '"');
    const at = body.indexOf('id="' + title + '"');
    assert.ok(at > pgAt, title + ' がページより前にある');
  }
});

test('押していくと順にページが替わり、右の席のボタンは1つだけ見える(入口から書類まで)', async () => {
  const page = runPage(html);
  assertEntry(page);
  await page.click('entry-bid');
  await assertOn(page, 'pg-1', 'pg-next'); // F86g: 条件は5ページなので、右の席は最後のページまで「次へ」
  for (let i = 0; i < 4; i++) await page.click('pg-next');
  await assertOn(page, 'pg-1-notice', 'bid-run');
  await page.click('bid-run');
  await assertOn(page, 'pg-confirm', 'confirm-go');
  await page.click('confirm-go');
  await assertOn(page, 'pg-2-top', 'pg-next');
  await page.click('next-step-3');
  await assertOn(page, 'pg-3', 'pg-next'); // F86h: 書類は6ページで、2/6 と 5/6 の右の席は点検のボタン
  await page.click('pg-next');
  await assertOn(page, 'pg-3-diagram', 'ledger-run');
  await page.click('ledger-run');
  await assertOn(page, 'pg-3-check', 'pg-next');
  await page.click('pg-next');
  await assertOn(page, 'pg-3-table', 'pg-next');
  await page.click('pg-next');
  await assertOn(page, 'pg-3-plan', 'plan-run');
  await page.click('plan-run');
  await assertOn(page, 'pg-3-plan-result', 'entry-back');
  await page.click('entry-back');
  assertEntry(page);
});

test('見本で入口から書類まで押して進める。結果と書類の中身が出る', async () => {
  const page = runPage(html);
  await page.click('sample-load');
  await assertOn(page, 'pg-confirm', 'confirm-go');
  await page.click('confirm-go');
  await assertOn(page, 'pg-2-top', 'pg-next');
  assert.ok(page.text('bid-result').length > 0, '結果が書かれない');
  await page.click('next-step-3');
  await assertOn(page, 'pg-3', 'pg-next');
  assert.ok(page.el('ledger-input').value.length > 0, '見本の台帳が入っていない');
});

test('戻るの行き先: 条件 → 入口、確かめ → 条件、結果 → 確かめ、書類 → 結果。確かめの左の席は confirm-back', async () => {
  const page = runPage(html);
  await page.click('sample-load');
  await page.click('confirm-go');
  await page.click('next-step-3');
  await assertOn(page, 'pg-3', 'pg-next');
  assert.equal(page.el('pg-back').hidden, false);
  assert.equal(page.el('confirm-back').hidden, true);
  await page.click('pg-back');
  await assertOn(page, 'pg-2-save', 'next-step-3');
  for (let i = 0; i < 6; i++) await page.click('pg-back'); // F86d: 結果は7ページなので、最後のページから1ページ目まで戻る
  await page.click('pg-back');
  await assertOn(page, 'pg-confirm', 'confirm-go');
  assert.equal(page.el('pg-back').hidden, true, '確かめに「戻る」が2つある');
  assert.equal(page.el('confirm-back').hidden, false);
  await page.click('confirm-back');
  await assertOn(page, 'pg-1-notice', 'bid-run'); // F86g: 確かめの「戻る」は条件の最後のページへ
  assert.equal(page.el('confirm-back').hidden, true);
  for (let i = 0; i < 4; i++) await page.click('pg-back');
  await assertOn(page, 'pg-1', 'pg-next');
  await page.click('pg-back');
  assertEntry(page);
});

test('戻った確かめのページは、今の値を書き直している', async () => {
  const page = runPage(html);
  await page.click('sample-load');
  await page.click('confirm-go');
  await page.set('contract-amount', '123456789');
  await page.click('pg-back');
  assert.match(page.text('confirm-value-contract-amount'), /123,?456,?789/);
});

test('別の道具: 入口の「文の置き換え(別の道具)」でページになり、最後のページの右の席は入口に戻る。戻ると閉じて入口に帰る', async () => {
  const page = runPage(html);
  const tools = page.el('other-tools');
  await page.click('entry-tools');
  await assertOn(page, 'pg-tools', 'mask-run'); // F86i: 4ページに分けた
  assert.equal(page.el('panel-tools').hidden, false);
  await page.click('mask-run');
  await page.click('pg-next');
  await page.click('pg-next');
  await assertOn(page, 'pg-tools-ai', 'entry-back');
  for (let i = 0; i < 3; i += 1) await page.click('pg-back');
  await assertOn(page, 'pg-tools', 'mask-run');
  await page.click('pg-back');
  assertEntry(page);
  assert.equal(tools.open, false, '開いたまま入口に戻った');
  assert.equal(page.el('panel-tools').hidden, true, '入口に別の道具の枠が残っている');
});

test('別の道具: 段のページの間は隠れ、全部の印刷が折りたたみを開いてもページは替わらない', async () => {
  const page = runPage(html);
  await page.click('sample-load');
  await page.click('confirm-go');
  assert.equal(page.el('panel-tools').hidden, true);
  await page.click('print-all-btn');
  const tools = page.el('other-tools');
  tools.open = true;
  tools.dispatchEvent({ type: 'toggle', bubbles: false });
  await assertOn(page, 'pg-2-top', 'pg-next');
});

test('ページを替えると頭へ戻り、見出しへ焦点を移す(画面は動かさない)', async () => {
  const page = runPage(html);
  const calls = [];
  page.el('who-title').focus = (o) => calls.push(o); // F86g: 段の見出しは紙のためのもので、ページの見出しは別にある
  page.el('pg-1').scrollTop = 500;
  await page.click('entry-bid');
  assert.equal(page.el('pg-1').scrollTop, 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].preventScroll, true);
});

test('#main のリンクは既定の動きを止めてページを替え、行き先へ動かす', async () => {
  const page = runPage(html);
  await page.click('sample-load');
  await page.click('confirm-go');
  const panel3 = page.el('panel-3');
  const moved = [];
  page.el('check-result').closest = () => panel3;
  page.el('check-result').scrollIntoView = (o) => moved.push(o.block);
  let stopped = 0;
  const anchor = { getAttribute: () => '#check-result' };
  page.el('main').dispatchEvent({ type: 'click', bubbles: false, preventDefault: () => { stopped += 1; }, target: { closest: () => anchor } });
  assert.equal(stopped, 1);
  assert.deepEqual(moved, ['start']);
  await assertOn(page, 'pg-3-check', 'pg-next'); // F86h: 候補は書類 3/6
});

test('一覧に2ページ以上あるときの動き: 次へ・前へ・端で外へ・今のページの覚え・右の席の文', async () => {
  const { PAGES, showPage, pageStep, currentPage, backTarget, seatOf } = await pager();
  const saved = PAGES[1];
  const els = {};
  const el = (id) => (els[id] ??= { id, hidden: false, scrollTop: 9, textContent: '', focus() {}, setAttribute() {}, removeAttribute() {} });
  const doc = { getElementById: el };
  PAGES[1] = [['pg-x', '甲', 'x-title'], ['pg-y', '乙', 'y-title'], ['pg-z', '丙', 'z-title']];
  try {
    showPage(doc, 1, 0);
    assert.equal(seatOf(1, 0), 'pg-next');
    assert.equal(seatOf(1, 2), 'bid-run');
    assert.equal(el('pg-next').hidden, false);
    assert.equal(el('bid-run').hidden, true);
    assert.equal(el('pg-next').textContent, '次へ: 乙');
    assert.equal(el('pg-num').textContent + ' ' + el('pg-name').textContent, '1/3 甲'); // F86b: 幅 40rem 以下で名前だけ隠すので分けた
    assert.deepEqual(backTarget(), { group: null, index: 0 });
    pageStep(doc, 1);
    assert.deepEqual(currentPage(), { group: 1, index: 1 });
    assert.deepEqual([el('pg-x').hidden, el('pg-y').hidden, el('pg-z').hidden], [true, false, true]);
    assert.equal(el('pg-y').scrollTop, 0);
    assert.deepEqual(backTarget(), { group: 1, index: 0 });
    pageStep(doc, 1);
    assert.equal(el('pg-next').hidden, true);
    assert.equal(el('bid-run').hidden, false);
    let out = 0;
    pageStep(doc, 1, () => { out += 1; });
    assert.equal(out, 1, '端で外へ出ていない');
    assert.deepEqual(currentPage(), { group: 1, index: 2 });
    showPage(doc, 2, 0);
    assert.deepEqual(backTarget(), { group: 'confirm', index: 0 });
    showPage(doc, 'confirm', 0);
    assert.deepEqual(backTarget(), { group: 1, index: 2 }, '確かめの戻り先は条件の最後のページ');
    showPage(doc, 3, 0);
    assert.deepEqual(backTarget(), { group: 2, index: PAGES[2].length - 1 });
    showPage(doc, 'tools', 0);
    assert.deepEqual(backTarget(), { group: null, index: 0 });
  } finally {
    PAGES[1] = saved;
  }
});

test('要素が無い画面でも落ちない', async () => {
  const { showPage, hidePages, pageStep } = await pager();
  const none = { getElementById: () => null };
  showPage(none, 1, 0);
  pageStep(none, 1);
  hidePages(none);
});

test('枠の CSS: 高さを固定して全体を動かさず、.pg の中で縦に動く。背の低い画面では固定を外す', () => {
  assert.match(screenCss, /@media screen \{[\s\S]*?html, body \{ height: 100vh; height: 100dvh; overflow: hidden; \}/);
  assert.match(screenCss, /\.pg:not\(\[hidden\]\) \{ flex: 1; overflow-y: auto;/);
  const low = screenCss.match(/@media screen and \(max-height: 30rem\) \{([\s\S]*?)\n {2}\}/);
  assert.ok(low, '背の低い画面の決まりが無い');
  assert.match(low[1], /html, body \{ height: auto; overflow: visible; \}/);
  assert.match(low[1], /\.pg:not\(\[hidden\]\) \{ overflow-y: visible; \}/);
});

test('帯の CSS: 上下の順は DOM のまま(order を使わない)。古い帯の決まりが無い', () => {
  assert.ok(!/(?<![-\w])order\s*:/.test(css), 'order がある');
  assert.ok(!css.includes('.step-next'), '.step-next の決まりが残っている');
  assert.ok(!body.includes('step-next'), 'step-next の行が残っている');
  assert.match(screenCss, /#pg-back::before, #confirm-back::before \{/);
  for (const id of ['#pg-next', '#bid-run', '#confirm-go', '#next-step-3', '#entry-back']) assert.match(screenCss, new RegExp('#pager [^{]*' + id + '|' + id + '::after'), id);
});

test('帯の HTML: 紙に出ず、席のボタンの文字を変えていない', () => {
  const nav = body.match(/<nav\b[^>]*id="pager"[^>]*>[\s\S]*?<\/nav>/);
  assert.ok(nav, '#pager が無い');
  assert.match(nav[0], /class="[^"]*no-print/);
  assert.match(nav[0], /\bhidden\b/);
  assert.match(nav[0], /aria-label="ページの移動"/);
  assert.match(nav[0], /<button type="button" id="pg-back">戻る<\/button>/);
  for (const id of ['pg-next', 'bid-run', 'confirm-go', 'next-step-3', 'entry-back', 'confirm-back']) assert.ok(nav[0].includes('id="' + id + '"'), id);
  assert.ok(nav[0].includes('>確認する</button>'));
  assert.ok(nav[0].includes('>この内容で結果を見る</button>'));
  assert.ok(!/aria-live/.test(nav[0]), '読み上げの枠を増やしている');
});

test('紙: 隠れたページの文も紙に出し、overflow を外す。印刷の決まりは1つのまま', () => {
  assert.equal((css.match(/@media print/g) ?? []).length, 1);
  assert.match(printCss, /\.pg\[hidden\], #panel-ref\[hidden\], #panel-tools\[hidden\] \{ display: block; \}/);
  assert.match(printCss, /\.pg \{ overflow: visible; \}/);
  // 紙の外の規則が隠れたページを消さない
  for (const m of printCss.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (/display: none/.test(m[2])) assert.ok(!m[1].split(',').map((s) => s.trim()).some((s) => s === '.pg' || s === '.pg[hidden]'), m[1]);
  }
});

test('<body> の字は今のまま(クラスは JS で足す)', async () => {
  assert.ok(html.includes('<body>\n'), '<body> の字が変わった');
  const page = runPage(html);
  await page.click('entry-bid');
  const doc = page.el('main').ownerDocument;
  assert.equal(doc.body.classList.contains('in-pages'), true);
  await page.click('pg-back');
  assert.equal(doc.body.classList.contains('in-pages'), false);
});

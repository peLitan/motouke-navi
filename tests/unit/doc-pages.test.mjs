// F86h: 書類を6ページに分ける。値はすべて架空。1画面に収まるかは Edge でしか測れないので、ここでは測らない(統括)
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHtml } from '../../build.mjs';
import { runPage } from '../acceptance/_helpers.mjs';
import { PAGES, pageOfLink, seatOf } from '../../src/ui/pager.mjs';
import { handleFileDrop, showPanel } from '../../src/ui/app.mjs';

const html = buildHtml();
const body = html.slice(html.indexOf('<body>')).replace(/<script\b[\s\S]*?<\/script>/g, '');
const css = html.match(/<style>([\s\S]*?)<\/style>/)[1].replace(/\/\*[\s\S]*?\*\//g, '');
const screenCss = css.slice(0, css.indexOf('@media print'));
const printCss = css.slice(css.indexOf('@media print'));
const panel3 = body.slice(body.indexOf('<section id="panel-3"'), body.indexOf('<section id="panel-tools"'));

const ORDER = [
  ['pg-3', '台帳を入れる'],
  ['pg-3-diagram', '施工体系図'],
  ['pg-3-check', '台帳の候補'],
  ['pg-3-table', '記載事項の表'],
  ['pg-3-plan', '目次を入れる'],
  ['pg-3-plan-result', '目次の候補'],
];
const ids = ORDER.map(([id]) => id);
const allPages = Object.values(PAGES).flat().map(([id]) => id);
const openPages = (page) => allPages.filter((id) => !page.el(id).hidden);
const pageHtml = (id) => {
  const from = panel3.indexOf('id="' + id + '"');
  const next = ids[ids.indexOf(id) + 1];
  return panel3.slice(from, next ? panel3.indexOf('id="' + next + '"') : panel3.length);
};
const SEATS = ['pg-next', 'bid-run', 'confirm-go', 'next-step-3', 'awarded-conditions', 'ledger-run', 'plan-run', 'entry-back'];
const shownSeats = (page) => SEATS.filter((id) => !page.el(id).hidden);
const toDocs = async () => {
  const page = runPage(html);
  await page.click('sample-load');
  await page.click('confirm-go');
  await page.click('next-step-3');
  return page;
};
const clickLink = async (page, id) => {
  page.el('main').dispatchEvent({ type: 'click', bubbles: true, target: { closest: () => ({ getAttribute: () => '#' + id }) }, preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {} });
  await new Promise((r) => setTimeout(r));
};
const buttonsOutsideFolds = (part) => [...part.replace(/<details[\s\S]*?<\/details>/g, '').matchAll(/<button[^>]*id="([\w-]+)"/g)].map((m) => m[1]);

test('6ページの順: 07 の順で、DOM の順と同じ。どのページの頭にも焦点の移る見出しがある', () => {
  assert.deepEqual(PAGES[3].map(([id, name]) => [id, name]), ORDER);
  const at = ids.map((id) => panel3.indexOf('id="' + id + '"'));
  assert.ok(at.every((x) => x >= 0), JSON.stringify(at));
  assert.deepEqual(at, [...at].sort((a, b) => a - b));
  for (const [id, , title] of PAGES[3]) assert.match(pageHtml(id).slice(0, 200), new RegExp('<h[23] id="' + title + '"[^>]* tabindex="-1">'), id);
  // 最初のページのほかは閉じて始まる
  for (const id of ids.slice(1)) assert.match(panel3, new RegExp('class="pg[^"]*" id="' + id + '" hidden'), id);
});

test('右の席: 2/6 が台帳を点検する、5/6 が目次を点検する、6/6 が入口に戻る、ほかは次へ', async () => {
  assert.deepEqual(ids.map((_, i) => seatOf(3, i)), ['pg-next', 'ledger-run', 'pg-next', 'pg-next', 'plan-run', 'entry-back']);
  const page = await toDocs();
  assert.deepEqual(openPages(page), ['pg-3']);
  assert.deepEqual(shownSeats(page), ['pg-next']);
  assert.equal(page.el('pg-next').textContent, '次へ: 施工体系図');
  await page.click('pg-next');
  assert.deepEqual(openPages(page), ['pg-3-diagram']);
  assert.deepEqual(shownSeats(page), ['ledger-run']);
  await page.click('ledger-run');
  assert.deepEqual(openPages(page), ['pg-3-check']);
  assert.deepEqual(shownSeats(page), ['pg-next']);
  assert.equal(page.el('pg-next').textContent, '次へ: 記載事項の表');
  await page.click('pg-next');
  assert.deepEqual(openPages(page), ['pg-3-table']);
  assert.equal(page.el('pg-next').textContent, '次へ: 目次を入れる');
  await page.click('pg-next');
  assert.deepEqual(openPages(page), ['pg-3-plan']);
  assert.deepEqual(shownSeats(page), ['plan-run']);
  await page.click('plan-run');
  assert.deepEqual(openPages(page), ['pg-3-plan-result']);
  assert.deepEqual(shownSeats(page), ['entry-back']);
});

test('2つの点検のボタンは下の帯にあり、席の印(▶・右へ寄せる)を持ち、ページの本文に残っていない', () => {
  const nav = body.slice(body.indexOf('<nav class="no-print" id="pager"'), body.indexOf('</nav>', body.indexOf('id="pager"')));
  for (const id of ['ledger-run', 'plan-run']) {
    assert.match(nav, new RegExp('id="' + id + '"'), id);
    assert.ok(!panel3.includes('id="' + id + '"'), id);
    assert.match(screenCss, new RegExp('#pager #pg-next,[^{]*#pager #' + id + '[^{]*\\{ margin-left: auto; \\}'), id);
    assert.match(screenCss, new RegExp('#' + id + '::after[^{]*\\{ content: "\\\\00A0\\\\25B6"'), id);
  }
});

test('戻る: 順に前のページへ。書類 1/6 は結果 7/7 へ', async () => {
  const page = await toDocs();
  for (let i = 0; i < 3; i += 1) await page.click(i === 1 ? 'ledger-run' : 'pg-next');
  await page.click('pg-next');
  assert.deepEqual(openPages(page), ['pg-3-plan']);
  for (const want of ['pg-3-table', 'pg-3-check', 'pg-3-diagram', 'pg-3']) {
    await page.click('pg-back');
    assert.deepEqual(openPages(page), [want]);
  }
  await page.click('pg-back');
  assert.deepEqual(openPages(page), ['pg-2-save']);
});

test('空のまま押しても候補のページへ進み、そのページに今の空の知らせが出る', async () => {
  const page = runPage(html);
  await page.click('entry-awarded');
  await page.set('ledger-input', '');
  await page.set('plan-input', '');
  await page.click('ledger-run');
  assert.deepEqual(openPages(page), ['pg-3-check']);
  assert.equal(page.el('check-status').textContent, '＊ 台帳の文が空です。');
  assert.match(page.el('check-result').innerHTML, /台帳を貼るか、入口の「まず見本で試す」を押してください。/);
  await page.click('plan-run');
  assert.deepEqual(openPages(page), ['pg-3-plan-result']);
  assert.equal(page.el('plan-status').textContent, '＊ 目次が空です。');
  assert.match(page.el('plan-result').innerHTML, /施工計画書の目次を貼るか、入口の「まず見本で試す」を押してください。/);
  assert.ok(pageHtml('pg-3-check').includes('id="check-status"') && pageHtml('pg-3-plan-result').includes('id="plan-status"'));
});

test('欄と知らせはそのページにある: ファイルを読んだ知らせは枠と同じページ、点検の知らせは結果と同じページ', () => {
  const WHERE = {
    'pg-3': ['ledger-file', 'ledger-file-status', 'ledger-unreadable', 'ledger-input'],
    'pg-3-diagram': ['taikeizu-input', 'taikeizu-note'],
    'pg-3-check': ['check-csv-btn', 'check-status', 'check-result'],
    'pg-3-table': ['checklist-csv-btn', 'checklist-status', 'checklist-result'],
    'pg-3-plan': ['plan-about-fold', 'work-kind-plan', 'plan-notice', 'plan-file', 'plan-file-status', 'plan-input'],
    'pg-3-plan-result': ['plan-csv-btn', 'plan-status', 'plan-result'],
  };
  for (const [pg, list] of Object.entries(WHERE)) for (const id of list) {
    assert.deepEqual(ids.filter((p) => pageHtml(p).includes('id="' + id + '"')), [pg], id);
  }
  // 記載事項の節は表のページを包む(紙の節のため)
  assert.match(panel3, /<div id="checklist-section">\n<div class="pg pg-framed" id="pg-3-table" hidden>/);
});

test('枠の外に置いた知らせ: 見ているページの側の欄に書き、その欄のあるページを開く', async () => {
  const fresh = () => {
    const els = new Map();
    const get = (id) => { if (!els.has(id)) els.set(id, { id, hidden: true, value: '', textContent: '', classList: { add() {}, remove() {}, toggle() {} }, setAttribute() {}, removeAttribute() {}, getAttribute: () => null, querySelector: () => null, focus() {}, scrollIntoView() {} }); return els.get(id); };
    return { getElementById: get, body: null };
  };
  const outside = (doc) => handleFileDrop(doc, { target: { closest: () => null }, preventDefault() {}, dataTransfer: { types: ['Files'], files: [{ name: 'a.json', size: 2, text: async () => '{}' }] } });
  // [開いているページ, 知らせの欄, 着くページ]
  const CASES = [[5, 'plan-file-status', 'pg-3-plan'], [4, 'plan-file-status', 'pg-3-plan'], [2, 'ledger-file-status', 'pg-3'], [0, 'ledger-file-status', 'pg-3']];
  for (const [index, want, pg] of CASES) {
    const doc = fresh();
    showPanel(doc, 3, index);
    await outside(doc);
    const other = want === 'plan-file-status' ? 'ledger-file-status' : 'plan-file-status';
    assert.match(doc.getElementById(want).textContent, /^読み込んでいません。/, String(index));
    assert.equal(doc.getElementById(other).textContent, '', String(index));
    assert.equal(doc.getElementById(pg).hidden, false, String(index));
  }
});

test('見本: 候補のページに候補が出て、記載事項の表が出る', async () => {
  const page = await toDocs();
  await page.click('pg-next');
  await page.click('ledger-run');
  assert.match(page.el('check-result').innerHTML, /根拠|候補/);
  assert.doesNotMatch(page.el('check-result').innerHTML, /押してください。<\/p>$/);
  await page.click('pg-next');
  assert.match(page.el('checklist-result').innerHTML, /<table/);
  await page.click('pg-next');
  await page.click('plan-run');
  assert.match(page.el('plan-result').innerHTML, /候補|抜け|見当たり/);
  assert.doesNotMatch(page.el('plan-result').innerHTML, /目次を貼って「目次を点検する」/);
});

test('参照物は枠の中: 3つの結果は .ref-frame の中で、ページは枠の形', () => {
  for (const [pg, result] of [['pg-3-check', 'check-result'], ['pg-3-table', 'checklist-result'], ['pg-3-plan-result', 'plan-result']]) {
    assert.match(panel3, new RegExp('class="pg pg-framed" id="' + pg + '" hidden'), pg);
    assert.match(pageHtml(pg), new RegExp('<div class="ref-frame">\\s*<div id="' + result + '"'), result);
  }
  // 節で切らずに高さを渡す。紙ではこの決まりは効かない
  assert.match(screenCss, /#ledger-check, #plan-check, #checklist-section \{ display: contents; \}/);
  assert.doesNotMatch(printCss, /display: contents/);
  // 枠とカードの線を二重にしない
  assert.match(screenCss, /#check-result, #checklist-result, #plan-result \{ --shadow: none; margin-bottom: 0; border: none; padding: 0; \}/);
});

test('CSV の働きが残り、各ページの主の動作は1つ(本文の折りたたみの外のボタン)', async () => {
  const PRIMARY = { 'pg-3': [], 'pg-3-diagram': [], 'pg-3-check': ['check-csv-btn'], 'pg-3-table': ['checklist-csv-btn'], 'pg-3-plan': [], 'pg-3-plan-result': ['plan-csv-btn'] };
  for (const [pg, want] of Object.entries(PRIMARY)) assert.deepEqual(buttonsOutsideFolds(pageHtml(pg)), want, pg);
  const page = await toDocs();
  await page.click('pg-next');
  await page.click('ledger-run');
  await page.click('check-csv-btn');
  assert.equal(page.blobs.length, 1);
  await page.click('pg-next');
  await page.click('checklist-csv-btn');
  assert.equal(page.blobs.length, 2);
  await page.click('pg-next');
  await page.click('plan-run');
  await page.click('plan-csv-btn');
  assert.equal(page.blobs.length, 3);
  assert.ok(!page.el('check-status').textContent.startsWith('＊'), page.el('check-status').textContent);
});

test('まとめのリンク: 候補と表のページへ替わり、「戻る」で結果を残すへ帰る', async () => {
  assert.deepEqual(pageOfLink('check-result'), { group: 3, index: 2 });
  assert.deepEqual(pageOfLink('checklist-result'), { group: 3, index: 3 });
  assert.deepEqual(pageOfLink('plan-result'), { group: 3, index: 5 });
  assert.deepEqual(pageOfLink('panel-3'), { group: 3, index: 0 });
  const page = await toDocs();
  await page.click('pg-back');
  assert.deepEqual(openPages(page), ['pg-2-save']);
  await clickLink(page, 'plan-result');
  assert.deepEqual(openPages(page), ['pg-3-plan-result']);
  await page.click('pg-back');
  assert.deepEqual(openPages(page), ['pg-2-save']);
});

test('場所を取る物: スマホの注記は折りたたみの中で、書く欄の高さは画面の決まりだけ', () => {
  const page1 = pageHtml('pg-3');
  const note = page1.indexOf('id="panel-3-pc-note"');
  assert.ok(note > 0);
  assert.ok(page1.lastIndexOf('<details', note) > page1.lastIndexOf('</details>', note), '#panel-3-pc-note が折りたたみの中に無い');
  assert.match(page1, /<p id="panel-3-pc-note" class="note phone-only no-print">/);
  // 目次の説明の文: 紙は今の場所のまま(print-only)、画面は閉じた折りたたみの中。#plan-about-fold は読み込んだ表で隠れるので、その外に置く
  const plan = pageHtml('pg-3-plan');
  const onPaper = plan.match(/<p id="plan-intro" class="print-only">([^<]*)<\/p>/)[1];
  const onScreen = plan.match(/<details class="fold no-print" id="plan-lead-more"><summary>[^<]*<\/summary>\n<p>([^<]*)<\/p>\n<\/details>/)[1];
  assert.equal(onPaper, onScreen);
  assert.ok(onPaper.includes('仕様書の記載事項(建築・電気工事・管工事は 1.2.2 の3つの語)'));
  assert.ok(plan.indexOf('id="plan-intro"') < plan.indexOf('id="plan-about-fold"'));
  assert.match(screenCss, /#ledger-input \{ height: 14rem; \}/);
  assert.match(screenCss, /#plan-input \{ height: 8rem; \}/);
  assert.match(screenCss, /@media screen and \(max-width: 40rem\) \{\s*#ledger-input \{ height: 9rem; \}/);
  assert.doesNotMatch(printCss, /#ledger-input|#plan-input/);
});

test('紙の順: 段3 の紙に出る物は分ける前の順のまま。.pg の隠れたページも紙に出る', () => {
  const order = ['ledger-title', 'ledger-file-note', 'ledger-input', 'taikeizu-input', 'taikeizu-note', 'check-status', 'check-result', 'checklist-section', 'checklist-reference', 'checklist-status', 'checklist-result', 'plan-intro', 'plan-about', 'work-kind-plan', 'plan-notice', 'plan-input', 'plan-status', 'plan-result'];
  const at = order.map((id) => panel3.indexOf('id="' + id + '"'));
  assert.ok(at.every((x) => x >= 0), JSON.stringify(at));
  assert.deepEqual(at, [...at].sort((a, b) => a - b));
  assert.match(printCss, /\.pg\[hidden\], #panel-ref\[hidden\], #panel-tools\[hidden\] \{ display: block; \}/);
  // 分けても断り書きと紙の案内は消えていない
  assert.ok(panel3.includes('id="panel-3-print-note"'));
});

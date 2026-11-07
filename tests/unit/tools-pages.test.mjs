// F86i: 別の道具を4ページに分ける。値はすべて架空。1画面に収まるかは Edge でしか測れないので、ここでは測らない(統括)
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHtml } from '../../build.mjs';
import { runPage } from '../acceptance/_helpers.mjs';
import { PAGES, seatOf, pageOfLink } from '../../src/ui/pager.mjs';
import { handleFileDrop, openTools } from '../../src/ui/app.mjs';
import { MASK_DEFER_CHARS, MASK_RUNNING, resetMask, startMask } from '../../src/ui/mask-app.mjs';

const html = buildHtml();
const body = html.slice(html.indexOf('<body>')).replace(/<script\b[\s\S]*?<\/script>/g, '');
const css = html.match(/<style>([\s\S]*?)<\/style>/)[1].replace(/\/\*[\s\S]*?\*\//g, '');
const screenCss = css.slice(0, css.indexOf('@media print'));
const printCss = css.slice(css.indexOf('@media print'));
const panel = body.slice(body.indexOf('<section id="panel-tools"'), body.indexOf('<section id="panel-ref"'));

const ORDER = [
  ['pg-tools', '文を入れる'],
  ['pg-tools-result', '置き換えた結果'],
  ['pg-tools-unmask', '元に戻す'],
  ['pg-tools-ai', 'AI の候補'],
];
const ids = ORDER.map(([id]) => id);
const allPages = Object.values(PAGES).flat().map(([id]) => id);
const openPages = (page) => allPages.filter((id) => !page.el(id).hidden);
const pageHtml = (id) => {
  const from = panel.indexOf('id="' + id + '"');
  const next = ids[ids.indexOf(id) + 1];
  return panel.slice(from, next ? panel.indexOf('id="' + next + '"') : panel.length);
};
const SEATS = ['pg-next', 'bid-run', 'confirm-go', 'next-step-3', 'awarded-conditions', 'ledger-run', 'plan-run', 'mask-run', 'entry-back'];
const shownSeats = (page) => SEATS.filter((id) => !page.el(id).hidden);
// 折りたたみは入れ子があるので、内側から順に除く
const withoutFolds = (part) => {
  let s = part;
  for (let last = ''; last !== s;) { last = s; s = s.replace(/<details\b(?:(?!<details\b)[\s\S])*?<\/details>/, ''); }
  return s;
};
const buttonsOutsideFolds = (part) => [...withoutFolds(part).matchAll(/<button[^>]*id="([\w-]+)"/g)].map((m) => m[1]);
// id を包む折りたたみの id(外から順)
function foldsAround(id) {
  const at = panel.indexOf('id="' + id + '"');
  assert.ok(at >= 0, id + ' が無い');
  const stack = [];
  for (const m of panel.slice(0, at).matchAll(/<details\b[^>]*>|<\/details>/g)) {
    if (m[0] === '</details>') stack.pop();
    else stack.push(m[0].match(/id="([^"]+)"/)?.[1] ?? '(id なし)');
  }
  return stack;
}
const toTools = async () => {
  const page = runPage(html);
  await page.click('entry-tools');
  return page;
};

test('4ページの順: 07 の順で、DOM の順と同じ。どのページの頭にも焦点の移る見出しがある', () => {
  assert.deepEqual(PAGES.tools.map(([id, name]) => [id, name]), ORDER);
  const at = ids.map((id) => panel.indexOf('id="' + id + '"'));
  assert.ok(at.every((x) => x >= 0), JSON.stringify(at));
  assert.deepEqual(at, [...at].sort((a, b) => a - b));
  for (const [id, , title] of PAGES.tools) assert.match(pageHtml(id).slice(0, 200), new RegExp('<h2 id="' + title + '"[^>]* tabindex="-1">'), id);
  for (const id of ids.slice(1)) assert.match(panel, new RegExp('class="pg[^"]*" id="' + id + '" hidden'), id);
  // 閉じて始まる今の形を保つ
  assert.match(panel, /<details class="other-tools" id="other-tools">/);
});

test('右の席: 1/4 が置き換える、4/4 が入口に戻る、ほかは次へ。押すと順に進み、戻るで順に帰る', async () => {
  assert.deepEqual(ids.map((_, i) => seatOf('tools', i)), ['mask-run', 'pg-next', 'pg-next', 'entry-back']);
  const page = await toTools();
  assert.equal(page.el('other-tools').open, true);
  assert.deepEqual(openPages(page), ['pg-tools']);
  assert.deepEqual(shownSeats(page), ['mask-run']);
  await page.set('mask-input', '現場代理人 乙山 二郎');
  await page.click('mask-run');
  assert.deepEqual(openPages(page), ['pg-tools-result']);
  assert.deepEqual(shownSeats(page), ['pg-next']);
  assert.equal(page.el('pg-next').textContent, '次へ: 元に戻す');
  await page.click('pg-next');
  assert.deepEqual(openPages(page), ['pg-tools-unmask']);
  assert.deepEqual(shownSeats(page), ['pg-next']);
  assert.equal(page.el('pg-next').textContent, '次へ: AI の候補');
  await page.click('pg-next');
  assert.deepEqual(openPages(page), ['pg-tools-ai']);
  assert.deepEqual(shownSeats(page), ['entry-back']);
  for (const want of ['pg-tools-unmask', 'pg-tools-result', 'pg-tools']) {
    await page.click('pg-back');
    assert.deepEqual(openPages(page), [want]);
  }
  await page.click('pg-back');
  assert.deepEqual(openPages(page).filter((id) => id.startsWith('pg-tools') && page.el('panel-tools').hidden === false), []);
  assert.equal(page.el('entry').hidden, false, '入口に戻らない');
  assert.equal(page.el('other-tools').open, false);
});

test('置き換えるは下の帯にあり、席の印(塗り・▶・右へ寄せる)を持ち、ページの本文に残っていない', () => {
  const nav = body.slice(body.indexOf('<nav class="no-print" id="pager"'), body.indexOf('</nav>', body.indexOf('id="pager"')));
  assert.match(nav, /<button type="button" id="mask-run" hidden>置き換える<\/button>/);
  assert.ok(!panel.includes('id="mask-run"'));
  assert.match(screenCss, /#pager #pg-next,[^{]*#pager #mask-run[^{]*\{ margin-left: auto; \}/);
  assert.match(screenCss, /#mask-run::after[^{]*\{ content: "\\00A0\\25B6"/);
  assert.match(css, /#bid-run,[^{]*#mask-run[^{]*\{ color: var\(--paper\); background: var\(--primary\)/);
});

test('置き換えて結果のページへ進み、前と後と対応表がそのページの枠の中に出る', async () => {
  const page = await toTools();
  await page.set('mask-input', '現場代理人 乙山 二郎、甲山建設株式会社。');
  await page.click('mask-run');
  assert.deepEqual(openPages(page), ['pg-tools-result']);
  assert.ok(page.text('mask-before').includes('乙山 二郎'));
  assert.ok(!page.text('mask-after').includes('乙山 二郎'));
  assert.ok(page.el('mask-map').innerHTML.includes('乙山 二郎'));
});

test('結果のページの知らせ: 文が空でも1行の上限を超えても進み、知らせが見えるページにある。枠は頭へ戻る', async () => {
  for (const [text, want] of [['', /^＊ 置き換える文が空です。$/], ['あ'.repeat(150001), /^1行が長すぎます/]]) {
    const page = await toTools();
    page.el('mask-frame').scrollTop = 500;
    await page.set('mask-input', text);
    await page.click('mask-run');
    assert.deepEqual(openPages(page), ['pg-tools-result']);
    assert.match(page.el('mask-status').textContent, want);
    assert.equal(page.el('mask-frame').scrollTop, 0, '前に動かした枠の位置に知らせが隠れる');
  }
  // 知らせも結果も同じ枠の中
  const frame = pageHtml('pg-tools-result');
  const inFrame = frame.slice(frame.indexOf('<div class="ref-frame" id="mask-frame">'));
  for (const id of ['mask-status', 'mask-decoy', 'mask-residual', 'mask-before', 'mask-after', 'mask-review', 'mask-candidates', 'mask-candidate-status', 'mask-map', 'mask-unchecked']) {
    assert.ok(inFrame.includes('id="' + id + '"'), id);
  }
});

test('長い文: 結果のページを開いてから走らせるので、「置き換えています…」もそのページで見える', async () => {
  const els = {};
  const get = (id) => (els[id] ??= { id, value: '', textContent: '', innerHTML: '', handlers: {}, addEventListener(t, f) { this.handlers[t] = f; }, setAttribute() {}, removeAttribute() {} });
  const doc = { getElementById: get };
  resetMask(doc);
  const seen = [];
  startMask(doc, () => seen.push(get('mask-status').textContent));
  get('mask-input').value = 'あ\n'.repeat(MASK_DEFER_CHARS);
  get('mask-run').handlers.click({ preventDefault() {} });
  assert.deepEqual(seen, [''], 'ページを開く前に走った');
  assert.equal(get('mask-status').textContent, MASK_RUNNING);
  await new Promise((r) => setTimeout(r, 50));
  assert.notEqual(get('mask-status').textContent, MASK_RUNNING);
  resetMask(doc);
});

test('畳まない: mask-warning と ai-note は別の道具の折りたたみのほかに包まれない', () => {
  assert.deepEqual(foldsAround('mask-warning'), ['other-tools']);
  assert.deepEqual(foldsAround('ai-note'), ['other-tools']);
  assert.ok(pageHtml('pg-tools').includes('id="mask-warning"'));
  assert.ok(pageHtml('pg-tools-ai').includes('id="ai-note"'));
  assert.ok(pageHtml('pg-tools').indexOf('id="mask-warning"') < pageHtml('pg-tools').indexOf('id="mask-input"'), '書く欄より前で読める');
});

test('欄と知らせはそのページにあり、主の動作は1つまで', () => {
  const WHERE = {
    'pg-tools': ['mask-warning', 'mask-limits', 'mask-input', 'mask-more', 'mask-industry', 'mask-industry-status', 'dict-word', 'dict-kind', 'dict-add', 'dict-status', 'dict-list', 'dict-file-note', 'dict-export', 'dict-import', 'dict-file-status', 'mask-file', 'mask-file-status', 'mask-amounts', 'mask-thresholds', 'mask-reset'],
    'pg-tools-result': ['mask-status', 'mask-before', 'mask-after', 'mask-review', 'mask-candidates', 'mask-map', 'mask-unchecked'],
    'pg-tools-unmask': ['unmask-input', 'unmask-run', 'unmask-output', 'map-more', 'map-warning', 'map-export', 'map-import', 'map-status'],
    'pg-tools-ai': ['ai-note', 'ai-load', 'ai-status', 'ai-result'],
  };
  for (const [pg, list] of Object.entries(WHERE)) for (const id of list) {
    assert.deepEqual(ids.filter((p) => pageHtml(p).includes('id="' + id + '"')), [pg], id);
  }
  const PRIMARY = { 'pg-tools': [], 'pg-tools-result': [], 'pg-tools-unmask': ['unmask-run'], 'pg-tools-ai': [] };
  for (const [pg, want] of Object.entries(PRIMARY)) assert.deepEqual(buttonsOutsideFolds(pageHtml(pg)), want, pg);
});

test('「辞書・ファイル・金額の扱い」: 閉じた折りたたみで、業界・辞書の3つ・ファイル・金額・消すボタンが入る', () => {
  assert.match(pageHtml('pg-tools'), /<details class="fold" id="mask-more"><summary>辞書・ファイル・金額の扱い<\/summary>/);
  for (const id of ['mask-industry', 'dict-word', 'dict-add', 'dict-export', 'dict-import', 'mask-file', 'mask-amounts', 'mask-thresholds', 'mask-reset']) {
    assert.deepEqual(foldsAround(id), ['other-tools', 'mask-more'], id);
  }
  assert.ok(pageHtml('pg-tools').indexOf('id="mask-input"') < pageHtml('pg-tools').indexOf('id="mask-more"'), '主の欄を先に見せる');
});

test('対応表の警告: 閉じた折りたたみの見出しのすぐ下で読め、文は今のまま', () => {
  assert.match(pageHtml('pg-tools-unmask'), /<details class="fold" id="map-more"><summary>対応表の書き出しと読み込み<\/summary>\n<p class="warning-box" id="map-warning">このファイルには元の名前が入っています。外の AI などへ送らないでください。この端末に保存するだけです\(外へは送りません\)。要らなくなったら消してください。<\/p>/);
  for (const id of ['map-export', 'map-import', 'map-status']) assert.deepEqual(foldsAround(id), ['other-tools', 'map-more'], id);
});

test('元に戻す: 押すとそのページに戻した文が出る。塗りはこのボタンだけで、右の席は白地', async () => {
  const page = await toTools();
  await page.set('mask-input', '現場代理人 乙山 二郎');
  await page.click('mask-run');
  const masked = page.text('mask-after');
  await page.click('pg-next');
  await page.set('unmask-input', masked);
  await page.click('unmask-run');
  assert.deepEqual(openPages(page), ['pg-tools-unmask']);
  assert.ok(page.text('unmask-output').includes('乙山 二郎'));
  assert.equal(page.el('pager').classList.contains('seat-plain'), true);
  await page.click('pg-next');
  assert.equal(page.el('pager').classList.contains('seat-plain'), false);
  assert.match(css, /#bid-run,[^{]*#unmask-run[^{]*\{ color: var\(--paper\); background: var\(--primary\)/);
  assert.match(pageHtml('pg-tools-unmask'), /<div class="ref-frame"><pre id="unmask-output"><\/pre><\/div>/);
});

test('文の位置の語: ページの語にした。古い語が残っていない', () => {
  for (const old of ['下の「元に戻す」', '下の「対応表を書き出す」', '下の「置き換える文」', '上の限界']) assert.ok(!body.includes(old), old);
  const page1 = pageHtml('pg-tools');
  assert.ok(page1.includes('戻ってきた文を「元に戻す」のページに貼ると'));
  assert.ok(page1.includes('「元に戻す」のページの「対応表を書き出す」で'));
  assert.ok(page1.includes('取り出した文字を「置き換える文」の欄に入れます'));
  assert.ok(page1.includes('「使い方と限界」の数字は建設の書類のものです'));
  // 分ける前の頭の文は消さず「使い方と限界」の中へ。文を入れずに先のページへ進む道も書く
  assert.ok(page1.includes('A・B は、「結果」と「書類」の画面'));
  assert.ok(page1.includes('文を入れずに「元に戻す」か「AI の候補」のページを使うときは、欄を空のまま「置き換える」を押して進みます。'));
});

test('枠の外に置いた知らせ: 見ているページの側の欄に書き、その欄のあるページを開いて折りたたみも開く', async () => {
  const fresh = () => {
    const els = new Map();
    const get = (id) => { if (!els.has(id)) els.set(id, { id, hidden: id !== 'panel-tools' ? true : false, open: id === 'other-tools', value: '', textContent: '', classList: { add() {}, remove() {}, toggle() {} }, setAttribute() {}, removeAttribute() {}, getAttribute: () => null, querySelector: () => null, focus() {} }); return els.get(id); };
    return { getElementById: get, body: null };
  };
  const outside = (doc) => handleFileDrop(doc, { target: { closest: () => null }, preventDefault() {}, dataTransfer: { types: ['Files'], files: [{ name: 'a.json', size: 2, text: async () => '{}' }] } });
  const CASES = [
    [0, 'dict-file-status', 'pg-tools', 'mask-more'],
    [1, 'dict-file-status', 'pg-tools', 'mask-more'],
    [2, 'map-status', 'pg-tools-unmask', 'map-more'],
    [3, 'ai-status', 'pg-tools-ai', null],
  ];
  for (const [index, want, pg, fold] of CASES) {
    const doc = fresh();
    openTools(doc, index);
    await outside(doc);
    assert.match(doc.getElementById(want).textContent, /^読み込んでいません。/, String(index));
    assert.equal(doc.getElementById(pg).hidden, false, String(index));
    if (fold) assert.equal(doc.getElementById(fold).open, true, fold);
  }
});

test('使った資料から戻ると、来たページの別の道具へ帰る', async () => {
  const page = await toTools();
  await page.click('mask-run');
  await page.click('pg-next');
  assert.deepEqual(openPages(page), ['pg-tools-unmask']);
  await page.click('ref-open');
  assert.deepEqual(openPages(page), ['pg-ref']);
  await page.click('pg-back');
  assert.deepEqual(openPages(page), ['pg-tools-unmask']);
  assert.equal(page.el('other-tools').open, true);
  assert.equal(page.el('panel-tools').hidden, false);
});

test('入口へ戻って開き直すと1ページ目から。断り書きは1行の形', async () => {
  const page = await toTools();
  assert.equal(page.el('notice-more').hidden, false, '別の道具のページも1行の形');
  await page.click('mask-run');
  await page.click('pg-next');
  await page.click('pg-next');
  await page.click('entry-back');
  assert.equal(page.el('notice-more').hidden, true, '入口は全文のまま');
  await page.click('entry-tools');
  assert.deepEqual(openPages(page), ['pg-tools']);
});

test('高さの渡し方は画面だけで、背の低い画面と紙では外す。枠の線は二重にしない', () => {
  assert.match(screenCss, /#panel-tools \{ position: relative; \}/);
  assert.match(screenCss, /#panel-tools \.pg \{ position: absolute; inset: 0; \}/);
  assert.match(screenCss, /@media screen and \(max-height: 30rem\) \{[\s\S]*#panel-tools \.pg \{ position: static; \}/);
  assert.doesNotMatch(printCss, /position: absolute/);
  assert.match(screenCss, /body\.in-pages #other-tools \{ --shadow: none; margin: 0; border: none; padding: 0; \}/);
  assert.match(screenCss, /#ai-result \{ --shadow: none; margin-bottom: 0; border: none; padding: 0; \}/);
  assert.match(screenCss, /#mask-input \{ height: 10rem; \}/);
  assert.match(screenCss, /@media screen and \(max-width: 40rem\) \{[^}]*\}\s*[\s\S]*#mask-input \{ height: 7rem; \}/);
  assert.doesNotMatch(printCss, /#mask-input|#unmask-input/);
});

test('紙: AI の候補の節は今の順のまま枠に入り、隠れたページも紙に出る。文の置き換えは紙に出ない', () => {
  const ai = panel.slice(panel.indexOf('<section id="ai-check">'));
  const order = ['id="ai-title"', 'id="ai-note"', 'id="ai-status"', 'id="ai-result"'];
  const at = order.map((k) => ai.indexOf(k));
  assert.ok(at.every((x) => x >= 0), JSON.stringify(at));
  assert.deepEqual(at, [...at].sort((a, b) => a - b));
  assert.match(ai, /<div class="ref-frame"><div id="ai-result" class="result"><p>結果のファイルを読み込むと、AI の候補をここに出します。<\/p><\/div><\/div>/);
  assert.match(panel, /<section id="mask" class="no-print">/);
  assert.match(printCss, /\.pg\[hidden\], #panel-ref\[hidden\], #panel-tools\[hidden\] \{ display: block; \}/);
  assert.deepEqual(pageOfLink('mask-status'), { group: 'tools', index: 1 });
});

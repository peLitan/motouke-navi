// F66b: 印刷のボタンと、すぐ下の文。「PDF で保存・印刷」はまとめ、「全部を印刷する」は今までの全部の印刷
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildHtml } from '../../build.mjs';
import { runPage } from '../acceptance/_helpers.mjs';
import { openSummaryForPrint, restoreDetailsAfterPrint, endPrint, printResult, printAll } from '../../src/ui/app.mjs';

const html = buildHtml();
const body = html.slice(html.indexOf('</style>'));
const css = html.slice(html.indexOf('<style'), html.indexOf('</style>'));
const read = (p) => fs.readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const pOf = (id) => {
  const m = body.match(new RegExp('<p\\b[^>]*\\bid="' + id + '"[^>]*>([\\s\\S]*?)</p>'));
  assert.ok(m, id + ' の <p> が無い');
  return { tag: m[0].slice(0, m[0].indexOf('>') + 1), text: m[1] };
};
const exportBlock = () => {
  const from = body.indexOf('<div class="export">');
  assert.ok(from >= 0, '.export が無い');
  return body.slice(from, body.indexOf('<div class="row no-print step-next">', from));
};
const TITLE_DAY = '\\d{4}-\\d{2}-\\d{2}';
const docOf = (page) => page.el('print-btn').ownerDocument;
const hasBrief = (page) => docOf(page).body.classList.contains('print-brief');
const send = (page, type) => page.el('print-btn').dispatchEvent({ type, bubbles: true });
async function sampleResult() {
  const page = runPage();
  await page.click('sample-load');
  await page.click('confirm-go');
  return page;
}
// 偽の DOM は描いた折りたたみを返さないので、開け閉めを見るための要素を差し込む
function withFolds(page) {
  const doc = docOf(page);
  const folds = { 'summary-docs': { open: false }, 'summary-conditions': { open: false }, other: { open: false } };
  const byId = doc.getElementById;
  const all = doc.querySelectorAll;
  doc.getElementById = (id) => (id in folds ? folds[id] : byId(id));
  doc.querySelectorAll = (sel) => (sel === 'details' ? Object.values(folds) : all(sel));
  return folds;
}
const openOf = (folds) => Object.keys(folds).filter((k) => folds[k].open);

// ---- 形と文 ----
test('.export: 案内 → 知らせ → PDF → 全部 → CSV の順に並ぶ', () => {
  const block = exportBlock();
  const at = ['id="export-lead"', 'id="export-status"', 'id="print-btn"', 'id="print-all-btn"', 'id="csv-btn"'].map((s) => block.indexOf(s));
  assert.ok(at.every((n) => n >= 0), String(at));
  assert.deepEqual(at, [...at].sort((a, b) => a - b));
});

test('ボタン3つ: 主の行と下の行があり、aria-describedby の先の p が同じまとまりにある', () => {
  const block = exportBlock();
  assert.ok(block.includes('<button type="button" id="print-btn" aria-describedby="print-note">PDF で保存・印刷<span class="btn-sub">要点のまとめ(数枚)</span></button>'));
  assert.ok(block.includes('<button type="button" id="print-all-btn" aria-describedby="print-all-note">全部を印刷する<span class="btn-sub">根拠の条文・段取りまで(数十枚)。PDF にもできます</span></button>'));
  assert.ok(block.includes('<button type="button" id="csv-btn" aria-describedby="csv-note">結果を CSV に書き出す</button>'));
  for (const note of ['print-note', 'print-all-note', 'csv-note']) {
    assert.match(block, new RegExp('<div class="export-item"><button [^>]*aria-describedby="' + note + '">[\\s\\S]*?</button>\\n<p id="' + note + '">[^<]*</p></div>'));
  }
});

test('文: 案内・説明の中身。枚数の数字を書かず、新しい p に aria-live が無い', () => {
  const lead = pOf('export-lead').text;
  for (const w of ['画面を閉じると消えます', '外へは送りません', '最後に「確認する」を押したときの結果']) assert.ok(lead.includes(w), w);
  const note = pOf('print-note').text;
  assert.ok(note.includes('「PDF」の付く項目') && note.includes('そのまま「印刷」を押すと紙に'));
  assert.doesNotMatch(note, /[0-9０-９一二三四五六七八九十]/);
  assert.equal(note.match(/。/g).length, 1, '#print-note は1文');
  assert.ok(pOf('print-all-note').text.includes('折りたたみを全部開いて'));
  assert.equal(pOf('csv-note').text, 'Excel で開ける CSV として、この端末に保存します(外へは送りません)。');
  assert.match(body, /<p id="csv-note">Excel で開ける CSV として、この端末に保存します\(外へは送りません\)。/);
  assert.ok(body.includes('<p id="export-status" aria-live="polite"></p>'));
  assert.match(exportBlock(), /id="export-lead">[^<]*<\/p>\n<p id="export-status" aria-live="polite"><\/p>\n/);
  for (const id of ['export-lead', 'print-note', 'print-all-note', 'csv-note', 'panel-3-print-note']) assert.doesNotMatch(pOf(id).tag, /aria-live/, id);
});

test('文: 古い名前と「保存もしません」が本文に無く、#field-note が新しいボタンの名前を指す', () => {
  assert.ok(!body.includes('結果を印刷する'));
  assert.ok(!body.includes('保存もしません'));
  const field = pOf('field-note');
  assert.equal(field.tag, '<p id="field-note" class="note phone-only no-print">');
  assert.equal(field.text, 'この画面は外へ送らず、入れた内容を残しません。閉じたり読み直されたりすると消え、ほかの端末にも出ません。残すときは下の「PDF で保存・印刷」か CSV で。');
});

test('段3の最後: 外側の #panel-3 の閉じタグの直前に、全部を印刷へ戻す案内がある', () => {
  const note = pOf('panel-3-print-note');
  assert.equal(note.tag, '<p class="note no-print" id="panel-3-print-note">');
  assert.ok(note.text.includes('全部を印刷する') && note.text.includes('2 結果を見る'));
  assert.doesNotMatch(note.text, /1〜3/);
  const start = body.indexOf('<section id="panel-3"');
  const at = body.indexOf('id="panel-3-print-note"');
  assert.ok(at > body.indexOf('<div id="plan-result"', start), '#plan-check の中身より後ろに無い');
  const after = body.slice(at, body.indexOf('<details class="other-tools"'));
  assert.equal(after.match(/<\/section>/g).length, 1, '外側の #panel-3 の閉じタグの直前に無い');
  assert.match(body.slice(start, at), /<\/section>\n<p class="note no-print" $/);
});

test('CSS: ボタンの下の行・知らせの位置・幅の狭い画面で3つのボタンを幅いっぱいに', () => {
  assert.match(css, /\.export button \.btn-sub \{ display: block; font-size: 1rem; font-weight: normal; \}/);
  assert.match(css, /\.export-item \{/);
  assert.match(css, /#export-status \{ scroll-margin: 4\.5rem 0; \}/);
  const wide = css.match(/[^\n{}]*#print-btn[^\n{}]*\{[^}]*\}/g) ?? [];
  assert.equal(wide.length, 1, '幅の規則が無い');
  for (const id of ['#print-btn', '#print-all-btn', '#csv-btn']) assert.ok(wide[0].includes(id), id);
  assert.match(wide[0], /width: 100%/);
  const media = css.lastIndexOf('@media', css.indexOf('#print-btn'));
  assert.match(css.slice(media, css.indexOf('{', media)), /max-width: 40rem/);
});

// ---- 動き ----
test('結果が無いまま「PDF で保存・印刷」: 印刷の画面を開かず、知らせに行き先を書く', async () => {
  const page = runPage();
  await page.click('print-btn');
  assert.equal(page.printed.count, 0);
  const status = page.el('export-status').textContent;
  assert.match(status, /確認する/);
  assert.match(status, /全部を印刷する/);
  assert.equal(status, '結果がまだありません。「1 条件を入れる」で条件を入れて「確認する」を押してください。段取りの一覧だけを残すときは「全部を印刷する」を押してください。');
  assert.equal(hasBrief(page), false);
  assert.equal(docOf(page).title, '');
});

test('結果が無いまま「全部を印刷する」: 知らせを書いて印刷の画面を開き、print-brief は付かない', async () => {
  const page = runPage();
  await page.click('print-all-btn');
  assert.equal(page.printed.count, 1);
  assert.equal(hasBrief(page), false);
  assert.match(page.el('export-status').textContent, /^結果がまだありません。「確認する」を押してから印刷すると結果が紙に出ます。$/);
  assert.match(docOf(page).title, new RegExp('^Motouke Navi 全部 ' + TITLE_DAY + '$'));
});

test('見本のあと「PDF で保存・印刷」: 1回開き、print-brief と題名と頭の行。afterprint で戻る', async () => {
  const page = await sampleResult();
  const doc = docOf(page);
  doc.title = '元の題名';
  await page.click('print-btn');
  assert.equal(page.printed.count, 1);
  assert.equal(hasBrief(page), true);
  assert.match(page.el('print-head').textContent, /^版 \d+\.\d+\.\d+・印刷した日時 /);
  assert.match(doc.title, new RegExp('^Motouke Navi まとめ 見本 ' + TITLE_DAY + '$'));
  send(page, 'afterprint');
  assert.equal(hasBrief(page), false);
  assert.equal(doc.title, '元の題名');
  await page.click('print-all-btn');
  assert.equal(page.printed.count, 2);
  assert.equal(hasBrief(page), false);
  assert.match(doc.title, new RegExp('^Motouke Navi 全部 見本 ' + TITLE_DAY + '$'));
  send(page, 'afterprint');
  assert.equal(doc.title, '元の題名');
});

test('見本でないとき: 題名に「見本」が入らない', async () => {
  const page = runPage();
  await page.set('orderer', 'public');
  await page.set('subcontract-total', '100');
  await page.click('bid-run');
  await page.click('print-btn');
  assert.equal(page.printed.count, 1);
  assert.match(docOf(page).title, new RegExp('^Motouke Navi まとめ ' + TITLE_DAY + '$'));
});

test('afterprint が来ないまま押し直す: 全部で print-brief が外れ、題名は最初に覚えたものへ戻る', async () => {
  const page = await sampleResult();
  const doc = docOf(page);
  doc.title = '元の題名';
  await page.click('print-btn');
  await page.click('print-btn');
  await page.click('print-all-btn');
  assert.equal(page.printed.count, 3);
  assert.equal(hasBrief(page), false);
  send(page, 'afterprint');
  assert.equal(doc.title, '元の題名');
});

test('印刷が終わるたびに覚えた題名を捨てる: 次の印刷は、その時の題名へ戻す', async () => {
  const page = await sampleResult();
  const doc = docOf(page);
  doc.title = '1回目の題名';
  await page.click('print-btn');
  send(page, 'afterprint');
  doc.title = '2回目の題名';
  await page.click('print-btn');
  send(page, 'afterprint');
  assert.equal(doc.title, '2回目の題名');
});

test('beforeprint だけ(Ctrl+P): クラスにも題名にも触らず、print() も呼ばない', async () => {
  const page = await sampleResult();
  const doc = docOf(page);
  doc.title = '元の題名';
  send(page, 'beforeprint');
  assert.equal(hasBrief(page), false);
  assert.equal(doc.title, '元の題名');
  assert.equal(page.printed.count, 0);
  assert.match(page.el('print-head').textContent, /^版 /);
});

test('開く折りたたみ: まとめは2つだけ、全部と Ctrl+P は全部。afterprint で開いたものだけ閉じる', async () => {
  const page = await sampleResult();
  const folds = withFolds(page);
  await page.click('print-btn');
  assert.deepEqual(openOf(folds), ['summary-docs', 'summary-conditions']);
  send(page, 'beforeprint'); // print() のあとブラウザが送る。まとめのまま
  assert.deepEqual(openOf(folds), ['summary-docs', 'summary-conditions']);
  send(page, 'afterprint');
  assert.deepEqual(openOf(folds), []);
  send(page, 'beforeprint'); // まとめのあとの Ctrl+P は全部に戻っている
  assert.deepEqual(openOf(folds), ['summary-docs', 'summary-conditions', 'other']);
  send(page, 'afterprint');
  assert.deepEqual(openOf(folds), []);
  await page.click('print-all-btn');
  assert.deepEqual(openOf(folds), ['summary-docs', 'summary-conditions', 'other']);
  send(page, 'afterprint');
  assert.deepEqual(openOf(folds), []);
});

test('条件を変えた後の「PDF で保存・印刷」: 開かず、変わったと知らせる', async () => {
  const page = await sampleResult();
  await page.set('contract-amount', '12345678');
  await page.click('print-btn');
  assert.equal(page.printed.count, 0);
  assert.match(page.el('export-status').textContent, /条件が変わりました/);
  assert.equal(hasBrief(page), false);
  await page.click('print-all-btn');
  assert.equal(page.printed.count, 1, '全部は開く');
  assert.match(page.el('export-status').textContent, /条件が変わりました/);
});

test('知らせ: 書いたら画面に入れ、消すときは動かさない', async () => {
  const page = runPage();
  const calls = [];
  page.el('export-status').scrollIntoView = (o) => calls.push(o.block);
  await page.click('print-btn');
  assert.deepEqual(calls, ['nearest']);
  await page.click('sample-load'); // 読み込みで知らせを消す
  await page.click('confirm-go');
  assert.equal(page.el('export-status').textContent, '');
  assert.equal(calls.length, 1);
});

// ---- 関数 ----
test('openSummaryForPrint: 2つだけ開き、2回呼んでも同じで、閉じ直すのは開いたものだけ', () => {
  const folds = { 'summary-docs': { open: false }, 'summary-conditions': { open: false }, 'bid-fold': { open: false } };
  const doc = { getElementById: (id) => folds[id] ?? null };
  openSummaryForPrint(doc);
  openSummaryForPrint(doc);
  assert.deepEqual(openOf(folds), ['summary-docs', 'summary-conditions']);
  restoreDetailsAfterPrint();
  assert.deepEqual(openOf(folds), []);
  folds['summary-docs'].open = true; // 人が開いていたカードは閉じない
  openSummaryForPrint(doc);
  restoreDetailsAfterPrint();
  assert.deepEqual(openOf(folds), ['summary-docs']);
});

test('要素が無くても投げない: openSummaryForPrint・endPrint・結果が無いときの押下', () => {
  const none = { getElementById: () => null };
  assert.doesNotThrow(() => openSummaryForPrint(none));
  assert.doesNotThrow(() => endPrint(none));
  assert.doesNotThrow(() => endPrint({}));
  assert.doesNotThrow(() => endPrint({ body: {} }));
  // scrollIntoView の無い要素。この import のモジュールはまだ結果を持たない
  const status = { textContent: '' };
  const win = { count: 0, print() { this.count++; } };
  const doc = { getElementById: (id) => (id === 'export-status' ? status : null), querySelectorAll: () => [], title: '' };
  assert.doesNotThrow(() => printResult(doc, win));
  assert.equal(win.count, 0);
  assert.match(status.textContent, /全部を印刷する/);
  assert.doesNotThrow(() => printResult(none, win));
  assert.doesNotThrow(() => printAll(doc, win));
  assert.equal(win.count, 1);
  assert.doesNotThrow(() => printAll({ ...none, querySelectorAll: () => [] }, win));
  assert.equal(win.count, 2);
  endPrint(none);
});

// ---- 説明の文 ----
test('説明の文: README の試し方と design・manual が新しい名前と動きを書く', () => {
  const readme = read('README.md');
  const line = readme.split('\n').find((l) => l.startsWith('4. ') && l.includes('全部を印刷する'));
  assert.ok(line, 'README の試し方に行が無い');
  for (const w of ['PDF で保存・印刷', '全部を印刷する', '結果を CSV に書き出す']) assert.ok(line.includes(w), w);
  assert.ok(!readme.includes('結果を印刷する'));
  const design = read('docs/design.md');
  assert.ok(design.includes('「全部を印刷する」とブラウザのメニューからの印刷(Ctrl+P)'));
  assert.ok(design.includes('print-brief'));
  const manual = read('docs/manual.md');
  assert.ok(manual.includes('残すときは印刷(PDF でも)か CSV で書き出してください'));
  assert.ok(manual.includes('印刷(PDF でも)と「記載事項の表を CSV に書き出す」'));
  assert.ok(manual.includes('「全部を印刷する」の紙と CSV(「結果を CSV に書き出す」)には候補と入れた条件が、「PDF で保存・印刷」のまとめには件数と入れた条件が載ります'));
});

// F82d: 段3 の目次の PDF・Word(値はすべて架空。試験の PDF はこの中で組み、ファイルは置かない)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildHtml } from '../../build.mjs';
import { runPage, makeZip } from '../acceptance/_helpers.mjs';
import { koukokuPdf, pdfFile } from './_koukoku-pdf.mjs';
import { dropPageLines, tidyPdfText } from '../../src/pdf-text.mjs';
import { checkPlanToc } from '../../src/plan-check.mjs';
import { handleFileDrop, dropPortName } from '../../src/ui/app.mjs';
import { SAMPLE } from '../../src/sample.mjs';

// runPage の中には performance と DecompressionStream が無い。performance は足し、画面の試験は圧縮しない PDF を使う
const html = buildHtml().replace('<script', '<script>globalThis.performance = { now: () => Date.now() };</script><script');
const shell = fs.readFileSync(new URL('../../src/ui/shell.html', import.meta.url), 'utf8');
const manual = fs.readFileSync(new URL('../../docs/manual.md', import.meta.url), 'utf8');
const plain = (pages) => koukokuPdf(pages, { flate: false });
const LABEL = '目次を PDF・Word から読む(.pdf・.docx・.txt)';
const FILLED = '「施工計画書の目次」の欄に文があるので入れていません。欄を空にしてから置き直してください。';
const CHECK_NEXT = '「施工計画書の目次」の欄に入れました。中身を確かめてから「目次を点検する」を押してください。目次の頁だけを残すと確かです。';
const BY_HAND = '手で入れるときは、下の「施工計画書の目次」の欄に貼ります。';
const LONG = '施工計画書の全体を読んだときは、本文の見出しも目次として数えます。';
const SCAN = '文字の入っていない PDF です(紙を写した画像だけ)。この画面は画像の文字を読みません。元の Excel・Word をもらうか、紙を見て入れてください。';
const BROKEN = 'PDF が途中で切れているか壊れていて読めません。もう一度ダウンロードするか、送り直してもらってください。';
const TOC_1 = ['施工計画書 目次', '1. 工事概要 ..... 1', '2. 計画工程表 ..... 3'];
const TOC_2 = ['3. 現場組織表 ..... 5', '4. 施工方法 ..... 8'];
const TOC = [...TOC_1, ...TOC_2].join('\n');

const line = (page) => page.el('plan-file-status').textContent;
const kind = (page) => page.el('plan-file-status').getAttribute('data-kind');
const field = (page) => page.el('plan-input').value;
const result = (page) => page.el('plan-result').innerHTML;
const until = async (done) => { for (let i = 0; i < 400 && !done(); i += 1) await new Promise((r) => setImmediate(r)); };
async function give(page, file) {
  page.el('plan-file').files = [file];
  await page.set('plan-file', '');
}
async function read(page, file) {
  page.el('plan-file-status').textContent = '';
  await give(page, file);
  await until(() => line(page) !== '' && !line(page).includes('を読んでいます'));
}
function heldFile(name, bytes) {
  let release;
  const gate = new Promise((r) => { release = r; });
  const file = pdfFile(name, bytes);
  const open = file.arrayBuffer;
  return { file: { ...file, arrayBuffer: async () => { await gate; return open(); } }, release };
}
const bytesOf = (s) => new TextEncoder().encode(s);
const docx = (paragraphs) => makeZip([
  { name: '[Content_Types].xml', data: '<Types/>' },
  { name: 'word/document.xml', data: '<w:document><w:body>' + paragraphs.map((p) => '<w:p><w:r><w:t>' + p + '</w:t></w:r></w:p>').join('') + '</w:body></w:document>' },
]);

test('dropPageLines: 頁の区切りの行だけを除き、行はつなげない', () => {
  assert.equal(dropPageLines('見出し1\n―― 2頁 ――\n―― 3頁 ――\n見出し2'), '見出し1\n見出し2');
  assert.equal(dropPageLines('見出し1\n―― 2頁 ――\n\n―― 3頁 ――\n見出し2'), '見出し1\n見出し2', '空の頁の空の行');
  assert.equal(dropPageLines('\n―― 2頁 ――\n見出し'), '見出し');
  assert.equal(dropPageLines('見出し\n―― 2頁 ――\n'), '見出し');
  assert.equal(dropPageLines('見出し\r\n―― 2頁 ――\r\n次'), '見出し\r\n次');
  assert.equal(dropPageLines('「―― 2頁 ――」の行'), '「―― 2頁 ――」の行', '文の中の語は行ではない');
  assert.equal(dropPageLines(''), '');
  // tidyPdfText を通すと見出しがつながる。それで使わない
  assert.notEqual(tidyPdfText('工事概要\n計画工程表'), '工事概要\n計画工程表');
});

test('枠: 目次の欄の上にあり、知らせの欄が枠と欄の間にある', () => {
  const frame = shell.indexOf('<div class="row drop" data-drop="plan-file">');
  const status = shell.indexOf('<p id="plan-file-status" aria-live="polite"></p>');
  const area = shell.indexOf('<textarea id="plan-input"');
  assert.ok(shell.indexOf('<section id="plan-check">') < frame && frame < status && status < area);
  assert.ok(shell.includes('<label for="plan-file">' + LABEL + '</label>'));
  const accept = shell.match(/<input\b[^>]*\bid="plan-file"[^>]*\baccept="([^"]*)"/)[1].split(',');
  assert.deepEqual(accept.filter((x) => x.startsWith('.')), ['.pdf', '.docx', '.txt']);
  assert.ok(shell.includes('id="plan-file"') && /id="plan-file"[^>]*><span class="drop-hint">この枠にファイルをドラッグして置いても読み込めます<\/span><\/div>/.test(shell));
});

test('画面: 合成の目次の PDF を置くと見出しが1行ずつ入り、頁の区切りの行が無く、点検は走らない', async () => {
  const page = runPage(html);
  const before = result(page);
  await read(page, pdfFile('目次.pdf', plain([TOC_1, TOC_2])));
  assert.equal(field(page), TOC);
  assert.ok(!field(page).includes('頁 ――'));
  assert.equal(result(page), before);
  assert.equal(page.el('plan-status').textContent, '');
  assert.ok(line(page).startsWith('「目次.pdf」の文字を読みました(2頁)。' + CHECK_NEXT), line(page));
  assert.ok(!line(page).includes(LONG));
  assert.equal(kind(page), null);
  // 押すと、入った行で点検できる
  await page.click('plan-run');
  assert.notEqual(result(page), before);
  const items = checkPlanToc(field(page)).found.map((f) => f.item);
  for (const item of ['工事概要', '計画工程表', '現場組織表', '施工方法']) assert.ok(items.includes(item), item);
});

test('画面: 10頁までは本文の見出しの文を添えず、10頁を越えると添える', async () => {
  const pages = (n) => Array.from({ length: n }, (_, i) => ['見出し' + (i + 1)]);
  let page = runPage(html);
  await read(page, pdfFile('十頁.pdf', plain(pages(10))));
  assert.ok(line(page).includes('(10頁)') && !line(page).includes(LONG), line(page));
  page = runPage(html);
  await read(page, pdfFile('十一頁.pdf', plain(pages(11))));
  assert.ok(line(page).includes('(11頁)') && line(page).includes(LONG), line(page));
  assert.equal(field(page).split('\n').length, 11);
});

test('画面: 欄に文があれば読まずに断り、欄も結果も変えない。空白だけの欄には入れる', async () => {
  const page = runPage(html);
  await page.set('plan-input', '手で貼った目次');
  const before = result(page);
  let opened = 0;
  const file = pdfFile('目次.pdf', plain([TOC_1]));
  await read(page, { ...file, arrayBuffer: async () => { opened += 1; return file.arrayBuffer(); } });
  assert.equal(line(page), FILLED);
  assert.equal(kind(page), 'error');
  assert.equal(opened, 0);
  assert.equal(field(page), '手で貼った目次');
  assert.equal(result(page), before);
  await page.set('plan-input', ' \n ');
  await read(page, file);
  assert.equal(field(page), TOC_1.join('\n'));
  assert.equal(kind(page), null);
});

test('画面: 読んでいる間に欄へ書いた文を消さない', async () => {
  const page = runPage(html);
  const { file, release } = heldFile('目次.pdf', plain([TOC_1]));
  await give(page, file);
  await page.set('plan-input', '読む間に書いた目次');
  release();
  await until(() => line(page) === FILLED);
  assert.equal(line(page), FILLED);
  assert.equal(field(page), '読む間に書いた目次');
});

test('画面: 読んでいる間に別のファイルを置くと、後のファイルが入り、前の知らせが残らない', async () => {
  const page = runPage(html);
  const first = heldFile('前.pdf', plain([['前の目次']]));
  const second = heldFile('後.pdf', plain([['後の目次']]));
  await give(page, first.file);
  await give(page, second.file);
  second.release();
  await until(() => line(page).startsWith('「後.pdf」の文字を読みました'));
  first.release();
  for (let i = 0; i < 50; i += 1) await new Promise((r) => setImmediate(r));
  assert.equal(field(page), '後の目次');
  assert.ok(line(page).startsWith('「後.pdf」の文字を読みました'), line(page));
  assert.equal(page.el('plan-file-status').getAttribute('aria-busy'), null);
});

test('画面: 読めない PDF は F82b の文を出し、欄と結果を変えず、失敗の印が付く', async () => {
  const page = runPage(html);
  const before = result(page);
  await read(page, pdfFile('写し.pdf', plain([[]])));
  assert.equal(line(page), '「写し.pdf」を読めませんでした: ' + SCAN + BY_HAND);
  assert.equal(kind(page), 'error');
  assert.equal(field(page), '');
  assert.equal(result(page), before);
});

test('画面: 一部の頁が読めない PDF は読めた頁を入れ、読めない頁の番号を言う', async () => {
  const page = runPage(html);
  await read(page, pdfFile('目次.pdf', plain([TOC_1, [], TOC_2])));
  assert.equal(field(page), TOC);
  assert.ok(line(page).includes('3頁のうち 2頁は文字が無い(紙を写した画像)ので読めていません。'), line(page));
  assert.equal(kind(page), null);
});

test('画面: .txt も読む。頁の数は言わない', async () => {
  const page = runPage(html);
  await read(page, pdfFile('目次.txt', bytesOf('﻿1. 工事概要\n―― 2頁 ――\n2. 計画工程表\n')));
  assert.equal(field(page), '1. 工事概要\n2. 計画工程表');
  assert.equal(line(page), '「目次.txt」の文字を読みました。' + CHECK_NEXT);
});

test('画面: 文字の無いファイルは入れず、失敗の印が付く', async () => {
  const page = runPage(html);
  await read(page, pdfFile('空.txt', bytesOf(' \n')));
  assert.ok(line(page).startsWith('「空.txt」に文字がありませんでした。'), line(page));
  assert.equal(kind(page), 'error');
  assert.equal(field(page), '');
});

test('画面: 受けない種類は読まない(.xlsx・.doc)', async () => {
  for (const name of ['目次.xlsx', '目次.doc']) {
    const page = runPage(html);
    await read(page, pdfFile(name, bytesOf('x')));
    assert.equal(line(page), '選んだファイルは .pdf・.docx・.txt にしてください(今のファイル: ' + name + ')。');
    assert.equal(kind(page), 'error');
    assert.equal(field(page), '');
  }
});

test('画面: 台帳の点検は目次の欄も見るので、読むと台帳の点検の結果を古くする', async () => {
  const page = runPage(html);
  await page.set('ledger-input', SAMPLE.documents.ledger);
  await page.click('ledger-run');
  assert.ok(!page.el('check-status').textContent.startsWith('台帳か条件が変わりました'), page.el('check-status').textContent);
  await read(page, pdfFile('目次.pdf', plain([TOC_1])));
  assert.ok(page.el('check-status').textContent.startsWith('台帳か条件が変わりました'), page.el('check-status').textContent);
});

test('画面: 見本の目次があるときは入れず、見本の出し入れで知らせが残らない', async () => {
  const page = runPage(html);
  await read(page, pdfFile('目次.pdf', plain([TOC_1])));
  await page.click('sample-load');
  assert.equal(line(page), '');
  assert.equal(field(page), SAMPLE.documents.planToc);
  await read(page, pdfFile('目次.pdf', plain([TOC_1])));
  assert.equal(line(page), FILLED);
  await page.click('sample-reenter');
  assert.equal(field(page), '');
  assert.equal(line(page), '');
});

// ドラッグは runPage の要素が親をたどれないので、偽物の要素で組む(ui-drop と同じ)
const fakeEl = (attrs = {}, parentNode = null) => ({
  attrs, parentNode, value: '', textContent: '', hidden: true, classList: { add() {}, remove() {} },
  getAttribute(k) { return this.attrs[k] ?? null; }, setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; },
});
function dropDoc() {
  const framed = (id, label, accept) => {
    const frame = fakeEl({ 'data-drop': id });
    frame.querySelector = (sel) => (sel === 'label' ? { textContent: label } : null);
    return [id, fakeEl({ accept }, frame)];
  };
  const els = new Map([framed('plan-file', LABEL, '.pdf,.docx,.txt'), framed('ledger-file', '台帳の Excel を読む(.xlsx)', '.xlsx')]);
  return { getElementById(id) { if (!els.has(id)) els.set(id, fakeEl()); return els.get(id); } };
}
const dropEv = (target, files) => ({ target, preventDefault() {}, dataTransfer: { types: ['Files'], files } });

test('ドラッグ: 枠に置くと読む。枠の名前は目次の枠と分かり、枠の外の知らせに2つの枠が出る', async () => {
  assert.equal(dropPortName(LABEL), '目次を PDF・Word');
  const doc = dropDoc();
  await handleFileDrop(doc, dropEv(doc.getElementById('plan-file').parentNode, [pdfFile('目次.pdf', koukokuPdf([TOC_1, TOC_2]))]));
  assert.equal(doc.getElementById('plan-input').value, TOC);
  assert.ok(doc.getElementById('plan-file-status').textContent.startsWith('「目次.pdf」の文字を読みました(2頁)。'));
  doc.getElementById('panel-3').hidden = false;
  await handleFileDrop(doc, dropEv(fakeEl(), [pdfFile('目次.pdf', koukokuPdf([TOC_1]))]));
  assert.equal(doc.getElementById('ledger-file-status').textContent, '読み込んでいません。ファイルは点線の枠にドラッグしてください。この段の枠: 台帳の Excel・目次を PDF・Word。');
});

// runPage の中には DecompressionStream が無いので、圧縮の要る .docx と壊れた PDF の文はここで見る
test('ドラッグ: .docx も読み、頁の数は言わない。壊れた PDF は F82b の文を出す', async () => {
  let doc = dropDoc();
  await handleFileDrop(doc, dropEv(doc.getElementById('plan-file').parentNode, [pdfFile('目次.docx', docx(['1. 工事概要', '2. 計画工程表']))]));
  assert.equal(doc.getElementById('plan-input').value, '1. 工事概要\n2. 計画工程表');
  assert.equal(doc.getElementById('plan-file-status').textContent, '「目次.docx」の文字を読みました。' + CHECK_NEXT);
  doc = dropDoc();
  await handleFileDrop(doc, dropEv(doc.getElementById('plan-file').parentNode, [pdfFile('写し.pdf', bytesOf('%PDF-1.4 切れた中身'))]));
  assert.equal(doc.getElementById('plan-file-status').textContent, '「写し.pdf」を読めませんでした: ' + BROKEN + BY_HAND);
  assert.equal(doc.getElementById('plan-file-status').getAttribute('data-kind'), 'error');
  assert.equal(doc.getElementById('plan-input').value, '');
});

test('台帳と体系図の欄の近くに PDF を受ける口が無く、manual に理由と次の手がある', () => {
  const part = shell.slice(shell.indexOf('<h2>3-1.'), shell.indexOf('<section id="plan-check">'));
  assert.ok(part.includes('id="ledger-input"') && part.includes('id="taikeizu-input"'));
  const inputs = [...part.matchAll(/<input type="file"[^>]*>/g)].map((m) => m[0]);
  assert.equal(inputs.length, 1);
  assert.ok(inputs[0].includes('id="ledger-file"'));
  assert.doesNotMatch(inputs[0], /pdf/i);
  assert.ok(manual.includes('台帳の欄は PDF を読みません。下請けから元の Excel をもらって入れてください。'));
  assert.ok(manual.includes('PDF の台帳を外の AI に貼るときは「A. 文の置き換え」で置き換えてから'));
  assert.ok(manual.includes('表の行がずれて別の会社の値が入るおそれ'));
});

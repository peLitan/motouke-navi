// F83a14: 段1 の「公告の文を .txt で保存」の試験(値はすべて架空。試験の PDF はこの中で組み、ファイルは置かない)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildHtml } from '../../build.mjs';
import { runPage } from '../acceptance/_helpers.mjs';
import { koukokuPdf, pdfFile, PRIME_LINES, PRIME_SENTENCE } from './_koukoku-pdf.mjs';
import { intakeTxtName, pdfIntakeNotice } from '../../src/intake-load.mjs';
import { saveIntakeTxt, rememberIntakeText } from '../../src/ui/app.mjs';
import { checkConditions } from '../../plugin/skills/bid-intake/scripts/check-conditions.mjs';

const html = buildHtml().replace('<script', '<script>globalThis.performance = { now: () => Date.now() };</script><script');
const BUTTON = 'intake-save-txt';
const SAVED = 'intake-save-status';
const FIELD = 'participation-conditions';
const pdf = (name = '架空の公告.pdf') => pdfFile(name, koukokuPdf([PRIME_LINES], { flate: false }));
const NOW = new Date(2026, 10, 7);
const DAY = '2026-11-07';
const until = async (done) => { for (let i = 0; i < 400 && !done(); i += 1) await new Promise((r) => setImmediate(r)); };

async function startPage() {
  const page = runPage(html);
  await page.click('entry-intake');
  return page;
}
async function readPdf(page, file) {
  page.el('intake-load').files = [file];
  await page.set('intake-load', '');
  await until(() => page.el(FIELD).value !== '' || page.el('intake-status').getAttribute('data-kind') === 'error');
  await until(() => !page.el('intake-status').textContent.includes('を読んでいます'));
}
const isOff = (page) => page.el(BUTTON).disabled === true;

// 本物の Blob と URL を通し、保存される物をバイトのまま取る。リンクの属性もここで見る
async function saved(value, { pdfName } = {}) {
  const links = [];
  const els = new Map();
  const doc = {
    getElementById(id) { if (!els.has(id)) els.set(id, { id, value: '', disabled: false, textContent: '', removeAttribute() {} }); return els.get(id); },
    createElement: () => { const a = { click() { links.push({ href: a.href, download: a.download }); }, remove() {} }; return a; },
    body: { appendChild() {} },
  };
  doc.getElementById(FIELD).value = value;
  if (pdfName) rememberIntakeText(doc, pdfName); else rememberIntakeText(doc, null);
  const open = URL.createObjectURL;
  const blobs = [];
  URL.createObjectURL = (b) => { blobs.push(b); return open.call(URL, b); };
  try {
    const ok = saveIntakeTxt(doc, NOW);
    return { ok, links, blob: blobs[0], status: doc.getElementById(SAVED).textContent };
  } finally {
    URL.createObjectURL = open;
  }
}

test('保存の中身は欄の文そのまま。頭の印も整えもなく UTF-8 のバイトになる', async () => {
  const value = '  入札公告\n\n―― 2頁 ――\r\n架空川 護岸工事 ①㈱ 𠮷  \n';
  const r = await saved(value, { pdfName: '公告.pdf' });
  assert.equal(r.ok, true);
  assert.equal(r.links.length, 1);
  const bytes = Buffer.from(await r.blob.arrayBuffer());
  assert.deepEqual(bytes, Buffer.from(value, 'utf8'));
  assert.notDeepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  assert.equal(r.blob.type, 'text/plain;charset=utf-8');
});

test('ファイルの名前: 読んだ PDF の名前から 公告_<ファイル名>.txt にする', async () => {
  assert.equal((await saved('文', { pdfName: '架空川の公告.pdf' })).links[0].download, '公告_架空川の公告.txt');
  assert.equal(intakeTxtName('架空川.PDF', DAY), '公告_架空川.txt');
  assert.equal(intakeTxtName('a.b.pdf', DAY), '公告_a.b.txt');
  assert.equal(intakeTxtName('名前.pdf.pdf', DAY), '公告_名前.pdf.txt');
});

test('ファイルの名前: 名前が無いとき・使えない字だけのときは今日の日付、使えない字は _ にする', () => {
  assert.equal(intakeTxtName(null, DAY), '公告_2026-11-07.txt');
  assert.equal(intakeTxtName('', DAY), '公告_2026-11-07.txt');
  assert.equal(intakeTxtName('.pdf', DAY), '公告_2026-11-07.txt');
  assert.equal(intakeTxtName('  ', DAY), '公告_2026-11-07.txt');
  assert.equal(intakeTxtName('a/b\\c:d*e?f"g<h>i|j.pdf', DAY), '公告_a_b_c_d_e_f_g_h_i_j.txt');
  assert.equal(intakeTxtName('改\n行\t.pdf', DAY), '公告_改_行_.txt');
});

test('空の欄・空白だけの欄は保存しない(押しても何も作らない)', async () => {
  for (const value of ['', '  \n\t ', '　']) {
    const r = await saved(value);
    assert.equal(r.ok, false);
    assert.equal(r.links.length, 0);
    assert.equal(r.blob, undefined);
  }
});

test('画面: 開いたときと空の欄では押せず、文を書くと押せ、消すとまた押せない', async () => {
  const page = await startPage();
  assert.equal(page.el(BUTTON).tagName, 'BUTTON');
  assert.equal(isOff(page), true);
  assert.equal(page.blobs.length, 0);
  await page.click(BUTTON); // 試験の偽のページは disabled でも click を流す。関数の側でも止まることを見る
  assert.equal(page.blobs.length, 0);
  await page.set(FIELD, '公告の文');
  assert.equal(isOff(page), false);
  await page.set(FIELD, '  \n ');
  assert.equal(isOff(page), true);
});

test('画面: PDF を読むと押せ、押すと欄の文がそのまま保存の中身になる。手で直した文も直したまま', async () => {
  const page = await startPage();
  await readPdf(page, pdf());
  assert.ok(page.el(FIELD).value.includes(PRIME_SENTENCE));
  assert.equal(isOff(page), false);
  await page.click(BUTTON);
  assert.equal(page.blobs.length, 1);
  assert.equal(await page.blobs[0].text(), page.el(FIELD).value);
  assert.match(page.el(SAVED).textContent, /^「公告_架空の公告\.txt」をこの端末に保存しました/);
  await page.set(FIELD, page.el(FIELD).value + '\n手で足した行');
  assert.equal(page.el(SAVED).textContent, '', '欄が変わったのに保存したと言い続けない');
  await page.click(BUTTON);
  assert.equal(page.blobs.length, 2);
  assert.ok((await page.blobs[1].text()).endsWith('手で足した行'));
});

test('画面: 保存しても読み込みの知らせと読めない頁の行は消えない', async () => {
  const page = await startPage();
  await readPdf(page, pdfFile('公告.pdf', koukokuPdf([PRIME_LINES, []], { flate: false })));
  const notice = page.el('intake-status').textContent;
  const lines = page.el('intake-result').innerHTML;
  assert.ok(lines.includes('<li>'), '読めない頁の行が要る');
  await page.click(BUTTON);
  assert.equal(page.el('intake-status').textContent, notice);
  assert.equal(page.el('intake-result').innerHTML, lines);
});

test('ファイルの名前は、読んだ PDF の文が欄にそのままある間だけ使う', async () => {
  const page = await startPage();
  await readPdf(page, pdf('元の公告.pdf'));
  await page.click(BUTTON);
  assert.ok(page.el(SAVED).textContent.includes('公告_元の公告.txt'));
  await page.set(FIELD, '別の公告を貼った文');
  await page.click(BUTTON);
  assert.match(page.el(SAVED).textContent, /^「公告_\d{4}-\d{2}-\d{2}\.txt」/);
});

test('画面: 手で貼った文は今日の日付の名前になる', async () => {
  const page = await startPage();
  await page.set(FIELD, '貼った文');
  await page.click(BUTTON);
  assert.match(page.el(SAVED).textContent, /^「公告_\d{4}-\d{2}-\d{2}\.txt」/);
});

test('画面: 見本で欄が空に戻ると押せない(input の知らせが来ない入れ方でも見る)', async () => {
  const page = await startPage();
  await readPdf(page, pdf());
  assert.equal(isOff(page), false);
  await page.click('entry-back');
  await page.click('sample-load');
  assert.equal(page.el(FIELD).value, '');
  assert.equal(isOff(page), true);
});

test('知らせからメモ帳の手順が消え、ボタンの名前を指す', () => {
  const text = pdfIntakeNotice('公告.pdf', 1, PRIME_SENTENCE);
  assert.ok(!text.includes('メモ帳'), text);
  assert.ok(text.includes('下の「公告の文を .txt で保存」'), text);
  assert.ok(text.includes('条件は拾っていません'), text);
  assert.ok(!html.includes('メモ帳に貼り'), '画面に古い手順が残っている');
});

test('画面の並び: ボタンは知らせの下で、読み込みの折りたたみの中に1つ', () => {
  const shell = fs.readFileSync(new URL('../../src/ui/shell.html', import.meta.url), 'utf8');
  const fold = shell.slice(shell.indexOf('id="intake-more"'));
  const body = fold.slice(0, fold.indexOf('</details>'));
  assert.equal(shell.split('id="' + BUTTON + '"').length, 2);
  assert.ok(body.indexOf('id="intake-result"') < body.indexOf('id="' + BUTTON + '"'));
  assert.match(body, new RegExp('<button type="button" id="' + BUTTON + '"[^>]* disabled>公告の文を \\.txt で保存</button>'));
  assert.match(body, new RegExp('id="' + SAVED + '" aria-live="polite"'));
});

test('通信しない: 保存の道はこの端末へのダウンロードだけ', () => {
  for (const file of ['../../src/ui/download.mjs', '../../src/intake-load.mjs']) {
    assert.doesNotMatch(fs.readFileSync(new URL(file, import.meta.url), 'utf8'), /\bfetch\(|XMLHttpRequest|WebSocket|sendBeacon/);
  }
});

test('保存した .txt を bid-intake の照合にそのまま渡すと、抜き書きが原文で見つかる', async () => {
  const page = await startPage();
  await readPdf(page, pdf());
  await page.click(BUTTON);
  // check-conditions.mjs は UTF-8 で読むので、保存のバイトを同じ形に戻して渡す
  const text = Buffer.from(await page.blobs[0].text(), 'utf8').toString('utf8');
  const r = checkConditions({
    source: { publisher: '架空県', title: '架空川 護岸工事 入札公告', date: '令和9年2月1日' },
    conditions: [{ key: 'work-name', value: '架空川 護岸工事', quote: '架空川 護岸工事', file: '公告_架空の公告.txt' }],
  }, [{ file: '公告_架空の公告.txt', text }]);
  assert.equal(r.removed.length, 0, JSON.stringify(r.removed));
  assert.ok(r.rows.some((x) => x.key === 'work-name' && x.status === '拾えた'), JSON.stringify(r.rows));
});

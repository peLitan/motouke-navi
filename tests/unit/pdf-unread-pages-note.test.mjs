// F84a: PDF の読めない頁の知らせ。「2頁のうち 2頁は」は全部の頁が読めなかったようにも読めるので、頁の数と頁の番号を分けて書く
// 値はすべて架空。試験の PDF はこの中で組み、ファイルは置かない
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPage } from '../acceptance/_helpers.mjs';
import { koukokuPdf, pdfFile } from './_koukoku-pdf.mjs';
import { extractFile } from '../../src/mask/extract.mjs';
import { main } from '../../plugin/skills/bid-intake/scripts/pdf-to-text.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
fs.mkdirSync(path.join(ROOT, 'tmp'), { recursive: true });
const WORK = fs.mkdtempSync(path.join(ROOT, 'tmp', 'pdf-unread-note-'));
after(() => fs.rmSync(WORK, { recursive: true, force: true }));

// count 頁の PDF の頁の並び。unread に挙げた番号の頁は全面の画像にする
const pagesOf = (count, unread) => Array.from({ length: count }, (_, i) => (unread.includes(i + 1) ? [] : ['架空川 護岸工事 施工計画書']));
const REST = 'は文字が無い(紙を写した画像)ので読めていません。';

// [何の場合か, 全部の頁の数, 読めない頁の番号, 知らせの頭]
const CASES = [
  ['2頁中2頁目だけ', 2, [2], '2頁のうち 1頁(2頁目)'],
  ['10頁中3頁', 10, [2, 5, 7], '10頁のうち 3頁(2・5・7頁目)'],
  ['1頁目だけ', 3, [1], '3頁のうち 1頁(1頁目)'],
  ['続いた2頁は番号をまとめない', 5, [3, 4], '5頁のうち 2頁(3・4頁目)'],
  ['番号を「〜」でまとめても、数は頁の数のまま', 8, [2, 3, 4, 5, 7], '8頁のうち 5頁(2〜5・7頁目)'],
  ['まとまりが2つ', 13, [1, 2, 3, 7, 10, 11, 12], '13頁のうち 7頁(1〜3・7・10〜12頁目)'],
];

async function noteOf(count, unread) {
  const r = await extractFile('写し.pdf', koukokuPdf(pagesOf(count, unread)));
  return r.notes[0];
}

test('2頁中2頁目だけ読めない: 「2頁のうち 1頁(2頁目)」と言い、「2頁のうち 2頁」とは言わない', async () => {
  const note = await noteOf(2, [2]);
  assert.equal(note, '2頁のうち 1頁(2頁目)は文字が無い(紙を写した画像)ので読めていません。');
  assert.ok(!note.includes('2頁のうち 2頁'), note);
});

test('10頁中3頁読めない: 「10頁のうち 3頁(」で始まり、3つの番号が並ぶ', async () => {
  const note = await noteOf(10, [2, 5, 7]);
  assert.ok(note.startsWith('10頁のうち 3頁('), note);
  const list = /^10頁のうち 3頁\(([^)]*)頁目\)/.exec(note)?.[1];
  assert.deepEqual(list?.split('・'), ['2', '5', '7'], note);
});

for (const [what, count, unread, head] of CASES) {
  test('文の形: ' + what, async () => {
    assert.equal(await noteOf(count, unread), head + REST);
  });
}

test('読めない頁が無い PDF には、この知らせを出さない', async () => {
  const r = await extractFile('計画書.pdf', koukokuPdf(pagesOf(3, [])));
  assert.ok(!r.notes.some((n) => n.includes('頁のうち') || n.includes('読めていません')), r.notes.join(' '));
});

test('文字がある頁も、画像の頁も、文の頁の番号はずれない(知らせの番号が紙の頁と同じ)', async () => {
  const r = await extractFile('写し.pdf', koukokuPdf(pagesOf(4, [2, 4])));
  assert.equal(r.notes[0], '4頁のうち 2頁(2・4頁目)' + REST);
  for (const n of [2, 3, 4]) assert.ok(r.text.includes('―― ' + n + '頁 ――'), r.text);
});

// ---- 同じ文を出すほかの所 ----
let seq = 0;
async function cliNote(count, unread) {
  const dir = path.join(WORK, 'w' + ++seq);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '公告.pdf'), koukokuPdf(pagesOf(count, unread)));
  const err = [];
  const code = await main(['公告.pdf', '--out', '公告.txt'], { log: () => {}, error: (s) => err.push(String(s)), cwd: dir });
  assert.equal(code, 0, err.join('\n'));
  return err.join('\n');
}

for (const [what, count, unread, head] of CASES) {
  test('Skill bid-intake の pdf-to-text.mjs も画面と同じ文を標準エラーに言う: ' + what, async () => {
    const err = await cliNote(count, unread);
    assert.ok(err.split('\n').includes(head + REST), err);
    assert.ok(err.split('\n').includes(await noteOf(count, unread)), err);
  });
}

// 配る物そのものを見る。作り直し忘れもここで落ちる。runPage の中には performance と DecompressionStream が無いので圧縮しない PDF を使う
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').replace('<script', '<script>globalThis.performance = { now: () => Date.now() };</script><script');
const until = async (done) => { for (let i = 0; i < 400 && !done(); i += 1) await new Promise((r) => setImmediate(r)); };
const mixed = () => pdfFile('混ざり.pdf', koukokuPdf(pagesOf(2, [2]), { flate: false }));
const MIXED_NOTE = '2頁のうち 1頁(2頁目)' + REST;

test('index.html の文の置き換え A: 知らせに同じ文が出る', async () => {
  const page = runPage(html);
  page.el('mask-file').files = [mixed()];
  await page.set('mask-file', '');
  const line = () => page.el('mask-file-status').textContent;
  await until(() => line().includes('取り出しました'));
  assert.ok(line().includes(MIXED_NOTE), line());
});

test('index.html の段1 の公告: 枠の下の行に同じ文が出る', async () => {
  const page = runPage(html);
  await page.click('entry-intake');
  page.el('intake-load').files = [mixed()];
  await page.set('intake-load', '');
  const notes = () => page.el('intake-result').innerHTML;
  await until(() => notes().includes('読めていません'));
  assert.ok(notes().includes(MIXED_NOTE), notes());
});

test('index.html の段3 の目次: 知らせに同じ文が出る', async () => {
  const page = runPage(html);
  page.el('plan-file').files = [mixed()];
  await page.set('plan-file', '');
  const line = () => page.el('plan-file-status').textContent;
  await until(() => line().includes('読めていません'));
  assert.ok(line().includes(MIXED_NOTE), line());
});

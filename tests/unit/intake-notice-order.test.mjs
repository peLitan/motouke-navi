// F85c: 公告の PDF の知らせの順と、公告の口の種類の文。値はすべて架空
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildHtml } from '../../build.mjs';
import { runPage } from '../acceptance/_helpers.mjs';
import { pdfIntakeNotice } from '../../src/intake-load.mjs';
import { fileTypeMessage, handleFileDrop } from '../../src/ui/app.mjs';
import { PRIME_SENTENCE } from './_koukoku-pdf.mjs';

const shell = fs.readFileSync(new URL('../../src/ui/shell.html', import.meta.url), 'utf8');
const HEAD = '「架空.pdf」の文字を読みました(3頁)。「公告の参加の条件」の欄に入れました。';
const FOUND = '元請けとしての実績を求める文がありました。結果の「確認が要る点」に出します。';
const MISSED = '元請けとしての実績を求める文は見つかりませんでした。公告の本文で確かめてください。';
const NEXT = '残りの欄を入れて「確認する」を押します。';
const SCOPE = '見たのは元請けの実績の条件だけで、金額・工事の種類・等級・地域などの条件は拾っていません。';
const TOOL = '拾うのはパソコンの Claude Code の「公告を読む」手順で、渡すのは文のファイルです(下の「公告の文を .txt で保存」で保存して渡してください)。';

for (const [name, body, conclusion] of [['実績の文あり', PRIME_SENTENCE, FOUND], ['実績の文なし', '架空の公告の文', MISSED]]) {
  test('知らせの順(' + name + '): 頭の2文 → 結論 → 次の動作 → 見た範囲 → Claude Code', () => {
    const line = pdfIntakeNotice('架空.pdf', 3, body);
    assert.ok(line.startsWith(HEAD), line);
    assert.ok(line.indexOf(conclusion) >= HEAD.length, '結論が頭の2文の後に無い');
    assert.ok(line.indexOf(conclusion) < line.indexOf('見たのは'), '結論が見た範囲より後');
    assert.ok(line.indexOf(conclusion) < line.indexOf(NEXT), '結論が次の動作より後');
    assert.ok(line.indexOf(NEXT) < line.indexOf('見たのは'), '次の動作が見た範囲より後');
    assert.ok(line.indexOf(NEXT) < line.indexOf('Claude Code'), '次の動作が Claude Code より後');
    assert.ok(line.indexOf('見たのは') < line.indexOf('Claude Code'), '見た範囲が Claude Code より後');
    assert.equal(line, HEAD + conclusion + NEXT + SCOPE + TOOL);
  });

  test('知らせの語(' + name + '): Skill と bid-intake の語が無く、「公告を読む」手順と言う', () => {
    const line = pdfIntakeNotice('架空.pdf', 3, body);
    for (const word of ['Skill', 'bid-intake']) assert.ok(!line.includes(word), word);
    assert.ok(line.includes('「公告を読む」手順'), line);
  });
}

test('次の動作の文のボタンは、画面に同じ名前である', () => {
  assert.ok(shell.includes('<button type="button" id="bid-run">確認する</button>'));
});

// 種類の文: 画面の本物の accept から読む
const acceptOf = (id) => shell.match(new RegExp('<input\\b[^>]*\\bid="' + id + '"[^>]*\\baccept="([^"]*)"'))[1];
const docOf = (id) => ({ getElementById: (x) => (x === id ? { getAttribute: (k) => (k === 'accept' ? acceptOf(id) : null) } : null) });

test('種類の文: 公告の口は .pdf も案内し、段取りの表の口は .json だけのまま', () => {
  assert.equal(fileTypeMessage(docOf('intake-load'), 'intake-load', { name: '写真.png' }), '選んだファイルは .pdf・.json にしてください(今のファイル: 写真.png)。');
  assert.equal(fileTypeMessage(docOf('rules-load'), 'rules-load', { name: '写真.png' }), '選んだファイルは .json にしてください(今のファイル: 写真.png)。');
});

test('種類の文: 受ける物は断らず、古い Excel の案内は公告の口でも残る', () => {
  for (const name of ['公告.PDF', '条件.json']) assert.equal(fileTypeMessage(docOf('intake-load'), 'intake-load', { name }), null);
  assert.equal(fileTypeMessage(docOf('rules-load'), 'rules-load', { name: '公告.pdf' }), '選んだファイルは .json にしてください(今のファイル: 公告.pdf)。');
  assert.equal(fileTypeMessage(docOf('intake-load'), 'intake-load', { name: '台帳.xls' }), '選んだファイルは .pdf・.json にしてください(今のファイル: 台帳.xls)。Excel で .xlsx に保存し直してください。');
});

test('組み立てた画面: 公告の口の種類の文に .pdf があり失敗の印が付く。段取りの表の口の文には無い', async () => {
  const page = runPage(buildHtml());
  const give = async (id) => {
    page.el(id).files = [{ name: '写真.png', size: 1, text: async () => 'x' }];
    await page.set(id, '');
  };
  await give('intake-load');
  assert.equal(page.el('intake-status').textContent, '選んだファイルは .pdf・.json にしてください(今のファイル: 写真.png)。');
  assert.equal(page.el('intake-status').getAttribute('data-kind'), 'error');
  await give('rules-load');
  assert.equal(page.el('rules-status').textContent, '選んだファイルは .json にしてください(今のファイル: 写真.png)。');
  assert.equal(page.el('rules-status').getAttribute('data-kind'), 'error');
});

// 枠の外に置いたとき。知らせに要る物だけを持つ文書
function outsideDoc(shown) {
  const els = new Map();
  const doc = {
    getElementById(id) {
      if (!els.has(id)) els.set(id, { id, hidden: false, open: false, textContent: '', parentNode: null, setAttribute() {}, removeAttribute() {}, getAttribute: () => null, classList: { add() {}, remove() {} } });
      return els.get(id);
    },
    addEventListener() {},
  };
  for (const id of ['entry', 'panel-confirm', 'panel-1', 'panel-2', 'panel-3']) doc.getElementById(id).hidden = id !== shown;
  return doc;
}
const dropOutside = (doc) => handleFileDrop(doc, {
  target: { id: 'body', parentNode: null, getAttribute: () => null },
  preventDefault() {},
  dataTransfer: { types: ['Files'], files: [{ name: '公告.pdf', size: 1, text: async () => 'x' }] },
});

test('枠の外: 入口と確かめの画面の文が、公告の PDF の置き場にも触れる', async () => {
  const entry = outsideDoc('entry');
  await dropOutside(entry);
  assert.equal(entry.getElementById('drop-status').textContent, '読み込んでいません。公告の PDF と条件のファイル(.json)は「公告を読み込む」のタイルにドラッグしてください。台帳の Excel などは段3「書類を確かめる」の枠にドラッグします。');
  const confirm = outsideDoc('panel-confirm');
  await dropOutside(confirm);
  assert.equal(confirm.getElementById('drop-status').textContent, '読み込んでいません。この画面にはファイルの枠がありません。公告の PDF と条件のファイル(.json)は段1「条件を入れる」の「公告から拾った条件を読み込む」で読み込みます。');
});

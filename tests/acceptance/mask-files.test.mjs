// F11c: .txt・.docx・.xlsx から文字を取り出して置き換える(条件 F11-1)
import test from 'node:test';
import assert from 'node:assert/strict';
import { load, readText, indexHtml, makeZip, makeXlsx } from './_helpers.mjs';

const enc = (s) => new Uint8Array(Buffer.from(s, 'utf8'));

function makeDocx(paragraphs) {
  const body = paragraphs.map((p) => `<w:p><w:r><w:t xml:space="preserve">${p.slice(0, 3)}</w:t></w:r><w:r><w:t>${p.slice(3)}</w:t></w:r></w:p>`).join('');
  return makeZip([
    { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>', store: true },
    { name: 'word/document.xml', data: `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>` },
  ]);
}

test('.txt(BOM つき UTF-8)', async () => {
  const { extractText } = await load('src/mask/extract.mjs');
  const t = await extractText('a.txt', enc('﻿架空の文: 甲山建設株式会社'));
  assert.equal(t, '架空の文: 甲山建設株式会社');
});

test('.docx: 段落ごとに改行し、分かれた文字の塊をつなぐ', async () => {
  const { extractText } = await load('src/mask/extract.mjs');
  const t = await extractText('b.docx', makeDocx(['架空の台帳を作る。', '担当は甲野 一郎。']));
  assert.deepEqual(t.split(/\r?\n/).filter(Boolean), ['架空の台帳を作る。', '担当は甲野 一郎。']);
});

test('.xlsx: 共有文字列と数のセルを取り出す', async () => {
  const { extractText } = await load('src/mask/extract.mjs');
  const t = await extractText('c.xlsx', makeXlsx([['商号', '丁谷工業株式会社'], ['請負代金額', 41000000], ['メール', 'chotani@example.com']]));
  for (const w of ['商号', '丁谷工業株式会社', '41000000', 'chotani@example.com']) assert.ok(t.includes(w), '取り出せない: ' + w);
  assert.ok(t.indexOf('商号') < t.indexOf('丁谷工業株式会社') && t.indexOf('丁谷工業株式会社') < t.indexOf('請負代金額'), '順番が崩れている');
});

test('対応していない形式は、分かる言葉で止まる', async () => {
  const { extractText } = await load('src/mask/extract.mjs');
  await assert.rejects(() => extractText('d.pdf', enc('%PDF-1.4')), Error);
});

test('取り出した文字を置き換えると、元の語が残らない', async () => {
  const { extractText } = await load('src/mask/extract.mjs');
  const { createMasker } = await load('src/mask/core.mjs');
  const { CONSTRUCTION_DICT } = await load('src/mask/dict-construction.mjs');
  const t = await extractText('c.xlsx', makeXlsx([['商号', '丁谷工業株式会社'], ['メール', 'chotani@example.com'], ['電話', '06-0000-0000']]));
  const r = createMasker({ dictionaries: [CONSTRUCTION_DICT] }).mask(t);
  for (const w of ['丁谷工業株式会社', 'chotani@example.com', '06-0000-0000']) assert.ok(!r.masked.includes(w), '残っている: ' + w);
});

test('画面でファイルを選べて、README に同梱する部品のライセンスを書いている', () => {
  const html = indexHtml();
  const m = html.match(/<input\b[^>]*\bid\s*=\s*["']mask-file["'][^>]*>/i);
  assert.ok(m, 'mask-file の入力欄が無い');
  for (const ext of ['.txt', '.docx', '.xlsx']) assert.ok(m[0].includes(ext), 'accept に ' + ext + ' が無い');
  assert.ok(html.includes('extractText'));
  const md = readText('README.md');
  assert.ok(/ライセンス/.test(md));
});

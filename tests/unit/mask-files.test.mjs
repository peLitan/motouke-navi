// F11c: ファイルから文字を取り出す部品の単体テスト(値はすべて架空)
import test from 'node:test';
import assert from 'node:assert/strict';
import { extractText, decodeText } from '../../src/mask/extract.mjs';
import { loadMaskFile } from '../../src/ui/mask-app.mjs';
import { makeZip } from '../acceptance/_helpers.mjs';

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const docx = (bodyXml, extra = []) => makeZip([
  { name: 'word/document.xml', data: `<?xml version="1.0" encoding="UTF-8"?><w:document ${W}><w:body>${bodyXml}</w:body></w:document>` },
  ...extra,
]);

test('.txt: Shift_JIS のファイルも読める', () => {
  const sjis = new Uint8Array([0x89, 0xcb, 0x8b, 0xf3]); // 「架空」
  assert.equal(decodeText(sjis), '架空');
});

test('.docx: 実体参照・タブ・改行・表のセル・頭書きを取り出し、消した文字は読まない', async () => {
  const body = '<w:p><w:pPr><w:pStyle w:val="a"/></w:pPr><w:r><w:t>甲山&amp;乙川</w:t><w:tab/><w:t>JV</w:t></w:r></w:p>'
    + '<w:p/>'
    + '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>商号</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>丙川建設株式会社</w:t></w:r></w:p></w:tc></w:tr></w:tbl>'
    + '<w:p><w:r><w:t>前</w:t><w:br/><w:t>後</w:t></w:r><w:del><w:r><w:delText>消した語</w:delText></w:r></w:del></w:p>';
  const t = await extractText('x.DOCX', docx(body, [
    { name: 'word/header1.xml', data: `<w:hdr ${W}><w:p><w:r><w:t>架空町 こころみ川</w:t></w:r></w:p></w:hdr>` },
  ]));
  assert.equal(t, '甲山&乙川\tJV\n\n商号\n丙川建設株式会社\n前\n後\n架空町 こころみ川');
});

test('.xlsx: シートの順・空きセル・インラインの文字・ふりがなを除く・複数シートの見出し', async () => {
  const sheet = (rows) => `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`;
  const bytes = makeZip([
    { name: 'xl/workbook.xml', data: '<workbook xmlns:r="r"><sheets><sheet name="表紙" sheetId="1" r:id="rId2"/><sheet name="台帳" sheetId="2" r:id="rId1"/></sheets></workbook>' },
    { name: 'xl/_rels/workbook.xml.rels', data: '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="/xl/worksheets/sheet2.xml"/></Relationships>' },
    { name: 'xl/sharedStrings.xml', data: '<sst><si><r><t>甲野</t></r><r><t xml:space="preserve"> 一郎</t></r><rPh sb="0" eb="2"><t>コウノ</t></rPh></si></sst>' },
    { name: 'xl/worksheets/sheet1.xml', data: sheet('<row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1"><v>12</v></c></row><row r="2"/><row r="3"><c r="B3" t="inlineStr"><is><t>a&lt;b</t></is></c></row>') },
    { name: 'xl/worksheets/sheet2.xml', data: sheet('<row r="1"><c r="A1" t="str"><f>A2</f><v>表紙の文</v></c><c r="B1" t="b"><v>1</v></c></row>') },
  ]);
  const t = await extractText('y.xlsx', bytes);
  assert.equal(t, '[シート: 表紙]\n表紙の文\tTRUE\n[シート: 台帳]\n甲野 一郎\t\t12\n\ta<b');
});

test('壊れたファイル・zip でないファイルは、分かる言葉で止まる', async () => {
  await assert.rejects(() => extractText('z.docx', new TextEncoder().encode('ただの文')), /zip/);
  await assert.rejects(() => extractText('z.xlsx', makeZip([{ name: 'a.txt', data: 'x' }])), /シート/);
  await assert.rejects(() => extractText('z.docx', makeZip([{ name: 'a.txt', data: 'x' }])), /document\.xml/);
  await assert.rejects(() => extractText('z.xls', new Uint8Array(1)), /対応していない形式/);
});

test('画面: ファイルを読むと「置き換える文」の欄に入り、読めないときは理由を出す', async () => {
  const els = { 'mask-input': { value: '' }, 'mask-file-status': { textContent: '' } };
  const doc = { getElementById: (id) => els[id] || null };
  const file = (name, bytes) => ({ name, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });
  assert.equal(await loadMaskFile(doc, file('a.docx', docx('<w:p><w:r><w:t>担当は甲野 一郎</w:t></w:r></w:p>'))), true);
  assert.equal(els['mask-input'].value, '担当は甲野 一郎');
  assert.match(els['mask-file-status'].textContent, /取り出しました/);
  assert.equal(await loadMaskFile(doc, file('b.pdf', new Uint8Array(4))), false);
  assert.match(els['mask-file-status'].textContent, /読めませんでした/);
  assert.equal(els['mask-input'].value, '担当は甲野 一郎');
});

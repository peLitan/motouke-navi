// F82a: PDF の文字を読む部品の単体テスト(値はすべて架空。試験の PDF はこの中で組み、ファイルは置かない)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { deflateSync } from 'node:zlib';
import { readPdf, LIMITS } from '../../src/pdf-read.mjs';

const STATUSES = ['ok', 'partial', 'no-text', 'unmapped', 'encrypted', 'broken', 'too-big', 'not-pdf'];
const latin = (s) => Buffer.from(s, 'latin1');
const read = (b) => readPdf(new Uint8Array(b));

// xref の位置を数えて書く。objs は 1 から順の番号の中身
function build(objs, { trailer = '', head = '%PDF-1.7\n' } = {}) {
  const parts = [latin(head)];
  let off = parts[0].length;
  const xref = [];
  objs.forEach((o, i) => {
    xref.push(off);
    const b = Buffer.concat([latin(`${i + 1} 0 obj\n`), Buffer.isBuffer(o) ? o : latin(o), latin('\nendobj\n')]);
    parts.push(b);
    off += b.length;
  });
  const table = ['xref', `0 ${objs.length + 1}`, '0000000000 65535 f ', ...xref.map((n) => `${String(n).padStart(10, '0')} 00000 n `)].join('\n');
  parts.push(latin(`${table}\ntrailer\n<< /Size ${objs.length + 1} /Root 1 0 R ${trailer}>>\nstartxref\n${off}\n%%EOF\n`));
  return Buffer.concat(parts);
}
function stream(data, { dict = '', flate = false } = {}) {
  const raw = Buffer.isBuffer(data) ? data : latin(data);
  const body = flate ? deflateSync(raw) : raw;
  return Buffer.concat([latin(`<< ${dict}${flate ? ' /Filter /FlateDecode' : ''} /Length ${body.length} >>\nstream\n`), body, latin('\nendstream')]);
}

const CATALOG = '<< /Type /Catalog /Pages 2 0 R >>';
const pagesObj = (...ids) => `<< /Type /Pages /Kids [${ids.map((n) => `${n} 0 R`).join(' ')}] /Count ${ids.length} >>`;
const pageObj = (contents, resources) => `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << ${resources} >> /Contents ${contents} 0 R >>`;
const FONT_F1 = '/Font << /F1 5 0 R >>';
const HELVETICA = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
const image = (n) => stream(Buffer.alloc(n * n, 0x80), { dict: `/Type /XObject /Subtype /Image /Width ${n} /Height ${n} /ColorSpace /DeviceGray /BitsPerComponent 8` });
const FULL_PAGE_IMAGE = 'q 595 0 0 842 0 0 cm /Im0 Do Q';

// 番号 1.. を字に当てる ToUnicode。hex(s) は字の並びを番号の並びにする
function cidFont(alphabet) {
  const list = [...alphabet];
  const u16 = (c) => [...Buffer.from(c, 'utf16le').swap16()].map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
  const lines = list.map((c, i) => `<${(i + 1).toString(16).padStart(4, '0')}> <${u16(c)}>`);
  const cmap = `/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CMapName /X def 1 begincodespacerange <0000> <FFFF> endcodespacerange ${list.length} beginbfchar\n${lines.join('\n')}\nendbfchar endcmap CMapName currentdict /CMap defineresource pop end end`;
  const hex = (s) => `<${[...s].map((c) => (list.indexOf(c) + 1).toString(16).padStart(4, '0')).join('')}>`;
  return { cmap, hex };
}
const type0 = (encoding, toUnicode) => `<< /Type /Font /Subtype /Type0 /BaseFont /X /Encoding /${encoding} ${toUnicode ? `/ToUnicode ${toUnicode} 0 R ` : ''}/DescendantFonts [<< /Type /Font /Subtype /CIDFontType2 /BaseFont /X /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /DW 1000 >>] >>`;

// 1頁の PDF。content は字の並びを hex にしてから渡す
function cidPdf(alphabet, makeContent, { encoding = 'Identity-H', flate = false, extra = [], resources = FONT_F1 } = {}) {
  const { cmap, hex } = cidFont(alphabet);
  return build([CATALOG, pagesObj(3), pageObj(4, resources), stream(makeContent(hex), { flate }), type0(encoding, 6), stream(cmap, { flate }), ...extra]);
}

// 頁ごとに英字の文の入った n 頁の PDF。catalogFirst が false なら /Catalog と /Pages を最後の番号に置く
function pagesPdf(n, { catalogFirst = true } = {}) {
  const body = 'Construction plan outline, schedule and organization of the fictional works.';
  const base = catalogFirst ? 3 : 1;
  const font = base + n * 2;
  const pagesId = catalogFirst ? 2 : font + 2;
  const kids = Array.from({ length: n }, (_, i) => base + i * 2);
  const pageList = kids.flatMap((id, i) => [
    `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${id + 1} 0 R >>`,
    stream(`BT /F1 12 Tf 72 700 Td (page ${i + 1} ${body}) Tj ET`, { flate: true }),
  ]);
  const catalog = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  return catalogFirst
    ? build([catalog, pagesObj(...kids), ...pageList, HELVETICA])
    : build([...pageList, HELVETICA, catalog, pagesObj(...kids)]);
}
const half = (b) => b.subarray(0, Math.floor(b.length / 2));

test('Identity-H + ToUnicode(圧縮あり)の日本語が読める', async () => {
  const pdf = cidPdf('施工計画書氏名', (hex) => `BT /F1 12 Tf 72 700 Td ${hex('施工計画書')} Tj ET BT /F1 12 Tf 72 680 Td ${hex('氏名')} Tj ET`, { flate: true });
  assert.ok(pdf.indexOf('FlateDecode') > 0, '圧縮して組めている');
  const r = await read(pdf);
  assert.equal(r.status, 'ok');
  assert.equal(r.text, '施工計画書\n氏名');
  assert.equal(r.stats.chars, 7);
  assert.equal(r.stats.damagedStreams, 0);
});

test('返り値の形: 頁の欄と、頁の文の間の区切り', async () => {
  const r = await read(pagesPdf(2));
  assert.deepEqual(Object.keys(r).sort(), ['pageCount', 'pages', 'stats', 'status', 'text']);
  assert.equal(r.pageCount, 2);
  assert.deepEqual(Object.keys(r.pages[0]).sort(), ['chars', 'hidden', 'imageCover', 'page', 'scanLike', 'text', 'unmapped']);
  assert.deepEqual(r.pages.map((p) => p.page), [1, 2]);
  assert.equal(r.text, `${r.pages[0].text}\n\f\n${r.pages[1].text}`);
  assert.equal(r.stats.hidden, 0);
});

test('90ms-RKSJ-H・ToUnicode なしは Shift_JIS のバイトから字に戻す', async () => {
  const SJIS = { 施: '8E7B', 工: '8D48', 計: '8C76', 画: '89E6', 書: '8F91', 氏: '8E81', 名: '96BC', 山: '8E52', 田: '9363', 太: '91BE', 郎: '9859', ' ': '20' };
  const hex = [...'施工計画書 氏名 山田太郎'].map((c) => SJIS[c]).join('');
  const r = await read(build([
    CATALOG, pagesObj(3), pageObj(4, FONT_F1),
    stream(`BT /F1 12 Tf 72 700 Td <${hex}> Tj ET`),
    '<< /Type /Font /Subtype /Type0 /BaseFont /MS-Mincho /Encoding /90ms-RKSJ-H /DescendantFonts [6 0 R] >>',
    '<< /Type /Font /Subtype /CIDFontType0 /BaseFont /MS-Mincho /CIDSystemInfo << /Registry (Adobe) /Ordering (Japan1) /Supplement 2 >> /DW 1000 >>',
  ]));
  assert.equal(r.status, 'ok');
  assert.equal(r.text, '施工計画書 氏名 山田太郎');
});

test('Identity-H・ToUnicode なしは unmapped と言う(化けた字を文として返さない)', async () => {
  const r = await read(build([
    CATALOG, pagesObj(3), pageObj(4, FONT_F1),
    stream('BT /F1 12 Tf 72 700 Td <0C1A0D2E0E3F1F201234> Tj ET'),
    type0('Identity-H', null),
  ]));
  assert.equal(r.status, 'unmapped');
  assert.equal(r.stats.unmapped, 5);
  assert.equal(r.pages[0].unmapped, 5);
});

test('画像だけの頁は no-text で、scanLike が立つ', async () => {
  const r = await read(build([CATALOG, pagesObj(3), pageObj(4, '/XObject << /Im0 5 0 R >>'), stream(FULL_PAGE_IMAGE), image(20)]));
  assert.equal(r.status, 'no-text');
  assert.equal(r.text, '');
  assert.equal(r.pages[0].scanLike, true);
  assert.equal(r.pages[0].imageCover, 1);
  assert.equal(r.stats.scanPages, 1);
});

test('文字の頁と画像の頁は partial で、2頁目だけ scanLike', async () => {
  const r = await read(build([
    CATALOG, pagesObj(3, 6), pageObj(4, FONT_F1),
    stream('BT /F1 12 Tf 72 700 Td (Construction plan table of contents: 1 Outline 2 Schedule 3 Organization) Tj ET'),
    HELVETICA,
    pageObj(7, '/XObject << /Im0 8 0 R >>'), stream(FULL_PAGE_IMAGE), image(20),
  ]));
  assert.equal(r.status, 'partial');
  assert.equal(r.pageCount, 2);
  assert.deepEqual(r.pages.map((p) => p.scanLike), [false, true]);
  assert.equal(r.stats.scanPages, 1);
  assert.match(r.pages[0].text, /Construction plan/);
  assert.equal(r.pages[1].text, '');
});

test('/Encrypt があれば encrypted で、文を返さない(trailer と XRef ストリーム)', async () => {
  const content = 'BT /F1 12 Tf 72 700 Td (Fictional text that must not be returned) Tj ET';
  const inTrailer = await read(build([CATALOG, pagesObj(3), pageObj(4, FONT_F1), stream(content), HELVETICA, '<< /Filter /Standard >>'], { trailer: '/Encrypt 6 0 R ' }));
  assert.equal(inTrailer.status, 'encrypted');
  assert.equal(inTrailer.text, '');
  assert.deepEqual(inTrailer.pages, []);
  const inXref = await read(build([CATALOG, pagesObj(3), pageObj(4, FONT_F1), stream(content), HELVETICA, '<< /Filter /Standard >>', stream('', { dict: '/Type /XRef /Encrypt 6 0 R /Root 1 0 R' })]));
  assert.equal(inXref.status, 'encrypted');
});

test('後ろ半分を切った物は、/Catalog の位置によらず broken(残った頁だけを ok にしない)', async () => {
  for (const catalogFirst of [true, false]) {
    for (const n of [1, 2, 6]) {
      const whole = pagesPdf(n, { catalogFirst });
      assert.equal((await read(whole)).status, 'ok', `切る前は読める catalogFirst=${catalogFirst} n=${n}`);
      for (const cut of [half(whole), whole.subarray(0, Math.floor(whole.length * 0.75)), whole.subarray(0, whole.length - 8)]) {
        const r = await read(cut);
        assert.equal(r.status, 'broken', `catalogFirst=${catalogFirst} n=${n} bytes=${cut.length}/${whole.length}`);
        assert.equal(r.text, '');
        assert.deepEqual(r.pages, []);
      }
    }
  }
});

test('切れていないが形の崩れた物は読む: startxref の位置の誤り・末尾の改行', async () => {
  const whole = pagesPdf(2);
  const moved = Buffer.from(whole);
  const at = moved.lastIndexOf('startxref') + 'startxref\n'.length;
  moved.write('9'.repeat(String(moved.toString('latin1', at, at + 12).split('\n')[0]).length), at, 'latin1'); // 桁をそろえ、%%EOF は残す
  assert.equal((await read(moved)).status, 'ok');
  assert.equal((await read(Buffer.concat([whole, latin('\r\n\r\n')]))).status, 'ok');
});

test('%PDF-1.4 だけの物は broken で、投げない', async () => {
  const r = await read(latin('%PDF-1.4'));
  assert.equal(r.status, 'broken');
  assert.equal(r.pageCount, 0);
});

test('PDF でない物は not-pdf', async () => {
  for (const b of [Buffer.from('これは PDF ではありません'), Buffer.alloc(0), Buffer.alloc(2048, 0x20)]) {
    const r = await read(b);
    assert.equal(r.status, 'not-pdf');
    assert.deepEqual([r.pageCount, r.pages, r.text], [0, [], '']);
  }
});

test('ファイルの上限を越える物は開かずに too-big', async () => {
  const r = await readPdf(new Uint8Array(LIMITS.file + 1));
  assert.equal(r.status, 'too-big');
  assert.deepEqual([r.pageCount, r.pages, r.text], [0, [], '']);
});

test('ArrayBuffer でも読める', async () => {
  const b = pagesPdf(1);
  const r = await readPdf(b.buffer.slice(b.byteOffset, b.byteOffset + b.length));
  assert.equal(r.status, 'ok');
});

test('投げない: 型の違う入力と、バイトを壊した物', async () => {
  for (const x of [undefined, null, -1, 2 ** 53, 'abc', {}, []]) {
    const r = await readPdf(x);
    assert.ok(STATUSES.includes(r.status), `入力 ${String(x)} → ${r.status}`);
    assert.equal(typeof r.text, 'string');
    assert.ok(Array.isArray(r.pages));
  }
  // 種の決まった乱数で、中のバイトを書き換えた物を読む(同じ結果になるよう Math.random を使わない)
  const whole = cidPdf('施工計画書', (hex) => `BT /F1 12 Tf 72 700 Td ${hex('施工計画書')} Tj ET`, { flate: true });
  let seed = 20261107;
  const next = (n) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n; };
  for (let i = 0; i < 300; i++) {
    const b = Buffer.from(whole);
    for (let k = 0; k <= next(8); k++) b[next(b.length)] = next(256);
    const r = await read(b);
    assert.ok(STATUSES.includes(r.status), `回 ${i}: ${r.status}`);
  }
});

test('縦書き(Identity-V)の2列は右の列から読む', async () => {
  const pdf = cidPdf('施工計画書甲野一郎', (hex) => `BT /F1 20 Tf 450 700 Td ${hex('甲野一郎')} Tj ET BT /F1 20 Tf 500 700 Td ${hex('施工計画書')} Tj ET`, { encoding: 'Identity-V' });
  const r = await read(pdf);
  assert.equal(r.status, 'ok');
  assert.equal(r.text, '施工計画書\n甲野一郎');
});

const VISIBLE_AND_HIDDEN = '施工計画書甲野一郎⽥中１２';

for (const mode of [3, 7]) {
  test(`Tr ${mode} の字は文に入れず、hidden に数だけ入れる`, async () => {
    const pdf = cidPdf(VISIBLE_AND_HIDDEN, (hex) => `BT /F1 12 Tf 72 700 Td ${hex('施工計画書')} Tj ET BT ${mode} Tr /F1 12 Tf 72 680 Td ${hex('甲野一郎')} Tj ET BT 0 Tr /F1 12 Tf 72 660 Td ${hex('⽥中')} Tj ET`);
    const r = await read(pdf);
    assert.equal(r.status, 'ok');
    assert.equal(r.text.includes('甲野一郎'), false);
    for (const c of '甲野一郎') assert.equal(r.text.includes(c), false);
    assert.equal(r.pages[0].hidden, 4);
    assert.equal(r.stats.hidden, 4);
    assert.equal(r.pages[0].chars, 7, '見えない字は頁の字の数に入れない');
    assert.equal(r.stats.chars, 7);
    assert.equal(r.text, '施工計画書\n田中');
  });
}

test('Tr は q・Q で戻り、Tr 1(線だけの字)は見える字のまま', async () => {
  const pdf = cidPdf(VISIBLE_AND_HIDDEN, (hex) => `q 3 Tr BT /F1 12 Tf 72 700 Td ${hex('甲野')} Tj ET Q BT /F1 12 Tf 72 680 Td ${hex('施工')} Tj ET BT 1 Tr /F1 12 Tf 72 660 Td ${hex('計画')} Tj ET`);
  const r = await read(pdf);
  assert.equal(r.text, '施工\n計画');
  assert.equal(r.pages[0].hidden, 2);
});

test('Tr 3 のまま呼んだ Form の字も見えないので文に入れず、Form の中で変えれば見える', async () => {
  const { hex } = cidFont(VISIBLE_AND_HIDDEN);
  const fm = (body) => stream(`BT /F1 12 Tf 72 680 Td ${body} ET`, { dict: `/Type /XObject /Subtype /Form /BBox [0 0 595 842] /Resources << ${FONT_F1} >>` });
  const pdf = cidPdf(VISIBLE_AND_HIDDEN, () => `BT /F1 12 Tf 72 700 Td ${hex('施工')} Tj ET 3 Tr /Fm0 Do /Fm1 Do`, {
    resources: `${FONT_F1} /XObject << /Fm0 7 0 R /Fm1 8 0 R >>`,
    extra: [fm(`${hex('甲野一郎')} Tj`), fm(`0 Tr ${hex('計画')} Tj`)],
  });
  const r = await read(pdf);
  assert.equal(r.pages[0].hidden, 4);
  assert.equal(r.text.includes('甲'), false);
  assert.match(r.text, /計画/);
});

test('スキャンに見えない字を重ねた頁は、文字の無い頁と同じ扱いで数だけ残る', async () => {
  const { cmap, hex } = cidFont('甲野一郎');
  const r = await read(build([
    CATALOG, pagesObj(3), pageObj(4, `${FONT_F1} /XObject << /Im0 7 0 R >>`),
    stream(`${FULL_PAGE_IMAGE} BT 3 Tr /F1 12 Tf 72 700 Td ${hex('甲野一郎')} Tj ET`),
    type0('Identity-H', 6), stream(cmap), image(20),
  ]));
  assert.equal(r.status, 'no-text');
  assert.equal(r.text, '');
  assert.equal(r.pages[0].scanLike, true);
  assert.equal(r.stats.hidden, 4);
});

test('康熙部首は常用の字に戻し、全角の数字などは変えない', async () => {
  const kept = '１２㈱①ｱ⺟Ａ';
  const pdf = cidPdf(`⽥中${kept}`, (hex) => `BT /F1 12 Tf 72 700 Td ${hex('⽥中')} Tj ET BT /F1 12 Tf 72 680 Td ${hex(kept)} Tj ET`);
  const r = await read(pdf);
  assert.equal(r.text, `田中\n${kept}`);
  assert.equal(r.pages[0].text, r.text);
});

test('康熙部首の 214字(U+2F00〜U+2FD5)はすべて戻る', async () => {
  const all = Array.from({ length: 0x2fd5 - 0x2f00 + 1 }, (_, i) => String.fromCharCode(0x2f00 + i)).join('');
  assert.equal(all.length, 214);
  const pdf = cidPdf(all, (hex) => `BT /F1 12 Tf 10 700 Td ${hex(all)} Tj ET`);
  const r = await read(pdf);
  assert.equal(r.text, all.normalize('NFKC'));
  assert.doesNotMatch(r.text, /[⼀-⿕]/);
});

test('圧縮した ObjStm の中の /Catalog・頁の木を読む', async () => {
  const members = [[10, '<< /Type /Catalog /Pages 11 0 R >>'], [11, '<< /Type /Pages /Kids [12 0 R] /Count 1 >>'], [12, '<< /Type /Page /Parent 11 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents 2 0 R >>']];
  let offset = 0;
  const heads = members.map(([id, body]) => { const h = `${id} ${offset}`; offset += body.length + 1; return h; }).join(' ');
  const first = heads.length + 1;
  const objStm = stream(`${heads}\n${members.map((m) => m[1]).join('\n')}`, { dict: `/Type /ObjStm /N ${members.length} /First ${first}`, flate: true });
  const r = await read(build([objStm, stream('BT /F1 12 Tf 72 700 Td (Fictional outline) Tj ET', { flate: true }), HELVETICA], { head: '%PDF-1.5\n' }));
  assert.equal(r.status, 'ok');
  assert.equal(r.text, 'Fictional outline');
});

test('部品は外と通信せず、Node の部品に頼らない(画面でも同じコードが動く)', () => {
  const src = fs.readFileSync(new URL('../../src/pdf-read.mjs', import.meta.url), 'utf8');
  for (const word of ["from 'node:", 'from "node:', 'fetch(', 'XMLHttpRequest', 'Worker', 'eval(', 'new Function', 'WebSocket', 'import(']) {
    assert.equal(src.includes(word), false, word);
  }
});

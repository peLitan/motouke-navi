// F82a2: PDF を読む部品の上限と悪い PDF の単体テスト(値はすべて架空。試験の PDF はこの中で組み、ファイルは置かない)
// 部品は手を返しながら読むので、20秒の時計は読んでいる途中でも動く。同期の処理で手を返さなかった分は、読み終えた後の経過で見る
import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { readPdf, LIMITS } from '../../src/pdf-read.mjs';

const MB = 1024 * 1024;
const LIMIT_MS = 20000;
const latin = (s) => Buffer.from(s, 'latin1');

// 20秒以内に返らなければ落とす。readPdf が投げても落ちる
async function guarded(bytes, limits) {
  const started = performance.now();
  let timer;
  const late = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${LIMIT_MS / 1000}秒以内に返らない`)), LIMIT_MS); });
  const r = await Promise.race([readPdf(new Uint8Array(bytes), { limits }), late]);
  clearTimeout(timer);
  const elapsed = performance.now() - started;
  assert.ok(elapsed < LIMIT_MS, `${Math.round(elapsed)}ms かかった`);
  return r;
}

function build(objs) {
  const parts = [latin('%PDF-1.7\n')];
  objs.forEach((o, i) => parts.push(latin(`${i + 1} 0 obj\n`), Buffer.isBuffer(o) ? o : latin(o), latin('\nendobj\n')));
  parts.push(latin(`trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n0\n%%EOF\n`));
  return Buffer.concat(parts);
}
function stream(data, { dict = '', flate = false } = {}) {
  const raw = Buffer.isBuffer(data) ? data : latin(data);
  const body = flate ? deflateSync(raw) : raw;
  return Buffer.concat([latin(`<< ${dict}${flate ? ' /Filter /FlateDecode' : ''} /Length ${body.length} >>\nstream\n`), body, latin('\nendstream')]);
}

const CATALOG = '<< /Type /Catalog /Pages 2 0 R >>';
const pagesObj = (...ids) => `<< /Type /Pages /Kids [${ids.map((n) => `${n} 0 R`).join(' ')}] /Count ${ids.length} >>`;
const pageObj = (contents, resources = '/Font << /F1 5 0 R >>') => `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << ${resources} >> /Contents ${contents} >>`;
const HELVETICA = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
const TEXT = 'BT /F1 12 Tf 72 700 Td (fictional works) Tj ET';
const textContent = (s) => `BT /F1 12 Tf 72 700 Td (${s}) Tj ET`;

// 1頁の PDF。content は頁の中身のストリーム(番号 4)、more は番号 6 からの物
const onePage = (content = stream(TEXT), more = [], page = pageObj('4 0 R')) => build([CATALOG, pagesObj(3), page, content, HELVETICA, ...more]);
// 文の入った n 頁の PDF(番号 4 にフォントを置くので、頁の文を別に渡せる)
function manyPages(texts) {
  const pages = texts.flatMap((t, i) => [
    pageObj(`${5 + i * 2 + 1} 0 R`, '/Font << /F1 4 0 R >>'),
    stream(textContent(t)),
  ]);
  return build([CATALOG, pagesObj(...texts.map((_, i) => 5 + i * 2)), '<< >>', HELVETICA, ...pages]);
}
const type0 = (toUnicode, extra = '') => `<< /Type /Font /Subtype /Type0 /BaseFont /X /Encoding /Identity-H /ToUnicode ${toUnicode} 0 R /DescendantFonts [<< /Type /Font /Subtype /CIDFontType2 /BaseFont /X /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /DW 1000 ${extra} >>] >>`;
const withCMap = (cmap, content = 'BT /F1 12 Tf 72 700 Td <0041> Tj ET') => build([CATALOG, pagesObj(3), pageObj('4 0 R'), stream(content), type0(6), stream(cmap, { flate: true })]);
const CMAP_OK = '1 begincodespacerange <0000> <FFFF> endcodespacerange 1 beginbfchar <0041> <0041> endbfchar';

// 上位のビットから詰める
function bitWriter() {
  const bytes = [];
  let buf = 0, nb = 0;
  return {
    put(code, bits) {
      buf = (buf << bits) | code; nb += bits;
      while (nb >= 8) { bytes.push((buf >>> (nb - 8)) & 255); nb -= 8; }
      buf &= (1 << nb) - 1;
    },
    done() { if (nb) bytes.push((buf << (8 - nb)) & 255); return Buffer.from(bytes); },
  };
}
const widthOf = (n) => (n >= 2048 ? 12 : n >= 1024 ? 11 : n >= 512 ? 10 : 9);

// LZW に組む。受ける側の辞書の大きさを追って符号の幅を決める
function lzwEncode(data, early = 1) {
  const w = bitWriter(), table = new Map();
  let next = 258, seen = 258, first = true;
  const emit = (code) => {
    w.put(code, widthOf(seen + early));
    if (!first && seen < 4096) seen++;
    first = false;
  };
  const code = (s) => (s.length === 1 ? s.charCodeAt(0) : table.get(s));
  w.put(256, 9);
  let cur = '';
  for (const byte of data) {
    const c = String.fromCharCode(byte);
    if (cur === '' || table.has(cur + c)) { cur += c; continue; }
    emit(code(cur));
    if (next < 4096) table.set(cur + c, next++);
    cur = c;
  }
  if (cur) emit(code(cur));
  emit(257);
  return w.done();
}
// 同じ字の並び: 語を1字ずつ長くし、辞書が満ちたら一番長い語を呼び続ける。size バイトに達するまで
function lzwBomb(size) {
  const w = bitWriter();
  let seen = 258, code = 258, len = 2, out = 1;
  w.put(256, 9);
  w.put(97, 9);
  for (; code < 4096 && out < size; code++, len++, seen++) { w.put(code, widthOf(seen + 1)); out += len; }
  for (; out < size; out += len - 1) w.put(4095, 12);
  w.put(257, widthOf(seen + 1));
  return w.done();
}
// ASCII85 に組む(5字ごと)
function a85Encode(data) {
  let out = '';
  for (let i = 0; i < data.length; i += 4) {
    const chunk = data.subarray(i, i + 4), n = chunk.length;
    let v = 0;
    for (let k = 0; k < 4; k++) v = v * 256 + (chunk[k] ?? 0);
    const c = [];
    for (let k = 0; k < 5; k++) { c.unshift(String.fromCharCode(33 + (v % 85))); v = Math.floor(v / 85); }
    out += c.slice(0, n + 1).join('');
  }
  return latin(`${out}~>`);
}
const rlBomb = (runs) => { const b = Buffer.alloc(runs * 2, 0x20); for (let i = 0; i < runs; i++) b[i * 2] = 129; return b; }; // 1組で 128 バイト

const BOMBS = {
  Flate: (size) => stream(Buffer.alloc(size, 0x20), { flate: true }),
  LZW: (size) => stream(lzwBomb(size), { dict: '/Filter /LZWDecode' }),
  RunLength: (size) => stream(rlBomb(Math.ceil(size / 128)), { dict: '/Filter /RunLengthDecode' }),
};

test('既定の LIMITS は設計の値', () => {
  assert.equal(LIMITS.total, 128 * MB);
  assert.equal(LIMITS.stream, 64 * MB);
  assert.equal(LIMITS.formDo, 50000);
  assert.equal(LIMITS.pageChars, 50000);
  assert.equal(LIMITS.docChars, 3000000);
  assert.equal(LIMITS.ms, 30000);
  assert.equal(LIMITS.values, 20000000);
  assert.equal(LIMITS.file, 30 * MB);
});

for (const [name, bomb] of Object.entries(BOMBS)) {
  test(`${name} の圧縮爆弾: 1つのストリームの上限を越えると too-big、上限の中なら読む`, async () => {
    const pdf = onePage(bomb(2 * MB));
    assert.equal((await guarded(pdf, { stream: MB, total: 64 * MB })).status, 'too-big');
    assert.notEqual((await guarded(pdf, { stream: 3 * MB, total: 64 * MB })).status, 'too-big');
  });

  test(`${name} の圧縮爆弾: 1つずつは小さくても、合計の上限を越えると too-big`, async () => {
    const three = build([CATALOG, pagesObj(3), pageObj('[6 0 R 7 0 R 8 0 R]'), stream(TEXT), HELVETICA, bomb(MB), bomb(MB), bomb(MB)]);
    assert.equal((await guarded(three, { stream: 2 * MB, total: 2 * MB })).status, 'too-big');
    assert.notEqual((await guarded(three, { stream: 2 * MB, total: 4 * MB })).status, 'too-big');
  });

  test(`${name} の圧縮爆弾: 既定の上限でも止まる(入力は小さく、開くと 70MB)`, async () => {
    const pdf = onePage(bomb(70 * MB));
    assert.ok(pdf.length < 2 * MB, `入力は小さい: ${pdf.length}`);
    const r = await guarded(pdf);
    assert.equal(r.status, 'too-big');
    assert.equal(r.text, '');
  });
}

test('フィルタの無いストリームも合計に数える: 同じ物を /Contents に何度も並べても止まる', async () => {
  const refs = '4 0 R '.repeat(10000);
  const pdf = onePage(stream(Buffer.alloc(100000, 0x20)), [], pageObj(`[${refs}]`));
  assert.equal((await guarded(pdf)).status, 'too-big');
});

test('ASCII85 の z の並びも数える', async () => {
  const z = (n) => stream(Buffer.alloc(n, 0x7a), { dict: '/Filter /ASCII85Decode' });
  assert.equal((await guarded(onePage(z(MB)), { stream: 2 * MB })).status, 'too-big');
  assert.notEqual((await guarded(onePage(z(1000)), { stream: 2 * MB })).status, 'too-big');
});

test('Flate の後の ASCII85 でも止まる(開いた物の z の並び)', async () => {
  const pdf = onePage(stream(deflateSync(Buffer.alloc(40 * MB, 0x7a)), { dict: '/Filter [/FlateDecode /ASCII85Decode]' }));
  assert.equal((await guarded(pdf)).status, 'too-big');
});

test('普通の LZW はそのまま読める(EarlyChange 1・0)', async () => {
  for (const early of [1, 0]) {
    const body = lzwEncode(latin(TEXT), early);
    const dict = `/Filter /LZWDecode${early === 0 ? ' /DecodeParms << /EarlyChange 0 >>' : ''}`;
    const r = await readPdf(new Uint8Array(onePage(stream(body, { dict }))));
    assert.equal(r.status, 'ok');
    assert.equal(r.text, 'fictional works');
  }
});

test('LZW の辞書が 4096 で満ちた後も、同じ語が読める', async () => {
  // 語の種類が多い文を長く並べ、途中でクリアせずに辞書を満たす
  const words = Array.from({ length: 16000 }, (_, i) => `(w${(i * 7919) % 9973}) Tj `).join('');
  const content = latin(`BT /F1 12 Tf 72 700 Td ${words}ET`);
  const body = lzwEncode(content);
  assert.ok(body.length < content.length, '圧縮できている');
  const limits = { pageChars: 200000 }; // 語の数の分だけ字が要る
  const a = await readPdf(new Uint8Array(onePage(stream(content))), { limits });
  const b = await readPdf(new Uint8Array(onePage(stream(body, { dict: '/Filter /LZWDecode' }))), { limits });
  assert.equal(a.status, 'ok');
  assert.equal(b.status, 'ok');
  assert.equal(b.text, a.text);
});

test('普通の RunLength と ASCII85 はそのまま読める', async () => {
  const rl = Buffer.concat([...Buffer.from(TEXT)].flatMap((c) => [Buffer.from([0, c])]).concat(Buffer.from([128])));
  const r1 = await readPdf(new Uint8Array(onePage(stream(rl, { dict: '/Filter /RunLengthDecode' }))));
  assert.equal(r1.text, 'fictional works');
  // 同じ字の並び(257 - n 回)も戻る
  const spaced = Buffer.concat([Buffer.from([254, 0x20]), rl]);
  const r2 = await readPdf(new Uint8Array(onePage(stream(spaced, { dict: '/Filter /RunLengthDecode' }))));
  assert.equal(r2.text, 'fictional works');
  const r3 = await readPdf(new Uint8Array(onePage(stream(a85Encode(latin(TEXT)), { dict: '/Filter /ASCII85Decode' }))));
  assert.equal(r3.text, 'fictional works');
});

test('Form の Do: 上限まで読み、1回越えると too-big', async () => {
  const form = stream(TEXT, { dict: '/Type /XObject /Subtype /Form /BBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >>' });
  const page = pageObj('4 0 R', '/Font << /F1 5 0 R >> /XObject << /Fm 6 0 R >>');
  const pdf = onePage(stream('/Fm Do /Fm Do /Fm Do'), [form], page);
  assert.equal((await guarded(pdf, { formDo: 3 })).status, 'ok');
  assert.equal((await guarded(pdf, { formDo: 2 })).status, 'too-big');
});

test('1つの Form を 1000回 Do する Form 8段', async () => {
  const levels = Array.from({ length: 8 }, (_, lv) => stream(lv === 7 ? TEXT : '/Fm Do '.repeat(1000), {
    dict: `/Type /XObject /Subtype /Form /BBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> /XObject << /Fm ${7 + lv} 0 R >> >>`,
    flate: true,
  }));
  const page = pageObj('4 0 R', '/Font << /F1 5 0 R >> /XObject << /Fm 6 0 R >>');
  const r = await guarded(onePage(stream('/Fm Do '.repeat(1000), { flate: true }), levels, page));
  assert.equal(r.status, 'too-big');
});

test('字の上限: 1頁', async () => {
  const pdf = onePage(stream(textContent('abcde')));
  assert.equal((await guarded(pdf, { pageChars: 5 })).status, 'ok');
  assert.equal((await guarded(pdf, { pageChars: 4 })).status, 'too-big');
});

test('字の上限: 全体。頁ごとの上限の中でも、合計で越えると too-big', async () => {
  const pdf = manyPages(['abc', 'def']);
  assert.equal((await guarded(pdf, { docChars: 6 })).status, 'ok');
  assert.equal((await guarded(pdf, { docChars: 5 })).status, 'too-big');
});

test('字の上限: 空白と見えない字も数える(文に入らなくても時間とメモリを使うため)', async () => {
  assert.equal((await guarded(onePage(stream(textContent('a b c'))), { pageChars: 4 })).status, 'too-big');
  assert.equal((await guarded(onePage(stream('BT 3 Tr /F1 12 Tf 72 700 Td (abcde) Tj ET')), { pageChars: 4 })).status, 'too-big');
});

test('Tj の長い並びは既定の上限で止まる', async () => {
  const pdf = onePage(stream(textContent(' '.repeat(20 * MB)), { flate: true }));
  assert.equal((await guarded(pdf)).status, 'too-big');
});

test('頁の上限を越えると、前の頁だけを ok にせず too-big', async () => {
  const pdf = manyPages(['a', 'b', 'c']);
  assert.equal((await guarded(pdf, { pages: 3 })).status, 'ok');
  assert.equal((await guarded(pdf, { pages: 2 })).status, 'too-big');
});

test('経過時間の上限を越えると too-big', async () => {
  const pdf = onePage(stream(Buffer.from('q Q '.repeat(2 * MB))));
  assert.equal((await guarded(pdf, { ms: 1 })).status, 'too-big');
  assert.equal((await guarded(pdf)).status, 'no-text');
});

test('too-big は途中の文を返さない', async () => {
  const r = await readPdf(new Uint8Array(manyPages(['a', 'b', 'c'])), { limits: { docChars: 2 } });
  assert.deepEqual(r, { status: 'too-big', pageCount: 0, pages: [], text: '', stats: {} });
});

test('自分を指す参照は status を返す', async () => {
  const r = await guarded(build([CATALOG, '2 0 R']));
  assert.equal(r.status, 'broken');
});

test('頁の木の Kids の輪', async () => {
  const r = await guarded(build([CATALOG, '<< /Type /Pages /Kids [2 0 R 3 0 R] /Count 2 >>', '<< /Type /Pages /Kids [2 0 R] /Parent 3 0 R >>']));
  assert.equal(r.status, 'broken');
});

test('/Parent の輪: 頁は読める', async () => {
  const r = await guarded(build([CATALOG, '<< /Type /Pages /Kids [3 0 R] /Parent 3 0 R >>', pageObj('4 0 R'), stream(TEXT), HELVETICA]));
  assert.equal(r.status, 'ok');
  assert.equal(r.text, 'fictional works');
});

test('ObjStm の /N 2147483647', async () => {
  const pdf = onePage(stream(TEXT), [stream('9 0 << >>', { dict: '/Type /ObjStm /N 2147483647 /First 4' })]);
  const r = await guarded(pdf);
  assert.equal(r.status, 'ok');
  assert.equal(r.text, 'fictional works');
});

test('ObjStm の /First が本体より大きい', async () => {
  // /N を本体の長さで切っても組が足りない形。本体の終わりで止まらないと、/First の位置まで字を探し続ける
  const pdf = onePage(stream(TEXT), [stream('1000000000 0 '.repeat(100), { dict: '/Type /ObjStm /N 400 /First 2147483647' })]);
  assert.equal((await guarded(pdf)).status, 'ok');
});

test('ObjStm の組が同じ位置の大きい物を指す', async () => {
  const head = '9 0 '.repeat(50000);
  const body = `${head}[${'1 '.repeat(4000000)}]`;
  const pdf = onePage(stream(TEXT), [stream(body, { dict: `/Type /ObjStm /N 50000 /First ${head.length}`, flate: true })]);
  assert.equal((await guarded(pdf, { ms: 3000 })).status, 'too-big');
});

test('bfrange 1行で 4バイトの全幅', async () => {
  const wide = '1 beginbfrange <00000000> <FFFFFFFF> <0041> endbfrange';
  assert.equal((await guarded(withCMap(`1 begincodespacerange <0000> <FFFF> endcodespacerange ${wide}`))).status, 'unmapped');
  const r = await guarded(withCMap(`${CMAP_OK} ${wide}`));
  assert.equal(r.status, 'ok');
  assert.equal(r.text, 'A');
});

test('bfrange の広い行を並べても ToUnicode の行の上限で止まる', async () => {
  const lines = '<0000> <FFFF> <0041>\n'.repeat(20000);
  assert.equal((await guarded(withCMap(`${CMAP_OK} 20000 beginbfrange\n${lines}endbfrange`))).status, 'ok');
});

test('負の /Length で同じ所へ戻らない', async () => {
  // /Length を足すと手前の endstream に当たる形。戻ると同じ obj を読み続ける
  const pdf = Buffer.concat([
    latin('%PDF-1.7\nendstream\n7 0 obj\n<< /Length -43 >>\nstream\nabc\nendstream\nendobj\n'),
    onePage(stream(TEXT)).subarray('%PDF-1.7\n'.length),
  ]);
  const r = await guarded(pdf);
  assert.equal(r.status, 'ok');
  assert.equal(r.text, 'fictional works');
});

test('ToUnicode の閉じない begin の並び', async () => {
  for (const name of ['bfchar', 'bfrange', 'codespacerange']) {
    const r = await guarded(withCMap(`${CMAP_OK} ${`begin${name} `.repeat(2000000)}`));
    assert.equal(r.status, 'ok', name);
  }
});

test('ToUnicode の < の後の長い空白', async () => {
  for (const name of ['bfchar', 'bfrange', 'codespacerange']) {
    const r = await guarded(withCMap(`${CMAP_OK} 1 begin${name} <${' '.repeat(2000000)}end${name}`));
    assert.equal(r.status, 'ok', name);
  }
});

test('ToUnicode の値の中の空白と、配列の bfrange は今までどおり読む', async () => {
  const cmap = '1 begincodespacerange <00 00> <FF FF> endcodespacerange 1 beginbfchar <00 41> <30 42> endbfchar 1 beginbfrange <0050> <0051> [<3044> <3046>] <0060> <0061> <3048> endbfrange';
  const r = await guarded(withCMap(cmap, 'BT /F1 12 Tf 72 700 Td <00410050005100600061> Tj ET'));
  assert.equal(r.status, 'ok');
  assert.equal(r.text, 'あいうえぉ');
});

test('bfchar の中の [ ] は配列にせず読み飛ばす(形の崩れた表で PDF 全体を落とさない)', async () => {
  const cmap = '1 begincodespacerange <0000> <FFFF> endcodespacerange 3 beginbfchar [<0050> <0051> <0052> <0053>] <0041> <0041> endbfchar';
  const r = await guarded(withCMap(cmap));
  assert.equal(r.status, 'ok');
  assert.equal(r.text, 'A');
});

test('codespacerange の長い一覧でも1字ずつの時間が伸びない', async () => {
  const cmap = `1 begincodespacerange ${'<00> <FF> '.repeat(500000)}endcodespacerange 1 beginbfchar <41> <0041> endbfchar`;
  const r = await guarded(withCMap(cmap, `BT /F1 12 Tf 72 700 Td <${'41'.repeat(40000)}> Tj ET`));
  assert.equal(r.status, 'ok');
});

test('/W の範囲を並べても広げすぎない', async () => {
  const widths = `[${'0 69999 1 '.repeat(2000000)}]`;
  const pdf = build([CATALOG, pagesObj(3), pageObj('4 0 R'), stream('BT /F1 12 Tf 72 700 Td <0041> Tj ET'), type0(6, '/W 7 0 R'), stream(CMAP_OK), widths]);
  assert.equal((await guarded(pdf)).status, 'ok');
});

test('/W の同じ配列を並べても広げすぎない', async () => {
  const widths = `[${'0 8 0 R '.repeat(1000000)}]`;
  const list = `[${'1 '.repeat(1000000)}]`;
  const pdf = build([CATALOG, pagesObj(3), pageObj('4 0 R'), stream('BT /F1 12 Tf 72 700 Td <0041> Tj ET'), type0(6, '/W 7 0 R'), stream(CMAP_OK), widths, list]);
  assert.equal((await guarded(pdf)).status, 'ok');
});

test('LZW のクリアの並び', async () => {
  // 9ビットの 256 を8つで9バイト
  const w = bitWriter();
  for (let i = 0; i < 8; i++) w.put(256, 9);
  const clears = Buffer.alloc(22000000, w.done());
  const r = await guarded(onePage(stream(TEXT), [stream(clears, { dict: '/Filter /LZWDecode' })], pageObj('[4 0 R 6 0 R]')));
  assert.equal(r.status, 'ok');
});

test('開いた obj の中に次の obj が続く並び', async () => {
  const pdf = Buffer.concat([latin('%PDF-1.7\n'), latin('1 0 obj ['.repeat(300000)), latin('\n%%EOF\n')]);
  assert.equal((await guarded(pdf, { ms: 3000 })).status, 'too-big');
});

test('trailer の並び', async () => {
  const body = onePage(stream(TEXT));
  const pdf = Buffer.concat([body.subarray(0, body.length - 6), latin('trailer<<'.repeat(3000000)), latin('\n%%EOF\n')]);
  assert.equal((await guarded(pdf)).status, 'ok');
});

test('覚える値の上限: dict は 10 と数え、ObjStm の中も数える', async () => {
  const objstm = (body) => stream(`9 0 ${body}`, { dict: '/Type /ObjStm /N 1 /First 4', flate: true });
  const arrays = onePage(stream(TEXT), [objstm(`[${'[] '.repeat(1000)}]`)]);
  const dicts = onePage(stream(TEXT), [objstm(`[${'<<>> '.repeat(1000)}]`)]);
  assert.equal((await guarded(arrays, { values: 2000 })).status, 'ok');
  assert.equal((await guarded(dicts, { values: 2000 })).status, 'too-big');
  assert.equal((await guarded(dicts, { values: 20000 })).status, 'ok');
});

test('覚える値の上限: 頁の中身は演算子を実行すると捨てるので、演算子ごとに数え直す', async () => {
  const many = onePage(stream('q Q '.repeat(5000)));
  assert.equal((await guarded(many, { values: 1000 })).status, 'no-text');
  const one = onePage(stream(`[${'/a '.repeat(5000)}] TJ`));
  assert.equal((await guarded(one, { values: 1000 })).status, 'too-big');
  const operands = onePage(stream(`${'/a '.repeat(5000)} TJ`));
  assert.equal((await guarded(operands, { values: 1000, stack: 10000 })).status, 'too-big');
});

test('覚える値の上限: フォームごとに作る ToUnicode の表も数える', async () => {
  const cmap = `1 begincodespacerange <0000> <FFFF> endcodespacerange 1 beginbfrange <0000> <03E7> <3042> endbfrange`;
  const fonts = Array.from({ length: 20 }, (_, i) => `/F${i} ${7 + i} 0 R`).join(' ');
  const content = Array.from({ length: 20 }, (_, i) => `/F${i} 12 Tf`).join(' ');
  const pdf = build([CATALOG, pagesObj(3), pageObj('4 0 R', `/Font << ${fonts} >>`), stream(`BT ${content} ET`), HELVETICA, stream(cmap), ...Array.from({ length: 20 }, () => type0(6))]);
  assert.equal((await guarded(pdf, { values: 100000 })).status, 'no-text');
  assert.equal((await guarded(pdf, { values: 15000 })).status, 'too-big');
});

test('ToUnicode の1字の値が長くても、頁の文は膨らまない', async () => {
  const r = await guarded(withCMap(`${CMAP_OK.replace('<0041> <0041>', `<0041> <${'4E00'.repeat(1000)}>`)}`));
  assert.equal(r.status, 'ok');
  assert.equal(r.text, '\u4E00'.repeat(64));
});

test('16進の文字列と ASCIIHex は読める。字の数が奇数なら最後に 0 を補う', async () => {
  const hex = Buffer.from(TEXT, 'latin1').toString('hex');
  const r1 = await readPdf(new Uint8Array(onePage(stream(latin(`${hex.toUpperCase()}>`), { dict: '/Filter /ASCIIHexDecode' }))));
  assert.equal(r1.text, 'fictional works');
  const r2 = await readPdf(new Uint8Array(onePage(stream('BT /F1 12 Tf 72 700 Td <6162 6> Tj ET'))));
  assert.equal(r2.text, 'ab`');
  const r3 = await readPdf(new Uint8Array(onePage(stream(latin(`${hex}4`) , { dict: '/Filter /AHx' }))));
  assert.equal(r3.text, 'fictional works');
});

test('エスケープと入れ子の括弧の文字列は今までどおり読む', async () => {
  const r = await readPdf(new Uint8Array(onePage(stream(String.raw`BT /F1 12 Tf 72 700 Td (a\(b\)\101(c)\
d) Tj ET`))));
  assert.equal(r.text, 'a(b)A(c)d');
});

test('読んでいる間に画面へ手を返す', async () => {
  const pdf = new Uint8Array(onePage(stream(Buffer.from('q Q '.repeat(6 * MB)))));
  let fired = 0;
  const timer = setInterval(() => { fired += 1; }, 1);
  const r = await readPdf(pdf);
  clearInterval(timer);
  assert.equal(r.status, 'no-text');
  assert.ok(fired >= 3, `タイマーが動いた回数: ${fired}`);
});

test('onProgress は頁ごとに (頁, 頁の数) で呼ばれる', async () => {
  const calls = [];
  const r = await readPdf(new Uint8Array(manyPages(['a', 'b', 'c'])), { onProgress: (page, pageCount) => calls.push([page, pageCount]) });
  assert.equal(r.status, 'ok');
  assert.deepEqual(calls, [[1, 3], [2, 3], [3, 3]]);
});

test('読めない物では onProgress を呼ばない', async () => {
  const calls = [];
  await readPdf(new Uint8Array(latin('not a pdf')), { onProgress: (...a) => calls.push(a) });
  await readPdf(new Uint8Array(latin('%PDF-1.4')), { onProgress: (...a) => calls.push(a) });
  assert.deepEqual(calls, []);
});

test('第2引数は無くてもよい', async () => {
  const pdf = new Uint8Array(onePage());
  for (const r of [await readPdf(pdf), await readPdf(pdf, {}), await readPdf(pdf, null), await readPdf(pdf, { limits: {} })]) {
    assert.equal(r.status, 'ok');
    assert.equal(r.text, 'fictional works');
  }
});

test('limits はその呼び出しの間だけ効き、同時に読んでも混ざらない', async () => {
  const pdf = new Uint8Array(onePage());
  const before = { ...LIMITS };
  const [small, normal] = await Promise.all([readPdf(pdf, { limits: { pageChars: 1 } }), readPdf(pdf)]);
  assert.equal(small.status, 'too-big');
  assert.equal(normal.status, 'ok');
  assert.deepEqual(LIMITS, before);
});

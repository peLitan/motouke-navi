// F82b: 文の置き換え A の「ファイルから読む」で PDF を読む(値はすべて架空。試験の PDF はこの中で組み、ファイルは置かない)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { deflateSync } from 'node:zlib';
import { extractFile, extractText, MASK_FILE_TYPES } from '../../src/mask/extract.mjs';
import { loadMaskFile } from '../../src/ui/mask-app.mjs';
import { handleFileDrop } from '../../src/ui/app.mjs';
import { buildHtml, bundle } from '../../build.mjs';
import { runPage } from '../acceptance/_helpers.mjs';
import { createMasker } from '../../src/mask/core.mjs';
import { CONSTRUCTION_DICT } from '../../src/mask/dict-construction.mjs';

const latin = (s) => Buffer.from(s, 'latin1');
const INTERNAL = ['no-text', 'encrypted', 'unmapped', 'broken', 'too-big', 'not-pdf', 'status', 'ToUnicode', 'Identity'];

// xref の位置を数えて書く。objs は 1 から順の番号の中身
function build(objs, { trailer = '' } = {}) {
  const parts = [latin('%PDF-1.7\n')];
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
  return new Uint8Array(Buffer.concat(parts));
}
function stream(data, { dict = '', flate = false } = {}) {
  const raw = Buffer.isBuffer(data) ? data : latin(data);
  const body = flate ? deflateSync(raw) : raw;
  return Buffer.concat([latin(`<< ${dict}${flate ? ' /Filter /FlateDecode' : ''} /Length ${body.length} >>\nstream\n`), body, latin('\nendstream')]);
}

const CATALOG = '<< /Type /Catalog /Pages 2 0 R >>';
const image = (n) => stream(Buffer.alloc(n * n, 0x80), { dict: `/Type /XObject /Subtype /Image /Width ${n} /Height ${n} /ColorSpace /DeviceGray /BitsPerComponent 8` });
const FULL_IMAGE = 'q 595 0 0 842 0 0 cm /Im0 Do Q';
const u16 = (c) => [...Buffer.from(c, 'utf16le').swap16()].map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();

// 日本語の字を番号に当てるフォント。hex(s) は字の並びを番号の並びにする
function cidFont(alphabet) {
  const list = [...alphabet];
  const lines = list.map((c, i) => `<${(i + 1).toString(16).padStart(4, '0')}> <${u16(c)}>`);
  const cmap = `/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CMapName /X def 1 begincodespacerange <0000> <FFFF> endcodespacerange ${list.length} beginbfchar\n${lines.join('\n')}\nendbfchar endcmap`;
  return { cmap, hex: (s) => `<${[...s].map((c) => (list.indexOf(c) + 1).toString(16).padStart(4, '0')).join('')}>` };
}
const type0 = (toUnicode) => `<< /Type /Font /Subtype /Type0 /BaseFont /X /Encoding /Identity-H ${toUnicode ? `/ToUnicode ${toUnicode} 0 R ` : ''}/DescendantFonts [<< /Type /Font /Subtype /CIDFontType2 /BaseFont /X /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /DW 1000 >>] >>`;

// 頁ごとの文(空文字は全面の画像の頁)から PDF を組む。番号は 1 Catalog・2 Pages・3 ToUnicode・4 フォント・5 画像、6 から頁と中身
function jaPdf(pageTexts, { hidden = '', toUnicode = true, trailer = '', stray = 0 } = {}) {
  const { cmap, hex } = cidFont('甲乙丙丁建設工事の計画書担当者見積現場事務所図面頁番号12345678');
  const kids = pageTexts.map((_, i) => 6 + i * 2);
  const objs = [CATALOG, `<< /Type /Pages /Kids [${kids.map((n) => `${n} 0 R`).join(' ')}] /Count ${kids.length} >>`, stream(cmap, { flate: true }), type0(toUnicode ? 3 : null), image(8)];
  pageTexts.forEach((t, i) => {
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> /XObject << /Im0 5 0 R >> >> /Contents ${7 + i * 2} 0 R >>`);
    const body = t === '' ? FULL_IMAGE : `BT /F1 12 Tf 72 700 Td ${hex(t)} Tj ET`;
    const unseen = hidden && i === 0 ? ` BT 3 Tr /F1 12 Tf 72 600 Td ${hex(hidden)} Tj ET` : '';
    const unknown = stray && i === 0 ? ` BT /F1 12 Tf 72 500 Td <${'0FFF'.repeat(stray)}> Tj ET` : ''; // 表に無い番号の字
    objs.push(stream(body + unseen + unknown, { flate: true }));
  });
  return build(objs, { trailer });
}
const scanPdf = () => jaPdf(['']);

// 頁の中身の圧縮が途中で切れた PDF(末尾の %%EOF はある)
function cutStreamPdf() {
  const lines = Array.from({ length: 40 }, (_, i) => `BT /F1 12 Tf 72 ${700 - i * 14} Td (line ${i} of the fictional page) Tj ET`).join('\n');
  const whole = deflateSync(latin(lines));
  const cut = whole.subarray(0, Math.floor(whole.length / 2));
  return build([CATALOG, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>', Buffer.concat([latin(`<< /Filter /FlateDecode /Length ${cut.length} >>\nstream\n`), cut, latin('\nendstream')])]);
}

// 頁が多すぎる PDF(中身は1つを全部の頁で使う)
function manyPages(n) {
  const kids = Array.from({ length: n }, (_, i) => `${5 + i} 0 R`).join(' ');
  const objs = [CATALOG, `<< /Type /Pages /Kids [${kids}] /Count ${n} >>`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>', stream('BT /F1 12 Tf 72 700 Td (x) Tj ET')];
  for (let i = 0; i < n; i++) objs.push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents 4 0 R >>');
  return build(objs);
}

const UNREADABLE = [
  ['紙を写した画像だけ', () => scanPdf(), /文字の入っていない PDF/, /元の Excel・Word をもらう|紙を見て入れて/],
  ['保護つき', () => jaPdf(['建設工事の計画書'], { trailer: '/Encrypt 5 0 R ' }), /保護/, /文字の取れる版をもらう|手で入れて/],
  ['字の形だけ', () => jaPdf(['建設工事の計画書'], { toUnicode: false }), /文字に戻せません/, /元の Word・Excel をもらって/],
  ['壊れている', () => new TextEncoder().encode('%PDF-1.4'), /切れているか壊れて/, /もう一度ダウンロード|送り直して/],
  ['大きすぎる', () => manyPages(3001), /大きすぎて/, /要る頁だけの PDF/],
  ['PDF でない', () => new TextEncoder().encode('これはただの文です'), /PDF の形ではありません/, /中身が違います/],
];

// ---- extractFile ----
test('ok: 頁の間に区切りの行が入り、表の順の注意が notes に出る', async () => {
  const r = await extractFile('計画書.pdf', jaPdf(['建設工事の計画書', '現場事務所の図面']));
  assert.deepEqual(r.text.split('\n'), ['建設工事の計画書', '―― 2頁 ――', '現場事務所の図面']);
  assert.deepEqual(r.notes, ['表は行や列の順が崩れることがあります。紙と見比べてください。']);
});

test('ok: 1頁の PDF には区切りの行を入れない', async () => {
  const r = await extractFile('計画書.PDF', jaPdf(['建設工事の計画書']));
  assert.equal(r.text, '建設工事の計画書');
  assert.equal(r.notes.length, 1);
});

test('partial: 読めない頁の番号を notes に出し、番号がずれないよう空の頁にも区切りの行を入れる', async () => {
  const r = await extractFile('写し.pdf', jaPdf(['建設工事の計画書', '現場事務所', '', '', '図面']));
  assert.deepEqual(r.text.split('\n'), ['建設工事の計画書', '―― 2頁 ――', '現場事務所', '―― 3頁 ――', '', '―― 4頁 ――', '', '―― 5頁 ――', '図面']);
  assert.equal(r.notes[0], '5頁のうち 3・4頁は文字が無い(紙を写した画像)ので読めていません。');
  assert.ok(r.notes.includes('表は行や列の順が崩れることがあります。紙と見比べてください。'), '読めた頁の表の注意は partial でも出す');
});

test('partial: 続いた3頁以上の番号は「〜」でまとめ、離れた頁は残す', async () => {
  const r = await extractFile('写し.pdf', jaPdf(['建設工事', '', '', '', '', '図面', '', '計画書']));
  assert.equal(r.notes[0], '8頁のうち 2〜5・7頁は文字が無い(紙を写した画像)ので読めていません。');
});

test('見えない字は文に入れず、数を notes に出す', async () => {
  const r = await extractFile('隠し.pdf', jaPdf(['建設工事の計画書'], { hidden: '甲乙丙丁' }));
  assert.equal(r.text, '建設工事の計画書');
  assert.ok(r.notes.includes('見えない字(4字)は入れていません。'), JSON.stringify(r.notes));
});

test('字に戻せなかった字が少しあれば、ok のまま数と探す字を notes に出す', async () => {
  const r = await extractFile('一部.pdf', jaPdf(['建設工事の計画書の現場事務所の図面の担当者の見積'], { stray: 1 }));
  assert.ok(r.text.includes('\uFFFD'));
  assert.ok(r.notes.includes('字に戻せなかった字(1字)は「\uFFFD」のまま入れています。この字を探して紙と見比べてください。'), JSON.stringify(r.notes));
});

test('圧縮が途中で切れた頁は、ok でも読めていない所があると notes に出す', async () => {
  const r = await extractFile('切れた.pdf', cutStreamPdf());
  assert.ok(r.text.length > 0, '読めた所は欄に入れる');
  assert.ok(r.notes.includes('中身の一部が壊れていて、読めていない所があります。紙と見比べてください。'), JSON.stringify(r.notes));
});

test('欠けが無い PDF には、字と壊れた所の注意を出さない', async () => {
  const { notes } = await extractFile('普通.pdf', jaPdf(['建設工事の計画書']));
  assert.deepEqual(notes, ['表は行や列の順が崩れることがあります。紙と見比べてください。']);
});

test('展開の機能が無いブラウザでは、壊れているとは言わない', async () => {
  const saved = globalThis.DecompressionStream;
  delete globalThis.DecompressionStream;
  try {
    await assert.rejects(() => extractFile('a.pdf', jaPdf(['建設工事'])), /^Error: このブラウザでは PDF を開けません。文字をコピーして貼り付けてください$/);
  } finally {
    globalThis.DecompressionStream = saved;
  }
});

test('読めない PDF は、理由と次の手の文で止まり、内部の語を出さない', async () => {
  for (const [what, make, reason, next] of UNREADABLE) {
    await assert.rejects(() => extractFile('読めない.pdf', make()), (e) => {
      assert.match(e.message, reason, what);
      assert.match(e.message, next, what);
      for (const w of INTERNAL) assert.ok(!e.message.includes(w), what + ' に内部の語: ' + w + ' / ' + e.message);
      return true;
    });
  }
});

test('30MB を越える PDF は、ほかの形式と同じ大きさの文で止まる', async () => {
  await assert.rejects(() => extractFile('大きい.pdf', new Uint8Array(30 * 1024 * 1024 + 1)), /ファイルが大きすぎます\(上限 30MB\)/);
});

test('extractText は extractFile の文を返す。PDF 以外の notes は空', async () => {
  const pdf = jaPdf(['建設工事の計画書', '現場事務所']);
  assert.equal(await extractText('a.pdf', pdf), (await extractFile('a.pdf', pdf)).text);
  assert.deepEqual(await extractFile('a.txt', new TextEncoder().encode('架空の文')), { text: '架空の文', notes: [] });
  assert.ok(MASK_FILE_TYPES.includes('.pdf'));
});

test('対応していない形式の文から、PDF は読めないの案内が消えている', async () => {
  await assert.rejects(() => extractFile('古い.doc', new Uint8Array(1)), (e) => {
    assert.match(e.message, /読めるのは \.txt・\.docx・\.xlsx・\.pdf です/);
    assert.ok(!/PDF・\.doc/.test(e.message), e.message);
    return true;
  });
});

test('onProgress に頁の番号が渡る', async () => {
  const seen = [];
  await extractFile('a.pdf', jaPdf(['建設工事', '現場', '図面']), { onProgress: (p, n) => seen.push([p, n]) });
  assert.deepEqual(seen, [[1, 3], [2, 3], [3, 3]]);
});

test('区切りの行は置き換えで変わらず、頁の中の名前は置き換わる', async () => {
  const { text } = await extractFile('a.pdf', jaPdf(['甲乙建設工事', '現場事務所の図面']));
  const r = createMasker({ dictionaries: [CONSTRUCTION_DICT] }).mask(text + '\n担当 山田太郎 甲乙建設株式会社');
  assert.ok(r.masked.includes('―― 2頁 ――'), r.masked);
  assert.ok(!r.masked.includes('甲乙建設株式会社'), r.masked);
});

// ---- 画面の入口 ----
const fakeDoc = (input = '') => {
  const seen = [];
  const status = {
    attrs: {},
    set textContent(v) { this.value = v; seen.push(v); },
    get textContent() { return this.value; },
    setAttribute(k, v) { this.attrs[k] = v; },
    getAttribute(k) { return this.attrs[k] ?? null; },
    removeAttribute(k) { delete this.attrs[k]; },
  };
  const els = { 'mask-input': { value: input }, 'mask-file-status': status };
  return { doc: { getElementById: (id) => els[id] ?? null }, els, seen };
};
const fileOf = (name, bytes) => ({ name, size: bytes.length, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });

test('loadMaskFile: 読む間の文と頁の進み、行の数と notes を出す', async () => {
  const { doc, els, seen } = fakeDoc();
  assert.equal(await loadMaskFile(doc, fileOf('計画書.pdf', jaPdf(['建設工事の計画書', '', '現場事務所'], { hidden: '甲乙' }))), true);
  assert.equal(els['mask-input'].value.split('\n')[1], '―― 2頁 ――');
  assert.equal(seen[0], '「計画書.pdf」を読んでいます…');
  for (const line of ['「計画書.pdf」を読んでいます(1/3頁)', '「計画書.pdf」を読んでいます(2/3頁)', '「計画書.pdf」を読んでいます(3/3頁)']) assert.ok(seen.includes(line), JSON.stringify(seen));
  const last = els['mask-file-status'].textContent;
  assert.match(last, /^「計画書\.pdf」から文字を取り出しました\(5 行\)。中身を確かめてから「置き換える」を押してください。/);
  for (const note of ['3頁のうち 2頁は文字が無い', '見えない字(2字)は入れていません。', '表は行や列の順が崩れることがあります。']) assert.ok(last.includes(note), last);
});

test('loadMaskFile: 読めない PDF では欄を変えず、失敗を返して理由と次の手を出す', async () => {
  for (const [what, make, reason, next] of UNREADABLE) {
    const { doc, els } = fakeDoc('前の文');
    assert.equal(await loadMaskFile(doc, fileOf('読めない.pdf', make())), false, what);
    assert.equal(els['mask-input'].value, '前の文', what);
    const line = els['mask-file-status'].textContent;
    assert.ok(line.startsWith('「読めない.pdf」を読めませんでした: '), line);
    assert.match(line, reason);
    assert.match(line, next);
  }
});

test('loadMaskFile: 読んでいる間に別のファイルを選んだら、前の結果で欄と知らせを上書きしない', async () => {
  const { doc, els } = fakeDoc();
  const slow = jaPdf(['建設工事の計画書', '現場事務所']);
  let release;
  const gate = new Promise((r) => { release = r; });
  const held = { name: '遅い.pdf', size: slow.length, arrayBuffer: async () => { await gate; return slow.buffer.slice(slow.byteOffset, slow.byteOffset + slow.byteLength); } };
  const first = loadMaskFile(doc, held);
  assert.equal(await loadMaskFile(doc, fileOf('後.txt', new TextEncoder().encode('後から選んだ文'))), true);
  release();
  assert.notEqual(await first, false, '失敗の印を付けない');
  assert.equal(els['mask-input'].value, '後から選んだ文');
  assert.match(els['mask-file-status'].textContent, /^「後\.txt」から文字を取り出しました/);
});

// 枠に置いたときの流れ(読む → 失敗の印)を、本物の app.mjs で見る
function dropDoc(input) {
  const el = (attrs = {}) => {
    const a = { ...attrs };
    return { value: '', textContent: '', getAttribute: (k) => a[k] ?? null, setAttribute: (k, v) => { a[k] = String(v); }, removeAttribute: (k) => { delete a[k]; }, classList: { add() {}, remove() {} } };
  };
  const frame = el({ 'data-drop': 'mask-file' });
  const els = new Map([['mask-file', el({ accept: '.txt,.docx,.xlsx,.pdf,text/plain,application/pdf' })]]);
  const doc = { getElementById(id) { if (!els.has(id)) els.set(id, el()); return els.get(id); } };
  doc.getElementById('sample-banner').hidden = true;
  doc.getElementById('mask-input').value = input;
  return { doc, frame };
}
const dropFile = (doc, frame, file) => handleFileDrop(doc, { target: frame, preventDefault() {}, dataTransfer: { types: ['Files'], files: [file] } });

test('枠に置いた PDF が読めないと失敗の印が付いて欄は変わらず、読めると印が外れる', async () => {
  const { doc, frame } = dropDoc('前の文');
  const status = doc.getElementById('mask-file-status');
  for (const [what, make] of UNREADABLE) {
    status.removeAttribute('data-kind');
    await dropFile(doc, frame, fileOf('読めない.pdf', make()));
    assert.equal(status.getAttribute('data-kind'), 'error', what);
    assert.equal(doc.getElementById('mask-input').value, '前の文', what);
  }
  await dropFile(doc, frame, fileOf('読める.pdf', jaPdf(['建設工事の計画書'])));
  assert.equal(status.getAttribute('data-kind'), null);
  assert.equal(doc.getElementById('mask-input').value, '建設工事の計画書');
});

test('読んでいる間に別のファイルを選ぶと、前の読みの失敗で印を付けない', async () => {
  const { doc, frame } = dropDoc('');
  const status = doc.getElementById('mask-file-status');
  const bad = scanPdf();
  let release;
  const gate = new Promise((r) => { release = r; });
  const held = { name: '遅い.pdf', size: bad.length, arrayBuffer: async () => { await gate; return bad.buffer.slice(bad.byteOffset, bad.byteOffset + bad.byteLength); } };
  const first = dropFile(doc, frame, held);
  await dropFile(doc, frame, fileOf('後.txt', new TextEncoder().encode('後から選んだ文')));
  release();
  await first;
  assert.match(status.textContent, /^「後\.txt」から文字を取り出しました/);
  assert.equal(status.getAttribute('data-kind'), null);
});

test('組み立てた index.html の中でも PDF の部品がつながり、PDF でない物に失敗の印が付く', async () => {
  const page = runPage(buildHtml());
  page.el('mask-input').value = '前の文';
  page.el('mask-file').files = [fileOf('名前だけ.pdf', new TextEncoder().encode('これはただの文です'))];
  await page.set('mask-file', '');
  assert.match(page.el('mask-file-status').textContent, /^「名前だけ\.pdf」を読めませんでした: PDF の形ではありません/);
  assert.equal(page.el('mask-file-status').getAttribute('data-kind'), 'error');
  assert.equal(page.el('mask-input').value, '前の文');
});

test('組み立てたスクリプトに入った PDF の部品だけで、合成の PDF を読める', async () => {
  const m = bundle().match(/__m\["src\/pdf-read\.mjs"\] = (\(function \(\) \{[\s\S]*?\n\}\)\(\));\n__m\[/);
  assert.ok(m, '部品がスクリプトに入っていない');
  const { readPdf } = (0, eval)(m[1]);
  const r = await readPdf(jaPdf(['建設工事の計画書']));
  assert.equal(r.status, 'ok');
  assert.equal(r.text, '建設工事の計画書');
});

test('画面の label・accept・説明に PDF があり、「読めない」の文が無い', () => {
  for (const file of ['src/ui/shell.html', 'index.html']) {
    const html = fs.readFileSync(new URL('../../' + file, import.meta.url), 'utf8');
    const input = html.match(/<input\b[^>]*\bid="mask-file"[^>]*>/)[0];
    const accept = input.match(/accept="([^"]*)"/)[1].split(',');
    for (const a of ['.pdf', 'application/pdf', '.txt', '.docx', '.xlsx']) assert.ok(accept.includes(a), file + ' の accept に ' + a + ' が無い');
    assert.ok(html.includes('ファイルから読む(.txt・.docx・.xlsx・.pdf)'), file);
    assert.ok(!html.includes('PDF・.doc・.xls は読めない'), file);
  }
});

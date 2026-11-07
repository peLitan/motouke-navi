// F85b: 画面のファイルの口(src/mask/extract.mjs の decodeText)が ISO-2022-JP の .txt を読まずに断る試験。文はすべて架空
// ISO-2022-JP は全部が 7bit で UTF-8 として読めてしまうので、断らないと「文字を取り出しました」と出て、名前が符号の字のまま置き換わらない
// Node は ISO-2022-JP にも Shift_JIS にも encode できないので、decoder を逆に引いた表でバイト列を作り、同じ文に戻せることを確かめてから使う
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { decodeText, extractFile } from '../../src/mask/extract.mjs';
import { buildHtml } from '../../build.mjs';
import { runPage } from '../acceptance/_helpers.mjs';

const MESSAGE = 'ISO-2022-JP のファイルは読めません。UTF-8 か Shift_JIS で保存し直してください。';
const BY_HAND = '手で入れるときは、下の「施工計画書の目次」の欄に貼ります。';
const TEXT = '元請負人: 甲山建設株式会社\n監理技術者: 乙川一郎\n';
const ESC = 0x1b;
const MARKS = { 'ESC $ B': '$B', 'ESC $ @': '$@', 'ESC ( J': '(J', 'ESC ( B': '(B' };
const ascii = (s) => [...Buffer.from(s, 'latin1')];

function jisTable() {
  const decoder = new TextDecoder('iso-2022-jp', { fatal: true });
  const table = new Map();
  for (let row = 0x21; row <= 0x7e; row += 1) {
    for (let cell = 0x21; cell <= 0x7e; cell += 1) {
      let ch;
      try { ch = decoder.decode(Uint8Array.from([ESC, 0x24, 0x42, row, cell, ESC, 0x28, 0x42])); } catch { continue; }
      if ([...ch].length === 1 && !table.has(ch)) table.set(ch, [row, cell]);
    }
  }
  return table;
}
function sjisTable() {
  const decoder = new TextDecoder('shift_jis', { fatal: true });
  const table = new Map();
  for (let lead = 0x81; lead <= 0xef; lead += 1) {
    for (let trail = 0x40; trail <= 0xfc; trail += 1) {
      let ch;
      try { ch = decoder.decode(Uint8Array.from([lead, trail])); } catch { continue; }
      if ([...ch].length === 1 && !table.has(ch)) table.set(ch, [lead, trail]);
    }
  }
  return table;
}
const JIS = jisTable();
const SJIS = sjisTable();

// 漢字の並びの前で ESC $ B、終わりで ESC ( B を入れる
function iso2022(text, { enter = '$B', leave = '(B' } = {}) {
  const out = [];
  let inKanji = false;
  for (const ch of text) {
    const kanji = ch.codePointAt(0) >= 0x80;
    if (kanji !== inKanji) { out.push(ESC, ...ascii(kanji ? enter : leave)); inKanji = kanji; }
    if (kanji) {
      assert.ok(JIS.has(ch), 'JIS に無い字: ' + ch);
      out.push(...JIS.get(ch));
    } else out.push(ch.codePointAt(0));
  }
  if (inKanji) out.push(ESC, ...ascii(leave));
  return Uint8Array.from(out);
}
const shiftJis = (text) => Uint8Array.from([...text].flatMap((ch) => {
  if (ch.codePointAt(0) < 0x80) return [ch.codePointAt(0)];
  assert.ok(SJIS.has(ch), 'Shift_JIS に無い字: ' + ch);
  return SJIS.get(ch);
}));
const utf8 = (text) => new TextEncoder().encode(text);
const fileOf = (name, bytes) => ({ name, size: bytes.length, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });

const ISO_FILE = iso2022(TEXT);

const until = async (done) => { for (let i = 0; i < 400 && !done(); i += 1) await new Promise((r) => setImmediate(r)); };
// 組み立てた index.html の中で、ファイルの口にファイルを渡す。印の字が組み立てで壊れていないことも一緒に見る
async function give(page, port, status, file) {
  page.el(port).files = [file];
  await page.set(port, '');
  await until(() => page.el(status).textContent !== '' && !page.el(status).textContent.includes('を読んでいます'));
}

test('前提: 作ったバイト列は ISO-2022-JP として同じ文に戻り、UTF-8 としても読めてしまう(だから入口で断る)', () => {
  assert.equal(new TextDecoder('iso-2022-jp', { fatal: true }).decode(ISO_FILE), TEXT);
  const asUtf8 = new TextDecoder('utf-8', { fatal: true }).decode(ISO_FILE);
  assert.notEqual(asUtf8, TEXT);
  assert.ok(!asUtf8.includes('甲山建設'));
  assert.equal(new TextDecoder('shift_jis', { fatal: true }).decode(shiftJis(TEXT)), TEXT);
});

test('extractFile と decodeText: ISO-2022-JP のバイトを文 1 つで断る', async () => {
  await assert.rejects(() => extractFile('架空.txt', ISO_FILE), { message: MESSAGE });
  await assert.rejects(() => extractFile('架空.TXT', ISO_FILE), { message: MESSAGE });
  assert.throws(() => decodeText(ISO_FILE), { message: MESSAGE });
});

test('4 つの印のどれか 1 つだけでも、どこにあっても断る(頭・途中・ファイルの最後の 3 バイト・BOM の後)', () => {
  for (const [label, mark] of Object.entries(MARKS)) {
    const seq = [ESC, ...ascii(mark)];
    const bom = [0xef, 0xbb, 0xbf];
    const places = {
      頭: [...seq, ...ascii('abc')],
      途中: [...ascii('abc'), ...seq, ...ascii('def')],
      最後: [...ascii('abc'), ...seq],
      'BOM の後': [...bom, ...seq, ...ascii('abc')],
      '別の ESC の後': [ESC, ...ascii('[0m'), ...seq],
    };
    for (const [where, bytes] of Object.entries(places)) {
      assert.throws(() => decodeText(Uint8Array.from(bytes)), { message: MESSAGE }, label + ' ' + where);
    }
  }
});

test('Uint8Array の一部を指す subarray でも、外のバイトを見ず、中の印を見る', () => {
  const inner = Uint8Array.from([0x61, ESC, 0x28, 0x42, 0x62]);
  assert.equal(decodeText(inner.subarray(0, 2)), 'a\x1b', '切り落とした外の印を見ない');
  assert.throws(() => decodeText(inner.subarray(1, 4)), { message: MESSAGE });
});

test('同じ文の UTF-8・BOM つき UTF-8・Shift_JIS は今どおり読める', async () => {
  const files = {
    'UTF-8': utf8(TEXT),
    'BOM つき UTF-8': Uint8Array.from([0xef, 0xbb, 0xbf, ...utf8(TEXT)]),
    Shift_JIS: shiftJis(TEXT),
  };
  for (const [label, bytes] of Object.entries(files)) {
    assert.deepEqual(await extractFile('架空.txt', bytes), { text: TEXT, notes: [] }, label);
  }
});

test('ESC の無い 7 ビットの文と、4 つの印でない ESC は今どおり読める', async () => {
  for (const s of ['Hello, ABC 123\n$B (B $@ (J\n', 'a\x1b', 'a\x1b$', 'a\x1b(', '\x1b[0mred\x1b[0m']) {
    assert.equal((await extractFile('架空.txt', utf8(s))).text, s, JSON.stringify(s));
  }
});

test('画面: 文の置き換え A の口で、知らせに同じ文と失敗の印が出て、欄の文が変わらない', async () => {
  const html = buildHtml();
  for (const before of ['', '前の文']) {
    const page = runPage(html);
    page.el('mask-input').value = before;
    await give(page, 'mask-file', 'mask-file-status', fileOf('架空.txt', ISO_FILE));
    const status = page.el('mask-file-status');
    assert.equal(status.textContent, '「架空.txt」を読めませんでした: ' + MESSAGE);
    assert.equal(status.getAttribute('data-kind'), 'error');
    assert.equal(page.el('mask-input').value, before);
    assert.ok(!status.textContent.includes('文字を取り出しました'));
    assert.equal(page.el('mask-after').textContent, '', '置き換えの結果を出していない');
  }
});

test('画面: 読めないファイルの後に読めるファイルを渡すと、失敗の印が外れて欄に入る', async () => {
  const page = runPage(buildHtml());
  await give(page, 'mask-file', 'mask-file-status', fileOf('架空.txt', ISO_FILE));
  assert.equal(page.el('mask-file-status').getAttribute('data-kind'), 'error');
  page.el('mask-file-status').textContent = '';
  await give(page, 'mask-file', 'mask-file-status', fileOf('架空2.txt', shiftJis(TEXT)));
  assert.equal(page.el('mask-file-status').getAttribute('data-kind'), null);
  assert.equal(page.el('mask-input').value, TEXT);
});

test('画面: 目次の口で、知らせに同じ文と失敗の印が出て、欄の文が変わらない', async () => {
  const page = runPage(buildHtml());
  await give(page, 'plan-file', 'plan-file-status', fileOf('架空.txt', ISO_FILE));
  const status = page.el('plan-file-status');
  assert.equal(status.textContent, '「架空.txt」を読めませんでした: ' + MESSAGE + BY_HAND);
  assert.equal(status.getAttribute('data-kind'), 'error');
  assert.equal(page.el('plan-input').value, '');
  assert.ok(!status.textContent.includes('の欄に入れました'));
});

test('文書: manual の置き換えの節に 1 行あり、development の残 16 は行が残り、読む道ごとの今の形を書く', () => {
  const manual = fs.readFileSync(new URL('../../docs/manual.md', import.meta.url), 'utf8');
  const start = manual.indexOf('## 文の置き換え(外のサービスに貼る前に)');
  assert.ok(start >= 0);
  const next = manual.indexOf('\n## ', start + 1);
  const section = manual.slice(start, next < 0 ? undefined : next);
  assert.equal(section.split('\n').filter((l) => l.startsWith('- ') && l.includes(MESSAGE)).length, 1);
  const dev = fs.readFileSync(new URL('../../docs/development.md', import.meta.url), 'utf8');
  const row = dev.split('\n').find((l) => l.startsWith('| 残 16 |'));
  assert.ok(row, '残 16 の行がある');
  assert.ok(row.includes('ISO-2022-JP'));
  assert.match(row, /`read_masked`[^|]*断[^|]*画面[^|]*断/);
  assert.ok(row.includes('`src/mask/extract.mjs` の `decodeText`'));
  assert.ok(!row.includes('化けた文のまま返す'), '前の形のままにしない');
});

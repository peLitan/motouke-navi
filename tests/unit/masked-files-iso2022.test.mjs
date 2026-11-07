// F83b2 の単体の試験: read_masked と check_conditions が ISO-2022-JP のファイルを置き換える前に断り、read_masked が空のファイルを断る。書類の文・名前はすべて架空
// ISO-2022-JP は UTF-8 としても Shift_JIS としても読めてしまう(全部が 7bit)ので、断らないと漢字の名前が辞書に当たらない ASCII の符号のまま返る
// Node は ISO-2022-JP に encode できないので、decoder を逆に引いた表でバイト列を作り、同じ文に decode し直せることを確かめてから使う
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { handleMessage } from '../../integration/claude-code/mcp/masked-files.mjs';
import { staleCopies } from '../../scripts/sync-plugin.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const ISO_MESSAGE = 'ISO-2022-JP のファイルは読めません。UTF-8 か Shift_JIS で保存し直してください';
const EMPTY_MESSAGE = 'ファイルが空です';
const ESC = 0x1b;
const COMPANY = '甲山建設株式会社';
const PERSON = '乙川一郎';
const LEDGER = `元請負人: ${COMPANY}\n監理技術者: ${PERSON}\n電話: 03-0000-0000\n`;
const DATA = read('docs/samples/bid-intake/拾った条件.json');
const NOTICE = read('docs/samples/bid-intake/架空公告.md');

const jisTable = () => {
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
};
const TABLE = jisTable();
const jisCode = (text) => Buffer.from([...text].flatMap((ch) => {
  assert.ok(TABLE.has(ch), 'JIS に無い字: ' + ch);
  return TABLE.get(ch);
})).toString('latin1');

// 漢字の並びの前で ESC $ B、終わりで ESC ( B を入れる。enter と leave で古い JIS の印(ESC $ @・ESC ( J)に替えられる
function encodeIso(text, { enter = '$B', leave = '(B' } = {}) {
  const out = [];
  let inKanji = false;
  const mark = (s) => out.push(ESC, ...Buffer.from(s));
  for (const ch of text) {
    const kanji = ch.codePointAt(0) >= 0x80;
    if (kanji !== inKanji) { mark(kanji ? enter : leave); inKanji = kanji; }
    if (kanji) out.push(...Buffer.from(jisCode(ch), 'latin1'));
    else out.push(ch.codePointAt(0));
  }
  if (inKanji) mark(leave);
  return Buffer.from(out);
}

const ISO_FILE = encodeIso(LEDGER);

test('前提: 作ったバイト列は ISO-2022-JP として同じ文に戻り、UTF-8 としても読めてしまう(だから入口で断る)', () => {
  assert.equal(new TextDecoder('iso-2022-jp', { fatal: true }).decode(ISO_FILE), LEDGER);
  assert.equal(new TextDecoder('iso-2022-jp', { fatal: true }).decode(encodeIso(LEDGER, { enter: '$@', leave: '(J' })), LEDGER);
  const asUtf8 = new TextDecoder('utf-8', { fatal: true }).decode(ISO_FILE);
  assert.ok(asUtf8.includes(jisCode(COMPANY)));
  assert.ok(!asUtf8.includes(COMPANY));
});

function work(t) {
  fs.mkdirSync(path.join(ROOT, 'tmp'), { recursive: true });
  const dir = fs.mkdtempSync(path.join(ROOT, 'tmp', 'f83b2-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const put = (dir, rel, bytes) => {
  const p = path.join(dir, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, bytes);
  return rel;
};

const readMaskedCall = (root, rel, handler = handleMessage) => handler({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'read_masked', arguments: { path: rel } } }, { root });
const conditionsCall = (root, files, handler = handleMessage) => handler({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'check_conditions', arguments: { data: DATA, files } } }, { root });
const texts = (res) => res.result.content.map((c) => c.text);

// 断りの形: JSON-RPC の誤りではなく道具の誤りの文1つで、ESC も名前の JIS の符号も入らない
function refused(res, label) {
  assert.equal(res.error, undefined, label);
  assert.equal(res.result.isError, true, label);
  assert.equal(res.result.content.length, 1, label);
  const all = JSON.stringify(res) + texts(res).join('\n');
  assert.ok(!texts(res)[0].includes('\u001b'), label + ': ESC');
  assert.ok(!all.includes('\\u001b'), label + ': ESC の書き換え');
  for (const name of [COMPANY, PERSON]) {
    assert.ok(!all.includes(jisCode(name)), label + ': 名前の JIS の符号');
    assert.ok(!all.includes(name), label + ': 名前');
  }
  return texts(res)[0];
}

test('read_masked: 架空の会社名と人名の入った ISO-2022-JP の .txt を断る', async (t) => {
  const root = work(t);
  assert.equal(refused(await readMaskedCall(root, put(root, 'raw/iso.txt', ISO_FILE)), 'read_masked'), ISO_MESSAGE);
});

test('check_conditions: 同じファイルを断り、どのファイルかを添える。ほかの原文と混ぜても全体を断る', async (t) => {
  const root = work(t);
  const iso = put(root, '公告/iso.txt', ISO_FILE);
  const ok = put(root, '公告/本文.md', NOTICE);
  assert.equal(refused(await conditionsCall(root, [iso]), '1つ'), iso + ': ' + ISO_MESSAGE);
  assert.equal(refused(await conditionsCall(root, [ok, iso]), '混ぜる'), iso + ': ' + ISO_MESSAGE);
});

test('4つの印のどれか1つでも、ファイルのどこにあっても断る(BOM の後ろ・末尾・文字のあとも)', async (t) => {
  const root = work(t);
  const tail = Buffer.from('a'.repeat(500000));
  const cases = {
    'ESC $ B で入る(終わりの印なし)': Buffer.concat([Buffer.from([ESC, 0x24, 0x42]), Buffer.from(jisCode(COMPANY), 'latin1')]),
    'ESC $ @ で入る(古い JIS。終わりの印なし)': Buffer.concat([Buffer.from([ESC, 0x24, 0x40]), Buffer.from(jisCode(PERSON), 'latin1')]),
    'ESC ( J だけ': Buffer.concat([Buffer.from('abc'), Buffer.from([ESC, 0x28, 0x4a]), Buffer.from('def')]),
    'ESC ( B だけ': Buffer.concat([Buffer.from('abc'), Buffer.from([ESC, 0x28, 0x42]), Buffer.from('def')]),
    '古い JIS の組み合わせ': encodeIso(LEDGER, { enter: '$@', leave: '(J' }),
    'UTF-8 の BOM の後ろ': Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), ISO_FILE]),
    '長い文の後ろ': Buffer.concat([tail, ISO_FILE]),
    '末尾ちょうどの印': Buffer.concat([Buffer.from('abc'), Buffer.from([ESC, 0x28, 0x42])]),
    'NUL より先に断る': Buffer.concat([ISO_FILE, Buffer.from([0x00])]),
    '漢字の UTF-8 と混ざる': Buffer.concat([Buffer.from('元請負人: ', 'utf8'), ISO_FILE]),
  };
  let n = 0;
  for (const [label, bytes] of Object.entries(cases)) {
    n += 1;
    const raw = put(root, `raw/c${n}.txt`, bytes);
    const src = put(root, `公告/c${n}.txt`, bytes);
    assert.equal(refused(await readMaskedCall(root, raw), label), ISO_MESSAGE, label);
    assert.equal(refused(await conditionsCall(root, [src]), label), src + ': ' + ISO_MESSAGE, label);
  }
});

test('断りすぎない: 印でない ESC と、ESC の無い $B・(J は今までどおり読む', async (t) => {
  const root = work(t);
  const cases = {
    '色の ESC [': [0x1b, 0x5b, 0x33, 0x31, 0x6d, 0x41, 0x1b, 0x5b, 0x30, 0x6d],
    'ESC だけ': [0x41, 0x1b, 0x42],
    'ESC $ で終わる': [0x41, 0x1b, 0x24],
    'ESC ( で終わる': [0x41, 0x1b, 0x28],
    'ESC と $B の間に改行': [0x1b, 0x0a, 0x24, 0x42],
    'ESC の無い印': [...Buffer.from('$B $@ (J (B')],
  };
  let n = 0;
  for (const [label, bytes] of Object.entries(cases)) {
    n += 1;
    const res = await readMaskedCall(root, put(root, `raw/ok${n}.txt`, Buffer.concat([Buffer.from(bytes), Buffer.from('\n工事名: 架空の工事\n', 'utf8')])));
    assert.equal(res.error, undefined, label);
    assert.equal(res.result.isError, false, label);
    assert.ok(texts(res)[0].includes('工事名'), label);
  }
  const res = await conditionsCall(root, [put(root, '公告/ok.md', Buffer.concat([Buffer.from([0x1b, 0x5b, 0x30, 0x6d, 0x0a]), Buffer.from(NOTICE, 'utf8')]))]);
  assert.equal(res.result.isError, false);
});

test('Shift_JIS は今までどおり読む(0x1B は Shift_JIS の2バイト目に現れない)', async (t) => {
  const root = work(t);
  const res = await readMaskedCall(root, put(root, 'raw/sjis.txt', Buffer.from([0x8d, 0x48, 0x8e, 0x96, 0x0a]))); // 工事 + 改行
  assert.equal(res.result.isError, false);
  assert.ok(texts(res)[0].includes('工事'));
});

test('read_masked: 0バイトと BOM だけと空白だけのファイルは「ファイルが空です」で断る。本文があれば読む', async (t) => {
  const root = work(t);
  const cases = {
    '0バイト': Buffer.alloc(0),
    'BOM だけ': Buffer.from([0xef, 0xbb, 0xbf]),
    '改行と空白だけ': Buffer.from(' \r\n\t\n'),
    '全角の空白だけ': Buffer.from('　\n', 'utf8'),
  };
  let n = 0;
  for (const [label, bytes] of Object.entries(cases)) {
    n += 1;
    assert.equal(refused(await readMaskedCall(root, put(root, `raw/e${n}.txt`, bytes)), label), EMPTY_MESSAGE, label);
  }
  assert.equal((await readMaskedCall(root, put(root, 'raw/one.txt', 'a'))).result.isError, false);
});

test('check_conditions の空の文は変えない', async (t) => {
  const root = work(t);
  const f = put(root, '公告/空.txt', Buffer.alloc(0));
  assert.equal(refused(await conditionsCall(root, [f]), '空'), f + ': 中身がありません。');
});

test('plugin の写しは元と同じで、入れた後の場所でも同じに断る', async (t) => {
  assert.deepEqual(staleCopies(ROOT), []);
  const root = work(t);
  const dir = path.join(root, 'installed');
  fs.cpSync(path.join(ROOT, 'plugin'), dir, { recursive: true });
  const saved = process.env.MASK_TOOL_DIR;
  process.env.MASK_TOOL_DIR = dir;
  let pluginHandle;
  try {
    ({ handleMessage: pluginHandle } = await import(pathToFileURL(path.join(dir, 'mcp', 'masked-files.mjs')).href));
  } finally {
    if (saved === undefined) delete process.env.MASK_TOOL_DIR; else process.env.MASK_TOOL_DIR = saved;
  }
  assert.equal(refused(await readMaskedCall(root, put(root, 'raw/iso.txt', ISO_FILE), pluginHandle), 'plugin read_masked'), ISO_MESSAGE);
  assert.equal(refused(await conditionsCall(root, [put(root, '公告/iso.txt', ISO_FILE)], pluginHandle), 'plugin check_conditions'), '公告/iso.txt: ' + ISO_MESSAGE);
  assert.equal(refused(await readMaskedCall(root, put(root, 'raw/空.txt', Buffer.alloc(0)), pluginHandle), 'plugin 空'), EMPTY_MESSAGE);
});

test('文書: コメントと README・manual が今の動きと合う', () => {
  const src = read('integration/claude-code/mcp/masked-files.mjs');
  assert.ok(!src.includes('どちらでも読めなければ断る(化けた文を Claude に渡さない)'), 'ISO-2022-JP は読めてしまい、化けた文を渡すので、この文のままにしない');
  assert.match(read('README.md'), /`read_masked` は UTF-8[^\n]*ISO-2022-JP[^\n]*断/);
  const manual = read('docs/manual.md');
  assert.match(manual, /ISO-2022-JP のファイルは読めません/);
  assert.match(manual, /ファイルが空です/);
});

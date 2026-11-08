// F63a の単体の試験: read_masked が Shift_JIS のファイルを化けずに読む。書類の文・名前はすべて架空
// Node は Shift_JIS に encode できないので、decoder を逆に引いた表でバイト列を作り、同じ文に decode し直せることを確かめてから使う
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { handleMessage } from '../../integration/claude-code/mcp/masked-files.mjs';
import { staleCopies } from '../../scripts/sync-plugin.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PLUGIN = path.join(ROOT, 'plugin');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const sjisTable = () => {
  const decoder = new TextDecoder('shift_jis', { fatal: true });
  const table = new Map();
  const add = (...bytes) => {
    let ch;
    try { ch = decoder.decode(Uint8Array.from(bytes)); } catch { return; }
    if ([...ch].length === 1 && !table.has(ch)) table.set(ch, bytes);
  };
  for (let b = 0xa1; b <= 0xdf; b += 1) add(b);
  for (let lead = 0x81; lead <= 0xfc; lead += 1) {
    if (lead >= 0xa0 && lead <= 0xdf) continue;
    for (let trail = 0x40; trail <= 0xfc; trail += 1) if (trail !== 0x7f) add(lead, trail);
  }
  return table;
};
const TABLE = sjisTable();

const encodeSjis = (text) => {
  const out = [];
  for (const ch of text) {
    const code = ch.codePointAt(0);
    if (code < 0x80) { out.push(code); continue; }
    const bytes = TABLE.get(ch);
    assert.ok(bytes, 'Shift_JIS に無い字: ' + ch);
    out.push(...bytes);
  }
  const buf = Buffer.from(out);
  assert.equal(new TextDecoder('shift_jis', { fatal: true }).decode(buf), text, '作ったバイト列が同じ文に戻らない');
  assert.throws(() => new TextDecoder('utf-8', { fatal: true }).decode(buf), 'UTF-8 として読めるバイト列では試験にならない');
  return buf;
};

// 表・ソ・能 は2バイト目が 0x5C、㈱ は NEC の拡張の字、～ は 0x81 0x60、ｶﾅ は1バイトの字
const LEDGER = [
  '架空の台帳。甲山建設株式会社、連絡は kono@example.com、電話 03-0000-0000。',
  '工期は令和8年4月1日～令和8年9月30日。',
  '表・ソフト・能力の欄。㈱の字。ｶﾅの行。',
].join('\r\n');
const NAMES = ['甲山建設株式会社', 'kono@example.com', '03-0000-0000'];

const workspace = (t) => {
  fs.mkdirSync(path.join(ROOT, 'tmp'), { recursive: true });
  const root = fs.mkdtempSync(path.join(ROOT, 'tmp', 'f63a-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'raw'));
  return root;
};
const put = (root, name, bytes) => { fs.writeFileSync(path.join(root, 'raw', name), bytes); return 'raw/' + name; };
const readFrom = (handler, root, file) => handler({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'read_masked', arguments: { path: file } } }, { root });
const texts = (res) => res.result.content.map((c) => c.text);

test('Shift_JIS のファイルを化けずに読み、UTF-8 で読んだときと同じ中身を返す。元の語は返らない', async (t) => {
  const root = workspace(t);
  const res = await readFrom(handleMessage, root, put(root, '台帳.csv', encodeSjis(LEDGER)));
  assert.equal(res.result.isError, false);
  const [masked, check] = texts(res);
  assert.ok(!masked.includes('�'), '化けている');
  for (const w of ['架空の台帳', '令和8年4月1日～令和8年9月30日', '表・ソフト・能力の欄', '㈱の字', 'ｶﾅの行']) assert.ok(masked.includes(w), '読めていない: ' + w);
  for (const w of NAMES) assert.ok(!masked.includes(w) && !check.includes(w), '元の語が返った: ' + w);
  const same = await readFrom(handleMessage, root, put(root, 'utf8.csv', Buffer.from(LEDGER, 'utf8')));
  assert.equal(masked, texts(same)[0]);
});

test('UTF-8 は BOM の有無どちらも読み、BOM は中身に出ない', async (t) => {
  const root = workspace(t);
  const plain = await readFrom(handleMessage, root, put(root, 'plain.txt', Buffer.from(LEDGER, 'utf8')));
  const bom = await readFrom(handleMessage, root, put(root, 'bom.txt', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(LEDGER, 'utf8')])));
  assert.equal(plain.result.isError, false);
  assert.equal(bom.result.isError, false);
  assert.equal(texts(bom)[0], texts(plain)[0]);
  assert.ok(!texts(bom)[0].includes('﻿'));
});

test('どちらでもないバイト列は、投げずに読めない旨を返す。中身は返さない', async (t) => {
  const root = workspace(t);
  const cases = {
    'UTF-16 の BOM つき(Excel の Unicode テキスト)': Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('架空の台帳', 'utf16le')]),
    'Shift_JIS に無いバイト': Buffer.from([0x41, 0xfd, 0xfe, 0x42]),
    '2バイトの字の途中で切れた': Buffer.from([0x41, 0x8c]),
  };
  let n = 0;
  for (const [label, bytes] of Object.entries(cases)) {
    n += 1;
    const res = await readFrom(handleMessage, root, put(root, `ng${n}.txt`, bytes));
    assert.equal(res.error, undefined, label);
    assert.equal(res.result.isError, true, label);
    assert.deepEqual(texts(res), ['文字のファイルとして読めません(UTF-8 か Shift_JIS で保存してください)。'], label);
  }
});

test('NUL の入ったファイルは今までどおり断る(UTF-8 でも Shift_JIS でも)', async (t) => {
  const root = workspace(t);
  const utf8 = await readFrom(handleMessage, root, put(root, 'nul1.txt', Buffer.from('abc\u0000def')));
  const sjis = await readFrom(handleMessage, root, put(root, 'nul2.txt', Buffer.concat([encodeSjis('元'), Buffer.from([0x00])])));
  for (const res of [utf8, sjis]) assert.deepEqual(texts(res), ['文のファイルではないようです。']);
});

test('shift_jis の無い Node: UTF-8 は読み、Shift_JIS のファイルは読めない旨を返す', async (t) => {
  const root = workspace(t);
  const sjisFile = put(root, 'sjis.txt', encodeSjis(LEDGER));
  const utf8File = put(root, 'utf8.txt', Buffer.from(LEDGER, 'utf8'));
  const Real = globalThis.TextDecoder;
  globalThis.TextDecoder = class extends Real {
    constructor(label, opts) {
      if (label === 'shift_jis') throw new RangeError('The "shift_jis" encoding is not supported');
      super(label, opts);
    }
  };
  t.after(() => { globalThis.TextDecoder = Real; });
  const ng = await readFrom(handleMessage, root, sjisFile);
  const fine = await readFrom(handleMessage, root, utf8File);
  assert.equal(ng.result.isError, true);
  assert.deepEqual(texts(ng), ['この Node では Shift_JIS を読めません。UTF-8 で保存してください。']);
  assert.equal(fine.result.isError, false);
  assert.ok(texts(fine)[0].includes('架空の台帳'));
});

test('plugin の写しは元と同じで、入れた後の場所でも Shift_JIS を読む', async (t) => {
  assert.deepEqual(staleCopies(ROOT), []);
  const root = workspace(t);
  const dir = path.join(root, 'installed');
  fs.cpSync(PLUGIN, dir, { recursive: true });
  const saved = process.env.MASK_TOOL_DIR;
  process.env.MASK_TOOL_DIR = dir;
  let copy;
  try {
    copy = await import(pathToFileURL(path.join(dir, 'mcp', 'masked-files.mjs')).href);
  } finally {
    if (saved === undefined) delete process.env.MASK_TOOL_DIR; else process.env.MASK_TOOL_DIR = saved;
  }
  const res = await readFrom(copy.handleMessage, root, put(root, '台帳.csv', encodeSjis(LEDGER)));
  assert.equal(res.result.isError, false);
  assert.ok(!texts(res)[0].includes('�'));
  assert.ok(texts(res)[0].includes('架空の台帳'));
});

test('README と manual に読める文字コードを書き、測っていない言い切りを書かない', () => {
  for (const f of ['docs/details.md', 'docs/manual.md']) {
    const body = read(f);
    assert.ok(body.includes('Excel の既定で保存した CSV・TXT は Shift_JIS になることがあります'), f);
    assert.ok(!/Shift_JIS.{0,6}多い/.test(body), f);
  }
});

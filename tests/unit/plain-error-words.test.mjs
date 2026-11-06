// F58b の単体の試験: 読み込みの誤りの文に内部の語(欄の id・キーの名前・作る側の語)を出さない。値はすべて架空
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHtml } from '../../build.mjs';
import { makeXlsx, makeZip, runPage } from '../acceptance/_helpers.mjs';
import { parseIntakeFile } from '../../src/intake-load.mjs';
import { createMasker, parseDictFile, parseMapFile } from '../../src/mask/core.mjs';
import { extractText, openXlsx } from '../../src/mask/extract.mjs';
import { CONFIRM_ROWS } from '../../src/ui/confirm.mjs';

const INTERNAL = ['contract-amount', 'subcontract-total', 'format', 'version', 'entries', 'terms', 'DecompressionStream', 'rows', 'companyFields',
  'formSkipped', 'orderer', 'work-type', 'mask-dict', 'mask-map', 'word', 'kind', 'token', 'original'];
// 文に残してよい英字の語。ほかの英字の語が出たら、内部の語か実装の例外の文(TypeError など)が漏れている
const ALLOWED_ASCII = new Set(['JSON', 'AI', 'xlsx', 'docx']);

const NOT_MAP = 'このツールで書き出した対応表ではないか、版が違います。書き出した対応表のファイルを選んでください。';
const NOT_DICT = 'このツールで書き出した辞書ではないか、版が違います。書き出した辞書のファイルを選んでください。';
const WRONG_SHAPE = 'このファイルの中身の形が違います(公告を読んだ AI がまとめた条件のファイルを選んでください)';
const NOT_INTAKE = '公告を読んだ AI がまとめた条件のファイルではないようです(画面に無い欄があります)';
const NO_INFLATE = 'このブラウザでは .xlsx/.docx を開けません。文字をコピーして貼り付けてください';
const labelOf = (id) => CONFIRM_ROWS.find((r) => r.key === id).label;
const badValue = (id) => '『' + labelOf(id) + '』の値が読めません(欄に手で入れてください)';
const notPicked = (id) => '『' + labelOf(id) + '』は公告から拾えていないので入れません(公告の原文で確かめて、欄に手で入れてください)';

const INTAKE = {
  kind: 'bid-intake',
  source: { title: '架空の公告' },
  rows: [{ key: 'budget', status: '拾えた', quote: '架空の抜き書き' }, { key: 'orderer-name', status: '拾えた' }, { key: 'work-class', status: '拾えた' }],
  form: { 'contract-amount': '100', orderer: 'public', 'work-type': 'other' },
  formSkipped: [],
  companyFields: [],
};
const DICT = { format: 'mask-dict', version: 1, terms: [{ word: '架空一郎', kind: 'person' }, { word: '架空二郎', kind: 'person' }] };
const MAP = {
  format: 'mask-map',
  version: 1,
  entries: [{ token: '〔人名1〕', original: '架空一郎', kind: 'person', variants: ['架空一郎'] }],
  terms: [{ word: '架空一郎', kind: 'person' }],
};
const PICKS = [undefined, null, 1, true, 'x', '', [], {}, ['x'], [null], [{}], [[]], { x: 1 }];

// 元の文書の値を1か所ずつ替えた文書を全部作る(手で選んだ例だけだと、通らない throw が残るため)
function mutated(doc) {
  const paths = [];
  const walk = (v, at) => {
    paths.push(at);
    if (v && typeof v === 'object') for (const k of Object.keys(v)) walk(v[k], [...at, k]);
  };
  walk(doc, []);
  const out = [];
  for (const at of paths) {
    for (const pick of PICKS) {
      if (!at.length) { if (pick !== undefined) out.push(JSON.stringify(pick)); continue; }
      const copy = structuredClone(doc);
      let v = copy;
      for (const k of at.slice(0, -1)) v = v[k];
      if (pick === undefined) delete v[at.at(-1)]; else v[at.at(-1)] = pick;
      out.push(JSON.stringify(copy));
    }
  }
  return out;
}

// 文書を読ませて、投げられた Error の文を集める
function thrown(parse, texts) {
  const out = new Set();
  for (const text of texts) {
    try {
      parse(text);
    } catch (e) {
      assert.equal(e.constructor, Error, '実装の例外が漏れた: ' + e.message + ' / ' + text.slice(0, 80));
      out.add(e.message);
    }
  }
  return out;
}

function assertPlain(messages) {
  for (const m of messages) {
    for (const w of INTERNAL) assert.ok(!m.includes(w), w + ' が文に出ている: ' + m);
    for (const [w] of m.matchAll(/[A-Za-z][A-Za-z_-]+/g)) assert.ok(ALLOWED_ASCII.has(w), w + ' が文に出ている: ' + m);
  }
}

const parseDict = (text) => parseDictFile(text, ['person', 'company']);

const intakeTexts = () => [
  ...mutated(INTAKE),
  '{',
  // 画面に無い欄と、画面の欄の読めない値・拾えていない値
  ...['subcontract-total', 'license', 'constructor', 'toString'].map((id) => JSON.stringify({ ...INTAKE, form: { [id]: '100' } })),
  ...['contract-amount', 'orderer', 'work-type'].flatMap((id) => [
    JSON.stringify({ ...INTAKE, form: { [id]: '読めない値' } }),
    JSON.stringify({ ...INTAKE, form: { [id]: id === 'contract-amount' ? '100' : id === 'orderer' ? 'public' : 'other' }, rows: [] }),
  ]),
];
const dictTexts = () => [
  ...mutated(DICT),
  '{壊れ',
  JSON.stringify({ ...DICT, terms: [] }),
  JSON.stringify({ ...DICT, terms: Array.from({ length: 5001 }, (_, i) => ({ word: '語' + i, kind: 'person' })) }),
  JSON.stringify({ ...DICT, terms: [{ word: 'あ'.repeat(201), kind: 'person' }] }),
  JSON.stringify({ ...DICT, terms: [{ word: '架空\n一郎', kind: 'person' }] }),
  JSON.stringify({ ...DICT, terms: [{ word: '架空一郎', kind: 'person' }, { word: '架空一郎', kind: 'company' }] }),
  JSON.stringify(MAP),
];
const mapTexts = () => [
  ...mutated(MAP),
  '{壊れ',
  JSON.stringify({ ...MAP, entries: [MAP.entries[0], MAP.entries[0]] }),
  JSON.stringify({ ...MAP, entries: [MAP.entries[0], { ...MAP.entries[0], token: '〔人名2〕' }] }),
];

test('公告の条件のファイル: 投げる文に内部の語が無く、全部の文が集まっている', () => {
  const messages = thrown(parseIntakeFile, intakeTexts());
  assertPlain(messages);
  for (const m of [WRONG_SHAPE, NOT_INTAKE, ...['contract-amount', 'orderer', 'work-type'].flatMap((id) => [badValue(id), notPicked(id)])]) {
    assert.ok(messages.has(m), '集まっていない: ' + m + '\n' + [...messages].join('\n'));
  }
});

test('公告の条件のファイル: 欄の名前は確かめの画面の行の名前で出す', () => {
  assert.throws(() => parseIntakeFile(JSON.stringify({ ...INTAKE, form: { 'contract-amount': '1万円' } })), { message: '『請負代金の見込み』の値が読めません(欄に手で入れてください)' });
  assert.throws(() => parseIntakeFile(JSON.stringify({ ...INTAKE, form: { orderer: '国' } })), { message: '『発注者』の値が読めません(欄に手で入れてください)' });
  assert.throws(() => parseIntakeFile(JSON.stringify({ ...INTAKE, form: { 'work-type': 'other' }, rows: [{ key: 'work-class', status: '確かめが要る' }] })), { message: '『工事の種類』は公告から拾えていないので入れません(公告の原文で確かめて、欄に手で入れてください)' });
});

test('公告の条件のファイル: 3つの並びのどれが壊れていても同じ文', () => {
  for (const key of ['rows', 'formSkipped', 'companyFields']) {
    assert.throws(() => parseIntakeFile(JSON.stringify({ ...INTAKE, [key]: '並びでない' })), { message: WRONG_SHAPE }, key);
  }
});

test('辞書のファイル: 投げる文に内部の語が無い。作りと版は同じ文にまとめ、何番目の語かは残す', () => {
  const messages = thrown(parseDict, dictTexts());
  assertPlain(messages);
  assert.ok(messages.has(NOT_DICT));
  for (const at of [1, 2]) assert.ok(messages.has('辞書の ' + at + ' 番目の語が読めません。' + NOT_DICT), [...messages].join('\n'));
  assert.ok(messages.size >= 8, [...messages].join('\n'));
  for (const v of [{ ...DICT, format: 'other' }, { ...DICT, version: 2 }, { format: DICT.format, version: 1 }, []]) {
    assert.throws(() => parseDict(JSON.stringify(v)), { message: NOT_DICT }, JSON.stringify(v));
  }
});

test('辞書のファイル: 対応表を選んだときの案内は残る', () => {
  const m = createMasker();
  m.addTerm('架空一郎', 'person');
  m.mask('架空一郎');
  assert.throws(() => parseDict(m.exportMap()), { message: 'これは対応表のファイルです。対応表は「対応表を読み込む」で読み込んでください。' });
});

test('対応表のファイル: 投げる文に内部の語が無い。作りと版は同じ文にまとめる', () => {
  const messages = thrown(parseMapFile, mapTexts());
  assertPlain(messages);
  assert.ok(messages.has(NOT_MAP));
  assert.ok(messages.has('対応表の 1 行目に記号・元の語・種類のどれかがありません。'), [...messages].join('\n'));
  assert.ok(messages.size >= 5, [...messages].join('\n'));
  for (const v of [{ ...MAP, format: 'other' }, { ...MAP, version: 2 }, { format: MAP.format, version: 1 }, { ...MAP, terms: 'x' }, []]) {
    assert.throws(() => parseMapFile(JSON.stringify(v)), { message: NOT_MAP }, JSON.stringify(v));
  }
});

test('解凍の部品が無いブラウザ: .docx も .xlsx も同じ文で止まり、部品の名前を出さない', async () => {
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'DecompressionStream');
  delete globalThis.DecompressionStream;
  try {
    const docx = makeZip([{ name: 'word/document.xml', data: '<w:t>架空</w:t>' }]);
    await assert.rejects(() => extractText('架空.docx', docx), { message: NO_INFLATE });
    await assert.rejects(() => extractText('架空.xlsx', makeXlsx([['架空']])), { message: NO_INFLATE });
    await assert.rejects(() => openXlsx(new Uint8Array(makeXlsx([['架空']]))), { message: NO_INFLATE });
  } finally {
    Object.defineProperty(globalThis, 'DecompressionStream', saved);
  }
  assertPlain([NO_INFLATE]);
});

test('解凍の部品が無いときの案内: 勧める形が2つの口の両方で使える(.csv は置き換えの口で断られるので勧めない)', async () => {
  assert.ok(!NO_INFLATE.includes('.csv'));
  await assert.rejects(() => extractText('架空.csv', new TextEncoder().encode('架空')), /対応していない形式です/);
  const html = buildHtml();
  for (const id of ['mask-input', 'ledger-input']) assert.match(html, new RegExp('<textarea id="' + id + '"'));
});

// 組み立てた画面の実物。この作り物の画面には解凍の部品が無いので、.docx・.xlsx は NO_INFLATE の道を通る
const text = (name, body) => ({ name, size: body.length, text: async () => body });
const bytesFile = (name, bytes) => ({ name, size: bytes.length, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });
async function readIn(page, id, file) {
  page.el(id).files = [file];
  await page.set(id, '');
}

test('組み立てた画面: 知らせの文の全体が読め、句点が重ならず、失敗の印が付く', async () => {
  const html = buildHtml();
  const cases = [
    ['intake-load', 'intake-status', text('架空.json', JSON.stringify({ ...INTAKE, form: { 'contract-amount': '1万円' } })), '読み込めませんでした: 『請負代金の見込み』の値が読めません(欄に手で入れてください)。入力欄はそのままです。'],
    ['intake-load', 'intake-status', text('架空.json', JSON.stringify({ ...INTAKE, form: { 'subcontract-total': '100' } })), '読み込めませんでした: ' + NOT_INTAKE + '。入力欄はそのままです。'],
    ['intake-load', 'intake-status', text('架空.json', JSON.stringify({ ...INTAKE, companyFields: 'x' })), '読み込めませんでした: ' + WRONG_SHAPE + '。入力欄はそのままです。'],
    ['dict-import', 'dict-file-status', text('架空.json', JSON.stringify({ ...DICT, version: 2 })), '読み込めませんでした: ' + NOT_DICT + ' 今の辞書はそのままです。'],
    ['map-import', 'map-status', text('架空.json', JSON.stringify({ ...MAP, format: 'other' })), '読み込めませんでした: ' + NOT_MAP + ' 今の対応表はそのままです。'],
    ['mask-file', 'mask-file-status', bytesFile('架空.docx', makeZip([{ name: 'word/document.xml', data: '<w:t>架空</w:t>' }])), '「架空.docx」を読めませんでした: ' + NO_INFLATE],
  ];
  for (const [port, status, file, want] of cases) {
    const page = runPage(html);
    await readIn(page, port, file);
    assert.equal(page.el(status).textContent, want);
    assert.equal(page.el(status).getAttribute('data-kind'), 'error', status);
    assert.ok(!want.includes('。。'));
  }
  // 台帳の口は読めなかった文を ledger-xlsx.mjs の文で包むので、部分で見る
  const page = runPage(html);
  await readIn(page, 'ledger-file', bytesFile('架空の台帳.xlsx', makeXlsx([['施工体制台帳']])));
  const ledger = page.el('ledger-file-status').textContent;
  assert.ok(ledger.includes(NO_INFLATE), ledger);
  assert.ok(!ledger.includes('DecompressionStream'), ledger);
  assert.equal(page.el('ledger-file-status').getAttribute('data-kind'), 'error');
});

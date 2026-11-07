// 段3 の台帳の口に壊れた .xlsx を入れたときの文(F84c、src/ledger-xlsx.mjs)の試験。ファイルの名前と中身はすべて架空
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeXlsx, makeZip, runPage } from '../acceptance/_helpers.mjs';
import { readLedgerXlsx } from '../../src/ledger-xlsx.mjs';
import { extractText } from '../../src/mask/extract.mjs';

const HTML = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'index.html'), 'utf8');
const NEXT_XLS = '.xls(古い形式)は Excel で .xlsx に保存し直してください。';
const BROKEN = 'Excel(.xlsx)として読めません(壊れているか、別の形のファイルです)。保存し直すか、元のファイルをもらってください。' + NEXT_XLS;
const NO_INFLATE = 'このブラウザでは .xlsx/.docx を開けません。文字をコピーして貼り付けてください';

function assertTidy(line) {
  assert.ok(!line.includes('。。'), '句点が重なる: ' + line);
  assert.ok(line.endsWith('。'), '文末に句点が無い: ' + line);
  assert.equal(line.split('として読めません').length - 1, 1, '言い回しが重なる: ' + line);
}
async function messageOf(bytes) {
  const err = await readLedgerXlsx(bytes).then(() => null, (e) => e);
  assert.ok(err, '読めないはずのファイルが読めた');
  return err.message;
}
const notZip = () => new TextEncoder().encode('ただの文');
const brokenDirectory = () => {
  const tail = new Uint8Array(22);
  new DataView(tail.buffer).setUint32(0, 0x06054b50, true);
  new DataView(tail.buffer).setUint16(10, 1, true);
  return tail;
};
// zip の印(4バイト)のある所ごとに書き換える。読み取りは一部の項目しか読まないので、全部の項目を同じに壊す
function eachMark(zip, mark, fn) {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  let count = 0;
  for (let i = 0; i + 4 <= zip.length; i++) {
    if (view.getUint32(i, true) === mark) { fn(view, i); count++; }
  }
  assert.ok(count > 0, '印が見つからない');
  return zip;
}
const LOCAL = 0x04034b50;
const DIRECTORY = 0x02014b50;
const brokenLocalHeader = () => eachMark(makeXlsx([['施工体制台帳']]), LOCAL, (view, i) => view.setUint32(i, 0, true));
const cutHalf = () => {
  const zip = makeXlsx([['施工体制台帳']]);
  return zip.slice(0, Math.floor(zip.length / 2));
};
// 暗号の印(フラグの1ビット目)を立てる
const withPassword = (zip) => eachMark(zip, DIRECTORY, (view, i) => view.setUint16(i + 8, view.getUint16(i + 8, true) | 1, true));
// 圧縮の方法を、読めない番号にする
const withUnknownMethod = (zip) => eachMark(zip, DIRECTORY, (view, i) => view.setUint16(i + 10, 99, true));
// deflate の印を立てる。展開の部品を呼ぶ所まで進む
const withDeflate = (zip) => eachMark(zip, DIRECTORY, (view, i) => view.setUint16(i + 10, 8, true));
async function withInflateError(message, fn) {
  const had = globalThis.DecompressionStream;
  globalThis.DecompressionStream = class { constructor() { throw new Error(message); } };
  try { return await fn(); } finally { globalThis.DecompressionStream = had; }
}

test('壊れた .xlsx: 文が1つにまとまり、句点が重ならず、句点で終わる', async () => {
  for (const [label, bytes] of [['ただの文', notZip()], ['目次が壊れた物', brokenDirectory()], ['中身の印が壊れた物', brokenLocalHeader()], ['途中で切れた物', cutHalf()]]) {
    const line = await messageOf(bytes);
    assert.equal(line, BROKEN, label);
    assertTidy(line);
  }
});

test('壊れた .xlsx: 理由と次の手は変えない', async () => {
  const line = await messageOf(notZip());
  assert.ok(line.includes('(壊れているか、別の形のファイルです)'), line);
  assert.ok(line.includes('保存し直すか、元のファイルをもらってください。'), line);
  assert.ok(line.endsWith(NEXT_XLS), line);
  // 台帳の口で読むのは .xlsx だけなので、.docx の話を出さない
  assert.ok(!line.includes('.docx'), line);
});

test('ほかの理由: 理由をそのまま残し、前の一言と次の手で包み、句点で終わる', async () => {
  const wrap = (reason) => 'Excel(.xlsx)として読めません: ' + reason + '。' + NEXT_XLS;
  assert.equal(await messageOf(makeZip([{ name: 'a.txt', data: '架空' }])), wrap('.xlsx の中にシートが見つかりません'));
  const password = await messageOf(withPassword(makeXlsx([['施工体制台帳']])));
  assert.match(password, /^Excel\(\.xlsx\)として読めません: パスワードのかかったファイルは開けません\(.+\)。\.xls\(古い形式\)/);
  assertTidy(password);
  const method = await messageOf(withUnknownMethod(makeXlsx([['施工体制台帳']])));
  assert.match(method, /^Excel\(\.xlsx\)として読めません: この圧縮の形式には対応していません\(.+\)。\.xls\(古い形式\)/);
  assertTidy(method);
});

test('理由の文が句点で終わっていても重ならない', async () => {
  const line = await withInflateError('架空の理由です。', () => messageOf(withDeflate(makeXlsx([['施工体制台帳']]))));
  assert.equal(line, 'Excel(.xlsx)として読めません: 架空の理由です。' + NEXT_XLS);
  assertTidy(line);
});

test('文の置き換えの口の文は変えない(.docx も読む口なので、もとの文のまま)', async () => {
  await assert.rejects(() => extractText('架空.xlsx', notZip()), { message: '.docx・.xlsx として読めません(壊れているか、別の形のファイルです)。保存し直すか、元のファイルをもらってください。' });
});

const bytesFile = (name, bytes) => ({ name, size: bytes.length, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });
async function readIn(page, file) {
  page.el('ledger-file').files = [file];
  await page.set('ledger-file', '');
}

test('組み立てた画面: 段3 の知らせの文の全体', async () => {
  const page = runPage(HTML);
  await readIn(page, bytesFile('壊れた台帳.xlsx', notZip()));
  const status = page.el('ledger-file-status');
  assert.equal(status.textContent, '「壊れた台帳.xlsx」を読めませんでした: ' + BROKEN);
  assertTidy(status.textContent);
  assert.equal(status.getAttribute('data-kind'), 'error');
});

test('組み立てた画面: ブラウザが開けないときの文も句点で終わる', async () => {
  // 作り物の画面には DecompressionStream が無く、圧縮の印のある物は開けない
  const page = runPage(HTML);
  await readIn(page, bytesFile('架空の台帳.xlsx', withDeflate(makeXlsx([['施工体制台帳']]))));
  const line = page.el('ledger-file-status').textContent;
  assert.equal(line, '「架空の台帳.xlsx」を読めませんでした: Excel(.xlsx)として読めません: ' + NO_INFLATE + '。' + NEXT_XLS);
  assertTidy(line);
});

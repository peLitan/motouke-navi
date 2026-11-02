// F04c: 台帳の Excel の読み込みの単体テスト(値はすべて架空)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { readLedgerXlsx, ledgerToText, NO_AMOUNT_IN_SAKUSEIREI } from '../../src/ledger-xlsx.mjs';
import { parseLedgerText } from '../../src/ledger-text.mjs';
import { loadLedgerFile } from '../../src/ui/app.mjs';
import { makeXlsx, p } from '../acceptance/_helpers.mjs';

const ROWS = [
  ['施工体制台帳'],
  ['商号', '架空一建設株式会社'],
  ['工事名称', '架空川 護岸改修工事'],
  ['発注者名', '架空県'],
  ['工期', '自 2026年10月1日 至 2027年3月15日'],
  ['請負代金額', '金 250,000,000円'],
  ['監理技術者名', '架空 太郎 専任'],
];

test('読んだ台帳を台帳の文にすると、台帳の文の読み込みで同じ値に戻る', async () => {
  const { ledger, unreadable } = await readLedgerXlsx(makeXlsx(ROWS));
  assert.deepEqual(unreadable, []);
  assert.equal(ledger.prime.engineer.name, '架空 太郎'); // 「専任」の語は名前に入れない
  assert.equal(ledger.prime.engineer.role, 'kanri');
  const back = parseLedgerText(ledgerToText(ledger));
  assert.equal(back.project.name, '架空川 護岸改修工事');
  assert.equal(back.project.orderer, '架空県');
  assert.equal(back.project.periodFrom, '2026-10-01');
  assert.equal(back.project.periodTo, '2027-03-15');
  assert.equal(back.project.contractAmount, 250000000);
  assert.equal(back.prime.name, '架空一建設株式会社');
  assert.equal(back.prime.engineer.name, '架空 太郎');
  assert.equal(back.prime.engineer.role, 'kanri');
});

test('作成例の様式では、右の《下請負人に関する事項》の欄を元請けの欄として拾わない', async () => {
  const bytes = new Uint8Array(fs.readFileSync(p('data/sources', 'mlit-taicho-sakuseirei.xlsx')));
  const { found, unreadable, form } = await readLedgerXlsx(bytes);
  assert.equal(form, 'mlit-sakuseirei');
  for (const f of Object.values(found)) assert.match(f.label, /^[A-F]\d+$/, '左の元請けの区画の外の欄名を拾った: ' + f.label);
  const ca = unreadable.find((u) => u.key === 'project.contractAmount');
  assert.equal(ca.reason, NO_AMOUNT_IN_SAKUSEIREI);
  // 雛形の文字(工期の「自 年 月 日」、「専任・非専任」)は値として読まず、空として挙げる
  assert.equal(unreadable.find((u) => u.key === 'project.periodFrom').cause, 'empty');
  assert.equal(unreadable.find((u) => u.key === 'prime.engineer.name').cause, 'empty');
});

test('様式に請負代金額の欄が無い(作成例でない)ときは、欄が見つからないと言う', async () => {
  const { unreadable } = await readLedgerXlsx(makeXlsx(ROWS.filter((r) => r[0] !== '請負代金額')));
  const ca = unreadable.find((u) => u.key === 'project.contractAmount');
  assert.equal(ca.cause, 'not_found');
  assert.match(ca.reason, /欄が見つかりません/);
});

test('工期の片方だけ読めないときは、その側だけを挙げる', async () => {
  const rows = ROWS.map((r) => (r[0] === '工期' ? ['工期', '自 2026年10月1日 至 来年の春'] : r));
  const { ledger, unreadable } = await readLedgerXlsx(makeXlsx(rows));
  assert.equal(ledger.project.periodFrom, '2026-10-01');
  assert.ok(!unreadable.some((u) => u.key === 'project.periodFrom'));
  const to = unreadable.find((u) => u.key === 'project.periodTo');
  assert.equal(to.cause, 'invalid');
  assert.equal(to.raw, '来年の春');
});

test('画面: Excel を読むと台帳の文の欄に入り、読めない欄を出す。読めないファイルは理由を出す', async () => {
  const els = { 'ledger-input': { value: '' }, 'ledger-unreadable': { innerHTML: '' }, 'ledger-file-status': { textContent: '' } };
  const doc = { getElementById: (id) => els[id] || null };
  const file = (name, bytes) => ({ name, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });
  const rows = ROWS.filter((r) => r[0] !== '請負代金額');
  assert.equal(await loadLedgerFile(doc, file('台帳.xlsx', makeXlsx(rows))), true);
  assert.match(els['ledger-input'].value, /\| 商号 \| 架空一建設株式会社 \|/);
  assert.match(els['ledger-unreadable'].innerHTML, /請負代金額/);
  assert.match(els['ledger-unreadable'].innerHTML, /欄が無い/);
  assert.match(els['ledger-file-status'].textContent, /読めない欄 1 件/);
  assert.equal(await loadLedgerFile(doc, file('壊れ.xlsx', new Uint8Array(Buffer.from('not a zip')))), false);
  assert.match(els['ledger-file-status'].textContent, /読めませんでした/);
  assert.equal(els['ledger-unreadable'].innerHTML, '');
});

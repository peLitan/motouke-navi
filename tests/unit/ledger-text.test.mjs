// src/ledger-text.mjs の単体テスト(値はすべて架空)
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLedgerText, parseAmount, parsePeriod, licenseTypeOf } from '../../src/ledger-text.mjs';
import { checkTaicho } from '../../src/check-taicho.mjs';
import { SAMPLE } from '../../src/sample.mjs';

test('金額: 桁区切り・全角・(税込)を読む。「万」は読まずに注意を出す', () => {
  assert.equal(parseAmount('金 ３５,０００,０００円(税込)').value, 35000000);
  assert.equal(parseAmount('').value, null);
  const r = parseAmount('3500万円');
  assert.equal(r.value, null);
  assert.ok(r.error);
});

test('工期: 読めない日付は書いてあるまま残し(空の候補にしない)、注意を出す', () => {
  assert.deepEqual(parsePeriod('2026/4/1 〜 2026-09-30'), { from: '2026-04-01', to: '2026-09-30', error: null });
  const r = parsePeriod('令和8年4月1日 から 2026年2月30日 まで');
  assert.equal(r.from, '令和8年4月1日');
  assert.equal(r.to, '2026年2月30日');
  assert.ok(r.error);
});

test('許可の種類は許可番号の(特-)(般-)からだけ読む', () => {
  assert.equal(licenseTypeOf('架空県知事 許可(特-06)第1号'), 'tokutei');
  assert.equal(licenseTypeOf('架空県知事 許可(般-06)第1号'), 'ippan');
  assert.equal(licenseTypeOf('架空県知事 第1号'), null);
});

test('見本の台帳: 主任技術者の空いた下請けが候補に出る。点検に使わない欄は注意に出す', () => {
  const l = parseLedgerText(SAMPLE.documents.ledger);
  assert.equal(l.subcontractors.length, 2);
  assert.equal(l.subcontractors[0].amount, 44000000);
  assert.ok(l.warnings.some((w) => w.includes('連絡先')));
  l.project.workType = 'other';
  const out = checkTaicho(l);
  assert.ok(out.candidates.some((c) => c.target.includes('みほんブロック工業')));
  assert.ok(!out.candidates.some((c) => c.target.includes('ためし土工')));
});

test('節の分からない表の行・下請けの見出しの前の行は読まずに注意を出す', () => {
  const l = parseLedgerText('| 商号 | 架空株式会社 |\n## 4. 下請負人\n| 工事内容 | 掘削 |\n');
  assert.equal(l.prime.name, '');
  assert.equal(l.subcontractors.length, 0);
  assert.equal(l.warnings.filter((w) => /行目/.test(w)).length, 2);
});

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

// 架空の台帳(会社名はすべて仮のもの)
const TIER_LEDGER = (sub2Heading) => `# 施工体制台帳
## 1. 作成建設業者(元請)
| 項目 | 内容 |
|---|---|
| 商号 | 架空元請株式会社 |
| 許可番号 | 架空県知事 許可(般-06)第00001号 |
## 3. 元請の技術者等
| 項目 | 内容 |
|---|---|
| 主任技術者 氏名 | 架空 一郎 |
| 資格 | 1級土木施工管理技士 |
## 4. 下請負人(一次)
### 4-1. 架空一次工業株式会社
| 項目 | 内容 |
|---|---|
| 工事の内容 | 土工 |
| 工期 | 2026年4月1日 から 2026年9月30日 まで |
| 請負代金額 | 45,000,000円 |
| 主任技術者 氏名 | 架空 二郎 |
| 資格 | 2級土木施工管理技士 |
${sub2Heading}
| 項目 | 内容 |
|---|---|
| 工事の内容 | 型枠 |
| 工期 | 2026年5月1日 から 2026年8月31日 まで |
| 請負代金額 | 10,000,000円 |
| 主任技術者 氏名 | 架空 三郎 |
| 資格 | 2級土木施工管理技士 |
`;

test('二次の下請け(見出しの「二次」か「(一次: 会社名)」)は、元請けの下請総額に数えない(第26条第2項)', () => {
  for (const heading of ['## 5. 下請負人(二次)\n### 5-1. 架空二次工業有限会社', '### 4-2. 架空二次工業有限会社(一次: 架空一次工業株式会社)']) {
    const l = parseLedgerText(TIER_LEDGER(heading));
    l.project.workType = 'other';
    const s2 = l.subcontractors[1];
    assert.equal(s2.name, '架空二次工業有限会社');
    assert.equal(s2.tier, 2);
    assert.equal(l.subcontractors[0].tier, 1);
    const out = checkTaicho(l);
    // 一次だけなら 4,500万円 < 5,000万円。二次を足すと 5,500万円になるが、候補にしない
    assert.equal(out.candidates.filter((c) => /総額/.test(c.message)).length, 0, heading);
  }
});

test('次数を書いていない下請けは、元請けが直接結んだ契約として総額に数える', () => {
  const l = parseLedgerText(TIER_LEDGER('### 4-2. 架空二次工業有限会社').replace('## 4. 下請負人(一次)', '## 4. 下請負人'));
  l.project.workType = 'other';
  assert.equal(l.subcontractors[1].tier, null);
  const out = checkTaicho(l);
  assert.ok(out.candidates.some((c) => c.field === 'prime.engineer.role' && /55,000,000円/.test(c.message)));
});

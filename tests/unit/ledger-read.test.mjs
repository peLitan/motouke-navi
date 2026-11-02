// F15c: 台帳の読み取りの直し(反証の指摘3・5と、次数の見出し)の単体テスト。値・会社名・人名はすべて架空
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLedgerText, parseAmount } from '../../src/ledger-text.mjs';
import { checkTaicho } from '../../src/check-taicho.mjs';

test('反証役の再現: 4,100万円(税抜)は税込みとして読まず、注意を出す', () => {
  const r = parseAmount('41,000,000円(税抜)');
  assert.equal(r.value, null);
  assert.match(r.error, /税込みの額で書いてください/);
  for (const raw of ['金 41,000,000円(税別)', '41,000,000円（消費税別）', '41,000,000円(本体価格)', '41,000,000円(税抜き)', '41,000,000円(外税)']) {
    const x = parseAmount(raw);
    assert.equal(x.value, null, raw);
    assert.match(x.error, /税込み/, raw);
  }
  // 税込み・括弧なしは従来どおり読む
  assert.equal(parseAmount('金 41,000,000円(税込)').value, 41000000);
  assert.equal(parseAmount('41,000,000円').value, 41000000);
});

const BASE = `# 施工体制台帳
## 1. 作成建設業者(元請)
| 項目 | 内容 |
|---|---|
| 商号 | 架空元請株式会社 |
| 許可番号 | 架空県知事 許可(般-06)第00001号 |
## 2. 発注者との契約
| 項目 | 内容 |
|---|---|
| 請負代金額 | 金 100,000,000円(税込) |
`;

test('台帳の下請けの額が税抜きなら、額を読まずに注意を出し、額の分からない下請けとして扱う', () => {
  const l = parseLedgerText(BASE + `## 3. 元請の技術者等
| 項目 | 内容 |
|---|---|
| 主任技術者 氏名 | 架空 一郎 |
| 資格 | 1級土木施工管理技士 |
## 4. 下請負人(一次)
### 4-1. 架空一次工業株式会社
| 項目 | 内容 |
|---|---|
| 請負代金額 | 41,000,000円(税抜) |
| 主任技術者 氏名 | 架空 二郎 |
| 資格 | 2級土木施工管理技士 |
`);
  const s = l.subcontractors[0];
  assert.equal(s.amount, null);
  assert.ok(l.warnings.some((w) => /請負代金額/.test(w) && /税込みの額で書いてください/.test(w)));
  l.project.workType = 'other';
  const out = checkTaicho(l);
  // 4,100万円(税抜)は税込みなら 4,500万円以上になりうる。言い切らずに「判断できない」へ
  assert.ok(out.undecidable.some((u) => u.field === 'subcontractors.amount'));
  assert.ok(!out.candidates.some((c) => c.field === 'prime.engineer.role'));
});

test('反証役の再現: 「監理技術者補佐」の行は、監理技術者の氏名・資格・専任を上書きしない', () => {
  const l = parseLedgerText(BASE + `## 3. 元請の技術者等
| 項目 | 内容 |
|---|---|
| 監理技術者 氏名 | 架空 一郎 |
| 資格 | 1級建築施工管理技士 |
| 専任・非専任 | 非専任 |
| 監理技術者補佐 氏名 | 架空 次郎 |
| 監理技術者補佐 資格 | 1級建築施工管理技士補 |
| 監理技術者補佐 専任・非専任 | 専任 |
`);
  const e = l.prime.engineer;
  assert.equal(e.role, 'kanri');
  assert.equal(e.name, '架空 一郎');
  assert.equal(e.qualification, '1級建築施工管理技士');
  assert.equal(e.dedicated, false);
  assert.deepEqual(e.assistant, { name: '架空 次郎', qualification: '1級建築施工管理技士補', dedicated: true });
  assert.equal(l.warnings.filter((w) => /監理技術者補佐の行として読みました/.test(w)).length, 1);
});

test('「### 監理技術者補佐」の小見出しの中の「氏名」「資格」「専任」も、監理技術者の欄に入れない', () => {
  const l = parseLedgerText(BASE + `## 3. 元請の技術者等
| 項目 | 内容 |
|---|---|
| 監理技術者 氏名 | 架空 一郎 |
| 資格 | 1級建築施工管理技士 |
| 専任・非専任 | 専任 |
### 監理技術者補佐
| 項目 | 内容 |
|---|---|
| 氏名 | 架空 次郎 |
| 資格 | 1級建築施工管理技士補 |
| 専任・非専任 | 非専任 |
`);
  const e = l.prime.engineer;
  assert.equal(e.name, '架空 一郎');
  assert.equal(e.qualification, '1級建築施工管理技士');
  assert.equal(e.dedicated, true);
  assert.deepEqual(e.assistant, { name: '架空 次郎', qualification: '1級建築施工管理技士補', dedicated: false });
});

const MIXED = (h1, h2) => BASE + `## 3. 元請の技術者等
| 項目 | 内容 |
|---|---|
| 主任技術者 氏名 | 架空 一郎 |
| 資格 | 1級土木施工管理技士 |
## 4. 下請負人(一次・二次)
${h1}
| 項目 | 内容 |
|---|---|
| 請負代金額 | 30,000,000円 |
| 主任技術者 氏名 | 架空 二郎 |
| 資格 | 2級土木施工管理技士 |
${h2}
| 項目 | 内容 |
|---|---|
| 請負代金額 | 25,000,000円 |
| 主任技術者 氏名 | 架空 三郎 |
| 資格 | 2級土木施工管理技士 |
`;

test('「下請負人(一次・二次)」の見出しで、節の全員を一次に数えない(総額は「判断できない」)', () => {
  const l = parseLedgerText(MIXED('### 4-1. 架空甲工業株式会社', '### 4-2. 架空乙工業株式会社'));
  assert.deepEqual(l.subcontractors.map((s) => [s.tier, s.tierUnknown]), [[null, true], [null, true]]);
  assert.ok(l.warnings.some((w) => /次数が2つ以上/.test(w)));
  l.project.workType = 'other';
  const out = checkTaicho(l);
  // 二人とも一次なら 5,500万円 ≥ 5,000万円だが、どちらかが二次なら下回る。言い切らない
  assert.ok(!out.candidates.some((c) => c.field === 'prime.engineer.role' || c.field === 'prime.licenseType'));
  assert.ok(out.undecidable.some((u) => u.field === 'subcontractors.tier' && /架空甲工業株式会社/.test(u.message)));
});

test('一次・二次の節でも、会社名の見出しの注文者や「(一次)」で次数が決まれば、それで数える', () => {
  const l = parseLedgerText(MIXED('### 4-1. 架空甲工業株式会社(一次)', '### 4-2. 架空乙工業株式会社(一次: 架空甲工業株式会社)'));
  assert.deepEqual(l.subcontractors.map((s) => [s.name, s.tier, s.tierUnknown]), [['架空甲工業株式会社', 1, undefined], ['架空乙工業株式会社', 2, undefined]]);
  l.project.workType = 'other';
  const out = checkTaicho(l);
  // 一次は 3,000万円だけ。境目 5,000万円未満なので候補も「判断できない」も出ない
  assert.ok(!out.candidates.some((c) => c.field === 'prime.engineer.role'));
  assert.ok(!out.undecidable.some((u) => u.field === 'subcontractors.tier'));
});

test('次数の分からない下請けを足しても境目に届かないなら、「判断できない」にしない。一次だけで境目以上なら候補にする', () => {
  const small = parseLedgerText(MIXED('### 4-1. 架空甲工業株式会社', '### 4-2. 架空乙工業株式会社').replace('30,000,000円', '10,000,000円'));
  small.project.workType = 'other';
  assert.ok(!checkTaicho(small).undecidable.some((u) => u.field === 'subcontractors.tier'));
  const big = parseLedgerText(MIXED('### 4-1. 架空甲工業株式会社(一次)', '### 4-2. 架空乙工業株式会社').replace('30,000,000円', '60,000,000円'));
  big.project.workType = 'other';
  assert.ok(checkTaicho(big).candidates.some((c) => c.field === 'prime.engineer.role' && /60,000,000円/.test(c.message)));
});

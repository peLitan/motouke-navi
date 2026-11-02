// F15a: 下請けの技術者の専任の境目は、その下請工事の種類で決める(施行令 第27条第1項の「当該建設工事」)。値はすべて架空
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkTaicho } from '../../src/check-taicho.mjs';
import { parseLedgerText } from '../../src/ledger-text.mjs';

const base = (work, amount) => ({
  project: { name: '架空工事', orderer: '架空市', ordererType: 'public', workType: 'kenchiku-ikkatsu', contractAmount: 150_000_000, periodFrom: '2026-10-01', periodTo: '2027-03-01' },
  prime: { name: '架空甲建設', licenseType: 'tokutei', licenseNumber: 'xxxx', engineer: { role: 'kanri', name: '架空 一', qualification: 'xxxx', dedicated: true } },
  subcontractors: [
    { name: '架空乙', licenseNumber: 'xxxx', work, periodFrom: '2026-10-10', periodTo: '2026-12-01', amount, engineer: { role: 'shunin', name: '架空 二', qualification: 'xxxx', dedicated: false } },
  ],
});
const senin = (out) => out.candidates.filter((c) => c.field === 'engineer.dedicated');
const senUnd = (out) => out.undecidable.filter((u) => u.field === 'engineer.dedicated');

test('反証の再現: 元請けが建築一式・下請け4,600万円・非専任・公共 → 下請けの専任の候補が出る(境目は4,500万円)', () => {
  const c = senin(checkTaicho(base('鉄筋、型枠', 46_000_000)));
  assert.equal(c.length, 1);
  assert.equal(c[0].target, '架空乙');
  assert.match(c[0].message, /下請けの主任技術者が非専任/);
  assert.match(c[0].message, /45,000,000円 以上/);
  assert.ok(c[0].confirm.some((x) => /建築一式工事なら境目は 90,000,000円/.test(x)), '建築一式なら9,000万円を確かめることに付ける');
});

test('下請けの境目は元請けの工事の種類に左右されない(元請けがそれ以外でも建築一式でも同じ)', () => {
  for (const wt of ['kenchiku-ikkatsu', 'other', undefined, null]) {
    const a = base('鉄筋', 46_000_000); a.project.workType = wt;
    const out = checkTaicho(a);
    assert.equal(senin(out).filter((c) => c.target === '架空乙').length, 1, String(wt));
    assert.equal(senUnd(out).filter((u) => u.target === '架空乙').length, 0, String(wt));
  }
});

test('下請けの境目: 4,500万円未満は候補にしない。工事内容に「建築一式」とあれば9,000万円で比べ、確かめることの断りは付けない', () => {
  assert.equal(senin(checkTaicho(base('鉄筋', 44_999_999))).length, 0);
  assert.equal(senin(checkTaicho(base('鉄筋', 45_000_000))).length, 1);
  assert.equal(senin(checkTaicho(base('建築一式工事(増築棟)', 89_999_999))).length, 0);
  const c = senin(checkTaicho(base('建築一式工事(増築棟)', 90_000_000)));
  assert.equal(c.length, 1);
  assert.match(c[0].message, /90,000,000円 以上/);
  assert.ok(!c[0].confirm.some((x) => /建築一式工事なら境目/.test(x)));
});

test('9,000万円以上なら工事の種類に関わらず境目以上なので、建築一式の断りは付けない', () => {
  const c = senin(checkTaicho(base('鉄筋', 95_000_000)));
  assert.equal(c.length, 1);
  assert.ok(!c[0].confirm.some((x) => /建築一式工事なら境目/.test(x)));
});

test('民間で境目の間の額なら「判断できない」にし、建築一式なら要らないことも書く', () => {
  const a = base('鉄筋', 46_000_000); a.project.ordererType = 'private';
  const out = checkTaicho(a);
  assert.equal(senin(out).length, 0);
  const u = senUnd(out).filter((x) => x.target === '架空乙');
  assert.equal(u.length, 1);
  assert.match(u[0].message, /建築一式工事なら境目は 90,000,000円/);
});

test('元請けは従来どおり画面の「工事の種類」で決め、未選択なら判断できない', () => {
  const a = base('鉄筋', 10_000_000); a.prime.engineer.dedicated = false; a.project.workType = null;
  const out = checkTaicho(a);
  assert.ok(senUnd(out).some((u) => u.target === '架空甲建設' && /工事の種類/.test(u.message)));
});

// 見本 B と同じ条件の台帳(架空。fixtures/ は読まない): 元請けは建築一式・公共、一次の下請けに鉄筋・型枠 4,600万円・非専任
const LEDGER_B_LIKE = `# 施工体制台帳
## 1. 作成建設業者(元請)
| 項目 | 内容 |
|---|---|
| 商号又は名称 | 架空丙工務店株式会社 |
| 許可番号 | 国土交通大臣 許可(特-06)第xxxx号 |
## 2. 発注者との契約
| 項目 | 内容 |
|---|---|
| 発注者名 | 架空市 |
| 工期 | 2026年10月1日 から 2027年9月30日 まで |
| 請負代金額 | 金 150,000,000円(税込) |
## 3. 監理技術者・主任技術者
| 項目 | 内容 |
|---|---|
| 監理技術者 氏名 | 架空 一 |
| 資格 | xxxx |
| 専任・非専任 | 専任 |
## 4. 下請負人(一次)
### 4-1. 架空丁躯体株式会社
| 項目 | 内容 |
|---|---|
| 商号又は名称 | 架空丁躯体株式会社 |
| 工事内容 | 鉄筋、型枠、コンクリート打設 |
| 工期 | 2026年11月1日 から 2027年5月31日 まで |
| 請負代金額 | 金 46,000,000円 |
| 主任技術者 氏名 | 架空 二 |
| 資格 | 実務経験 |
| 専任・非専任 | 非専任 |
`;

test('見本 B と同じ条件の台帳: 鉄筋・型枠の下請け(4,600万円・非専任)が候補に出る', () => {
  const l = parseLedgerText(LEDGER_B_LIKE);
  assert.equal(l.subcontractors[0].amount, 46_000_000);
  assert.equal(l.subcontractors[0].engineer.dedicated, false);
  l.project.workType = 'kenchiku-ikkatsu'; l.project.ordererType = 'public';
  const out = checkTaicho(l);
  const c = senin(out);
  assert.equal(c.length, 1, JSON.stringify(c));
  assert.equal(c[0].target, '架空丁躯体株式会社');
  assert.match(c[0].message, /46,000,000円 で 45,000,000円 以上/);
});

test('画面: 「工事の種類」の欄に、自分が請け負う工事(下請けならその下請工事)の種類だと書いてある', () => {
  const html = readFileSync(new URL('../../src/ui/shell.html', import.meta.url), 'utf8');
  assert.match(html, /<select id="work-type" name="work-type" aria-describedby="work-type-hint">/);
  const m = html.match(/<p id="work-type-hint"[^>]*>([^<]*)<\/p>/);
  assert.ok(m);
  assert.match(m[1], /自分が請け負う工事/);
  assert.match(m[1], /下請工事の種類/);
  const built = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  assert.ok(built.includes('id="work-type-hint"'), 'index.html を作り直してある');
});

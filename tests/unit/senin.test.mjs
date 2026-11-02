// F04d: 技術者の専任(建設業法 第26条第3項・施行令 第27条第1項)の判定(値はすべて架空)
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkTaicho } from '../../src/check-taicho.mjs';
import { parseLedgerText, parseDedicated } from '../../src/ledger-text.mjs';
import { renderCheckResult } from '../../src/ui/view.mjs';
import { checkRows } from '../../src/export.mjs';

const base = () => ({
  project: { name: '架空工事', orderer: '架空市', ordererType: 'public', workType: 'other', contractAmount: 100_000_000, periodFrom: '2026-10-01', periodTo: '2027-03-01' },
  prime: { name: '架空甲建設', licenseType: 'tokutei', licenseNumber: 'xxxx', engineer: { role: 'kanri', name: '架空 一', qualification: '1級土木施工管理技士', dedicated: false } },
  subcontractors: [
    { name: '架空乙', licenseNumber: 'xxxx', work: '舗装', periodFrom: '2026-10-10', periodTo: '2026-12-01', amount: 30_000_000, engineer: { role: 'shunin', name: '架空 二', qualification: '実務経験', dedicated: false } },
  ],
});
const senin = (out) => out.candidates.filter((c) => c.field === 'engineer.dedicated');
const senUnd = (out) => out.undecidable.filter((u) => u.field === 'engineer.dedicated');
const arts = (c) => c.basis.map((b) => b.law + ' ' + b.article + (b.item ? '-' + b.item : ''));

test('公共・境目以上・監理技術者が非専任なら、第26条第3項・施行令 第27条を根拠に候補にし、ただし書は「確かめること」に付ける', () => {
  const out = checkTaicho(base());
  const c = senin(out);
  assert.equal(c.length, 1);
  assert.equal(c[0].target, '架空甲建設');
  assert.match(c[0].message, /監理技術者が非専任/);
  assert.match(c[0].message, /45,000,000円 以上/);
  assert.ok(arts(c[0]).includes('建設業法 26'));
  assert.ok(arts(c[0]).includes('建設業法施行令 27'));
  assert.ok(arts(c[0]).includes('建設業法施行令 27-1'));
  assert.ok(c[0].confirm.some((x) => /第1号/.test(x)));
  assert.ok(c[0].confirm.some((x) => /第2号.*補佐/.test(x)), '監理技術者なら補佐する者のただし書を付ける');
});

test('下請けは下請契約の額で判定し、主任技術者には補佐する者(第2号)のただし書を付けない', () => {
  const a = base(); a.prime.engineer.dedicated = true; a.subcontractors[0].amount = 50_000_000;
  const c = senin(checkTaicho(a));
  assert.equal(c.length, 1);
  assert.equal(c[0].target, '架空乙');
  assert.match(c[0].message, /主任技術者が非専任/);
  assert.ok(!c[0].confirm.some((x) => /補佐/.test(x)));
  assert.ok(!arts(c[0]).includes('建設業法 26-2'));
});

test('境目は施行令 第27条第1項の抜き書きから読む(それ以外 四千五百万円・建築一式 九千万円)', () => {
  const a = base(); a.project.contractAmount = 44_999_999;
  assert.equal(senin(checkTaicho(a)).length, 0);
  a.project.contractAmount = 45_000_000;
  assert.equal(senin(checkTaicho(a)).length, 1);
  a.project.workType = 'kenchiku-ikkatsu'; a.project.contractAmount = 89_999_999;
  assert.equal(senin(checkTaicho(a)).length, 0);
  a.project.contractAmount = 90_000_000;
  assert.equal(senin(checkTaicho(a)).length, 1);
});

test('「専任」・欄が無い技術者は、候補にも「判断できない」にもしない', () => {
  for (const d of [true, null, undefined]) {
    const a = base(); a.prime.engineer.dedicated = d; a.subcontractors[0].engineer.dedicated = d; a.subcontractors[0].amount = 60_000_000;
    const out = checkTaicho(a);
    assert.equal(senin(out).length, 0, String(d));
    assert.equal(senUnd(out).length, 0, String(d));
  }
});

test('民間・公共か分からない・金額や工事の種類が分からないときは「判断できない」にし、推測で候補にしない', () => {
  const p = base(); p.project.ordererType = 'private';
  let out = checkTaicho(p);
  assert.equal(senin(out).length, 0);
  assert.equal(senUnd(out).length, 1);
  assert.match(senUnd(out)[0].message, /第3号/);
  const u = base(); u.project.ordererType = undefined;
  out = checkTaicho(u);
  assert.equal(senin(out).length, 0);
  assert.match(senUnd(out)[0].message, /公共か民間か/);
  const m = base(); m.project.contractAmount = null;
  out = checkTaicho(m);
  assert.equal(senin(out).length, 0);
  assert.match(senUnd(out)[0].message, /請負代金の額が分からない/);
  const w = base(); w.project.workType = undefined;
  out = checkTaicho(w);
  assert.equal(senin(out).length, 0);
  assert.ok(senUnd(out).some((x) => /工事の種類/.test(x.message)));
});

test('台帳の文の「専任・非専任」の欄を読む(読めない値は注意に出して null)', () => {
  assert.deepEqual(parseDedicated('専任'), { value: true, error: null });
  assert.deepEqual(parseDedicated(' 非専任 '), { value: false, error: null });
  assert.deepEqual(parseDedicated(''), { value: null, error: null });
  assert.equal(parseDedicated('兼任').value, null);
  assert.match(parseDedicated('兼任').error, /読めません/);
  const text = '## 3. 元請の技術者等\n\n| 項目 | 内容 |\n|---|---|\n| 監理技術者 氏名 | 架空 一 |\n| 専任・非専任 | 兼任 |\n';
  const l = parseLedgerText(text);
  assert.equal(l.prime.engineer.dedicated, null);
  assert.equal(l.prime.engineer.name, '架空 一');
  assert.ok(l.warnings.some((x) => /専任・非専任/.test(x) && /6行目/.test(x)));
});

// 見本の台帳 A と同じ条件(市の発注・3億円・監理技術者が非専任)の台帳の文。fixtures/ は利用者が扱うので、試験では読まない
const LEDGER_A_LIKE = `# 施工体制台帳(架空)

## 1. 作成建設業者(元請)

| 項目 | 内容 |
|---|---|
| 商号 | 架空甲建設株式会社 |
| 許可番号 | 架空県知事 許可(特-06)第00001号 |

## 2. 発注者との契約

| 項目 | 内容 |
|---|---|
| 発注者 | 架空市 |
| 工期 | 2026年9月1日 から 2027年3月19日 まで |
| 請負代金額 | 金 300,000,000円(税込) |

## 3. 元請の技術者等

| 項目 | 内容 |
|---|---|
| 監理技術者 氏名 | 架空 一 |
| 資格 | 1級土木施工管理技士 |
| 専任・非専任 | 非専任 |

## 4. 下請負人(一次)

### 4-1. 架空乙土工株式会社

| 項目 | 内容 |
|---|---|
| 工事内容 | 掘削、盛土 |
| 工期 | 2026年9月10日 から 2026年12月25日 まで |
| 請負代金額 | 金 52,000,000円 |
| 主任技術者 氏名 | 架空 二 |
| 資格 | 2級土木施工管理技士 |
| 専任・非専任 | 専任 |

### 4-2. 架空丙設備株式会社

| 項目 | 内容 |
|---|---|
| 工事内容 | 排水管布設 |
| 工期 | 2026年10月1日 から 2027年2月26日 まで |
| 請負代金額 | 金 27,000,000円 |
| 主任技術者 氏名 | 架空 三 |
| 資格 | 実務経験 |
| 専任・非専任 | 非専任 |
`;

test('台帳 A と同じ条件(市の発注・3億円・監理技術者が非専任)で、元請けの専任の候補だけが根拠の条つきで出る', () => {
  const l = parseLedgerText(LEDGER_A_LIKE);
  assert.equal(l.prime.engineer.dedicated, false);
  assert.deepEqual(l.subcontractors.map((s) => s.engineer.dedicated), [true, false]);
  l.project.workType = 'other'; l.project.ordererType = 'public';
  const out = checkTaicho(l);
  const c = senin(out);
  assert.equal(c.length, 1, JSON.stringify(c));
  assert.equal(c[0].target, '架空甲建設株式会社');
  assert.match(c[0].message, /300,000,000円/);
  assert.ok(arts(c[0]).includes('建設業法 26') && arts(c[0]).includes('建設業法施行令 27'));
  assert.equal(senUnd(out).length, 0, '2,700万円の下請けの非専任は境目未満なので出さない');
});

test('画面と CSV に「確かめること」を出す', () => {
  const out = checkTaicho(base());
  const h = renderCheckResult(out);
  assert.match(h, /技術者の専任/);
  assert.match(h, /確かめること/);
  const csv = checkRows(out, '注意').map((r) => r.join(',')).join('\n');
  assert.match(csv, /確かめること: 建設業法 第26条第3項ただし書 第1号/);
});

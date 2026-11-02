// F05b: 画面(台帳を入れる → 点検の候補)(条件 F05-1、F04-1・F04-3)
import test from 'node:test';
import assert from 'node:assert/strict';
import { load, indexHtml, scriptsOf, hasId, articleLabel, runPage } from './_helpers.mjs';

// 見出しと「| 項目 | 内容 |」の表で書いた台帳(値はすべて架空)
const LEDGER_MD = `# 施工体制台帳

工事名: 架空川 護岸改修工事
工事場所: 架空県ためし市 地内

## 1. 作成建設業者(元請)

| 項目 | 内容 |
|---|---|
| 商号 | 架空一建設株式会社 |
| 許可番号 | 架空県知事 許可(特-06)第99001号 |

## 2. 発注者との契約

| 項目 | 内容 |
|---|---|
| 発注者 | 架空県 |
| 工期 | 2026年10月1日 から 2027年3月15日 まで |
| 請負代金額 | 金 250,000,000円(税込) |

## 3. 元請の技術者等

| 項目 | 内容 |
|---|---|
| 監理技術者 氏名 | 架空 太郎 |
| 資格 | 1級土木施工管理技士 |

## 4. 下請負人(一次)

### 4-1. 架空二土木株式会社

| 項目 | 内容 |
|---|---|
| 許可番号 | 架空県知事 許可(般-06)第99002号 |
| 工事内容 | 掘削、盛土 |
| 工期 | 2026年10月10日 から 2026年12月20日 まで |
| 請負代金額 | 金 35,000,000円 |
| 主任技術者 氏名 | 架空 次郎 |
| 資格 | 2級土木施工管理技士 |

### 4-2. 架空三工業株式会社

| 項目 | 内容 |
|---|---|
| 許可番号 | 架空県知事 許可(般-06)第99003号 |
| 工事内容 | 護岸ブロック据付 |
| 工期 | 2026年12月1日 から 2027年2月28日 まで |
| 請負代金額 | 金 25,000,000円 |
| 主任技術者 氏名 | |
| 資格 | |
`;

test('parseLedgerText: 見出しと表の台帳を、点検の入力の形にする', async () => {
  const { parseLedgerText } = await load('src/ledger-text.mjs');
  const l = parseLedgerText(LEDGER_MD);
  assert.equal(l.project.name, '架空川 護岸改修工事');
  assert.equal(l.project.orderer, '架空県');
  assert.equal(l.project.contractAmount, 250000000);
  assert.equal(l.project.periodFrom, '2026-10-01');
  assert.equal(l.project.periodTo, '2027-03-15');
  assert.equal(l.prime.name, '架空一建設株式会社');
  assert.equal(l.prime.licenseType, 'tokutei');
  assert.equal(l.prime.engineer.role, 'kanri');
  assert.equal(l.prime.engineer.name, '架空 太郎');
  assert.equal(l.subcontractors.length, 2);
  const [s1, s2] = l.subcontractors;
  assert.equal(s1.name, '架空二土木株式会社');
  assert.equal(s1.work, '掘削、盛土');
  assert.equal(s1.periodFrom, '2026-10-10');
  assert.equal(s1.amount, 35000000);
  assert.equal(s1.engineer.name, '架空 次郎');
  assert.equal(s2.engineer.name, '');
});

test('読み取った台帳を点検すると、空いている主任技術者の欄が候補に出て、表示に根拠の条が出る', async () => {
  const { parseLedgerText } = await load('src/ledger-text.mjs');
  const { checkTaicho } = await load('src/check-taicho.mjs');
  const { renderCheckResult } = await load('src/ui/view.mjs');
  const l = parseLedgerText(LEDGER_MD);
  l.project.ordererType = 'public';
  const out = checkTaicho(l);
  const c = out.candidates.find((x) => String(x.target).includes('架空三工業株式会社'));
  assert.ok(c, '候補が出ない');
  const html = renderCheckResult(out);
  assert.ok(html.includes(c.message.replace(/&/g, '&amp;').replace(/</g, '&lt;')));
  for (const b of c.basis) assert.ok(html.includes(articleLabel(b.article)));
  const u = renderCheckResult({ candidates: [], undecidable: [{ target: '架空一建設株式会社', field: '下請けの総額', message: '金額が分からない下請けがある' }] });
  assert.ok(/判断できない/.test(u) && u.includes('金額が分からない下請けがある'));
});

test('見本の台帳も読み取れる', async () => {
  const { parseLedgerText } = await load('src/ledger-text.mjs');
  const { SAMPLE } = await load('src/sample.mjs');
  const l = parseLedgerText(SAMPLE.documents.ledger);
  assert.ok(l.prime.name && l.subcontractors.length >= 1);
});

test('画面を動かす: 台帳を貼って点検を押すと候補が出る。見本の台帳も入る', async () => {
  const page = runPage();
  await page.set('orderer', 'public');
  await page.set('ledger-input', LEDGER_MD);
  await page.click('ledger-run');
  const out = page.text('check-result');
  assert.ok(out.includes('架空三工業株式会社'), '候補が画面に出ない');
  await page.click('sample-load');
  assert.ok(page.el('ledger-input').value.trim().length > 0, '見本の台帳が入らない');
});

test('点検の候補を CSV に書き出す行(見出しと候補ごとの行、根拠の条つき)', async () => {
  const { checkRows } = await load('src/export.mjs');
  const out = { candidates: [{ target: '架空三工業株式会社', field: '主任技術者', message: '主任技術者の欄が空', basis: [{ law: '建設業法', article: '26', paragraph: 1, quote: '架空の抜き書き' }] }], undecidable: [{ target: '架空一建設株式会社', field: '下請けの総額', message: '金額が分からない' }] };
  const rows = checkRows(out);
  assert.equal(rows.length, 3);
  const body = rows.slice(1).map((r) => r.join(' ')).join('\n');
  assert.ok(body.includes('架空三工業株式会社') && body.includes('第26条') && body.includes('判断できない'));
});

test('画面に台帳の入力と点検の結果の欄があり、点検の部品を組み込んでいる', () => {
  const html = indexHtml();
  for (const id of ['ledger-input', 'ledger-run', 'check-result']) assert.ok(hasId(html, id), 'id が無い: ' + id);
  const code = scriptsOf(html).map((s) => s.code).join('\n');
  for (const n of ['parseLedgerText', 'checkTaicho', 'renderCheckResult']) assert.ok(code.includes(n));
});

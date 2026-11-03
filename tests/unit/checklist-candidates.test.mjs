// F29b: 記載事項の「空」を候補へ・資格の区分・発注者の食い違い(すべて架空の値)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseLedgerText } from '../../src/ledger-text.mjs';
import { checkTaicho } from '../../src/check-taicho.mjs';
import { checkChecklistText } from '../../src/checklist.mjs';
import { addChecklistCandidates } from '../../src/ledger-check.mjs';
import { qualificationUnclear, ordererReadsAs } from '../../src/ledger-reading.mjs';
import { renderCheckResult } from '../../src/ui/view.mjs';
import { checkRows } from '../../src/export.mjs';

const ledgerText = ({ orderer = '架空市', qualification = '1級土木施工管理技士', subName = '主任技術者 氏名 | 架空 次郎', subQual = '2級土木施工管理技士', insurance = '健康保険 / 厚生年金 / 雇用保険 | 加入 / 加入 / 加入', dedicated = '専任' } = {}) => `工事名: 架空川 護岸工事

## 1. 作成建設業者(元請)
| 項目 | 内容 |
|---|---|
| 商号又は名称 | 架空一建設株式会社 |
| 許可番号 | 架空県知事 許可(特-06)第99001号 |

## 2. 発注者との契約
| 項目 | 内容 |
|---|---|
| 発注者 | ${orderer} |
| 請負代金額 | 100,000,000円 |
| 工期 | 2026年10月1日 から 2027年3月15日 まで |

## 3. 技術者
| 項目 | 内容 |
|---|---|
| 監理技術者 氏名 | 架空 太郎 |
| 資格 | ${qualification} |
| 専任・非専任 | ${dedicated} |

## 4. 下請負人(一次)
### 4-1. 架空二土木株式会社
| 項目 | 内容 |
|---|---|
| 商号又は名称 | 架空二土木株式会社 |
| 許可番号 | 架空県知事 許可(般-06)第99002号 |
| 工事の内容 | 掘削 |
| 工期 | 2026年10月10日 から 2026年12月20日 まで |
| 請負代金額 | 10,000,000円 |
| ${subName} |
| 資格 | ${subQual} |
| 専任・非専任 | 非専任 |
| ${insurance} |
`;

function run(text, form = { workType: 'other', ordererType: 'public' }) {
  const ledger = parseLedgerText(text);
  Object.assign(ledger.project, form);
  const base = checkTaicho(ledger);
  const checklist = checkChecklistText(text);
  return { base, checklist, out: addChecklistCandidates(base, ledger, checklist) };
}

test('「空」の行が候補に出て、条・号と根拠の原文が付く', () => {
  const { base, checklist, out } = run(ledgerText({ insurance: '健康保険 / 厚生年金 / 雇用保険 | 加入 / / 加入' }));
  assert.equal(checklist.rows.find((r) => r.itemId === '3-ha').status, 'empty');
  const c = out.candidates.find((x) => x.field === 'checklist.3-ha');
  assert.equal(c.target, '架空二土木株式会社');
  assert.match(c.message, /第14条の2 第1項 第三号 ハ/);
  assert.match(c.message, /厚生年金保険/);
  assert.equal(c.basis[0].quoteId, 'q-kisoku-14_2-1-3-ha');
  assert.ok(c.basis[0].quote.length > 0 && c.basis[0].fetchedAt);
  assert.equal(base.candidates.filter((x) => x.field === 'checklist.3-ha').length, 0, 'checkTaicho の返り値は変えない');
  // 画面と CSV にも欄の名前で出る
  assert.match(renderCheckResult(out), /健康保険等の加入状況/);
  assert.ok(checkRows(out).some((r) => r.join('').includes('健康保険等の加入状況')));
});

test('同じ欄は二重に出さず、前からの候補に号を足す。重ならない欄だけ別に出す', () => {
  const { out } = run(ledgerText({ subName: '主任技術者 氏名 | ', subQual: '' }).replace('| 専任・非専任 | 非専任 |', '| 専任・非専任 | |'));
  const engineer = out.candidates.filter((x) => x.target === '架空二土木株式会社' && x.field === 'engineer');
  assert.equal(engineer.length, 1);
  assert.ok(engineer[0].basis.some((b) => b.quoteId === 'q-kensetsu-26-1'));
  assert.ok(engineer[0].basis.some((b) => b.quoteId === 'q-kisoku-14_2-1-4-ho'));
  // 氏名が空のとき前からの候補は資格を言わないので、資格と専任は記載事項の候補に残す。氏名は書かない
  const row = out.candidates.find((x) => x.field === 'checklist.4-ho');
  assert.match(row.message, /主任技術者の資格/);
  assert.match(row.message, /専任か否か/);
  assert.doesNotMatch(row.message, /主任技術者の氏名/);
  assert.match(row.message, /建設業者のときの事項/);
});

test('checkTaicho だけのときは資格の区分を見ない(受け入れテストの入力のとおり)', () => {
  const { base, out } = run(ledgerText({ subQual: '実務経験' }));
  assert.ok(!base.undecidable.some((u) => u.field === 'engineer.qualification'));
  assert.ok(out.undecidable.some((u) => u.field === 'engineer.qualification'));
});

test('発注者の欄に「発注者の住所」の行を読まない', () => {
  const ledger = parseLedgerText(ledgerText({ orderer: '架空開発株式会社' }).replace('| 請負代金額 | 100,', '| 発注者の住所 | 架空県 架空町 0-0 |\n| 請負代金額 | 100,'));
  assert.equal(ledger.project.orderer, '架空開発株式会社');
});

test('前からの候補と全部重なる行は、候補を増やさない', () => {
  const { base, out } = run(ledgerText({ subQual: '' }));
  assert.equal(base.candidates.filter((x) => x.field === 'engineer.qualification').length, 1);
  assert.equal(out.candidates.filter((x) => x.field === 'engineer.qualification').length, 1);
  assert.equal(out.candidates.filter((x) => x.field === 'checklist.4-ho').length, 0);
});

test('「判断できない」「値」の行は候補にしない', () => {
  const { checklist, out } = run(ledgerText());
  assert.ok(checklist.counts.unknown > 0);
  assert.equal(checklist.counts.empty, 0);
  assert.deepEqual(out.candidates.filter((x) => String(x.field).startsWith('checklist.')), []);
});

test('資格の区分が決められないときは「判断できない」(値でも空でもない)', () => {
  for (const q of ['実務経験', '有', '資格あり', '別紙のとおり', '1級', '施工管理技士', '1級土木施工管理技士補']) {
    const { checklist, out } = run(ledgerText({ subQual: q }));
    const row = checklist.rows.find((r) => r.itemId === '4-ho');
    assert.equal(row.status, 'unknown', q);
    assert.match(row.reason, /区分/, q);
    assert.match(row.value, /資格の区分を決められない/, q);
    const u = out.undecidable.filter((x) => x.target === '架空二土木株式会社' && x.field === 'engineer.qualification');
    assert.equal(u.length, 1, q);
    assert.ok(u[0].message.includes(q));
    assert.ok(u[0].basis.some((b) => b.quoteId === 'q-kisoku-14_2-1-4-ho'));
    assert.equal(out.candidates.filter((x) => x.field === 'engineer.qualification').length, 0, q);
  }
  const prime = run(ledgerText({ qualification: '実務経験' }));
  assert.equal(prime.checklist.rows.find((r) => r.itemId === '2-ho').status, 'unknown');
  assert.ok(prime.out.undecidable.some((x) => x.target === '架空一建設株式会社' && x.field === 'engineer.qualification'));
});

test('資格の名前や号が読めるときは区分が決まる', () => {
  for (const q of ['1級土木施工管理技士', '２級建築施工管理技士(仕上げ)', '1級鉄筋施工技能士', '技術士(建設部門)', '一級建築士', '実務経験(第7条第2号ロ)', '1級土木施工管理技士(監理技術者資格者証 第T00000号)', '第一種電気工事士']) {
    assert.equal(qualificationUnclear(q), false, q);
    assert.equal(run(ledgerText({ subQual: q })).checklist.rows.find((r) => r.itemId === '4-ho').status, 'value', q);
  }
  assert.equal(qualificationUnclear(''), false, '空は区分の問題にしない');
});

test('発注者の名前と画面の公共・民間が食い違って読めるときは「判断できない」', () => {
  const dedicated = '非専任';
  // 民間と読める名前で「公共」: 第1号に当たるとする候補を出さず、判断できないに回す
  const a = run(ledgerText({ orderer: '架空開発株式会社', dedicated }));
  assert.ok(a.out.undecidable.some((u) => u.field === 'project.ordererType' && u.message.includes('公共') && u.basis.some((b) => b.quoteId === 'q-rei-27-1-1')));
  assert.ok(!a.out.candidates.some((c) => c.field === 'engineer.dedicated'));
  assert.ok(a.out.undecidable.some((u) => u.field === 'engineer.dedicated'));
  // 公共と読める名前で「民間」
  const b = run(ledgerText({ orderer: '架空県 住宅供給課', dedicated }), { workType: 'other', ordererType: 'private' });
  assert.ok(b.out.undecidable.some((u) => u.field === 'project.ordererType' && u.message.includes('民間')));
  assert.match(renderCheckResult(b.out), /発注者\(公共か民間か\)/);
});

test('発注者の食い違いは、読めるときだけ。読めない名前では言わない', () => {
  const same = run(ledgerText({ orderer: '架空市', dedicated: '非専任' }));
  assert.ok(!same.out.undecidable.some((u) => u.field === 'project.ordererType'));
  assert.ok(same.out.candidates.some((c) => c.field === 'engineer.dedicated'), '合っていれば今までどおり候補');
  for (const [name, read] of [['架空県みほん市(みほん市長)', 'public'], ['架空市建設部', 'public'], ['架空山村', 'public'], ['国土交通省 架空地方整備局', 'public'], ['北海道', 'public'], ['架空開発株式会社', 'private'], ['架空市開発株式会社', 'private'], ['㈱架空', 'private'], ['中村 太郎', null], ['田村', null], ['架空土地開発公社', null], ['', null]]) {
    assert.equal(ordererReadsAs(name), read, name);
  }
  for (const orderer of ['中村 太郎', '架空土地開発公社']) {
    for (const ordererType of ['public', 'private']) {
      assert.ok(!run(ledgerText({ orderer }), { workType: 'other', ordererType }).out.undecidable.some((u) => u.field === 'project.ordererType'), orderer);
    }
  }
  // 画面で選んでいなければ比べない
  assert.ok(!run(ledgerText({ orderer: '架空開発株式会社' }), { workType: 'other' }).out.undecidable.some((u) => u.field === 'project.ordererType'));
});

test('架空の見本の台帳でも、候補の欄が重ならない', () => {
  const dir = new URL('../../fixtures/', import.meta.url);
  for (const name of fs.readdirSync(dir).filter((n) => /^[ABC]_/.test(n))) {
    const { out } = run(fs.readFileSync(new URL(encodeURI(name) + '/施工体制台帳.md', dir), 'utf8'));
    const keys = out.candidates.map((c) => c.target + '\t' + c.field);
    assert.equal(new Set(keys).size, keys.length, name);
    for (const c of out.candidates.filter((x) => String(x.field).startsWith('checklist.'))) {
      assert.ok(c.basis.length === 1 && c.message.includes('第14条の2'), name);
    }
  }
});

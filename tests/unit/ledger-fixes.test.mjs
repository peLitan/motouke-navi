// F29a: 反証の指摘(台帳の記載事項の点検の取り違え)を再現する入力で、取り違えずに出すかを確かめる。台帳の値はすべて架空
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkChecklistText, isNone } from '../../src/checklist.mjs';
import { parseLedgerText } from '../../src/ledger-text.mjs';

const find = (res, entityPart, itemId) => res.rows.find((r) => r.entity.includes(entityPart) && r.itemId === itemId);
const part = (row, label) => row.parts.find((p) => p.label === label);

// 元請けの節と下請け1社の台帳の文を作る。engineerRows は元請けの技術者の節の行、subRows は下請けの行、primeRows は元請けの節の行
function ledger({ primeRows = [], engineerRows = [], extra = '', subRows = [] }) {
  const table = (rows) => ['| 項目 | 内容 |', '|---|---|', ...rows].join('\n');
  return [
    '工事名: 架空ためし改良工事',
    '',
    '## 1. 作成建設業者(元請)',
    '',
    table(['| 商号 | 架空建設株式会社 |', '| 許可番号 | 架空県知事 許可(特-06)第00001号 |', ...primeRows]),
    '',
    '## 3. 元請の技術者等',
    '',
    table(engineerRows),
    extra,
    '## 4. 下請負人(一次)',
    '',
    '### 4-1. 架空工業株式会社',
    '',
    table(subRows),
    '',
  ].join('\n');
}

const KANRI = ['| 監理技術者 氏名 | 甲野 一郎 |', '| 資格 | 1級土木施工管理技士 |', '| 専任・非専任 | 専任 |'];

test('A-1: 下請けの許可番号が「なし」で主任技術者の欄が空なら、建設業者と決めず「空」と言わない', () => {
  const r = checkChecklistText(ledger({ engineerRows: KANRI, subRows: ['| 許可番号 | なし |', '| 主任技術者 氏名 | |', '| 資格 | |', '| 専任・非専任 | |'] }));
  const ho = find(r, '架空工業', '4-ho');
  assert.equal(ho.status, 'unknown', ho.reason);
  assert.match(ho.reason, /許可番号の欄が「なし」/);
  assert.doesNotMatch(ho.reason, /当てはまると読みました/);
  // 許可番号に番号が書いてあれば今までどおり建設業者として「空」
  const r2 = checkChecklistText(ledger({ engineerRows: KANRI, subRows: ['| 許可番号 | 架空県知事 許可(般-05)第00002号 |', '| 主任技術者 氏名 | |'] }));
  assert.equal(find(r2, '架空工業', '4-ho').status, 'empty');
  // 「なし」のほかの書き方
  for (const v of ['なし', '無し', '該当なし', '－', '-', 'なし(軽微な工事のみ)', ' な し ']) assert.ok(isNone(v), v);
  for (const v of ['架空県知事 許可(般-05)第00002号', '']) assert.ok(!isNone(v), v);
  // 「申請中」は「なし」ではないが許可番号でもないので、建設業者とは決めず「判断できない」(F31e)
  const r3 = checkChecklistText(ledger({ engineerRows: KANRI, subRows: ['| 許可番号 | 申請中 |', '| 主任技術者 氏名 | |'] }));
  assert.equal(find(r3, '架空工業', '4-ho').status, 'unknown');
});

test('A-2: 「健康保険 / 厚生年金 / 雇用保険 | 加入 / / 加入」は欄ごとに分けて、厚生年金を「空」にする', () => {
  const r = checkChecklistText(ledger({ engineerRows: KANRI, subRows: ['| 許可番号 | 架空県知事 許可(般-05)第00002号 |', '| 健康保険 / 厚生年金 / 雇用保険 | 加入 / / 加入 |'] }));
  const ha = find(r, '架空工業', '3-ha');
  assert.equal(ha.status, 'empty', ha.reason);
  assert.equal(part(ha, '健康保険').state, 'found');
  assert.equal(part(ha, '厚生年金保険').state, 'blank');
  assert.equal(part(ha, '雇用保険').value, '加入');
  assert.match(ha.reason, /厚生年金保険/);
  assert.match(ha.value, /厚生年金保険: \(空\)/);
  // 元請けの節のまとめ欄も同じ。全部に値があれば値
  const r2 = checkChecklistText(ledger({ primeRows: ['| 健康保険 / 厚生年金 / 雇用保険 | 加入 / 加入 / 適用除外 |'], engineerRows: KANRI }));
  const ro = find(r2, '作成建設業者', '1-ro');
  assert.equal(ro.status, 'value', ro.reason);
  assert.equal(part(ro, '雇用保険').value, '適用除外');
  // 値の数が欄の数と合わなければ、どれがどれか決めず「判断できない」
  const r3 = checkChecklistText(ledger({ engineerRows: KANRI, subRows: ['| 許可番号 | 架空県知事 許可(般-05)第00002号 |', '| 健康保険 / 厚生年金 / 雇用保険 | 加入 / 加入 |'] }));
  const ha3 = find(r3, '架空工業', '3-ha');
  assert.equal(ha3.status, 'unknown', ha3.reason);
  assert.match(ha3.reason, /数が合わない/);
  // 値に「/」が無ければ今までどおり1つの値として扱う(見本 A の書き方「加入 / 加入 / 加入」も値)
  const r4 = checkChecklistText(ledger({ engineerRows: KANRI, subRows: ['| 健康保険 / 厚生年金 / 雇用保険 | 加入 / 加入 / 加入 |'] }));
  assert.equal(find(r4, '架空工業', '3-ha').status, 'value');
});

test('A-3: 監理技術者補佐の「専任」の行のあとに監理技術者の専任の欄が空なら、補佐の「専任」を読まずに「空」', () => {
  const rows = [
    '| 監理技術者補佐 氏名 | 甲野 四郎 |', '| 監理技術者補佐 資格 | 1級土木施工管理技士補 |', '| 監理技術者補佐 専任・非専任 | 専任 |',
    '| 監理技術者 氏名 | 甲野 一郎 |', '| 資格 | 1級土木施工管理技士 |', '| 専任・非専任 | |',
  ];
  const r = checkChecklistText(ledger({ engineerRows: rows }));
  const ho = find(r, '作成建設業者', '2-ho');
  assert.equal(ho.status, 'empty', ho.reason);
  assert.equal(part(ho, '専任か否か').state, 'blank');
  assert.equal(part(ho, '専任か否か').key, '専任・非専任');
  assert.equal(part(ho, '技術者の氏名').value, '甲野 一郎');
  const he = find(r, '作成建設業者', '2-he');
  assert.equal(he.status, 'value', he.reason);
  // 「### 監理技術者補佐」の小見出しの下の「氏名・資格・専任」の行も補佐の行として扱う
  const extra = ['', '### 監理技術者補佐', '', '| 項目 | 内容 |', '|---|---|', '| 氏名 | 甲野 四郎 |', '| 資格 | 1級土木施工管理技士補 |', '| 専任・非専任 | 専任 |', ''].join('\n');
  const r2 = checkChecklistText(ledger({ engineerRows: ['| 監理技術者 氏名 | 甲野 一郎 |', '| 監理技術者 資格 | 1級土木施工管理技士 |', '| 監理技術者 専任・非専任 | |'], extra }));
  const ho2 = find(r2, '作成建設業者', '2-ho');
  assert.equal(ho2.status, 'empty', ho2.reason);
  assert.equal(part(ho2, '専任か否か').key, '監理技術者 専任・非専任');
  assert.equal(find(r2, '作成建設業者', '2-he').status, 'value');
  // 監理技術者の欄に補佐の小見出しの値が入らないことは、点検の入力(parseLedgerText)でも同じ
  const p = parseLedgerText(ledger({ engineerRows: ['| 監理技術者 氏名 | 甲野 一郎 |', '| 専任・非専任 | |'], extra }));
  assert.equal(p.prime.engineer.dedicated, null);
  assert.equal(p.prime.engineer.assistant.dedicated, true);
});

test('A-4: 「監理技術者補佐 | 氏名」だけ・「専門技術者 | 氏名」だけでは、資格の欄が無いので「判断できない」', () => {
  const r = checkChecklistText(ledger({ engineerRows: [...KANRI, '| 監理技術者補佐 | 甲野 五郎 |', '| 専門技術者 | 甲野 六郎 |'], subRows: ['| 専門技術者 | 甲野 七郎 |'] }));
  const he = find(r, '作成建設業者', '2-he');
  assert.equal(he.status, 'unknown', he.reason);
  assert.equal(part(he, '監理技術者補佐の氏名').value, '甲野 五郎');
  assert.equal(part(he, '監理技術者補佐の資格').state, 'missing');
  for (const [ent, id] of [['作成建設業者', '2-to'], ['架空工業', '4-he']]) {
    const to = find(r, ent, id);
    assert.equal(to.status, 'unknown', id + ' ' + to.reason);
    assert.equal(part(to, '専門技術者などの資格').state, 'missing');
    assert.equal(part(to, '管理をつかさどる工事の内容').state, 'missing');
  }
  // 補佐・専門技術者の行を監理技術者の欄として読まない
  const ho = find(r, '作成建設業者', '2-ho');
  assert.equal(part(ho, '技術者の氏名').value, '甲野 一郎');
  assert.equal(ho.status, 'value');
  // 氏名・工事の内容・資格がそろえば値。「専門技術者 | なし」は置いていないと書いたものなので値(見本 A の書き方)
  const r2 = checkChecklistText(ledger({ engineerRows: [...KANRI, '| 専門技術者 氏名 | 甲野 六郎 |', '| 専門技術者 管理する工事の内容 | 法面工 |', '| 専門技術者 資格 | 2級土木施工管理技士 |', '| 監理技術者補佐 | なし |'] }));
  assert.equal(find(r2, '作成建設業者', '2-to').status, 'value');
  const he2 = find(r2, '作成建設業者', '2-he');
  assert.equal(he2.status, 'value', he2.reason);
  assert.match(he2.reason, /置いていない/);
});

test('A-5: 元請けの節の「社会保険加入状況 | 加入」は、従事する者の社会保険の欄として読まない', () => {
  const r = checkChecklistText(ledger({ primeRows: ['| 社会保険加入状況 | 加入 |'], engineerRows: KANRI, subRows: ['| 社会保険加入状況 | 加入 |'] }));
  for (const [ent, id] of [['作成建設業者', '2-chi-3'], ['架空工業', '4-chi-3']]) {
    const c = find(r, ent, id);
    assert.equal(c.status, 'unknown', id + ' ' + c.reason);
    assert.equal(c.parts[0].state, 'missing');
  }
  // 従事する者の社会保険と分かる欄名なら読む
  const r2 = checkChecklistText(ledger({ engineerRows: [...KANRI, '| 従事者の社会保険加入状況 | 作業員名簿のとおり |'] }));
  assert.equal(find(r2, '作成建設業者', '2-chi-3').status, 'value');
});

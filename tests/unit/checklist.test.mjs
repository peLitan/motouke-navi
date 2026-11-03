// F16b: 台帳の入力から、施行規則 第14条の2 第1項の事項ごとに 値/空/判断できない を出す部品
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import checklistData from '../../data/checklist.json' with { type: 'json' };
import quotesData from '../../data/quotes.json' with { type: 'json' };
import { checkChecklistText, checkChecklistXlsx, STATUS_LABEL } from '../../src/checklist.mjs';
import { readLedgerXlsx } from '../../src/ledger-xlsx.mjs';
import { parseLedgerText } from '../../src/ledger-text.mjs';
import { makeXlsx } from '../acceptance/_helpers.mjs';

// 見本 A・B は fixtures/ にある(利用者が扱う物で git に入れていない)。無ければ見本を使う試験は飛ばす
const fixtureUrl = (dir) => new URL('../../fixtures/' + dir + '/施工体制台帳.md', import.meta.url);
const fixture = (dir) => (fs.existsSync(fixtureUrl(dir)) ? fs.readFileSync(fixtureUrl(dir), 'utf8') : null);
const A = fixture('A_みほん市道改良工事');
const B = fixture('B_ためし台共同住宅新築工事');
const noFixtures = A === null || B === null ? 'fixtures/ の見本 A・B が無い' : false;
const find = (res, entityPart, itemId) => res.rows.find((r) => r.entity.includes(entityPart) && r.itemId === itemId);

test('checklist.json の事項は、どれも quotes.json の第14条の2 の抜き書きを引き、号・細分が抜き書きと合う', () => {
  const quotes = new Map(quotesData.quotes.map((q) => [q.id, q]));
  for (const it of checklistData.items) {
    const q = quotes.get(it.quoteId);
    assert.ok(q, it.id + ' の quoteId が無い: ' + it.quoteId);
    assert.equal(q.sourceId, 'kisoku-14_2');
    assert.equal(q.item, it.item, it.id);
    assert.equal(q.subitem, it.subitem, it.id);
    for (const p of it.parts) if (p.readable !== false) assert.doesNotThrow(() => new RegExp(p.re), it.id);
  }
  // 第1項 一〜四号の細分は全部ある(イ・ロ / イ〜リ / イ〜ハ / イ〜リ。チは (１)〜(６) に分ける)
  const subs = (n) => [...new Set(checklistData.items.filter((x) => x.item === n).map((x) => x.subitem))].join('');
  assert.equal(subs(1), 'イロ');
  assert.equal(subs(2), 'イロハニホヘトチリ');
  assert.equal(subs(3), 'イロハ');
  assert.equal(subs(4), 'イロハニホヘトチリ');
});

test('見本 A: 空 と 判断できない が出る(丙野舗装の主任技術者の欄が空、戊田設備の保険の欄が空)', { skip: noFixtures }, () => {
  const r = checkChecklistText(A);
  assert.ok(r.counts.empty > 0 && r.counts.unknown > 0, JSON.stringify(r.counts));
  const hei = find(r, '丙野舗装', '4-ho');
  assert.equal(hei.status, 'empty');
  assert.equal(hei.statusLabel, '空');
  assert.match(hei.reason, /許可番号の欄に値がある/); // 「建設業者であるときは」を台帳から読んだ理由を出す
  assert.equal(hei.basis.where, '建設業法施行規則 第14条の2 第1項 第四号 ホ');
  assert.match(hei.basis.quote, /^当該下請負人が建設業者であるときは/);
  const bo = find(r, '戊田設備', '3-ha');
  assert.equal(bo.status, 'empty');
  assert.equal(bo.basis.where, '建設業法施行規則 第14条の2 第1項 第三号 ハ');
  // 値は書いてあるまま
  const otsu = find(r, '乙川土工', '4-ho');
  assert.equal(otsu.status, 'value');
  assert.match(otsu.value, /乙川 三郎/);
  // 空はこの2つだけ(欄が見つからないことを空と言わない)
  assert.deepEqual(r.rows.filter((x) => x.status === 'empty').map((x) => x.id).sort(), ['3-ha@sub3', '4-ho@sub2']);
});

test('見本 B: 判断できない が出る。空の欄が無いので 空 は出ない(欄が見つからない事項を空にしない)', { skip: noFixtures }, () => {
  const r = checkChecklistText(B);
  assert.equal(r.counts.empty, 0);
  assert.ok(r.counts.unknown > 0);
  // 作業員名簿の事項は台帳の表に欄が無い → 判断できない(空ではない)
  const chi = find(r, '作成建設業者', '2-chi-1');
  assert.equal(chi.status, 'unknown');
  assert.match(chi.reason, /欄が見つかりません/);
  // 一次の下請けの「作成建設業者の営業所」は欄が無い → 判断できない
  assert.equal(find(r, '辛谷躯体', '4-to').status, 'unknown');
  // 現場代理人の氏名はあるが、通知事項は読まない → 判断できない
  const ni = find(r, '作成建設業者', '2-ni');
  assert.equal(ni.status, 'unknown');
  assert.match(ni.value, /庚原 八郎/);
  // 二次の下請けも1社として出す
  assert.ok(find(r, '子安防水有限会社(二次)', '3-i'));
});

test('見本 A・B を合わせると 空 と 判断できない の両方が出る', { skip: noFixtures }, () => {
  const all = [...checkChecklistText(A).rows, ...checkChecklistText(B).rows];
  const kinds = new Set(all.map((x) => x.status));
  assert.ok(kinds.has('empty') && kinds.has('unknown') && kinds.has('value'));
});

test('「〜ときは」の事項は、当てはまると台帳から分からなければ、欄が空でも 判断できない にする', () => {
  const text = [
    '## 下請負人(一次)', '### 1-1. 架空工業株式会社', '| 項目 | 内容 |', '|---|---|',
    '| 許可番号 | |', '| 主任技術者 氏名 | |', '| 資格 | |', '| 専任・非専任 | |', '| 監督員 | |',
  ].join('\n');
  const r = checkChecklistText(text);
  assert.equal(find(r, '架空工業', '4-ho').status, 'unknown'); // 許可番号が空 → 建設業者か分からない
  assert.equal(find(r, '架空工業', '3-ro').status, 'unknown');
  assert.equal(find(r, '架空工業', '4-ha').status, 'unknown'); // 監督員を置くかは台帳から決めない
  assert.equal(find(r, '架空工業', '3-ha').status, 'unknown'); // 保険の欄が無い → 空ではない
});

test('台帳に下請負人の見出しが無ければ、第三号・第四号は 判断できない', () => {
  const r = checkChecklistText('## 1. 作成建設業者(元請)\n| 項目 | 内容 |\n|---|---|\n| 許可を受けた建設業 | 土木工事業 |\n');
  const subRows = r.rows.filter((x) => /^[34]-/.test(x.itemId));
  assert.ok(subRows.length > 0);
  assert.ok(subRows.every((x) => x.status === 'unknown'));
  assert.equal(find(r, '作成建設業者', '1-i').status, 'value');
  assert.ok(r.notes.length > 0);
});

test('Excel から: 読む欄は値・空を出し、読まない欄と下請負人の事項は 判断できない', async () => {
  const rows = [
    ['施工体制台帳'], ['商号', '架空一建設株式会社'], ['工事名称', '架空川 護岸改修工事'], ['発注者名', '架空県'],
    ['工期', '自 2026年10月1日 至 2027年3月15日'], ['請負代金額', '金 250,000,000円'], ['監理技術者名', ''],
  ];
  const x = await readLedgerXlsx(makeXlsx(rows));
  const r = checkChecklistXlsx(x);
  const i2 = find(r, '作成建設業者', '2-i');
  assert.match(i2.value, /架空川 護岸改修工事/);
  assert.match(i2.value, /2026-10-01 〜 2027-03-15/);
  assert.equal(i2.status, 'unknown'); // 工事の内容は Excel から読まない
  assert.match(i2.reason, /Excel から読むのは/);
  assert.equal(find(r, '作成建設業者', '2-ho').status, 'empty'); // 技術者名の欄が空
  assert.equal(find(r, '作成建設業者', '1-i').status, 'unknown');
  assert.ok(r.rows.filter((y) => /^[34]-/.test(y.itemId)).every((y) => y.status === 'unknown'));
});

test('出す文に「不適法」「違反」の言い切りが無く、状態は 値・空・判断できない の3つだけ', { skip: noFixtures }, () => {
  for (const t of [A, B]) {
    for (const row of checkChecklistText(t).rows) {
      assert.ok(Object.values(STATUS_LABEL).includes(row.statusLabel));
      assert.doesNotMatch(row.label + row.value + row.reason, /不適法|違法|違反/);
    }
  }
});

test('台帳の文の読み込み(parseLedgerText)の結果は変わらない(行を集める部品を足しただけ)', { skip: noFixtures }, () => {
  const p = parseLedgerText(A);
  assert.equal(p.subcontractors.length, 3);
  assert.equal(p.prime.licenseType, 'tokutei');
  assert.equal(p.subcontractors[1].engineer.name, '');
});

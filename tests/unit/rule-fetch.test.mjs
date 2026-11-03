// F16a: 建設業法施行規則 第14条の2(施工体制台帳の記載事項)の原文と、項・号・号の細分ごとの抜き書き
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import sourcesData from '../../data/sources/index.json' with { type: 'json' };
import quotesData from '../../data/quotes.json' with { type: 'json' };
import { checkQuote, subitemOf, itemOf, paragraphOf } from '../../src/quote-check.mjs';

const SRC_ID = 'kisoku-14_2';
const src = sourcesData.sources.find((s) => s.id === SRC_ID);
const text = src ? fs.readFileSync(new URL('../../data/sources/' + src.file, import.meta.url), 'utf8') : '';
const texts = { [SRC_ID]: text };
const quotes = quotesData.quotes.filter((q) => q.sourceId === SRC_ID);

test('index.json に施行規則 第14条の2 の行があり、e-Gov の URL・版・取得日と原文のファイルを持つ', () => {
  assert.ok(src, '施行規則の行が無い');
  assert.equal(src.kind, 'law');
  assert.equal(src.law, '建設業法施行規則');
  assert.equal(src.lawId, '324M50004000014');
  assert.equal(String(src.article), '14の2');
  assert.equal(src.url, 'https://laws.e-gov.go.jp/law/324M50004000014');
  assert.match(src.revisionId, /^324M50004000014_\d{8}_/);
  assert.match(src.fetchedAt, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(text, /^（施工体制台帳の記載事項等）\n第十四条の二　/);
});

test('原文の第1項は 一〜四号、第2項〜第4項がある', () => {
  const p1 = paragraphOf(text, 1);
  for (const k of ['一', '二', '三', '四']) assert.match(p1, new RegExp('^' + k + '　', 'm'));
  assert.doesNotMatch(p1, /^五　/m);
  assert.ok(paragraphOf(text, 4));
  assert.equal(paragraphOf(text, 5), null);
});

// 原文の第1項から、号の細分(イ・ロ…)と、その下の (１)〜(６) の数を数える
function outline() {
  const p1 = paragraphOf(text, 1);
  const rows = [];
  for (let n = 1; n <= 4; n++) {
    const it = itemOf(p1, n);
    for (const m of it.matchAll(/^　([ァ-ヶ])　/gm)) {
      const sub = subitemOf(it, m[1]);
      const deeper = (sub.match(/^　　（[１-９]）　/gm) || []).length;
      rows.push({ item: n, subitem: m[1], deeper });
    }
  }
  return rows;
}

test('抜き書きは第1項の柱書き・4つの号・すべての号の細分と (１)〜(６) を1件ずつ持ち、すべて原文と一致する', () => {
  const rows = outline();
  // 原文の形: 一号 イ・ロ、二号 イ〜リ(チに6つ)、三号 イ〜ハ、四号 イ〜リ(チに6つ)
  assert.deepEqual(rows.map((r) => r.item + r.subitem).join(' '),
    '1イ 1ロ 2イ 2ロ 2ハ 2ニ 2ホ 2ヘ 2ト 2チ 2リ 3イ 3ロ 3ハ 4イ 4ロ 4ハ 4ニ 4ホ 4ヘ 4ト 4チ 4リ');
  const expected = 1 + 4 + rows.length + rows.reduce((a, r) => a + r.deeper, 0);
  assert.equal(quotes.length, expected, '抜き書きの数が原文の項目の数と合わない');
  assert.equal(quotes.length, 40);
  for (const r of rows) {
    const n = quotes.filter((q) => q.item === r.item && q.subitem === r.subitem).length;
    assert.equal(n, 1 + r.deeper, `第${r.item}号${r.subitem} の抜き書きの数`);
  }
  for (const q of quotes) {
    assert.equal(String(q.article), '14の2');
    assert.equal(q.paragraph, 1, '第1項(記載事項)の外の抜き書き: ' + q.id);
    assert.deepEqual(checkQuote(q, texts), { ok: true }, q.id);
  }
  assert.equal(new Set(quotes.map((q) => q.id)).size, quotes.length, 'id の重複');
});

test('同じ文が二号と四号にあっても、号・細分を入れ替えると一致としない', () => {
  const a = quotes.find((q) => q.id === 'q-kisoku-14_2-1-2-i');
  const b = quotes.find((q) => q.id === 'q-kisoku-14_2-1-4-i');
  assert.equal(a.text, '建設工事の名称、内容及び工期');
  assert.equal(b.text, a.text);
  assert.equal(checkQuote({ ...a, subitem: 'ロ' }, texts).ok, false);
  const hoho = quotes.find((q) => q.id === 'q-kisoku-14_2-1-4-ho');
  assert.equal(checkQuote({ ...hoho, item: 2 }, texts).ok, false);
  const chi1 = quotes.find((q) => q.id === 'q-kisoku-14_2-1-2-chi-1');
  assert.equal(chi1.text, '氏名、生年月日及び年齢');
  assert.equal(checkQuote({ ...chi1, subitem: 'リ' }, texts).ok, false);
});

test('subitemOf: 細分は次の細分の前まで(下の (１) を含む)。号が無いのに細分を書いた抜き書きは一致としない', () => {
  const it = [
    '一　架空の者に関する次に掲げる事項',
    '　イ　架空の甲',
    '　ロ　架空の乙に関する次に掲げる事項',
    '　　（１）　架空の丙',
    '　ハ　架空の丁',
  ].join('\n');
  assert.match(subitemOf(it, 'ロ'), /架空の丙/);
  assert.doesNotMatch(subitemOf(it, 'ロ'), /架空の丁/);
  assert.doesNotMatch(subitemOf(it, 'イ'), /架空の乙/);
  assert.equal(subitemOf(it, 'ニ'), null);
  assert.equal(subitemOf(it, 'あ'), null);
  const t = { s: '第九十九条　架空の規定\n' + it };
  assert.equal(checkQuote({ sourceId: 's', paragraph: 1, item: 1, subitem: 'ロ', text: '架空の丙' }, t).ok, true);
  assert.equal(checkQuote({ sourceId: 's', paragraph: 1, item: 1, subitem: 'イ', text: '架空の丙' }, t).ok, false);
  assert.equal(checkQuote({ sourceId: 's', paragraph: 1, item: null, subitem: 'ロ', text: '架空の丙' }, t).ok, false);
});

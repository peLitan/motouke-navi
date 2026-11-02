// src/quote-check.mjs の項・号の照合(値は架空)
import test from 'node:test';
import assert from 'node:assert/strict';
import { paragraphOf, itemOf, checkQuote, filterVerifiedRules } from '../../src/quote-check.mjs';

const text = [
  '（架空の見出し）',
  '第九十九条　架空の者は、届を出さなければならない。',
  '一　架空の甲に当たる者',
  '二　架空の乙に当たる者',
  '　イ　架空の丙',
  '２　前項の届は、書面で出す。',
].join('\n');
const texts = { s: text };

test('paragraphOf: 第1項は条の頭から、第2項は行の頭の「２」から', () => {
  assert.match(paragraphOf(text, 1), /届を出さなければ/);
  assert.doesNotMatch(paragraphOf(text, 1), /書面で出す/);
  assert.match(paragraphOf(text, 2), /書面で出す/);
  assert.equal(paragraphOf(text, 3), null);
  assert.equal(paragraphOf(text, 0), null);
});

test('itemOf: 号は細分を含み、次の号の前まで', () => {
  const p1 = paragraphOf(text, 1);
  assert.match(itemOf(p1, 2), /架空の丙/);
  assert.doesNotMatch(itemOf(p1, 1), /架空の乙/);
  assert.equal(itemOf(p1, 3), null);
});

test('checkQuote: 書いた項・号の外にある文は一致としない', () => {
  assert.equal(checkQuote({ sourceId: 's', paragraph: 2, item: null, text: '前項の届は、書面で出す' }, texts).ok, true);
  assert.equal(checkQuote({ sourceId: 's', paragraph: 1, item: null, text: '前項の届は、書面で出す' }, texts).ok, false);
  assert.equal(checkQuote({ sourceId: 's', paragraph: 1, item: 2, text: '架空の丙' }, texts).ok, true);
  assert.equal(checkQuote({ sourceId: 's', paragraph: 1, item: 1, text: '架空の丙' }, texts).ok, false);
  assert.equal(checkQuote({ sourceId: 'none', paragraph: null, item: null, text: '架空' }, texts).ok, false);
});

test('filterVerifiedRules: 項の食い違う抜き書きを根拠にする行は落とし、理由を返す', () => {
  const quotes = [{ id: 'q', sourceId: 's', article: '99', paragraph: 1, item: null, text: '前項の届は、書面で出す' }];
  const { kept, dropped, problems } = filterVerifiedRules([{ id: 'r', basis: [{ quoteId: 'q' }] }], quotes, texts);
  assert.deepEqual(kept, []);
  assert.deepEqual(dropped.map((r) => r.id), ['r']);
  assert.equal(problems[0].reason, '第1項の中に無い');
});

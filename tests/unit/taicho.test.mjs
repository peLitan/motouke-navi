// src/taicho.mjs の単体テスト(値はすべて架空)
import test from 'node:test';
import assert from 'node:assert/strict';
import { matchesCondition, judgeWithTables, judgeTaicho } from '../../src/taicho.mjs';

test('matchesCondition: 入力に欄が無ければ当てはまらない', () => {
  assert.equal(matchesCondition({ a: true }, { a: true, b: 1 }), true);
  assert.equal(matchesCondition({ a: true }, { b: 1 }), false);
  assert.equal(matchesCondition({ a: false }, { a: 0 }), false);
});

const tables = {
  sources: [{ id: 's1', law: '架空法', title: '架空法 第1条', url: 'https://example.com/', fetchedAt: '2026-01-01' }],
  quotes: [{ id: 'q1', sourceId: 's1', article: '1', paragraph: 1, item: null, text: 'xxxx' }],
};

test('judgeWithTables: 当てはまる行が無ければ unknown と理由の文', () => {
  const out = judgeWithTables({ x: 1 }, { ...tables, rules: [{ id: 'r1', condition: { x: 2 }, result: { status: 'required' }, basis: [{ quoteId: 'q1' }] }] });
  assert.equal(out.status, 'unknown');
  assert.equal(out.reasons.length, 0);
  assert.ok(out.message);
});

test('judgeWithTables: 行どうしの結果が食い違えば例外にする', () => {
  const rules = [
    { id: 'r1', condition: { x: 1 }, result: { status: 'required' }, basis: [{ quoteId: 'q1' }] },
    { id: 'r2', condition: { x: 1 }, result: { status: 'not_required' }, basis: [{ quoteId: 'q1' }] },
  ];
  assert.throws(() => judgeWithTables({ x: 1 }, { ...tables, rules }), /食い違う/);
});

test('judgeWithTables: 無い抜き書きを指す行は例外にする', () => {
  const rules = [{ id: 'r1', condition: { x: 1 }, result: {}, basis: [{ quoteId: 'nai' }] }];
  assert.throws(() => judgeWithTables({ x: 1 }, { ...tables, rules }), /抜き書きが無い/);
});

test('judgeTaicho(公共): 措置の入力が無ければ、写しの要否は unknown(推測しない)', () => {
  const out = judgeTaicho({ orderer: 'public', direct: true, hasSubcontract: true, subcontractTotal: 1 });
  assert.equal(out.status, 'required');
  assert.equal(out.copyToOrderer, 'unknown');
});

test('judgeTaicho(公共・直接でない・下請あり): 元請けへの通知の理由が付く', () => {
  const out = judgeTaicho({ orderer: 'public', direct: false, hasSubcontract: true, subcontractTotal: 1, ictMeasure: false });
  assert.equal(out.status, 'not_required');
  assert.ok(out.reasons.some((r) => r.ruleId === 'pub-sub-notify'));
});

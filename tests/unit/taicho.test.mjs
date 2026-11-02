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

// ---- F03b: 民間の行と比べ方(値はすべて架空) ----
import { matchesValue } from '../../src/taicho.mjs';

test('matchesValue: gte・lt・in・notIn。数でない値は境目の比べ方に当てはまらない。知らない比べ方は例外', () => {
  assert.equal(matchesValue({ gte: 10 }, 10), true);
  assert.equal(matchesValue({ gte: 10 }, 9), false);
  assert.equal(matchesValue({ lt: 10 }, 9), true);
  assert.equal(matchesValue({ lt: 10 }, 10), false);
  assert.equal(matchesValue({ gte: 10 }, '20'), false);
  assert.equal(matchesValue({ lt: 10 }, NaN), false);
  assert.equal(matchesValue({ in: ['a', 'b'] }, 'b'), true);
  assert.equal(matchesValue({ notIn: ['a'] }, 'a'), false);
  assert.throws(() => matchesValue({ gt: 1 }, 2), /知らない比べ方/);
  assert.throws(() => matchesValue({}, 2), /空/);
});

const priv = { orderer: 'private', direct: true, hasSubcontract: true, workType: 'other', license: 'tokutei' };

test('judgeTaicho(民間): 台帳が要るとき、写しの提出は不要で、金額の根拠(税込み)が付く', () => {
  const out = judgeTaicho({ ...priv, subcontractTotal: 51_000_000 });
  assert.equal(out.status, 'required');
  assert.equal(out.copyToOrderer, 'not_required');
  assert.equal(out.amountBasis.tax, 'included');
  assert.ok(out.amountBasis.basis[0].quote.includes('消費税'));
  assert.ok(out.amountBasis.basis[0].url.includes('mlit.go.jp'));
});

test('judgeTaicho(民間): 金額・許可の種類・工事の種類の入力が無ければ unknown(推測しない)', () => {
  assert.equal(judgeTaicho({ ...priv }).status, 'unknown');
  assert.equal(judgeTaicho({ ...priv, subcontractTotal: 60_000_000, license: undefined }).status, 'unknown');
  assert.equal(judgeTaicho({ ...priv, subcontractTotal: 60_000_000, workType: undefined }).status, 'unknown');
  assert.equal(judgeTaicho({ ...priv, subcontractTotal: '60000000' }).status, 'unknown');
});

test('judgeTaicho(民間): 一般建設業者で境目以上なら needs_check と確かめることの文。建築一式で 5,000万円は境目未満', () => {
  const out = judgeTaicho({ ...priv, license: 'ippan', subcontractTotal: 50_000_000 });
  assert.equal(out.status, 'needs_check');
  assert.match(out.message, /許可の種類/);
  assert.equal(judgeTaicho({ ...priv, license: 'ippan', workType: 'kenchiku-ikkatsu', subcontractTotal: 50_000_000 }).status, 'not_required');
});

test('judgeTaicho(民間): 金額を使わない行だけが当てはまるときは amountBasis を付けない', () => {
  const out = judgeTaicho({ orderer: 'private', direct: false, hasSubcontract: true, subcontractTotal: 1 });
  assert.equal(out.status, 'not_required');
  assert.equal(out.amountBasis, undefined);
});

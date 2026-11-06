// src/bid-check.mjs の単体テスト(値はすべて架空)
import test from 'node:test';
import assert from 'node:assert/strict';
import rulesData from '../../data/rules.json' with { type: 'json' };
import { kanjiYen, licenseThreshold, dedicatedThreshold, bidCheck } from '../../src/bid-check.mjs';

test('kanjiYen: 法令の書き方の金額を読む', () => {
  assert.equal(kanjiYen('五千万円'), 50_000_000);
  assert.equal(kanjiYen('四千五百万円'), 45_000_000);
  assert.equal(kanjiYen('九千万円'), 90_000_000);
  assert.equal(kanjiYen('一億二千万円'), 120_000_000);
  assert.equal(kanjiYen('十万円'), 100_000);
  assert.throws(() => kanjiYen('円'));
  assert.throws(() => kanjiYen('五千五千万円'));
  assert.throws(() => kanjiYen('5000万円'));
});

test('施行令 第2条の原文から読んだ金額は、規則表(F03b)の民間の境目と同じ', () => {
  const t = licenseThreshold();
  const gte = (id) => rulesData.rules.find((r) => r.id === id).condition.subcontractTotal.gte;
  assert.equal(t.other, gte('prv-taicho-create'));
  assert.equal(t.kenchiku, gte('prv-taicho-create-kenchiku'));
});

test('施行令 第27条の金額は建築一式の方が大きい', () => {
  const t = dedicatedThreshold();
  assert.ok(t.kenchiku > t.other);
});

test('入力が足りなければ「確認が要る」にし、推測で決めない', () => {
  const out = bidCheck({ orderer: 'private' });
  const st = Object.fromEntries(out.items.map((i) => [i.key, i.status]));
  assert.equal(st['tokutei-license'], 'needs_check');
  assert.equal(st.engineer, 'needs_check');
  assert.equal(st.dedicated, 'needs_check');
  assert.ok(out.checks.some((c) => c.key === 'dedicated'));
});

test('発注者から直接でなければ、特定建設業の許可の区分にならず主任技術者', () => {
  const out = bidCheck({ orderer: 'private', direct: false, workType: 'other', contractAmount: 10_000_000, hasSubcontract: true, subcontractTotal: 90_000_000, license: 'ippan', engineerQualification: 'shunin' });
  assert.equal(out.items.find((i) => i.key === 'tokutei-license').status, 'not_required');
  assert.equal(out.items.find((i) => i.key === 'engineer').value, 'shunin');
  assert.equal(out.items.find((i) => i.key === 'taicho').status, 'not_required');
});

test('民間で専任の境目以上は「確認が要る」で、施設の種類を確かめる文が付く', () => {
  const t = dedicatedThreshold();
  const d = bidCheck({ orderer: 'private', direct: true, workType: 'other', contractAmount: t.other, hasSubcontract: false, subcontractTotal: 0, license: 'ippan', engineerQualification: 'shunin' }).items.find((i) => i.key === 'dedicated');
  assert.equal(d.status, 'needs_check');
  assert.match(d.note, /第3号/);
  assert.match(d.note, /第2号/);
});

test('下請けの総額が請負代金より大きいときだけ確認が要る点に出す(F77a)。判定の項目は変えない', () => {
  const POINT = 'subcontract-over';
  const base = { orderer: 'public', direct: true, workType: 'other', hasSubcontract: true, license: 'tokutei', engineerQualification: 'kanri' };
  const run = (over) => bidCheck({ ...base, ...over });
  const point = (over) => run(over).checks.find((c) => c.key === POINT);
  const c = point({ contractAmount: 10_000_000, subcontractTotal: 90_000_000 });
  assert.equal(c.label, '下請けの総額');
  assert.equal(c.message, '下請けの総額(90,000,000円)が請負代金の見込み(10,000,000円)より大きくなっています。桁か欄を確かめてください。');
  assert.equal(point({ contractAmount: 300_000_000, subcontractTotal: 60_000_000 }), undefined);
  assert.equal(point({ contractAmount: 60_000_000, subcontractTotal: 60_000_000 }), undefined, '同じ額は大きくない');
  assert.equal(point({ contractAmount: null, subcontractTotal: 90_000_000 }), undefined);
  assert.equal(point({ contractAmount: 10_000_000, subcontractTotal: null }), undefined);
  assert.equal(point({ contractAmount: 10_000_000, subcontractTotal: 0, hasSubcontract: false }), undefined);
  assert.equal(point({ contractAmount: 10_000_000, subcontractTotal: 90_000_000, direct: false }), undefined);
  assert.equal(point({ contractAmount: 10_000_000, subcontractTotal: 90_000_000, direct: null }), undefined);
  // 請負代金が下請けの総額をまたいでも、専任と特例の境目(1億円)の同じ側なら items は同じで、点だけが増える
  const over = run({ contractAmount: 80_000_000, subcontractTotal: 90_000_000 });
  const under = run({ contractAmount: 99_000_000, subcontractTotal: 90_000_000 });
  assert.deepEqual(over.items, under.items);
  assert.equal(over.checks.length, under.checks.length + 1);
});

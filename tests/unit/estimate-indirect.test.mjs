// F42a の単体の試験: 間接工事費の式。運用の PDF に計算の全部の例は無いので、別表の端の率との一致と、手で計算した値で確かめる
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import rates from '../../data/estimate-rates.json' with { type: 'json' };
import { commonTemporary, siteManagement, generalAdminRate, generalAdmin, indirectCosts, round2, KINDS } from '../../src/estimate/indirect.mjs';
import { estimate, NOTICE } from '../../src/estimate/estimate.mjs';

const source = fs.readFileSync(new URL('../../data/estimate-rates-source.txt', import.meta.url), 'utf8').replace(/－/g, '-').replace(/,/g, '');

test('率の表の 46 行は、抜き書きの原文に同じ数の並びがある', () => {
  let n = 0;
  for (const table of [rates.commonTemporary, rates.siteManagement]) {
    for (const [kind, r] of Object.entries(table)) {
      const a = Number.isInteger(r.A) && r.A === 613 ? '613' : r.A.toFixed(1);
      const line = `${r.rateLow.toFixed(2)} ${a} ${r.b.toFixed(4)} ${r.rateHigh.toFixed(2)}`;
      assert.ok(source.includes(line), kind + ': ' + line);
      n++;
    }
  }
  assert.equal(n, 46);
});

test('式の端の値は、別表の固定の率とほぼ同じ(写し違いの検査。差 0.1 ポイント以内)', () => {
  for (const table of [rates.commonTemporary, rates.siteManagement]) {
    for (const [kind, r] of Object.entries(table)) {
      assert.ok(Math.abs(r.A * r.lower ** r.b - r.rateLow) < 0.1, kind + ' 下の端');
      assert.ok(Math.abs(r.A * r.upper ** r.b - r.rateHigh) < 0.1, kind + ' 上の端');
    }
  }
  const g = rates.generalAdmin;
  assert.ok(Math.abs(g.slope * Math.log10(g.lower) + g.intercept - g.rateLow) < 0.01);
  assert.ok(Math.abs(g.slope * Math.log10(g.upper) + g.intercept - g.rateHigh) < 0.01);
});

test('工種区分の一覧は共通仮設費と現場管理費で同じ', () => {
  assert.deepEqual(KINDS, Object.keys(rates.siteManagement));
  assert.equal(KINDS.length, 23);
});

test('共通仮設費: 帯の境目、率の丸め、1,000円未満の切り捨て', () => {
  assert.equal(commonTemporary({ kind: '河川工事', target: 6000000 }).rate, 12.53);
  assert.equal(commonTemporary({ kind: '河川工事', target: 1000000001 }).rate, 4.77);
  // 238.6 × 50,000,000^-0.1888 = 8.3966… → 8.40%(Python で別に計算した値)
  const c = commonTemporary({ kind: '河川工事', target: 50000000 });
  assert.equal(c.rate, 8.4);
  assert.equal(c.amount, 4200000);
  assert.match(c.source, /別表第1 1表\(PDF p\.19\)/);
});

test('共通仮設費: 補正は率の端数処理のあとに掛け、積上げ額は足す', () => {
  const c = commonTemporary({ kind: '河川工事', target: 50000000, regionCoef: 1.2, stacked: 123456 });
  assert.equal(c.rate, 10.08);
  assert.equal(c.rated, 5040000);
  assert.equal(c.amount, 5040000 + 123456);
});

test('現場管理費: 補正値は最高 2%、補正係数のあとに足す', () => {
  const base = siteManagement({ kind: '河川工事', target: 54000000 });
  const s = siteManagement({ kind: '河川工事', target: 54000000, regionCoef: 1.1, addition: 1.5 });
  assert.equal(s.rate, round2(round2(base.baseRate * 1.1) + 1.5));
  assert.throws(() => siteManagement({ kind: '河川工事', target: 54000000, addition: 2.1 }), RangeError);
  assert.equal(siteManagement({ kind: '道路維持工事', target: 2000000 }).rate, 60.33);
});

test('一般管理費等率: 式は常用対数、前払金と契約保証の補正の順', () => {
  // -5.21826 × log10(100,000,000) + 60.08343 = 18.33735 → 18.34
  assert.equal(generalAdminRate({ cost: 100000000 }).rate, 18.34);
  assert.equal(generalAdminRate({ cost: 5000000 }).rate, 25.13);
  assert.equal(generalAdminRate({ cost: 3000000001 }).rate, 10.63);
  assert.equal(generalAdminRate({ cost: 100000000, advancePercent: 10 }).rate, round2(18.34 * 1.04));
  assert.equal(generalAdminRate({ cost: 100000000, advancePercent: 36 }).rate, 18.34);
  assert.equal(generalAdminRate({ cost: 100000000, advancePercent: 10, guarantee: 'case1' }).rate, round2(round2(18.34 * 1.04) + 0.04));
  assert.equal(generalAdminRate({ cost: 100000000, guarantee: 'case2' }).rate, 18.43);
});

test('工事価格は 10,000円単位で、調整は一般管理費等で行う', () => {
  const a = generalAdmin({ cost: 100000000 });
  assert.equal(a.computed, 18340000);
  assert.equal(a.workPrice, 118340000);
  const b = generalAdmin({ cost: 100003000 });
  assert.equal(b.workPrice % 10000, 0);
  assert.equal(b.amount, b.workPrice - 100003000);
});

test('直接工事費から工事価格まで: 手で計算した値と合う', () => {
  const r = indirectCosts({ kind: '河川工事', directCost: 50000000 });
  assert.equal(r.commonTemporary.amount, 4200000);
  assert.equal(r.pure, 54200000);
  const jo = round2(1118.2 * 54200000 ** -0.2052);
  assert.equal(r.siteManagement.rate, jo);
  const site = Math.floor(54200000 * jo / 100 / 1000) * 1000;
  assert.equal(r.siteManagement.amount, site);
  assert.equal(r.cost, 54200000 + site);
  const gp = round2(-5.21826 * Math.log10(r.cost) + 60.08343);
  assert.equal(r.workPrice, Math.floor((r.cost + r.cost * gp / 100) / 10000) * 10000);
  assert.ok(r.assumptions.some((a) => a.includes('前払金')));
});

test('支給品は共通仮設費と現場管理費の対象に入り、工事原価には入らない', () => {
  const r = indirectCosts({ kind: '河川工事', directCost: 50000000, supplied: 5000000 });
  assert.equal(r.target, 55000000);
  assert.equal(r.pure, 50000000 + r.commonTemporary.amount);
  assert.equal(r.cost, r.pure + r.siteManagement.amount);
  assert.equal(r.siteManagement.amount, Math.floor((r.pure + 5000000) * r.siteManagement.rate / 100 / 1000) * 1000);
});

test('処分費等が 3% を超えるときは、調整していないことを知らせる', () => {
  assert.equal(indirectCosts({ kind: '河川工事', directCost: 50000000, disposal: 1000000 }).warnings.length, 0);
  assert.match(indirectCosts({ kind: '河川工事', directCost: 50000000, disposal: 2000000 }).warnings[0], /調整は入っていません/);
});

test('表に無い工種・範囲の外の値は計算しない', () => {
  assert.throws(() => commonTemporary({ kind: '架空の工事', target: 1 }), RangeError);
  assert.throws(() => indirectCosts({ kind: '河川工事', directCost: -1 }), RangeError);
  assert.throws(() => commonTemporary({ kind: '河川工事', target: NaN }), RangeError);
});

test('人が直接工事費を入れた場合も工事価格まで出る。言い切りの語を使わない', () => {
  const e = estimate({ directCost: 50000000, kind: '河川工事' });
  assert.equal(e.label, '参考の額');
  assert.equal(e.direct, null);
  assert.equal(e.workPrice, indirectCosts({ kind: '河川工事', directCost: 50000000 }).workPrice);
  assert.match(NOTICE, /会社の原価/);
  assert.doesNotMatch(JSON.stringify(e), /予定価格|この額で入札/);
  assert.throws(() => estimate({ kind: '河川工事' }), RangeError);
});

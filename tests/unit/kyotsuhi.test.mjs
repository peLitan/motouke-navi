// 建築系の共通費(F44e)。式は手計算の値(別の道具で計算して書いた)と比べる。係数は原文から機械で読む
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { kyotsuhiCosts, generalAdminRate, isKyotsuhiKind } from '../../src/estimate/kyotsuhi.mjs';
import { buildRates, checkKyotsuhi, parseRateTables, parseGeneralAdmin } from '../../scripts/kyotsuhi-tables.mjs';
import { checkEstimate, renderMarkdown, summaryLine, exitCodeOf } from '../../plugin/skills/estimate/scripts/check-estimate.mjs';
import { kindSource, kindSourceText } from '../../src/work-kind-tables.mjs';

const text = fs.readFileSync('data/sources/mlit-kyotsuhi-r8.txt', 'utf8');
const data = JSON.parse(fs.readFileSync('data/kyotsuhi-rates.json', 'utf8'));

test('新営の建築: 直接工事費1億円・工期10か月', () => {
  const r = kyotsuhiCosts({ workKind: 'kenchiku', directCost: 100000000, months: 10 });
  assert.equal(r.work, '新営建築工事');
  assert.equal(r.commonTemporary.rate, 4.66);
  assert.equal(r.commonTemporary.amount, 4660000);
  assert.equal(r.pure, 104660000);
  assert.equal(r.siteManagement.rate, 14.09);
  assert.equal(r.siteManagement.amount, 14746594);
  assert.equal(r.cost, 119406594);
  assert.equal(r.generalAdmin.rate, 14.37);
  assert.equal(r.generalAdmin.amount, 17158727);
  assert.equal(r.workPrice, 136565321);
  assert.deepEqual(r.separate, []);
});

test('工種と新営・改修で別表が切り替わる', () => {
  const at = (workKind, workClass) => kyotsuhiCosts({ workKind, workClass, directCost: 50000000, months: 6 });
  assert.equal(at('denki', 'shinei').commonTemporary.table, '別表－3');
  assert.equal(at('denki', 'kaishu').siteManagement.table, '別表－11');
  assert.equal(at('kan', 'shinei').commonTemporary.table, '別表－5');
  assert.equal(at('kan', 'kaishu').siteManagement.table, '別表－13');
  assert.equal(at('kenchiku', 'kaishu').commonTemporary.table, '別表－2');
  assert.equal(at('kan', 'shinei').work, '新営機械設備工事');
});

test('工期が長いほど率が上がる(T の項がある)', () => {
  const rate = (months) => kyotsuhiCosts({ workKind: 'kenchiku', directCost: 100000000, months }).commonTemporary.rate;
  assert.ok(rate(20) > rate(10));
});

test('範囲の境目。ちょうど端は率を出し、外は別途で先の段も出さない', () => {
  const low = (directCost) => kyotsuhiCosts({ workKind: 'kenchiku', directCost, months: 6 });
  assert.equal(low(10000000).commonTemporary.separate, false);
  const r = low(9999000);
  assert.equal(r.commonTemporary.rate, null);
  assert.equal(r.commonTemporary.amount, null);
  assert.equal(r.siteManagement.amount, null);
  assert.equal(r.generalAdmin.amount, null);
  assert.equal(r.workPrice, null);
  assert.equal(r.separate.length, 3);
  assert.match(r.separate[0], /範囲/);
});

test('純工事費だけが範囲を外れると、共通仮設費は出て現場管理費から別途', () => {
  const r = kyotsuhiCosts({ workKind: 'kenchiku', directCost: 4900000000, months: 60 });
  assert.equal(r.commonTemporary.separate, false);
  assert.equal(r.siteManagement.separate, true);
  assert.equal(r.workPrice, null);
});

test('別表ごとの上限が違う。電気は 1,000,000 千円まで', () => {
  const c = { directCost: 2000000000, months: 12 };
  assert.equal(kyotsuhiCosts({ workKind: 'denki', ...c }).commonTemporary.separate, true);
  assert.equal(kyotsuhiCosts({ workKind: 'kenchiku', ...c }).commonTemporary.separate, false);
});

test('処分費は率の計算から除くが、純工事費には残る', () => {
  const r = kyotsuhiCosts({ workKind: 'kenchiku', directCost: 110000000, disposal: 10000000, months: 10 });
  assert.equal(r.commonTemporary.value, 100000);
  assert.equal(r.commonTemporary.rate, 4.66);
  assert.equal(r.commonTemporary.amount, 4660000);
  assert.equal(r.pure, 114660000);
  assert.equal(r.siteManagement.value, 104660);
  assert.equal(r.siteManagement.amount, Math.floor(104660000 * r.siteManagement.rate / 100 + 1e-7));
});

test('積み上げの額は率の分に足す', () => {
  const r = kyotsuhiCosts({ workKind: 'kenchiku', directCost: 100000000, months: 10, stacked: 1000000 });
  assert.equal(r.commonTemporary.amount, 5660000);
  assert.equal(r.pure, 105660000);
});

test('一般管理費等率は別表－15 の両端と式', () => {
  assert.equal(generalAdminRate(3000000), 20.11);
  assert.equal(generalAdminRate(3000001), 20.11); // 式でも 3,000 千円のあたりは 20.11
  assert.equal(generalAdminRate(3000000000), 9.34);
  assert.equal(generalAdminRate(3000000001), 9.34);
  assert.equal(generalAdminRate(100000000), 14.64); // 32.597 − 3.591 × log10(100000) = 14.642
});

test('入れた値の間違いは計算しない', () => {
  const base = { workKind: 'kenchiku', directCost: 100000000, months: 10 };
  assert.throws(() => kyotsuhiCosts({ ...base, months: 0 }), /工期/);
  assert.throws(() => kyotsuhiCosts({ ...base, months: undefined }), /工期/);
  assert.throws(() => kyotsuhiCosts({ ...base, directCost: -1 }), /直接工事費/);
  assert.throws(() => kyotsuhiCosts({ ...base, workClass: 'x' }), /workClass/);
  assert.throws(() => kyotsuhiCosts({ ...base, disposal: 100000000 }), /処分費/);
  assert.throws(() => kyotsuhiCosts({ ...base, workKind: 'doboku' }), /工種/);
  assert.throws(() => kyotsuhiCosts({ ...base, workKind: 'tsushin' }), /工種/);
});

test('前提に原文の文と頁が出る', () => {
  const r = kyotsuhiCosts({ workKind: 'kenchiku', directCost: 100000000, months: 10 });
  assert.ok(r.assumptions.some((a) => a.includes('一般的な市街地') && a.includes('PDF p.7')));
  assert.ok(r.assumptions.some((a) => a.includes('単独発注')));
  assert.ok(r.assumptions.some((a) => a.includes('端数')));
});

test('係数を手で書かない: 表は原文から読んだものと全部同じで、計算の部品に係数が無い', () => {
  assert.deepEqual(checkKyotsuhi(data, text), []);
  assert.deepEqual({ tables: data.tables, generalAdmin: data.generalAdmin, notes: data.notes }, buildRates(text));
  const src = fs.readFileSync('src/estimate/kyotsuhi.mjs', 'utf8');
  for (const t of data.tables) for (const v of [t.a, t.b]) assert.ok(!src.includes(String(v)), '係数がコードにある: ' + v);
  for (const v of [data.generalAdmin.a, data.generalAdmin.b, data.generalAdmin.rateLow, data.generalAdmin.rateHigh]) assert.ok(!src.includes(String(v)));
});

test('読み取りは原文の値に従う。原文を変えると値が変わり、点検が落ちる', () => {
  const changed = text.replace('3.346 - 0.282', '3.999 - 0.282');
  assert.equal(parseRateTables(changed)[0].a, 3.999);
  assert.deepEqual(checkKyotsuhi(data, changed), ['別表-1: 原文から読んだ値と違う']);
  assert.equal(parseGeneralAdmin(text.replace('９．３４％', '８．００％')).rateHigh, 8);
  assert.ok(checkKyotsuhi(data, text.replace('なお、契約保証費については、必要に応じて別途加算する。', ''))[0].includes('前提の文'));
  assert.throws(() => parseRateTables(text.replace('10,000（千円） ≦ Ｐ ≦ 5,000,000（千円）', '')), /別表-1 /);
});

test('読み取りの値は人が原文で読んだ値と同じ(抜き取り)', () => {
  const t = (no) => data.tables[no - 1];
  assert.deepEqual([t(1).a, t(1).b, t(1).c, t(1).min, t(1).max], [3.346, 0.282, 0.625, 10000, 5000000]);
  assert.deepEqual([t(8).a, t(8).b, t(8).c, t(8).min, t(8).max], [5.899, 0.447, 0.831, 10000, 5000000]);
  assert.deepEqual([t(13).a, t(13).b, t(13).c, t(13).page], [6.221, 0.461, 0.8, 10]);
  assert.equal(t(7).c, null); // 昇降機は工期の項が無い
  const g = data.generalAdmin;
  assert.deepEqual([g.lower, g.upper, g.rateLow, g.rateHigh, g.a, g.b], [3000, 3000000, 20.11, 9.34, 32.597, 3.591]);
});

test('Skill: 建築は単価表なしで額を出し、行は積まない', () => {
  const input = { source: { title: '架空の庁舎新営工事' }, conditions: { workKind: 'kenchiku', directCost: 100000000, months: 10 }, lines: [{ name: '掘削', quantity: 1, unit: 'm3', quote: '掘削 1 m3' }] };
  const r = checkEstimate(input, [], null);
  assert.equal(r.amount, 136565321);
  assert.equal(r.notIncluded.length, 1);
  assert.match(r.notIncluded[0].reason, /土木の表/);
  assert.equal(exitCodeOf(r), 1);
  const md = renderMarkdown(r);
  for (const w of ['参考の額', '136,565,321円', '別表－1 ', '別表－8 ', '別表－15', '工期は 10 か月', '公共建築工事共通費積算基準', 'https://www.mlit.go.jp/gobuild/content/001733141.pdf', '取得日 2026-11-06', r.notice]) assert.ok(md.includes(w), w);
  assert.ok(!/予定価格|この額で入札/.test(md));
  assert.match(summaryLine(r), /工期 10 か月/);
});

test('Skill: 範囲の外は「別途」と出し、額を出さない', () => {
  const r = checkEstimate({ conditions: { workKind: 'denki', directCost: 5000000, months: 3 } }, [], null);
  assert.equal(r.amount, null);
  const md = renderMarkdown(r);
  assert.match(md, /\| 共通仮設費 \| 別途 \|/);
  assert.ok(md.includes('| 参考の額(工事価格・税抜き) | 別途 |'));
  assert.match(md, /10,000〜1,000,000千円/);
  assert.match(summaryLine(r), /別途/);
});

test('Skill: 直接工事費か工期が無いと止まる。電気通信などは今までどおり額を出さない', () => {
  assert.throws(() => checkEstimate({ conditions: { workKind: 'kenchiku', directCost: 1000 } }, [], null), /months/);
  assert.throws(() => checkEstimate({ conditions: { workKind: 'kan', months: 3 } }, [], null), /directCost/);
  const r = checkEstimate({ conditions: { workKind: 'tsushin', directCost: 100000000, months: 10 } }, [], null);
  assert.equal(r.amount, null);
  assert.ok(!r.kyotsuhi);
});

test('工種の表と出典の切り替え。土木の基準は土木のまま', () => {
  for (const k of ['kenchiku', 'denki', 'kan']) {
    assert.equal(isKyotsuhiKind(k), true);
    assert.ok(kindSource(k, 'estimate').title.includes('公共建築工事共通費積算基準'));
    assert.match(kindSourceText(k, 'estimate'), /共通費の率の表の出典/);
  }
  assert.equal(isKyotsuhiKind('doboku'), false);
  assert.ok(kindSource('doboku', 'estimate').title.includes('土木工事工事費積算要領'));
  assert.equal(kindSource('tsushin', 'estimate'), null);
});

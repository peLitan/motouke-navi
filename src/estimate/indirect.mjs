// 間接工事費と一般管理費等の計算(F42a)。国土交通省「土木工事工事費積算要領及び基準の運用」の式どおり
// AI も通信も使わない。率と頁は data/estimate-rates.json。頁は PDF の頁
import rates from '../../data/estimate-rates.json' with { type: 'json' };

const near = (v) => v + 1e-7; // 小数の計算のわずかな誤差で端数の処理がずれないようにする
export const round2 = (v) => Math.round(near(v) * 100) / 100;
const floorTo = (v, unit) => Math.floor(near(v) / unit) * unit;

export const KINDS = Object.keys(rates.commonTemporary);

function bandRate(row, amount) {
  if (amount <= row.lower) return { rate: row.rateLow, how: `${row.lower.toLocaleString('ja-JP')}円以下の率` };
  if (amount > row.upper) return { rate: row.rateHigh, how: `${row.upper.toLocaleString('ja-JP')}円を超える額の率` };
  return { rate: round2(row.A * amount ** row.b), how: `A・P^b(A=${row.A}, b=${row.b})` };
}

function rowOf(table, kind) {
  const row = table[kind];
  if (!row) throw new RangeError('工種区分が表にありません: ' + kind);
  return row;
}

function needNumber(name, v, { min = 0, max = Infinity } = {}) {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) throw new RangeError(`${name}の値が範囲の外です: ${v}`);
  return v;
}

// 共通仮設費 = 対象額 P × Kr(補正後)+ 積上げ額。率の分は 1,000円未満を切り捨てる(PDF p.9、p.18〜20)
export function commonTemporary({ kind, target, regionCoef = 1, stacked = 0 }) {
  needNumber('対象額', target);
  needNumber('補正係数', regionCoef, { min: 1 });
  needNumber('積上げ額', stacked);
  const row = rowOf(rates.commonTemporary, kind);
  const base = bandRate(row, target);
  const rate = regionCoef === 1 ? base.rate : round2(base.rate * regionCoef);
  const rated = floorTo(target * rate / 100, 1000);
  return { rate, baseRate: base.rate, how: base.how, regionCoef, rated, stacked, amount: rated + stacked, source: `別表第1 ${row.table.slice(2)}表(PDF p.${row.pdfPage})` };
}

// 現場管理費 = 対象純工事費 ×(Jo × 補正係数 + 補正値)。1,000円未満を切り捨てる(PDF p.9、p.38〜44)
export function siteManagement({ kind, target, regionCoef = 1, addition = 0 }) {
  needNumber('対象純工事費', target);
  needNumber('補正係数', regionCoef, { min: 1 });
  needNumber('補正値', addition, { max: 2 }); // 「２％の範囲内」(PDF p.38)
  const row = rowOf(rates.siteManagement, kind);
  const base = bandRate(row, target);
  const scaled = regionCoef === 1 ? base.rate : round2(base.rate * regionCoef);
  const rate = round2(scaled + addition);
  return { rate, baseRate: base.rate, how: base.how, regionCoef, addition, amount: floorTo(target * rate / 100, 1000), source: `別表第2 ${row.table.slice(2)}表(PDF p.${row.pdfPage})` };
}

// 一般管理費等率: 別表第3 → 前払金の補正(別表第4)→ 契約保証の補正(別表第5)(PDF p.47)
export function generalAdminRate({ cost, advancePercent = null, guarantee = 'case3' }) {
  needNumber('工事原価', cost);
  const g = rates.generalAdmin;
  let base;
  if (cost <= g.lower) base = g.rateLow;
  else if (cost > g.upper) base = g.rateHigh;
  else base = round2(g.slope * Math.log10(cost) + g.intercept);
  let rate = base;
  if (advancePercent !== null) {
    needNumber('前払金支出割合', advancePercent, { max: 100 });
    const band = rates.advancePayment.find((b) => advancePercent <= b.max);
    if (band) rate = round2(rate * band.coef);
  }
  if (!(guarantee in rates.guarantee)) throw new RangeError('契約保証の区分がありません: ' + guarantee);
  return { baseRate: base, rate: round2(rate + rates.guarantee[guarantee]), advancePercent, guarantee };
}

// 工事原価 → 一般管理費等 → 工事価格。工事価格は 10,000円単位で、調整は一般管理費等で行う(PDF p.9、p.47)
export function generalAdmin(input) {
  const { cost } = input;
  const r = generalAdminRate(input);
  const computed = cost * r.rate / 100;
  const workPrice = floorTo(cost + computed, 10000);
  return { ...r, computed, amount: workPrice - cost, workPrice, source: `別表第3〜第5(PDF p.47)` };
}

// 直接工事費から工事価格までを順に出す。1段ごとに式と頁を返す
export function indirectCosts({
  kind, directCost, supplied = 0, lossPrevention = 0, disposal = 0, stacked = 0,
  regionCoef = {}, addition = 0, advancePercent = null, guarantee = 'case3',
}) {
  needNumber('直接工事費', directCost);
  needNumber('支給品費等', supplied);
  needNumber('事業損失防止施設費', lossPrevention);
  needNumber('処分費等', disposal);
  const target = directCost + supplied + lossPrevention;
  const warnings = [];
  // 3%・3千万円を超えるときの調整は、対象額の取り方を人が決めるので計算に入れない(PDF p.13)
  if (disposal > target * 0.03 || disposal > 30000000) {
    warnings.push('処分費等が対象額の3%または3千万円を超えています。率の計算の対象を減らす調整は入っていません(PDF p.13)。この額は大きめに出ます');
  }
  const common = commonTemporary({ kind, target, regionCoef: regionCoef.commonTemporary ?? 1, stacked });
  const pure = directCost + common.amount;
  const site = siteManagement({ kind, target: pure + supplied, regionCoef: regionCoef.siteManagement ?? 1, addition });
  const cost = pure + site.amount;
  const admin = generalAdmin({ cost, advancePercent, guarantee });
  const assumptions = [];
  if (!regionCoef.commonTemporary) assumptions.push('共通仮設費の地域の補正係数は 1 で計算しました。当てはまる地域なら PDF p.17〜18 の表から選んで入れてください');
  if (!regionCoef.siteManagement) assumptions.push('現場管理費の地域の補正係数は 1 で計算しました。当てはまる地域なら PDF p.39〜40 の表から選んで入れてください');
  if (!stacked) assumptions.push('共通仮設費の積上げ額は 0 です。積み上げる費用があれば入れてください');
  if (advancePercent === null) assumptions.push('前払金支出割合は 35% を超え 40% 以下として計算しました(PDF p.47)');
  if (guarantee === 'case3') assumptions.push('契約保証の補正は入れていません(PDF p.47 のケース3)');
  return {
    kind, directCost, target,
    commonTemporary: common, pure,
    siteManagement: site, cost,
    generalAdmin: admin, workPrice: admin.workPrice,
    warnings, assumptions,
    source: rates.source,
  };
}

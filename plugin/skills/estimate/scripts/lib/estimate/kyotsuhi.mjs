// 建築系の共通費の計算(F44e)。公共建築工事共通費積算基準(令和8年改定)の別表の式どおり。土木の indirect.mjs とは別の基準なので分ける
// AI も通信も使わない。係数・範囲・頁は data/kyotsuhi-rates.json(scripts/fetch-kyotsuhi.mjs が原文から機械で読む)
import rates from '../../data/kyotsuhi-rates.json' with { type: 'json' };
import { round2 } from './indirect.mjs';

// 工種の id → 別表の工事の名前。電気工事は電気設備工事、管工事は機械設備工事(段取りの表と同じ当て方)
const WORKS = { kenchiku: '建築', denki: '電気設備', kan: '機械設備' };
export const WORK_CLASSES = { shinei: '新営', kaishu: '改修' };
export const isKyotsuhiKind = (id) => Object.hasOwn(WORKS, id);
export const SEPARATE = '別途';

const needPositive = (name, v) => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) throw new RangeError(`${name}は 0 より大きい数で入れてください: ${v}`);
  return v;
};
const yen = (v) => Math.floor(v + 1e-7); // 金額の端数は基準に定めが無いので1円未満だけ切り捨てる
const thousand = (v) => v.toLocaleString('ja-JP', { maximumFractionDigits: 3 });

// 率の1段。範囲の外は率を出さず「別途」
function rateStep(name, work, amount, months) {
  const t = rates.tables.find((x) => x.name === name && x.work === work);
  const x = amount / 1000;
  const shown = { table: `別表－${t.no}`, work, formula: t.quote, variable: t.variable, value: x, months, source: `別表－${t.no} ${t.name}(${t.work}。PDF p.${t.page})` };
  if (x < t.min || x > t.max) {
    return { ...shown, rate: null, amount: null, separate: true, reason: `${t.variable} が ${thousand(x)}千円で、率の範囲(${thousand(t.min)}〜${thousand(t.max)}千円)の外です。基準は別途定めることができるとしています` };
  }
  const rate = round2(Math.exp(t.a - t.b * Math.log(x) + t.c * Math.log(months)));
  return { ...shown, rate, amount: yen(amount * rate / 100), separate: false };
}

const blocked = (source, reason) => ({ source, rate: null, amount: null, separate: true, reason });

// 別表－15。Cp は工事原価(千円)。範囲の外は両端の率で、「別途」にはならない
export function generalAdminRate(cost) {
  const g = rates.generalAdmin;
  const cp = cost / 1000;
  if (cp <= g.lower) return g.rateLow;
  if (cp > g.upper) return g.rateHigh;
  return round2(g.a - g.b * Math.log10(cp));
}

// 直接工事費と工期から工事価格までを順に出す。どこかが「別途」なら、その先の段も出さない
export function kyotsuhiCosts({ workKind, directCost, months, workClass = 'shinei', disposal = 0, stacked = 0 }) {
  if (!isKyotsuhiKind(workKind)) throw new RangeError('共通費の基準が当たらない工種です: ' + workKind);
  if (!Object.hasOwn(WORK_CLASSES, workClass)) throw new RangeError('workClass は shinei か kaishu です: ' + workClass);
  needPositive('直接工事費', directCost);
  needPositive('工期(か月)', months);
  if (typeof disposal !== 'number' || !(disposal >= 0) || disposal >= directCost) throw new RangeError('処分費は 0 以上で、直接工事費より小さい数にしてください: ' + disposal);
  if (typeof stacked !== 'number' || !(stacked >= 0)) throw new RangeError('積み上げの額は 0 以上の数にしてください: ' + stacked);
  const work = WORK_CLASSES[workClass] + WORKS[workKind] + '工事';
  const common = rateStep('共通仮設費率', work, directCost - disposal, months);
  if (!common.separate) common.amount += stacked;
  const pure = common.separate ? null : directCost + common.amount;
  const site = pure === null
    ? blocked('別表－8〜14', '共通仮設費が別途なので、純工事費が決まりません')
    : rateStep('現場管理費率', work, pure - disposal, months);
  const cost = site.separate ? null : pure + site.amount;
  const adminSource = `別表－15 一般管理費等率(PDF p.${rates.generalAdmin.page})`;
  let admin;
  if (cost === null) admin = blocked(adminSource, '工事原価が決まらないので、率を出せません');
  else {
    const rate = generalAdminRate(cost);
    admin = { source: adminSource, formula: rates.generalAdmin.quote, rate, amount: yen(cost * rate / 100), separate: false };
  }
  const assumptions = [
    `工期は ${months} か月、工事の区分は${WORK_CLASSES[workClass]}で計算しました。人が確かめてください`,
    '金額の端数の処理は基準に定めが無いので、1円未満だけ切り捨てました。発注者の端数の処理で額は変わります',
    '純工事費は直接工事費+共通仮設費、工事原価は純工事費+現場管理費としました。基準にこの定義の文は無く、この道具の読みです',
    '処分費は直接工事費に含まれているものとし、率の式だけでなく率を掛ける額からも除きました。基準の「比率」の文からの読みです',
    ...rates.notes.map((n) => `${n.say}(PDF p.${n.page}「${n.quote}」)`),
  ];
  if (!stacked) assumptions.unshift('共通仮設費率に含まれない内容の積み上げ額は 0 です。積み上げる費用があれば入れてください');
  return {
    workKind, work, directCost, months, disposal, stacked,
    commonTemporary: common, pure, siteManagement: site, cost, generalAdmin: admin,
    workPrice: cost === null ? null : cost + admin.amount,
    separate: [common, site, admin].filter((s) => s.separate).map((s) => s.reason),
    assumptions, source: rates.meta,
  };
}

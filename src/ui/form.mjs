// 画面の入力欄の値を、判定(src/bid-check.mjs・src/taicho.mjs)の入力の形にする(F05a)
// DOM には触らない。画面からは欄の id をキーにした値の入れ物を渡す(チェックの欄は true / false)。

// 全角の数字・桁区切り・空白・「円」を許して、0 以上の整数の円にする。
// 返り値: { value: 数 | null, error: 文 | null }。空なら value は null で error も null(入力が無い)
export function parseYen(raw) {
  const s = String(raw ?? '')
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[，,、\s　]/g, '')
    .replace(/円$/, '');
  if (s === '') return { value: null, error: null };
  if (!/^\d+$/.test(s)) return { value: null, error: '金額は数字で入れてください(桁区切りは使えます。小数・負の数・「万」などの単位は使えません): ' + String(raw) };
  const n = Number(s);
  if (!Number.isSafeInteger(n)) return { value: null, error: '金額が大きすぎます: ' + String(raw) };
  return { value: n, error: null };
}

const CHOICES = {
  orderer: ['public', 'private'],
  'work-type': ['kenchiku-ikkatsu', 'other'],
  license: ['tokutei', 'ippan'],
  'engineer-qualification': ['kanri', 'shunin'],
};
// 選ぶ欄: 決めた値のどれかなら、その値。未選択・「分からない」(unknown。F14f)・知らない値は null(判定の側で「入力が足りない」になる)
const choice = (key, v) => (CHOICES[key].includes(v) ? v : null);
const flag = (v) => v === true || v === 'true' || v === 'on';
// 元請けか下請けか(F15b・反証の指摘4): 画面は「選んでいない/元請け/下請け」の3択(ラジオ)。
// 欄 direct(元請け)に印があれば true、欄 direct-sub(下請け)に印があれば false、どちらも無ければ null(判断できない)。
// 印が無いことを「下請け」と読まない
export function readDirect(values = {}) {
  if (flag(values.direct)) return true;
  if (flag(values['direct-sub'])) return false;
  return null;
}

// 欄の値の入れ物 → 判定の入力。下請けの総額が 0 なら下請契約は無い、空なら有無は分からない(null)
export function readBidForm(values = {}) {
  // 金額の欄の「分からない」(F14f)に印があれば、欄の値は使わない(null。判定の側で「確認が要る」になる)
  const contract = flag(values['contract-amount-unknown']) ? { value: null } : parseYen(values['contract-amount']);
  const sub = flag(values['subcontract-total-unknown']) ? { value: null } : parseYen(values['subcontract-total']);
  return {
    orderer: choice('orderer', values.orderer),
    direct: readDirect(values),
    workType: choice('work-type', values['work-type']),
    contractAmount: contract.value,
    hasSubcontract: sub.value === null ? null : sub.value > 0,
    subcontractTotal: sub.value,
    license: choice('license', values.license),
    engineerQualification: choice('engineer-qualification', values['engineer-qualification']),
    ictMeasure: flag(values['ict-measure']),
  };
}

// 金額の欄の読めない値の一覧(画面に出す)
export function formErrors(values = {}) {
  const out = [];
  for (const [key, name] of [['contract-amount', '請負代金の見込み'], ['subcontract-total', '下請けの総額']]) {
    if (flag(values[key + '-unknown'])) continue;
    const r = parseYen(values[key]);
    if (r.error) out.push(name + ': ' + r.error);
  }
  return out;
}

export const BID_FORM_IDS = ['orderer', 'direct-unset', 'direct', 'direct-sub', 'direct-unknown', 'work-type', 'contract-amount', 'contract-amount-unknown', 'subcontract-total', 'subcontract-total-unknown', 'license', 'engineer-qualification', 'ict-measure'];
export const CHECKBOX_IDS = ['direct-unset', 'direct', 'direct-sub', 'direct-unknown', 'contract-amount-unknown', 'subcontract-total-unknown', 'ict-measure'];

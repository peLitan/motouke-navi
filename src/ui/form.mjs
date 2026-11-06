// 画面の入力欄の値を、判定(src/bid-check.mjs・src/taicho.mjs)の入力の形にする(F05a)
// DOM には触らない。画面からは欄の id をキーにした値の入れ物を渡す(チェックの欄は true / false)。
import { DEFAULT_WORK_KIND, isWorkKind } from '../work-kinds.mjs';

const TOO_LARGE = '金額が大きすぎます';
const FRACTION = '円にすると1円未満の端数が出ます';
const UNREADABLE = '金額は数字か、億・万・千円・百万円の単位で入れてください(例 134,200,000円・1億3,420万円・134,200千円・134.2百万円。単位を使うときは末尾に「円」を付けます。負の数・「約」は使えません)';
// 単位の桁(10 の何乗か)。千円・百万円は「円」の前に付く形だけを読む(「5千万円」のような漢数字の位は読まない)
const UNIT_EXP = { 億: 8, 万: 4, 千: 3, 百万: 6 };
const DEC = '(\\d+(?:\\.\\d+)?)';
// 「2億円」「1億3420万円」「1億3420万5000円」「12.5万円」。億か万の少なくとも1つ。最後の円の前は整数だけ
const OKU_MAN_RE = new RegExp(`^(?:${DEC}億)?(?:${DEC}万)?(\\d+)?円$`);
// 「134200千円」「134.2百万円」
const SMALL_UNIT_RE = new RegExp(`^${DEC}(千|百万)円$`);

// 「134.2」を 10 の exp 乗した整数(BigInt)。端数が出るなら null。浮動小数の誤差を出さないように字のまま桁をずらす
function shift(num, exp) {
  const [int, frac = ''] = num.split('.');
  if (/[1-9]/.test(frac.slice(exp))) return null;
  return BigInt(int + frac.slice(0, exp).padEnd(exp, '0'));
}
// 単位つきの形を円にする。{ yen: BigInt | null(端数) } か、形が合わなければ null
function unitYen(s) {
  const small = SMALL_UNIT_RE.exec(s);
  if (small) return { yen: shift(small[1], UNIT_EXP[small[2]]) };
  const m = OKU_MAN_RE.exec(s);
  if (!m || (m[1] === undefined && m[2] === undefined)) return null;
  const parts = [shift(m[1] ?? '0', UNIT_EXP.億), shift(m[2] ?? '0', UNIT_EXP.万), BigInt(m[3] ?? '0')];
  return { yen: parts.includes(null) ? null : parts.reduce((a, b) => a + b, 0n) };
}

// 全角の数字・小数点・桁区切り・空白・末尾の「円」を許して、0 以上の整数の円にする。
// 億・万・千円・百万円の単位も読む(F83a7)。単位を使うときは末尾の「円」が要る(「1億」「5千万」は読まない)。
// 小数は単位があり、円にして端数が出ないときだけ読む。負の数・「約」は読まない。
// 返り値: { value: 数 | null, error: 文 | null }。空なら value は null で error も null(入力が無い)
export function parseYen(raw) {
  const { unit, ...r } = readYen(raw);
  return r;
}
// parseYen と同じ読み。unit は単位つきの形で読んだとき true(欄の下に読んだ値を出すため)
function readYen(raw) {
  const s = String(raw ?? '')
    .replace(/[０-９．]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[，,、\s　]/g, '');
  const plain = s.replace(/円$/, '');
  if (plain === '') return { value: null, error: null, unit: false };
  let yen;
  let unit = false;
  if (/^\d+$/.test(plain)) yen = BigInt(plain);
  else {
    const u = unitYen(s);
    if (!u) return { value: null, error: UNREADABLE + ': ' + String(raw), unit: false };
    if (u.yen === null) return { value: null, error: FRACTION + ': ' + String(raw), unit: false };
    yen = u.yen;
    unit = true;
  }
  if (yen > BigInt(Number.MAX_SAFE_INTEGER)) return { value: null, error: TOO_LARGE + ': ' + String(raw), unit: false };
  return { value: Number(yen), error: null, unit };
}

// 円の数を桁区切りの文にする(端末の言語の設定に頼らない)
const yenText = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '円';
// 単位つきで読めたとき欄の下に出す文(F83a7)。千円を円と取り違えると額が1000倍ずれるので、読んだ値を見せる。
// 数字だけの値・読めない値・空では ''
export function amountReadNote(raw) {
  const r = readYen(raw);
  return r.unit ? yenText(r.value) + ' として読みました' : '';
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

// 工種の欄(F44a)。欄が無い・知らない値は既定の土木
export const readWorkKind = (values = {}) => (isWorkKind(values['work-kind']) ? values['work-kind'] : DEFAULT_WORK_KIND);

// 欄の値の入れ物 → 判定の入力。下請けの総額が 0 なら下請契約は無い、空なら有無は分からない(null)
export function readBidForm(values = {}) {
  const participation = String(values['participation-conditions'] ?? '').trim();
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
    ...(participation ? { participationConditions: participation } : {}),
  };
}

const AMOUNT_FIELDS = [['contract-amount', '請負代金の見込み'], ['subcontract-total', '下請けの総額']];
const amountError = (values, key) => (flag(values[key + '-unknown']) ? null : parseYen(values[key]).error);
// 金額の欄の読めない値の一覧(画面に出す)
export function formErrors(values = {}) {
  const out = [];
  for (const [key, name] of AMOUNT_FIELDS) {
    const error = amountError(values, key);
    if (error) out.push(name + ': ' + error);
  }
  return out;
}
// 金額の欄ごとの読めるかどうか(aria-invalid を付ける欄を決める)。[欄の id, 読めないなら true] の列
export function amountValidity(values = {}) {
  return AMOUNT_FIELDS.map(([key]) => [key, Boolean(amountError(values, key))]);
}

// 読めない金額の欄の下に出す文(F59)。大きすぎる値・端数が出る値には、それぞれの理由を言う
export function amountFieldError(raw) {
  const error = parseYen(raw).error ?? '';
  if (error.startsWith(TOO_LARGE)) return TOO_LARGE + '。桁を確かめてください(例 200,000,000)';
  if (error.startsWith(FRACTION)) return FRACTION + '。桁を確かめてください(例 1.5億円)';
  return '読めない値です。数字か、末尾に「円」を付けた億・万・千円・百万円で入れてください(例 200,000,000 や 2億円)';
}

export const BID_FORM_IDS = ['orderer', 'direct-unset', 'direct', 'direct-sub', 'direct-unknown', 'work-type', 'work-kind', 'contract-amount', 'contract-amount-unknown', 'subcontract-total', 'subcontract-total-unknown', 'license', 'engineer-qualification', 'ict-measure', 'participation-conditions'];
export const CHECKBOX_IDS = ['direct-unset', 'direct', 'direct-sub', 'direct-unknown', 'contract-amount-unknown', 'subcontract-total-unknown', 'ict-measure'];

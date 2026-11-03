// 施工体制台帳が要るか・写しを発注者に出すかの判定(F03a: 公共工事の行、F03b: 民間工事の行)
// 判定は規則表(data/rules.json)の行を当てはめるだけで、法令の条件をここに書き込まない。
// 結果の理由には、行の根拠の抜き書き(data/quotes.json)を、法令名・条・項・原文のまま付ける。
import rulesData from '../data/rules.json' with { type: 'json' };
import quotesData from '../data/quotes.json' with { type: 'json' };
import sourcesData from '../data/sources/index.json' with { type: 'json' };
import { sourceVersion } from './source-version.mjs';

// 条件の1つの欄の比べ方。値がそのままなら同じであること。
// 値がオブジェクトなら比べ方の指定: gte(以上)・lt(未満)は数、in(どれか)・notIn(どれでもない)は値の並び。
// 金額の境目などの数は規則表に書き、ここには書かない。知らない比べ方は例外にする(規則表の誤りを黙って通さない)
const OPS = {
  gte: (x, v) => typeof x === 'number' && Number.isFinite(x) && x >= v,
  lt: (x, v) => typeof x === 'number' && Number.isFinite(x) && x < v,
  in: (x, v) => Array.isArray(v) && v.includes(x),
  // 未選択(null・undefined)は「どれでもない」に数えない(未選択を「建築一式ではない」と決めない。反証の指摘2)
  notIn: (x, v) => Array.isArray(v) && x !== null && x !== undefined && !v.includes(x),
};
export function matchesValue(spec, x) {
  if (spec !== null && typeof spec === 'object' && !Array.isArray(spec)) {
    const entries = Object.entries(spec);
    if (entries.length === 0) throw new Error('規則表の条件の比べ方が空');
    return entries.every(([op, v]) => {
      if (!OPS[op]) throw new Error('規則表の条件に知らない比べ方: ' + op);
      return OPS[op](x, v);
    });
  }
  return x === spec;
}

// 行の condition の欄がすべて入力に当てはまれば、その行が当てはまる。
// 入力に欄が無い(undefined)か未選択(null)のときは当てはまらない(未入力から言い切らない。反証の指摘2・4)
export function matchesCondition(condition, input) {
  if (!condition || typeof condition !== 'object') return false;
  return Object.entries(condition).every(([k, v]) => input?.[k] !== undefined && input[k] !== null && matchesValue(v, input[k]));
}

// 判定に使う入力の欄の名前(判断できないときに、どの欄が足りないかを出す)
const INPUT_NAMES = {
  orderer: '発注者(公共か民間か)',
  direct: '元請けか下請けか',
  hasSubcontract: '下請けの総額(下請けの有無)',
  subcontractTotal: '下請けの総額',
  workType: '工事の種類',
  license: '元請けの許可の種類',
  ictMeasure: '台帳を発注者が閲覧できる措置',
};
// 規則表の条件に出てくる欄のうち、入力が無い・未選択のもの
export function missingInputs(input, rules) {
  const keys = [...new Set(rules.flatMap((r) => Object.keys(r.condition || {})))];
  return keys.filter((k) => input?.[k] === undefined || input?.[k] === null);
}

// 行の根拠(quoteId の並び)を、法令名・条・項・号・原文の抜き書きにする。見つからない抜き書きは例外にする
export function resolveBasis(rule, quotes, sources) {
  return resolveQuoteIds(rule.basis || [], quotes, sources, '規則表の行 ' + rule.id);
}

// quoteId の並びを、出典つきの抜き書きにする。label は例外の文に使う
export function resolveQuoteIds(list, quotes, sources, label) {
  const qById = new Map(quotes.map((q) => [q.id, q]));
  const sById = new Map(sources.map((s) => [s.id, s]));
  return list.map((b) => {
    const q = qById.get(b.quoteId);
    if (!q) throw new Error(label + ' の抜き書きが無い: ' + b.quoteId);
    const s = sById.get(q.sourceId);
    if (!s) throw new Error('抜き書き ' + q.id + ' の出典が無い: ' + q.sourceId);
    return {
      quoteId: q.id,
      law: s.law ?? s.title,
      article: q.article,
      paragraph: q.paragraph,
      item: q.item,
      quote: q.text,
      title: s.title,
      url: s.url,
      section: q.section ?? s.section,
      page: q.page ?? s.page,
      fetchedAt: s.fetchedAt,
      version: sourceVersion(s),
    };
  });
}

// 規則表を指定して判定する。
// 返り値: { status, copyToOrderer, reasons: [{ ruleId, action, basis, exceptions }], message? }
//   status: required(作る)/ not_required(作らなくてよい)/ needs_check(先に確かめることがある。行の action に書く)/ unknown(規則表に当てはまる行が無い)
//   amountBasis: 入力の金額(subcontractTotal)を判定に使ったときだけ付ける。{ tax: 'included' など, basis }(規則表の amountBasis)
//   copyToOrderer: required / not_required / not_applicable(台帳を作らないので出すものが無い)/ unknown
export function judgeWithTables(input, { rules, quotes, sources, amountBasis }) {
  const matched = rules.filter((r) => matchesCondition(r.condition, input));
  const pick = (key) => {
    const vals = [...new Set(matched.map((r) => r.result?.[key]).filter((v) => v !== undefined))];
    if (vals.length > 1) throw new Error('規則表の行が食い違う(' + key + '): ' + matched.map((r) => r.id).join(', '));
    return vals[0];
  };
  const status = pick('status') ?? 'unknown';
  let copyToOrderer = pick('copyToOrderer');
  if (copyToOrderer === undefined) copyToOrderer = status === 'not_required' ? 'not_applicable' : 'unknown';
  const reasons = matched.map((r) => ({
    ruleId: r.id,
    action: r.action,
    basis: resolveBasis(r, quotes, sources),
    exceptions: r.exceptions || [],
  }));
  const out = { status, copyToOrderer, reasons };
  const usesAmount = matched.some((r) => r.condition && 'subcontractTotal' in r.condition);
  if (usesAmount && amountBasis) {
    out.amountBasis = { tax: amountBasis.tax, note: amountBasis.note, basis: resolveQuoteIds(amountBasis.basis || [], quotes, sources, '規則表の amountBasis') };
  }
  if (status === 'unknown') {
    // 台帳の要否(status)を決める行の条件のうち、入力が無い・未選択の欄を挙げる(写しの措置の欄は台帳の要否に関わらないので除く)
    // 入力済みの欄が行の条件と食い違う行(公共なのに民間の行など)は数えない。未選択の欄が埋まれば当てはまりうる行だけを見る
    const given = (k) => input?.[k] !== undefined && input?.[k] !== null;
    const statusRules = rules.filter((r) => r.result?.status !== undefined
      && Object.entries(r.condition || {}).every(([k, v]) => !given(k) || matchesValue(v, input[k])));
    const missing = missingInputs(input, statusRules);
    out.missing = missing;
    out.message = missing.length
      ? '判断できません。次の欄が未選択・未入力です: ' + missing.map((k) => INPUT_NAMES[k] ?? k).join('、') + '(未入力のまま「作らなくてよい」とは決めません)'
      : '規則表に当てはまる行が無いので判断できません(まだ規則表に無い場合です)';
  }
  else if (status === 'needs_check') out.message = '確かめることがあります: ' + matched.filter((r) => r.result?.status === 'needs_check').map((r) => r.action).join(' / ');
  else if (copyToOrderer === 'unknown') out.message = '写しの提出が要るかは判断できません(措置を講じているかの入力が無い)';
  return out;
}

// 入力: { orderer: 'public'|'private', direct, hasSubcontract, subcontractTotal(円。消費税込み), workType('kenchiku-ikkatsu'|'other'), license('tokutei'|'ippan'), ictMeasure }
export function judgeTaicho(input) {
  return judgeWithTables(input, { rules: rulesData.rules, quotes: quotesData.quotes, sources: sourcesData.sources, amountBasis: rulesData.amountBasis });
}

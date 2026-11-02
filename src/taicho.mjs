// 施工体制台帳が要るか・写しを発注者に出すかの判定(F03a: 公共工事の行)
// 判定は規則表(data/rules.json)の行を当てはめるだけで、法令の条件をここに書き込まない。
// 結果の理由には、行の根拠の抜き書き(data/quotes.json)を、法令名・条・項・原文のまま付ける。
import rulesData from '../data/rules.json' with { type: 'json' };
import quotesData from '../data/quotes.json' with { type: 'json' };
import sourcesData from '../data/sources/index.json' with { type: 'json' };

// 行の condition の欄がすべて入力と同じなら当てはまる。入力に欄が無い(undefined)ときは当てはまらない
export function matchesCondition(condition, input) {
  if (!condition || typeof condition !== 'object') return false;
  return Object.entries(condition).every(([k, v]) => input?.[k] !== undefined && input[k] === v);
}

// 行の根拠(quoteId の並び)を、法令名・条・項・号・原文の抜き書きにする。見つからない抜き書きは例外にする
export function resolveBasis(rule, quotes, sources) {
  const qById = new Map(quotes.map((q) => [q.id, q]));
  const sById = new Map(sources.map((s) => [s.id, s]));
  return (rule.basis || []).map((b) => {
    const q = qById.get(b.quoteId);
    if (!q) throw new Error('規則表の行 ' + rule.id + ' の抜き書きが無い: ' + b.quoteId);
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
      fetchedAt: s.fetchedAt,
    };
  });
}

// 規則表を指定して判定する。
// 返り値: { status, copyToOrderer, reasons: [{ ruleId, action, basis, exceptions }], message? }
//   status: required(作る)/ not_required(作らなくてよい)/ unknown(規則表に当てはまる行が無い)
//   copyToOrderer: required / not_required / not_applicable(台帳を作らないので出すものが無い)/ unknown
export function judgeWithTables(input, { rules, quotes, sources }) {
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
  if (status === 'unknown') out.message = '規則表に当てはまる行が無いので判断できません(入力の欄が足りないか、まだ規則表に無い場合です)';
  else if (copyToOrderer === 'unknown') out.message = '写しの提出が要るかは判断できません(措置を講じているかの入力が無い)';
  return out;
}

// 入力: { orderer: 'public'|'private', direct, hasSubcontract, subcontractTotal, workType, license, ictMeasure }
export function judgeTaicho(input) {
  return judgeWithTables(input, { rules: rulesData.rules, quotes: quotesData.quotes, sources: sourcesData.sources });
}

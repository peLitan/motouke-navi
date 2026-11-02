// 原文の例外・参照の語の検出と、規則の行の「例外・参照」の欄が空のときの警告(F02c)
// 抜き書きに例外の部分が入っていなくても、抜き書きの出典の範囲(項。項が無ければ条の全体)の原文を調べる。
import { stripSpaces, paragraphOf } from './quote-check.mjs';

// 拾う語。「読み替え」は「読み替える」「読み替えて」にも含まれるので、そのまま部分一致で拾える
export const EXCEPTION_WORDS = ['ただし', 'を除き', 'この限りでない', '準用', '読み替え'];

// 語ごとの探し方。読み替えの規定は「読み替え」の語を使わず「「甲」とあるのは「乙」と(する)」と書くことがある
// (入契法 第15条第1項など)ので、「とあるのは」も読み替えとして拾う
const PATTERNS = {
  読み替え: ['読み替え', 'とあるのは'],
};

// 文の中にある例外・参照の語を、EXCEPTION_WORDS の順で重ならずに返す。無ければ空の配列。
// 改行や空白で語が分かれていても拾えるように、空白を取り除いてから探す
export function scanExceptions(text) {
  const t = stripSpaces(text);
  return EXCEPTION_WORDS.filter((w) => (PATTERNS[w] || [w]).some((x) => t.includes(x)));
}

// 抜き書きの出典の範囲の原文。paragraph が整数ならその項(号の抜き書きでも、項のただし書が号にかかるので項の全体)、
// そうでなければ条の全体。原文が無ければ null
export function scopeOfQuote(q, sourceTexts) {
  const text = sourceTexts?.[q?.sourceId];
  if (typeof text !== 'string') return null;
  if (Number.isInteger(q.paragraph)) return paragraphOf(text, q.paragraph) ?? text;
  return text;
}

// 例外・参照の欄が空か。欄が無い・配列でない・空白だけの文字列しか無いときは空とみなす
function isEmptyExceptions(v) {
  if (typeof v === 'string') return v.trim() === '';
  if (!Array.isArray(v)) return true;
  return !v.some((x) => (typeof x === 'string' ? x.trim() !== '' : x != null));
}

// 規則の行ごとに、根拠の抜き書きの出典の範囲に例外・参照の語があるのに exceptions の欄が空なら警告を出す。
// 返り値: [{ ruleId, keywords, quoteIds, message }]
export function findExceptionWarnings(rules, quotes, sourceTexts) {
  const byId = new Map((quotes || []).map((q) => [q.id, q]));
  const warnings = [];
  for (const rule of rules || []) {
    if (!isEmptyExceptions(rule?.exceptions)) continue;
    const keywords = new Set();
    const quoteIds = [];
    for (const b of Array.isArray(rule?.basis) ? rule.basis : []) {
      const q = byId.get(b?.quoteId);
      if (!q) continue;
      const found = scanExceptions(scopeOfQuote(q, sourceTexts) ?? '');
      if (found.length) { quoteIds.push(q.id); found.forEach((w) => keywords.add(w)); }
    }
    if (keywords.size === 0) continue;
    const kw = EXCEPTION_WORDS.filter((w) => keywords.has(w));
    warnings.push({
      ruleId: rule?.id,
      keywords: kw,
      quoteIds,
      message: `根拠の原文に「${kw.join('」「')}」があるのに、例外・参照の欄が空です(抜き書き: ${quoteIds.join(', ')})`,
    });
  }
  return warnings;
}

// 抜き書きと原文の照合(F02b)
// 抜き書きは、取得した原文に一字一句そのまま入っていなければならない。許す違いは空白(半角・全角・改行・タブ)だけ。
// 字体の違い(届と屆など)や全角・半角の違いは許さない(正規化しない)。

// 空白だけを取り除く
export function stripSpaces(s) {
  return String(s ?? '').replace(/[\s　]+/g, '');
}

// 抜き書き quote が原文 text の中に(空白の違いを除いて)そのまま入っているか。空の抜き書きは一致としない
export function verifyQuote(quote, text) {
  const q = stripSpaces(quote);
  if (q.length === 0) return false;
  return stripSpaces(text).includes(q);
}

const toHalfDigits = (x) => x.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));

// 条の原文から第 n 項の文を取り出す。
// 原文のファイル(data/sources/law-*.txt)は、第2項以降を行の頭の項の番号(「２」など)で始める。第1項は条の頭から第2項の前まで。
// 見つからなければ null
export function paragraphOf(text, n) {
  n = Number(n);
  if (!Number.isInteger(n) || n < 1) return null;
  const lines = String(text ?? '').split(/\r?\n/);
  const starts = [0];
  let next = 2;
  lines.forEach((line, i) => {
    const m = toHalfDigits(line).match(/^[\s　]*(\d+)[\s　]/);
    if (m && Number(m[1]) === next) { starts.push(i); next++; }
  });
  if (n > starts.length) return null;
  return lines.slice(starts[n - 1], n < starts.length ? starts[n] : lines.length).join('\n');
}

const KANJI_DIGITS = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
// 1〜99 を号の番号の書き方(一、十、二十三)にする
function itemKanji(n) {
  const tens = Math.floor(n / 10);
  const ones = n % 10;
  return (tens ? (tens === 1 ? '' : KANJI_DIGITS[tens]) + '十' : '') + KANJI_DIGITS[ones];
}

// 項の文から第 n 号の文(号の細分を含む)を取り出す。号は行の頭が「一　」のように漢数字と全角の空白で始まる。
// 見つからなければ null
export function itemOf(paragraph, n) {
  n = Number(n);
  if (!Number.isInteger(n) || n < 1 || n > 99) return null;
  const lines = String(paragraph ?? '').split(/\r?\n/);
  const head = (k) => new RegExp('^' + itemKanji(k) + '　');
  const start = lines.findIndex((l) => head(n).test(l));
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) if (head(n + 1).test(lines[i])) { end = i; break; }
  return lines.slice(start, end).join('\n');
}

// 号の文から、号の細分(イ・ロ・ハ…)の文を取り出す(F16a)。細分は行の頭が全角の空白1つ・片仮名1字・全角の空白で始まる
// (「　イ　」。原文のファイルの書き方)。細分のさらに下((１) など)は全角の空白2つで始まるので、その細分に含める。
// 見つからなければ null
export function subitemOf(item, kana) {
  if (typeof kana !== 'string' || !/^[ァ-ヶ]$/.test(kana)) return null;
  const lines = String(item ?? '').split(/\r?\n/);
  const head = /^　([ァ-ヶ])　/;
  const start = lines.findIndex((l) => { const m = l.match(head); return m && m[1] === kana; });
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) if (head.test(lines[i])) { end = i; break; }
  return lines.slice(start, end).join('\n');
}

// 1件の抜き書き {id, sourceId, article, paragraph, item, subitem?, text} を、出典の原文と照らす。
// paragraph が整数ならその項の中に、さらに item が整数ならその号の中に、subitem(片仮名1字)があればその細分の中にあることまで確かめる。
// 返り値: { ok: true } か { ok: false, reason }
export function checkQuote(q, sourceTexts) {
  if (!q || typeof q !== 'object') return { ok: false, reason: '抜き書きが無い' };
  const text = sourceTexts?.[q.sourceId];
  if (typeof text !== 'string') return { ok: false, reason: '出典の原文が無い: ' + q.sourceId };
  if (!verifyQuote(q.text, text)) return { ok: false, reason: '原文に無い抜き書き' };
  let scope = text;
  if (Number.isInteger(q.paragraph)) {
    scope = paragraphOf(text, q.paragraph);
    if (scope === null || !verifyQuote(q.text, scope)) return { ok: false, reason: '第' + q.paragraph + '項の中に無い' };
  }
  if (Number.isInteger(q.item)) {
    const it = itemOf(scope, q.item);
    if (it === null || !verifyQuote(q.text, it)) return { ok: false, reason: '第' + q.item + '号の中に無い' };
    if (q.subitem != null) {
      const sub = subitemOf(it, q.subitem);
      if (sub === null || !verifyQuote(q.text, sub)) return { ok: false, reason: '第' + q.item + '号' + q.subitem + 'の中に無い' };
    }
  } else if (q.subitem != null) {
    return { ok: false, reason: '号の細分があるのに号が無い' };
  }
  return { ok: true };
}

// 規則表の行を、根拠の抜き書きが原文と一致するものと、しないものに分ける。
// 根拠が空の行・無い抜き書きを指す行・1つでも一致しない抜き書きを含む行は、規則表に入れない(dropped)。
// 返り値: { kept, dropped, problems: [{ ruleId, quoteId, reason }] }
export function filterVerifiedRules(rules, quotes, sourceTexts) {
  const byId = new Map((quotes || []).map((q) => [q.id, q]));
  const kept = [];
  const dropped = [];
  const problems = [];
  for (const rule of rules || []) {
    const basis = Array.isArray(rule?.basis) ? rule.basis : [];
    const ruleProblems = [];
    if (basis.length === 0) ruleProblems.push({ ruleId: rule?.id, quoteId: null, reason: '根拠が無い' });
    for (const b of basis) {
      const q = byId.get(b?.quoteId);
      if (!q) { ruleProblems.push({ ruleId: rule?.id, quoteId: b?.quoteId ?? null, reason: '抜き書きが見つからない' }); continue; }
      const r = checkQuote(q, sourceTexts);
      if (!r.ok) ruleProblems.push({ ruleId: rule?.id, quoteId: q.id, reason: r.reason });
    }
    if (ruleProblems.length === 0) kept.push(rule);
    else { dropped.push(rule); problems.push(...ruleProblems); }
  }
  return { kept, dropped, problems };
}

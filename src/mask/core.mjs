// 置き換えの部品(F11a): 文の中の人名・会社名・場所の名前・住所・電話・メールなどを記号に置き換え、対応表を持ち、戻ってきた文を元に戻す。
// この部品は分野の語を持たない。分野の語や形(番号の書き方など)は辞書(dictionaries)で外から渡す。
// 対応表はこの部品の中(メモリ)だけに持つ。ファイルにもブラウザにも残さない(ページを閉じれば消える)。
//
// 辞書の形: { name, labels: { kind: '表示名' }, terms: [{ word, kind }], patterns: [{ kind, re: RegExp }] }
// 置き換えの優先: 足した語(addTerm)> 辞書の語 > 辞書の形 > 部品の形。重なったら優先の高いほう、同じなら長いほうを取る。

const DEFAULT_LABELS = {
  person: '人名',
  company: '会社名',
  site: '現場名',
  address: '住所',
  phone: '電話',
  email: 'メール',
  other: '語',
};

const NAME_CHARS = '[\\p{Script=Han}\\p{Script=Katakana}ー々〆ヶA-Za-z0-9＆&・]';
const CORP = '(?:株式会社|有限会社|合同会社|合資会社|合名会社|一般社団法人|一般財団法人|[((](?:株|有)[))])';
const DIGIT = '[0-9０-９]';
const HYPHEN = '[-−‐‑–ー－]';
const STOP = '[^\\s、。,，.()()「」『』\\[\\]【】:：;；]';

// 部品が持つ形(分野によらないもの)
const CORE_PATTERNS = [
  { kind: 'email', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/gu },
  { kind: 'phone', re: new RegExp(`(?<![0-9０-９])[0０]${DIGIT}{1,4}${HYPHEN}${DIGIT}{1,4}${HYPHEN}${DIGIT}{3,4}(?![0-9０-９])`, 'gu') },
  { kind: 'phone', re: new RegExp(`[((][0０]${DIGIT}{1,4}[))]\\s*${DIGIT}{1,4}${HYPHEN}${DIGIT}{3,4}(?![0-9０-９])`, 'gu') },
  { kind: 'phone', re: new RegExp(`(?<![0-9０-９])[0０]${DIGIT}{9,10}(?![0-9０-９])`, 'gu') },
  // 会社名: 「〇〇株式会社」「株式会社〇〇」。名前は漢字・カタカナ・英数字だけとし、ひらがな(「は」「として」など)の手前・後ろで切る
  { kind: 'company', re: new RegExp(`${NAME_CHARS}{1,20}${CORP}`, 'gu') },
  { kind: 'company', re: new RegExp(`${CORP}${NAME_CHARS}{1,20}`, 'gu') },
  // 住所: 「〇〇都道府県 + 〇〇市区町村郡 + 町名 + 番地」
  { kind: 'address', re: new RegExp(`\\p{Script=Han}{1,3}[都道府県]${STOP}{1,20}?[市区町村郡]${STOP.slice(0, -1)}0-9０-９]{0,20}(?:${DIGIT}+(?:${HYPHEN}${DIGIT}+)*(?:番地|番|号)?)?`, 'gu') },
];

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// 語を、空白の違い(半角・全角・無し)を許して探す形にする
function termRegExp(word) {
  const parts = String(word).trim().split(/[\s　]+/).filter(Boolean).map(escapeRe);
  return new RegExp(parts.join('[\\s\\u3000]*'), 'gu');
}

const withGlobal = (re) => (re.flags.includes('g') ? new RegExp(re.source, re.flags) : new RegExp(re.source, re.flags + 'g'));

// 全角の数字を半角に
const toHalf = (s) => String(s).replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/[，,]/g, '');

// 金額の文字(「52,000,000」「5,200万」「1億2,000万」、後ろの「円」は無くてもよい)を数にする。読めなければ null
export function parseAmount(text) {
  const s = toHalf(String(text ?? '').trim()).replace(/円$/, '').replace(/\s+/g, '');
  const m = s.match(/^(?:(\d+(?:\.\d+)?)億)?(?:(\d+(?:\.\d+)?)万)?(\d+)?$/);
  if (!m || (!m[1] && !m[2] && !m[3])) return null;
  return Math.round((Number(m[1] || 0) * 1e8) + (Number(m[2] || 0) * 1e4) + Number(m[3] || 0));
}

export function formatYen(n) {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '円';
}

const AMOUNT_RE = new RegExp(`(?:(${DIGIT}[0-9０-９,，]*(?:\\.${DIGIT}+)?)億)?(?:(${DIGIT}[0-9０-９,，]*(?:\\.${DIGIT}+)?)万)?(${DIGIT}[0-9０-９,，]*)?円`, 'gu');

// 金額を「境目以上・未満」の形にする(元の金額は書かない)
export function bandLabel(amount, thresholds) {
  const ts = [...new Set(thresholds.filter((t) => Number.isFinite(t) && t > 0))].sort((a, b) => a - b);
  if (!ts.length) return '〔金額〕';
  if (amount < ts[0]) return `〔金額 ${formatYen(ts[0])}未満〕`;
  for (let i = 0; i < ts.length - 1; i++) {
    if (amount >= ts[i] && amount < ts[i + 1]) return `〔金額 ${formatYen(ts[i])}以上${formatYen(ts[i + 1])}未満〕`;
  }
  return `〔金額 ${formatYen(ts[ts.length - 1])}以上〕`;
}

function bandAmounts(text, thresholds) {
  return text.replace(AMOUNT_RE, (all, oku, man, rest) => {
    if (!oku && !man && !rest) return all;
    const n = parseAmount(all);
    return n === null ? all : bandLabel(n, thresholds);
  });
}

export function createMasker({ dictionaries = [] } = {}) {
  const labels = { ...DEFAULT_LABELS };
  const dictTerms = [];
  const dictPatterns = [];
  for (const d of dictionaries) {
    if (!d) continue;
    Object.assign(labels, d.labels || {});
    for (const t of d.terms || []) dictTerms.push({ kind: t.kind, re: termRegExp(t.word) });
    for (const p of d.patterns || []) dictPatterns.push({ kind: p.kind, re: withGlobal(p.re) });
  }
  const userTerms = []; // { word, kind, re }
  const byOriginal = new Map(); // 元の語(空白を除いた形)→ 対応表の1行
  const byToken = new Map(); // 記号 → 対応表の1行
  const counters = {};

  const labelOf = (kind) => labels[kind] || String(kind);

  function addTerm(word, kind) {
    const w = String(word ?? '').trim();
    const k = String(kind ?? '').trim() || 'other';
    if (!w) throw new Error('語が空です');
    const old = userTerms.find((t) => t.word === w);
    if (old) { old.kind = k; return { word: w, kind: k }; }
    userTerms.push({ word: w, kind: k, re: termRegExp(w) });
    return { word: w, kind: k };
  }

  function removeTerm(word) {
    const i = userTerms.findIndex((t) => t.word === String(word ?? '').trim());
    if (i >= 0) userTerms.splice(i, 1);
  }

  const terms = () => userTerms.map(({ word, kind }) => ({ word, kind, label: labelOf(kind) }));

  // 元の語に記号を割り当てる。同じ語にはいつも同じ記号(空白の有無だけの違いは同じ語とみなし、戻すときは最初に出た書き方にする)。
  // 文の中に既にある文字列と同じ記号は使わない
  const keyOf = (s) => s.replace(/[\s\u3000]+/g, '');
  function tokenFor(original, kind, text) {
    const hit = byOriginal.get(keyOf(original));
    if (hit) {
      if (!hit.variants.includes(original)) hit.variants.push(original);
      return hit;
    }
    let token;
    do {
      counters[kind] = (counters[kind] || 0) + 1;
      token = `〔${labelOf(kind)}${counters[kind]}〕`;
    } while (byToken.has(token) || text.includes(token));
    const entry = { token, original, kind, label: labelOf(kind), variants: [original] };
    byOriginal.set(keyOf(original), entry);
    byToken.set(token, entry);
    return entry;
  }

  function findSpans(text) {
    const groups = [userTerms, dictTerms, dictPatterns, CORE_PATTERNS];
    const cands = [];
    groups.forEach((list, priority) => {
      for (const { kind, re } of list) {
        const r = new RegExp(re.source, re.flags);
        for (const m of text.matchAll(r)) {
          if (!m[0]) continue;
          cands.push({ start: m.index, end: m.index + m[0].length, kind, priority });
        }
      }
    });
    cands.sort((a, b) => a.priority - b.priority || (b.end - b.start) - (a.end - a.start) || a.start - b.start);
    const chosen = [];
    for (const c of cands) {
      if (chosen.some((x) => c.start < x.end && x.start < c.end)) continue;
      chosen.push(c);
    }
    return chosen.sort((a, b) => a.start - b.start);
  }

  // options.amounts: 'keep'(既定。金額はそのまま)か 'band'(境目以上・未満の形。options.thresholds の数を境目にする)
  function mask(text, options = {}) {
    const src = String(text ?? '');
    const spans = findSpans(src);
    let out = '';
    let pos = 0;
    const used = [];
    for (const s of spans) {
      const original = src.slice(s.start, s.end);
      const entry = tokenFor(original, s.kind, src);
      out += src.slice(pos, s.start) + entry.token;
      pos = s.end;
      if (!used.includes(entry)) used.push(entry);
    }
    out += src.slice(pos);
    if (options.amounts === 'band') out = bandAmounts(out, (options.thresholds || []).map(Number));
    return { masked: out, map: used.map((e) => ({ ...e, variants: [...e.variants] })) };
  }

  // 記号を元の語に戻す。知らない記号はそのまま残す(金額の「境目」の形は元に戻らない)
  function unmask(text) {
    const src = String(text ?? '');
    if (!byToken.size) return src;
    const tokens = [...byToken.keys()].sort((a, b) => b.length - a.length).map(escapeRe);
    return src.replace(new RegExp(tokens.join('|'), 'gu'), (t) => byToken.get(t).original);
  }

  const entries = () => [...byOriginal.values()].map((e) => ({ ...e, variants: [...e.variants] }));

  // 対応表と足した語を消す
  function reset({ keepTerms = false } = {}) {
    byOriginal.clear();
    byToken.clear();
    for (const k of Object.keys(counters)) delete counters[k];
    if (!keepTerms) userTerms.length = 0;
  }

  return { mask, unmask, addTerm, removeTerm, terms, entries, reset, labelOf, labels: () => ({ ...labels }) };
}

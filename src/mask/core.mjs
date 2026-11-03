// 置き換えの部品(F11a): 文の中の人名・会社名・場所の名前・住所・電話・メールなどを記号に置き換え、対応表を持ち、戻ってきた文を元に戻す。
// この部品は分野の語を持たない。分野の語や形(番号の書き方など)は辞書(dictionaries)で外から渡す。
// 対応表はこの部品の中(メモリ)だけに持つ。ブラウザには残さない(ページを閉じれば消える)。
// 利用者が求めたときだけ、exportMap で対応表を文字列(JSON)にし、importMap で読み込む(F11d)。その文字列には元の名前が入っている。
//
// 辞書の形: { name, labels: { kind: '表示名' }, terms: [{ word, kind }], patterns: [{ kind, re: RegExp }] }
// 辞書は文脈の規則(contextPatterns: [{ kind, rule, re, accept? }])も持てる(F17a)。まわりの語から見つけた確信の弱い語で、
//   accept(語) が false の語は取らない。見つけた語は対応表の行に rule(規則の id)を付ける。同じ文の中の同じ語は、文脈が無くても同じ記号にする。
// 置き換えの優先: 足した語(addTerm)> 辞書の語 > 辞書の形 > 部品の形 > 文脈の規則。重なったら優先の高いほう、同じなら長いほうを取る。

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

// 対応表のファイル(F11d)
export const MAP_FORMAT = 'mask-map';
export const MAP_VERSION = 1;
export const MAP_NOTICE = 'このファイルには元の名前が入っています。外へ送らず、要らなくなったら消してください。';

const isText = (v) => typeof v === 'string' && v.trim() !== '';

// 対応表のファイルを読んで確かめる。おかしければ、どこがおかしいかを書いた Error を投げる
export function parseMapFile(text) {
  let data;
  try {
    data = JSON.parse(String(text ?? ''));
  } catch {
    throw new Error('対応表のファイルとして読めません(JSON の形になっていません)。書き出した対応表のファイルを選んでください。');
  }
  if (!data || typeof data !== 'object' || Array.isArray(data) || data.format !== MAP_FORMAT) {
    throw new Error('対応表のファイルではありません(format が "' + MAP_FORMAT + '" ではありません)。');
  }
  if (data.version !== MAP_VERSION) throw new Error('対応表のファイルの版(version: ' + JSON.stringify(data.version) + ')に対応していません。');
  if (!Array.isArray(data.entries)) throw new Error('対応表のファイルに entries(対応表の行)がありません。');
  const terms = data.terms === undefined ? [] : data.terms;
  if (!Array.isArray(terms)) throw new Error('対応表のファイルの terms(足した語)が並びになっていません。');
  const tokens = new Set();
  const originals = new Set();
  const entries = data.entries.map((e, i) => {
    const at = '対応表の ' + (i + 1) + ' 行目';
    if (!e || typeof e !== 'object') throw new Error(at + 'が読めません。');
    if (!isText(e.token) || !isText(e.original) || !isText(e.kind)) throw new Error(at + 'に記号・元の語・種類のどれかがありません。');
    if (tokens.has(e.token)) throw new Error(at + 'の記号 ' + e.token + ' が、ほかの行と重なっています。');
    const key = e.original.replace(/[\s\u3000]+/g, '');
    if (originals.has(key)) throw new Error(at + 'の元の語が、ほかの行と重なっています。');
    tokens.add(e.token);
    originals.add(key);
    const variants = Array.isArray(e.variants) ? e.variants.filter(isText) : [];
    if (!variants.includes(e.original)) variants.unshift(e.original);
    return { token: e.token, original: e.original, kind: e.kind, variants };
  });
  const words = terms.map((t, i) => {
    if (!t || !isText(t.word) || !isText(t.kind)) throw new Error('足した語の ' + (i + 1) + ' 番目に語か種類がありません。');
    return { word: t.word.trim(), kind: t.kind.trim() };
  });
  return { entries, terms: words };
}

export function createMasker({ dictionaries = [] } = {}) {
  const labels = { ...DEFAULT_LABELS };
  const dictTerms = [];
  const dictPatterns = [];
  const contextPatterns = [];
  for (const d of dictionaries) {
    if (!d) continue;
    Object.assign(labels, d.labels || {});
    for (const t of d.terms || []) dictTerms.push({ kind: t.kind, re: termRegExp(t.word) });
    for (const p of d.patterns || []) dictPatterns.push({ kind: p.kind, re: withGlobal(p.re) });
    for (const p of d.contextPatterns || []) contextPatterns.push({ kind: p.kind, re: withGlobal(p.re), rule: p.rule || 'context', accept: p.accept });
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
  function tokenFor(original, kind, text, rule) {
    const hit = byOriginal.get(keyOf(original));
    if (hit) {
      if (!hit.variants.includes(original)) hit.variants.push(original);
      if (!rule) delete hit.rule; // 辞書や形でも見つかった語は、確信の弱い語にしない
      return hit;
    }
    let token;
    do {
      counters[kind] = (counters[kind] || 0) + 1;
      token = `〔${labelOf(kind)}${counters[kind]}〕`;
    } while (byToken.has(token) || text.includes(token));
    const entry = { token, original, kind, label: labelOf(kind), variants: [original] };
    if (rule) entry.rule = rule;
    byOriginal.set(keyOf(original), entry);
    byToken.set(token, entry);
    return entry;
  }

  function findSpans(text) {
    const groups = [userTerms, dictTerms, dictPatterns, CORE_PATTERNS, contextPatterns];
    const cands = [];
    groups.forEach((list, priority) => {
      for (const { kind, re, rule, accept } of list) {
        const r = new RegExp(re.source, re.flags);
        for (const m of text.matchAll(r)) {
          if (!m[0]) continue;
          if (accept && !accept(m[0])) continue;
          cands.push({ start: m.index, end: m.index + m[0].length, kind, priority, rule });
        }
      }
    });
    const overlaps = (c, list) => list.some((x) => c.start < x.end && x.start < c.end);
    cands.sort((a, b) => a.priority - b.priority || (b.end - b.start) - (a.end - a.start) || a.start - b.start);
    const chosen = [];
    for (const c of cands) {
      if (overlaps(c, chosen)) continue;
      chosen.push(c);
    }
    // 文脈で見つけた語は、同じ文の中のほかの場所(文脈の無い所)でも同じ語として置き換える
    const seen = new Set();
    for (const c of chosen.filter((x) => x.rule)) {
      const word = text.slice(c.start, c.end);
      if (seen.has(keyOf(word))) continue;
      seen.add(keyOf(word));
      for (const m of text.matchAll(termRegExp(word))) {
        const more = { start: m.index, end: m.index + m[0].length, kind: c.kind, rule: c.rule };
        // 重なるのが、この語の中に収まる文脈の語だけなら(「中央病院」が「みほん台 中央病院」の中にあるなど)、長い方に置き換える
        const hit = chosen.filter((x) => more.start < x.end && x.start < more.end);
        if (hit.length && hit.every((x) => x.rule && x.start >= more.start && x.end <= more.end && x !== c)) {
          for (const x of hit) chosen.splice(chosen.indexOf(x), 1);
        }
        if (!overlaps(more, chosen)) chosen.push(more);
      }
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
      const entry = tokenFor(original, s.kind, src, s.rule);
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

  // 対応表を書き出す(F11d)。JSON の文字列で、元の語・記号・種類・足した語を含む。元の名前が入っているので扱いに注意する
  function exportMap() {
    return JSON.stringify({
      format: MAP_FORMAT,
      version: MAP_VERSION,
      notice: MAP_NOTICE,
      entries: [...byOriginal.values()].map((e) => ({ token: e.token, original: e.original, kind: e.kind, variants: [...e.variants] })),
      terms: userTerms.map(({ word, kind }) => ({ word, kind })),
    }, null, 2);
  }

  // 書き出した対応表を読み込む(F11d)。今の対応表と足した語は、読み込んだものに置き換わる。
  // 中身をすべて確かめてから入れ替える。おかしければ何も変えずに Error で止まる
  function importMap(text) {
    const data = parseMapFile(text);
    reset();
    for (const t of data.terms) userTerms.push({ word: t.word, kind: t.kind, re: termRegExp(t.word) });
    for (const e of data.entries) {
      const entry = { token: e.token, original: e.original, kind: e.kind, label: labelOf(e.kind), variants: e.variants };
      byOriginal.set(keyOf(e.original), entry);
      byToken.set(e.token, entry);
      // 次に作る記号が読み込んだ記号と重ならないよう、種類ごとの番号を進めておく
      const m = e.token.match(/(\d+)〕$/);
      if (m) counters[e.kind] = Math.max(counters[e.kind] || 0, Number(m[1]));
    }
    return { entries: data.entries.length, terms: data.terms.length };
  }

  return { mask, unmask, addTerm, removeTerm, terms, entries, reset, exportMap, importMap, labelOf, labels: () => ({ ...labels }) };
}

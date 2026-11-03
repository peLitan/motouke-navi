// 「元に戻す」の前に、対応表の元の語が後の欄(外へ出す文)に残っていないかを探し直す(F28b)。
// 置き換えは、規則・辞書で見つけた所だけを記号にするので、同じ名前でも書き方の違う所(全角と半角、空白の有り無し・
// 全角の空白、ハイフンの字の違い)が後の欄に残ることがある。ここでは、対応表の元の語(と、ほかの書き方)を
// 書き方の違いを無くした形にそろえ、後の欄も同じ形にそろえてから探し、残っている所の数と場所を返す。
// 記号(〔人名1〕など)の中は探さない。外部と通信しない・何も保存しない(渡された文と対応表だけを見る)。

// 1字ずつ、書き方の違いを無くした形にする。空白は消す(空の文字列を返す)
const DASHES = /[‐-―−－﹣ーｰ]/u; // ‐‑‒–—―−－﹣ と、数字の間の長音(下で扱う)
function normChar(c, prev, next) {
  if (/[\s　]/u.test(c)) return '';
  // 長音「ー」は語の一部(カタカナ)なので、数字に挟まれたときだけハイフンとみなす
  if (c === 'ー' || c === 'ｰ') return /[0-9０-９]/u.test(prev || '') && /[0-9０-９]/u.test(next || '') ? '-' : c.normalize('NFKC');
  if (DASHES.test(c)) return '-';
  return c.normalize('NFKC').toLowerCase();
}

// 文全体をそろえた形にし、そろえた形の各字が元の文のどこから来たかを持つ。
// 記号の中の字は、どの語とも合わない区切りの字(U+0000)にする
export function normalizeWithMap(text, { tokenRe = /〔[^〔〕\n]{1,30}〕/gu } = {}) {
  const src = String(text ?? '');
  const inToken = new Uint8Array(src.length);
  if (tokenRe) for (const m of src.matchAll(tokenRe)) inToken.fill(1, m.index, m.index + m[0].length);
  let norm = '';
  const from = []; // norm の i 字目 → 元の文の位置
  const chars = [...src];
  let pos = 0;
  for (let k = 0; k < chars.length; k++) {
    const c = chars[k];
    const n = inToken[pos] ? '\u0000' : normChar(c, chars[k - 1], chars[k + 1]);
    for (const ch of n) { norm += ch; from.push(pos); }
    pos += c.length;
  }
  return { norm, from, length: src.length };
}

const normWord = (w) => normalizeWithMap(w, { tokenRe: null }).norm;

// 残りを探す。
// text: 後の欄の文。entries: 対応表(masker.entries() か mask().map。{ token, label, kind, original, variants })。
// skipTokens: わざと残した語の記号(確かめてほしい語で「残す」を選んだもの)。数えない。
// 戻り値: { count, items: [{ token, label, original, found, start, end }], checked(探した語の数), skipped(短くて探さなかった語), kept(わざと残した語の数) }
export function findResiduals(text, entries, { skipTokens = [] } = {}) {
  const src = String(text ?? '');
  const { norm, from } = normalizeWithMap(src);
  const skip = new Set(skipTokens);
  const needles = [];
  const skipped = [];
  let checked = 0;
  let kept = 0;
  for (const e of entries || []) {
    if (skip.has(e.token)) { kept += 1; continue; }
    const forms = [...new Set([e.original, ...(e.variants || [])].map(normWord).filter(Boolean))];
    const usable = forms.filter((f) => [...f].length >= 2);
    // 1字の語は、ほかの語の一部にも当たるので探さない(数に入れず、skipped で知らせる)
    if (!usable.length) { skipped.push(e.token); continue; }
    checked += 1;
    for (const f of usable) needles.push({ e, f });
  }
  // 長い語から当て、重なる短い語は数えない(「甲野建設」と「甲野」が重なるなど)
  needles.sort((a, b) => b.f.length - a.f.length);
  const hits = [];
  for (const { e, f } of needles) {
    let i = norm.indexOf(f);
    while (i !== -1) {
      const start = from[i];
      const end = i + f.length < from.length ? from[i + f.length] : src.length;
      // 末尾の空白は含めない
      let s = start;
      let t = end;
      while (t > s && /[\s　]/u.test(src[t - 1])) t -= 1;
      if (!hits.some((h) => s < h.end && h.start < t)) {
        hits.push({ token: e.token, label: e.label, original: e.original, found: src.slice(s, t), start: s, end: t });
      }
      i = norm.indexOf(f, i + 1);
    }
  }
  hits.sort((a, b) => a.start - b.start);
  return { count: hits.length, items: hits, checked, skipped, kept };
}

// 結果を1つの文にする(画面に出す。元の語が入るので、この画面の中だけに出す)
export function residualMessage(r) {
  const extra = (r.kept ? `「残す」を選んだ ${r.kept}語は数えていません。` : '')
    + (r.skipped.length ? `1字の語 ${r.skipped.length}語は探していません。` : '');
  if (!r.count) {
    return `元に戻す前の点検: 後の欄に、対応表の元の語は残っていません(対応表の ${r.checked}語を、全角・半角、空白、ハイフンの違いもそろえて探し直しました)。` + extra;
  }
  const shown = r.items.slice(0, 10).map((h) => `「${h.found}」(${h.token} の元の語「${h.original}」)`).join('、');
  return `注意: 元に戻す前の点検で、後の欄に対応表の元の語が ${r.count}か所残っていました: ${shown}${r.count > 10 ? ` ほか ${r.count - 10}か所` : ''}。`
    + '書き方の違い(全角・半角、空白など)で置き換わらなかった所です。外へ出す前に、その書き方を辞書に足して「置き換える」をもう一度押してください。' + extra;
}

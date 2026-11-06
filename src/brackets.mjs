// 公告の抜き書きを、括弧を崩さずに切る部品(F65b)。通信しない。語は変えない。
// 括弧は「」『』()。丸括弧の半角と全角は同じ種類として対にする(PDF から写すと混ざることがある)。

const OPENERS = { '「': '」', '『': '』', '(': ')', '（': ')' };
const CLOSERS = { '」': '」', '』': '』', ')': ')', '）': ')' };

// 対になった括弧の [開きの位置, 閉じの位置] の列。
// 対の無い括弧(項の番号の「1)」や、閉じないまま終わる開き)は入れない。入れると、その後ろの文を全部飲み込む
// 開いたままの数を閉じの種類ごとに持つ。対の無い閉じで列を探すと、PDF の悪い文(「(」の後に「」」が続く)で固まる
export function bracketPairs(text) {
  const open = [];
  const pairs = [];
  const waiting = { '」': 0, '』': 0, ')': 0 };
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (Object.hasOwn(OPENERS, c)) {
      open.push({ at: i, closer: OPENERS[c] });
      waiting[OPENERS[c]] += 1;
    } else if (Object.hasOwn(CLOSERS, c)) {
      if (!waiting[CLOSERS[c]]) continue;
      let o;
      do {
        o = open.pop();
        waiting[o.closer] -= 1;
      } while (o.closer !== CLOSERS[c]);
      pairs.push([o.at, i]);
    }
  }
  return pairs;
}

// 位置 i が対の括弧の中かを答える関数。対の数によらず1回で答える(長い PDF の文でも固まらない)
export function insideOf(pairs, length) {
  const depth = new Int32Array(length + 2);
  for (const [open, close] of pairs) {
    depth[open + 1] += 1;
    depth[close] -= 1;
  }
  for (let i = 1; i < depth.length; i += 1) depth[i] += depth[i - 1];
  return (i) => depth[i] > 0;
}

// 文の列。つなぐと元の文に戻る(空白も除かない)。対になった括弧の中の「。」では切らない。
// 例外: 文の頭から始まって「。)」で閉じる丸括弧は、それだけで1文。「(…に限る。)なお、…」の前半の語を
// 「なお」より後の文の判定に混ぜないため。文の途中の「(…をいう。以下同じ。)は、…」は続きなので切らない
export function splitSentences(text) {
  const pairs = bracketPairs(text);
  const inside = insideOf(pairs, text.length);
  const openOf = new Map(pairs.map(([open, close]) => [close, open]));
  const closesAlone = (i, start) => (text[i] === ')' || text[i] === '）') && text[i - 1] === '。' && !inside(i)
    && openOf.has(i) && !text.slice(start, openOf.get(i)).trim()
    && !/^\s*[。、]/.test(text.slice(i + 1));
  const out = [];
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    if ((text[i] === '。' && !inside(i)) || closesAlone(i, start)) {
      out.push(text.slice(start, i + 1));
      start = i + 1;
    }
  }
  if (start < text.length) out.push(text.slice(start));
  return out;
}

// 長さで切る。切った所で開いたままの括弧は、元の文の閉じ括弧を「…」の後ろに足す。元の文で閉じていない括弧には足さない
export function cutQuote(text, max) {
  if (text.length <= max) return text;
  const closers = bracketPairs(text).filter(([open, close]) => open < max && close >= max)
    .sort((a, b) => b[0] - a[0]).map(([, close]) => text[close]);
  return text.slice(0, max) + '…' + closers.join('');
}

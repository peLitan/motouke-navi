// 公告の抜き書きを、括弧を崩さずに切る部品(F65b)。通信しない。語は変えない。
// 括弧は「」『』()。丸括弧の半角と全角は同じ種類として対にする(PDF から写すと混ざることがある)。

const OPENERS = { '「': '」', '『': '』', '(': ')', '（': ')' };
const CLOSERS = { '」': '」', '』': '』', ')': ')', '）': ')' };

// 対になった括弧の [開きの位置, 閉じの位置] の列。
// 対の無い括弧(項の番号の「1)」や、閉じないまま終わる開き)は入れない。入れると、その後ろの文を全部飲み込む
export function bracketPairs(text) {
  const open = [];
  const pairs = [];
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (Object.hasOwn(OPENERS, c)) open.push({ at: i, closer: OPENERS[c] });
    else if (Object.hasOwn(CLOSERS, c)) {
      const k = open.findLastIndex((o) => o.closer === CLOSERS[c]);
      if (k < 0) continue;
      pairs.push([open[k].at, i]);
      open.length = k;
    }
  }
  return pairs;
}

// 文の列。つなぐと元の文に戻る(空白も除かない)。対になった括弧の中の「。」では切らない。
// 例外: 文の頭から始まって「。)」で閉じる丸括弧は、それだけで1文。「(…に限る。)なお、…」の前半の語を
// 「なお」より後の文の判定に混ぜないため。文の途中の「(…をいう。以下同じ。)は、…」は続きなので切らない
export function splitSentences(text) {
  const pairs = bracketPairs(text);
  const inside = (i) => pairs.some(([open, close]) => open < i && i < close);
  const closesAlone = (i, start) => (text[i] === ')' || text[i] === '）') && text[i - 1] === '。' && !inside(i)
    && pairs.some(([open, close]) => close === i && !text.slice(start, open).trim())
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

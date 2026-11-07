// PDF から写した文の見た目を整える部品(F65c)。通信しない。空白と改行だけを動かし、語は変えない。
import { bracketPairs, insideOf } from './brackets.mjs';

const LINE_BREAK = /\r\n?|[\n\v\f\u2028\u2029]/;
const SENTENCE_END = /[。｡．][)）」』]*$/;
const WORD_END = /[0-9A-Za-z]$/;
const WORD_HEAD = /^[0-9A-Za-z]/;

// 箇条の頭: 記号、丸の番号、(1)・(ア)、1)・1.、「ア 」、「３ 」。「3.5 億円」の小数は番号にしない
const ITEM_HEAD = /^(?:[・･●○◎■□◆◇※①-⑳]|[(（](?:[0-9０-９]{1,3}|[ア-ンｱ-ﾝ]|[a-zA-Z])[)）]|[0-9０-９]{1,3}(?:[)）]|[.．](?![0-9０-９]))|[ア-ンｱ-ﾝ]\s|[0-9０-９]{1,3}\s)/;
// 数のあとが助詞や単位なら、番号ではなく折り返された文の続き(「…評定点が」の次の行の「65 点未満の…」)。
// 「1 件名」「2 名称」のように単位の字で始まる語は番号のままにする。迷ったら改行を残す側に倒す(語がつながるより害が小さい)
const WRAPPED_NUMBER = /^[0-9０-９]{1,3}\s(?:[ぁ-ん%％㎡㎥]|級|以[上下内]|未満|(?:[点年月日時分秒円万億千件名人者社回割歳号条項階]|[ヶヵカケ箇]月)(?:$|[\s0-9０-９ぁ-ん以未超間前後円度目]))/;
const isItemHead = (line) => ITEM_HEAD.test(line) && !WRAPPED_NUMBER.test(line);

// 2つの行の間に置く文字。文の終わりと箇条の頭は改行を残す。括弧の中の「。」は文の途中なので詰める。
// 英数字どうしは、つなげると別の語に見えるので空白を1つ置く(「JIS」と「A 1234」)
function gap(prev, next, insideBrackets) {
  if (isItemHead(next) || (SENTENCE_END.test(prev) && !insideBrackets)) return '\n';
  return WORD_END.test(prev) && WORD_HEAD.test(next) ? ' ' : '';
}

// 頁の区切りの行(src/mask/extract.mjs が頁の間に入れる行)
export const PAGE_LINE = /^―― [0-9]+頁 ――$/gm;

// 頁の区切りの行と、空の頁が残す空の行を除く(F82d)。施工計画書の目次は1行に1つの見出しなので、tidyPdfText のように行をつなげない
export function dropPageLines(text) {
  return String(text ?? '').replace(new RegExp(PAGE_LINE.source + '(?:\\r?\\n)*', 'gm'), '').trim();
}

// 2つ以上続く空白を1つにし、行の頭と終わりの空白と空の行を除き、文の途中の改行を詰める。1つだけの空白はそのまま
export function tidyPdfText(text) {
  const lines = String(text ?? '').split(LINE_BREAK).map((line) => line.replace(/\s{2,}/g, ' ').trim()).filter(Boolean);
  const joined = lines.join('\n');
  const inside = insideOf(bracketPairs(joined), joined.length);
  let out = '';
  let at = -1; // lines.join('\n') の上の、この行の前の改行の位置
  lines.forEach((line, i) => {
    if (i > 0) {
      const prev = lines[i - 1];
      at += prev.length + 1;
      out += gap(prev, line, inside(at));
    }
    out += line;
  });
  return out;
}

// 頁ごとに整え、区切りの行は1行のまま残す(前後の行とつなげない)。空の頁は区切りの行だけになる
export function tidyPdfPages(text) {
  const s = String(text ?? '');
  const marks = s.match(PAGE_LINE) ?? [];
  return s.split(PAGE_LINE).flatMap((page, i) => [i ? marks[i - 1] : '', tidyPdfText(page)]).filter(Boolean).join('\n');
}

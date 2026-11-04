// 辞書に足す候補(F36b): 置き換えで見つからなかった語のうち、会社・団体の名前らしい語を探して、利用者に見せる。
// ここは探すだけで、置き換えない(文も対応表も変えない)。足すかどうかは画面で利用者が1つずつ選ぶ(src/ui/mask-app.mjs)。
// 探す所は2つ:
//   欄の値(field): 「商号」「会社名」「下請負人」などの欄の値。表(| 区切り・タブ区切り)の、横に値が並ぶ形と、見出しの行の下に値が並ぶ形。
//     表でない行は「欄名: 値」と、行の頭の「欄名 値」を見る
//   名前の形(shape): 法人の種類に近い語(社団法人・(同)・Co., Ltd. など)や、慣用の語尾(土木・電設・商事など)で終わる語
// 語の一覧は company-types.mjs(業界を問わない語)と、辞書の candidates(業界の語)から読む。外部と通信しない・何も保存しない。

import {
  CANDIDATE_FIELD_LABELS, CANDIDATE_SUFFIXES, CANDIDATE_VALUE_STOP_WORDS, NEAR_CORPORATE_TYPES, NEAR_CORPORATE_ABBREVIATIONS,
} from './company-types.mjs';
import { trimHead, trimTail, restLength, orgRestLength, isCorpTailWord } from './rules-company.mjs';

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const alt = (words) => [...new Set(words)].sort((a, b) => b.length - a.length).map(escapeRe).join('|');

const SOLID = '\\p{Script=Han}\\p{Script=Katakana}ー々〆ヶA-Za-z0-9Ａ-Ｚａ-ｚ０-９＆&・';
const HIRA = '\\p{Script=Hiragana}';
const NAME = `[${SOLID}${HIRA}]`;
const SP = '[ \\u3000]';
const PLAIN_NAME = new RegExp(`^[${HIRA}]*[${SOLID}]*$`, 'u');
const LATIN = "[A-Za-z0-9&.'\\- ]";

// 欄の値から外す後ろの語と括弧の添え書き(「甲野土木 御中」「甲野土木(一次)」)
const VALUE_TAIL = /(?:[ 　]*(?:御中|殿|様)|[ 　]*[((][^()()]*[))])+$/u;
const SENTENCE_END = /(?:です|ます|ません|する|した|して|される|された|こと|もの|とおり|ください|について)$/u;
const NUMBER_LIKE = /^(?:令和|平成|昭和|[RHSＲＨＳ])?[元0-9０-９\s　,，.．\-−ー/／:：年月日円%％]+$/u;
const MARKS_ONLY = /^[-−ー―–—_＿*＊・.…○〇◯●×✕△▲□■☆★?？\s　]+$/u;
const PLACEHOLDER = /(?:○○|〇〇|◯◯|××|△△|xxxx|XXXX)/u;
const TABLE_RULE = /^[\s:：\-−ー―–—=]+$/u;

const compact = (s) => s.replace(/[\s　]+/gu, '');

// 表の1行を欄に分ける。| 区切りかタブ区切りでなければ null。欄は { text, start, end }(start・end は行の中の位置)
function splitCells(line) {
  const sep = /[|｜]/u.test(line) ? /[|｜]/gu : (line.includes('\t') ? /\t/gu : null);
  if (!sep) return null;
  const cells = [];
  let pos = 0;
  const push = (a, b) => {
    const raw = line.slice(a, b);
    const lead = raw.length - raw.trimStart().length;
    const text = raw.trim();
    cells.push({ text, start: a + lead, end: a + lead + text.length });
  };
  for (const m of line.matchAll(sep)) { push(pos, m.index); pos = m.index + 1; }
  push(pos, line.length);
  if (sep.source.includes('|')) {
    if (!cells[0].text) cells.shift();
    if (cells.length && !cells[cells.length - 1].text) cells.pop();
  }
  return cells;
}
const isRuleRow = (cells) => !!cells && cells.length > 0 && cells.every((c) => TABLE_RULE.test(c.text));

// 文の中の位置 [start, end) のうち、置き換えで見つかった語に重ならない所
function uncoveredParts(start, end, spans) {
  const parts = [];
  let pos = start;
  for (const s of spans) {
    if (s.end <= pos) continue;
    if (s.start >= end) break;
    if (s.start > pos) parts.push([pos, s.start]);
    pos = Math.max(pos, s.end);
  }
  if (pos < end) parts.push([pos, end]);
  return parts;
}

// options: { labels, suffixes, stopWords }(辞書の candidates。業界の語)
// 返す値: [{ word, source: 'field' | 'shape', basis, count }]。文に出てくる順で、欄の値を先に並べる
export function findCompanyCandidates(text, spans = [], options = {}) {
  const src = String(text ?? '');
  const sorted = [...spans].sort((a, b) => a.start - b.start);
  const labels = [...CANDIDATE_FIELD_LABELS, ...(options.labels || [])];
  const suffixes = [...CANDIDATE_SUFFIXES, ...(options.suffixes || [])];
  const stop = options.stopWords || [];
  const valueStop = new Set([...CANDIDATE_VALUE_STOP_WORDS, ...labels]);
  const covered = (a, b) => sorted.some((s) => a < s.end && s.start < b);
  const found = new Map();
  const add = (word, source, basis) => {
    const w = word.trim();
    const key = compact(w);
    if (found.has(key)) return;
    found.set(key, { word: w, source, basis, count: Math.max(1, src.split(w).length - 1) });
  };
  const stripStop = (name) => stop.reduce((s, w) => s.split(w).join(''), name);

  // ---- 欄の値 ----
  const LABEL = alt(labels);
  const labelCell = new RegExp(`^(?:[一二三四1-9１-９]次)?(?:${LABEL})(?:の(?:商号|名称))?(?:名)?(?:[((][^()()]*[))])?$`, 'u');
  const isLabel = (s) => labelCell.test(compact(s));
  const isHeaderWord = (s) => isLabel(s) || valueStop.has(compact(s)) || /(?:の日|年月日|番号|金額|代金額|住所|電話|氏名|工事|内容)$/u.test(compact(s));

  function nameValue(raw) {
    const v = raw.replace(VALUE_TAIL, '').trim();
    const n = compact(v);
    if ([...n].length < 2 || [...n].length > 40) return null;
    if (NUMBER_LIKE.test(v) || MARKS_ONLY.test(v) || PLACEHOLDER.test(v)) return null;
    if (/[。?？!!「」『』::]/u.test(v) || SENTENCE_END.test(n)) return null;
    if ((v.match(/[((]/gu) || []).length !== (v.match(/[))]/gu) || []).length) return null;
    if (valueStop.has(n) || isLabel(v) || n.startsWith('別紙')) return null;
    if (restLength(n) < 2) return null;
    return v;
  }
  // 値の位置 [a, b) から、見つかっていない所を取り出して候補にする。読点などで並ぶ値は分ける
  function addValue(a, b, label) {
    for (const [s, e] of uncoveredParts(a, b, sorted)) {
      for (const part of src.slice(s, e).split(/[、,，/／]/u)) {
        const v = nameValue(part);
        if (v) add(v, 'field', '「' + label + '」の欄');
      }
    }
  }

  const lineStart = new RegExp(`^[ \\t\\u3000]*(?:[-*+・●■◆▪][ \\u3000]*)?(?:[0-9０-９]+[.)．）][ \\u3000]*)?((?:[一二三四1-9１-９]次)?(?:${LABEL}))(?:[((][^()()]*[))])?(?:${SP}*[:：]${SP}*|${SP}+)(\\S.*)$`, 'u');
  const midColon = new RegExp(`(?<![${SOLID}${HIRA}])((?:[一二三四1-9１-９]次)?(?:${LABEL}))${SP}*[:：]${SP}*([^\\s\\u3000。;；]+)`, 'gu');

  const lines = [];
  for (let pos = 0, i = 0, rows = src.split('\n'); i < rows.length; pos += rows[i].length + 1, i++) lines.push({ index: pos, text: rows[i].replace(/\r$/u, '') });
  let columns = null; // 見出しの行で見つけた欄 [{ col, label }]
  lines.forEach((m, i) => {
    const line = m.text;
    const cells = splitCells(line);
    if (!cells || cells.length < 2) {
      columns = null;
      if (!line.trim() || /^\s*#/u.test(line)) return;
      const hit = line.match(lineStart);
      if (hit) {
        const start = line.length - hit[2].length;
        const tokens = hit[2].trim().split(/[ \u3000]+/u);
        // 「欄名: 値」は最初の語、「欄名 値」は2語までを値にする(「甲野 土木」)
        const whole = !/[:：]/u.test(line.slice(0, start)) && tokens.length <= 2;
        addValue(m.index + start, m.index + start + (whole ? hit[2].trimEnd().length : tokens[0].length), hit[1]);
        return;
      }
      for (const c of line.matchAll(midColon)) {
        const start = c.index + c[0].length - c[2].length;
        addValue(m.index + start, m.index + c.index + c[0].length, c[1]);
      }
      return;
    }
    if (isRuleRow(cells)) return;
    if (columns) {
      for (const { col, label } of columns) if (cells[col]) addValue(m.index + cells[col].start, m.index + cells[col].end, label);
      return;
    }
    const hits = cells.map((c, col) => ({ col, label: c.text })).filter((c) => isLabel(c.label));
    if (!hits.length) return;
    const next = lines[i + 1] ? splitCells(lines[i + 1].text) : null;
    const others = cells.filter((c) => !isLabel(c.text));
    const headerLike = others.filter((c) => isHeaderWord(c.text)).length;
    if (isRuleRow(next) || (others.length > 0 && headerLike * 2 >= others.length)) { columns = hits; return; }
    for (const { col, label } of hits) {
      const v = cells[col + 1];
      if (v) addValue(m.index + v.start, m.index + v.end, label);
    }
  });

  // ---- 名前の形 ----
  const keepName = (word, basis) => add(word, 'shape', basis);
  const nearAlt = alt(NEAR_CORPORATE_TYPES);
  const parenAbbr = `[(（](?:${alt(NEAR_CORPORATE_ABBREVIATIONS)})[)）]`;
  const nearBefore = new RegExp(`(${NAME}{1,30}?)${SP}?(${nearAlt}|${parenAbbr})`, 'gu');
  for (const m of src.matchAll(nearBefore)) {
    const dot = m[1].lastIndexOf('・') + 1;
    const h0 = trimHead(m[1].slice(dot));
    if (h0 < 0) continue;
    const h = dot + h0;
    const kept = m[1].slice(h);
    const end = m.index + m[0].length;
    if (restLength(kept) < 2 || covered(m.index + h, end)) continue;
    keepName(src.slice(m.index + h, end), '法人の種類に近い語「' + m[2] + '」');
  }
  const nearAfter = new RegExp(`(${nearAlt}|${parenAbbr})${SP}?(${NAME}{1,30})`, 'gu');
  for (const m of src.matchAll(nearAfter)) {
    const kept = m[2].slice(0, trimTail(m[2].replace(/・+$/u, '')));
    if (!kept || restLength(kept) < 2 || isCorpTailWord(kept)) continue;
    const end = m.index + m[0].length - m[2].length + kept.length;
    if (covered(m.index, end)) continue;
    keepName(src.slice(m.index, end), '法人の種類に近い語「' + m[1] + '」');
  }
  const latin = new RegExp(`[A-Za-z0-9]${LATIN}{1,40}?,?${SP}?(?:Co\\.,?${SP}?Ltd\\.?|Inc\\.?|LLC|Corp\\.?|K\\.K\\.)(?![A-Za-z0-9])`, 'gu');
  for (const m of src.matchAll(latin)) {
    if (!covered(m.index, m.index + m[0].length)) keepName(m[0], '英語の会社の書き方');
  }
  const suffixRe = new RegExp(`(${NAME}{1,30}?)(${alt(suffixes)})(?![\\p{Script=Han}\\p{Script=Katakana}ー々])`, 'gu');
  for (const m of src.matchAll(suffixRe)) {
    // 「給排水・甲野設備」「個人名・公社」のような並びは、最後の中黒の後ろだけを見る
    const dot = m[1].lastIndexOf('・') + 1;
    const h0 = trimHead(m[1].slice(dot));
    if (h0 < 0) continue;
    const h = dot + h0;
    const kept = m[1].slice(h);
    const end = m.index + m[0].length;
    if (!PLAIN_NAME.test(kept) || orgRestLength(stripStop(kept)) < 2 || covered(m.index + h, end)) continue;
    keepName(src.slice(m.index + h, end), '語尾「' + m[2] + '」');
  }

  const all = [...found.values()];
  return [...all.filter((c) => c.source === 'field'), ...all.filter((c) => c.source !== 'field')];
}

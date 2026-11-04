#!/usr/bin/env node
// 発注者の仕様書の文から作った規則表の行(段取りの行・施工計画書の記載項目の行)を、仕様書の原文と機械で照らす(F26a)
// 照らし方は作品の scripts/check-quotes.mjs と同じ(src/quote-check.mjs の verifyQuote。許す違いは空白だけ)。
// そのうえで、行が指す節(1-1-1-6 など)の中に抜き書きがあるかまで確かめる。
// 照らす前に、ページの下のページ番号と、その隣で繰り返す欄外の見出しの行を原文から除く(ページをまたぐ文が照合を通るように。F31f)。
//
// 使い方:
//   node check-rows.mjs <仕様書の文のファイル> <行のファイル(JSON)> [--out <残った行を書くファイル>]
//     行を1つずつ照らし、残す行と外す行(理由つき)を出す。1行でも外したら終了コード 1
//   node check-rows.mjs --list <節の番号> <仕様書の文のファイル>
//     節の中の「（1）○○」の形の列挙を、施工計画書の記載項目の行の候補(JSON)として出す(機械で拾うだけ。中身の判断はしない)
//
// 行のファイルの形: { "source": 出典, "rows": [ 行, ... ] }
//   出典: { "publisher": 発注者, "title": 題名, "edition": 版, "url": URL, "fetchedAt": 取得日 }。--out にそのまま写す(作品の画面の読み込みは出典が要る)
//   施工計画書の記載項目の行: { "kind": "plan-item", "section": "1-1-1-6", "no": 1, "label": "工事概要", "quote": "（1）工事概要" }
//   段取りの行: { "kind": "schedule", "id": "...", "phase": "start|work|completion", "when": "...", "what": "...", "to": "...",
//                 "section": "1-1-1-6", "title": "...", "quote": "...", "note": "..." }
//   決められない欄は値を "判断できない" にし、"undetermined": { "欄の名前": "決められない理由" } を添える
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyQuote, stripSpaces } from './lib/quote-check.mjs';

export const UNDETERMINED = '判断できない';
const PHASES = ['start', 'work', 'completion'];
// 節の見出しの行: 行の頭が「1-1-1-6」のような番号で、空白(全角を含む)のあとに題が続く
const HEADING_RE = /^[\s　]*(\d+(?:-\d+){1,5})[\s　]+\S/;
// 列挙の行: 行の頭が「（1）」「(1)」(全角・半角の数字)
const LIST_RE = /^[\s　]*[（(]([0-9０-９]+)[）)]/;

// 段取りの行の抜き書きの最短の長さ(空白を除いた字数)。短い語句だと、どの文にもある言い回しが根拠の代わりになるため
export const MIN_QUOTE = 10;
// ページ番号だけの行: 「1 −6」「-12-」の形
const DASH = '[-−－ー‐–—]';
const PAGE_RE = new RegExp('^[\\s　]*(?:\\d+[\\s　]*' + DASH + '[\\s　]*\\d+|' + DASH + '[\\s　]*\\d+[\\s　]*' + DASH + ')[\\s　]*$');

const toHalf = (s) => String(s).replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));

// ページ番号の行と、その隣(前後)に2回以上出る欄外の見出しの行を除く。ほかの行は変えない
export function stripPageLines(text) {
  const lines = String(text ?? '').split(/\r?\n/);
  const neighbor = (i, step) => {
    for (let j = i + step, n = 0; j >= 0 && j < lines.length && n < 3; j += step, n++) if (lines[j].trim()) return j;
    return -1;
  };
  const pages = lines.flatMap((l, i) => (PAGE_RE.test(l) ? [i] : []));
  const count = new Map();
  for (const i of pages) for (const step of [-1, 1]) {
    const j = neighbor(i, step);
    if (j >= 0 && !PAGE_RE.test(lines[j])) count.set(step + lines[j].trim(), (count.get(step + lines[j].trim()) ?? 0) + 1);
  }
  const drop = new Set(pages);
  for (const i of pages) for (const step of [-1, 1]) {
    const j = neighbor(i, step);
    if (j >= 0 && (count.get(step + lines[j].trim()) ?? 0) >= 2) drop.add(j);
  }
  return lines.filter((_, i) => !drop.has(i)).join('\n');
}

// 仕様書の文を節に分ける。返り値: Map(節の番号 → 節の文(見出しの行から次の見出しの前まで))
export function splitSections(text) {
  const lines = String(text ?? '').split(/\r?\n/);
  const map = new Map();
  let cur = null;
  let buf = [];
  const flush = () => { if (cur && !map.has(cur)) map.set(cur, buf.join('\n')); };
  for (const line of lines) {
    const m = line.match(HEADING_RE);
    if (m) { flush(); cur = m[1]; buf = [line]; } else if (cur) buf.push(line);
  }
  flush();
  return map;
}

// 列挙の1行から番号と末尾の括弧書きを除いた名前
const itemLabel = (line) => line.slice(line.match(LIST_RE)[0].trim().length).replace(/[（(][^（）()]*[）)]$/, '').trim();

// 節の文から「（n）○○」の列挙を拾い、記載項目の行の候補にする。
// label は抜き書きから番号と末尾の括弧書き(「（主要機械、…を含む）」など)を除いたもの。aliases は原文に無いので作らない
export function listItems(sectionText, section) {
  const rows = [];
  for (const line of String(sectionText ?? '').split(/\r?\n/)) {
    const m = line.match(LIST_RE);
    if (!m) continue;
    const quote = line.trim();
    rows.push({ kind: 'plan-item', section, no: Number(toHalf(m[1])), label: itemLabel(quote), quote });
  }
  return rows;
}

// 数字に続く単位。「10日」と「500万円」と「第1項」を別のものとして比べるために見る
const MONTHS = 'か月|ヶ月|カ月|ケ月|ヵ月|箇月';
const KANJI_UNIT = `${MONTHS}|週|日|月|年|時間|分(?!の)|秒|円|回|割|号|条|項`;
const KANJI_RUN = new RegExp(`[0-9〇零一二三四五六七八九十百千]+(?=[万億]|${KANJI_UNIT})`, 'g');
const NUMBER_RE = new RegExp(`(\\d+)(${MONTHS}|週|日|月|年|時間|分|秒|円|回|人|名|件|割|%|％|号|条|項)?`, 'g');
const DIGIT = { 〇: 0, 零: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
const PLACE = { 十: 10, 百: 100, 千: 1000 };

// 「三十」「二〇」「5千」を数にする
function kanjiValue(run) {
  let total = 0;
  let cur = null;
  for (const c of run) {
    if (c in PLACE) { total += (cur ?? 1) * PLACE[c]; cur = null; } else cur = (cur ?? 0) * 10 + (DIGIT[c] ?? Number(c));
  }
  return total + (cur ?? 0);
}

// 全角の数字・漢数字・桁の区切り・万と億を、算用数字にそろえる。
// 漢数字は単位が続くときだけ数として読む(「一部」「一括」「十分に」「一人親方」を数にしない)
export function normalizeNumbers(s) {
  return toHalf(String(s ?? ''))
    .replace(/(\d),(?=\d{3}(?!\d))/g, '$1')
    .replace(KANJI_RUN, (run, at, all) => (run === '十' && all[at + 1] === '分' ? run : String(kanjiValue(run))))
    .replace(/(\d+)億(?:(\d+)万)?(\d*)/g, (_, a, b, c) => String(Number(a) * 1e8 + Number(b ?? 0) * 1e4 + Number(c || 0)))
    .replace(/(\d+)万(\d*)/g, (_, a, b) => String(Number(a) * 1e4 + Number(b || 0)));
}

// 文の中の数字を { n, unit } で集める。期間の書き方の揺れ(日間・週間・年間・ヶ月など)は1つにそろえる
const numbersIn = (s) => [...normalizeNumbers(s).matchAll(NUMBER_RE)].map((m) => ({
  n: m[1],
  unit: m[2] === '％' ? '%' : new RegExp(MONTHS).test(m[2] ?? '') ? 'か月' : (m[2] ?? ''),
}));

// 原文に無い数字。単位のある数字は同じ数・同じ単位があるときだけ、原文にあるとする(「500万円」があっても「500日」は無い)
function extraNumbers(field, pool) {
  return numbersIn(field).flatMap(({ n, unit }) => {
    const same = pool.filter((p) => p.n === n);
    if (same.length === 0) return [n];
    return unit === '' || same.some((p) => p.unit === unit) ? [] : [n + unit];
  });
}

// 抜き書きの「土曜日、日曜日、祝日等を除き10日以内」の「除き」を、when が落としていないか。落とすと日数の数え方が変わる。
// 同じ数字が条件なしでも抜き書きにあれば問わない
function droppedExclusions(when, quote) {
  if (String(when ?? '').includes('除')) return [];
  const text = normalizeNumbers(quote);
  return numbersIn(when).filter(({ unit }) => unit !== '').flatMap(({ n, unit }) => {
    const at = [...text.matchAll(new RegExp(`(?<!\\d)${n}${unit}`, 'g'))];
    const qualified = (m) => /除[きいく][てた]?[、,]?$/.test(text.slice(Math.max(0, m.index - 4), m.index))
      || /^間?[（(][^（）()]*除[くき]/.test(text.slice(m.index + m[0].length));
    return at.length && at.every(qualified) ? [n + unit] : [];
  });
}

// what の「を」の前(無ければ全体)の語が、抜き書きに1つも無いときの語の一覧。
// 「監督員に提出しなければならない。」のような、どの決まりにも当たる文を根拠にした行を外すため。役の名前と短い語は数えない。
// 抜き書きが「その写しを…」のように前を指すときは、同じ文の前の部分まで探す
function missingSubject(what, quote, sec) {
  const text = String(what ?? '');
  const at = text.lastIndexOf('を');
  const words = (at > 0 ? text.slice(0, at) : text).match(/[一-龠々]{2,}|[ァ-ヶー]{2,}/g) ?? [];
  const body = words.filter((w) => !/^(?:監督員|監督職員|発注者|受注者)$/.test(w));
  const q = stripSpaces(quote);
  const s = stripSpaces(sec ?? '');
  const end = s.indexOf(q);
  const before = end > 0 && /その|当該|これ/.test(q) ? s.slice(s.lastIndexOf('。', end) + 1, end) : '';
  return body.length && !body.some((w) => (before + q).includes(w)) ? body : [];
}

// 1行を照らす。返り値: 外す理由の配列(空なら残す)
export function rowProblems(row, sections, wholeText) {
  const reasons = [];
  if (!row || typeof row !== 'object') return ['行が読めない'];
  if (row.kind !== 'plan-item' && row.kind !== 'schedule') reasons.push('種類(kind)が plan-item でも schedule でもない');
  const quote = typeof row.quote === 'string' ? row.quote : '';
  if (stripSpaces(quote).length === 0) return [...reasons, '抜き書き(quote)が無い'];
  const section = row.section != null && row.section !== '' ? String(row.section) : null;
  const sec = section != null ? sections.get(section) : null;

  // 抜き書きの照合(check-quotes.mjs と同じ: 空白の違いだけ許す)
  if (!verifyQuote(quote, wholeText)) reasons.push('原文に無い抜き書き');
  else if (section != null) {
    if (sec == null) reasons.push('節 ' + section + ' の見出しが原文に見つからない');
    else if (!verifyQuote(quote, sec)) reasons.push('節 ' + section + ' の中に無い抜き書き');
  }
  // 画面の読み込みは section の無い行を拒むので、ここでも通さない
  if (section == null) reasons.push('節(section)が無い');

  // 「判断できない」には理由が要る
  const und = row.undetermined && typeof row.undetermined === 'object' ? row.undetermined : {};
  for (const [k, v] of Object.entries(row)) {
    if (v === UNDETERMINED && !(typeof und[k] === 'string' && und[k].trim())) reasons.push(k + ' が「判断できない」なのに理由(undetermined.' + k + ')が無い');
  }

  if (row.kind === 'plan-item') {
    const label = typeof row.label === 'string' ? row.label : '';
    // 記載項目は短い名前なので、字数ではなく「節の列挙の1行そのもの」であることで確かめる
    const line = sec == null ? null : listItems(sec, section).find((it) => stripSpaces(it.quote) === stripSpaces(quote));
    if (sec != null && !line) reasons.push('抜き書きが節の列挙の1行(「（1）○○」の行の全体)ではない');
    if (!stripSpaces(label)) reasons.push('項目の名前(label)が無い');
    else if (!stripSpaces(quote).includes(stripSpaces(label))) reasons.push('項目の名前(label)が抜き書きに無い');
    else if (line && stripSpaces(label) !== stripSpaces(line.label)) reasons.push('項目の名前(label)が列挙の1行の名前と違う');
    if (typeof row.no !== 'number') reasons.push('番号(no)が無い');
    else {
      const m = toHalf(quote).match(LIST_RE);
      if (!m || Number(m[1]) !== row.no) reasons.push('番号(no)が抜き書きの番号と合わない');
    }
  }

  if (row.kind === 'schedule') {
    if (row.phase !== UNDETERMINED && !PHASES.includes(row.phase)) reasons.push('段(phase)が start・work・completion・判断できない のどれでもない');
    if (!(typeof row.what === 'string' && row.what.trim())) reasons.push('すること(what)が無い');
    else if (row.what !== UNDETERMINED) {
      const missing = missingSubject(row.what, quote, sec);
      if (missing.length) reasons.push('すること(what)の語(' + missing.join('・') + ')が抜き書きに無い');
    }
    if (stripSpaces(quote).length < MIN_QUOTE) reasons.push('抜き書きが短い(' + MIN_QUOTE + '字より少ない)。決まりの文を写す');
    // 言い換えの欄に、原文に無い数字(期日・金額など)を足していないか。
    // when(いつ)の数字は抜き書きの中にだけ探す。what・to は節の列挙((1)〜(4) など)をまとめることがあるので、同じ節の文の中まで探す
    const inQuote = numbersIn(quote);
    const inSection = [...inQuote, ...numbersIn(sec ?? '')];
    for (const [k, pool, where] of [['when', inQuote, '抜き書き'], ['what', inSection, '抜き書きと節'], ['to', inSection, '抜き書きと節']]) {
      const extra = extraNumbers(row[k], pool);
      if (extra.length) reasons.push(k + ' に' + where + 'に無い数字(' + [...new Set(extra)].join('・') + ')');
    }
    const dropped = droppedExclusions(row.when, quote);
    if (dropped.length) reasons.push('when の ' + [...new Set(dropped)].join('・') + ' に、抜き書きの「除き」の条件が無い');
  }
  return reasons;
}

// 行をまとめて照らす。返り値: { kept, dropped: [{ row, reasons }], undetermined: [{ row, fields }] }
export function checkRows(rows, specText) {
  const text = stripPageLines(specText);
  const sections = splitSections(text);
  const kept = [];
  const dropped = [];
  const undetermined = [];
  for (const row of rows || []) {
    const reasons = rowProblems(row, sections, text);
    if (reasons.length) { dropped.push({ row, reasons }); continue; }
    kept.push(row);
    const fields = Object.keys(row).filter((k) => row[k] === UNDETERMINED);
    if (fields.length) undetermined.push({ row, fields });
  }
  return { kept, dropped, undetermined };
}

const rowName = (r) => (r?.kind === 'plan-item' ? `記載項目 (${r.no ?? '?'}) ${r.label ?? ''}` : `段取り ${r?.id ?? ''} ${r?.what ?? ''}`).trim();

const isMain = Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const usage = '使い方: node check-rows.mjs <仕様書の文のファイル> <行のファイル(JSON)> [--out <ファイル>]\n        node check-rows.mjs --list <節の番号> <仕様書の文のファイル>';
  if (args[0] === '--list') {
    const [, section, file] = args;
    if (!section || !file) { console.error(usage); process.exit(2); }
    const sec = splitSections(stripPageLines(fs.readFileSync(file, 'utf8'))).get(section);
    if (sec == null) { console.error('節 ' + section + ' の見出しが原文に見つからない'); process.exit(1); }
    console.log(JSON.stringify({ rows: listItems(sec, section) }, null, 2));
    process.exit(0);
  }
  const outIdx = args.indexOf('--out');
  const out = outIdx >= 0 ? args[outIdx + 1] : null;
  const [specFile, rowsFile] = outIdx >= 0 ? args.filter((a, i) => i !== outIdx && i !== outIdx + 1) : args;
  if (!specFile || !rowsFile) { console.error(usage); process.exit(2); }
  const spec = fs.readFileSync(specFile, 'utf8');
  const data = JSON.parse(fs.readFileSync(rowsFile, 'utf8'));
  const r = checkRows(Array.isArray(data) ? data : data.rows, spec);
  for (const row of r.kept) console.log('残す\t' + rowName(row));
  for (const d of r.dropped) console.log('外す\t' + rowName(d.row) + '\t' + d.reasons.join(' / '));
  for (const u of r.undetermined) console.log('判断できない欄\t' + rowName(u.row) + '\t' + u.fields.map((f) => f + ': ' + u.row.undetermined[f]).join(' / '));
  console.log(`行 ${r.kept.length + r.dropped.length} のうち 残す ${r.kept.length}・外す ${r.dropped.length}(判断できない欄のある行 ${r.undetermined.length})`);
  if (out) fs.writeFileSync(out, JSON.stringify({ ...(data.source ? { source: data.source } : {}), rows: r.kept }, null, 2) + '\n');
  process.exit(r.dropped.length ? 1 : 0);
}

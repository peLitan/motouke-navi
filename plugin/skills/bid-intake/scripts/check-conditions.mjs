#!/usr/bin/env node
// 公告・入札説明書・仕様書から Claude が拾った条件を、原文と機械で照らす(F41a)
// - 抜き書きが原文に無い値、値が抜き書きに無い値は外す
// - 単位・桁・前後の食い違いは、外さずに「確かめが要る」にして理由を付ける
// - 書いていないとされた条件の見出しの語が原文にあれば「確かめが要る」にする
// - 画面に入れてよい値だけを form に書く(確かめが要る値は入れない)
// 使い方: node check-conditions.mjs <拾った条件.json> <原文のファイル ...> [--out <画面用.json>] [--md <人が読む表.md>]
// 値を外したら終了コード 1。AI も通信も使わない。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyQuote, stripSpaces } from './lib/quote-check.mjs';

export const STATUS = { ok: '拾えた', check: '確かめが要る', absent: '公告に書いていない' };
export const KIND = 'bid-intake';
const MIN_QUOTE = 4; // 空白を除いた字数。短すぎる語句は、どこにでもあり根拠にならない
const SMALL_YEN = 1000000; // 工事の金額としては小さい額(単位の落ちを疑う目安。法令の境目ではない)
const NEAR = 30; // 見出しの語のあと、金額が始まる所を探す字数

// single: 値は1つのはずの欄。match: 値と抜き書きの照らし方(name は値が抜き書きの中の文字列、money は金額、number は値の数字)
export const KEYS = [
  { key: 'orderer-name', label: '発注者', words: ['発注者', '発注機関', '契約担当官'], single: true, match: 'name' },
  { key: 'work-name', label: '工事名', words: ['工事名', '工事件名'], single: true, match: 'name', line: true },
  { key: 'site', label: '工事場所', words: ['工事場所', '施工場所', '工事箇所'], single: true, match: 'name', line: true },
  { key: 'period', label: '工期', words: ['工期', '履行期間'], single: true, match: 'number', line: true },
  { key: 'bid-date', label: '入札の日時', words: ['入札日時', '開札日時', '入札書の提出期限', '入札の日時'], single: true, match: 'number', line: true },
  { key: 'budget', label: '予定価格', words: ['予定価格'], single: true, match: 'money' },
  { key: 'low-limit', label: '最低制限価格・調査基準価格', words: ['最低制限価格', '調査基準価格'], single: true, match: 'money' },
  { key: 'work-class', label: '工事の種類', words: ['工事の種類', '建設工事の種類', '工種'], single: true, match: 'number' },
  { key: 'work-content', label: '工事の内容', words: ['工事内容', '工事の内容', '工事の概要', '工事概要'], match: 'number' },
  { key: 'grade', label: '等級', words: ['等級', '格付', '総合評定値'], match: 'number' },
  { key: 'license-req', label: '求める建設業の許可', words: ['建設業の許可', '建設業許可', '特定建設業', '一般建設業'], match: 'number' },
  { key: 'region', label: '地域の要件', words: ['本店', '主たる営業所', '営業所を有'], match: 'number' },
  { key: 'past-work', label: '施工実績', words: ['施工実績', '同種工事', '同種の工事'], match: 'number' },
  { key: 'engineer', label: '技術者の要件', words: ['配置予定技術者', '監理技術者', '主任技術者'], match: 'number' },
  { key: 'subcontract', label: '下請けの扱い', words: ['下請'], match: 'number' },
];
const KEY = new Map(KEYS.map((k) => [k.key, k]));

// 画面の欄のうち、公告からは決められないもの
export const COMPANY_FIELDS = [
  ['direct', '元請けか下請けか', '自社がどの立場で入るかは公告に書いていない'],
  ['subcontract-total', '下請けの総額', '会社が決める額'],
  ['license', '元請けの許可の種類', '求める許可は公告にあっても、自社が持つ許可は公告に書いていない'],
  ['engineer-qualification', '置ける技術者の資格', '求める資格は公告にあっても、自社が置ける人は公告に書いていない'],
];

const KANJI = '〇零一二三四五六七八九十百千';
const DIGIT = { 〇: 0, 零: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
const PLACE = { 十: 10, 百: 100, 千: 1000 };
export const toHalf = (s) => String(s ?? '').replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/，/g, ',').replace(/．/g, '.');

// 「3百」「千二百」「1234」(桁区切りは除いてある)を数にする
function smallValue(run) {
  let total = 0;
  let cur = null;
  for (const c of run) {
    if (c in PLACE) { total += (cur ?? 1) * PLACE[c]; cur = null; } else cur = (cur ?? 0) * 10 + (DIGIT[c] ?? Number(c));
  }
  return total + (cur ?? 0);
}

const NUM = `[0-9,.${KANJI}]`;
// 億・万・千・百・円の前後の空白。\s は改行を含み、表の行をまたいで読むので使わない。toHalf は全角の空白を変えないので字で書く
const GAP = '[ \\t　]*';
// 「円」で始まる語(「3 円滑に」「120 円形の管」)の円は額の単位ではない
const NOT_YEN_NEXT = '滑形周盤筒柱錐弧';
const MAX_RUN = 40; // 額として読む数字の並びの字数の上限。超えた並びは額ではない
// 算用数字の後なら、空白を挟んだ千・百も並びの続き(「134,200 千円」「3 千万円」)。漢数字の後は見出しの番号かもしれないので続きにしない(「二 千円」)
const RUN = `${NUM}{1,${MAX_RUN}}(?:(?<=[0-9])${GAP}[百千])?`;
const PARTS = `(?:(${RUN})${GAP}億${GAP})?(?:(${RUN})${GAP}万${GAP})?(?:(${RUN})${GAP})?`;
const YEN_WORD = `円(?![${NOT_YEN_NEXT}])`;
const YEN_MARK = '[¥￥]';
const AFTER_MARK = '[-－ー―‐−–—]'; // 「￥134,200,000-」の末尾の線。書き足しを防ぐ印で、額ではない
// 円の印だけで「円」の無い額は、算用数字に単位が空白なしで付いた形だけを読む。額の続きかもしれない物が後ろにあれば、途中までの数にせず読まない:
// 空白を挟んだ十・百・千・万・億(額の続きか、「￥134,200,000 千代田区」の次の語かを字では決められない)、単位で終わる額の後の空白と数字(「￥1億 3,420万」)
const BARE_RUN = `[0-9][0-9,.百千]{0,${MAX_RUN - 1}}`;
const BARE = `(?:(${BARE_RUN})億)?(?:(${BARE_RUN})万)?(${BARE_RUN})?(?!${NUM}|${GAP}[十百千万億])(?<![百千万億](?=${GAP}[0-9]))${AFTER_MARK}?`;
// 長い1行で固まらないよう、並びの頭からだけ読み、空白の繰り返しを隣り合わせない(「億」の後の空白と「円」の前の空白は1つにまとまる)
// 印の直後は算用数字に限る(「￥千円」「￥百万」は表の見出しの単位)
const AMOUNT_RE = new RegExp(`${YEN_MARK}${GAP}(?=[0-9])(?:${PARTS}${YEN_WORD}|${BARE})|(?<!${NUM})${PARTS}${YEN_WORD}`, 'g');
// 空白で区切られた額の途中から読み始めた所(「3 千 5 百万円」の「5 百万円」、「3 千500万円」の「千500万円」)。
// 後ろの一部だけを読むと小さい額のまま「拾えた」になる。AMOUNT_RE の中で断ると次の頭からさらに後ろを読むので、読んだ額を丸ごと捨てる
const MID_AMOUNT = new RegExp(`(?<=[十百千]${GAP}|[0-9]${GAP}(?=[十百千]))(?!${YEN_MARK})`, 'y');
const midAmount = (s, index) => { MID_AMOUNT.lastIndex = index; return MID_AMOUNT.test(s); };
const UNIT_WORD = new RegExp(`^(?:千|百${GAP}万)${GAP}円$`);
const groupsBad = (run) => run.includes(',') && !/^[0-9]{1,3}(,[0-9]{3})+(\.[0-9]+)?$/.test(run);
const noSpace = (run) => run.replace(/[ \t　]/g, '');
// 末尾の点は小数点ではない(「￥134,200,000.-」)
const noEndDot = (run) => run.replace(/\.$/, '');

// 並び1つの数。「1.2億円」「12.5万円」「134.2百万円」の小数も読む
function runValue(run = '') {
  const t = noEndDot(noSpace(run).replace(/,/g, ''));
  const dec = t.match(/^([0-9]*\.[0-9]+)([百千]?)$/);
  return dec ? Number(dec[1]) * (PLACE[dec[2]] ?? 1) : smallValue(t);
}

// 文の中の金額を円の数にする。{ yen, raw, index, badComma }。全角・漢数字・億・万・千円・百万円・円の印を読む
export function parseAmounts(text) {
  const s = toHalf(text);
  const out = [];
  for (const m of s.matchAll(AMOUNT_RE)) {
    const raw = m[0];
    const [oku, man, rest] = [1, 2, 3].map((i) => m[i] ?? m[i + 3] ?? m[i + 6]);
    const parts = [oku, man, rest].filter(Boolean);
    if (!parts.length || UNIT_WORD.test(raw) || midAmount(s, m.index)) continue; // 「単位:千円」の語は額ではない
    const yen = Math.round(runValue(oku) * 1e8 + runValue(man) * 1e4 + runValue(rest));
    if (!Number.isFinite(yen) || yen === 0) continue; // 「1.2.3円」のような並びは数にならない
    out.push({ yen, raw, index: m.index, badComma: parts.some((p) => groupsBad(noEndDot(noSpace(p).replace(/[百千]$/, '')))) });
  }
  return out;
}

const ERAS = { 令和: 2018, 平成: 1988, R: 2018, H: 1988 };
const DATE_RE = /(?:(令和|平成|R|H)\s*(\d+|元)\s*年|(?<!\d)(\d{4})\s*年)\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/g;
// 日付の中の漢数字を数字にする(「令和九年四月一日」)
const dateDigits = (s) => toHalf(s).replace(new RegExp(`(?<![${KANJI}])[${KANJI}]+(?=\\s*[年月日])`, 'g'), (r) => String(smallValue(r)));

// 文の中の日付。{ raw, y, m, d, time, valid }。time は比べられる数(日)
export function parseDates(text) {
  const s = dateDigits(text);
  const out = [];
  for (const m of s.matchAll(DATE_RE)) {
    const y = m[1] ? ERAS[m[1]] + (m[2] === '元' ? 1 : Number(m[2])) : Number(m[3]);
    const mo = Number(m[4]);
    const d = Number(m[5]);
    const dt = new Date(Date.UTC(y, mo - 1, d));
    out.push({ raw: m[0], y, m: mo, d, time: dt.getTime() / 864e5, valid: dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d });
  }
  return out;
}

// 値の数字の列。漢数字は単位が続くときだけ数字にする(「一式」「一括」を数にしない)
function numberTokens(s) {
  const t = toHalf(s).replace(/(\d),(?=\d)/g, '$1').replace(new RegExp(`(?<![${KANJI}])[${KANJI}]+(?=\\s*(?:年|月|日|か月|箇月|ヶ月|人|名|級|点|件|回))`, 'g'), (r) => String(smallValue(r)));
  return t.match(/\d+/g) ?? [];
}

// 税の書き方。'out' 税抜き、'in' 税込み、null 書いていない
export function taxState(text) {
  const s = String(text ?? '');
  if (/税抜|税別|(?:消費税|相当額|相当する額)[^。\n]{0,30}(?:含まない|含まず|除く|除いた)/.test(s)) return 'out';
  if (/税込|(?:消費税|相当額|相当する額)[^。\n]{0,30}含む/.test(s)) return 'in';
  return null;
}

// 原文の「(単位:千円)」の宣言
export function declaredUnit(text) {
  const m = toHalf(text).match(new RegExp(`単位\\s*(?:[:：]\\s*)?(百${GAP}万${GAP}円|千${GAP}円|万${GAP}円)`));
  if (!m) return null;
  const word = m[1].replace(new RegExp(GAP, 'g'), '');
  return { word, yen: { 千円: 1e3, 万円: 1e4, 百万円: 1e6 }[word] };
}

const rel = (a, b) => {
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  const r = hi / lo;
  if (Number.isInteger(Math.log10(r))) return '桁が違う';
  if (Math.abs(r - 1.1) < 0.0005) return '税の差かもしれない';
  return '金額が違う';
};
const yenText = (n) => n.toLocaleString('en-US') + '円';
const LINE_HEAD = 2000; // 1行のうち、見出しと日付の拾いに使う先頭の字数
const linesOf = (sources) => sources.flatMap((s) => s.text.split(/\r\n|[\n\r\u2028\u2029]/).map((line, i) => ({ file: s.file, no: i + 1, line })));
const where = (l) => `${l.file} ${l.no}行目`;

// 見出しの語のすぐあとで始まる金額(境目の説明「1億円以上」は除く)。
// 先に字数で切ると円の印の額が切れた所までの数になるので、読んでから位置で選ぶ
function labelledAmounts(sources, words) {
  const out = [];
  for (const l of linesOf(sources)) {
    const s = toHalf(l.line);
    const w = words.find((x) => s.includes(x));
    if (!w) continue;
    const after = s.slice(s.indexOf(w) + w.length);
    const a = parseAmounts(after)[0];
    if (a && a.index < NEAR && !/^\s*(?:以上|以下|未満|を超え)/.test(after.slice(a.index + a.raw.length))) out.push({ ...l, yen: a.yen, raw: a.raw });
  }
  return out;
}

// 見出しの行の本文の末尾から落とす字
const BODY_TAIL = /[\s　|]/;

// 行の頭が見出しの語で始まる行の中身(「工事名: ○○」「| 工事名 | ○○ |」「2 工事名 ○○」)
function labelledLines(sources, words) {
  const head = new RegExp(`^[\\s　|#*\\-・]*(?:[(（]?[0-9０-９]+[)）.．]?[\\s　]*)?(?:${words.join('|')})([\\s　]*[:：|][\\s　|]*|[\\s　]+)`);
  const out = [];
  for (const l of linesOf(sources)) {
    const line = l.line.slice(0, LINE_HEAD);
    const m = line.match(head);
    if (!m) continue;
    const rest = line.slice(m[0].length);
    let end = rest.length;
    while (end > 0 && BODY_TAIL.test(rest[end - 1])) end--;
    if (end > 0) out.push({ ...l, body: rest.slice(0, end) });
    else if (m[1].length > 1) out.push({ ...l, body: m[1].at(-1) }); // 本文の無い行(「| 工事名 | |」)は語の後の最後の1字
  }
  return out;
}

// 値が抜き書きに合わないときの理由(外す)。合えば null
function valueProblem(c, def, unit) {
  const value = String(c.value).trim();
  if (def.match === 'name') return stripSpaces(c.quote).includes(stripSpaces(value)) ? null : '値が抜き書きの中に無い';
  if (def.match === 'money') {
    const a = parseAmounts(value)[0];
    if (!a) return '金額の値に「円」が無い';
    if (parseAmounts(c.quote).some((q) => q.yen === a.yen)) return null;
    const bare = (toHalf(c.quote).match(/\d[\d,]*/g) ?? []).map((x) => Number(x.replace(/,/g, '')));
    // 単位の無い表の数は、ここでは外さず moneyFlags で確かめる
    if (bare.includes(a.yen) || (unit && bare.includes(a.yen / unit.yen))) return null;
    return '値の金額が抜き書きに無い';
  }
  const q = numberTokens(c.quote);
  const missing = numberTokens(value).filter((n) => !q.includes(n));
  return missing.length ? '値の数字が抜き書きに無い: ' + missing.join('・') : null;
}

function moneyFlags(c, def, sources, unit) {
  const flags = [];
  const a = parseAmounts(c.value)[0];
  const q = parseAmounts(c.quote);
  const bad = q.find((x) => x.badComma) ?? (a.badComma ? a : null);
  if (bad) flags.push('桁区切りの位置がおかしい: ' + bad.raw);
  if (!q.some((x) => x.yen === a.yen)) {
    if (!unit) flags.push('抜き書きの数に単位が無く、原文に単位の宣言も無い');
    else {
      const digits = toHalf(c.quote).replace(/,/g, '');
      if (!digits.includes(String(a.yen / unit.yen))) flags.push(`原文に「単位:${unit.word}」とある。値はこの単位を掛けていない`);
    }
  }
  if (a.yen < SMALL_YEN) flags.push(yenText(a.yen) + ' は工事の金額としては小さい。単位が落ちていないか');
  for (const l of labelledAmounts(sources, def.words)) {
    if (l.yen !== a.yen) flags.push(`${where(l)} の「${l.raw}」と違う(${rel(a.yen, l.yen)})`);
  }
  return flags;
}

function dateFlags(c, def, sources) {
  const flags = [];
  const dates = parseDates(c.quote);
  for (const d of dates) if (!d.valid) flags.push(`暦に無い日付: ${d.raw}`);
  const ok = dates.filter((d) => d.valid);
  if (ok.length >= 2) {
    const [from, to] = ok;
    if (from.time >= to.time) flags.push(`始めの日が終わりの日より後: ${from.raw} → ${to.raw}`);
    const days = toHalf(c.quote).match(/(\d+)\s*日間/);
    if (days) {
      const span = to.time - from.time + 1;
      if (Math.abs(span - Number(days[1])) > 1) flags.push(`${days[0]} と、日付から数えた ${span} 日が合わない`);
    }
  }
  const mine = ok.map((d) => d.time).join();
  for (const l of labelledLines(sources, def.words)) {
    const other = parseDates(l.body).filter((d) => d.valid);
    if (other.length && other.map((d) => d.time).join() !== mine) flags.push(`${where(l)} の日付と違う: ${l.body}`);
  }
  return flags;
}

function textFlags(c, def, sources) {
  const v = stripSpaces(c.value);
  return labelledLines(sources, def.words)
    .filter((l) => { const b = stripSpaces(l.body); return !b.includes(v) && !v.includes(b); })
    .map((l) => `${where(l)} は「${l.body}」で、値と違う`);
}

// 元号と西暦を並べて書いた所の食い違い(文書全体)
export function eraConflicts(sources) {
  const out = [];
  const re = /(令和|平成)\s*(\d+|元)\s*年\s*[(（]\s*(\d{4})\s*年?\s*[)）]/g;
  for (const l of linesOf(sources)) {
    for (const m of dateDigits(l.line.slice(0, LINE_HEAD)).matchAll(re)) {
      const y = ERAS[m[1]] + (m[2] === '元' ? 1 : Number(m[2]));
      if (y !== Number(m[3])) out.push(`${where(l)} の「${m[0]}」は ${y}年 で合わない`);
    }
  }
  return out;
}

// 欄をまたいだ確かめ
function crossFlags(rows) {
  const one = (key) => rows.find((r) => r.key === key);
  const budget = one('budget');
  const low = one('low-limit');
  if (budget && low) {
    const b = parseAmounts(budget.value)[0].yen;
    const l = parseAmounts(low.value)[0].yen;
    if (l >= b) low.flags.push(`${yenText(l)} は 予定価格 ${yenText(b)} 以上`);
  }
  const period = one('period');
  const bid = one('bid-date');
  if (period && bid) {
    const ds = parseDates(period.quote).filter((d) => d.valid);
    const b = parseDates(bid.quote).find((d) => d.valid);
    if (ds.length >= 2 && b && b.time > ds[0].time) bid.flags.push(`入札の日 ${b.raw} が工期の始め ${ds[0].raw} より後`);
  }
}

// 画面の欄に入れる値を決める。確かめが要る値は入れない
function buildForm(rows) {
  const form = {};
  const skipped = [];
  const only = (key) => { const list = rows.filter((r) => r.key === key); return list.length === 1 ? list[0] : null; };
  const why = (r, reason) => (r?.status === STATUS.ok ? reason : r?.status ?? '値が2つある');
  const orderer = only('orderer-name');
  const o = orderer?.form?.orderer;
  if (orderer?.status === STATUS.ok && (o === 'public' || o === 'private')) form.orderer = o;
  else skipped.push(['orderer', '発注者', why(orderer, '公共か民間かが拾った条件に無い')]);
  const cls = only('work-class');
  const wt = cls?.form?.['work-type'];
  const ikkatsu = cls ? stripSpaces(cls.quote).includes('建築一式') : false;
  if (cls?.status === STATUS.ok && ((wt === 'kenchiku-ikkatsu' && ikkatsu) || (wt === 'other' && !ikkatsu))) form['work-type'] = wt;
  else skipped.push(['work-type', '工事の種類', why(cls, '建築一式かどうかが抜き書きと合わない')]);
  const budget = only('budget');
  if (budget?.status === STATUS.ok && budget.tax === 'in') form['contract-amount'] = String(parseAmounts(budget.value)[0].yen);
  else skipped.push(['contract-amount', '請負代金の見込み', why(budget, '税抜きの額で、欄は税込み。税を足す計算はしない')]);
  return { form, skipped };
}

function labelledTax(sources, words) {
  for (const l of linesOf(sources)) {
    if (!words.some((w) => l.line.includes(w))) continue;
    const t = taxState(l.line);
    if (t) return t;
  }
  return null;
}

// 拾った条件を原文と照らす。sources: [{ file, text }]
export function checkConditions(data, sources) {
  const rows = [];
  const removed = [];
  const unit = declaredUnit(sources.map((s) => s.text).join('\n'));
  const fileOf = (name) => sources.find((s) => s.file === name);
  const said = new Set();
  for (const c of data?.conditions ?? []) {
    const def = KEY.get(c?.key);
    const out = (reason) => removed.push({ key: c?.key ?? '', label: def?.label ?? String(c?.key ?? ''), value: String(c?.value ?? ''), quote: String(c?.quote ?? ''), reason });
    if (!def) { out('決めた欄の名前ではない'); continue; }
    said.add(c.key);
    if (c.absent === true) continue;
    const q = String(c.quote ?? '');
    if (String(c.value ?? '').trim() === '') { out('値が空'); continue; }
    if (stripSpaces(q).length < MIN_QUOTE) { out('抜き書きが短すぎる'); continue; }
    if (c.file != null && !fileOf(c.file)) { out('渡されていないファイルを指している: ' + c.file); continue; }
    const at = (c.file != null ? [fileOf(c.file)] : sources).find((s) => verifyQuote(q, s.text));
    if (!at) { out('抜き書きが原文に無い'); continue; }
    const problem = valueProblem({ ...c, quote: q }, def, unit);
    if (problem) { out(problem); continue; }
    const row = { key: c.key, label: def.label, value: String(c.value).trim(), quote: q, file: at.file, flags: [] };
    if (c.note) row.note = String(c.note);
    if (c.form) row.form = c.form;
    if (def.match === 'money') {
      row.flags.push(...moneyFlags(row, def, sources, unit));
      row.tax = taxState(q) ?? labelledTax(sources, def.words);
      if (c.key === 'budget' && row.tax == null) row.flags.push('税込みか税抜きかが、この額の行に書いていない');
    }
    if (c.key === 'period' || c.key === 'bid-date') row.flags.push(...dateFlags(row, def, sources));
    else if (def.line) row.flags.push(...textFlags(row, def, sources));
    rows.push(row);
  }
  for (const def of KEYS.filter((d) => d.single)) {
    const list = rows.filter((r) => r.key === def.key);
    if (new Set(list.map((r) => stripSpaces(r.value))).size > 1) for (const r of list) r.flags.push('同じ欄に違う値が2つある');
  }
  crossFlags(rows);
  const blank = (def, flags, absent) => ({ key: def.key, label: def.label, value: '', quote: '', flags, absent });
  for (const def of KEYS) {
    if (rows.some((r) => r.key === def.key)) continue;
    if (removed.some((r) => r.key === def.key)) { rows.push(blank(def, ['拾った値が原文と合わず外した'], false)); continue; }
    const seen = linesOf(sources).find((l) => def.words.some((w) => l.line.includes(w)));
    if (seen) rows.push(blank(def, [`${said.has(def.key) ? '書いていないとされた' : '拾っていない'}が、${where(seen)} に語がある: ${seen.line.trim().slice(0, 40)}`], false));
    else rows.push(blank(def, [], true));
  }
  for (const r of rows) r.status = r.absent ? STATUS.absent : r.flags.length ? STATUS.check : STATUS.ok;
  rows.sort((a, b) => KEYS.findIndex((k) => k.key === a.key) - KEYS.findIndex((k) => k.key === b.key));
  const { form, skipped } = buildForm(rows);
  return {
    kind: KIND,
    source: data?.source ?? {},
    form,
    formSkipped: skipped.map(([id, label, reason]) => ({ id, label, reason })),
    companyFields: COMPANY_FIELDS.map(([id, label, reason]) => ({ id, label, reason })),
    rows: rows.map(({ absent, form: _form, ...r }) => r),
    removed,
    documentFlags: eraConflicts(sources),
    claudeNotes: (data?.notes ?? []).map((n) => ({ text: String(n?.text ?? ''), quote: String(n?.quote ?? ''), found: n?.quote ? sources.some((s) => verifyQuote(n.quote, s.text)) : null })),
  };
}

const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

// 人が読む表(Markdown)
export function renderMarkdown(r) {
  const s = [];
  s.push(`# 公告から拾った条件: ${r.source.title ?? '(題名なし)'}`, '');
  s.push('拾った値の候補です。入札に参加できるかの判断ではありません。最後は人が原文で確かめてください。', '');
  s.push('| 条件 | 状態 | 値 | 原文の抜き書き | 確かめること |', '|---|---|---|---|---|');
  for (const x of r.rows) s.push(`| ${cell(x.label)} | ${x.status} | ${cell(x.value)} | ${cell(x.quote)} | ${cell(x.flags.join(' / '))} |`);
  const section = (title, items) => s.push('', '## ' + title, '', ...(items.length ? items.map((x) => '- ' + x) : ['- なし']));
  section('機械が外した値', r.removed.map((x) => `${x.label}「${x.value}」: ${x.reason}`));
  section('文書全体で機械が見つけた食い違い', r.documentFlags);
  section('Claude が気づいたこと(機械の確かめではない)', r.claudeNotes.map((n) => n.text + (n.quote ? `(抜き書き「${n.quote}」: ${n.found ? '原文にある' : '原文に見つからない'})` : '')));
  section('画面に入る値', [
    ...Object.entries(r.form).map(([k, v]) => `${k}: ${v}`),
    ...r.formSkipped.map((x) => `入らない ${x.label}: ${x.reason}`),
    ...r.companyFields.map((x) => `公告からは分からない ${x.label}: ${x.reason}`),
  ]);
  s.push('');
  return s.join('\n');
}

export function summaryLine(r) {
  const n = (st) => r.rows.filter((x) => x.status === st).length;
  return `条件 ${r.rows.length} 行のうち 拾えた ${n(STATUS.ok)}・確かめが要る ${n(STATUS.check)}・公告に書いていない ${n(STATUS.absent)}(外した値 ${r.removed.length})`;
}

const isMain = Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const take = (flag) => { const i = args.indexOf(flag); if (i < 0) return null; const v = args[i + 1]; args.splice(i, 2); return v; };
  const out = take('--out');
  const md = take('--md');
  const [dataFile, ...files] = args;
  if (!dataFile || !files.length) { console.error('使い方: node check-conditions.mjs <拾った条件.json> <原文のファイル ...> [--out <画面用.json>] [--md <人が読む表.md>]'); process.exit(2); }
  const data = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  const sources = files.map((f) => ({ file: path.basename(f), text: fs.readFileSync(f, 'utf8') }));
  const r = checkConditions(data, sources);
  for (const x of r.rows) console.log([x.status, x.label, x.value, x.flags.join(' / ')].join('\t'));
  for (const x of r.removed) console.log(['外す', x.label, x.value, x.reason].join('\t'));
  for (const x of r.documentFlags) console.log('文書\t' + x);
  console.log(summaryLine(r));
  if (out) fs.writeFileSync(out, JSON.stringify(r, null, 2) + '\n');
  if (md) fs.writeFileSync(md, renderMarkdown(r));
  process.exit(r.removed.length ? 1 : 0);
}

#!/usr/bin/env node
// 点検の結果(指摘の文)に書かれた条番号が、取得した原文(reference/sources/ の law-*.txt)にあるかを確かめる(F20b)
// 使い方: node check-articles.mjs <指摘のファイル(文か JSON)>
//         ファイルを渡さなければ標準入力から読む
//         Skill の手順では、同じ処理を MCP の道具 check_articles で呼ぶ(F56a。このファイルの formatResults が同じ文を返す)
// 出力: 1つの条番号ごとに「ある」「無い」「確かめられない」と理由。1つでも「無い」「確かめられない」があれば終了コード 1
// 確かめるのは「その条・項・号・細分が取得した原文にあるか」だけ。指摘の中身が条の文に合っているかは確かめない
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { paragraphOf, itemOf, subitemOf } from './lib/quote-check.mjs';

const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCES_DIR = path.join(SKILL_DIR, 'reference', 'sources');

// 法令の名前(長いものから並べる)。略した名前は正式な名前に寄せる
// 「法」「令」だけの書き方は、どの法令か決められないので「確かめられない」にする
// この一覧に無い法令名が条番号の前にあれば、理由を「この道具が取り込んでいない法令」にする(F81c。名前の一覧は持たず、字の並びで見る)
const LAW_NAMES = [
  ['公共工事の入札及び契約の適正化の促進に関する法律', '公共工事の入札及び契約の適正化の促進に関する法律'],
  ['入札契約適正化法', '公共工事の入札及び契約の適正化の促進に関する法律'],
  ['建設業法施行規則', '建設業法施行規則'],
  ['建設業法施行令', '建設業法施行令'],
  ['建設業法', '建設業法'],
];

const NUM = '[0-9０-９]+|[〇一二三四五六七八九十百]+';
const KANA = '[イロハニホヘトチリヌルヲワカヨタレソツネナラム]';
const REF_RE = new RegExp(
  '(' + LAW_NAMES.map(([n]) => n).join('|') + ')?' +
  '[\\s　]*第(' + NUM + ')条(?:の(' + NUM + '))?' +
  '(?:第(' + NUM + ')項)?' +
  // 号の細分(イ・ロ…)は号のすぐ後だけを見る(「第3条チェック」のチを細分と読まないため)
  '(?:第(' + NUM + ')号(' + KANA + ')?)?',
  'g'
);

const KD = { 〇: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
// 算用数字(全角を含む)か漢数字(百まで)を整数にする
export function toInt(s) {
  if (s == null) return null;
  const half = String(s).replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
  if (/^\d+$/.test(half)) return Number(half);
  let total = 0;
  let cur = 0;
  for (const ch of half) {
    if (ch === '百') { total += (cur || 1) * 100; cur = 0; }
    else if (ch === '十') { total += (cur || 1) * 10; cur = 0; }
    else if (ch in KD) cur = cur * 10 + KD[ch];
    else return null;
  }
  return total + cur;
}

// reference/sources/index.json から法令の原文を読む。返り値: [{ law, article, title, text }]
export function loadSources(dir = SOURCES_DIR) {
  const { sources } = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
  return sources
    .filter((s) => s.kind === 'law' && s.file && fs.existsSync(path.join(dir, s.file)))
    .map((s) => ({ law: s.law, article: String(s.article), title: s.title, text: fs.readFileSync(path.join(dir, s.file), 'utf8') }));
}

// 条番号の前の書き方の見分け(F81c)。見るのは条番号のすぐ前の短い所だけにする(文の全体に正規表現を当てると、長い1行で固まるため)
// 法令名に使う字: 漢字・平仮名・片仮名・長音・々・〆・ヶ・英字(「ＰＦＩ法」のような略した名前)
const NAME_CHAR = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー々〆ヶA-Za-zＡ-Ｚａ-ｚ]/u;
const LOOK_BACK = 24;
// 法令の種類を表す語。「〜法」「〜令」「〜規則」「〜条例」と「〜法律」。「施行令」「施行規則」も種類の語として外して、前に名前が残るかを見る
const LAW_KIND = '施行規則|施行令|法律|法令|政令|省令|府令|規則|条例|法|令';
const KIND_TAIL = new RegExp('(?:' + LAW_KIND + ')+$', 'u');
const KIND_HEAD = new RegExp('^(?:' + LAW_KIND + ')', 'u');
// 種類の語の前がこれらの語なら名前ではない(前に出た法令を指す語など)。漢字の語は、前が名前の続きでないときだけ(「環境基本法」の「本」は名前の続き)
const NOT_NAME = /(?:^|\p{Script=Hiragana})(?:同|本|旧|新|当該|前記|上記|下記|関係|現行|改正|各|他|諸|両)$|(?:この|その|あの)$/u;
// 平仮名のすぐ後では名前の続きにならない種類の語(「…ので法第24条の8」「…は施行令第27条」)。「…に関する法律」「…に関する条例」は名前
const BARE_AFTER_KANA = new Set(['法', '令', '法令', '施行令', '施行規則']);
// 助詞の字のすぐ後の種類の語は、どれも名前でなく前に出た法令を指す書き方(「根拠は規則第14条の2」「市の条例第3条」)。
// 名前の終わりの平仮名は「…に関する」「…を定める」のような動詞の形が多い。助詞の字で終わる名前(「…の条例」など)は、取り込んでいない法令でも「法令名が書かれていない」になる
const PARTICLE_END = /[はがをにでもへやとの]$/u;
// 前の条番号の法令名を引き継ぐつなぎの語(この3つだけ。「又は」「と」などでは引き継がない)
const LINKS = ['及び', '並びに', '、'];

// text の end より前に、取り込んだ一覧に無い法令名が書かれているか。end は条番号の「第」の前の空白の始まり(空白は飛ばしてある)
function namesOtherLaw(text, end) {
  let start = end;
  while (start > 0 && end - start < LOOK_BACK && NAME_CHAR.test(text[start - 1])) start--;
  const run = text.slice(start, end);
  const kind = run.match(KIND_TAIL);
  if (!kind || kind.index === 0) return false;
  const stem = run.slice(0, kind.index);
  if (NOT_NAME.test(stem) || PARTICLE_END.test(stem)) return false;
  if (/\p{Script=Hiragana}$/u.test(stem) && BARE_AFTER_KANA.has(kind[0].match(KIND_HEAD)[0])) return false;
  return true;
}

// from から to までに行の切れ目があるか
function crossesLine(text, from, to) {
  for (let i = from; i < to; i++) {
    const c = text.charCodeAt(i);
    if (c === 10 || c === 13 || c === 0x2028 || c === 0x2029) return true;
  }
  return false;
}

// 文から条番号を取り出す。返り値: [{ raw, law, unknownLaw, article, paragraph, item, subitem }]
// law は取り込んだ法令の名前か null。unknownLaw は、取り込んだ一覧に無い法令名が書かれていたとき true(law は null のまま)
// 「及び」「並びに」「、」のすぐ後(空白は挟んでよい)が素の「第」なら、同じ行の直前の条番号の法令名を引き継ぐ。「法第」「同法第」は引き継がない
export function extractRefs(text) {
  const refs = [];
  const s = String(text ?? '');
  let prev = null;
  for (const m of s.matchAll(REF_RE)) {
    let law = m[1] ? LAW_NAMES.find(([n]) => n === m[1])[1] : null;
    let unknownLaw = false;
    if (!m[1]) {
      const dai = m.index + m[0].indexOf('第');
      const linked = LINKS.some((w) => m.index >= w.length && s.startsWith(w, m.index - w.length));
      if (linked && prev && !crossesLine(s, prev.end, dai)) ({ law, unknownLaw } = prev);
      else unknownLaw = namesOtherLaw(s, m.index);
    }
    prev = { end: m.index + m[0].length, law, unknownLaw };
    const a = toInt(m[2]);
    const sub = m[3] != null ? toInt(m[3]) : null;
    refs.push({
      raw: m[0].trim(),
      law,
      unknownLaw,
      article: sub != null ? `${a}の${sub}` : String(a),
      paragraph: m[4] != null ? toInt(m[4]) : null,
      item: m[5] != null ? toInt(m[5]) : null,
      subitem: m[6] ?? null,
    });
  }
  return refs;
}

const label = (r) => `${r.law ?? (r.unknownLaw ? '(取り込んでいない法令)' : '(法令名なし)')} 第${r.article.replace(/^(\d+)(?:の(\d+))?$/, (_, a, b) => a + '条' + (b ? 'の' + b : ''))}` +
  (r.paragraph != null ? `第${r.paragraph}項` : '') + (r.item != null ? `第${r.item}号` : '') + (r.subitem ?? '');

// 1つの条番号を確かめる。返り値: { status: 'ある' | '無い' | '確かめられない', reason }
export function checkRef(r, sources) {
  // 取り込んでいない法令名は、名前を返事に写さない(指摘の文を返事に入れないため)
  if (!r.law && r.unknownLaw) return { status: '確かめられない', reason: 'この道具が取り込んでいない法令(取り込んだ法令の名前に無い。取り込んだ法令を略して書いたなら、正式な名前で書き直す)' };
  if (!r.law) return { status: '確かめられない', reason: '法令名が書かれていない(「法」「令」だけ・同条などは、どの法令か決められない)' };
  const src = sources.find((s) => s.law === r.law && s.article === r.article);
  if (!src) return { status: '無い', reason: '取得した原文に無い条(このプラグインはこの条を見ていない)' };
  let scope = src.text;
  if (r.paragraph != null) {
    scope = paragraphOf(src.text, r.paragraph);
    if (scope === null) return { status: '無い', reason: `第${r.paragraph}項が原文に無い` };
  }
  if (r.item != null) {
    const it = itemOf(scope, r.item);
    if (it === null) return { status: '無い', reason: `第${r.item}号が原文に無い` };
    if (r.subitem != null && subitemOf(it, r.subitem) === null) return { status: '無い', reason: `第${r.item}号${r.subitem}が原文に無い` };
  }
  return { status: 'ある', reason: src.title };
}

// 文(または JSON の中の文字列)の条番号をすべて確かめる。返り値: { results: [{ ref, label, status, reason }], ok }
export function checkArticles(input, sources = loadSources()) {
  let text = String(input ?? '');
  try {
    const strings = [];
    const walk = (v) => { if (typeof v === 'string') strings.push(v); else if (v && typeof v === 'object') Object.values(v).forEach(walk); };
    walk(JSON.parse(text));
    text = strings.join('\n');
  } catch { /* JSON でなければ文のまま */ }
  const results = extractRefs(text).map((ref) => ({ ref, label: label(ref), ...checkRef(ref, sources) }));
  return { results, ok: results.every((r) => r.status === 'ある') };
}

// 確かめた結果を、条番号ごとの行と数の行の文にする(CLI と道具 check_articles が同じ文を出す。F56a)。checkArticles の返り値でも results の配列でもよい
export function formatResults(checked) {
  const results = Array.isArray(checked) ? checked : checked.results;
  const lines = results.map((r) => `${r.status}\t${r.label}\t${r.reason}`);
  if (!results.length) lines.push('条番号が見つからなかった(確かめたものは無い)');
  const n = (s) => results.filter((r) => r.status === s).length;
  lines.push(`条番号 ${results.length} 件: ある ${n('ある')}・無い ${n('無い')}・確かめられない ${n('確かめられない')}`);
  return lines.join('\n');
}

const isMain = Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const file = process.argv[2];
  const input = file ? fs.readFileSync(file, 'utf8') : fs.readFileSync(0, 'utf8');
  const checked = checkArticles(input);
  console.log(formatResults(checked));
  process.exit(checked.ok ? 0 : 1);
}

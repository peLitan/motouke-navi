#!/usr/bin/env node
// 点検の結果(指摘の文)に書かれた条番号が、取得した原文(reference/sources/ の law-*.txt)にあるかを確かめる(F20b)
// 使い方: node check-articles.mjs <指摘のファイル(文か JSON)>
//         ファイルを渡さなければ標準入力から読む
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

// 文から条番号を取り出す。返り値: [{ raw, law, article, paragraph, item, subitem }]
export function extractRefs(text) {
  const refs = [];
  for (const m of String(text ?? '').matchAll(REF_RE)) {
    const law = m[1] ? LAW_NAMES.find(([n]) => n === m[1])[1] : null;
    const a = toInt(m[2]);
    const sub = m[3] != null ? toInt(m[3]) : null;
    refs.push({
      raw: m[0].trim(),
      law,
      article: sub != null ? `${a}の${sub}` : String(a),
      paragraph: m[4] != null ? toInt(m[4]) : null,
      item: m[5] != null ? toInt(m[5]) : null,
      subitem: m[6] ?? null,
    });
  }
  return refs;
}

const label = (r) => `${r.law ?? '(法令名なし)'} 第${r.article.replace(/^(\d+)(?:の(\d+))?$/, (_, a, b) => a + '条' + (b ? 'の' + b : ''))}` +
  (r.paragraph != null ? `第${r.paragraph}項` : '') + (r.item != null ? `第${r.item}号` : '') + (r.subitem ?? '');

// 1つの条番号を確かめる。返り値: { status: 'ある' | '無い' | '確かめられない', reason }
export function checkRef(r, sources) {
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

const isMain = Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const file = process.argv[2];
  const input = file ? fs.readFileSync(file, 'utf8') : fs.readFileSync(0, 'utf8');
  const { results, ok } = checkArticles(input);
  for (const r of results) console.log(`${r.status}\t${r.label}\t${r.reason}`);
  if (!results.length) console.log('条番号が見つからなかった(確かめたものは無い)');
  const n = (s) => results.filter((r) => r.status === s).length;
  console.log(`条番号 ${results.length} 件: ある ${n('ある')}・無い ${n('無い')}・確かめられない ${n('確かめられない')}`);
  process.exit(ok ? 0 : 1);
}

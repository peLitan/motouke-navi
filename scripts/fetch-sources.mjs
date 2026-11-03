// 法令の原文を e-Gov 法令 API(v2)から取得して data/sources に保存する。
// 使い方:
//   node scripts/fetch-sources.mjs                 … e-Gov から取得して保存
//   node scripts/fetch-sources.mjs --xml-dir DIR   … 先に取得した XML(DIR/<法令ID>.xml)から保存
//   --fetched-at YYYY-MM-DD                        … 取得日(省略すると今日。日本時間)
//   --law KEY                                      … LAWS の key の法令だけを取り直す(例 --law kisoku)。
//                                                    ほかの法令の行・取得日・版と index.json の note は前のまま残す
// これは作る側の道具。画面(index.html)は外部と通信しない。
// 保存するのは本則(MainProvision)の条だけ。附則は対象外。
// 原文のファイルは、条の見出し・条の番号で始め、第2項以降を行の頭の項の番号(「２」など)で始める(e-Gov の表示と同じ)。
// index.json の kind が 'law' でない行(国交省の資料など)は、そのまま残す。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'data', 'sources');
const API = 'https://laws.e-gov.go.jp/api/2/law_data/';
const PAGE = 'https://laws.e-gov.go.jp/law/';

// 取得する法令と条('24の8' の形)
export const LAWS = [
  { key: 'kensetsu', law: '建設業法', lawId: '324AC0000000100', articles: ['3', '24の8', '26'] },
  { key: 'rei', law: '建設業法施行令', lawId: '331CO0000000273', articles: ['2', '7の4', '27'] },
  { key: 'nyukei', law: '公共工事の入札及び契約の適正化の促進に関する法律', lawId: '412AC0000000127', articles: ['15'] },
  // 施工体制台帳の記載事項(F16)。2026-11-03 に --law kisoku で足した
  { key: 'kisoku', law: '建設業法施行規則', lawId: '324M50004000014', articles: ['14の2'] },
];

// ---- 小さな XML の読み取り(e-Gov の法令 XML に足りる範囲) ----
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
  if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
  return ENT[e] ?? m;
});

export function parseXml(xml) {
  const root = { name: '#root', attrs: {}, children: [] };
  const stack = [root];
  const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<!DOCTYPE[^>]*>|<\/([^\s>]+)\s*>|<([^\s/>]+)((?:\s+[^\s=]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(xml))) {
    const top = stack[stack.length - 1];
    if (m[1] !== undefined) top.children.push(m[1]);
    else if (m[2]) {
      if (top.name !== m[2]) throw new Error('XML の閉じタグが合わない: ' + m[2] + '(開いているのは ' + top.name + ')');
      stack.pop();
    } else if (m[3]) {
      const attrs = {};
      for (const a of m[4].matchAll(/([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[a[1]] = decode(a[2] ?? a[3]);
      const el = { name: m[3], attrs, children: [] };
      top.children.push(el);
      if (!m[5]) stack.push(el);
    } else if (m[6] !== undefined) top.children.push(decode(m[6]));
  }
  if (stack.length !== 1) throw new Error('XML が閉じていない: ' + stack[stack.length - 1].name);
  return root;
}

const els = (node, name) => node.children.filter((c) => typeof c !== 'string' && (!name || c.name === name));
const el = (node, name) => els(node, name)[0];
function find(node, pred) {
  if (typeof node === 'string') return null;
  if (pred(node)) return node;
  for (const c of node.children) { const r = find(c, pred); if (r) return r; }
  return null;
}
// 文字だけを取り出す(ルビの読み Rt は除く)
function text(node) {
  if (!node) return '';
  if (typeof node === 'string') return node;
  if (node.name === 'Rt') return '';
  return node.children.map(text).join('');
}
const clean = (s) => s.replace(/[\r\n\t]+/g, '').replace(/^ +| +$/g, '');

// 文(Sentence)の並び。Column(欄)は全角の空白で区切る
function sentenceText(node) {
  if (!node) return '';
  const cols = els(node, 'Column');
  if (cols.length) return cols.map(sentenceText).join('　');
  const ss = els(node, 'Sentence');
  if (ss.length) return ss.map((s) => clean(text(s))).join('');
  return clean(text(node));
}

// 号・号の細分(Item / Subitem1〜10)
function renderItems(node, lines, depth) {
  for (const c of els(node)) {
    const mm = c.name.match(/^(Item|Subitem(\d+))$/);
    if (!mm) continue;
    const prefix = mm[1] === 'Item' ? 'Item' : mm[1];
    const title = clean(text(el(c, prefix + 'Title')));
    const body = sentenceText(el(c, prefix + 'Sentence'));
    lines.push('　'.repeat(depth) + [title, body].filter(Boolean).join('　'));
    renderItems(c, lines, depth + 1);
    renderOther(c, lines, depth + 1, new Set([prefix + 'Title', prefix + 'Sentence']));
  }
}
// 表・図など、上で扱わない要素は文字だけを行にする
function renderOther(node, lines, depth, skip) {
  for (const c of els(node)) {
    if (skip.has(c.name) || /^(Item|Subitem\d+)$/.test(c.name)) continue;
    const t = clean(text(c));
    if (t) lines.push('　'.repeat(depth) + t);
  }
}

const ZEN = (n) => String(n).replace(/\d/g, (d) => String.fromCharCode(d.charCodeAt(0) + 0xfee0));

export function renderArticle(article) {
  const lines = [];
  const caption = clean(text(el(article, 'ArticleCaption')));
  if (caption) lines.push(caption);
  const title = clean(text(el(article, 'ArticleTitle')));
  els(article, 'Paragraph').forEach((p, i) => {
    const pc = clean(text(el(p, 'ParagraphCaption')));
    if (pc && i > 0) lines.push(pc);
    const num = i === 0 ? title : (clean(text(el(p, 'ParagraphNum'))) || ZEN(i + 1));
    lines.push(num + '　' + sentenceText(el(p, 'ParagraphSentence')));
    renderItems(p, lines, 0);
    renderOther(p, lines, 0, new Set(['ParagraphCaption', 'ParagraphNum', 'ParagraphSentence']));
  });
  return lines.join('\n') + '\n';
}

export function findArticle(lawXmlRoot, article) {
  const main = find(lawXmlRoot, (n) => n.name === 'MainProvision');
  if (!main) throw new Error('本則(MainProvision)が無い');
  const num = String(article).replace(/の/g, '_');
  const a = find(main, (n) => n.name === 'Article' && n.attrs.Num === num);
  if (!a) throw new Error('条が無い: ' + article);
  return a;
}

const todayJst = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
const articleLabel = (a) => { const [m, ...s] = String(a).split('の'); return '第' + m + '条' + s.map((x) => 'の' + x).join(''); };

async function loadXml(lawId, xmlDir) {
  if (xmlDir) return fs.readFileSync(path.join(xmlDir, lawId + '.xml'), 'utf8');
  const res = await fetch(API + lawId + '?response_format=xml');
  if (!res.ok) throw new Error('取得できない: ' + lawId + ' ' + res.status);
  return await res.text();
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
  const xmlDir = opt('--xml-dir');
  const fetchedAt = opt('--fetched-at') || todayJst();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fetchedAt)) throw new Error('--fetched-at は YYYY-MM-DD');
  const only = opt('--law');
  if (only && !LAWS.some((L) => L.key === only)) throw new Error('--law の key が無い: ' + only);
  const targets = only ? LAWS.filter((L) => L.key === only) : LAWS;

  fs.mkdirSync(OUT, { recursive: true });
  const idxPath = path.join(OUT, 'index.json');
  const old = fs.existsSync(idxPath) ? JSON.parse(fs.readFileSync(idxPath, 'utf8')) : { sources: [] };
  const lawRows = [];
  for (const L of targets) {
    const root = parseXml(await loadXml(L.lawId, xmlDir));
    const revisionId = clean(text(find(root, (n) => n.name === 'law_revision_id')));
    const title = clean(text(find(root, (n) => n.name === 'LawTitle')));
    if (title !== L.law) throw new Error('法令名が違う: ' + title + '(期待 ' + L.law + ')');
    for (const a of L.articles) {
      const art = findArticle(root, a);
      const file = 'law-' + L.key + '-' + String(a).replace(/の/g, '_') + '.txt';
      fs.writeFileSync(path.join(OUT, file), renderArticle(art), 'utf8');
      const caption = clean(text(el(art, 'ArticleCaption')));
      lawRows.push({
        id: L.key + '-' + String(a).replace(/の/g, '_'),
        kind: 'law',
        law: L.law,
        lawId: L.lawId,
        article: a,
        title: L.law + ' ' + articleLabel(a) + caption,
        url: PAGE + L.lawId,
        apiUrl: API + L.lawId + '?response_format=xml',
        revisionId,
        fetchedAt,
        file,
      });
      console.log('保存: ' + file);
    }
  }
  // --law のときは、選んだ法令の行だけを入れ替え、ほかの法令の行は前のまま残す(並びは法令の行・ほかの資料の行の順)
  const keptLaws = only ? (old.sources || []).filter((s) => s.kind === 'law' && s.lawId !== targets[0].lawId) : [];
  const others = (old.sources || []).filter((s) => s.kind !== 'law');
  const note = old.note || '法令の原文は e-Gov 法令 API から取得した本則の条。国交省の資料は、根拠に使う節だけを PDF から文字のまま写して保存する(全文は再配布しない)';
  const out = { note, sources: [...keptLaws, ...lawRows, ...others] };
  fs.writeFileSync(idxPath, JSON.stringify(out, null, 2) + '\n', 'utf8');
  console.log('index.json: ' + out.sources.length + ' 行');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error('失敗: ' + e.message); process.exit(1); });
}

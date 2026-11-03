// data/quotes.json の抜き書きを、data/sources の原文と1件ずつ照らす(項・号まで)。
// 一致しないものがあれば一覧を出して終了コード 1 で終わる。
// 使い方: node scripts/check-quotes.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkQuote } from '../src/quote-check.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));

const { sources } = readJson('data/sources/index.json');
const { quotes } = readJson('data/quotes.json');
const texts = {};
for (const s of sources) if (s.file) texts[s.id] = fs.readFileSync(path.join(root, 'data/sources', s.file), 'utf8');

let ng = 0;
for (const q of quotes) {
  const r = checkQuote(q, texts);
  const where = q.sourceId + (q.article != null ? ` 第${q.article}条` : '') + (q.paragraph ? ` 第${q.paragraph}項` : '') + (q.item ? ` 第${q.item}号` : '') + (q.subitem ? q.subitem : '') + (q.section ? ` ${q.section}` : '') + (q.page ? ` ${q.page}ページ` : '');
  console.log(`${r.ok ? '一致' : '不一致'}\t${q.id}\t${where}${r.ok ? '' : '\t' + r.reason}`);
  if (!r.ok) ng++;
}
const noQuote = sources.filter((s) => s.kind === 'law' && !quotes.some((q) => q.sourceId === s.id)).map((s) => s.id);
if (noQuote.length) console.log('抜き書きの無い条: ' + noQuote.join(', '));
console.log(`抜き書き ${quotes.length} 件のうち 不一致 ${ng} 件`);
process.exit(ng || noQuote.length ? 1 : 0);

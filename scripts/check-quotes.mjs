// data/quotes.json の抜き書きを、data/sources の原文と1件ずつ照らす(項・号まで)。
// 一致しないものがあれば一覧を出して終了コード 1 で終わる。
// 使い方: node scripts/check-quotes.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkQuote } from '../src/quote-check.mjs';
import { checkKindSchedule, checkKindPlan, checkZoenBasis } from '../src/kind-schedule-check.mjs';
import { checkKyotsuhi } from './kyotsuhi-tables.mjs';

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
// 工種の段取りの表(F44b・F44c): 行ごとに、抜き書きが箇所の号の中にあるか、期日が抜き書きから読めるかを見る
const kindTables = ['data/schedule-kenchiku.json', 'data/schedule-denki.json', 'data/schedule-kan.json', 'data/schedule-tsushin.json'].map(readJson);
let kindRows = 0;
for (const table of kindTables) {
  const errors = checkKindSchedule(table, texts[table.sourceId]);
  kindRows += table.rules.length;
  for (const r of table.rules) {
    const own = errors.filter((e) => e.startsWith(r.id + ':'));
    console.log(`${own.length ? '不一致' : '一致'}\t${r.id}\t${table.sourceId} ${r.section}${own.length ? '\t' + own.join(' / ') : ''}`);
  }
  for (const e of errors.filter((x) => !table.rules.some((r) => x.startsWith(r.id + ':')))) console.log('不一致\t' + e);
  ng += new Set(errors.map((e) => e.split(':')[0])).size;
}
// 造園に土木の表を当てる理由の抜き書き(F44g)
const zoenBasis = readJson('data/zoen-basis.json');
const zoenErrors = checkZoenBasis(zoenBasis, texts[zoenBasis.sourceId]);
kindRows += zoenBasis.quotes.length;
for (const e of zoenErrors) console.log('不一致\t' + e);
console.log(`${zoenErrors.length ? '不一致' : '一致'}\tzoen-basis\t${zoenBasis.sourceId} 抜き書き ${zoenBasis.quotes.length} 件`);
ng += zoenErrors.length;
// 建築系の施工計画書の語の表(F44d): 語ごとに、抜き書きが箇所の号の中にあるかを見る
const kindPlans = ['data/plan-items-kenchiku.json', 'data/plan-items-denki.json', 'data/plan-items-kan.json'].map(readJson);
for (const table of kindPlans) {
  const errors = checkKindPlan(table, texts[table.sourceId]);
  kindRows += table.items.length;
  for (const it of table.items) {
    const own = errors.filter((e) => e.startsWith(it.id + ':'));
    console.log(`${own.length ? '不一致' : '一致'}\t${it.id}\t${table.sourceId} ${it.section}${own.length ? '\t' + own.join(' / ') : ''}`);
    if (own.length) ng++;
  }
  for (const e of errors.filter((x) => !table.items.some((it) => x.startsWith(it.id + ':')))) { console.log('不一致\t' + e); ng++; }
}
// 建築系の共通費の表(F44e): 原文から読み直して、式・係数・範囲・前提の文が全部同じかを見る
const kyotsuhi = readJson('data/kyotsuhi-rates.json');
const kyotsuhiErrors = checkKyotsuhi(kyotsuhi, texts[kyotsuhi.sourceId]);
kindRows += kyotsuhi.tables.length + 1 + kyotsuhi.notes.length;
for (const e of kyotsuhiErrors) console.log('不一致\t' + e);
console.log(`${kyotsuhiErrors.length ? '不一致' : '一致'}\tkyotsuhi\t${kyotsuhi.sourceId} 別表 ${kyotsuhi.tables.length + 1} 件・前提の文 ${kyotsuhi.notes.length} 件`);
ng += kyotsuhiErrors.length;
const noQuote = sources.filter((s) => s.kind === 'law' && !quotes.some((q) => q.sourceId === s.id)).map((s) => s.id);
if (noQuote.length) console.log('抜き書きの無い条: ' + noQuote.join(', '));
console.log(`抜き書き ${quotes.length + kindRows} 件のうち 不一致 ${ng} 件`);
process.exit(ng || noQuote.length ? 1 : 0);

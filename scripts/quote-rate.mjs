// 規則表の引用の実在率と、根拠を原文で確かめられずに外した行の数を数える(F08)。
// 5つの表を、data/sources の原文と照らす:
//   data/quotes.json(法令・ガイドラインの抜き書き。項・号の中まで見る)
//   data/rules.json(施工体制台帳の規則。根拠の抜き書きが1つでも合わなければ外す = filterVerifiedRules)
//   data/schedule.json(段取り。共通仕様書の原文に抜き書きがあるか)
//   data/plan-items.json(施工計画書の記載項目。共通仕様書の原文に抜き書きがあるか)
//   data/schedule-kenchiku.json・schedule-denki.json・schedule-kan.json(工種の段取り。標準仕様書の章の原文に抜き書きがあるか。期日の抜き書きも見る)
// 許す違いは空白だけ(quote-check.mjs の verifyQuote)。
// 使い方: node scripts/quote-rate.mjs        … 表を出す
//         node scripts/quote-rate.mjs --json … JSON で出す
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkQuote, verifyQuote, filterVerifiedRules } from '../src/quote-check.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));

const { sources } = readJson('data/sources/index.json');
const texts = {};
for (const s of sources) if (s.file && s.file.endsWith('.txt')) texts[s.id] = fs.readFileSync(path.join(root, 'data/sources', s.file), 'utf8').replace(/^--- PDF の \d+ ページ ---\n/gm, ''); // 頁の印は取り出すときに足したもの

const { quotes } = readJson('data/quotes.json');
const rules = readJson('data/rules.json');
const schedule = readJson('data/schedule.json');
const plan = readJson('data/plan-items.json');
const kindPlans = ['data/plan-items-kenchiku.json', 'data/plan-items-denki.json', 'data/plan-items-kan.json'].map((name) => [name, readJson(name)]);
const kindTables = ['data/schedule-kenchiku.json', 'data/schedule-denki.json', 'data/schedule-kan.json'].map((name) => [name, readJson(name)]);

const ng = [];
const count = (name, list, test) => {
  let ok = 0;
  for (const x of list) {
    const r = test(x);
    if (r.ok) ok++; else ng.push({ table: name, id: x.id, reason: r.reason });
  }
  return { table: name, total: list.length, ok, rate: list.length ? ok / list.length : null };
};
const inSource = (sourceId, quote) => {
  if (typeof texts[sourceId] !== 'string') return { ok: false, reason: '出典の原文が無い: ' + sourceId };
  return verifyQuote(quote, texts[sourceId]) ? { ok: true } : { ok: false, reason: '原文に無い抜き書き' };
};

const rows = [
  count('data/quotes.json', quotes, (q) => checkQuote(q, texts)),
  count('data/schedule.json', schedule.rules, (r) => inSource(schedule.sourceId, r.quote)),
  count('data/plan-items.json', plan.items, (it) => inSource(plan.sourceId, it.quote)),
  ...kindTables.map(([name, table]) => count(name, table.rules, (r) => {
    const main = inSource(table.sourceId, r.quote);
    return main.ok && r.deadline ? inSource(table.sourceId, r.deadline.quote) : main;
  })),
  ...kindPlans.map(([name, table]) => count(name, table.items, (it) => inSource(table.sourceId, it.quote))),
];
const filtered = filterVerifiedRules(rules.rules, quotes, texts);
const abQuotes = (rules.amountBasis?.basis ?? []).map((b) => b.quoteId);
const abOk = abQuotes.every((id) => { const q = quotes.find((x) => x.id === id); return q && checkQuote(q, texts).ok; });

const total = rows.reduce((a, r) => a + r.total, 0);
const ok = rows.reduce((a, r) => a + r.ok, 0);
const result = {
  quotes: rows,
  quotesAll: { total, ok, rate: total ? ok / total : null },
  rules: { total: rules.rules.length, kept: filtered.kept.length, dropped: filtered.dropped.map((r) => r.id), problems: filtered.problems },
  amountBasis: { ok: abOk },
  ng,
};

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(result, null, 2));
} else {
  const pct = (x) => (x == null ? '-' : (x * 100).toFixed(1) + '%');
  console.log('| 表 | 抜き書き | 原文にある | 実在率 |');
  console.log('|---|---|---|---|');
  for (const r of rows) console.log(`| ${r.table} | ${r.total} | ${r.ok} | ${pct(r.rate)} |`);
  console.log(`| 合計 | ${total} | ${ok} | ${pct(result.quotesAll.rate)} |`);
  console.log('');
  console.log(`施工体制台帳の規則(data/rules.json): ${result.rules.total} 行のうち 残した ${result.rules.kept} 行・外した ${result.rules.dropped.length} 行${result.rules.dropped.length ? '(' + result.rules.dropped.join(', ') + ')' : ''}`);
  console.log(`税込み・税抜きの根拠(amountBasis): ${abOk ? '原文にある' : '原文で確かめられない'}`);
  for (const x of ng) console.log(`合わない: ${x.table} ${x.id}: ${x.reason}`);
}
process.exit(ng.length || filtered.dropped.length || !abOk ? 1 : 0);

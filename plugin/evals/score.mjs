#!/usr/bin/env node
// 評価のケースの答えを採点する(F21a)。外部と通信しない。Claude を呼ばない(答えは人が Claude Code で作って保存する)
// 使い方: node score.mjs <ケースのフォルダ> <答えのファイル(Markdown の文か JSON)> [--json]
// 出力: 採点基準(rubric.json)ごとの数と率、どの指摘がどの仕込みに当たったか
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractRefs, checkRef, loadSources } from '../skills/construction-check/scripts/check-articles.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const RUBRIC = JSON.parse(fs.readFileSync(path.join(HERE, 'rubric.json'), 'utf8'));

export function loadCase(dir) {
  const c = JSON.parse(fs.readFileSync(path.join(dir, 'case.json'), 'utf8'));
  return { ...c, dir };
}

// 答えを指摘1件ずつに分ける。JSON なら findings(または一番上の配列)の要素、文なら区切りの行で分ける
export function splitFindings(answer) {
  const text = String(answer ?? '');
  try {
    const v = JSON.parse(text);
    const arr = Array.isArray(v) ? v : Array.isArray(v?.findings) ? v.findings : null;
    if (arr) return arr.map((x) => (typeof x === 'string' ? x : JSON.stringify(x)));
  } catch { /* 文として分ける */ }
  const START = /^\s*(?:[-*・]\s*)?(?:\*\*)?何が|^\s*#{1,6}\s|^\s*(?:\d+|[０-９]+)[.)．、]\s*/;
  const blocks = [];
  let cur = [];
  for (const line of text.split(/\r?\n/)) {
    if (START.test(line) && cur.some((l) => l.trim())) { blocks.push(cur.join('\n')); cur = []; }
    cur.push(line);
  }
  if (cur.some((l) => l.trim())) blocks.push(cur.join('\n'));
  return blocks;
}

// 仕込み1つに当たるか: match の組(語のどれか)が、すべて1件の中に出てくる
export const hits = (finding, planted) => planted.match.every((group) => group.some((w) => finding.includes(w)));

const strip = (s) => String(s).replace(/[\s　]/g, '');

export function scoreCase(c, answer, sources = loadSources()) {
  const findings = splitFindings(answer);
  // 見落とし率
  const plantedResults = c.planted.map((p) => {
    const by = findings.map((f, i) => (hits(f, p) ? i + 1 : 0)).filter(Boolean);
    return { id: p.id, what: p.what, found: by.length > 0, findings: by };
  });
  const missed = plantedResults.filter((r) => !r.found).length;
  // 条番号の正しさ
  const refs = extractRefs(String(answer ?? '')).map((r) => ({ label: r.raw, ...checkRef(r, sources) }));
  const okRefs = refs.filter((r) => r.status === 'ある').length;
  // 抜き書きの正しさ(条番号のある行の「」を、同じ指摘で挙げた条の原文と照らす)
  const quotes = [];
  for (const f of findings) {
    const cited = extractRefs(f).filter((r) => r.law).map((r) => sources.find((s) => s.law === r.law && s.article === r.article)).filter(Boolean);
    for (const line of f.split(/\r?\n/)) {
      if (!extractRefs(line).length) continue;
      for (const m of line.matchAll(/「([^「」]{4,})」/g)) {
        const q = strip(m[1]);
        quotes.push({ quote: m[1], ok: cited.some((s) => strip(s.text).includes(q)) });
      }
    }
  }
  const okQuotes = quotes.filter((q) => q.ok).length;
  const rate = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : null);
  const all = {
    'miss-rate': { planted: c.planted.length, missed, rate: rate(missed, c.planted.length) },
    'article-accuracy': { refs: refs.length, ok: okRefs, rate: rate(okRefs, refs.length) },
    'quote-accuracy': { quotes: quotes.length, ok: okQuotes, rate: rate(okQuotes, quotes.length) },
  };
  const criteria = Object.fromEntries(c.criteria.map((k) => [k.kind, all[k.kind]]));
  return { case: c.id, findings: findings.length, criteria, planted: plantedResults, refs, quotes };
}

const isMain = Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const [dir, file] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  if (!dir || !file) { console.log('使い方: node score.mjs <ケースのフォルダ> <答えのファイル> [--json]'); process.exit(2); }
  const r = scoreCase(loadCase(dir), fs.readFileSync(file, 'utf8'));
  if (process.argv.includes('--json')) { console.log(JSON.stringify(r, null, 2)); process.exit(0); }
  console.log(`ケース ${r.case}: 指摘 ${r.findings} 件に分けた`);
  for (const [kind, v] of Object.entries(r.criteria)) {
    const t = RUBRIC.kinds[kind].title;
    if (kind === 'miss-rate') console.log(`${t}: 仕込み ${v.planted} 件のうち見落とし ${v.missed} 件(${v.rate}%)`);
    if (kind === 'article-accuracy') console.log(`${t}: 条番号 ${v.refs} 件のうち原文にある ${v.ok} 件(${v.rate ?? '条番号が無い'}${v.rate == null ? '' : '%'})`);
    if (kind === 'quote-accuracy') console.log(`${t}: 抜き書き ${v.quotes} 件のうち原文どおり ${v.ok} 件(${v.rate ?? '抜き書きが無い'}${v.rate == null ? '' : '%'})`);
  }
  for (const p of r.planted) console.log(`${p.found ? '当たった' : '見落とし'}\t${p.id}\t${p.what}${p.found ? '\t指摘 ' + p.findings.join('・') + ' 件目' : ''}`);
  console.log('当たり外れは語で数えた粗い数です。指摘の中身を人が見直してください');
}

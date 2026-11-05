#!/usr/bin/env node
// 公共建築工事標準仕様書(建築工事編)令和7年版の PDF から、1章だけを文にして data/sources に置く(F44b)
// 手で打ち直さない。文字は PDF の文字のまま、行を y の位置でそろえ、ページの下の番号だけを除く
// 使い方:
//   node scripts/fetch-kenchiku-spec.mjs                 … 国土交通省のサイトから取る
//   node scripts/fetch-kenchiku-spec.mjs --pdf FILE      … 先に取った PDF から作る
//   --fetched-at YYYY-MM-DD                              … 取得日(省略すると今日。日本時間)
// これは作る側の道具。画面(index.html)は外部と通信しない。AI は使わない
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { pdfPages } from './pdf-text.mjs';

export const PDF_URL = 'https://www.mlit.go.jp/gobuild/content/001888816.pdf';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(root, 'data/sources/mlit-kenchiku-spec-r7-ch1.txt');
const today = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date());

// 1ページの文字を、上から下へ、同じ高さの文字を左から右へつなぐ
export function pageLines(items) {
  const rows = [];
  for (const it of [...items].sort((a, b) => b.y - a.y || a.x - b.x)) {
    const row = rows.find((r) => Math.abs(r.y - it.y) < 3);
    if (row) row.items.push(it);
    else rows.push({ y: it.y, items: [it] });
  }
  return rows.map((r) => r.items.sort((a, b) => a.x - b.x).map((i) => i.text).join('').replace(/\s+$/, '').replace(/^\s+/, '')).filter(Boolean);
}

// 1章の範囲: 「１章 各章共通事項」の本文の頁から、「２章 仮設工事」の本文の頁の手前まで(目次の頁は除く)
export function chapter1(pages) {
  const texts = pages.map((p) => ({ page: p.page, lines: pageLines(p.items) }));
  const isHead = (t, head) => t.lines.some((l) => l.replace(/\s/g, '') === head);
  const start = texts.findIndex((t) => isHead(t, '１章各章共通事項') && isHead(t, '１節共通事項') && t.lines.some((l) => /^1\.1\.1/.test(l)));
  const end = texts.findIndex((t, i) => i > start && t.lines.some((l) => /^２章\s*仮設工事/.test(l)));
  if (start < 0 || end < 0) throw new Error('1章の範囲が分からない');
  return texts.slice(start, end);
}

export function chapterText(pages) {
  return chapter1(pages).flatMap((t) => [
    '--- PDF の ' + t.page + ' ページ ---',
    ...t.lines.filter((l) => !/^[-－‐ー]?\s*[0-9０-９]+\s*[-－‐ー]?$/.test(l)),
  ]).join('\n') + '\n';
}

async function main(argv) {
  const opt = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
  const file = opt('--pdf');
  let bytes;
  if (file) bytes = fs.readFileSync(file);
  else {
    const res = await fetch(PDF_URL, { headers: { 'user-agent': 'kenchiku-spec-fetch' } });
    if (!res.ok) throw new Error('取得に失敗: ' + PDF_URL + ' ' + res.status);
    bytes = Buffer.from(await res.arrayBuffer());
  }
  const text = chapterText(pdfPages(bytes));
  fs.writeFileSync(OUT, text);
  console.log('書いた: ' + path.relative(root, OUT) + '(' + text.length + ' 字。取得日 ' + (opt('--fetched-at') ?? today()) + ')');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main(process.argv.slice(2));

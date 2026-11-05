#!/usr/bin/env node
// 手元の標準単価表から施工パッケージを探す(F42b)。Claude が当てる先を選ぶための道具で、AI も通信も使わない
// 使い方: node find-packages.mjs 掘削 土砂            … 名前か条件に語がすべて入るパッケージを並べる
//         node find-packages.mjs --no 1 土砂 ｵｰﾌﾟﾝ    … 番号のパッケージの行を出す(語で絞れる。全角半角は問わない)
//         --tables DIR                                … 表の置き場(既定 tmp/estimate-data)
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { rowText } from './check-estimate.mjs';

const norm = (s) => String(s ?? '').normalize('NFKC').toLowerCase().replace(/\s/g, '');
const hasAll = (text, words) => words.every((w) => norm(text).includes(norm(w)));

export function searchPackages(table, words) {
  const out = [];
  for (const p of table.packages) {
    const n = p.rows.filter((r) => hasAll(rowText(p, r), words)).length;
    if (n) out.push({ no: p.no, name: p.name, unit: p.unit, rows: n, of: p.rows.length });
    else if (!p.rows.length && hasAll(p.name, words)) out.push({ no: p.no, name: p.name, unit: p.unit, rows: 0, of: 0 });
  }
  return out;
}

export function rowsOf(table, no, words = []) {
  const p = table.packages.find((x) => x.no === no);
  if (!p) return null;
  return { package: p, rows: p.rows.filter((r) => hasAll(rowText(p, r), words)).map((r) => ({ text: rowText(p, r), price: r.price, page: r.page })) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const take = (flag) => { const i = args.indexOf(flag); if (i < 0) return null; const v = args[i + 1]; args.splice(i, 2); return v; };
  const dir = take('--tables') ?? path.join('tmp', 'estimate-data');
  const no = take('--no');
  const table = JSON.parse(fs.readFileSync(path.join(dir, 'unit-prices.json'), 'utf8'));
  if (no !== null) {
    const r = rowsOf(table, Number(no), args);
    if (!r) { console.error('番号がありません: ' + no); process.exit(1); }
    console.log(`番号 ${r.package.no} ${r.package.name} 単位 ${r.package.unit} 条件の欄: ${(r.package.header ?? []).join(' / ')}`);
    for (const x of r.rows) console.log(`${x.text}\t標準単価 ${x.price}\tPDF p.${x.page}`);
  } else {
    if (!args.length) { console.error('語を1つ以上渡してください'); process.exit(2); }
    for (const x of searchPackages(table, args)) console.log(`${x.no}\t${x.name}\t${x.unit ?? '単位なし'}\t${x.of ? `${x.rows}/${x.of} 行` : '表なし(物価資料等による)'}`);
  }
}

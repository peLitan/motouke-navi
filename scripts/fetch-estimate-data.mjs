#!/usr/bin/env node
// 施工パッケージの標準単価表と公共工事設計労務単価を、使う人の手元に取って表の形にする(F42a)
// 取ったものはリポジトリに入れない(既定の置き場 tmp/estimate-data/ は git の対象の外)
// 使い方:
//   node scripts/fetch-estimate-data.mjs                 … 国土交通省のサイトから取る
//   node scripts/fetch-estimate-data.mjs --pdf-dir DIR   … 先に取った PDF(DIR/<ファイル名>)から作る
//   --out DIR                                            … 置き場を変える
//   --fetched-at YYYY-MM-DD                              … 取得日(省略すると今日。日本時間)
// これは作る側の道具。画面(index.html)は外部と通信しない。AI は使わない
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { pdfPages } from './pdf-text.mjs';
import { parseUnitPrices, parseLaborRates } from './estimate-tables.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const FILES = {
  unitPrices: {
    file: '001989802.pdf',
    url: 'https://www.mlit.go.jp/tec/content/001989802.pdf',
    title: '令和8年度 施工パッケージ型積算方式 標準単価表(国技建管第16号 令和8年3月18日)',
    base: '東京地区(東京17区)・基準年月 令和7年4月',
  },
  labor: {
    file: '001981942.pdf',
    url: 'https://www.mlit.go.jp/report/press/content/001981942.pdf',
    title: '令和8年3月から適用する公共工事設計労務単価について',
  },
  laborBase: {
    file: '001864366.pdf',
    url: 'https://www.mlit.go.jp/report/press/content/001864366.pdf',
    title: '令和7年3月から適用する公共工事設計労務単価について(標準単価の基準年月 令和7年4月の東京の単価に使う)',
  },
};

const today = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date());

async function load(entry, dir) {
  if (dir) return fs.readFileSync(path.join(dir, entry.file));
  const res = await fetch(entry.url, { headers: { 'user-agent': 'estimate-data-fetch' } });
  if (!res.ok) throw new Error('取得に失敗: ' + entry.url + ' ' + res.status);
  return Buffer.from(await res.arrayBuffer());
}

export function summarize(unit, labor, baseTokyo = {}) {
  const rows = unit.packages.flatMap((p) => p.rows);
  const off = rows.filter((r) => Math.abs((r.K ?? 0) + (r.R ?? 0) + (r.Z ?? 0) + (r.S ?? 0) - 100) > 0.5);
  return {
    packages: unit.packages.length,
    rows: rows.length,
    skipped: unit.skipped.length,
    ratioSumOff: off.length,
    prefectures: Object.keys(labor.rates).length,
    // 今年の東京の職種が基準年月の東京の表に無ければ、列の読み違いを疑う
    baseJobsMissing: Object.keys(labor.rates['東京都'] ?? {}).filter((k) => !(k in baseTokyo)),
  };
}

async function main(argv) {
  const opt = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
  const dir = opt('--pdf-dir');
  const out = path.resolve(opt('--out') ?? path.join(ROOT, 'tmp', 'estimate-data'));
  const fetchedAt = opt('--fetched-at') ?? today();
  const meta = {};
  const pagesOf = {};
  for (const [key, entry] of Object.entries(FILES)) {
    const bytes = await load(entry, dir);
    pagesOf[key] = pdfPages(bytes);
    meta[key] = { ...entry, fetchedAt, sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
  }
  const unit = parseUnitPrices(pagesOf.unitPrices);
  const labor = parseLaborRates(pagesOf.labor);
  const laborBase = parseLaborRates(pagesOf.laborBase);
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'unit-prices.json'), JSON.stringify({ meta: meta.unitPrices, ...unit }));
  fs.writeFileSync(path.join(out, 'labor-rates.json'), JSON.stringify({ meta: meta.labor, ...labor }));
  fs.writeFileSync(path.join(out, 'labor-base.json'), JSON.stringify({ meta: meta.laborBase, tokyo: laborBase.rates['東京都'] }));
  const s = summarize(unit, labor, laborBase.rates['東京都']);
  console.log('置き場: ' + out);
  console.log(`施工パッケージ ${s.packages}・行 ${s.rows}・読めなかった行 ${s.skipped}・構成比の計が100から外れた行 ${s.ratioSumOff}・都道府県 ${s.prefectures}・基準の表に無い職種 ${s.baseJobsMissing.length}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((e) => { console.error(e.message); process.exit(1); });
}

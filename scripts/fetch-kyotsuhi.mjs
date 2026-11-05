#!/usr/bin/env node
// 公共建築工事共通費積算基準(令和8年改定)の PDF を文にして data/sources に置き、別表の式と係数を data/kyotsuhi-rates.json に書く(F44e)
// 手で打ち直さない。文字は PDF の文字のまま、行を y の位置でそろえ、ページの下の番号だけを除く
// 使い方:
//   node scripts/fetch-kyotsuhi.mjs                 … 国土交通省のサイトから取る
//   node scripts/fetch-kyotsuhi.mjs --pdf FILE      … 先に取った PDF から作る
//   --fetched-at YYYY-MM-DD                         … 取得日(省略すると今日。日本時間)
// これは作る側の道具。画面(index.html)は外部と通信しない。AI は使わない
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { pdfPages } from './pdf-text.mjs';
import { pageLines } from './fetch-kenchiku-spec.mjs';
import { DOC, SOURCE_ID, buildRates } from './kyotsuhi-tables.mjs';

export const PDF_URL = 'https://www.mlit.go.jp/gobuild/content/001733141.pdf';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEXT = path.join(root, 'data/sources/mlit-kyotsuhi-r8.txt');
const RATES = path.join(root, 'data/kyotsuhi-rates.json');
const today = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date());

export const pdfText = (pages) => pages.flatMap((p) => [
  '--- PDF の ' + p.page + ' ページ ---',
  ...pageLines(p.items).filter((l) => !/^[-－‐ー]\s*[0-9０-９]+\s*[-－‐ー]$/.test(l)),
]).join('\n') + '\n';

async function main(argv) {
  const opt = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
  const file = opt('--pdf');
  let bytes;
  if (file) bytes = fs.readFileSync(file);
  else {
    const res = await fetch(PDF_URL, { headers: { 'user-agent': 'kyotsuhi-fetch' } });
    if (!res.ok) throw new Error('取得に失敗: ' + PDF_URL + ' ' + res.status);
    bytes = Buffer.from(await res.arrayBuffer());
  }
  const text = pdfText(await pdfPages(bytes));
  const fetchedAt = opt('--fetched-at') ?? today();
  const data = {
    sourceId: SOURCE_ID, doc: DOC, partLabel: '共通費の率の表',
    meta: { title: DOC + '(最終改定 令和8年3月11日 国営積第15号)', url: PDF_URL, fetchedAt, pageNote: '頁は PDF の頁。紙面の下の番号は PDF の頁から 1 を引いた数' },
    ...buildRates(text),
  };
  fs.writeFileSync(TEXT, text);
  fs.writeFileSync(RATES, JSON.stringify(data, null, 1) + '\n');
  console.log('書いた: data/sources/mlit-kyotsuhi-r8.txt(' + text.length + ' 字)、data/kyotsuhi-rates.json(別表 ' + data.tables.length + ' + 1。取得日 ' + fetchedAt + ')');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main(process.argv.slice(2));

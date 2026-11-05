#!/usr/bin/env node
// 電気通信設備工事共通仕様書の第1編 第1章と、公園緑地工事共通仕様書の目次の頁を、PDF から文にして data/sources に置く(F44g)
// 手で打ち直さない。文字は PDF の文字のまま
// 電気通信の PDF は文字の座標の間隔が狭く(文字の拡大が座標に入っていない)、位置でそろえると本文と見出しが1行に混ざる。
// 中身の流れの順は読む順なので、流れの順のまま、y が変わったところで行を分ける
// 使い方:
//   node scripts/fetch-tsushin-park-spec.mjs tsushin|park                 … 国土交通省のサイトから取る
//   node scripts/fetch-tsushin-park-spec.mjs tsushin|park --pdf FILE      … 先に取った PDF から作る
//   --fetched-at YYYY-MM-DD                                               … 取得日(省略すると今日。日本時間)
// これは作る側の道具。画面(index.html)は外部と通信しない。AI は使わない
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { pdfPages } from './pdf-text.mjs';

const LINE_GAP = 0.4;

// 流れの順のまま行にする
export function streamLines(items) {
  const rows = [];
  let row = null;
  for (const it of items) {
    if (!row || Math.abs(row.y - it.y) > LINE_GAP) { row = { y: it.y, text: '' }; rows.push(row); }
    row.text += it.text;
  }
  return rows.map((r) => r.text.trim()).filter(Boolean);
}

// 第1編 第1章: 「1-1-1-1 適用」の行から、本文の「第2章 土木工事部分」の行の手前まで(目次の頁は見出しの形が崩れているので当たらない)
export function tsushinText(pages) {
  const texts = pages.map((p) => ({ page: p.page, lines: streamLines(p.items) }));
  const isStart = (l) => /^1-1-1-1\s+適\s*用$/.test(l);
  const start = texts.findIndex((t) => t.lines.some(isStart));
  if (start < 0) throw new Error('第1章の範囲が分からない');
  const out = [];
  for (const [n, t] of texts.slice(start).entries()) {
    const end = t.lines.findIndex((l) => /^第2章\s*土木工事部分$/.test(l));
    const from = n === 0 ? t.lines.findIndex(isStart) : 0;
    const body = t.lines.slice(from, end >= 0 ? end : undefined).filter((l) => !/^\d+-\d+$/.test(l));
    if (body.length) out.push('--- PDF の ' + t.page + ' ページ ---', ...body);
    if (end >= 0) return out.join('\n') + '\n';
  }
  throw new Error('第1章の範囲が分からない');
}

// 公園緑地工事共通仕様書: 表紙(題名と版)と、目次の頁(章の並びと(注1)(注2))だけ。本文は取り込まない
export function parkText(pages) {
  const cover = streamLines(pages[0].items);
  const toc = pages.find((p) => streamLines(p.items).some((l) => /^（注1）/.test(l)));
  if (!toc) throw new Error('目次の注が見つからない');
  const lines = streamLines(toc.items);
  return ['--- PDF の ' + pages[0].page + ' ページ ---', ...cover, '--- PDF の ' + toc.page + ' ページ ---', ...lines].join('\n') + '\n';
}

export const SPECS = {
  tsushin: { url: 'https://www.mlit.go.jp/tec/it/denki/gijyutukijyun/R0803kouji.pdf', out: 'data/sources/mlit-tsushin-spec-r8-ch1.txt', make: tsushinText },
  park: { url: 'https://www.mlit.go.jp/toshi/park/content/001742862.pdf', out: 'data/sources/mlit-park-spec-r6-notes.txt', make: parkText },
};

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const today = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date());

async function main(argv) {
  const spec = SPECS[argv[0]];
  if (!spec) throw new Error('使い方: fetch-tsushin-park-spec.mjs tsushin|park [--pdf FILE] [--fetched-at YYYY-MM-DD]');
  const opt = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
  const file = opt('--pdf');
  let bytes;
  if (file) bytes = fs.readFileSync(file);
  else {
    const res = await fetch(spec.url, { headers: { 'user-agent': 'tsushin-park-spec-fetch' } });
    if (!res.ok) throw new Error('取得に失敗: ' + spec.url + ' ' + res.status);
    bytes = Buffer.from(await res.arrayBuffer());
  }
  const text = spec.make(pdfPages(bytes));
  fs.writeFileSync(path.join(root, spec.out), text);
  console.log('書いた: ' + spec.out + '(' + text.length + ' 字。取得日 ' + (opt('--fetched-at') ?? today()) + ')');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main(process.argv.slice(2));

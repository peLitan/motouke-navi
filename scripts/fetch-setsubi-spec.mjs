#!/usr/bin/env node
// 公共建築工事標準仕様書(電気設備工事編・機械設備工事編)の PDF から、第1編 第1章 一般事項だけを文にして data/sources に置く(F44c)
// 手で打ち直さない。文字は PDF の文字のまま。行のそろえ方は建築工事編と同じで、毎ページの上の見出しと下の番号だけを除く
// 電気設備工事編は y の向きが逆の PDF(上のほうが小さい)なので、向きを表の yDown で指定する。向きを誤ると見出しの順が乱れて止まる
// 使い方:
//   node scripts/fetch-setsubi-spec.mjs denki|kan                 … 国土交通省のサイトから取る
//   node scripts/fetch-setsubi-spec.mjs denki|kan --pdf FILE      … 先に取った PDF から作る
//   --fetched-at YYYY-MM-DD                                       … 取得日(省略すると今日。日本時間)
// これは作る側の道具。画面(index.html)は外部と通信しない。AI は使わない
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { pdfPages } from './pdf-text.mjs';
import { pageLines } from './fetch-kenchiku-spec.mjs';

export const SPECS = {
  denki: {
    url: 'https://www.mlit.go.jp/gobuild/content/001888825.pdf',
    out: 'data/sources/mlit-denki-spec-r7-ch1.txt',
    yDown: true,
    end: /^第2章共通工事$/,
    running: /^公共建築工事標準仕様書（電気設備工事編）令和７年版$|^\d+\s*国土交通省大臣官房官庁営繕部$/,
  },
  kan: {
    url: 'https://www.mlit.go.jp/gobuild/content/001967513.pdf',
    out: 'data/sources/mlit-kikai-spec-r7-ch1.txt',
    yDown: false,
    end: /^第２編共通工事$/,
    running: /^公共建築工事標準仕様書（機械設備工事編）令和７年版（修補版）$|^\d+\s*国土交通省大臣官房官庁営繕部$/,
  },
};

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const today = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date());
const flat = (s) => s.replace(/\s/g, '');

export const linesOf = (page, spec) => pageLines(spec.yDown ? page.items.map((i) => ({ ...i, y: -i.y })) : page.items);

// 第1章の範囲: 「1.1.1 適用」のある頁から、次の章・編の見出しの行の手前まで。行で切る(第2章は頁の途中から始まる)
export function chapterLines(pages, spec) {
  const texts = pages.map((p) => ({ page: p.page, lines: linesOf(p, spec) }));
  const start = texts.findIndex((t) => t.lines.some((l) => /^1\.1\.1\s*適用/.test(l)));
  if (start < 0) throw new Error('第1章の範囲が分からない');
  const out = [];
  for (const t of texts.slice(start)) {
    const end = t.lines.findIndex((l) => spec.end.test(flat(l)));
    out.push({ page: t.page, lines: end >= 0 ? t.lines.slice(0, end) : t.lines });
    if (end >= 0) return out;
  }
  throw new Error('第1章の範囲が分からない');
}

// 上の見出しと下の番号を除く。第1編の頭の題名(原文)は1.1.1 より前なので、最初の頁は 1.1.1 の手前の行から数えない
export function chapterText(pages, spec) {
  const chapter = chapterLines(pages, spec);
  return chapter.flatMap((t, n) => {
    const from = n === 0 ? t.lines.findIndex((l) => /^1\.1\.1\s*適用/.test(l)) : 0;
    const body = t.lines.slice(from).filter((l) => !spec.running.test(l.trim()) && !/^\d+$/.test(l.trim()));
    return body.length ? ['--- PDF の ' + t.page + ' ページ ---', ...body] : [];
  }).join('\n') + '\n';
}

async function main(argv) {
  const spec = SPECS[argv[0]];
  if (!spec) throw new Error('使い方: fetch-setsubi-spec.mjs denki|kan [--pdf FILE] [--fetched-at YYYY-MM-DD]');
  const opt = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
  const file = opt('--pdf');
  let bytes;
  if (file) bytes = fs.readFileSync(file);
  else {
    const res = await fetch(spec.url, { headers: { 'user-agent': 'setsubi-spec-fetch' } });
    if (!res.ok) throw new Error('取得に失敗: ' + spec.url + ' ' + res.status);
    bytes = Buffer.from(await res.arrayBuffer());
  }
  const text = chapterText(pdfPages(bytes), spec);
  fs.writeFileSync(path.join(root, spec.out), text);
  console.log('書いた: ' + spec.out + '(' + text.length + ' 字。取得日 ' + (opt('--fetched-at') ?? today()) + ')');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main(process.argv.slice(2));

// 置き換えの評価(F11b): 架空の書類を置き換え、正解の表と比べて、置き換え漏れの率と置き換えすぎの率を数える。
// 正解の表はリポジトリの外に置く(作る係とは別の文脈が作る)。ここは表を受け取って数えるだけで、表の語を外に出さない。
// 返す値は件数と率だけ(語そのものは入れない)。エラーの文にも語を入れず、行の番号だけを書く。
//
// 正解の表の形(CSV、UTF-8、見出し行あり): file,text,kind
//   file: 書類の置き場(fixtures/)からの相対パス / text: 隠すべき語(書類の中の書き方のまま)
//   kind: 人名・会社名・現場名・住所・電話・メール・許可番号 のどれか
// 数え方:
//   漏れの率 = 正解の語のうち、置き換え後の文に元のまま残った数 ÷ 正解の語の数(空白の有無は無視して探す)
//   置き換えすぎの率 = 置き換えた語(書類ごとに重ねずに数える)のうち、正解のどの語とも重ならない数 ÷ 置き換えた語の数
//   一部だけ: 元のままは残っていないが、1つの記号で丸ごと置き換わってもいない正解の語の数(参考)
// 2通り: 辞書に語を足さない場合 / 正解の表の人名・現場名を、同じ案件(file の最初のフォルダ)の辞書に足した場合

import { createMasker } from './core.mjs';
import { CONSTRUCTION_DICT } from './dict-construction.mjs';

export const KINDS = {
  人名: 'person',
  会社名: 'company',
  現場名: 'site',
  住所: 'address',
  電話: 'phone',
  メール: 'email',
  許可番号: 'license',
};

// CSV を行の配列にする(引用符・引用符の中のカンマや改行・BOM・CRLF を読む)
export function parseCsv(text) {
  const src = String(text ?? '').replace(/^﻿/, '');
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
    } else if (c === '"' && field === '') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (quoted) throw new Error('CSV の引用符が閉じていません');
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ''));
}

// 正解の表を読んで確かめる。おかしければ行の番号を書いた Error(語は書かない)
export function parseGold(text) {
  const rows = parseCsv(text);
  if (!rows.length) throw new Error('正解の表が空です');
  const head = rows[0].map((h) => h.trim());
  const col = (n) => head.indexOf(n);
  if (col('file') < 0 || col('text') < 0 || col('kind') < 0) throw new Error('正解の表の見出しは file,text,kind にしてください');
  const out = [];
  rows.slice(1).forEach((r, i) => {
    const line = i + 2;
    const file = (r[col('file')] ?? '').trim().replace(/\\/g, '/');
    const t = (r[col('text')] ?? '').trim();
    const kind = (r[col('kind')] ?? '').trim();
    if (!file || !t || !kind) throw new Error(`正解の表の ${line} 行目に空の欄があります`);
    if (!KINDS[kind]) throw new Error(`正解の表の ${line} 行目の kind が決めた種類(${Object.keys(KINDS).join('・')})のどれでもありません`);
    if (file.startsWith('/') || /^[A-Za-z]:/.test(file) || file.split('/').includes('..')) throw new Error(`正解の表の ${line} 行目の file は書類の置き場からの相対パスにしてください`);
    out.push({ line, file, text: t, kind });
  });
  if (!out.length) throw new Error('正解の表に語の行がありません');
  return out;
}

const keyOf = (s) => String(s).replace(/[\s　]+/g, '');
const rate = (n, d) => (d ? n / d : null);

// docs: { 'A/x.md': '本文', ... } / gold: parseGold の結果 / addNames: 人名・現場名を辞書に足すか
export function scoreCase(docs, gold, { addNames = false } = {}) {
  const res = {
    files: 0, gold: 0, notInDoc: 0, leaked: 0, partial: 0, replaced: 0, over: 0,
    byKind: Object.fromEntries(Object.keys(KINDS).map((k) => [k, { gold: 0, leaked: 0 }])),
  };
  const files = [...new Set(gold.map((g) => g.file))];
  for (const f of files) if (!(f in docs)) throw new Error('正解の表にある file が書類の置き場にありません(' + (gold.find((g) => g.file === f).line) + ' 行目)');
  for (const file of Object.keys(docs).sort()) {
    const text = docs[file];
    const golds = gold.filter((g) => g.file === file);
    const masker = createMasker({ dictionaries: [CONSTRUCTION_DICT] });
    if (addNames) {
      const project = file.split('/')[0];
      for (const g of gold) {
        if ((g.kind === '人名' || g.kind === '現場名') && g.file.split('/')[0] === project) masker.addTerm(g.text, KINDS[g.kind]);
      }
    }
    const { masked, map } = masker.mask(text);
    res.files++;
    const mk = keyOf(masked);
    const tk = keyOf(text);
    const goldKeys = [];
    for (const g of golds) {
      const gk = keyOf(g.text);
      if (!tk.includes(gk)) { res.notInDoc++; continue; } // 表の誤り。数に入れず、件数だけ出す
      goldKeys.push(gk);
      res.gold++;
      res.byKind[g.kind].gold++;
      if (mk.includes(gk)) { res.leaked++; res.byKind[g.kind].leaked++; }
      else if (!map.some((e) => keyOf(e.original).includes(gk))) res.partial++;
    }
    for (const e of map) {
      res.replaced++;
      const ek = keyOf(e.original);
      if (!goldKeys.some((gk) => ek.includes(gk) || gk.includes(ek))) res.over++;
    }
  }
  res.leakRate = rate(res.leaked, res.gold);
  res.overRate = rate(res.over, res.replaced);
  return res;
}

export function scoreAll(docs, gold) {
  return { plain: scoreCase(docs, gold), withNames: scoreCase(docs, gold, { addNames: true }) };
}

const pct = (r) => (r == null ? '—' : (r * 100).toFixed(1) + '%');

// 件数と率だけの Markdown(語は入れない)
export function toMarkdown(result) {
  const cases = [['辞書に足さない', result.plain], ['人名・現場名を辞書に足した', result.withNames]];
  const lines = [
    '| 場合 | 書類 | 正解の語 | 漏れ | 漏れの率 | 一部だけ | 置き換えた語 | 置き換えすぎ | 置き換えすぎの率 | 表の語が書類に無い |',
    '|---|---|---|---|---|---|---|---|---|---|',
    ...cases.map(([n, r]) => `| ${n} | ${r.files} | ${r.gold} | ${r.leaked} | ${pct(r.leakRate)} | ${r.partial} | ${r.replaced} | ${r.over} | ${pct(r.overRate)} | ${r.notInDoc} |`),
    '',
    '| 種類 | 正解の語 | 漏れ(足さない) | 漏れ(足した) |',
    '|---|---|---|---|',
    ...Object.keys(KINDS).map((k) => `| ${k} | ${result.plain.byKind[k].gold} | ${result.plain.byKind[k].leaked} | ${result.withNames.byKind[k].leaked} |`),
  ];
  return lines.join('\n') + '\n';
}

#!/usr/bin/env node
// 公告から拾った条件を、正解の表と比べて数える(F41b)。AI も通信も使わない
// 数え方は2つを並べて出す(F65d): 1つの欄で拾った全部の行で判定する(主)・欄の最初の1行だけで判定する(前の数え方)
// 使い方: node scripts/measure-bid-intake.mjs <拾った条件のフォルダ>(N1.json〜 が入っている)
// リポジトリに写さない公告を測るとき: ... <拾った条件のフォルダ> --answers <正解の表のフォルダ> --notices <原文のフォルダ>
// --help で使い方。無いフォルダは、正解の表を読む前に1行で知らせて 1 で終わる(F83a5)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkConditions, STATUS } from '../plugin/skills/bid-intake/scripts/check-conditions.mjs';
import { readArgs, handleArgs, needPath, resolveIn, runMain } from './cli.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NOTICES = path.join(ROOT, 'fixtures/bid-intake/公告');
const ANSWERS = path.join(ROOT, 'docs/samples/bid-intake/測り/正解');
const norm = (s) => String(s ?? '').normalize('NFKC').replace(/\s/g, '');

// 正解の表を読む(| 欄 | 値 | 備考 |)。値の「/」は全部、「|」(&#124;)はどれか
// 原文の行は「原文: a.txt b.txt」か「- 原文: `パス`(説明)」。後の形はファイルの名前だけを使う
export function parseAnswer(text) {
  const line = text.match(/^(?:- )?原文: (.+)$/m)?.[1] ?? '';
  const quoted = line.match(/^`([^`]+)`/)?.[1];
  const files = quoted ? [path.basename(quoted)] : line.trim().split(/\s+/);
  const rows = text.split('\n').filter((l) => /^\| [a-z]/.test(l)).map((l) => {
    const [key, value, note] = l.split('|').slice(1, 4).map((c) => c.trim());
    return { key, value, note };
  });
  return { files, rows };
}

// value は1行の文か、行の配列。断片はどれか1行の中に丸ごとあるかを見る(行をつないだ境目では当てない)
export const matches = (value, answer) => {
  const lines = [value].flat().map(norm);
  return answer.split(' / ').every((all) =>
    all.split('&#124;').some((any) => lines.some((l) => l.includes(norm(any)))));
};

const hasValue = (p) => !!p && !p.absent && p.value != null && p.value !== '';

// 1欄を分ける: 正しい / 誤り / 漏れ / 正しく書いていない / 作った。picked はその欄で拾った1行か、行の配列
export function judge(row, picked) {
  const absent = row.value === '書いていない';
  const values = [picked].flat().filter(hasValue).map((p) => p.value);
  if (absent) return values.length ? '作った' : '正しく書いていない';
  if (!values.length) return '漏れ';
  return matches(values, row.value) ? '正しい' : '誤り';
}

// 正解の表の名前は N1.md でも P1_正解.md でもよい(原文と同じフォルダに置いてあっても .md だけを読む)
export const answerId = (name) => name.endsWith('.md') ? name.replace(/(_正解)?\.md$/, '') : null;

const blank = () => ({ total: {}, perNotice: [], misses: [], plant: 0, plantHit: 0, fine: 0, falseCheck: 0 });
const ALL_LINES = (lines) => lines;
const FIRST_LINE = (lines) => lines.slice(0, 1);

// 1つの公告を1つの数え方で r に足す。pick は欄の行のうちどれを見るか。返すのは 欄 → 分け方
function countNotice(r, id, ans, picked, res, pick) {
  const count = {}; const kinds = {};
  for (const row of ans.rows) {
    const lines = pick(picked.conditions.filter((c) => c.key === row.key));
    const j = judge(row, lines);
    kinds[row.key] = j;
    count[j] = (count[j] ?? 0) + 1; r.total[j] = (r.total[j] ?? 0) + 1;
    if (!['正しい', '正しく書いていない'].includes(j)) r.misses.push({ id, key: row.key, kind: j, value: lines.filter(hasValue).map((p) => p.value).join(' / '), answer: row.value });
    const st = pick(res.rows.filter((x) => x.key === row.key)).map((x) => x.status);
    const checked = st.includes(STATUS.check);
    if (/^仕込み/.test(row.note)) { r.plant++; if (checked) r.plantHit++; else r.misses.push({ id, key: row.key, kind: '機械の見逃し', value: st.join(' / '), answer: row.value }); }
    else if (!/^語あり/.test(row.note)) { r.fine++; if (checked) { r.falseCheck++; r.misses.push({ id, key: row.key, kind: '機械の誤報', value: st.join(' / '), answer: row.value }); } }
  }
  r.perNotice.push({ id, count });
  return kinds;
}

// 返す数は全部の行の数え方。first に最初の1行の数え方。perNotice[].changed は2つの数え方で分け方が違う欄
export function measure(dir, { answers = ANSWERS, notices = NOTICES } = {}) {
  const all = blank(); const first = blank();
  for (const f of fs.readdirSync(answers).filter(answerId).sort()) {
    const id = answerId(f);
    const ans = parseAnswer(fs.readFileSync(path.join(answers, f), 'utf8'));
    const picked = JSON.parse(fs.readFileSync(path.join(dir, id + '.json'), 'utf8'));
    const sources = ans.files.map((file) => ({ file, text: fs.readFileSync(path.join(notices, file), 'utf8') }));
    const res = checkConditions(picked, sources);
    const a = countNotice(all, id, ans, picked, res, ALL_LINES);
    const b = countNotice(first, id, ans, picked, res, FIRST_LINE);
    all.perNotice.at(-1).changed = Object.keys(a).filter((k) => a[k] !== b[k]).map((key) => ({ key, all: a[key], first: b[key] }));
  }
  return { ...all, first };
}

const KINDS = ['正しい', '正しく書いていない', '誤り', '漏れ', '作った'];
const countText = (count) => KINDS.map((k) => `${k} ${count[k] ?? 0}`).join('・');
const machineText = (r) => `仕込みの食い違い ${r.plant} のうち機械が確かめが要るにした ${r.plantHit}。仕込みの無い欄 ${r.fine} のうち誤報 ${r.falseCheck}`;
const missText = (m) => `- ${m.id} ${m.key} ${m.kind} | 値: ${m.value} | 正解: ${m.answer}`;

// 2つの数え方を並べた出力の行
export function reportLines(r) {
  const out = [];
  r.perNotice.forEach((n, i) => {
    out.push(`${n.id} 全部の行: ${countText(n.count)}`, `${n.id} 最初の1行: ${countText(r.first.perNotice[i].count)}`);
    for (const c of n.changed) out.push(`  ${n.id} ${c.key} | 最初の1行: ${c.first} → 全部の行: ${c.all}`);
  });
  out.push(`合計 全部の行: ${countText(r.total)}`, `合計 最初の1行: ${countText(r.first.total)}`);
  out.push(`機械 全部の行: ${machineText(r)}`, `機械 最初の1行: ${machineText(r.first)}`);
  out.push('全部の行で外れた欄:', ...r.misses.map(missText));
  out.push('最初の1行で外れた欄:', ...r.first.misses.map(missText));
  return out;
}

export const USAGE_LINE = '使い方: node scripts/measure-bid-intake.mjs [拾った条件のフォルダ] [--answers 正解の表のフォルダ] [--notices 原文のフォルダ](くわしくは --help)';
export const USAGE = [
  '使い方: node scripts/measure-bid-intake.mjs [拾った条件のフォルダ] [--answers 正解の表のフォルダ] [--notices 原文のフォルダ]',
  '',
  '公告から拾った条件(N1.json など)を正解の表と比べて数え、標準出力に出します。ファイルは書きません。AI も通信も使いません。',
  '読むもの: 拾った条件のフォルダの <番号>.json・正解の表のフォルダの .md・原文のフォルダの公告の文',
  '',
  '引数:',
  '  拾った条件のフォルダ        省くと docs/samples/bid-intake/測り',
  '  --answers 正解の表のフォルダ  省くと docs/samples/bid-intake/測り/正解',
  '  --notices 原文のフォルダ      省くと fixtures/bid-intake/公告',
  '  --help, -h                   この使い方を出す',
  '',
  '例: node scripts/measure-bid-intake.mjs docs/samples/bid-intake/測り',
].join('\n');

export function main(argv, io) {
  const r = readArgs(argv, { values: ['--answers', '--notices'], max: 1 });
  const done = handleArgs(r, io, { usage: USAGE, usageLine: USAGE_LINE });
  if (done !== null) return done;
  // 入力のフォルダを先に確かめる(正解の表はその後で読む)
  const dir = resolveIn(io, r.positional[0] ?? path.join(ROOT, 'docs/samples/bid-intake/測り'));
  const answers = r.opts['--answers'] ? resolveIn(io, r.opts['--answers']) : undefined;
  const notices = r.opts['--notices'] ? resolveIn(io, r.opts['--notices']) : undefined;
  for (const p of [dir, answers, notices].filter(Boolean)) {
    const missing = needPath(p, io, { dir: true });
    if (missing !== null) return missing;
  }
  let result;
  try {
    result = measure(dir, { answers, notices });
  } catch (e) {
    // フォルダはあっても中の1つが無いとき(N3.json が無いなど)。スタックは出さない
    if (e?.code === 'ENOENT') { io.error('ファイルがありません: ' + e.path); return 1; }
    throw e;
  }
  io.log(reportLines(result).join('\n'));
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) runMain(main);

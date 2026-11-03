#!/usr/bin/env node
// 発注者の仕様書の文から作った規則表の行(段取りの行・施工計画書の記載項目の行)を、仕様書の原文と機械で照らす(F26a)
// 照らし方は作品の scripts/check-quotes.mjs と同じ(src/quote-check.mjs の verifyQuote。許す違いは空白だけ)。
// そのうえで、行が指す節(1-1-1-6 など)の中に抜き書きがあるかまで確かめる。
//
// 使い方:
//   node check-rows.mjs <仕様書の文のファイル> <行のファイル(JSON)> [--out <残った行を書くファイル>]
//     行を1つずつ照らし、残す行と外す行(理由つき)を出す。1行でも外したら終了コード 1
//   node check-rows.mjs --list <節の番号> <仕様書の文のファイル>
//     節の中の「（1）○○」の形の列挙を、施工計画書の記載項目の行の候補(JSON)として出す(機械で拾うだけ。中身の判断はしない)
//
// 行のファイルの形: { "source": 出典, "rows": [ 行, ... ] }
//   出典: { "publisher": 発注者, "title": 題名, "edition": 版, "url": URL, "fetchedAt": 取得日 }。--out にそのまま写す(作品の画面の読み込みは出典が要る)
//   施工計画書の記載項目の行: { "kind": "plan-item", "section": "1-1-1-6", "no": 1, "label": "工事概要", "quote": "（1）工事概要" }
//   段取りの行: { "kind": "schedule", "id": "...", "phase": "start|work|completion", "when": "...", "what": "...", "to": "...",
//                 "section": "1-1-1-6", "title": "...", "quote": "...", "note": "..." }
//   決められない欄は値を "判断できない" にし、"undetermined": { "欄の名前": "決められない理由" } を添える
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyQuote, stripSpaces } from './lib/quote-check.mjs';

export const UNDETERMINED = '判断できない';
const PHASES = ['start', 'work', 'completion'];
// 節の見出しの行: 行の頭が「1-1-1-6」のような番号で、空白(全角を含む)のあとに題が続く
const HEADING_RE = /^[\s　]*(\d+(?:-\d+){1,5})[\s　]+\S/;
// 列挙の行: 行の頭が「（1）」「(1)」(全角・半角の数字)
const LIST_RE = /^[\s　]*[（(]([0-9０-９]+)[）)]/;

const toHalf = (s) => String(s).replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));

// 仕様書の文を節に分ける。返り値: Map(節の番号 → 節の文(見出しの行から次の見出しの前まで))
export function splitSections(text) {
  const lines = String(text ?? '').split(/\r?\n/);
  const map = new Map();
  let cur = null;
  let buf = [];
  const flush = () => { if (cur && !map.has(cur)) map.set(cur, buf.join('\n')); };
  for (const line of lines) {
    const m = line.match(HEADING_RE);
    if (m) { flush(); cur = m[1]; buf = [line]; } else if (cur) buf.push(line);
  }
  flush();
  return map;
}

// 節の文から「（n）○○」の列挙を拾い、記載項目の行の候補にする。
// label は抜き書きから番号と末尾の括弧書き(「（主要機械、…を含む）」など)を除いたもの。aliases は原文に無いので作らない
export function listItems(sectionText, section) {
  const rows = [];
  for (const line of String(sectionText ?? '').split(/\r?\n/)) {
    const m = line.match(LIST_RE);
    if (!m) continue;
    const quote = line.trim();
    const label = quote.slice(m[0].trim().length).replace(/[（(][^（）()]*[）)]$/, '').trim();
    rows.push({ kind: 'plan-item', section, no: Number(toHalf(m[1])), label, quote });
  }
  return rows;
}

// 文の中の数字(全角を半角にして、続いた数字を1つ)を集める
const numbersIn = (s) => (toHalf(String(s ?? '')).match(/\d+/g) || []);

// 1行を照らす。返り値: 外す理由の配列(空なら残す)
export function rowProblems(row, sections, wholeText) {
  const reasons = [];
  if (!row || typeof row !== 'object') return ['行が読めない'];
  if (row.kind !== 'plan-item' && row.kind !== 'schedule') reasons.push('種類(kind)が plan-item でも schedule でもない');
  const quote = typeof row.quote === 'string' ? row.quote : '';
  if (stripSpaces(quote).length === 0) return [...reasons, '抜き書き(quote)が無い'];

  // 抜き書きの照合(check-quotes.mjs と同じ: 空白の違いだけ許す)
  if (!verifyQuote(quote, wholeText)) reasons.push('原文に無い抜き書き');
  else if (row.section != null && row.section !== '') {
    const sec = sections.get(String(row.section));
    if (sec == null) reasons.push('節 ' + row.section + ' の見出しが原文に見つからない');
    else if (!verifyQuote(quote, sec)) reasons.push('節 ' + row.section + ' の中に無い抜き書き');
  } else if (sections.size > 0) reasons.push('節(section)が無い');

  // 「判断できない」には理由が要る
  const und = row.undetermined && typeof row.undetermined === 'object' ? row.undetermined : {};
  for (const [k, v] of Object.entries(row)) {
    if (v === UNDETERMINED && !(typeof und[k] === 'string' && und[k].trim())) reasons.push(k + ' が「判断できない」なのに理由(undetermined.' + k + ')が無い');
  }

  if (row.kind === 'plan-item') {
    const label = typeof row.label === 'string' ? row.label : '';
    if (!stripSpaces(label)) reasons.push('項目の名前(label)が無い');
    else if (label !== UNDETERMINED && !stripSpaces(quote).includes(stripSpaces(label))) reasons.push('項目の名前(label)が抜き書きに無い');
    if (row.no != null && row.no !== UNDETERMINED) {
      const m = toHalf(quote).match(LIST_RE);
      if (!m || Number(m[1]) !== Number(row.no)) reasons.push('番号(no)が抜き書きの番号と合わない');
    }
  }

  if (row.kind === 'schedule') {
    if (row.phase !== UNDETERMINED && !PHASES.includes(row.phase)) reasons.push('段(phase)が start・work・completion・判断できない のどれでもない');
    if (!(typeof row.what === 'string' && row.what.trim())) reasons.push('すること(what)が無い');
    // 言い換えの欄に、原文に無い数字(期日・金額など)を足していないか。
    // when(いつ)の数字は抜き書きの中にだけ探す。what・to は節の列挙((1)〜(4) など)をまとめることがあるので、同じ節の文の中まで探す
    const inQuote = new Set(numbersIn(quote));
    const sec = row.section != null ? sections.get(String(row.section)) : null;
    const inSection = new Set([...inQuote, ...numbersIn(sec ?? '')]);
    for (const [k, pool, where] of [['when', inQuote, '抜き書き'], ['what', inSection, '抜き書きと節'], ['to', inSection, '抜き書きと節']]) {
      const extra = numbersIn(row[k]).filter((n) => !pool.has(n));
      if (extra.length) reasons.push(k + ' に' + where + 'に無い数字(' + [...new Set(extra)].join('・') + ')');
    }
  }
  return reasons;
}

// 行をまとめて照らす。返り値: { kept, dropped: [{ row, reasons }], undetermined: [{ row, fields }] }
export function checkRows(rows, specText) {
  const sections = splitSections(specText);
  const kept = [];
  const dropped = [];
  const undetermined = [];
  for (const row of rows || []) {
    const reasons = rowProblems(row, sections, specText);
    if (reasons.length) { dropped.push({ row, reasons }); continue; }
    kept.push(row);
    const fields = Object.keys(row).filter((k) => row[k] === UNDETERMINED);
    if (fields.length) undetermined.push({ row, fields });
  }
  return { kept, dropped, undetermined };
}

const rowName = (r) => (r?.kind === 'plan-item' ? `記載項目 (${r.no ?? '?'}) ${r.label ?? ''}` : `段取り ${r?.id ?? ''} ${r?.what ?? ''}`).trim();

const isMain = Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const usage = '使い方: node check-rows.mjs <仕様書の文のファイル> <行のファイル(JSON)> [--out <ファイル>]\n        node check-rows.mjs --list <節の番号> <仕様書の文のファイル>';
  if (args[0] === '--list') {
    const [, section, file] = args;
    if (!section || !file) { console.error(usage); process.exit(2); }
    const sec = splitSections(fs.readFileSync(file, 'utf8')).get(section);
    if (sec == null) { console.error('節 ' + section + ' の見出しが原文に見つからない'); process.exit(1); }
    console.log(JSON.stringify({ rows: listItems(sec, section) }, null, 2));
    process.exit(0);
  }
  const outIdx = args.indexOf('--out');
  const out = outIdx >= 0 ? args[outIdx + 1] : null;
  const [specFile, rowsFile] = outIdx >= 0 ? args.filter((a, i) => i !== outIdx && i !== outIdx + 1) : args;
  if (!specFile || !rowsFile) { console.error(usage); process.exit(2); }
  const spec = fs.readFileSync(specFile, 'utf8');
  const data = JSON.parse(fs.readFileSync(rowsFile, 'utf8'));
  const r = checkRows(Array.isArray(data) ? data : data.rows, spec);
  for (const row of r.kept) console.log('残す\t' + rowName(row));
  for (const d of r.dropped) console.log('外す\t' + rowName(d.row) + '\t' + d.reasons.join(' / '));
  for (const u of r.undetermined) console.log('判断できない欄\t' + rowName(u.row) + '\t' + u.fields.map((f) => f + ': ' + u.row.undetermined[f]).join(' / '));
  console.log(`行 ${r.kept.length + r.dropped.length} のうち 残す ${r.kept.length}・外す ${r.dropped.length}(判断できない欄のある行 ${r.undetermined.length})`);
  if (out) fs.writeFileSync(out, JSON.stringify({ ...(data.source ? { source: data.source } : {}), rows: r.kept }, null, 2) + '\n');
  process.exit(r.dropped.length ? 1 : 0);
}

#!/usr/bin/env node
// 数量の表の行を施工パッケージに当てた結果を機械で照らし、通った行だけで参考の額を計算する(F42b)
// 値の意味は見ない。見るのは、両方の抜き書きが原文・表にそのままあるか、名前・数量・単位が抜き書きにあるか、単位が表と同じか
// 計算は lib/estimate(F42a)のプログラムで行う。AI も通信も使わない
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyQuote, stripSpaces } from './lib/quote-check.mjs';
import { estimate, NOTICE } from './lib/estimate/estimate.mjs';
import { KINDS } from './lib/estimate/indirect.mjs';
import { kyotsuhiCosts, isKyotsuhiKind, SEPARATE } from './lib/estimate/kyotsuhi.mjs';
import { DEFAULT_WORK_KIND, NOT_READ, hasKindTable, isWorkKind, workKindLabel } from './lib/work-kinds.mjs';

const CONDITION_KEYS = ['supplied', 'lossPrevention', 'disposal', 'stacked', 'regionCoef', 'addition', 'advancePercent', 'guarantee'];
const WORDS_NOT_USED = /予定価格|この額で入札/;
const norm = (s) => String(s ?? '').normalize('NFKC').toLowerCase();
const yen = (v) => Math.round(v).toLocaleString('ja-JP') + '円';
const percent = (a, b) => (b ? Math.round(a / b * 1000) / 10 : 0);
const safeText = (s) => (WORDS_NOT_USED.test(String(s ?? '')) ? '(使わない語を含むので外しました)' : String(s ?? ''));

// 標準単価表の1行の文。抜き書きはこの文の全部と同じでなければならない(find-packages.mjs がこの形で出す)
export const rowText = (pkg, row) => `${pkg.name} ${pkg.unit} ${row.condition}`;

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// 抜き書きの中の数字(名前を除いたところ)。「m3」の 3 のように字に続く数字は数えない
export function numbersIn(text) {
  return [...norm(text).matchAll(/(?<![a-z\d.,])(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?/g)].map((m) => Number(m[0].replace(/,/g, '')));
}

// 単位が語として入っているか。「m」は「m3」に一致しない
export function hasUnit(text, unit) {
  const u = norm(unit).replace(/\s/g, '');
  if (!u) return false;
  return new RegExp(`(?<![a-z])${escapeRe(u)}(?![a-z0-9])`).test(norm(text));
}

// 数量の表の側の照合。合わない理由を返す(合えば null)
export function quantityProblem(line, sources) {
  const { name, quantity, unit, quote, file } = line;
  if (!stripSpaces(quote)) return '数量の表の抜き書きがありません';
  if (/\n/.test(String(quote).trim())) return '抜き書きが2行以上あります。1行だけにしてください';
  const targets = file ? sources.filter((s) => s.file === file) : sources;
  if (!targets.length) return `抜き書きのファイル ${file} が渡されていません`;
  if (!targets.some((s) => verifyQuote(quote, s.text))) return '抜き書きが数量の表にありません';
  if (!stripSpaces(name) || !stripSpaces(quote).includes(stripSpaces(name))) return `名前「${name}」が抜き書きにありません`;
  const rest = String(quote).split(String(name).trim()).join(' ');
  if (!numbersIn(rest).includes(quantity)) return `数量 ${quantity} が抜き書きにありません`;
  if (!hasUnit(rest, unit)) return `単位 ${unit} が抜き書きにありません`;
  return null;
}

// 標準単価表の側の照合。抜き書きが、その番号のパッケージの1行の文と同じ行を返す
export function findRow(match, table) {
  const pkg = table.packages.find((p) => p.no === match?.no);
  if (!pkg) return { problem: `標準単価表に番号 ${match?.no} がありません` };
  const row = pkg.rows.find((r) => stripSpaces(rowText(pkg, r)) === stripSpaces(match.tableQuote));
  if (!row) return { problem: `抜き書きが標準単価表の番号 ${pkg.no}(${pkg.name})の行にありません` };
  return { package: { no: pkg.no, name: pkg.name, unit: pkg.unit }, row };
}

// 数量の表の文の行のうち、数字があるのにどの抜き書きにも入っていないもの。拾い漏れの目印で、題名の年なども混じる
export function uncoveredLines(sources, lines) {
  const quotes = lines.map((l) => stripSpaces(l.quote)).filter(Boolean);
  const out = [];
  for (const s of sources) {
    for (const raw of s.text.split(/\r?\n/)) {
      const t = stripSpaces(raw);
      if (!/[0-9０-９]/.test(t)) continue;
      if (!quotes.some((q) => q.includes(t) || t.includes(q))) out.push({ file: s.file, text: raw.trim() });
    }
  }
  return out;
}

const kanjiOf = (s) => new Set(norm(s).match(/[㐀-鿿]/g) ?? []);

function shareNoKanji(name, pkg, row) {
  const a = kanjiOf(name);
  if (!a.size) return false;
  const b = kanjiOf(pkg.name + row.condition);
  return b.size > 0 && ![...a].some((c) => b.has(c));
}

function laborOf(tables, prefecture) {
  const local = tables.labor?.rates?.[prefecture];
  if (!prefecture || !local || !tables.laborBase?.tokyo) return null;
  return { base: tables.laborBase.tokyo, local };
}

// 工種に積算の表が無いとき(F44a): 土木の表で積まず、どの行も合計に入れない
function notReadResult(data, sources, workKind) {
  const lines = Array.isArray(data?.lines) ? data.lines : [];
  const message = `${NOT_READ}(工種: ${workKindLabel(workKind)})`;
  return {
    kind: 'estimate-check', label: '参考の額', notice: NOTICE, title: data?.source?.title ?? '', workKindNote: message,
    amount: null,
    direct: { total: 0, uncorrectedAmount: 0, uncorrectedPercent: 0 },
    rows: [],
    notIncluded: lines.map((line, ref) => ({ ref, by: '機械', name: line.name, quantity: line.quantity, unit: line.unit, quote: line.quote ?? '', reason: message })),
    notIncludedPercent: percent(lines.length, lines.length),
    lineCount: lines.length,
    uncovered: [], indirect: null, assumptions: [], warnings: [], flags: [],
    claudeNotes: (Array.isArray(data?.notes) ? data.notes : []).map((n) => safeText(n?.text ?? n)),
    tablesUsed: [],
  };
}

// 建築系(F44e): 施工パッケージは土木の表なので行を積まない。人が入れた直接工事費と工期から共通費を出す
function kyotsuhiResult(data, workKind) {
  const c = data?.conditions ?? {};
  if (c.directCost === undefined || c.months === undefined) throw new RangeError('建築系は conditions.directCost(直接工事費・円)と conditions.months(工期・か月)を入れてください');
  const result = kyotsuhiCosts({ workKind, directCost: c.directCost, months: c.months, workClass: c.workClass, disposal: c.disposal, stacked: c.stacked });
  const lines = Array.isArray(data?.lines) ? data.lines : [];
  const reason = '施工パッケージは土木の表なので、建築系の行は積みません。直接工事費は conditions.directCost に人が入れてください';
  return {
    kind: 'estimate-check', label: '参考の額', notice: NOTICE, title: data?.source?.title ?? '', workKindNote: `工種: ${workKindLabel(workKind)}`,
    kyotsuhi: result,
    amount: result.workPrice,
    direct: { total: c.directCost, uncorrectedAmount: 0, uncorrectedPercent: 0 },
    rows: [],
    notIncluded: lines.map((line, ref) => ({ ref, by: '機械', name: line.name, quantity: line.quantity, unit: line.unit, quote: line.quote ?? '', reason })),
    notIncludedPercent: percent(lines.length, lines.length),
    lineCount: lines.length,
    uncovered: [], indirect: null, assumptions: result.assumptions, warnings: result.separate, flags: [],
    claudeNotes: (Array.isArray(data?.notes) ? data.notes : []).map((n) => safeText(n?.text ?? n)),
    tablesUsed: [result.source],
  };
}

export function checkEstimate(data, sources, tables) {
  const c = data?.conditions ?? {};
  const workKind = c.workKind ?? DEFAULT_WORK_KIND;
  if (!isWorkKind(workKind)) throw new RangeError(`conditions.workKind が分かりません: ${workKind}`);
  if (isKyotsuhiKind(workKind)) return kyotsuhiResult(data, workKind);
  if (!hasKindTable(workKind, 'estimate')) return notReadResult(data, sources, workKind);
  if (!KINDS.includes(c.kind)) throw new RangeError(`conditions.kind は次のどれか: ${KINDS.join('、')}`);
  const lines = Array.isArray(data?.lines) ? data.lines : [];
  const notIncluded = [];
  const flags = [];
  const ready = [];
  const seenQuote = new Map();
  lines.forEach((line, ref) => {
    const left = (by, reason) => notIncluded.push({ ref, by, name: line.name, quantity: line.quantity, unit: line.unit, quote: line.quote ?? '', reason });
    const problem = quantityProblem(line, sources);
    if (problem) return left('機械', problem);
    if (!line.match) { ready.push({ ...line, ref, match: null }); return undefined; }
    const found = findRow(line.match, tables.unitPrices);
    if (found.problem) return left('機械', found.problem);
    const key = stripSpaces(line.quote);
    if (seenQuote.has(key)) flags.push(`「${line.name}」は ${seenQuote.get(key)} 行目と同じ抜き書きです。二重に数えていないか確かめてください`);
    else seenQuote.set(key, ref + 1);
    if (shareNoKanji(line.name, found.package, found.row)) flags.push(`「${line.name}」と当てた「${found.package.name}」は漢字が1字も重なりません。当て方を確かめてください(機械は意味を見ていません)`);
    ready.push({ ...line, ref, match: found });
    return undefined;
  });
  const labor = laborOf(tables, c.prefecture);
  const result = estimate({ kind: c.kind, labor, lines: ready, ...Object.fromEntries(CONDITION_KEYS.filter((k) => c[k] !== undefined).map((k) => [k, c[k]])) });
  for (const x of result.direct.excluded) {
    const line = lines[x.ref];
    if (line.match) notIncluded.push({ ...x, by: '機械', quote: line.quote });
    else notIncluded.push({ ...x, by: 'Claude', quote: line.quote, reason: safeText(line.reason) || '施工パッケージに当てていません' });
  }
  notIncluded.sort((a, b) => a.ref - b.ref);
  const has = result.direct.rows.length > 0;
  const assumptions = [`工種区分「${c.kind}」は数量の表からの見立てです。人が確かめてください`];
  if (!labor) assumptions.push(`労務の補正はしていません(都道府県「${c.prefecture ?? ''}」の労務単価がありません)`);
  if (has) assumptions.push(...result.indirect.assumptions);
  const rows = result.direct.rows.map((r) => {
    const line = lines[r.ref];
    return { ...r, quote: line.quote, file: line.file ?? null, tableQuote: line.match.tableQuote, reason: safeText(line.reason ?? line.match.reason) };
  });
  return {
    kind: 'estimate-check',
    label: result.label,
    notice: NOTICE,
    title: data?.source?.title ?? '',
    amount: has ? result.workPrice : null,
    direct: { total: result.direct.total, uncorrectedAmount: result.direct.uncorrectedAmount, uncorrectedPercent: result.direct.uncorrectedPercent },
    rows,
    notIncluded,
    notIncludedPercent: percent(notIncluded.length, lines.length),
    lineCount: lines.length,
    uncovered: uncoveredLines(sources, lines),
    indirect: has ? result.indirect : null,
    assumptions,
    warnings: has ? result.indirect.warnings : [],
    flags,
    claudeNotes: (Array.isArray(data?.notes) ? data.notes : []).map((n) => safeText(n?.text ?? n)),
    tablesUsed: [tables.unitPrices?.meta, tables.labor?.meta, tables.laborBase?.meta].filter(Boolean).map((m) => ({ title: m.title, url: m.url ?? null, fetchedAt: m.fetchedAt ?? null })),
  };
}

const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

// 建築系の結果(F44e)。行の積み上げが無いので、段の表と前提だけを出す
function renderKyotsuhi(r) {
  const k = r.kyotsuhi;
  const amountOf = (x) => (x.separate ? SEPARATE : yen(x.amount));
  const how = (x, symbol) => (x.separate ? x.reason : `率 ${x.rate}%(${x.formula}。${symbol})`);
  const s = [`# 参考の額: ${r.title || '(題名なし)'}`, '', r.notice + '。', '', `${r.workKindNote}。${k.work}の共通費を、公共建築工事共通費積算基準の別表の式で計算しました。直接工事費は人が入れた額で、この道具は確かめていません。`, ''];
  s.push('| 段 | 額 | 率と式 | 出どころ |', '|---|---|---|---|');
  s.push(`| 直接工事費(入れた額) | ${yen(k.directCost)} | | |`);
  if (k.disposal) s.push(`| うち処分費(率の計算から除く) | ${yen(k.disposal)} | | 公共建築工事共通費積算基準 2(1)・3(1) |`);
  s.push(`| 共通仮設費 | ${amountOf(k.commonTemporary)} | ${how(k.commonTemporary, `P=${k.commonTemporary.value}千円、T=${k.months}か月`)} | ${k.commonTemporary.source} |`);
  s.push(`| 現場管理費 | ${amountOf(k.siteManagement)} | ${how(k.siteManagement, `Np=${k.siteManagement.value}千円、T=${k.months}か月`)} | ${k.siteManagement.source} |`);
  s.push(`| 一般管理費等 | ${amountOf(k.generalAdmin)} | ${how(k.generalAdmin, `Cp=${(k.cost ?? 0) / 1000}千円`)} | ${k.generalAdmin.source} |`);
  s.push(`| 参考の額(工事価格・税抜き) | ${k.workPrice === null ? SEPARATE : yen(k.workPrice)} | | |`, '');
  const section = (title, items) => s.push(`## ${title}`, '', ...(items.length ? items.map((x) => '- ' + x) : ['- なし']), '');
  section('別途になった段', r.warnings);
  section('前提(人が確かめる)', r.assumptions);
  section('合計に入っていない行', r.notIncluded.map((x) => `${x.name} ${x.quantity ?? ''} ${x.unit ?? ''}: ${x.reason}`));
  section('Claude が気づいたこと(機械の確かめではない)', r.claudeNotes);
  section('使った表', r.tablesUsed.map((m) => `${m.title} ${m.url}(取得日 ${m.fetchedAt})`));
  return s.join('\n');
}

// 人が読む結果(Markdown)
export function renderMarkdown(r) {
  if (r.kyotsuhi) return renderKyotsuhi(r);
  const s = [`# 参考の額: ${r.title || '(題名なし)'}`, '', r.notice + '。', '', ...(r.workKindNote ? [r.workKindNote + '。積算の表が無いので額を出していません。', ''] : [])];
  s.push('| 項目 | 額 | 割合 |', '|---|---|---|');
  s.push(`| 参考の額(工事価格・税抜き) | ${r.amount === null ? '出せません(合計に入った行がありません)' : yen(r.amount)} | |`);
  s.push(`| 直接工事費(合計に入った行の積み上げ) | ${yen(r.direct.total)} | |`);
  s.push(`| 補正していない部分 | ${yen(r.direct.uncorrectedAmount)} | 直接工事費の ${r.direct.uncorrectedPercent}% |`);
  s.push(`| 合計に入っていない行 | 額は出せません(単価が決まらないため) | 渡した ${r.lineCount} 行のうち ${r.notIncluded.length} 行(行の数で ${r.notIncludedPercent}%) |`);
  s.push(`| 数字があるのに、どの行にも拾っていない文の行 | 額は出せません | ${r.uncovered.length} 行(題名の年なども数えます) |`);
  s.push('', '合計に入っていない行の分は、直接工事費にも間接費にも入っていません。その分だけ、この額は少なく出ています。', '');
  s.push('## 1行ごとの額', '', '| 数量の表の行 | 数量 | 施工パッケージ | 標準単価 | 積算単価 | 金額 | 補正していない割合 |', '|---|---|---|---|---|---|---|');
  for (const x of r.rows) s.push(`| ${cell(x.name)} | ${x.quantity} ${cell(x.unit)} | ${x.source.no} ${cell(x.source.package)} | ${x.standard} | ${x.price} | ${yen(x.amount)} | ${Math.round(x.uncorrectedPercent * 10) / 10}% |`);
  s.push('', '## 1行ごとの出どころ', '');
  for (const x of r.rows) {
    s.push(`### ${x.name}`, '', `- 数量の表: 「${cell(x.quote)}」${x.file ? `(${x.file})` : ''}`, `- 標準単価表: 「${cell(x.tableQuote)}」${x.source.pdfPage ? `(PDF p.${x.source.pdfPage})` : ''}`, `- 当てた理由(Claude の見立て。機械の確かめではない): ${x.reason || '書いてありません'}`);
    for (const a of x.applied) s.push(`- 補正した: ${a.name ?? a.key}(${a.from}。${a.base} → ${a.local})`);
    for (const h of x.humanFields) s.push(`- 人が補正する欄(空): ${h.name ?? h.key}(構成比 ${h.share}%)`);
    s.push('');
  }
  if (r.indirect) {
    const i = r.indirect;
    s.push('## 間接費と工事価格', '', '| 段 | 額 | 式 | 出どころ |', '|---|---|---|---|');
    s.push(`| 共通仮設費 | ${yen(i.commonTemporary.amount)} | 率 ${i.commonTemporary.rate}%(${i.commonTemporary.how}) | ${i.commonTemporary.source} |`);
    s.push(`| 現場管理費 | ${yen(i.siteManagement.amount)} | 率 ${i.siteManagement.rate}%(${i.siteManagement.how}) | ${i.siteManagement.source} |`);
    s.push(`| 一般管理費等 | ${yen(i.generalAdmin.amount)} | 率 ${i.generalAdmin.rate}% | ${i.generalAdmin.source} |`);
    s.push(`| 工事価格 | ${yen(i.workPrice)} | 10,000円単位 | 同じ |`, '', `式の資料: ${i.source?.title ?? '土木工事工事費積算要領及び基準の運用'}`, '');
  }
  const section = (title, items) => s.push(`## ${title}`, '', ...(items.length ? items.map((x) => '- ' + x) : ['- なし']), '');
  section('合計に入っていない行', r.notIncluded.map((x) => `${x.name} ${x.quantity ?? ''} ${x.unit ?? ''}: ${x.reason}(${x.by}の判断)`));
  section('どの行にも拾っていない文の行', r.uncovered.map((x) => `${x.file}: ${x.text}`));
  section('前提(人が確かめる)', r.assumptions);
  section('知らせ', r.warnings);
  section('確かめが要る(合計には入っている)', r.flags);
  section('Claude が気づいたこと(機械の確かめではない)', r.claudeNotes);
  section('使った表', r.tablesUsed.map((m) => `${m.title}${m.url ? ` ${m.url}` : ''}${m.fetchedAt ? `(取得日 ${m.fetchedAt})` : ''}`));
  return s.join('\n');
}

export function summaryLine(r) {
  if (r.kyotsuhi) return `${r.amount === null ? `参考の額は${SEPARATE}です(率の範囲の外)` : `参考の額 ${yen(r.amount)}`}。${r.workKindNote}・直接工事費 ${yen(r.direct.total)}・工期 ${r.kyotsuhi.months} か月`;
  const head = r.amount === null ? '参考の額は出せません' : `参考の額 ${yen(r.amount)}`;
  return `${head}。合計に入った行 ${r.rows.length}・入っていない行 ${r.notIncluded.length}・補正していない部分 ${yen(r.direct.uncorrectedAmount)}(${r.direct.uncorrectedPercent}%)・拾っていない文の行 ${r.uncovered.length}・確かめが要る ${r.flags.length}`;
}

// 機械が入れなかった行があれば 1(人が理由を見る)
export const exitCodeOf = (r) => (r.notIncluded.some((x) => x.by === '機械') ? 1 : 0);

export function loadTables(dir) {
  const read = (name) => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
  return { unitPrices: read('unit-prices.json'), labor: read('labor-rates.json'), laborBase: read('labor-base.json') };
}

const isMain = Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const take = (flag) => { const i = args.indexOf(flag); if (i < 0) return null; const v = args[i + 1]; args.splice(i, 2); return v; };
  const out = take('--out');
  const md = take('--md');
  const dir = take('--tables') ?? path.join('tmp', 'estimate-data');
  const [dataFile, ...files] = args;
  if (!dataFile) { console.error('使い方: node check-estimate.mjs <当てた結果.json> <数量の表のファイル ...> [--tables <表の置き場>] [--out <結果.json>] [--md <結果.md>]'); process.exit(2); }
  try {
    const data = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
    const sources = files.map((f) => ({ file: path.basename(f), text: fs.readFileSync(f, 'utf8') }));
    // 建築系は単価表を使わない。土木は数量の表の文が要る
    const building = isKyotsuhiKind(data?.conditions?.workKind);
    if (!building && !files.length) throw new RangeError('数量の表のファイルを渡してください');
    const r = checkEstimate(data, sources, building ? null : loadTables(dir));
    for (const x of r.notIncluded) console.log(['入らない', x.by, x.name, x.reason].join('\t'));
    for (const x of r.flags) console.log('確かめ\t' + x);
    console.log(summaryLine(r));
    if (out) fs.writeFileSync(out, JSON.stringify(r, null, 2) + '\n');
    if (md) fs.writeFileSync(md, renderMarkdown(r));
    process.exit(exitCodeOf(r));
  } catch (e) {
    console.error(e.message);
    process.exit(2);
  }
}

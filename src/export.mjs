// 結果の書き出し(F05e)。判定の結果を「行の配列」にし、CSV の文字列にする。
// DOM には触らない。画面(src/ui/app.mjs)が、この文字列を Blob にしてダウンロードさせる(通信はしない)。
// のちの段の結果も、同じ列(COLUMNS)の行を作る関数を足せば、同じ toCsv で書き出せる。
import { CHECKLIST_NOTICE, CHECKLIST_SCOPE, checklistReferenceText } from './ui/view.mjs';
import { CHECKLIST_LAW } from './checklist.mjs';
import { sourceVersion, NO_VERSION } from './source-version.mjs';
import { kindNote, kindSource, kindSourceText } from './work-kind-tables.mjs';
import { NOT_READ, workKindLabel } from './work-kinds.mjs';
import { basisLabel, SUMMARY_FIELDS, BID_STATUS, ENGINEER, TAICHO_STATUS, COPY_STATUS, fieldLabel, SCHEDULE_STATUS, SCHEDULE_PHASE, SCHEDULE_NOTE_LABEL, scheduleNoteKey } from './ui/view.mjs';

// すべての結果で共通の列
export const COLUMNS = ['区分', '項目', '状態', '説明', '根拠の条', '根拠の原文(抜き書き)', '取得日', '版(何年何月時点の条文・資料か)', '例外・読み方の注意'];

const uniq = (xs) => [...new Set(xs)];

// 根拠(basis の配列)を、列「根拠の条」「根拠の原文」「取得日」「版」の4つの欄にする。1つの欄の中は改行で区切る(F28d で版を足した)
function basisCells(list = []) {
  return [
    uniq(list.map(basisLabel)).join('\n'),
    list.map((b) => '【' + basisLabel(b) + '】' + (b.quote ?? '')).join('\n'),
    uniq(list.map((b) => b.fetchedAt).filter(Boolean)).join('\n'),
    uniq(list.map((b) => b.version || NO_VERSION)).join('\n'),
  ];
}

function row(section, label, status, note, basis, exceptions = []) {
  return [section, label, status, note ?? '', ...basisCells(basis), (exceptions ?? []).join('\n')];
}

// 入札前の確認(bidCheck の返り値): 見出しの行 + 項目ごとに1行
export function bidRows(bid) {
  return [COLUMNS.slice(), ...bid.items.map((it) => {
    const status = (BID_STATUS[it.status] ?? it.status) + (it.value && ENGINEER[it.value] ? '(' + ENGINEER[it.value] + ')' : '');
    return row('入札前の確認', it.label, status, it.note, it.basis, it.exceptions);
  })];
}

// 入札前の確認の「確認が要る点」(見出しの行なし)
export function bidCheckRows(bid) {
  return (bid.checks ?? []).map((c) => row('確認が要る点', c.label, BID_STATUS.needs_check, c.message, c.basis ?? [], []));
}

// 労務費と処遇の確認(F50a。見出しの行なし)
export function bidDutyRows(bid) {
  return (bid.duties ?? []).map((d) => row('労務費と処遇の確認', d.label, BID_STATUS.needs_check, d.note, d.basis, d.exceptions));
}

// 施工体制台帳が要るか(judgeTaicho の返り値): 見出しの行 + 台帳・写しの結論の2行 + 当てはめた規則表の行ごとに1行
export function taichoRows(t) {
  const all = t.reasons.flatMap((r) => r.basis ?? []);
  return [
    COLUMNS.slice(),
    row('施工体制台帳', '施工体制台帳', TAICHO_STATUS[t.status] ?? t.status, t.message ?? '', all, []),
    row('施工体制台帳', '写しを発注者に出すか', COPY_STATUS[t.copyToOrderer] ?? t.copyToOrderer, '', [], []),
    ...t.reasons.map((r, i) => row('施工体制台帳(当てはめた規則)', '当てはめた規則 ' + (i + 1), '', r.action, r.basis, r.exceptions)),
  ];
}

// 金額の比べ方(amountBasis)の行。無ければ空
export function amountBasisRows(ab, section) {
  if (!ab) return [];
  const tax = ab.tax === 'included' ? '税込み' : ab.tax === 'excluded' ? '税抜き' : String(ab.tax ?? '');
  return [row(section, '金額の比べ方', tax, ab.note, ab.basis, [])];
}

// 工種の行(F44a)。共通の列で1行
export function workKindRows(kind) {
  return [row('工種', workKindLabel(kind), '', '', [], [])];
}

// 書き出した日時を ISO 8601 の端末の時刻(時差つき)で書く(F83a8)。例 2026-11-07T08:45:12+09:00
const z2 = (n) => String(n).padStart(2, '0');
export function isoLocal(d) {
  const off = -d.getTimezoneOffset();
  const a = Math.abs(off);
  return d.getFullYear() + '-' + z2(d.getMonth() + 1) + '-' + z2(d.getDate()) + 'T' + z2(d.getHours()) + ':' + z2(d.getMinutes()) + ':' + z2(d.getSeconds())
    + (off >= 0 ? '+' : '-') + z2(Math.floor(a / 60)) + ':' + z2(a % 60);
}

// 入れた条件の要約(F83a8)。input は readBidForm の返り値。値の入っている物だけを、まとめの枠と同じ名前で並べる。
// 参加の条件の本文(participationConditions)は写さない(F82c)
const yen = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '円';
const fieldName = (id) => SUMMARY_FIELDS.find((f) => f[0] === id)?.[1] ?? id;
const fieldMap = (id) => SUMMARY_FIELDS.find((f) => f[0] === id)?.[2] ?? {};
export function conditionSummary(input = {}) {
  const parts = [];
  const orderer = fieldMap('orderer')[input.orderer];
  if (orderer) parts.push(fieldName('orderer') + ' ' + orderer);
  if (input.direct === true || input.direct === false) parts.push(fieldName('direct') + ' ' + (input.direct ? '元請け' : '下請け'));
  if (Number.isFinite(input.contractAmount)) parts.push(fieldName('contract-amount') + ' ' + yen(input.contractAmount));
  if (Number.isFinite(input.subcontractTotal)) parts.push(fieldName('subcontract-total') + ' ' + yen(input.subcontractTotal));
  const workType = fieldMap('work-type')[input.workType];
  if (workType) parts.push(fieldName('work-type') + ' ' + workType);
  return parts.join('・');
}

// 根拠の出典の URL。根拠の行で使った物を、出た順に重なりを除いて並べる
function sourceUrls(bid, t) {
  const lists = [
    ...bid.items.map((it) => it.basis), ...(bid.checks ?? []).map((c) => c.basis), ...(bid.duties ?? []).map((d) => d.basis), bid.amountBasis?.basis,
    ...t.reasons.map((r) => r.basis), t.amountBasis?.basis,
  ];
  return uniq(lists.flatMap((l) => l ?? []).map((b) => b.url).filter(Boolean));
}

// 注意の行に足す書き出しの情報(F83a8)。meta = { version: 道具の版, exportedAt: Date, input: readBidForm の返り値 }。
// 日時は取得日の列ではなく、注意の行の説明の列に入れる
function exportMetaLines(meta, bid, t) {
  if (!meta) return [];
  const cond = meta.input ? conditionSummary(meta.input) : '';
  const urls = sourceUrls(bid, t);
  return [
    meta.version ? '道具の版: ' + meta.version : null,
    meta.exportedAt ? '書き出した日時: ' + isoLocal(meta.exportedAt) + '(この端末の時計)' : null,
    meta.input ? '入れた条件: ' + (cond || '入っていません') : null,
    urls.length ? '出典の URL:\n' + urls.join('\n') : null,
  ].filter(Boolean);
}

// 1段目(入札前と台帳)の書き出しの行。最後に、候補であって最後は人が判断する旨を入れる
// ここでの最後は stage1Rows の中の話で、入札前の CSV のファイルは、このあとに工種と安全の法令の候補の行をつなぐ(F61a)
// meta を渡すと、注意の行の説明の列に版・書き出した日時・入れた条件・出典の URL を足す(F83a8。行の数と列は変えない)
export function stage1Rows(bid, t, notice, meta) {
  return [
    ...bidRows(bid),
    ...bidCheckRows(bid),
    ...bidDutyRows(bid),
    ...amountBasisRows(bid.amountBasis, '入札前の確認'),
    ...taichoRows(t).slice(1),
    ...amountBasisRows(t.amountBasis, '施工体制台帳'),
    row('注意', '注意', '', [notice, bid.disclaimer, ...exportMetaLines(meta, bid, t)].filter(Boolean).join('\n'), [], []),
  ];
}

// 労働安全衛生法の候補(F40b)。候補ごとに1行と、入れた条件・見ていないものの行。今の件数の行とは区分で分ける
export function safetyRows(r, answerRows = []) {
  const section = '安全の法令の候補';
  if (!r || !r.started) return [];
  return [
    ...(r.line ? [row(section, '下請けの場合', '', r.line.text, r.line.basis, [])] : []),
    ...r.candidates.map((c) => row(section, c.label + (c.work ? '(' + c.work + ')' : ''), BID_STATUS[c.status], [c.action, c.to ? '届出先: ' + c.to + '(' + c.daysBefore + '日前まで)' : null, ...(c.matched ?? []).map((m) => m.quote), c.caveat ? '原文の除外: ' + c.caveat : null, c.note, ...c.needs.map((n) => n.label + 'を入れると判断できます')].filter(Boolean).join('\n'), c.basis, [])),
    ...answerRows.map(([k, v]) => row(section, '入れた条件: ' + k, '', v, [], [])),
    row(section, '見ていないもの', '', r.notOnList, [], []),
  ];
}

// 台帳の点検(checkTaicho の返り値): 見出しの行 + 候補ごとに1行 + 判断できないことごとに1行(F05b)
export function checkRows(out, notice) {
  const item = (x) => [x.target, fieldLabel(x.field)].filter(Boolean).join(' — ');
  return [
    COLUMNS.slice(),
    ...(out.candidates ?? []).map((c) => row('台帳の点検', item(c), '候補', [c.message, ...(c.confirm ?? []).map((x) => '確かめること: ' + x)].join('\n'), c.basis ?? [], [])),
    ...(out.undecidable ?? []).map((u) => row('台帳の点検', item(u), '判断できない', u.message, u.basis ?? [], [])),
    ...(notice ? [row('注意', '注意', '', [notice, ...(out.notes ?? [])].join('\n'), [], [])] : []),
  ];
}

// 段取りの一覧(F06a)の行。段取りは「いつ・何を・誰に」が要なので、共通の列とは別の列にする(見出しの行 + 1行ずつ)
export const SCHEDULE_COLUMNS = ['段', 'いつ', '何を', '誰に', '状態', '根拠の箇所', '根拠の原文(抜き書き)', '取得日', '版', '注意', SCHEDULE_NOTE_LABEL];
// notes は画面の書き込み(F37e)。鍵 → 書いた文 の Map
// kind を渡すと、最後に工種と表の出典の行を足す(F44a。ほかの行は変えない)
// notice を渡したときだけ、そのあとに「注意」行を足す(F61a。checkRows と同じ分け方。渡さなければ出力は変わらない)
export function scheduleRows(rows = [], notes = new Map(), kind = null, notice) {
  const s = kind && kindSource(kind, 'schedule');
  const kindRow = kind ? [['工種', '', workKindLabel(kind), '', '', s?.title ?? '', '', s?.fetchedAt ?? '', s?.version ?? '', s ? kindNote(kind, 'schedule') : NOT_READ, '']] : [];
  return [SCHEDULE_COLUMNS.slice(), ...rows.map((r) => [
    SCHEDULE_PHASE[r.phase] ?? r.phase, r.when, r.what, r.to, SCHEDULE_STATUS[r.status] ?? r.status ?? '',
    r.basis.doc + ' ' + r.basis.section + (r.basis.sectionTitle ? ' ' + r.basis.sectionTitle : ''), r.basis.quote, r.basis.fetchedAt, r.basis.version || NO_VERSION,
    [r.note, ...(r.checks ?? [])].filter(Boolean).join('\n'), notes.get(scheduleNoteKey(r)) ?? '',
  ]), ...kindRow, ...(notice ? [['注意', '', '', '', '', '', '', '', '', notice, '']] : [])];
}

// 施工計画書の目次の点検(F07)の行。見出しの行 + 抜けの候補1件ごとに1行
export const PLAN_COLUMNS = ['項目', '状態', '説明', '根拠の箇所', 'ページ', '根拠の原文(抜き書き)', '取得日', '版'];
// kind を渡すと、最後に工種と表の出典の行を足す(F44a)。notice を渡したときだけ、そのあとに「注意」行を足す(F61a)
export function planRows(out = {}, kind = null, notice) {
  return [PLAN_COLUMNS.slice(), ...(out.candidates ?? []).map((c) => [
    c.item, '抜けの候補', c.message ?? '',
    c.basis.doc + ' ' + c.basis.section + (c.basis.sectionTitle ? ' ' + c.basis.sectionTitle : ''),
    c.basis.page ? 'PDF ' + c.basis.page + 'ページ' + (c.basis.printedPage ? '(紙面 ' + c.basis.printedPage + ')' : '') : '',
    c.basis.quote, c.basis.fetchedAt ?? '', c.basis.version || NO_VERSION,
  ]), ...(out.undecidable ?? []).map((u) => ['施工計画書の目次', '判断できない', u.message ?? '', '', '', '', '', '']),
  ...(kind ? [['工種', '', kindSourceText(kind, 'plan'), kindSource(kind, 'plan')?.title ?? '', '', '', kindSource(kind, 'plan')?.fetchedAt ?? '', kindSource(kind, 'plan')?.version ?? '']] : []),
  ...(notice ? [['注意', '', notice, '', '', '', '', '']] : [])];
}

// 1つの欄: カンマ・引用符・改行を含むときは引用符で囲み、中の引用符は2つにする
function cell(v) {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

// 行の配列 → CSV の文字列(先頭に BOM、行の区切りは CRLF。Excel で文字化けしないように)
export function toCsv(rows) {
  return '﻿' + rows.map((r) => r.map(cell).join(',') + '\r\n').join('');
}

// 台帳の記載事項の表(F16c)の行。「確認した」の有無を最初の列に出す(人が確かめた印で、合否ではない)
export const CHECKLIST_COLUMNS = ['確認した', '相手', '記載事項', '状態', '台帳の値(書いてあるまま)', '理由', '根拠の場所', '根拠の原文(抜き書き)', '取得日', '版'];
export function checklistRows(out = {}, checked = new Set(), notice) {
  return [
    CHECKLIST_COLUMNS.slice(),
    ...(out.rows ?? []).map((r) => [checked.has(r.id) ? '確認した' : '', r.entity, r.label, r.statusLabel, r.value ?? '', r.reason ?? '', r.basis?.where ?? '', r.basis?.quote ?? '', CHECKLIST_LAW.fetchedAt, sourceVersion(CHECKLIST_LAW)]),
    ['注意', '', '', '', '', [CHECKLIST_NOTICE, CHECKLIST_SCOPE, ...(out.notes ?? []), checklistReferenceText(), notice].filter(Boolean).join('\n'), '', '', '', ''],
  ];
}

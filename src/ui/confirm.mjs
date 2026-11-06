// 入力の確かめ(F43d): 結果の前に、入れた条件を全部の行で並べる。行ごとに値・出どころ(公告・見本・手入力)を出し、公告から推定した値には「推定」を付ける。
// DOM には触らない。行の枠と「変更」のボタンは shell.html に静的にあり、ここは行の中身の文を作る。
import { parseYen } from './form.mjs';
import { esc } from './view.mjs';
import { cutQuote } from '../brackets.mjs';
import { WORK_KINDS } from '../work-kinds.mjs';

const select = (key, label, options) => ({ key, label, kind: 'select', field: key, options });
const amount = (key, label) => ({ key, label, kind: 'amount', field: key });
export const CONFIRM_ROWS = [
  select('orderer', '発注者', { public: '公共', private: '民間' }),
  { key: 'role', label: '元請けか下請けか', kind: 'role' },
  select('work-type', '工事の種類', { 'kenchiku-ikkatsu': '建築一式工事', other: 'それ以外の工事' }),
  select('work-kind', '工種', Object.fromEntries(WORK_KINDS.map((k) => [k.id, k.label]))),
  amount('contract-amount', '請負代金の見込み'),
  amount('subcontract-total', '下請けの総額'),
  select('license', '元請けの許可の種類', { tokutei: '特定建設業', ippan: '一般建設業' }),
  select('engineer-qualification', '置ける技術者の資格', { kanri: '監理技術者', shunin: '主任技術者' }),
  { key: 'ict-measure', label: '発注者が台帳を閲覧できる措置', kind: 'check', field: 'ict-measure' },
  { key: 'participation-conditions', label: '公告の参加の条件', kind: 'text', field: 'participation-conditions' },
];

const ROLES = [['direct', '元請け'], ['direct-sub', '下請け'], ['direct-unknown', '分からない']];
const UNKNOWN = '分からない';
const UNSET = 'まだ選んでいません(未回答)';
const on = (v) => v === true;

// 行の答え。raw は出どころの突き合わせに使う(読み込んだときと同じ値なら、その出どころのまま)
function answer(row, values) {
  if (row.kind === 'role') {
    const hit = ROLES.find(([id]) => on(values[id]));
    return hit ? { text: hit[1], raw: hit[0], state: hit[0] === 'direct-unknown' ? 'unknown' : 'set' } : { text: UNSET, raw: '', state: 'unset' };
  }
  if (row.kind === 'check') return on(values[row.field]) ? { text: '講じる', raw: true, state: 'set' } : { text: '講じない(印なし)', raw: false, state: 'set' };
  if (row.kind === 'text') {
    const raw = String(values[row.field] ?? '').trim();
    return { text: raw || '入れていません(任意)', raw, state: 'set' };
  }
  if (row.kind === 'amount') {
    if (on(values[row.field + '-unknown'])) return { text: UNKNOWN, raw: 'unknown', state: 'unknown' };
    const raw = String(values[row.field] ?? '');
    const { value, error } = parseYen(raw);
    if (error) return { text: raw, raw, state: 'bad' };
    if (value === null) return { text: 'まだ入れていません(未回答)', raw: '', state: 'unset' };
    return { text: value.toLocaleString('ja-JP') + '円(税込み)', raw: value, state: 'set' };
  }
  const raw = String(values[row.field] ?? '');
  if (raw === 'unknown') return { text: UNKNOWN, raw, state: 'unknown' };
  return Object.hasOwn(row.options, raw) ? { text: row.options[raw], raw, state: 'set' } : { text: UNSET, raw: '', state: 'unset' };
}

// 読み込んだ値の出どころを覚える形。fields を渡すと、その欄の行だけ
export function markSources(values, kind, quotes = {}, fields = null) {
  const out = {};
  for (const row of CONFIRM_ROWS) {
    if (fields && !fields.includes(row.field)) continue;
    out[row.key] = { kind, raw: answer(row, values).raw, quote: quotes[row.field] ?? '' };
  }
  return out;
}

// 画面の1行の中身。読み込んだあとに値を変えた行は手入力になる
export function confirmRows(values = {}, sources = {}) {
  return CONFIRM_ROWS.map((row) => {
    const a = answer(row, values);
    const s = sources[row.key];
    const kept = s && s.raw === a.raw ? s : null;
    const empty = a.state === 'unset' || (row.kind === 'text' && !a.raw && !kept);
    const source = empty ? '未入力' : kept ? kept.kind : '手入力';
    return { key: row.key, label: row.label, field: row.field ?? null, text: a.text, state: a.state, source, quote: kept?.quote ?? '', estimated: source === '公告' };
  });
}

const QUOTE_MAX = 80;
const SOURCE_TEXT = { 未入力: '入れていません', 手入力: '手入力', 見本: '見本(架空の工事)' };
const AMOUNT_NOTE = '予定価格は上限の見込みで、請負代金そのものではありません。';
export function renderConfirmRow(r) {
  const quote = cutQuote(r.quote, QUOTE_MAX);
  const source = r.source === '公告' ? '公告' + (quote ? '「' + quote + '」' : '') : SOURCE_TEXT[r.source];
  const value = r.state === 'bad' ? '<span class="errors">読めない値: ' + esc(r.text) + '。「変更」で直してください</span>' : esc(r.text);
  const estimated = r.estimated
    ? '<small class="confirm-est"><span class="badge badge-needs_check"><span class="mark" aria-hidden="true">!</span> 推定</span> 公告から推定した値です。確認が要ります。原文で確かめてください。' + (r.key === 'contract-amount' ? AMOUNT_NOTE : '') + '</small>'
    : '';
  return '<strong>' + value + '</strong><small>出どころ: ' + esc(source) + '</small>' + estimated;
}

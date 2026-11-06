// 入力の質問への答えの状態と、結果の項目の見せ方(F14f)。DOM には触らない。
// 質問の答えは3つに分ける: 答えた(answered)/「分からない」を選んだ(unknown)/まだ答えていない(unanswered)。
// 判定(bidCheck・judgeTaicho)には、「分からない」も未回答も同じ null を渡す(推測で埋めない)。
// 画面では、決められなかった項目(needs_check)のうち、未回答の質問を使うものを「未回答」、それ以外を「確認が要る」と出す。
import { readDirect, parseYen } from './form.mjs';

// ※必須の質問(画面の欄の id と名前)。「台帳を発注者が閲覧できる措置」は ※任意 の印の欄なので、ここには入れない
export const QUESTIONS = [
  { id: 'orderer', name: '発注者' },
  { id: 'direct', name: '元請けか下請けか' },
  { id: 'work-type', name: '工事の種類' },
  { id: 'contract-amount', name: '請負代金の見込み' },
  { id: 'subcontract-total', name: '下請けの総額' },
  { id: 'license', name: '元請けの許可の種類' },
  { id: 'engineer-qualification', name: '置ける技術者の資格' },
];
export const UNKNOWN = 'unknown'; // 選ぶ欄の「分からない」の値
const AMOUNT_IDS = ['contract-amount', 'subcontract-total'];
const flag = (v) => v === true || v === 'true' || v === 'on';
// 金額の欄の「分からない」の印の欄の id
export const unknownId = (id) => id + '-unknown';

export function answerState(values = {}, id) {
  if (id === 'direct') {
    if (flag(values['direct-unknown'])) return 'unknown';
    return readDirect(values) === null ? 'unanswered' : 'answered';
  }
  if (AMOUNT_IDS.includes(id)) {
    if (flag(values[unknownId(id)])) return 'unknown';
    const r = parseYen(values[id]);
    return r.value === null ? 'unanswered' : 'answered'; // 読めない値は入力の誤りとして別に出す
  }
  const v = String(values[id] ?? '');
  if (v === UNKNOWN) return 'unknown';
  return v === '' ? 'unanswered' : 'answered';
}

export function answerStates(values = {}) {
  return Object.fromEntries(QUESTIONS.map((q) => [q.id, answerState(values, q.id)]));
}
export const unansweredQuestions = (values = {}) => QUESTIONS.filter((q) => answerState(values, q.id) === 'unanswered');
export const unknownQuestions = (values = {}) => QUESTIONS.filter((q) => answerState(values, q.id) === 'unknown');

// 結果の項目ごとに、判定に使う質問(src/bid-check.mjs・src/taicho.mjs が読む入力)
export const ITEM_DEPS = {
  'tokutei-license': ['direct', 'subcontract-total', 'work-type'],
  engineer: ['direct', 'subcontract-total', 'work-type'],
  taicho: ['orderer', 'direct', 'subcontract-total', 'work-type', 'license'],
  'taicho-copy': ['orderer', 'direct', 'subcontract-total', 'work-type', 'license'],
  taikeizu: ['orderer', 'direct', 'subcontract-total', 'work-type', 'license'],
  dedicated: ['orderer', 'contract-amount', 'work-type'],
};

// 画面に出す状態: required / not_required / needs_check / unanswered。
// 決められた項目(要る・要らない)は答えの状態にかかわらずそのまま。決められなかった項目は、使う質問に未回答があれば「未回答」
export function displayStatus(item, values = {}) {
  if (item.status !== 'needs_check') return item.status;
  const deps = ITEM_DEPS[item.key] ?? [];
  return deps.some((id) => answerState(values, id) === 'unanswered') ? 'unanswered' : 'needs_check';
}

// 「要る」と決まった項目の数。カードと知らせの行で同じ数を出す(displayStatus は決まった項目を変えない)
export const requiredCount = (bid) => (bid?.items ?? []).filter((it) => it.status === 'required').length;

// 理由の「入れた条件」: 項目が使う質問と、その答え
const VALUE_WORDS = {
  orderer: { public: '公共', private: '民間' },
  'work-type': { 'kenchiku-ikkatsu': '建築一式工事', other: 'それ以外の工事' },
  license: { tokutei: '特定建設業', ippan: '一般建設業' },
  'engineer-qualification': { kanri: '監理技術者', shunin: '主任技術者' },
};
export function answerText(values = {}, id) {
  const st = answerState(values, id);
  if (st === 'unknown') return '分からない';
  if (st === 'unanswered') return '未回答';
  if (id === 'direct') return readDirect(values) ? '元請け' : '下請け';
  if (AMOUNT_IDS.includes(id)) return parseYen(values[id]).value.toLocaleString('ja-JP') + '円(税込み)';
  return VALUE_WORDS[id]?.[values[id]] ?? String(values[id]);
}
export function itemConditions(item, values = {}) {
  const name = (id) => QUESTIONS.find((q) => q.id === id)?.name ?? id;
  return (ITEM_DEPS[item.key] ?? []).map((id) => ({ id, name: name(id), text: answerText(values, id), state: answerState(values, id) }));
}

// 確かめ先: 根拠の原文に、相手(届け出る・見せる・許可をする者)が書かれているものだけを出す。原文に無い相手は出さない
//   quoteId は data/quotes.json の抜き書き。その原文の言葉を to に使う
export const CONTACTS = {
  'tokutei-license': () => [{ to: '許可をした行政庁(営業所が二以上の都道府県にあれば国土交通大臣、一の都道府県だけなら営業所の所在地の都道府県知事)', what: 'この業種の許可が特定建設業か一般建設業か', quoteId: 'q-kensetsu-3-1', law: '建設業法 第3条第1項' }],
  taicho: (orderer) => (orderer === 'public'
    ? [{ to: '発注者', what: '台帳の写しを出すか、発注者が情報通信技術で施工体制を確認できる措置(国土交通省令で定めるもの)にするか', quoteId: 'q-nyukei-15-2', law: '入契法 第15条第2項' }]
    : orderer === 'private'
      ? [{ to: '発注者', what: '発注者から請求があったときに台帳を見せる(閲覧に供する)', quoteId: 'q-kensetsu-24_8-3', law: '建設業法 第24条の8第3項' }]
      : []),
  'taicho-copy': (orderer) => (orderer === 'public'
    ? [{ to: '発注者', what: '台帳の写しを出すか、発注者が情報通信技術で施工体制を確認できる措置(国土交通省令で定めるもの)にするか', quoteId: 'q-nyukei-15-2', law: '入契法 第15条第2項' }]
    : []),
};
export function contactsFor(item, values = {}) {
  const f = CONTACTS[item.key];
  if (!f) return [];
  const orderer = answerState(values, 'orderer') === 'answered' ? values.orderer : null;
  return f(orderer);
}

// 「確認が要る点」の数え方を1つにする(F37g)。まとめ・入札前の確認・最後の一覧は、どれもこの関数の結果を使う。
//   bidCheck の checks のうち、画面の状態が「未回答」の項目は未回答の一覧へ回すので除く。
//   status はその項目の画面の状態。結論の出た項目(要る など)についての確認も入る。values が無いときは判定の状態を使う
export function needsCheckPoints(bid, values) {
  const items = bid?.items ?? [];
  const points = [];
  for (const c of bid?.checks ?? []) {
    const it = items.find((x) => x.key === c.key);
    const status = !it ? 'needs_check' : values ? displayStatus(it, values) : it.status;
    if (status !== 'unanswered') points.push({ label: c.label, message: c.message, status, ...(c.basis ? { basis: c.basis } : {}) });
  }
  return points;
}

// 結果の最後の一覧: 「確認が要る点」と「未回答」
//   needsCheck: needsCheckPoints の結果
//   unanswered: [{ id, name, items: [項目名] }](未回答の質問と、それを使う項目のうち決められなかったもの)
//   unknown: [{ id, name, items }](「分からない」を選んだ質問)
export function openItems(bid, values = {}) {
  const items = bid?.items ?? [];
  const affected = (id) => items.filter((it) => it.status === 'needs_check' && (ITEM_DEPS[it.key] ?? []).includes(id)).map((it) => it.label);
  return {
    needsCheck: needsCheckPoints(bid, values),
    unanswered: unansweredQuestions(values).map((q) => ({ ...q, items: affected(q.id) })),
    unknown: unknownQuestions(values).map((q) => ({ ...q, items: affected(q.id) })),
  };
}

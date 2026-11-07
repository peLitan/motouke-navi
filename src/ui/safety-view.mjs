// 労働安全衛生法の候補の画面(F40b)。問いは build の時に静的な HTML にし、候補は欄を変えるたびに描き直す。DOM には触らない。
import { esc, statusBadge, basisList, seeAbove, BID_STATUS } from './view.mjs';
import { safetyQuestions } from '../safety.mjs';

const q = safetyQuestions();
const radio = (name, id, value, label) => '<div><input type="radio" id="' + id + '" name="' + name + '" value="' + esc(value) + '" autocomplete="off"><label for="' + id + '">' + esc(label) + '</label></div>';
const check = (id, label) => '<div class="check-row"><input type="checkbox" id="' + id + '" autocomplete="off"><label for="' + id + '">' + esc(label) + '</label></div>';
const group = (id, legend, body, hidden = false) => '<fieldset class="row radio-group" id="' + id + '"' + (hidden ? ' hidden' : '') + '><legend>' + esc(legend) + '</legend>' + body + '</fieldset>';

export const SUBCONTRACT_CHOICES = [['yes', 'はい'], ['no', 'いいえ'], ['unknown', 'まだ分からない']];
export const PLACE_CHOICES = [['yes', '当たる'], ['no', '当たらない'], ['unknown', '分からない']];
const planIds = [...q.plan, ...q.planMore].map((x) => x.id);
const workIds = q.works.map((x) => x.id);
// 画面の欄の id(入れた内容はどこにも保存しない)
export const SAFETY_IDS = {
  subcontract: SUBCONTRACT_CHOICES.map(([v]) => 'safety-sub-' + v),
  workers: q.workers.map((x) => 'safety-workers-' + x.value),
  bridge: q.bridge.map((x) => 'safety-bridge-' + x.value),
  place: PLACE_CHOICES.map(([v]) => 'safety-place-' + v),
  plan: [...planIds, 'none', 'unknown'].map((v) => 'safety-plan-' + v),
  works: [...workIds, 'none', 'unknown'].map((v) => 'safety-work-' + v),
};

export function renderSafetyQuestions() {
  const planRows = (list) => list.map((x) => check('safety-plan-' + x.id, x.label)).join('');
  return group('safety-q-subcontract', '1. ' + q.fields.subcontract, '<p id="safety-stage1" class="hint"></p>' + SUBCONTRACT_CHOICES.map(([v, t]) => radio('safety-sub', 'safety-sub-' + v, v, t)).join(''))
    + group('safety-q-workers', '2. ' + q.fields.workers + '(自社・下請け・一人親方などを含む)', '<p class="hint">条文の言葉は「常時」と「作業従事者」です。「常時」の意味は条文に書いてありません。迷うときは「分からない」を選び、労働基準監督署に確かめてください。</p>'
      + q.workers.map((x) => radio('safety-workers', 'safety-workers-' + x.value, x.value, x.label)).join(''))
    + group('safety-q-plan', '3. ' + q.fields.plan, '<p class="hint">届出の項目と、統括安全衛生責任者の人数の境目を変える項目です。当たるものをすべて選びます。</p>'
      + planRows(q.plan)
      + '<details class="fold" id="safety-plan-more"><summary>大規模な工事・石綿・焼却炉・土石の採取</summary>' + planRows(q.planMore) + '</details>'
      + check('safety-plan-none', 'どれにも当たらない') + check('safety-plan-unknown', '分からない'))
    + group('safety-q-bridge', '3 の続き. 橋梁の工事', q.bridge.map((x) => radio('safety-bridge', 'safety-bridge-' + x.value, x.value, x.label)).join(''))
    + group('safety-q-place', '3 の続き. 橋梁の場所は、次に当たるか', '<p class="hint">' + esc(q.place) + '</p>' + PLACE_CHOICES.map(([v, t]) => radio('safety-place', 'safety-place-' + v, v, t)).join(''), true)
    + group('safety-q-works', '4. ' + q.fields.works + '(作業主任者)', q.works.map((x) => check('safety-work-' + x.id, x.label + ': ' + x.text)).join('')
      + check('safety-work-none', 'どれも行わない') + check('safety-work-unknown', 'まだ分からない'));
}

// 欄の値(id → true/false)から問いの答えの形にする
export function readSafetyAnswers(checked = {}) {
  const pick = (ids, prefix) => ids.filter((id) => checked[id] === true).map((id) => id.slice(prefix.length));
  return {
    subcontract: pick(SAFETY_IDS.subcontract, 'safety-sub-')[0],
    workers: pick(SAFETY_IDS.workers, 'safety-workers-')[0],
    bridge: pick(SAFETY_IDS.bridge, 'safety-bridge-')[0],
    bridgePlace: pick(SAFETY_IDS.place, 'safety-place-')[0],
    plan: pick(SAFETY_IDS.plan, 'safety-plan-'),
    works: pick(SAFETY_IDS.works, 'safety-work-'),
  };
}

// 段1 の答えの1行。金額の欄の値をそのまま見せ、問い1 の当て方を添える
export function stage1Line(values = {}, stage1 = {}) {
  const raw = String(values['subcontract-total'] ?? '').trim();
  const amount = values['subcontract-total-unknown'] === true ? '分からない' : raw ? raw + ' 円' : '入れていません';
  const t = stage1.subcontractTotal;
  const to = typeof t === 'number' ? (t > 0 ? '使う' : '使わない') : 'まだ分からない';
  return '「条件を入れる」の答え: 下請けの総額 ' + amount + ' → ' + to + '。';
}

const FIELD_ANCHOR = { subcontract: 'safety-q-subcontract', workers: 'safety-q-workers', plan: 'safety-q-plan', works: 'safety-q-works' };
const needsText = (n) => '＊「' + n.label + '」' + (n.state === 'unknown' ? 'が分かると' : 'を入れると') + '判断できます';
const needsLink = (n) => '<a href="#' + FIELD_ANCHOR[n.field] + '">' + esc(needsText(n)) + '</a>';
// 同じ文の2回目(F83a12)。seen は 文 → 最初に出した候補。画面は参照の1行、紙は文のまま
const firstSeen = (seen, text, c) => { const first = seen.get(text); if (!first) seen.set(text, c); return first ?? null; };
const titleOf = (c) => c.label + (c.work ? '(' + c.work + ')' : '');

function candidateBlock(c, seen = new Map()) {
  const title = titleOf(c);
  const route = c.status === 'required' && c.to ? '<p>届出先: ' + esc(c.to) + '(仕事の開始の日の ' + c.daysBefore + '日前まで)</p>'
    : c.routes ? '<p>当たるときの届出先: ' + c.routes.map((r) => esc(r.to) + '(' + r.daysBefore + '日前まで)').join('、または ') + '</p>' : '';
  const matched = (c.matched ?? []).length ? '<ul>' + c.matched.map((m) => '<li>' + esc(m.quote) + '</li>').join('') + '</ul>' : '';
  const actionFirst = c.action ? firstSeen(seen, c.action, c) : null;
  const noteFirst = c.note ? firstSeen(seen, c.note, c) : null;
  const first = actionFirst ?? noteFirst;
  const needsLine = (n) => { const f = firstSeen(seen, needsText(n), c); return '<li>' + (f ? '<span class="no-print">' + seeAbove(titleOf(f), f.id) + '</span><span class="print-inline">' + esc(needsText(n)) + '</span>' : needsLink(n)) + '</li>'; };
  return '<div class="item safety-item" id="' + esc(c.id) + '"><p>' + statusBadge(c.status) + ' <strong>' + esc(title) + '</strong></p>'
    + (c.action ? '<p' + (actionFirst ? ' class="print-only"' : '') + '>' + esc(c.action) + '</p>' : '') + (first ? '<p class="no-print">' + seeAbove(titleOf(first), first.id) + '</p>' : '') + route + matched
    + (c.caveat ? '<p class="note">原文の除外: ' + esc(c.caveat) + '</p>' : '')
    + (c.note ? '<p class="note' + (noteFirst ? ' print-only' : '') + '">' + esc(c.note) + '</p>' : '')
    + (c.needs.length ? '<ul class="safety-needs">' + c.needs.map(needsLine).join('') + '</ul>' : '')
    + basisList(c.basis) + '</div>';
}

export const safetyCountText = (r) => r.counts.total + '件';
const ORDER = ['required', 'needs_check', 'unanswered'];
export const safetyBreakdown = (r) => ORDER.filter((s) => r.counts[s] > 0).map((s) => BID_STATUS[s] + ' ' + r.counts[s]).join('・');
export const safetyTitle = (r) => '労働安全衛生法で、' + (r.mode === 'sub' ? '下請けにも' : '元請けに') + '掛かりそうなもの(' + (r.started ? safetyCountText(r) : '条件を入れると出ます') + ')';

// まとめ・印刷・CSV の「入れた条件」の行
export function safetyAnswerRows(answers = {}, values = {}, stage1 = {}) {
  const pick = (list, v, key = 'value') => list.find((x) => x[key] === v)?.label;
  const listText = (ids, all, extra) => ids.map((id) => pick(all, id, 'id') ?? extra[id]).filter(Boolean).join('、') || '選んでいません';
  const rows = [];
  if (stage1.direct !== false) rows.push([q.fields.subcontract, answers.subcontract ? Object.fromEntries(SUBCONTRACT_CHOICES)[answers.subcontract] : stage1Line(values, stage1)]);
  rows.push([q.fields.workers, pick(q.workers, answers.workers) ?? '選んでいません']);
  rows.push([q.fields.plan, listText(answers.plan ?? [], [...q.plan, ...q.planMore], { none: 'どれにも当たらない', unknown: '分からない' })]);
  rows.push(['橋梁の工事', pick(q.bridge, answers.bridge) ?? '選んでいません']);
  if (answers.bridge && answers.bridge !== 'none') rows.push(['橋梁の場所', Object.fromEntries(PLACE_CHOICES)[answers.bridgePlace] ?? '選んでいません']);
  rows.push([q.fields.works, listText(answers.works ?? [], q.works, { none: 'どれも行わない', unknown: 'まだ分からない' })]);
  return rows;
}

// 候補の欄。「要らない」の札は使わない。当てはまらないものは出さない
export function renderSafetyResult(r, answerRows = []) {
  if (!r.started) return '<p>条件を入れると、ここに候補を出します。</p>';
  const parts = [];
  if (r.line) parts.push('<p class="note">' + esc(r.line.text) + '</p>' + basisList(r.line.basis));
  const seen = new Map();
  if (r.candidates.length) parts.push('<p><strong>候補は ' + r.counts.total + '件です</strong>(' + esc(safetyBreakdown(r)) + ')</p>' + r.candidates.map((c) => candidateBlock(c, seen)).join(''));
  else parts.push('<p>選んだ作業では、この一覧の条件には当たりませんでした。</p>');
  parts.push('<p class="note">' + esc(r.notOnList) + '</p>');
  parts.push('<div class="print-only"><h4>安全の法令の候補の入れた条件</h4><dl class="summary-list">' + answerRows.map(([k, v]) => '<div class="summary-row"><dt>' + esc(k) + '</dt><dd>' + esc(v) + '</dd></div>').join('') + '</dl></div>');
  return parts.join('');
}

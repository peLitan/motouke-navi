// 労働安全衛生法で元請けに掛かりそうなものの候補(F40a)。
// 規則表 data/safety.json の行を入力に当てはめ、原文の抜き書きつきの候補を返す。条件の数(人数・高さ・支間・日数)は抜き書きから読み、コードに書かない。
// 結論は required(要る)・unanswered(未回答)・needs_check(確認が要る)だけで、「要らない」は返さない。当てはまらないものは候補に出さない。
// 入力(どれも省いてよい。省いた問いは未回答):
//   direct: false は下請けとして入る。true・null・省略は元請けの一覧を返す(null と省略は assumedPrime: true)
//   subcontract: 'yes'|'no'|'unknown'。省くと段1 の subcontractTotal(0 は no、正の数は yes、null は unknown)から読む
//   workers: 同じ場所で働く人の数(数)か 'unknown'
//   plan: planItems の id の並びか 'none'(どれにも当たらない)か 'unknown'。measure のある項目は、数の欄(bridgeSpanM など)があれば数で決める
//   bridgeSpanM: 橋の最大支間(数か 'unknown')。bridgePlace: 則 第18条の2の2 の場所か(true|false|'unknown')。令7条と則90条で橋の条件が違うので、この2つから別々に決める
//   excavationFaceM・scaffoldHeightM・steelFrameHeightM・woodEaveHeightM・concreteDemolitionHeightM: 作業の高さ。あれば chief.works の境目(抜き書きから読む)で決める
//   tunnelNoEntry・excavationNoEntry・excavationRock: true なら原文の除外に当たるものとして、その項目を外す
//   works: 作業の id の並びか 'none' か 'unknown'
import safetyData from '../data/safety.json' with { type: 'json' };
import quotesData from '../data/quotes.json' with { type: 'json' };
import sourcesData from '../data/sources/index.json' with { type: 'json' };
import { kanjiUnder10000 } from './bid-check.mjs';
import { resolveQuoteIds } from './taicho.mjs';

const quoteOf = (id) => {
  const q = quotesData.quotes.find((x) => x.id === id);
  if (!q) throw new Error('安全の規則表: 抜き書きが無い: ' + id);
  return q;
};
const basisOf = (list) => resolveQuoteIds(list, quotesData.quotes, sourcesData.sources, '安全の規則表');
const isNumber = (x) => typeof x === 'number' && Number.isFinite(x) && x >= 0;
const isList = (x) => Array.isArray(x) && x.length > 0;
const planItem = (id) => safetyData.planItems.find((p) => p.id === id);

// 抜き書きの数(「三十一」「千」「〇・三」)を数にする
export function kanjiNumber(s) {
  const [whole, frac] = String(s).split('・');
  const n = kanjiUnder10000(whole === '〇' ? '' : whole);
  return frac === undefined ? n : Number(n + '.' + kanjiUnder10000(frac));
}
function readNumber(quoteId, pattern) {
  const m = quoteOf(quoteId).text.match(new RegExp(pattern));
  if (!m) throw new Error('安全の規則表: 抜き書きから数を読めない: ' + quoteId + ' ' + pattern);
  return kanjiNumber(m[1]);
}

// 人数の境目(安衛令 第7条第2項)。low は第1号の仕事、high はそれ以外
export function workerThresholds() {
  const s = safetyData.supervisor;
  return { low: readNumber(s.lowQuoteId, s.workersPattern), high: readNumber(s.highQuoteId, s.workersPattern) };
}

// 数の欄が境目に当たるか。数が無ければ null(問いの答えで決める)
function byMeasure(measure, quoteId, input) {
  if (!measure) return null;
  if (measure.excludedBy && input[measure.excludedBy] === true) return false;
  if (!measure.field) return null;
  if (measure.unlessField && input[measure.unlessField] === true) return true;
  if (!isNumber(input[measure.field])) return null;
  const pattern = measure.whenField && input[measure.whenField] === true ? measure.whenPattern : measure.pattern;
  const t = readNumber(quoteId, pattern);
  return measure.op === 'gt' ? input[measure.field] > t : input[measure.field] >= t;
}

// 橋の3つの項目(則90条 二号・二号の二、令7条2項1号)と大臣の項目を、支間と場所から別々に決める。橋の答えが無ければ null
function bridgeState(item, input) {
  const span = input.bridgeSpanM;
  const place = input.bridgePlace;
  if (span === undefined && place === undefined) return null;
  const spanUnknown = span === 'unknown';
  if (item.id === 'plan-bridge-large' || item.id === 'plan-bridge') return spanUnknown ? 'unknown' : null;
  if (item.id === 'plan-bridge-narrow') return place ?? (span === undefined ? null : undefined);
  if (item.id !== 'plan-bridge-place') return null;
  if (place === false) return false;
  if (spanUnknown) return 'unknown';
  if (!isNumber(span)) return null;
  const upper = readNumber(planItem('plan-bridge').quoteId, planItem('plan-bridge').measure.pattern);
  if (span >= upper || !byMeasure(item.measure, item.quoteId, input)) return false;
  return place ?? undefined;
}

// 問いの項目を true(当たる)・false(当たらない)・'unknown'・undefined(未回答)に分ける
function itemState(item, answer, input) {
  const b = bridgeState(item, input);
  if (b !== null) return b;
  const m = byMeasure(item.measure, item.quoteId, input);
  if (m !== null) return m;
  if (isList(answer)) return answer.includes(item.id);
  if (answer === 'none') return false;
  return answer === 'unknown' ? 'unknown' : undefined;
}

// 何を入れれば決まるかを、欄の名前で返す
const need = (field, state) => ({ field, label: safetyData.fields[field], state });
// 決まっていない項目がある問いを、足りないものにする
function undecided(states, field) {
  const open = states.filter((s) => typeof s.state !== 'boolean');
  if (!open.length) return [];
  return [need(field, open.some((s) => s.state === undefined) ? 'unanswered' : 'unknown')];
}
// 答えていない問いが残れば未回答(答えれば先へ進める)、「分からない」だけなら確認が要る
function statusOf(needs) {
  if (needs.some((n) => n.state === 'unanswered')) return 'unanswered';
  return needs.length ? 'needs_check' : 'required';
}

export function subcontractAnswer(input) {
  if (['yes', 'no', 'unknown'].includes(input.subcontract)) return input.subcontract;
  const t = input.subcontractTotal;
  if (t === null) return 'unknown';
  if (!isNumber(t)) return undefined;
  return t > 0 ? 'yes' : 'no';
}
function subcontractNeeds(answer) {
  if (answer === 'unknown') return [need('subcontract', 'unknown')];
  return answer === undefined ? [need('subcontract', 'unanswered')] : [];
}

function supervisorCandidate(input, sub, states) {
  if (sub === 'no') return null;
  const s = safetyData.supervisor;
  const needs = subcontractNeeds(sub);
  const { low, high } = workerThresholds();
  const w = input.workers;
  if (!isNumber(w)) needs.push(need('workers', w === 'unknown' ? 'unknown' : 'unanswered'));
  else if (w < low) return null;
  else if (w < high) {
    const lower = states.filter((x) => x.item.lowerWorkers);
    if (!lower.some((x) => x.state === true)) {
      const planNeeds = undecided(lower, 'plan');
      if (!planNeeds.length) return null;
      needs.push(...planNeeds);
    }
  }
  return { id: s.id, label: s.label, action: s.action, note: s.note, status: statusOf(needs), needs, basis: basisOf(s.basis) };
}
// 統括安全衛生責任者の候補と同じ状態で出す行(元方安全衛生管理者・下請けの安全衛生責任者)
const pairedWith = (row, sup) => ({ id: row.id, label: row.label, action: row.action, note: row.note, status: sup.status, needs: sup.needs, basis: basisOf(row.basis) });

function noticeCandidate(allStates) {
  const n = safetyData.notice;
  const states = allStates.filter((x) => x.item.route);
  const route = (name) => ({ to: n[name].to, daysBefore: readNumber(n[name].quoteId, n.daysPattern) });
  const scope = { quoteId: n.scopeQuoteId };
  const hit = states.filter((x) => x.state === true);
  if (hit.length) {
    // 法 第88条第3項は第2項の仕事を除くので、大臣の項目に当たれば労働基準監督署長の項目は出さない
    const name = hit.some((x) => x.item.route === 'minister') ? 'minister' : 'office';
    const items = hit.filter((x) => x.item.route === name).map((x) => x.item);
    const matched = items.map((item) => ({ id: item.id, branch: quoteOf(item.quoteId).branch ?? null, caveat: item.caveat ?? null, ...basisOf([{ quoteId: item.quoteId }])[0] }));
    const also = items.filter((item) => item.alsoQuoteId).map((item) => ({ quoteId: item.alsoQuoteId }));
    return { id: n.id, label: n.label, note: n.note, status: 'required', needs: [], ...route(name), matched, basis: basisOf([{ quoteId: n[name].quoteId }, scope, ...also]) };
  }
  const needs = undecided(states, 'plan');
  if (!needs.length) return null;
  return { id: n.id, label: n.label, note: n.note, status: statusOf(needs), needs, routes: [route('minister'), route('office')], matched: [], basis: basisOf([{ quoteId: n.minister.quoteId }, { quoteId: n.office.quoteId }, scope]) };
}

function chiefCandidates(input) {
  const c = safetyData.chief;
  const common = { label: c.label, action: c.action, note: c.note };
  const states = c.works.map((item) => ({ item, state: itemState(item, input.works, input) }));
  const hits = states.filter((x) => x.state === true).map((x) => ({
    id: 'safety-chief-' + x.item.id, ...common, note: [c.note, x.item.note].filter(Boolean).join('。'), work: x.item.label, caveat: [x.item.caveat, x.item.caveat2].filter(Boolean).join('、') || null, status: 'required', needs: [],
    basis: basisOf([...c.basis, { quoteId: x.item.quoteId }, ...(x.item.alsoQuoteId ? [{ quoteId: x.item.alsoQuoteId }] : [])]),
  }));
  if (hits.length) return hits;
  const needs = undecided(states, 'works');
  return needs.length ? [{ id: 'safety-chief', ...common, status: statusOf(needs), needs, basis: basisOf(c.basis) }] : [];
}

function countOf(list) {
  const n = (s) => list.filter((c) => c.status === s).length;
  return { required: n('required'), unanswered: n('unanswered'), needs_check: n('needs_check'), total: list.length };
}
const started = (input) => Object.entries(input).some(([k, v]) => k !== 'plan' && v !== undefined && v !== null && !(Array.isArray(v) && v.length === 0)) || Boolean(input.plan && input.plan.length);

// 返り値: { mode: 'prime'|'sub', assumedPrime, started, subcontract, candidates, counts, line?, notOnList }。
// mode 'sub' は元請けだけに掛かるものを出さず、下請けにも掛かるもの(安全衛生責任者・作業主任者)と1行の説明を返す
export function safetyCandidates(input = {}) {
  const planAnswer = Array.isArray(input.plan) && !input.plan.length && input.bridgeSpanM !== undefined ? 'none' : input.plan;
  const states = safetyData.planItems.map((item) => ({ item, state: itemState(item, planAnswer, input) }));
  const notOnList = safetyData.notOnList;
  if (input.direct === false) {
    const { text, basis } = safetyData.subLine;
    const sup = supervisorCandidate(input, 'yes', states);
    const candidates = [sup && pairedWith(safetyData.responsible, sup), ...chiefCandidates(input)].filter(Boolean);
    return { mode: 'sub', assumedPrime: false, started: true, candidates, counts: countOf(candidates), line: { text, basis: basisOf(basis) }, notOnList };
  }
  const sub = subcontractAnswer(input);
  const needs = subcontractNeeds(sub);
  const motokata = sub === 'no' ? [] : safetyData.candidates.map((r) => ({ id: r.id, label: r.label, action: r.action, note: r.note, status: statusOf(needs), needs, basis: basisOf(r.basis) }));
  const sup = supervisorCandidate(input, sub, states);
  const candidates = [...motokata, sup, sup && pairedWith(safetyData.manager, sup), noticeCandidate(states), ...chiefCandidates(input)].filter(Boolean);
  return { mode: 'prime', assumedPrime: input.direct !== true, started: started(input), subcontract: sub, candidates, counts: countOf(candidates), notOnList };
}

// ---- 画面の問い(F40b)。選ぶ範囲は原文の境目から作り、問いの言葉は原文の抜き書きをそのまま使う ----
const num = (n) => n.toLocaleString('en-US');
export function safetyQuestions() {
  const { low, high } = workerThresholds();
  const bridge = planItem('plan-bridge');
  const place = planItem('plan-bridge-place');
  const large = planItem('plan-bridge-large');
  const ge = readNumber(bridge.quoteId, bridge.measure.pattern);
  const lo = readNumber(place.quoteId, place.measure.pattern);
  const big = readNumber(large.quoteId, large.measure.pattern);
  const bigSusp = readNumber(large.quoteId, large.measure.whenPattern);
  const planLabel = (id) => planItem(id).label ?? quoteOf(planItem(id).quoteId).text;
  const planRow = (id) => ({ id, label: planLabel(id) });
  return {
    workers: [
      { value: 'under', label: low + '人未満', workers: low - 1 },
      { value: 'mid', label: low + '人以上' + high + '人未満', workers: low },
      { value: 'high', label: high + '人以上', workers: high },
      { value: 'unknown', label: '分からない', workers: 'unknown' },
    ],
    bridge: [
      { value: 'none', label: '橋梁の工事は無い' },
      { value: 'large', label: '最大支間 ' + num(big) + 'm 以上(つり橋のときは ' + num(bigSusp) + 'm 以上)', span: Number.MAX_SAFE_INTEGER },
      { value: 'ge', label: '最大支間 ' + ge + 'm 以上で、上に当たらないもの(つり橋の ' + num(big) + 'm 以上 ' + num(bigSusp) + 'm 未満を含む)', span: ge },
      { value: 'mid', label: '最大支間 ' + lo + 'm 以上 ' + ge + 'm 未満', span: lo },
      { value: 'lt', label: '最大支間 ' + lo + 'm 未満', span: 0 },
      { value: 'unknown', label: '分からない', span: 'unknown' },
    ],
    place: quoteOf('q-ansoku-18_2_2-1').text,
    plan: safetyData.question.main.map(planRow),
    planMore: safetyData.question.more.map(planRow),
    works: safetyData.chief.works.map((w) => ({ id: w.id, label: w.label, text: quoteOf(w.quoteId).text })),
    fields: safetyData.fields,
  };
}

// 問いの答え(安全の欄の値)と段1 の入力から、safetyCandidates の入力を作る。段1 の下請けの総額は、問い1 に答えていないときだけ使う
export function safetyInput(answers = {}, stage1 = {}) {
  const q = safetyQuestions();
  const input = { direct: stage1.direct ?? null, subcontractTotal: stage1.subcontractTotal ?? null };
  if (answers.subcontract) input.subcontract = answers.subcontract;
  const w = q.workers.find((x) => x.value === answers.workers);
  if (w) input.workers = w.workers;
  const b = q.bridge.find((x) => x.value === answers.bridge);
  const hasBridge = b && b.value !== 'none';
  if (hasBridge) {
    input.bridgeSpanM = b.span;
    if (answers.bridgePlace) input.bridgePlace = { yes: true, no: false, unknown: 'unknown' }[answers.bridgePlace];
  }
  const plan = answers.plan ?? [];
  if (plan.includes('unknown')) input.plan = 'unknown';
  else if (plan.includes('none') || (b && !plan.length)) input.plan = 'none';
  else if (plan.length) input.plan = plan;
  const works = answers.works ?? [];
  if (works.includes('unknown')) input.works = 'unknown';
  else if (works.includes('none')) input.works = 'none';
  else if (works.length) input.works = works;
  return input;
}

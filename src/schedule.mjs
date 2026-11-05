// 段取りの一覧(F06a: 着手まで、F06b: 施工中から完成・引き渡しまで。国の直轄の土木工事の例)。
// data/schedule.json の規則表の行を、入力の条件に当てはめて「いつ・何を・誰に・根拠(共通仕様書の箇所と原文)」の行にする。
// 条件や金額の境目はコードに書き込まない(規則表の condition と、抜き書きから読む threshold)。
// 入力が分からない条件は、推測で決めずに「確かめる」の注意を付けて行を出す。
import scheduleData from '../data/schedule.json' with { type: 'json' };
import sourcesData from '../data/sources/index.json' with { type: 'json' };
import { sourceVersion } from './source-version.mjs';
import { tableName, UNDETERMINED } from './rules-load.mjs';
import { kindTable } from './work-kind-tables.mjs';
import { DEFAULT_WORK_KIND } from './work-kinds.mjs';

const FIELD_LABEL = {
  hasSubcontract: '下請契約があるか',
  ictMeasure: '発注者が情報通信技術で確認できる措置を講じているか',
  hasSuppliedMaterial: '支給材料・貸与品があるか',
  hasDesignatedSurplus: '設計図書に定められた現場発生品があるか',
};
// 段の並び(この順に行を出す)。段に分けたのはこのツールの整理で、共通仕様書は段で分けていない
const PHASES = { start: '着手まで', work: '施工中', completion: '完成・引き渡し' };
// 工事目的物そのものの引き渡しは共通仕様書に無く、契約書による(開発中の判断 A)
export const HANDOVER_NOTE = '工事目的物そのものの引き渡しは、契約書(公共工事標準請負契約約款 第32条)によります。このツールは契約書を取得していないので、引き渡しの手続は一覧に入れていません。「完成・引き渡し」の段の引き渡しの行は、共通仕様書 1-1-1-21 の現場発生品の引き渡しです';
export const PHASE_LABEL = PHASES;

const isUnknown = (v) => v === undefined || v === null || (typeof v === 'number' && !Number.isFinite(v));

// 抜き書きの「○万円以上」から境目の円を読む。読めなければ規則表の誤りとして止める
export function thresholdYen(rule) {
  const m = String(rule.quote).match(new RegExp(rule.threshold.pattern));
  if (!m) throw new Error('段取りの規則表: 抜き書きから金額の境目を読めない: ' + rule.id);
  return Number(m[1]) * 10000;
}

function sourceOf(id) {
  const s = sourcesData.sources.find((x) => x.id === id);
  if (!s) throw new Error('段取りの規則表: 出典が無い: ' + id);
  return s;
}

function basisOf(rule, data) {
  const s = sourceOf(data.sourceId);
  return {
    doc: data.doc,
    title: data.doc,
    section: rule.section,
    sectionTitle: rule.title,
    sourceId: data.sourceId,
    quote: rule.quote,
    url: s.url,
    fetchedAt: s.fetchedAt,
    version: sourceVersion(s),
  };
}

const yen = (n) => Number(n).toLocaleString('ja-JP') + '円';

// 規則表の1行を入力に当てはめる。返り値: { show, checks, skip }
function apply(rule, input) {
  const checks = [];
  for (const [k, want] of Object.entries(rule.condition ?? {})) {
    const v = input[k];
    if (isUnknown(v)) checks.push('「' + (FIELD_LABEL[k] ?? k) + '」が分からないので、当てはまるか確かめてください');
    else if (v !== want) return { show: false, skip: (FIELD_LABEL[k] ?? k) + 'が条件に合わないので出していません' };
  }
  if (rule.threshold) {
    const t = thresholdYen(rule);
    const v = input[rule.threshold.field];
    if (isUnknown(v)) checks.push(rule.threshold.label + 'が分からないので、' + yen(t) + '以上なら行います');
    else if (v < t) return { show: false, skip: rule.threshold.label + 'が' + yen(t) + '未満なので出していません' };
  }
  return { show: true, checks };
}

// 読み込んだ表(F26b)の行。条件の欄が無いので入力は当てはめず、どの行も「確かめる」にする(「行う」と言い切らない)
function loadedDetail(input, table) {
  const name = tableName(table);
  const label = table.label ?? '読み込んだ表';
  const skipped = [];
  if (input.direct === false) {
    return { rows: [], skipped: table.schedule.map((r) => ({ id: r.id, what: r.what, reason: '発注者から直接請け負う場合の行なので出していません' })), notes: [label + 'は発注者の仕様書の受注者(元請け)の行です。下請けとして請け負う場合は、元請けの指示と契約書で確かめてください'], docLabel: label, custom: true };
  }
  const notes = [label + 'の行です: ' + name + '(' + table.source.edition + ' の版)。金額や下請の有無などの条件は当てはめていないので、要らない行も出ます'];
  if (input.orderer === 'private') notes.push('民間工事です。読み込んだ表は発注者の仕様書の行なので、この工事の契約書で確かめてください');
  const order = ['start', 'work', 'completion', UNDETERMINED];
  const rows = [...table.schedule].sort((a, b) => order.indexOf(a.phase) - order.indexOf(b.phase)).map((r) => ({
    id: r.id ?? '',
    phase: r.phase,
    when: r.when,
    what: r.what,
    to: r.to,
    status: 'needs_check',
    checks: Object.entries(r.undetermined ?? {}).map(([, why]) => '判断できない: ' + why),
    note: r.note ?? '',
    basis: {
      doc: name, title: name, section: r.section, sectionTitle: r.title ?? '', quote: r.quote,
      url: table.source.url, fetchedAt: table.source.fetchedAt, version: sourceVersion({ edition: table.source.edition }),
    },
  }));
  return { rows, skipped, notes, docLabel: label, custom: true };
}

// 段取りの行と、出さなかった行の理由を返す。table は読み込んだ表(無ければ工種の表)。段取りの行が無い表は工種の表のまま。
// input.workKind は工種(F44a。無ければ土木)。工種の表が無ければ行を出さず notRead: true を返す(別の工種の表で埋めない)
// all: true(F37c)は、条件を入れていない人に全部の行を出す。入力は見ず、どの行も状態は「確かめる」(「行う」と言い切らない)
export function buildScheduleDetail(input = {}, table = null, { all = false } = {}) {
  return all ? { ...scheduleDetail({ workKind: input.workKind }, table, true), all: true } : scheduleDetail(input, table, false);
}

function scheduleDetail(input, table, all) {
  if (table?.schedule?.length) return loadedDetail(input, table);
  const workKind = input.workKind ?? DEFAULT_WORK_KIND;
  const data = kindTable(workKind, 'schedule');
  if (!data) return { rows: [], skipped: [], notes: [], notRead: true, workKind };
  const rows = [];
  const skipped = [];
  const notes = [];
  if (input.direct === false) {
    notes.push('この段取りは発注者から直接請け負った受注者(元請け)の例です。下請けとして請け負う場合は、元請けの指示と契約書で確かめてください');
    return { rows, skipped: data.rules.map((r) => ({ id: r.id, what: r.what, reason: '発注者から直接請け負う場合の行なので出していません' })), notes };
  }
  if (input.orderer === 'private') notes.push('民間工事です。この一覧は国の直轄の例なので、発注者の仕様書・契約書で置き換えてください');
  notes.push(HANDOVER_NOTE);
  const order = Object.keys(PHASES);
  const rules = [...data.rules].sort((a, b) => order.indexOf(a.phase) - order.indexOf(b.phase));
  for (const rule of rules) {
    const r = apply(rule, input);
    if (!r.show) { skipped.push({ id: rule.id, phase: rule.phase, what: rule.what, section: rule.section, reason: r.skip }); continue; }
    rows.push({
      id: rule.id,
      phase: rule.phase,
      when: rule.when,
      what: rule.what,
      to: rule.to,
      status: all || r.checks.length ? 'needs_check' : 'applies',
      checks: r.checks,
      note: rule.note ?? '',
      basis: basisOf(rule, data),
    });
  }
  return { rows, skipped, notes };
}

export function buildSchedule(input = {}) {
  return buildScheduleDetail(input).rows;
}

// 規則表の点検(試験と scripts から使う): 抜き書きが原文に入っているか、いつ・何を・誰に・箇所が空でないか、境目が読めるか
export function checkScheduleRules(texts) {
  const norm = (s) => String(s).replace(/[\s　]+/g, '').replace(/（/g, '(').replace(/）/g, ')');
  const errors = [];
  const text = texts[scheduleData.sourceId];
  if (!text) return ['共通仕様書の原文が無い: ' + scheduleData.sourceId];
  const ids = new Set();
  for (const r of scheduleData.rules) {
    if (ids.has(r.id)) errors.push('id の重なり: ' + r.id);
    ids.add(r.id);
    for (const k of ['when', 'what', 'to', 'section', 'quote']) if (!String(r[k] ?? '').trim()) errors.push(r.id + ': ' + k + ' が空');
    if (!PHASES[r.phase]) errors.push(r.id + ': phase が分からない: ' + r.phase);
    if (!/^\d+-\d+-\d+-\d+$/.test(r.section)) errors.push(r.id + ': 箇所の番号の形が違う: ' + r.section);
    if (!norm(text).includes(norm(r.quote))) errors.push(r.id + ': 抜き書きが原文に無い');
    if (!norm(text).includes(norm(r.section + '　' + r.title.replace(/\(.*\)$/, '')))) errors.push(r.id + ': 箇所の番号と題名が原文の見出しに無い');
    if (r.threshold) { try { thresholdYen(r); } catch (e) { errors.push(e.message); } }
    for (const k of Object.keys(r.condition ?? {})) if (!FIELD_LABEL[k]) errors.push(r.id + ': 分からない条件: ' + k);
  }
  return errors;
}

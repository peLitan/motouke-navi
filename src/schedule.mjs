// 段取りの一覧(F06a: 着手まで。国の直轄の土木工事の例)。
// data/schedule.json の規則表の行を、入力の条件に当てはめて「いつ・何を・誰に・根拠(共通仕様書の箇所と原文)」の行にする。
// 条件や金額の境目はコードに書き込まない(規則表の condition と、抜き書きから読む threshold)。
// 入力が分からない条件は、推測で決めずに「確かめる」の注意を付けて行を出す。
import scheduleData from '../data/schedule.json' with { type: 'json' };
import sourcesData from '../data/sources/index.json' with { type: 'json' };

const FIELD_LABEL = {
  hasSubcontract: '下請契約があるか',
  ictMeasure: '発注者が情報通信技術で確認できる措置を講じているか',
};
const PHASES = { start: '着手まで' };
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

function basisOf(rule) {
  const s = sourceOf(scheduleData.sourceId);
  return {
    doc: scheduleData.doc,
    title: scheduleData.doc,
    section: rule.section,
    sectionTitle: rule.title,
    sourceId: scheduleData.sourceId,
    quote: rule.quote,
    url: s.url,
    fetchedAt: s.fetchedAt,
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

// 段取りの行と、出さなかった行の理由を返す
export function buildScheduleDetail(input = {}) {
  const rows = [];
  const skipped = [];
  const notes = [];
  if (input.direct === false) {
    notes.push('この段取りは発注者から直接請け負った受注者(元請け)の例です。下請けとして請け負う場合は、元請けの指示と契約書で確かめてください');
    return { rows, skipped: scheduleData.rules.map((r) => ({ id: r.id, what: r.what, reason: '発注者から直接請け負う場合の行なので出していません' })), notes };
  }
  if (input.orderer === 'private') notes.push('民間工事です。この一覧は国の直轄の例なので、発注者の仕様書・契約書で置き換えてください');
  for (const rule of scheduleData.rules) {
    const r = apply(rule, input);
    if (!r.show) { skipped.push({ id: rule.id, phase: rule.phase, what: rule.what, section: rule.section, reason: r.skip }); continue; }
    rows.push({
      id: rule.id,
      phase: rule.phase,
      when: rule.when,
      what: rule.what,
      to: rule.to,
      status: r.checks.length ? 'needs_check' : 'applies',
      checks: r.checks,
      note: rule.note ?? '',
      basis: basisOf(rule),
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

// 工種の段取りの表の点検(F44b)。作る側の道具で、画面には入らない(node scripts/check-quotes.mjs と試験が使う)
// 土木の checkScheduleRules より強く見る: 抜き書きは「箇所の号の中」にあること、1文以内、期日は抜き書きから読めること
import { FIELD_LABEL, PHASE_LABEL, deadlineText } from './schedule.mjs';

const strip = (s) => String(s).replace(/[\s　]+/g, '');
// 取り出すときに足した頁の印は原文ではないので除く(文が頁をまたいでも見つかる)
const bodyOf = (text) => text.replace(/^--- PDF の \d+ ページ ---\n/gm, '');
// 見出しは番号と空白の無い題名の行。機械設備工事編の 1.5.6.1 のように4段の番号もある。表の行(番号 名前 試験項目)は空白があるので見出しにしない
const HEAD = /^(\d+\.\d+\.\d+(?:\.\d+)?) (\S+)$/gm;
// 期限の語は、抜き書きに無ければ when に書かない
const TIME_WORDS = ['遅滞なく', '直ちに', 'あらかじめ', '先立ち', '適時', 'ごと'];
const HAND_PERIOD = /[0-9０-９]+\s*(日|か月|ヶ月|箇月|週|時間)/;

function sections(text) {
  const heads = [...bodyOf(text).matchAll(HEAD)];
  const body = bodyOf(text);
  return new Map(heads.map((m, i) => [m[1], { title: m[2].trim(), text: body.slice(m.index + m[0].length, heads[i + 1]?.index ?? body.length) }]));
}

// 「1.2.2(3)」→ その条の (3) の文。号の見出しは行の頭の「(n) 」
function itemText(sec, n) {
  const start = new RegExp('^\\(' + n + '\\) ', 'm').exec(sec.text);
  if (!start) return null;
  const rest = sec.text.slice(start.index + start[0].length);
  const next = new RegExp('^\\(' + (n + 1) + '\\) ', 'm').exec(rest);
  return rest.slice(0, next ? next.index : rest.length);
}

// 建築系の施工計画書の語の表の点検(F44d)。語は抜き書きの中にあり、抜き書きは箇所の号の中にある1文で、ページは原文の印と合う
// 抜き書きの始まりの頁。頁の印を除いた本文で探してから、印までの字数で頁を決める(文が頁をまたいでも見つかる)
export function pageOf(text, quote) {
  const parts = text.split(/^--- PDF の (\d+) ページ ---\n/m);
  const at = strip(parts.filter((_, i) => i % 2 === 0).join('')).indexOf(strip(quote));
  if (at < 0) return null;
  let seen = strip(parts[0]).length;
  for (let i = 1; i < parts.length; i += 2) {
    seen += strip(parts[i + 1]).length;
    if (at < seen) return Number(parts[i]);
  }
  return null;
}

export function checkKindPlan(data, text) {
  if (!text) return ['原文が無い: ' + data.sourceId];
  const secs = sections(text);
  const errors = [];
  if (data.items.length !== 3) errors.push('語の数が3でない: ' + data.items.length);
  for (const it of data.items) {
    const err = (m) => errors.push(it.id + ': ' + m);
    const m = /^(\d+\.\d+\.\d+)\((\d+)\)$/.exec(it.section);
    if (!m) { err('箇所の番号の形が違う: ' + it.section); continue; }
    if (Number(m[2]) !== it.no) err('号の番号と no が違う');
    const sec = secs.get(m[1]);
    if (!sec) { err('箇所の見出しが原文に無い: ' + m[1]); continue; }
    if (strip(sec.title) !== strip(data.sectionTitle)) err('題名が原文の見出しと違う: ' + sec.title);
    const scope = itemText(sec, it.no);
    if (scope === null) { err('号が原文に無い: ' + it.section); continue; }
    for (const q of [it.quote, it.provisoQuote].filter(Boolean)) {
      if (!strip(scope).includes(strip(q))) err('抜き書きが箇所の中に無い: ' + q);
      if ((q.match(/。/g) ?? []).length > 1) err('抜き書きが1文を超える');
    }
    if (!strip(it.quote).includes(strip(it.label))) err('語が抜き書きに無い: ' + it.label);
    const page = pageOf(text, it.quote);
    if (page !== it.page) err('ページが違う: ' + page);
  }
  return errors;
}

export function checkKindSchedule(data, text) {
  if (!text) return ['原文が無い: ' + data.sourceId];
  const secs = sections(text);
  const errors = [];
  const ids = new Set();
  for (const r of data.rules) {
    const err = (m) => errors.push(r.id + ': ' + m);
    if (ids.has(r.id)) err('id の重なり');
    ids.add(r.id);
    for (const k of ['when', 'what', 'to', 'section', 'title', 'quote']) if (!String(r[k] ?? '').trim()) err(k + ' が空');
    if (!PHASE_LABEL[r.phase]) err('phase が分からない: ' + r.phase);
    for (const k of Object.keys(r.condition ?? {})) if (!FIELD_LABEL[k]) err('分からない条件: ' + k);
    const m = /^(\d+\.\d+\.\d+(?:\.\d+)?)(?:\((\d+)\))?$/.exec(r.section);
    if (!m) { err('箇所の番号の形が違う: ' + r.section); continue; }
    const sec = secs.get(m[1]);
    if (!sec) { err('箇所の見出しが原文に無い: ' + m[1]); continue; }
    if (strip(sec.title) !== strip(r.title)) err('題名が原文の見出しと違う: ' + sec.title);
    const scope = m[2] ? itemText(sec, Number(m[2])) : sec.text;
    if (scope === null) { err('号が原文に無い: ' + r.section); continue; }
    if (!strip(scope).includes(strip(r.quote))) err('抜き書きが箇所の中に無い');
    if ((r.quote.match(/。/g) ?? []).length > 1) err('抜き書きが1文を超える');
    if (strip(r.quote).length < 10) err('抜き書きが短い');
    if (r.deadline) {
      if (!strip(scope).includes(strip(r.deadline.quote))) err('期日の抜き書きが箇所の中に無い');
      if (!r.when.includes('{期日}')) err('when に {期日} が無い');
      try { deadlineText(r); } catch (e) { err(e.message); }
    } else if (r.when.includes('{期日}')) err('deadline が無いのに {期日} がある');
    for (const k of ['when', 'what', 'to', 'note']) if (HAND_PERIOD.test(r[k] ?? '')) err(k + ' に手で書いた期間がある');
    for (const w of TIME_WORDS) if (r.when.includes(w) && !r.quote.includes(w)) err('when の「' + w + '」が抜き書きに無い');
  }
  return errors;
}

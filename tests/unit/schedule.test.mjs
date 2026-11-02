// 段取りの一覧(F06a)の単体テスト。値はすべて架空
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildSchedule, buildScheduleDetail, checkScheduleRules, thresholdYen } from '../../src/schedule.mjs';
import { scheduleRows, toCsv } from '../../src/export.mjs';
import { renderSchedule } from '../../src/ui/view.mjs';
import scheduleData from '../../data/schedule.json' with { type: 'json' };
import sourcesData from '../../data/sources/index.json' with { type: 'json' };

const base = { orderer: 'public', direct: true, workType: 'other', contractAmount: 30000000, hasSubcontract: true, subcontractTotal: 6000000, ictMeasure: false };
const ids = (rows) => rows.map((r) => r.id);

test('規則表: 抜き書きは共通仕様書の原文に入っていて、箇所と題名は原文の見出しにある', () => {
  const texts = {};
  for (const s of sourcesData.sources) if (s.file) texts[s.id] = fs.readFileSync(new URL('../../data/sources/' + s.file, import.meta.url), 'utf8');
  assert.deepEqual(checkScheduleRules(texts), []);
  assert.ok(checkScheduleRules({}).length > 0, '原文が無いときは誤りを返す');
});

test('コリンズの境目は抜き書きの「500万円以上」から読む', () => {
  const rule = scheduleData.rules.find((r) => r.id === 'start-corins');
  assert.equal(thresholdYen(rule), 5000000);
  assert.throws(() => thresholdYen({ ...rule, quote: '金額の無い文' }), /境目を読めない/);
});

test('請負代金額: 境目以上は出し、未満は出さずに理由を残し、分からなければ「確かめる」で出す', () => {
  assert.ok(ids(buildSchedule({ ...base, contractAmount: 5000000 })).includes('start-corins'));
  const below = buildScheduleDetail({ ...base, contractAmount: 4999999 });
  assert.ok(!ids(below.rows).includes('start-corins'));
  assert.match(below.skipped.find((s) => s.id === 'start-corins').reason, /5,000,000円未満/);
  const unknown = buildSchedule({ ...base, contractAmount: null }).find((r) => r.id === 'start-corins');
  assert.equal(unknown.status, 'needs_check');
  assert.match(unknown.checks[0], /分からない/);
});

test('下請け: 無ければ台帳・体系図・下請負の行を出さない。分からなければ「確かめる」で出す', () => {
  const none = ids(buildSchedule({ ...base, hasSubcontract: false }));
  for (const id of ['start-taicho', 'start-taicho-copy', 'start-taikeizu', 'start-taikeizu-copy', 'start-subcontract-terms']) assert.ok(!none.includes(id), id);
  assert.ok(none.includes('start-plan') && none.includes('start-commence'));
  const unk = buildSchedule({ ...base, hasSubcontract: null }).find((r) => r.id === 'start-taicho');
  assert.equal(unk.status, 'needs_check');
});

test('措置を講じていれば、写しの提出の行を出さない', () => {
  const on = ids(buildSchedule({ ...base, ictMeasure: true }));
  assert.ok(on.includes('start-taicho') && !on.includes('start-taicho-copy') && !on.includes('start-taikeizu-copy'));
  const off = ids(buildSchedule(base));
  assert.ok(off.includes('start-taicho-copy') && off.includes('start-taikeizu-copy'));
});

test('発注者から直接でなければ行を出さず、注意を出す。民間なら置き換えの注意を出す', () => {
  const d = buildScheduleDetail({ ...base, direct: false });
  assert.equal(d.rows.length, 0);
  assert.match(d.notes[0], /元請け/);
  assert.match(buildScheduleDetail({ ...base, orderer: 'private' }).notes[0], /発注者の仕様書・契約書で置き換え/);
});

test('表示と CSV: 文字はエスケープし、CSV は見出し + 1行ずつ', () => {
  const rows = buildSchedule(base);
  const evil = [{ ...rows[0], what: '<script>x</script>' }];
  assert.ok(!renderSchedule(evil).includes('<script>'));
  const csvRows = scheduleRows(rows);
  assert.equal(csvRows.length, rows.length + 1);
  assert.ok(csvRows[1].join(' ').includes('土木工事共通仕様書(案)令和8年3月 1-1-1-'));
  assert.ok(toCsv(csvRows).startsWith('﻿'));
  assert.match(renderSchedule([]), /出す段取りの行がありません/);
});

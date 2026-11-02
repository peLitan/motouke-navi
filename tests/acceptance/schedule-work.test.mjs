// F06b: 段取り(施工中から完成・引き渡しまで)(条件 F06-1)
import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './_helpers.mjs';
import { CONDS, assertRow, loadSources } from './_schedule-common.mjs';

const ORDER = { start: 0, work: 1, completion: 2 };

test('施工中と完成・引き渡しの行があり、根拠の箇所と原文がある', async () => {
  const { buildSchedule } = await load('src/schedule.mjs');
  const src = loadSources();
  for (const c of CONDS) {
    const rows = buildSchedule(c);
    const work = rows.filter((r) => r.phase === 'work');
    const done = rows.filter((r) => r.phase === 'completion');
    assert.ok(work.length >= 2, '施工中の行が少ない');
    assert.ok(done.length >= 2, '完成・引き渡しの行が少ない');
    assert.ok(done.some((r) => /引渡|引き渡/.test(r.what)), '引き渡しの行が無い');
    for (const r of [...work, ...done]) assertRow(r, src);
  }
});

test('行は 着手まで → 施工中 → 完成・引き渡し の順に並ぶ', async () => {
  const { buildSchedule } = await load('src/schedule.mjs');
  const rows = buildSchedule(CONDS[0]);
  for (const r of rows) assert.ok(r.phase in ORDER, '知らない段: ' + r.phase);
  const seq = rows.map((r) => ORDER[r.phase]);
  assert.deepEqual(seq, [...seq].sort((a, b) => a - b));
});

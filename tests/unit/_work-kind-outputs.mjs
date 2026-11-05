// 土木を選んだときの出力を固定する試験(F44a)の部品。段取り・目次・積算の出力を、決めた入力で作る。
// 基準の work-kind-civil.golden.json は、工種の選択を足す前のコードから作った(node tests/unit/_work-kind-outputs.mjs --write)。
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { readBidForm } from '../../src/ui/form.mjs';
import { SAMPLE } from '../../src/sample.mjs';
import { buildScheduleDetail } from '../../src/schedule.mjs';
import { checkPlanToc } from '../../src/plan-check.mjs';
import { renderSchedule, renderPlanResult } from '../../src/ui/view.mjs';
import { scheduleRows, planRows, toCsv } from '../../src/export.mjs';
import { checkEstimate, renderMarkdown, loadTables } from '../../plugin/skills/estimate/scripts/check-estimate.mjs';
import { estimate } from '../../src/estimate/estimate.mjs';

const GOLDEN = new URL('./work-kind-civil.golden.json', import.meta.url);
const TOC = '1. 工事概要\n2. 計画工程表\n3. 現場組織表\n4. 安全管理';

function schedule(input, opts) {
  const detail = buildScheduleDetail(input, null, opts);
  return { rows: detail.rows, skipped: detail.skipped, notes: detail.notes, html: renderSchedule(detail.rows, detail), csv: toCsv(scheduleRows(detail.rows)) };
}
function plan(workType) {
  const out = checkPlanToc(TOC, { workType });
  return { out, html: renderPlanResult(out), csv: toCsv(planRows(out)) };
}
function civilEstimate() {
  const file = '数量.md';
  const text = ['| 掘削 | 土砂 | m3 | 1,200 |', '| 区画線 | m | 300 |'].join('\n');
  const tables = loadTables('docs/samples/estimate/架空の標準単価表');
  const lines = [
    { name: '掘削', quantity: 1200, unit: 'm3', quote: '| 掘削 | 土砂 | m3 | 1,200 |', file, match: { no: 1, tableQuote: '掘削 ｍ３ 土砂 架空の方法A', reason: '工種が同じ' } },
    { name: '区画線', quantity: 300, unit: 'm', quote: '| 区画線 | m | 300 |', file, match: null, reason: '市場単価で積む工種' },
  ];
  const r = checkEstimate({ source: { title: '架空' }, conditions: { kind: '道路改良工事', prefecture: '架空県' }, lines }, [{ file, text }], tables);
  return { result: r, md: renderMarkdown(r) };
}

export function civilOutputs() {
  const form = readBidForm(SAMPLE.form);
  return {
    scheduleSample: schedule(form),
    scheduleEmpty: schedule({}),
    scheduleAll: schedule({}, { all: true }),
    schedulePrivate: schedule({ ...form, orderer: 'private' }),
    scheduleSub: schedule({ ...form, direct: false }),
    planOther: plan('other'),
    planUnset: plan(undefined),
    planKenchiku: plan('kenchiku-ikkatsu'),
    estimate: civilEstimate(),
    estimatePart: estimate({ kind: '道路改良工事', labor: null, lines: [] }),
  };
}
// 値そのものは原文の写しで大きいので、基準には値ごとの sha256 だけを置く
export const hashes = (outputs) => Object.fromEntries(Object.entries(outputs).map(([k, v]) => [k, crypto.createHash('sha256').update(JSON.stringify(v), 'utf8').digest('hex')]));
export const readGolden = () => JSON.parse(fs.readFileSync(GOLDEN, 'utf8'));

if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv.includes('--write')) {
  fs.writeFileSync(GOLDEN, JSON.stringify(hashes(civilOutputs()), null, 1) + '\n');
  console.log('基準を書いた');
}

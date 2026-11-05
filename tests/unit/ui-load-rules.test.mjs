// F26b: 画面の「段取りの表を読み込む」。data/specs/wakayama_r0711_rows.json を読むと記載項目16行と段取りの行が出ること、
// 壊れたファイルを拒むこと、国の直轄の例に戻せること、通信・保存をしないこと
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildHtml } from '../../build.mjs';
import { parseRulesFile, tableNotice, tableCredit } from '../../src/rules-load.mjs';
import { buildScheduleDetail } from '../../src/schedule.mjs';
import { checkPlanToc, PLAN_ITEMS } from '../../src/plan-check.mjs';
import { renderSchedule, renderPlanResult } from '../../src/ui/view.mjs';
import { scheduleRows, planRows } from '../../src/export.mjs';
import { loadRulesFile, clearRulesTable, runPlanCheck } from '../../src/ui/app.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FILE = fs.readFileSync(path.join(ROOT, 'data/specs/wakayama_r0711_rows.json'), 'utf8');
const SOURCE = { publisher: '架空県', title: '架空の仕様書', edition: '令和9年1月' };
const SCHED = { kind: 'schedule', phase: 'start', when: '着手前', what: '計画書を出す', to: '監督員', section: '1-1-1-6', quote: '出す' };

// 画面の要素の代わり(id ごとに1つ)
function fakeDoc() {
  const els = new Map();
  return {
    els,
    getElementById(id) {
      if (!els.has(id)) els.set(id, { innerHTML: '', textContent: '', value: '', hidden: false });
      return els.get(id);
    },
  };
}

test('見本のファイルを読むと、記載項目16行と段取りの行が出て、行の数と出典が分かる', () => {
  const t = parseRulesFile(FILE);
  assert.equal(t.planItems.length, 16);
  assert.equal(t.schedule.length, 15);
  assert.equal(t.count, 31);
  const notice = tableNotice(t);
  assert.match(notice, /読み込んだ表です\(31行\)/);
  assert.ok(!notice.includes('照合済み'));
  assert.match(notice, /画面では原文と照らしていません/);
  for (const w of ['和歌山県', '土木請負工事必携', '令和7年11月']) assert.ok(notice.includes(w), w);
});

test('段取りは読み込んだ行で出し、国の例の行と文を混ぜない。判断できない欄は理由を出し、「行う」と言い切らない', () => {
  const t = parseRulesFile(FILE);
  const d = buildScheduleDetail({ direct: true }, t);
  assert.equal(d.rows.length, 15);
  assert.deepEqual([...new Set(d.rows.map((r) => r.phase))], ['start', 'work', 'completion', '判断できない']);
  assert.ok(d.rows.every((r) => r.status === 'needs_check'));
  assert.ok(d.rows.every((r) => r.basis.doc.startsWith('和歌山県')));
  const land = d.rows.find((r) => r.id === 'land-return');
  assert.ok(land.checks.some((c) => c.includes('使用終了')));
  const html = renderSchedule(d.rows, d);
  assert.ok(html.includes('受注後の段取りは 15件です'));
  assert.ok(html.includes('読み込んだ表の行です'));
  assert.ok(!html.includes('国の直轄'));
  assert.ok(!html.includes('共通仕様書'));
  const csv = scheduleRows(d.rows);
  assert.equal(csv.length, 16);
  assert.ok(csv[1][5].startsWith('和歌山県'));
  assert.ok(csv[1][8].includes('令和7年11月'));
});

test('下請けとして請け負うときは、読み込んだ表でも行を出さない', () => {
  const d = buildScheduleDetail({ direct: false }, parseRulesFile(FILE));
  assert.equal(d.rows.length, 0);
  assert.equal(d.skipped.length, 15);
});

test('目次の点検は読み込んだ記載項目と比べ、抜けの候補の根拠と CSV が読み込んだ表を指す', () => {
  const t = parseRulesFile(FILE);
  const toc = t.planItems.filter((p) => p.no !== 3).map((p) => p.label).join('\n');
  const out = checkPlanToc(toc, { table: t });
  assert.deepEqual(out.candidates.map((c) => c.no), [3]);
  assert.ok(out.candidates[0].message.startsWith('和歌山県'));
  assert.ok(out.candidates[0].message.includes('1-1-1-6'));
  const rows = planRows(out);
  assert.equal(rows[1][4], '', 'ページの無い行に undefined を書かない');
  assert.ok(!renderPlanResult(out).includes('undefined'));
  const all = checkPlanToc(t.planItems.map((p) => p.label).join('\n'), { table: t });
  assert.ok(renderPlanResult(all).includes('和歌山県'));
  assert.ok(!renderPlanResult(all).includes('国の直轄'));
  assert.ok(checkPlanToc(toc, { table: t, workType: 'kenchiku-ikkatsu' }).undecidable[0].message.includes('和歌山県'));
});

test('片方の行しか無い表では、無い側は国の例のまま(空の表で「抜け無し」にしない)', () => {
  const t = parseRulesFile(JSON.stringify({ source: SOURCE, rows: [SCHED] }));
  assert.equal(checkPlanToc('工事概要', { table: t }).candidates.length, PLAN_ITEMS.length - 1);
  const onlyPlan = parseRulesFile(JSON.stringify({ source: SOURCE, rows: [{ kind: 'plan-item', no: 1, label: '概要', section: '1-1', quote: '(1)概要' }] }));
  assert.ok(buildScheduleDetail({ direct: true }, onlyPlan).rows.every((r) => r.basis.sourceId));
});

test('壊れたファイル・形の違うファイルは理由を出して拒む', () => {
  const cases = [
    ['{ "rows": [', /JSON/],
    ['[]', /行の一覧/],
    [JSON.stringify({ map: {} }), /行の一覧/],
    [JSON.stringify({ source: SOURCE, rows: [] }), /行が1つも/],
    [JSON.stringify({ rows: [SCHED] }), /出典/],
    [JSON.stringify({ source: { ...SOURCE, edition: ' ' }, rows: [SCHED] }), /版/],
    [JSON.stringify({ source: SOURCE, rows: [{ ...SCHED, kind: 'x' }] }), /1行目.*kind/],
    [JSON.stringify({ source: SOURCE, rows: [SCHED, { ...SCHED, quote: '' }] }), /2行目.*quote/],
    [JSON.stringify({ source: SOURCE, rows: [{ ...SCHED, phase: 'later' }] }), /phase/],
    [JSON.stringify({ source: SOURCE, rows: [{ ...SCHED, when: '判断できない' }] }), /undetermined\.when/],
    [JSON.stringify({ source: SOURCE, rows: [{ ...SCHED, id: 'a' }, { ...SCHED, id: 'a' }] }), /id が重なって/],
    [JSON.stringify({ source: SOURCE, rows: [null] }), /1行目/],
    [JSON.stringify({ source: SOURCE, rows: [{ kind: 'plan-item', label: '概要', section: '1-1', quote: '（1）概要' }] }), /1行目.*no/],
  ];
  for (const [text, re] of cases) assert.throws(() => parseRulesFile(text), re, text);
});

test('画面: 読み込むと注記が変わり、壊れたファイルでは今の表のまま、戻すと国の例に戻る', () => {
  const doc = fakeDoc();
  doc.getElementById('plan-input').value = '工事概要';
  assert.equal(loadRulesFile(doc, FILE), true);
  assert.match(doc.getElementById('schedule-notice').textContent, /和歌山県/);
  assert.match(doc.getElementById('plan-notice').textContent, /読み込んだ表です\(31行\)/);
  assert.equal(doc.getElementById('schedule-about').hidden, true);
  assert.equal(doc.getElementById('rules-clear').hidden, false);
  assert.match(doc.getElementById('rules-status').textContent, /段取り 15行・記載項目 16行/);
  assert.match(doc.getElementById('plan-result').innerHTML, /和歌山県/);

  assert.equal(loadRulesFile(doc, 'こわれた'), false);
  assert.match(doc.getElementById('rules-status').textContent, /読み込めませんでした: JSON.*今の表はそのまま/);
  assert.match(doc.getElementById('schedule-notice').textContent, /和歌山県/);

  clearRulesTable(doc);
  assert.match(doc.getElementById('schedule-notice').textContent, /^国の直轄の例/);
  assert.equal(doc.getElementById('schedule-about').hidden, false);
  assert.equal(doc.getElementById('rules-clear').hidden, true);
  runPlanCheck(doc);
  assert.ok(!doc.getElementById('plan-result').innerHTML.includes('和歌山県'));
});

test('F35a: 見本のファイルを読み込むと、段取りと目次の注記に加工の表示と県の作成でない旨が出て、戻すと消える', () => {
  const credit = '和歌山県「土木請負工事必携(令和7年11月)」を加工して作成';
  const notMade = 'この出力は和歌山県が作成したものではありません';
  const doc = fakeDoc();
  assert.equal(loadRulesFile(doc, FILE), true);
  for (const id of ['schedule-notice', 'plan-notice']) {
    const shown = doc.getElementById(id).textContent;
    assert.ok(shown.includes(credit), id);
    assert.ok(shown.includes(notMade), id);
  }
  clearRulesTable(doc);
  for (const id of ['schedule-notice', 'plan-notice']) {
    const shown = doc.getElementById(id).textContent;
    assert.ok(!shown.includes('を加工して作成'), id);
    assert.ok(!shown.includes('和歌山県'), id);
  }
});

test('F35a: 表示はファイルの出典から作り、県の名前を決め打ちしない。document が無ければ title を使う', () => {
  const t = parseRulesFile(JSON.stringify({ source: SOURCE, rows: [SCHED] }));
  assert.equal(tableCredit(t), '架空県「架空の仕様書(令和9年1月)」を加工して作成。この出力は架空県が作成したものではありません。');
  assert.ok(!tableNotice(t).includes('和歌山県'));
  const blank = parseRulesFile(JSON.stringify({ source: { ...SOURCE, document: ' ' }, rows: [SCHED] }));
  assert.ok(tableCredit(blank).includes('「架空の仕様書('));
  const doc = fakeDoc();
  assert.equal(loadRulesFile(doc, JSON.stringify({ source: SOURCE, rows: [SCHED] })), true);
  assert.ok(doc.getElementById('schedule-notice').textContent.includes(tableCredit(t)));
  clearRulesTable(doc);
});

test('F35a: 表示を出す処理が index.html に入り、印刷でも消えない欄に出る', () => {
  const html = buildHtml();
  assert.ok(html.includes('を加工して作成。'));
  assert.ok(html.includes('が作成したものではありません。'));
  for (const id of ['schedule-notice', 'plan-notice']) {
    const tag = html.match(new RegExp('<p [^>]*id="' + id + '"[^>]*>'));
    assert.ok(tag, id);
    assert.ok(!tag[0].includes('no-print'), id);
  }
});

test('ファイルの中の文はそのまま HTML にしない', () => {
  const t = parseRulesFile(JSON.stringify({ source: SOURCE, rows: [{ ...SCHED, what: '<img src=x onerror=a()>' }] }));
  const d = buildScheduleDetail({ direct: true }, t);
  assert.ok(!renderSchedule(d.rows, d).includes('<img'));
});

test('決まりを崩さない: 読み込みの欄があり、外部と通信せず、断り書きと PDL の表示が残り、保存しない', () => {
  const html = buildHtml();
  assert.ok(html.includes('id="rules-load"'));
  assert.ok(html.includes('id="disclaimer"'));
  assert.ok(html.includes('公共データ利用規約'));
  assert.ok(html.includes("connect-src 'none'"));
  const src = ['src/rules-load.mjs', 'src/ui/app.mjs'].map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
  assert.ok(!/localStorage|sessionStorage|indexedDB|fetch\(|XMLHttpRequest|sendBeacon/.test(src));
});

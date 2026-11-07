// F37f: 幅 40rem 以下で段取りの表を行ごとのカードにする。段取りは区切りごとに畳める。進み具合は1行に収める。
// この環境にはブラウザが無いので、カードの見た目と実際の幅は測れない。描いた HTML の形と CSS の決まり、文字の幅の見積もりを確かめる
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildHtml } from '../../build.mjs';
import { buildSchedule, buildScheduleDetail } from '../../src/schedule.mjs';
import { renderSchedule } from '../../src/ui/view.mjs';
import { runPage } from '../acceptance/_helpers.mjs';

// 見本の条件(架空の工事)。ui-details の試験と同じ値
const COND = { orderer: 'public', direct: true, workType: 'other', contractAmount: 300000000, hasSubcontract: true, subcontractTotal: 60000000, license: 'tokutei', engineerQualification: 'kanri', ictMeasure: false };
const shell = fs.readFileSync(new URL('../../src/ui/shell.html', import.meta.url), 'utf8');
const css = shell.match(/<style>([\s\S]*?)<\/style>/)[1].replace(/\/\*[\s\S]*?\*\//g, '');
const html = buildHtml();
const REM = 16;

// 幅 40rem の決まりの中身
const narrow = css.match(/@media \(max-width: 40rem\) \{([\s\S]*?)\n {2}\}/)[1];
const narrowRule = (sel) => [...narrow.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find((m) => m[1].trim() === sel)?.[2];
const cellsOf = (row) => [...row.matchAll(/<td\b([^>]*)>/g)].map((m) => m[1]);
const rowsOf = (h) => [...h.matchAll(/<tr class="schedule-row">([\s\S]*?)<\/tr>/g)].map((m) => m[1]);
const heads = (h) => [...h.matchAll(/<thead>([\s\S]*?)<\/thead>/g)].map((m) => [...m[1].matchAll(/<th>([\s\S]*?)<\/th>/g)].map((x) => x[1]));

test('段取りの表: すべての td に、その列の見出しと同じ data-label がある', () => {
  const d = buildScheduleDetail(COND);
  const h = renderSchedule(d.rows, d);
  const rows = rowsOf(h);
  assert.equal(rows.length, d.rows.length);
  const head = heads(h)[0];
  assert.deepEqual(head.slice(0, 4), ['いつ', '何を', '誰に', '状態']);
  assert.match(head[4], /^根拠\(共通仕様書の箇所\)$/);
  for (const r of rows) {
    const labels = cellsOf(r).map((a) => a.match(/ data-label="([^"]*)"/)?.[1]);
    assert.deepEqual(labels, head, '見出しと食い違う td がある');
  }
});

test('段取りの表: 状態の列は data-label="状態" の欄で、折り返さない決まりと ui-awarded の否定の検査が実際の欄を見る(F79a)', () => {
  const d = buildScheduleDetail(COND);
  const h = renderSchedule(d.rows, d);
  const cells = [...h.matchAll(/<td data-label="状態">([^<]*)<\/td>/g)].map((m) => m[1]);
  assert.equal(cells.length, d.rows.length);
  assert.ok(cells.includes('行う') && cells.includes('確かめる'), cells.join(','));
  assert.ok(css.includes('table.schedule td[data-label="状態"]'));
});

test('読み込んだ表の名前が data-label の属性を壊さない', () => {
  const d = buildScheduleDetail(COND);
  const h = renderSchedule(d.rows, { ...d, docLabel: '"><img src=x onerror=alert(1)>' });
  assert.ok(!h.includes('<img'), '名前がそのまま入っている');
  assert.ok(rowsOf(h).every((r) => cellsOf(r).length === 6));
  assert.ok(h.includes('data-label="根拠(&quot;&gt;&lt;img'));
});

test('段取りは区切りごとに畳める: 区切りの数だけ折りたたみがあり、見出しに件数が出て、最初の区切りだけ開く', () => {
  const rows = buildSchedule(COND);
  const phases = [...new Set(rows.map((r) => r.phase))];
  assert.ok(phases.length >= 2, '見本の条件で区切りが足りない');
  const h = renderSchedule(rows, buildScheduleDetail(COND));
  const parts = [...h.matchAll(/<details class="schedule-phase"( open)?><summary><h4>([^<]*?)\((\d+)件\)<\/h4><\/summary>/g)];
  assert.equal(parts.length, phases.length);
  assert.deepEqual(parts.map((p) => p[1] === ' open'), phases.map((_, i) => i === 0));
  assert.deepEqual(parts.map((p) => Number(p[3])), phases.map((ph) => rows.filter((r) => r.phase === ph).length));
  assert.equal(parts.reduce((n, p) => n + Number(p[3]), 0), rows.length, '畳んだ中で行が欠けている');
  // 各区切りの中に、表とその原文の折りたたみが1つずつ入っている
  const chunks = h.split('<details class="schedule-phase"').slice(1);
  for (const c of chunks) {
    assert.equal((c.match(/<table\b/g) ?? []).length, 1);
    assert.equal((c.match(/<details class="basis schedule-basis">/g) ?? []).length, 1);
  }
  // 大きな折りたたみの中にある。区切りを畳むとき「表の中に折りたたみを入れない」(F14c)は崩さない
  assert.ok(h.indexOf('<details class="schedule-table">') < h.indexOf('<details class="schedule-phase"'));
  assert.ok(![...h.matchAll(/<table\b[\s\S]*?<\/table>/g)].some((m) => m[0].includes('<details')));
});

test('見本の画面の段取りも区切りごとに畳まれ、data-label が付く(描き直しの道を通っても)', async () => {
  const page = runPage(html);
  await page.click('sample-load');
  const h = page.el('schedule-result').innerHTML;
  assert.ok(h.includes('class="schedule-phase"'));
  assert.ok(rowsOf(h).length > 0);
  assert.ok(rowsOf(h).every((r) => cellsOf(r).every((a) => a.includes('data-label="'))));
});

test('CSS: 幅 40rem 以下で行ごとのカードになり、列の名前を data-label から出す。最小の幅を持たない', () => {
  assert.match(narrow, /table\.schedule, table\.schedule tbody, table\.schedule tr, table\.schedule td \{ display: block; width: 100%; \}/);
  assert.match(narrowRule('table.schedule thead'), /display: none/);
  assert.match(narrowRule('table.schedule tr'), /border: 1px solid/);
  assert.match(narrowRule('table.schedule td::before'), /content: attr\(data-label\)/);
  // 空の欄は項目名だけが残らないように隠す
  assert.match(narrowRule('table.schedule td:empty'), /display: none/);
  assert.ok(!/table\.schedule \{[^}]*min-width/.test(css), '段取りの表に min-width が残っている');
  // 台帳の記載事項の表も同じカードにする(F79a。F37f の設計では対象の外だった。細かい決まりは ui-mobile の試験)
  assert.match(narrowRule('table.checklist-table td::before'), /content: attr\(data-label\)/);
  // 広い画面と印刷は表のまま: カードの決まりは幅の決まりの中だけ
  assert.equal(css.replace(narrow, '').includes('attr(data-label)'), false);
});

test('進み具合は幅 320px でも4つの段が横に並び、全部の名前が字の大きさを変えずに読める(F43a・F86b)', () => {
  assert.equal(narrowRule('.steps li + li::before').match(/width: ([\d.]+)rem/)[1], '0.25');
  assert.ok(!/font-size/.test(narrowRule('.step-dot')), '段の字を小さくしている');
  assert.ok(!/step-name|step-more/.test(css.match(/@media \(max-width: 40rem\) \{[\s\S]*?\n {2}\}/)[0]), '狭い画面で名前を隠している');
  const items = [...shell.matchAll(/<li id="step-(\d)"[^>]*>([\s\S]*?)<\/li>/g)];
  assert.equal(items.length, 4);
  // 見積もり: 和文は1字1em。1段の幅 = 丸 + 間 + 名前。線と間を足した4つの段が本文の幅に入る(名前は折り返さない)
  const dot = parseFloat(narrowRule('.step-dot').match(/width: ([\d.]+)rem/)[1]) * REM;
  const names = items.map((b) => [...b[2].match(/<span class="step-name">([^<]+)<\/span>/)[1]].length * REM);
  const used = names.reduce((n, w) => n + w + dot + 0.25 * REM, 0) + 3 * (0.25 + 0.25) * REM;
  assert.ok(used <= 320 - 0.75 * REM * 2, '4つの段が1行に入らない: ' + used);
});

test('07 の決まり: 外部の読み込み・通信・保存が無く、断り書きと PDL を出し、index.html が今の src と同じ', () => {
  assert.ok(!/<(script|link|img|iframe)\b[^>]*\b(src|href)=["']https?:/i.test(html));
  assert.ok(!/\bfetch\(|XMLHttpRequest|WebSocket|localStorage|sessionStorage|indexedDB/.test(html));
  assert.match(html, /connect-src 'none'/);
  assert.ok(html.includes('id="disclaimer"'));
  assert.ok(html.includes('PDL1.0'));
  assert.equal(fs.readFileSync(new URL('../../index.html', import.meta.url), 'utf8'), html, 'index.html を作り直していない');
});

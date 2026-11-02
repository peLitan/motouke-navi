// F14c: 折りたたみと印刷。根拠の原文と段取りの表は details で閉じ、見出しは中身が分かる言葉にする。
// 結論は閉じない。表の中に折りたたみを入れない。印刷ではボタンを消し、details をすべて開き、終わったら元に戻す
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHtml } from '../../build.mjs';
import { buildSchedule, buildScheduleDetail } from '../../src/schedule.mjs';
import { bidCheck } from '../../src/bid-check.mjs';
import { renderBidResult, renderSchedule, renderPlanResult } from '../../src/ui/view.mjs';
import { openDetailsForPrint, restoreDetailsAfterPrint } from '../../src/ui/app.mjs';

// 見本の条件(架空の工事)。tests/acceptance/_schedule-common.mjs の1つ目と同じ値
const COND = { orderer: 'public', direct: true, workType: 'other', contractAmount: 300000000, hasSubcontract: true, subcontractTotal: 60000000, license: 'tokutei', engineerQualification: 'kanri', ictMeasure: false };

// 表(<table>…</table>)の中身をすべて取り出す
const tablesOf = (html) => [...html.matchAll(/<table\b[\s\S]*?<\/table>/g)].map((m) => m[0]);
// details の外にある部分(閉じても見える部分)。入れ子の details も外す
function outsideDetails(html) {
  let s = html;
  let prev;
  do { prev = s; s = s.replace(/<details\b(?:(?!<details\b)[\s\S])*?<\/details>/g, ''); } while (s !== prev);
  return s;
}

test('段取りの表は「受注後の段取り(○件)」の折りたたみに入り、最初は閉じている。件数の結論は閉じずに出る', () => {
  const rows = buildSchedule(COND);
  assert.ok(rows.length > 0);
  const html = renderSchedule(rows, buildScheduleDetail(COND));
  const m = html.match(/<details class="schedule-table"( open)?><summary>受注後の段取り\((\d+)件\)<\/summary>/);
  assert.ok(m, '段取りの表の折りたたみが無い、または見出しが「受注後の段取り(○件)」でない');
  assert.equal(m[1], undefined, '段取りの表が最初から開いている');
  assert.equal(Number(m[2]), rows.length);
  const visible = outsideDetails(html);
  assert.ok(visible.includes('受注後の段取りは ' + rows.length + '件です'), '件数の結論が折りたたみの外に無い');
  assert.ok(!visible.includes('<table'), '表が折りたたみの外に出ている');
  assert.ok(visible.includes('class="human"'), '断り書きが折りたたみの中に入った');
});

test('段取りの表の中に折りたたみが無く、原文の抜き書きは表の下の「根拠: 共通仕様書の原文」にある', () => {
  const rows = buildSchedule(COND);
  const html = renderSchedule(rows, buildScheduleDetail(COND));
  const tables = tablesOf(html);
  assert.ok(tables.length > 0);
  for (const t of tables) {
    assert.ok(!/<details\b/.test(t), '表の中に折りたたみがある');
    assert.ok(!/<blockquote\b/.test(t), '表の中に原文が入っている');
  }
  const basis = [...html.matchAll(/<details class="basis schedule-basis"><summary>(根拠: 共通仕様書の原文\([^)]*\d+件\))<\/summary>([\s\S]*?)<\/details>/g)];
  assert.ok(basis.length > 0, '原文の折りたたみが無い');
  const all = basis.map((b) => b[2]).join('');
  for (const r of rows) {
    assert.ok(tables.join('').includes(r.basis.section), '表に箇所の名前が無い: ' + r.basis.section);
    const q = r.basis.quote.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    assert.ok(all.includes(q), '原文が折りたたみに無い: ' + r.basis.section);
  }
});

test('入札前の確認: 根拠の見出しは「根拠: 建設業法 第○条…」で閉じており、結論の印は閉じない', () => {
  const bid = bidCheck(COND);
  const html = renderBidResult(bid);
  const sums = [...html.matchAll(/<details class="basis"><summary>([^<]*)<\/summary>/g)].map((m) => m[1]);
  assert.ok(sums.length > 0, '根拠の折りたたみが無い');
  for (const s of sums) assert.match(s, /^根拠: \S/, '見出しが「根拠: 」で始まらない: ' + s);
  assert.ok(sums.some((s) => /^根拠: 建設業法 第\d+条/.test(s)), '「根拠: 建設業法 第○条」の見出しが無い');
  assert.ok(!/<details class="basis" open/.test(html), '根拠が最初から開いている');
  const visible = outsideDetails(html);
  for (const it of bid.items) {
    assert.ok(visible.includes('id="bid-item-'), '項目が見えない');
    assert.ok(visible.includes('badge-' + it.status) || visible.includes('status-' + it.status), '結論が折りたたみの中にある: ' + it.key);
  }
  assert.ok(visible.includes(bid.disclaimer), '断り書きが折りたたみの中にある');
  assert.ok(!html.includes('根拠の条:'), '古い見出し「根拠の条:」が残っている');
});

test('施工計画書の目次の点検: 根拠の見出しは「根拠: 1-1-1-6 …」', () => {
  const h = renderPlanResult({ candidates: [{ item: '架空の項目', basis: { doc: '架空の資料', section: '1-1-1-6', sectionTitle: '施工計画書', page: 12, quote: '架空の抜き書き' } }] });
  assert.match(h, /<details class="basis"><summary>根拠: 1-1-1-6 施工計画書/);
  assert.ok(outsideDetails(h).includes('架空の項目'), '候補の名前が折りたたみの中にある');
});

test('印刷: 閉じていた details を開き、印刷が終わったら開いたものだけを閉じ直す', () => {
  const closed1 = { open: false }, closed2 = { open: false }, opened = { open: true };
  const doc = { querySelectorAll: (sel) => (sel === 'details' ? [closed1, opened, closed2] : []) };
  openDetailsForPrint(doc);
  assert.deepEqual([closed1.open, opened.open, closed2.open], [true, true, true]);
  openDetailsForPrint(doc); // ボタンと beforeprint の2回呼ばれても同じ
  restoreDetailsAfterPrint();
  assert.deepEqual([closed1.open, opened.open, closed2.open], [false, true, false]);
});

test('画面: 印刷の CSS でボタンと操作の部分を消し、beforeprint・afterprint を登録している', () => {
  const html = buildHtml();
  const print = html.match(/@media print\s*\{([\s\S]*?)\n  \}/);
  assert.ok(print, '印刷の CSS が無い');
  assert.match(print[1], /button[^{]*\.no-print[^{]*\{\s*display:\s*none\s*!important/);
  assert.ok(html.includes("addEventListener('beforeprint'"), 'beforeprint が無い');
  assert.ok(html.includes("addEventListener('afterprint'"), 'afterprint が無い');
});

test('07 の決まり: 外部の読み込み・通信が無く、断り書きと PDL の表示が折りたたみの外に常にある', () => {
  const html = buildHtml();
  assert.ok(!/<(script|link|img|iframe)\b[^>]*\b(src|href)=["']https?:/i.test(html), '外部の読み込みがある');
  assert.ok(!/\bfetch\(|XMLHttpRequest|WebSocket|localStorage|sessionStorage|indexedDB/.test(html.replace(/connect-src 'none'/, '')), '通信か保存の処理がある');
  assert.match(html, /connect-src 'none'/);
  const body = html.slice(html.indexOf('<body>'));
  const visible = outsideDetails(body.replace(/<script\b[\s\S]*?<\/script>/g, ''));
  assert.ok(visible.includes('id="disclaimer"'), '断り書きが無い、または折りたたみの中にある');
  assert.ok(visible.includes('PDL1.0'), 'PDL の表示が無い、または折りたたみの中にある');
});

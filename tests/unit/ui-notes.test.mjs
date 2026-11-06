// F37e: 段取りの各行の「発注者の仕様書では」。描き直しと表の切り替えで残り、CSV と印刷に載り、保存しない。
// この環境にはブラウザが無いので、紙の出方は測れない。描いた HTML と CSS の決まり、作り物の DOM での動きを確かめる
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildHtml } from '../../build.mjs';
import { buildSchedule, buildScheduleDetail } from '../../src/schedule.mjs';
import { parseRulesFile } from '../../src/rules-load.mjs';
import { renderSchedule, scheduleNoteKey, SCHEDULE_NOTE_LABEL, SCHEDULE_NOTE_WARNING, esc } from '../../src/ui/view.mjs';
import { scheduleRows, toCsv, SCHEDULE_COLUMNS } from '../../src/export.mjs';
import { runPage } from '../acceptance/_helpers.mjs';

// 見本の条件(架空の工事)。ui-details の試験と同じ値
const COND = { orderer: 'public', direct: true, workType: 'other', contractAmount: 300000000, hasSubcontract: true, subcontractTotal: 60000000, license: 'tokutei', engineerQualification: 'kanri', engineerFullTime: 'yes', techExpert: 'yes' };
const FILE = fs.readFileSync(new URL('../../data/specs/wakayama_r0711_rows.json', import.meta.url), 'utf8');
const shell = fs.readFileSync(new URL('../../src/ui/shell.html', import.meta.url), 'utf8');
const css = shell.match(/<style>([\s\S]*?)<\/style>/)[1].replace(/\/\*[\s\S]*?\*\//g, '');
const html = buildHtml();
const NATIONAL = buildScheduleDetail(COND).rows;
const WAKAYAMA = buildScheduleDetail({ direct: true }, parseRulesFile(FILE)).rows;

// HTML の読み取りと同じに、textarea の直後の改行を1つ捨てて、書いてある文を取り出す
const unesc = (s) => s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&');
function noteIn(h, key) {
  const m = h.match(new RegExp('data-note-key="' + esc(key).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '">([\\s\\S]*?)</textarea>'));
  return m ? unesc(m[1]).replace(/^\n/, '') : null;
}
// 画面で書くのと同じに、枠へ input を送る。mirror は隣の印刷用の要素の代わり
function write(page, key, value, mirror = {}) {
  page.el('schedule-result').dispatchEvent({
    type: 'input',
    target: { value, classList: { contains: (c) => c === 'schedule-note' }, getAttribute: (k) => (k === 'data-note-key' ? key : null), nextElementSibling: mirror },
  });
  return mirror;
}
async function loadTable(page) {
  const input = page.el('rules-load');
  input.files = [{ size: FILE.length, text: async () => FILE }];
  input.dispatchEvent({ type: 'change' });
  await new Promise((r) => setTimeout(r, 0));
}
// 同じ id の行は両方の例にある(下の試験)。切り替えの試験は、片方にしか無い行で確かめる
const nationalKeys = new Set(NATIONAL.map(scheduleNoteKey));
const wakayamaKeys = new Set(WAKAYAMA.map(scheduleNoteKey));
const keyN = [...nationalKeys].find((k) => !wakayamaKeys.has(k));
const keyW = [...wakayamaKeys].find((k) => !nationalKeys.has(k));
const keyBoth = 'start-plan';

test('鍵: 行の id を使い、id が無い読み込んだ行は 箇所|何を を使う。1つの表の中では行ごとに別の鍵', () => {
  assert.equal(scheduleNoteKey({ id: 'a', what: 'x', basis: { section: '1' } }), 'a');
  assert.equal(scheduleNoteKey({ id: '', what: 'x', basis: { section: '1' } }), '1|x');
  assert.equal(new Set(buildSchedule(COND).map(scheduleNoteKey)).size, buildSchedule(COND).length);
  for (const rows of [NATIONAL, WAKAYAMA]) assert.equal(new Set(rows.map(scheduleNoteKey)).size, rows.length);
});

test('表示: 各行に6列目の書き込みの欄があり、注意が欄より先に出る。欄の名前は読み上げに渡る', () => {
  const h = renderSchedule(NATIONAL, buildScheduleDetail(COND));
  assert.equal((h.match(/<textarea class="schedule-note/g) ?? []).length, NATIONAL.length);
  assert.equal((h.match(new RegExp('<td data-label="' + SCHEDULE_NOTE_LABEL + '">', 'g')) ?? []).length, NATIONAL.length);
  assert.ok(h.includes('<th>' + SCHEDULE_NOTE_LABEL + '</th>'));
  assert.ok(h.includes('aria-label="' + SCHEDULE_NOTE_LABEL + ': ' + esc(NATIONAL[0].what) + '"'));
  const warn = h.indexOf(esc(SCHEDULE_NOTE_WARNING));
  assert.ok(warn > 0 && warn < h.indexOf('<table') && warn < h.indexOf('<textarea'), '注意が欄より先に出ていない');
  // 消えること → 残し方 の順
  assert.ok(SCHEDULE_NOTE_WARNING.indexOf('ページを閉じると消えます') < SCHEDULE_NOTE_WARNING.indexOf('残すときは印刷か CSV で書き出してください'));
  assert.match(SCHEDULE_NOTE_WARNING, /原文と照らしていません/);
  // 行が無いときは欄も注意も出さない
  assert.ok(!renderSchedule([]).includes('schedule-note'));
});

test('書いた文はそのまま戻り、タグにならない。先頭の改行も消えない', () => {
  const text = '\n<img src=x onerror=alert(1)>"\'&\n第3条';
  const h = renderSchedule(NATIONAL, {}, new Map([[keyN, text]]));
  assert.ok(!h.includes('<img'));
  assert.equal(noteIn(h, keyN), text);
  assert.equal(noteIn(h, scheduleNoteKey(NATIONAL.find((r) => scheduleNoteKey(r) !== keyN))), '');
});

test('書き込みのある区切りと大きな折りたたみは、描き直しても開いている', () => {
  const later = NATIONAL.find((r) => r.phase !== NATIONAL[0].phase);
  const plain = renderSchedule(NATIONAL);
  assert.ok(plain.includes('<details class="schedule-table">'));
  const h = renderSchedule(NATIONAL, {}, new Map([[scheduleNoteKey(later), 'メモ']]));
  assert.ok(h.includes('<details class="schedule-table" open>'));
  assert.equal((h.match(/<details class="schedule-phase" open>/g) ?? []).length, 2);
  // 空白だけの欄は書き込みとして数えない
  assert.equal((renderSchedule(NATIONAL, {}, new Map([[scheduleNoteKey(later), '  \n']])).match(/<details class="schedule-phase" open>/g) ?? []).length, 1);
});

test('画面: 書いて「確認する」を押し直しても、条件を変えて出し直しても残る', async () => {
  const page = runPage(html);
  await page.click('sample-load');
  write(page, keyN, '特記 第3条、着手の14日前');
  assert.equal(noteIn(page.el('schedule-result').innerHTML, keyN), '', '描き直す前の文字は枠の HTML には無いはず');
  await page.click('bid-run');
  assert.equal(noteIn(page.el('schedule-result').innerHTML, keyN), '特記 第3条、着手の14日前');
  await page.set('contract-amount', '400,000,000');
  await page.click('bid-run');
  assert.equal(noteIn(page.el('schedule-result').innerHTML, keyN), '特記 第3条、着手の14日前');
  // 消して描き直すと空に戻る(消したものを持ち続けない)
  write(page, keyN, '');
  await page.click('bid-run');
  assert.equal(noteIn(page.el('schedule-result').innerHTML, keyN), '');
});

test('画面: 例を切り替えても残り、戻すと出る。今の一覧に無い行の書き込みは件数を出す', async () => {
  const page = runPage(html);
  await page.click('sample-load');
  assert.ok(!page.el('schedule-result').innerHTML.includes('schedule-note-hidden'));
  write(page, keyN, '国の行のメモ');
  await loadTable(page);
  let h = page.el('schedule-result').innerHTML;
  assert.equal(noteIn(h, keyN), null, '国の例の行が出たまま');
  assert.equal(noteIn(h, keyW), '');
  assert.match(h, /schedule-note-hidden">今の一覧に出ていない行の書き込みが 1件あります/);
  assert.ok(h.indexOf('schedule-note-hidden') < h.indexOf('<details class="schedule-table"'), '閉じた折りたたみの外に出す');
  write(page, keyW, '県の行のメモ');
  await page.click('rules-clear');
  h = page.el('schedule-result').innerHTML;
  assert.equal(noteIn(h, keyN), '国の行のメモ');
  assert.match(h, /書き込みが 1件あります/);
  await loadTable(page);
  assert.equal(noteIn(page.el('schedule-result').innerHTML, keyW), '県の行のメモ');
});

test('画面: 同じ id の行は同じ務めの行なので、例を切り替えても同じ書き込みが出る', async () => {
  assert.ok(nationalKeys.has(keyBoth) && wakayamaKeys.has(keyBoth));
  const page = runPage(html);
  await page.click('sample-load');
  write(page, keyBoth, '両方に出るメモ');
  await loadTable(page);
  const h = page.el('schedule-result').innerHTML;
  assert.equal(noteIn(h, keyBoth), '両方に出るメモ');
  // 今の一覧に出ている行なので、隠れた件数には数えない
  assert.ok(!h.includes('schedule-note-hidden'));
});

test('画面: 「自分の工事で入れ直す」でも書き込みは黙って消えない', async () => {
  const page = runPage(html);
  await page.click('sample-load');
  write(page, keyN, '見本で書いたメモ');
  await page.click('sample-reenter');
  await page.click('sample-load');
  assert.equal(noteIn(page.el('schedule-result').innerHTML, keyN), '見本で書いたメモ');
});

test('CSV: 列の名前と書いた文が載る。改行や区切りを含んでも1つの欄。今の一覧に無い行は載せない', async () => {
  assert.equal(SCHEDULE_COLUMNS.at(-1), SCHEDULE_NOTE_LABEL);
  const text = '第3条,14日前\n"要"確認';
  const rows = scheduleRows(NATIONAL, new Map([[keyN, text], ['無い行', 'x']]));
  assert.equal(rows.length, NATIONAL.length + 1);
  assert.ok(rows.every((r) => r.length === SCHEDULE_COLUMNS.length));
  const at = NATIONAL.findIndex((r) => scheduleNoteKey(r) === keyN) + 1;
  assert.equal(rows[at].at(-1), text);
  assert.ok(rows.slice(1).every((r, i) => i + 1 === at || r.at(-1) === ''));
  assert.ok(toCsv(rows).includes('"第3条,14日前\n""要""確認"'));
  assert.ok(!toCsv(rows).includes('無い行'));
  // 2つ目の引数が無くても動く
  assert.ok(scheduleRows(NATIONAL).slice(1).every((r) => r.at(-1) === ''));

  const page = runPage(html);
  await page.click('sample-load');
  write(page, keyN, '画面から書いたメモ');
  await page.click('schedule-csv-btn');
  assert.equal(page.blobs.length, 1);
  const csv = await page.blobs[0].text();
  assert.ok(csv.split('\r\n')[0].endsWith(',' + SCHEDULE_NOTE_LABEL));
  assert.ok(csv.includes('画面から書いたメモ'));
});

test('印刷: 欄は紙に出さず、長い文も切れない別の要素で列に載る。書いた文がその場で移る', async () => {
  const h = renderSchedule(NATIONAL, {}, new Map([[keyN, '1行目\n2行目<b>']]));
  assert.ok(h.includes('<div class="print-only schedule-note-print">1行目\n2行目&lt;b&gt;</div>'));
  assert.ok(h.includes('<textarea class="schedule-note no-print"'));
  assert.match(css, /\.schedule-note-print \{ white-space: pre-wrap; \}/);
  // 画面では隠し、紙では出す
  assert.match(css, /\n {2}\.print-only \{ display: none; \}/);
  const print = css.slice(css.indexOf('@media print'));
  assert.match(print, /\.print-only \{ display: block; \}/);
  assert.match(print, /\.no-print \{ display: none !important; \}/);
  // 注意は画面のためのものなので紙に出さない
  assert.ok(h.includes('class="note no-print schedule-note-warning"'));

  const page = runPage(html);
  await page.click('sample-load');
  assert.equal(write(page, keyN, '紙に出すメモ').textContent, '紙に出すメモ');
});

test('保存しない: 書き込みはメモリの Map だけで、保存の API と cookie を使わない', () => {
  const app = fs.readFileSync(new URL('../../src/ui/app.mjs', import.meta.url), 'utf8');
  assert.match(app, /const scheduleNotes = new Map\(\);/);
  assert.ok(!/localStorage|sessionStorage|indexedDB|document\.cookie|\.cookie\b|caches\.|navigator\.storage/.test(html));
});

test('07 の決まり: 外部の読み込み・通信が無く、断り書きと PDL を出し、index.html が今の src と同じ', () => {
  assert.ok(!/<(script|link|img|iframe)\b[^>]*\b(src|href)=["']https?:/i.test(html));
  assert.ok(!/\bfetch\(|XMLHttpRequest|WebSocket/.test(html));
  assert.match(html, /connect-src 'none'/);
  assert.ok(html.includes('id="disclaimer"'));
  assert.ok(html.includes('PDL1.0'));
  assert.equal(fs.readFileSync(new URL('../../index.html', import.meta.url), 'utf8'), html, 'index.html を作り直していない');
});

// F54b: スマホ幅だけの注記2つと、空の知らせの欄
test('F54b: 2つの注記は phone-only と no-print を持ち、決まった位置にあり、言わない語が無い', () => {
  const FIELD = '<p id="field-note" class="note phone-only no-print">この画面は外へ送らず、入れた内容を残しません。閉じたり読み直されたりすると消え、ほかの端末にも出ません。残すときは下の「PDF で保存・印刷」か CSV で。</p>';
  const PC = '<p id="panel-3-pc-note" class="note phone-only no-print">書類の点検はパソコンの方が楽です(台帳の文を貼る・Excel を読む・印刷)。スマホでも使えます。</p>';
  assert.ok(html.includes('<div id="result-top" hidden></div>\n' + FIELD + '\n<details class="fold" id="bid-fold">'), '#field-note が #result-top と #bid-fold の間に無い');
  const panel3 = html.slice(html.indexOf('<section id="panel-3"'));
  const firstH2 = panel3.match(/<h2[^>]*>[\s\S]*?<\/h2>/);
  assert.equal(firstH2[0], '<h2>2. 施工体制台帳の点検</h2>');
  assert.ok(panel3.slice(firstH2.index + firstH2[0].length).startsWith('\n' + PC), '#panel-3-pc-note が #panel-3 の最初の h2 の直後に無い');
  for (const note of [FIELD, PC]) {
    assert.doesNotMatch(note, /事故を防げる|指名停止を防ぐ|初心者でもできる|あらゆる公共工事に対応|積算できる|電波/);
  }
});

test('F54b: #drop-status は入口の通信しない注記の下にある空の欄で、紙に出さない', () => {
  assert.match(html, /この端末の中だけで扱います。<\/p>\n<p id="drop-status" class="no-print" aria-live="polite"><\/p>\n<section id="panel-1" hidden>/);
  assert.match(css, /p\[aria-live\]:not\(:empty\)/);
});

test('F54b: 結果の段取りの件数の行は、表が開いていても閉じていても合う文にする', () => {
  const lead = renderSchedule(NATIONAL, buildScheduleDetail(COND));
  assert.ok(lead.includes('表は下の「受注後の段取り」にあります。'));
});

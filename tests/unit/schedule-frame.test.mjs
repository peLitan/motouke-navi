// F87b: 受注後の段取りの枠をページの残りの高さいっぱいにし、表を開いて見せる。説明と切り替えは閉じた折りたたみへ移す。
// ブラウザが無いので、枠の高さとあふれは測らない(Edge の確かめは統括)。ここでは組み立てた画面の HTML・CSS と、ページを開いたときの details の開閉と、紙に出る文を見る
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHtml } from '../../build.mjs';
import { runPage } from '../acceptance/_helpers.mjs';
import { openDetailsForPrint, restoreDetailsAfterPrint } from '../../src/ui/app.mjs';
import { renderSchedule } from '../../src/ui/view.mjs';

const html = buildHtml();
const body = html.slice(html.indexOf('<body>')).replace(/<script\b[\s\S]*?<\/script>/g, '');
const css = html.match(/<style>([\s\S]*?)<\/style>/)[1].replace(/\/\*[\s\S]*?\*\//g, '');
const mediaBlocks = (head) => css.split(/^ {2}(?=@media )/m).filter((s) => s.startsWith(head + ' {')).map((s) => s.slice(0, s.search(/^ {2}\}/m)));
const screenCss = mediaBlocks('@media screen').join('\n');
const narrowCss = mediaBlocks('@media screen and (max-width: 40rem)').join('\n');
const printCss = mediaBlocks('@media print').join('\n');

const STEPS_TO_SCHEDULE = 3; // 結果の1ページ目から段取りのページまでの「次へ」の回数
const pageHtml = body.slice(body.indexOf('id="pg-2-schedule"'), body.indexOf('<div class="pg', body.indexOf('id="pg-2-schedule"')));
// 組み立てた HTML の中で、id の要素を囲む折りたたみの id
function foldsAround(id) {
  const stack = [];
  for (const m of pageHtml.slice(0, pageHtml.indexOf('id="' + id + '"')).matchAll(/<details\b([^>]*)>|<\/details>/g)) {
    if (m[0] === '</details>') stack.pop();
    else stack.push(m[1].match(/id="([^"]+)"/)?.[1] ?? '');
  }
  return stack;
}
// runPage の要素は HTML の中の details を持たないので、ブラウザと同じく描き直すたびに新しい details を作る形を足す
function watchTable(page) {
  const out = page.el('schedule-result');
  const made = [];
  const descriptor = Object.getOwnPropertyDescriptor(out, 'innerHTML');
  Object.defineProperty(out, 'innerHTML', {
    get: descriptor.get,
    set(v) {
      descriptor.set.call(out, v);
      const m = String(v).match(/<details class="schedule-table"([^>]*)>/);
      made.push(m ? { open: /\bopen\b/.test(m[1]) } : null);
    },
  });
  out.querySelector = (sel) => (sel === 'details.schedule-table' ? made.at(-1) : null);
  return () => made.at(-1);
}
async function sample() {
  const page = runPage(html);
  const table = watchTable(page);
  await page.click('sample-load');
  await page.click('confirm-go');
  return { page, table };
}
async function sampleOnSchedule() {
  const made = await sample();
  for (let i = 0; i < STEPS_TO_SCHEDULE; i++) await made.page.click('pg-next');
  assert.equal(made.page.el('pg-2-schedule').hidden, false);
  return made;
}

const ROWS = [
  { phase: 'start', when: '着手前', what: '架空の書類を出す', to: '監督職員', status: 'required', basis: { doc: '架空の仕様書', section: '1-1', quote: '架空の原文', version: '令和9年1月' } },
  { phase: 'finish', when: '完成時', what: '架空の報告をする', to: '監督職員', status: 'required', basis: { doc: '架空の仕様書', section: '1-2', quote: '架空の原文その2', version: '令和9年1月' } },
];
const NOTES = new Map([['架空のキー', '架空の書き込み']]);
const DETAIL = { rows: ROWS, skipped: [], exampleLabel: '国の直轄の例', notes: ['架空の注意その1', '架空の注意その2'] };
// 紙に出ない物(注意の折りたたみの見出しと、no-print の注意の行)を除く
const paperOf = (h) => h
  .replace(/<details class="fold" id="schedule-notes"><summary>[^<]*<\/summary>/, '')
  .replace('</details><details class="schedule-table"', '<details class="schedule-table"')
  .replace(/<p class="note no-print schedule-note-warning">[^<]*<\/p>/, '');

test('DOM の順: 見出し → 注記 → 読み込んだ表の知らせ → 閉じた #schedule-more → 枠 → 書き出し', () => {
  const marks = ['id="schedule-heading"', 'id="schedule-notice"', 'id="rules-file-on"', 'id="schedule-more"', 'id="work-kind-schedule"', 'id="awarded-notice"', 'id="rules-more"', 'id="schedule-about-fold"', 'id="schedule-frame"', 'id="schedule-csv-btn"', 'id="schedule-status"'];
  const at = marks.map((m) => pageHtml.indexOf(m));
  at.forEach((n, i) => { assert.ok(n >= 0, marks[i]); if (i) assert.ok(at[i - 1] < n, marks[i - 1] + ' → ' + marks[i]); });
  assert.match(pageHtml, /<details class="fold" id="schedule-more"><summary>この一覧について\(工種・例の切り替え・作り方\)<\/summary>/);
  for (const id of ['work-kind-schedule', 'awarded-notice', 'rules-more', 'schedule-about-fold']) assert.deepEqual(foldsAround(id), ['schedule-more'], id);
  assert.match(pageHtml, /<\/details>\n<\/details>\n<div class="ref-frame" id="schedule-frame">/);
});

test('#schedule-notice と #rules-file-on は折りたたみの外で、閉じていても見える', () => {
  for (const id of ['schedule-notice', 'rules-file-on', 'schedule-frame', 'schedule-result', 'schedule-csv-btn', 'schedule-status']) assert.deepEqual(foldsAround(id), [], id);
});

test('題の「(着手から完成・引き渡しまで)」は幅 40rem 以下で読み上げに残して画面の外へ置く', () => {
  assert.match(pageHtml, /<h3 id="schedule-heading" tabindex="-1">受注後の段取り<span class="heading-more">\(着手から完成・引き渡しまで\)<\/span><\/h3>/);
  const rule = narrowCss.match(/#schedule-heading \.heading-more \{([^{}]*)\}/);
  assert.ok(rule, '幅 40rem 以下の決まりが無い');
  assert.match(rule[1], /position: absolute/);
  assert.match(rule[1], /clip-path: inset\(50%\)/);
  assert.doesNotMatch(rule[1], /display: none/);
  assert.ok(!printCss.includes('heading-more'), '紙の決まりで題の文を隠している');
});

test('枠の上下を詰める規則は画面だけで、枠は 12rem より低くならない', () => {
  assert.match(screenCss, /#schedule-more \{[^{}]*flex: none[^{}]*\}/);
  assert.match(screenCss, /#schedule-more \{[^{}]*margin: 0[^{}]*\}/);
  assert.match(screenCss, /#schedule-frame \{[^{}]*min-height: 12rem[^{}]*\}/);
  assert.match(screenCss, /#pg-2-schedule > \.export \{[^{}]*flex: none[^{}]*display: flex[^{}]*\}/);
  assert.match(screenCss, /#schedule-result details\.schedule-table > summary \{ display: none; \}/);
  for (const s of ['#schedule-more', '#schedule-frame', '#schedule-result details.schedule-table >']) assert.ok(!printCss.includes(s), s + ' が紙の決まりにある');
});

test('pg-2-schedule を開くと表が開き、見本の表は閉じて描かれる', async () => {
  const { page, table } = await sample();
  assert.equal(table().open, false, '閉じて始まる');
  await page.click('pg-next');
  assert.equal(table().open, false, 'ほかのページで表を開いている');
  for (let i = 1; i < STEPS_TO_SCHEDULE; i++) await page.click('pg-next');
  assert.equal(page.el('pg-2-schedule').hidden, false);
  assert.equal(table().open, true);
});

test('例を切り替えても表は開いたまま。ほかのページで描き直したときは開かない', async () => {
  const { page, table } = await sampleOnSchedule();
  const first = table();
  assert.equal(first.open, true);
  await page.click('rules-wakayama');
  assert.notEqual(table(), first, '描き直していない');
  assert.equal(page.el('pg-2-schedule').hidden, false);
  assert.equal(table().open, true, '和歌山県の例');
  await page.click('rules-national');
  assert.equal(table().open, true, '国の直轄の例');
  await page.click('pg-back');
  assert.equal(page.el('pg-2-schedule').hidden, true);
  await page.click('rules-wakayama');
  assert.equal(table().open, false, 'ほかのページで開いている');
  await page.click('pg-next');
  assert.equal(table().open, true, 'ページに戻って開かない');
});

test('もう受注した方: 表が開き、右の席は「条件を入れる」のまま、注記は見える', async () => {
  const page = runPage(html);
  const table = watchTable(page);
  await page.click('entry-awarded');
  assert.equal(page.el('pg-2-schedule').hidden, false);
  assert.equal(table().open, true);
  assert.equal(page.el('awarded-conditions').hidden, false);
  assert.equal(page.el('awarded-notice').hidden, false);
  assert.ok(page.el('schedule-notice').textContent.length > 0);
  await page.click('rules-wakayama');
  assert.equal(table().open, true);
});

test('全部の行の「全部を印刷する」と CSV と #schedule-status は今のまま働く', async () => {
  const page = runPage(html);
  await page.click('entry-awarded');
  await page.click('awarded-print-all');
  assert.equal(page.printed.count, 1);
  assert.match(page.el('schedule-status').textContent, /結果がまだありません/);
  const { page: done } = await sampleOnSchedule();
  assert.match(done.el('schedule-status').textContent, /^段取り \d+行。$/);
  assert.equal(done.el('pg-next').hidden, false, '右の席は次へのまま');
  const blobs = done.blobs.length;
  await done.click('schedule-csv-btn');
  assert.equal(done.blobs.length, blobs + 1);
});

test('枠の外にファイルを置くと、知らせの欄が見えるよう外の折りたたみも開く', async () => {
  const { page } = await sampleOnSchedule();
  assert.ok(!page.el('schedule-more').open);
  const file = { name: 'a.json', size: 2, text: async () => '{}' };
  page.el('schedule-heading').dispatchEvent({ type: 'drop', bubbles: true, target: page.el('schedule-heading'), preventDefault() {}, stopPropagation() {}, dataTransfer: { files: [file], types: ['Files'] } });
  await new Promise((r) => setImmediate(r));
  assert.match(page.el('rules-status').textContent, /点線の枠/);
  assert.equal(page.el('rules-more').open, true, '枠のある折りたたみ');
  assert.equal(page.el('schedule-more').open, true, '外の折りたたみが閉じたままだと知らせの欄が見えない');
});

test('renderSchedule の既定の出力は閉じたままで、注意の折りたたみが無い', () => {
  const out = renderSchedule(ROWS, DETAIL, NOTES);
  assert.equal(out, renderSchedule(ROWS, DETAIL, NOTES, {}));
  assert.equal(out, renderSchedule(ROWS, DETAIL, NOTES, { foldNotes: false }));
  assert.ok(!out.includes('id="schedule-notes"'));
  assert.match(out, /<details class="schedule-table"><summary>受注後の段取り\(2件\)<\/summary><p class="note no-print schedule-note-warning">/);
});

test('foldNotes: 注意は折りたたみの中に入り、紙の文と順は既定と同じ', () => {
  const plain = renderSchedule(ROWS, DETAIL, NOTES);
  const fold = renderSchedule(ROWS, DETAIL, NOTES, { foldNotes: true });
  const box = fold.match(/<details class="fold" id="schedule-notes"><summary>この表の注意\(書いた欄はページを閉じると消えます\)<\/summary>([\s\S]*?)<\/details><details class="schedule-table"/);
  assert.ok(box, '注意の折りたたみが表の前に無い');
  assert.match(box[1], /^<p class="note no-print schedule-note-warning">/);
  assert.ok(box[1].includes('架空の注意その1') && box[1].includes('架空の注意その2'));
  assert.ok(!fold.match(/<details class="schedule-table"[\s\S]*/)[0].includes('schedule-note-warning'), '注意が2つある');
  assert.ok(plain.includes('架空の注意その1'), '既定の出力に注意が無い(試験の値の誤り)');
  assert.equal(paperOf(fold), paperOf(plain));
});

test('foldNotes: 行が無いときは折りたたみを作らず、注意はそのまま見える', () => {
  const empty = { ...DETAIL, rows: [] };
  assert.equal(renderSchedule([], empty, NOTES, { foldNotes: true }), renderSchedule([], empty, NOTES));
});

test('app は foldNotes を渡す: 見本の結果に注意の折りたたみが出る', async () => {
  const { page } = await sample();
  assert.ok(page.el('schedule-result').innerHTML.includes('id="schedule-notes"'));
});

test('紙: #schedule-more と #schedule-notes は見出しが隠れて中の文が出る。終わると閉じ直す', () => {
  const out = pageHtml + renderSchedule(ROWS, DETAIL, NOTES, { foldNotes: true });
  const list = [...out.matchAll(/<details\b([^>]*)>/g)].map((m) => ({ id: m[1].match(/\bid="([^"]+)"/)?.[1], cls: m[1].match(/class="([^"]*)"/)?.[1], open: false }));
  for (const id of ['schedule-more', 'schedule-notes']) {
    const d = list.find((x) => x.id === id);
    assert.ok(d, id + ' が無い');
    assert.equal(d.cls, 'fold', id + ' は紙に出す');
  }
  openDetailsForPrint({ querySelectorAll: (sel) => (sel === 'details' ? list : []) });
  assert.ok(list.every((d) => d.open));
  restoreDetailsAfterPrint();
  assert.ok(list.every((d) => !d.open));
  assert.match(printCss, /details\.fold > summary \{ display: none; \}/);
  assert.ok(!/#schedule-(more|notes)[^{}]*\{[^{}]*display: none/.test(printCss), '紙の決まりで折りたたみを隠している');
  // 工種の行と作り方の文は紙に出す物で、紙に出ない #rules-more の中に入れていない
  for (const id of ['work-kind-schedule', 'schedule-about']) assert.ok(!foldsAround(id).includes('rules-more'), id);
});

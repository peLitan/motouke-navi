// F83a4: 結果と段3 では、常に出る注意を1行にまとめ、「くわしく」で今の全文を開く。入口と段1 と紙は今の全文のまま。
// この環境にはブラウザが無いので、見える・見えないは実物の HTML と CSS の決まりを読んで数え、段の切り替えは実物の app.mjs を runPage で動かす
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHtml } from '../../build.mjs';
import { runPage } from '../acceptance/_helpers.mjs';
import { showPanel, showEntry, openDetailsForPrint } from '../../src/ui/app.mjs';

const html = buildHtml();
const body = html.slice(html.indexOf('<body>')).replace(/<script\b[\s\S]*?<\/script>/g, '');
const css = html.match(/<style>([\s\S]*?)<\/style>/)[1].replace(/\/\*[\s\S]*?\*\//g, '');
const printCss = css.match(/@media print \{([\s\S]*)\n {2}\}/)[1];
const text = (h) => h.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

const FULL = '指摘の候補です。抜けが無いことの保証や合否ではありません。最終の確認は担当者と発注者との協議で行ってください';
const SHORT = '指摘の候補です。最終の確認は担当者と発注者との協議で行ってください';
const FOLDED = ['disclaimer', 'lead']; // たたむ物の全部。見ていない法令の1行と通信の行は入口の「くわしく」へ、法令の一覧は使った資料へ移した(F86c)

// 1行の折りたたみと、それを開いていないときだけ働く決まり
const row = body.match(/<details\b[^>]*id="notice-more"[^>]*>([\s\S]*?)<\/details>/);
const OFF = '#notice-more:not([hidden]):not([open])';
const screenBlock = css.match(/@media screen \{([\s\S]*?)\n {2}\}/)?.[1] ?? '';
const hideRule = screenBlock.match(/([^{}]+)\{\s*display: none;\s*\}/);
const hideSelectors = hideRule ? hideRule[1].split(',').map((s) => s.trim()) : [];
// 行の今の形で消える物。決まりの選び方の前半(行の条件)を、実物の CSS の文のまま当てはめる
function hiddenIds(rowShown, rowOpen) {
  return hideSelectors.filter((sel) => {
    const head = sel.split('~')[0];
    return !(head.includes(':not([hidden])') && !rowShown) && !(head.includes(':not([open])') && rowOpen);
  }).map((sel) => sel.match(/#([\w-]+)$/)[1]);
}

// 親の直下の子だけを、開始タグの id つきで返す(入れ子の中の物は数えない)
function childrenOf(fragment) {
  const kids = [];
  let depth = 0;
  for (const m of fragment.matchAll(/<(\/?)([a-zA-Z][\w-]*)\b((?:[^>"]|"[^"]*")*?)(\/?)>/g)) {
    if (/^(br|hr|img|input|meta|link)$/i.test(m[2]) || m[4]) continue;
    if (m[1]) { depth -= 1; continue; }
    if (depth === 0) kids.push(m[3].match(/\sid="([^"]+)"/)?.[1] ?? m[2]);
    depth += 1;
  }
  return kids;
}
const inside = (open, end) => { const from = body.indexOf(open) + open.length; return body.slice(from, body.indexOf(end, from)); };
const PAGE_KIDS = childrenOf(inside('<div class="wrap page">', '<main id="main">'));
const MAIN_KIDS = childrenOf(inside('<main id="main">', '<section id="panel-1"'));

// 結果の段の「結果」の見出しより上で、見える塊を数える。帯の下の .wrap.page の直下の子と、main の直下の子。行は隠れていれば数えない
function blocksAboveResult(rowShown) {
  const hidden = new Set(hiddenIds(rowShown, false));
  return [...PAGE_KIDS, ...MAIN_KIDS].filter((id) => id !== 'entry-more' && (id === 'notice-more' ? rowShown : !hidden.has(id)));
}

test('1行の形: 文は今の1文目と終わりの文の同じ語で、「くわしく」が付く。入れ物は閉じて始まり、紙には出ない', () => {
  assert.ok(row, '1行の折りたたみが無い');
  const open = row[0].match(/<details\b[^>]*>/)[0];
  assert.match(open, /\shidden[\s>]/, '開いた直後(入口)は隠れていない');
  assert.doesNotMatch(open, /\sopen[\s>]/, '最初から開いている');
  assert.match(open, /class="[^"]*no-print/, '紙に出る');
  const sum = row[1].match(/<summary>([\s\S]*?)<\/summary>/);
  assert.ok(sum, '見出しが無い');
  assert.equal(text(sum[1]), SHORT + '(くわしく)');
  // 短い形は、今の全文の語だけでできている
  const [first, , last] = FULL.split(/(?<=。)/);
  assert.equal(SHORT, first + last);
  // 中の文は置かない(全文を2か所に持たない)
  assert.equal(text(row[1].replace(/<summary>[\s\S]*?<\/summary>/, '')), '');
});

test('全文はそのまま残り、言い回しを変えていない', () => {
  assert.equal(text(body.match(/<p class="disclaimer" id="disclaimer">([\s\S]*?)<\/p>/)[1]), FULL);
  assert.equal(text(body.match(/<p class="scope-not-line" id="scope-not-line">([\s\S]*?)<\/p>/)[1]), '見ていない法令・資料があります(条例・契約書・特記仕様書・省令など)。別に確かめてください。');
  assert.equal(text(body.match(/<p class="no-print note" id="offline-note">([\s\S]*?)<\/p>/)[1]), 'この画面は外部と通信しません(ページの設定で通信先を「無し」にしています)。入れた内容はこの端末の中だけで扱います。');
  assert.match(body, /<div id="can-do-more"><p class="can-do-head"><strong>このツールでできること<\/strong><\/p>/);
  assert.match(body, /<details class="scope" id="scope"><summary>このツールが見ている法令・資料と、見ていない法令・資料\(一覧\)<\/summary>/);
});

test('たたむ決まり: 2つの物を1つの決まりで消し、行が見えて閉じているときだけ働く', () => {
  assert.equal(hideSelectors.length, FOLDED.length);
  for (const id of FOLDED) assert.ok(hideSelectors.some((s) => s === OFF + ' ~ #' + id || s === OFF + ' ~ main #' + id), id + ' の決まりが無い');
  // 兄弟の結び(~)が効く並び: 行が先頭で、2つは同じ親の直下
  assert.deepEqual(PAGE_KIDS, ['notice-more', 'disclaimer', 'lead']);
  // 入口の「くわしく」は段のページで隠す(行の形によらない)
  assert.match(css, /body\.in-pages #entry-more \{ display: none; \}/);
  assert.ok(MAIN_KIDS.includes('entry-more'));
  // 紙の決まりの中には消す決まりを置かない(画面だけの決まり)
  assert.ok(!printCss.includes('notice-more'), '紙の決まりの中で行を扱っている');
});

test('段2・段3 で1行の形、入口と段1 と入力の確かめで全文(実物の showPanel・showEntry)', () => {
  const els = {};
  const doc = { getElementById: (id) => (els[id] ??= { hidden: id === 'notice-more', setAttribute() {}, removeAttribute() {}, focus() {} }) };
  const shown = () => !els['notice-more'].hidden;
  for (const n of [1, 'confirm']) { showPanel(doc, n); assert.equal(shown(), false, '段 ' + n); }
  for (const n of [2, 3]) { showPanel(doc, n); assert.equal(shown(), true, '段 ' + n); }
  showPanel(doc, 1);
  assert.equal(shown(), false, '段1 に戻ったとき');
  showPanel(doc, 3);
  showEntry(doc);
  assert.equal(shown(), false, '入口に戻ったとき');
});

test('画面の道: 入口 → 段1 → 確かめ → 結果 → 段3 → 段1 → 入口 で形が変わる(index.html を動かす)', async () => {
  const page = runPage();
  const row2 = () => page.el('notice-more');
  assert.equal(row2().hidden, true, '開いた直後');
  await page.click('entry-bid');
  assert.equal(page.el('panel-1').hidden, false);
  assert.equal(row2().hidden, true, '段1');
  await page.click('bid-run');
  assert.equal(page.el('panel-confirm').hidden, false);
  assert.equal(row2().hidden, true, '入力の確かめ');
  await page.click('confirm-go');
  assert.equal(page.el('panel-2').hidden, false);
  assert.equal(row2().hidden, false, '結果');
  await page.click('next-step-3');
  assert.equal(page.el('panel-3').hidden, false);
  assert.equal(row2().hidden, false, '段3');
  await page.click('pg-back'); // F86b: 進み具合は押せないので下の帯で戻る(書類 → 結果 → 確かめ → 条件)
  assert.equal(row2().hidden, false, '結果に戻ったとき');
  for (let i = 0; i < 6; i++) await page.click('pg-back'); // F86d: 結果は7ページなので、最後のページから1ページ目まで戻る
  await page.click('pg-back');
  assert.equal(row2().hidden, true, '入力の確かめに戻ったとき');
  await page.click('confirm-back');
  assert.equal(row2().hidden, true, '段1 に戻ったとき');
  await page.click('bid-run');
  await page.click('confirm-go');
  await page.click('next-step-3');
  await page.click('entry-back');
  assert.equal(row2().hidden, true, '入口に戻ったとき');
  // もう受注した方の入口は、段1 を通らず結果の段を開く
  const awarded = runPage();
  await awarded.click('entry-awarded');
  assert.equal(awarded.el('notice-more').hidden, false, 'もう受注した方の入口');
});

test('見えるか: 行が隠れているか開いているときは全部見え、見えて閉じているときは2つとも消える', () => {
  assert.deepEqual(hiddenIds(false, false), []);
  assert.deepEqual(hiddenIds(true, true), []);
  assert.deepEqual(hiddenIds(true, false), FOLDED);
});

test('印刷: 消す決まりは画面だけなので全文が紙に出る。折りたたみは openDetailsForPrint で開く', () => {
  // @media screen の外に消す決まりが無い
  const outside = css.replace(/@media screen \{[\s\S]*?\n {2}\}/, '');
  assert.ok(!outside.includes('#notice-more:not'), '画面だけの決まりの外に消す決まりがある');
  // 全文の側の4つは、置き場所が変わっても紙から外れていない(通信の行は前から紙に出ない)
  assert.doesNotMatch(body.match(/<p class="disclaimer" id="disclaimer"[^>]*>/)[0], /no-print/);
  assert.doesNotMatch(body.match(/<p class="scope-not-line"[^>]*>/)[0], /no-print/);
  assert.doesNotMatch(body.match(/<div class="lead" id="lead">/)[0], /no-print/);
  assert.doesNotMatch(body.match(/<details class="scope" id="scope">/)[0], /no-print/);
  const a = { open: false, id: 'entry-more' }, b = { open: false, id: 'scope' };
  openDetailsForPrint({ querySelectorAll: () => [a, b] });
  assert.ok(a.open && b.open);
});

test('390 幅の結果: 「結果」の見出しより上の要素が今より少ない', () => {
  const now = blocksAboveResult(false), compact = blocksAboveResult(true);
  console.log('# 見出しより上: 今 ' + now.length + ' (' + now.join(', ') + ') → ' + compact.length + ' (' + compact.join(', ') + ')');
  assert.ok(compact.length < now.length, '減っていない');
  assert.deepEqual([now.length, compact.length], [4, 3], '見出しより上の塊の数が変わった');
  assert.ok(compact.includes('notice-more'), '短い注意が上に無い');
  for (const id of FOLDED) assert.ok(!compact.includes(id), id + ' が残っている');
});

// F87c: 幅 390 の結果の要点を、どの状態でも「次にすること」のボタンまで1画面に入れる。
// ブラウザが無いので、あふれとボタンの位置は測らない(Edge の確かめは統括)。ここでは組み立てた画面の CSS と、押したときの hidden と文を見る
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHtml } from '../../build.mjs';
import { runPage } from '../acceptance/_helpers.mjs';
import * as confirm from '../../src/ui/confirm.mjs';
import { renderResultTop } from '../../src/ui/view.mjs';
import { SAMPLE } from '../../src/sample.mjs';

const html = buildHtml();
const css = html.match(/<style>([\s\S]*?)<\/style>/)[1].replace(/\/\*[\s\S]*?\*\//g, '');
const mediaBlocks = (head) => css.split(/^ {2}(?=@media )/m).filter((s) => s.startsWith(head + ' {')).map((s) => s.slice(0, s.search(/^ {2}\}/m)));
const narrowCss = mediaBlocks('@media screen and (max-width: 40rem)').join('\n');
const printCss = mediaBlocks('@media print').join('\n');
// 幅の決まりのブロックを除いた CSS(ほかの幅と紙に効く規則)
const withoutNarrow = css.split(/^ {2}(?=@media )/m).filter((s) => !s.startsWith('@media screen and (max-width: 40rem) {')).join('');
const OFF_SCREEN = 'position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap;';
const ruleLine = (text, sel) => text.split('\n').map((l) => l.trim()).filter((l) => l.startsWith(sel + ' {'));

async function fill(fields) {
  const page = runPage(html);
  await page.click('entry-bid');
  for (const [id, v] of Object.entries(fields)) await page.set(id, v);
  await page.click('bid-run');
  await page.click('confirm-go');
  return page;
}

test('.stat-sub の文は結果の要点の DOM に残る', async () => {
  const page = runPage(html);
  await page.click('sample-load');
  await page.click('confirm-go');
  const subs = [...page.el('result-top').innerHTML.matchAll(/<span class="stat-sub">([^<]*)<\/span>/g)].map((m) => m[1]);
  assert.equal(subs.length, 3);
  assert.ok(subs.every((s) => s.length > 0), subs.join('|'));
});

test('.stat-sub を隠す規則は幅の決まりの中だけで、読み上げに残す形', () => {
  assert.deepEqual(ruleLine(narrowCss, '.stat-sub'), ['.stat-sub { ' + OFF_SCREEN + ' }']);
  assert.ok(!/\.stat-sub\b[^{}]*\{[^}]*(clip-path|position: absolute)/.test(withoutNarrow), '幅の決まりの外に隠す規則がある');
  assert.ok(!/\.stat-sub/.test(printCss), '紙の決まりに .stat-sub が入った');
  assert.ok(!/\.stat-sub\b[^{}]*\{[^}]*(display: none|visibility: hidden)/.test(css), '読み上げから消す規則がある');
});

test('幅の決まりの中でカードと次にすることの見出しを詰める', () => {
  assert.deepEqual(ruleLine(narrowCss, '.stats'), ['.stats { gap: 0.25rem; margin: 0.25rem 0 0.5rem; }']);
  assert.deepEqual(ruleLine(narrowCss, '.stat'), ['.stat { grid-template-columns: 4rem minmax(0, 1fr); padding: 0.25rem 0.75rem; }']);
  assert.deepEqual(ruleLine(narrowCss, '.next-title'), ['.next-title { font-size: 1rem; }']);
});

test('足す規則は幅の決まりの頭の後ろにあり、ブロックの頭は #ledger-input のまま', () => {
  const lines = narrowCss.split('\n').map((l) => l.trim()).filter(Boolean);
  assert.match(lines[1], /^#ledger-input \{/);
  for (const sel of ['.stats', '.stat', '.stat-sub', '.next-title']) assert.ok(lines.findIndex((l) => l.startsWith(sel + ' {')) > 1, sel);
});

test('1280 の見た目の規則を変えていない', () => {
  const outer = css.split('\n').filter((l) => /^ {2}\S/.test(l)).join('\n'); // @media の外の規則は字下げが2つ
  assert.deepEqual(ruleLine(outer, '.stats'), ['.stats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 1rem; list-style: none; margin: 0.75rem 0 1rem; padding: 0; }']);
  assert.deepEqual(ruleLine(outer, '.stat'), ['.stat { display: block; height: 100%; padding: 0.75rem 1rem; color: var(--ink); background: var(--paper); border: 1px solid var(--line); border-top: 6px solid var(--line); border-radius: 12px; box-shadow: var(--shadow); text-decoration: none; }']);
  assert.deepEqual(ruleLine(outer, '.stat-sub'), ['.stat-sub { display: block; color: var(--ink-2); }']);
  assert.deepEqual(ruleLine(outer, '.next-title'), ['.next-title { margin: 0; font-size: 1.1875rem; font-weight: bold; }']);
});

test('下に止まる決まりは1つのまま(position: sticky を足していない)', () => {
  assert.equal((css.match(/position: sticky/g) ?? []).length, 1);
});

test('conditionUnset: 3つのどれも入っていないときだけ true', () => {
  assert.equal(typeof confirm.conditionUnset, 'function');
  const { conditionUnset } = confirm;
  // 3つとも空
  assert.equal(conditionUnset({}), true);
  assert.equal(conditionUnset(), true);
  // 3つのうちどれか1つでも入れば false(どの1つでも)
  assert.equal(conditionUnset({ orderer: 'public' }), false);
  assert.equal(conditionUnset({ 'work-type': 'other' }), false);
  assert.equal(conditionUnset({ 'contract-amount': '10,000,000' }), false);
  // 「分からない」と読めない値は答えとして扱う(1行に出す物がある)
  assert.equal(conditionUnset({ orderer: 'unknown', 'work-type': 'unknown', 'contract-amount-unknown': true }), false);
  assert.equal(conditionUnset({ 'contract-amount': '<abc>' }), false);
  // 3つの外の欄は数えない
  assert.equal(conditionUnset({ license: 'tokutei', direct: true }), true);
});

test('#result-name: 見本は題を出す', async () => {
  const page = runPage(html);
  await page.click('sample-load');
  await page.click('confirm-go');
  assert.equal(page.el('result-name').hidden, false);
  assert.equal(page.el('result-name').textContent, SAMPLE.title);
});

test('#result-name: 1つでも入れば条件の1行を出す', async () => {
  for (const [fields, end] of [
    [{ orderer: 'public' }, '発注者 公共・工事の種類 まだ選んでいません・請負代金の見込み まだ入れていません'],
    [{ 'work-type': 'other' }, '発注者 まだ選んでいません・工事の種類 それ以外の工事・請負代金の見込み まだ入れていません'],
    [{ 'contract-amount': '10,000,000' }, '発注者 まだ選んでいません・工事の種類 まだ選んでいません・請負代金の見込み 10,000,000円(税込み)'],
  ]) {
    const page = await fill(fields);
    assert.equal(page.el('result-name').hidden, false, end);
    assert.equal(page.el('result-name').textContent, end);
  }
});

test('#result-name: 全部分からないのときは、分からないと出す', async () => {
  const page = await fill({ orderer: 'unknown', 'work-type': 'unknown', 'contract-amount-unknown': true });
  assert.equal(page.el('result-name').hidden, false);
  assert.equal(page.el('result-name').textContent, '発注者 分からない・工事の種類 分からない・請負代金の見込み 分からない');
});

test('#result-name: 空なら隠れ、入れ直すと出る。読めない金額のときは隠れない', async () => {
  const page = await fill({});
  assert.equal(page.el('result-name').hidden, true);
  await page.click('pg-back');
  await page.click('confirm-back');
  await page.set('orderer', 'private');
  await page.click('bid-run');
  await page.click('confirm-go');
  assert.equal(page.el('result-name').hidden, false);
  assert.ok(page.el('result-name').textContent.startsWith('発注者 民間・'));
  assert.equal((await fill({ 'contract-amount': '<abc>' })).el('result-name').hidden, false);
});

// 架空の項目の状態から作る。文もカードの数も、今の形のまま変えない
const STAT = (cls, num, lab, sub) => '<li><div class="stat stat-' + cls + '"><span class="stat-num">' + num + '</span><span class="stat-lab">' + lab + '</span><span class="stat-sub">' + sub + '</span></div></li>';
const NEXT = (title, sub, href, go) => '<div class="next-card no-print"><div class="next-text"><p class="next-title">次にすること: ' + title + '</p><p class="next-sub">' + sub + '</p></div><a class="next-go" href="#' + href + '">' + go + '</a></div>';
const BID = { items: [{ key: 'x', label: '架空の項目', status: 'required' }], checks: [] };

test('renderResultTop の出力が変わらない', () => {
  const cards = '<ul class="stats" aria-label="結果の件数(候補)">'
    + STAT('required', '● 1', '要るものの候補', '受注したら要るものの候補(項目)')
    + STAT('check', '! 0', '確認が要る点', '自分で確かめる点(件)')
    + STAT('safety', '▲ −', '安全の法令の候補', '問いに答えると出ます')
    + '</ul>';
  assert.equal(renderResultTop({ errors: ['x'] }), NEXT('金額の欄を直す', '読めない欄に印を付けました。直してから、もう一度「確認する」を押してください。', 'bid-form', '「条件を入れる」に戻る'));
  assert.equal(renderResultTop({ bid: BID }), cards + NEXT('書類を確かめる', '施工体制台帳と施工計画書の目次を貼ると、抜けの候補を出します。', 'panel-3', '書類を確かめる'));
  assert.equal(renderResultTop({ bid: BID, stale: true }), cards + NEXT('もう一度「確認する」を押す', '条件が変わりました。下の数は前の条件の結果です。', 'bid-run', '「条件を入れる」に戻る'));
});

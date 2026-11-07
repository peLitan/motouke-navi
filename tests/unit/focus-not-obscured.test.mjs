// F84g: 幅の狭い画面で、焦点のある物が下に止まる帯の裏に隠れない(WCAG 2.2 の 2.4.11 Focus Not Obscured)。
// scroll-padding-bottom は画面が動くときにしか効かない。押した後に上の知らせで物が動く所は、画面の側で入れ直す。
// この環境にはブラウザが無いので、位置は測れない。CSS の値と、入れ直しの呼び出しの順を確かめる
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildHtml } from '../../build.mjs';
import { runPage } from '../acceptance/_helpers.mjs';
import { printResult } from '../../src/ui/app.mjs';

const html = buildHtml();
const body = html.slice(html.indexOf('</style>'));
const shell = fs.readFileSync(new URL('../../src/ui/shell.html', import.meta.url), 'utf8');
const css = shell.match(/<style>([\s\S]*?)<\/style>/)[1].replace(/\/\*[\s\S]*?\*\//g, '');
const screenCss = css.replace(/@media print \{[\s\S]*\n {2}\}/, '');
const block = (head) => {
  const at = screenCss.indexOf(head + ' {');
  assert.ok(at >= 0, head + ' が無い');
  const from = at + head.length + 2;
  return screenCss.slice(from, screenCss.indexOf('\n  }', from));
};
const rulesIn = (text) => [...text.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sels: m[1].split(',').map((s) => s.trim()), body: m[2] }));
const prop = (ruleBody, name) => ruleBody.match(new RegExp('(?:^|;)\\s*' + name + '\\s*:\\s*([^;]+)'))?.[1].trim();
// 同じ部品の決まりは複数あるので、欲しい項目を持つ決まりを取る
const valueIn = (rules, sel, name) => {
  const r = rules.find((x) => x.sels.includes(sel) && prop(x.body, name) !== undefined);
  assert.ok(r, sel + ' に ' + name + ' の決まりが無い');
  return prop(r.body, name);
};
const REM = 16;
const toPx = (v) => {
  const m = String(v).match(/^([\d.]+)(rem|px)?$/);
  assert.ok(m, 'px に直せない: ' + v);
  return Number(m[1]) * (m[2] === 'rem' ? REM : 1);
};
// margin・padding の上下の和(値が1つか2つの書き方だけを使っている)
const verticalSum = (v) => 2 * toPx(String(v).trim().split(/\s+/)[0]);

const phone = rulesIn(block('@media (max-width: 40rem)'));
const coarse = rulesIn(block('@media (pointer: coarse)'));
const all = rulesIn(screenCss);

// 帯の高さ = 上の線 + 上下の余白 + ボタン(一番高いのは指の端末)+ ボタンの上下の余白
function barHeight() {
  const line = toPx(valueIn(phone, '.step-next', 'border-top').split(/\s+/)[0]);
  const button = Math.max(toPx(valueIn(all, 'button', 'min-height')), toPx(valueIn(coarse, 'button', 'min-height')));
  const margins = ['#next-step-3', '#confirm-go'].map((id) => verticalSum(valueIn(phone, id, 'margin')));
  return line + verticalSum(valueIn(phone, '.step-next', 'padding')) + button + Math.max(...margins);
}
// 焦点の輪は要素の外に出る。輪まで帯の上に残す
function ringOutside() {
  return toPx(valueIn(all, 'button:focus-visible', 'outline-offset')) + toPx(valueIn(all, 'button:focus-visible', 'outline').split(/\s+/)[0]);
}

const docOf = (page) => page.el('print-btn').ownerDocument;
async function sampleResult() {
  const page = runPage(html);
  await page.click('sample-load');
  await page.click('confirm-go');
  return page;
}
// id の部品に焦点を置き、画面に入れた順を記録する。notice を渡すと、呼ばれた時にその知らせが書かれていたかも見る
// (文を書く前に入れ直しても、ボタンはまだ動いていないので意味が無い)
function watch(page, focusId, ids, notice) {
  const calls = [];
  const early = () => (notice && page.el(notice).textContent === '' ? ':知らせの前' : '');
  for (const id of ids) page.el(id).scrollIntoView = (o) => calls.push(id + ':' + o.block + early());
  docOf(page).activeElement = page.el(focusId);
  return calls;
}

// ---- CSS ----
test('F84g (1) scroll-padding-bottom が帯の高さと焦点の輪を足した分以上(指の端末の高さで数える)', () => {
  const need = barHeight() + ringOutside();
  const have = toPx(valueIn(phone, 'html', 'scroll-padding-bottom'));
  assert.ok(have >= need, 'scroll-padding-bottom ' + have + 'px が 帯 ' + barHeight() + 'px + 輪 ' + ringOutside() + 'px より小さい');
});

test('F84g (2) 帯と scroll-padding-bottom は同じ幅の決まりの中にあり、帯は下に止まる', () => {
  assert.equal(valueIn(phone, '.step-next', 'position'), 'sticky');
  assert.equal(valueIn(phone, '.step-next', 'bottom'), '0');
  assert.ok(!screenCss.replace(block('@media (max-width: 40rem)'), '').includes('scroll-padding-bottom'), '幅の決まりの外にもある');
});

// ---- 上に知らせが入るボタン ----
test('F84g (3) 結果の CSV を押す: 知らせを画面に入れてから、焦点のあるボタンを入れ直す', async () => {
  const page = await sampleResult();
  const calls = watch(page, 'csv-btn', ['export-status', 'csv-btn'], 'export-status');
  await page.click('csv-btn');
  assert.match(page.el('export-status').textContent, /CSV をこの端末に保存しました/);
  assert.deepEqual(calls, ['export-status:nearest', 'csv-btn:nearest']);
});

for (const id of ['print-btn', 'print-all-btn', 'csv-btn']) {
  test('F84g (4) 結果が無いまま ' + id + ' を押す: 知らせの後に焦点のボタンを入れ直す', async () => {
    const page = runPage(html);
    const calls = watch(page, id, ['export-status', id], 'export-status');
    await page.click(id);
    assert.notEqual(page.el('export-status').textContent, '');
    assert.deepEqual(calls, ['export-status:nearest', id + ':nearest']);
  });
}

test('F84g (5) 知らせを消すときは、焦点のボタンを動かさない', async () => {
  const page = await sampleResult();
  await page.click('csv-btn');
  const calls = watch(page, 'sample-load', ['export-status', 'sample-load']);
  await page.click('sample-load');
  await page.click('confirm-go');
  assert.equal(page.el('export-status').textContent, '');
  assert.deepEqual(calls, []);
});

// ---- 動かさない物 ----
test('F84g (6) 文字を打っている欄は動かさない(条件を変えた知らせは書く)', async () => {
  for (const id of ['contract-amount', 'orderer']) {
    const page = await sampleResult();
    const calls = watch(page, id, [id]);
    await page.set(id, id === 'orderer' ? '架空の発注者' : '123');
    assert.match(page.el('export-status').textContent, /条件が変わりました/);
    assert.deepEqual(calls, [], id);
  }
});

test('F84g (7) 焦点が本文や見出しにあるときは、それを動かさない', async () => {
  const page = runPage(html);
  const doc = docOf(page);
  const moved = [];
  doc.body.scrollIntoView = () => moved.push('body');
  doc.activeElement = doc.body;
  await page.click('csv-btn');
  page.el('confirm-title').scrollIntoView = () => moved.push('confirm-title');
  doc.activeElement = page.el('confirm-title');
  await page.click('print-btn');
  assert.deepEqual(moved, []);
});

test('F84g (8) 焦点の持ち主が無い・scrollIntoView が無いときも投げない', () => {
  const status = { textContent: '' };
  const docWith = (activeElement) => ({ getElementById: (id) => (id === 'export-status' ? status : null), querySelectorAll: () => [], title: '', activeElement });
  const win = { print() {} };
  assert.doesNotThrow(() => printResult(docWith(undefined), win));
  assert.doesNotThrow(() => printResult(docWith(null), win));
  assert.doesNotThrow(() => printResult(docWith({ tagName: 'BUTTON' }), win));
  assert.match(status.textContent, /全部を印刷する/);
});

// ---- 上に知らせが入るファイルの入力 ----
const RULES = fs.readFileSync(new URL('../../data/specs/wakayama_r0711_rows.json', import.meta.url), 'utf8');
for (const [name, text, expected] of [['読めたとき', RULES, /を読みました/], ['読めなかったとき', '{ 壊れた表', /読み込めませんでした/]]) {
  test('F84g (9) 自分の表のファイルを読む(' + name + '): 知らせの後に焦点の入力を入れ直す', async () => {
    const page = await sampleResult();
    const input = page.el('rules-load');
    input.type = 'file';
    input.files = [{ name: '表.json', size: text.length, type: 'application/json', text: async () => text }];
    const calls = watch(page, 'rules-load', ['rules-load'], 'rules-status');
    await page.set('rules-load', '');
    assert.match(page.el('rules-status').textContent, expected);
    assert.deepEqual(calls, ['rules-load:nearest']);
  });
}

// ---- 上の注記が伸びるボタン ----
test('F84g (11) 和歌山県の例を押す: 真上の注記が伸びた後に、下の知らせと焦点のボタンを入れ直す', async () => {
  const page = await sampleResult();
  const notice = page.el('schedule-notice');
  const before = notice.textContent.length;
  const calls = watch(page, 'rules-wakayama', ['rules-status', 'rules-wakayama'], 'rules-status');
  const atFocus = [];
  const record = page.el('rules-wakayama').scrollIntoView;
  page.el('rules-wakayama').scrollIntoView = (o) => { atFocus.push(notice.textContent.length); record(o); };
  await page.click('rules-wakayama');
  assert.deepEqual(calls, ['rules-status:nearest', 'rules-wakayama:nearest']);
  assert.ok(atFocus[0] > before, '注記が伸びる前に入れ直している: ' + before + ' → ' + atFocus[0]);
});

// ---- 入れ直しの要らない所 ----
test('F84g (10) 段取り・安全・切り替えの知らせは焦点のある部品より下にあり、確かめの段には知らせの行が無い', () => {
  const panel = body.slice(body.indexOf('<section id="panel-2"'), body.indexOf('<section id="panel-3"'));
  const after = (first, second) => assert.ok(panel.indexOf(first) >= 0 && panel.indexOf(first) < panel.indexOf(second), first + ' の下に ' + second + ' が無い');
  after('id="schedule-csv-btn"', 'id="schedule-status"');
  after('id="safety-questions"', 'id="safety-status"');
  after('id="rules-clear"', 'id="rules-status"');
  assert.ok(!body.slice(body.indexOf('<section id="panel-confirm"'), body.indexOf('<section id="panel-2"')).includes('aria-live'), '確かめの段に知らせの行がある');
});

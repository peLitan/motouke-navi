// F43d: 入力の確かめ。結果の前に全部の条件を行で並べ、出どころ・推定・変更を出す。見本と公告の読み込みもこの画面を通る
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHtml } from '../../build.mjs';
import { runPage } from '../acceptance/_helpers.mjs';
import { CONFIRM_ROWS, confirmRows, markSources, renderConfirmRow } from '../../src/ui/confirm.mjs';
import { parseIntakeFile } from '../../src/intake-load.mjs';
import { SAMPLE } from '../../src/sample.mjs';

const html = buildHtml();
const body = html.slice(html.indexOf('<body>')).replace(/<script\b[\s\S]*?<\/script>/g, '');
const css = html.match(/<style>([\s\S]*?)<\/style>/)[1];
const section = body.slice(body.indexOf('<section id="panel-confirm"'), body.indexOf('<section id="panel-2"'));
const value = (page, key) => page.el('confirm-value-' + key).innerHTML;

const INTAKE = JSON.stringify({
  kind: 'bid-intake',
  source: { title: '架空の公告' },
  rows: [
    { key: 'orderer-name', label: '発注者', status: '拾えた', quote: '発注者 架空町長' },
    { key: 'work-class', label: '工事の種類', status: '拾えた', quote: '工事の種類 土木一式工事' },
    { key: 'budget', label: '予定価格', status: '拾えた', quote: '予定価格 82,500,000円(税込み)' },
  ],
  form: { orderer: 'public', 'work-type': 'other', 'contract-amount': '82500000' },
});

test('行の数: 判定に使う条件を全部(10行)並べ、行ごとに「変更」のボタンがあり、文は欄の選択肢と同じ', () => {
  assert.equal(CONFIRM_ROWS.length, 10);
  assert.equal(section.match(/class="confirm-row"/g).length, 10);
  for (const r of CONFIRM_ROWS) {
    assert.ok(section.includes('<dt>' + r.label + '</dt>'), r.label);
    assert.match(section, new RegExp('id="confirm-value-' + r.key + '"'));
    assert.match(section, new RegExp('<button type="button" id="confirm-change-' + r.key + '" aria-label="' + r.label + 'を変更">変更</button>'));
    // 選ぶ欄の語は入力欄の語と食い違わない(発注者は括弧の説明を除く)
    for (const [v, text] of Object.entries(r.options ?? {})) assert.ok(body.includes('<option value="' + v + '">' + text), v);
  }
  // 手で入れる欄は読み取りの対象に全部入っている(抜けた条件が結果にだけ効くことがない)
  assert.deepEqual(confirmRows({}).map((r) => r.key), CONFIRM_ROWS.map((r) => r.key));
  assert.match(section, /<button type="button" id="confirm-go">この内容で結果を見る<\/button>/);
  assert.match(section, /<section id="panel-confirm" class="no-print" hidden>/);
});

test('手入力: 確認するで確かめへ進む。値は読みやすい形で、全部の行に出どころがある。結果の段はまだ開かない', async () => {
  const page = runPage();
  await page.click('entry-bid');
  await page.set('orderer', 'private');
  await page.set('contract-amount', '１２,０００,０００円');
  await page.set('subcontract-total-unknown', true);
  await page.click('bid-run');
  assert.equal(page.el('panel-confirm').hidden, false);
  assert.equal(page.el('panel-1').hidden, true);
  assert.equal(page.el('panel-2').hidden, true);
  assert.match(value(page, 'orderer'), /民間.*出どころ: 手入力/);
  assert.match(value(page, 'contract-amount'), /12,000,000円\(税込み\).*出どころ: 手入力/);
  assert.match(value(page, 'subcontract-total'), /分からない.*出どころ: 手入力/);
  assert.match(value(page, 'role'), /未回答.*出どころ: 入れていません/);
  assert.match(value(page, 'ict-measure'), /講じない.*出どころ: 手入力/);
  for (const r of CONFIRM_ROWS) assert.match(value(page, r.key), /出どころ: /, r.key);
  assert.ok(!/推定/.test(section + CONFIRM_ROWS.map((r) => value(page, r.key)).join('')), '手入力に推定が付いている');
  await page.click('confirm-go');
  assert.equal(page.el('panel-confirm').hidden, true);
  assert.equal(page.el('panel-2').hidden, false);
  assert.ok(page.text('bid-result').length > 0);
  assert.match(page.text('bid-status'), /結果が出ました/);
});

test('読めない金額: 確かめの行に値と直し方を出す(値をそのまま HTML にしない)', async () => {
  const page = runPage();
  await page.click('entry-bid');
  await page.set('contract-amount', '<b>1万</b>');
  await page.click('bid-run');
  assert.match(value(page, 'contract-amount'), /読めない値: &lt;b&gt;1万.*「変更」で直して/);
});

test('変更: 入れ直す欄へ戻って焦点を移し、直して確認すると新しい値になる', async () => {
  const page = runPage();
  await page.click('sample-load');
  let focused = 0;
  page.el('license').focus = () => { focused += 1; };
  await page.click('confirm-change-license');
  assert.equal(page.el('panel-1').hidden, false);
  assert.equal(page.el('panel-confirm').hidden, true);
  assert.deepEqual([page.el('step-1').getAttribute('aria-current')], ['step']);
  assert.equal(focused, 1);
  await page.set('license', 'ippan');
  await page.click('bid-run');
  assert.match(value(page, 'license'), /一般建設業.*出どころ: 手入力/);
  assert.match(value(page, 'orderer'), /出どころ: 見本/, '変えていない行は見本のまま');
  await page.click('confirm-go');
  assert.match(page.text('summary'), /一般建設業/);
});

test('変更: 元請けか下請けかは選んでいる印へ、金額の「分からない」はその印へ焦点を移す', async () => {
  const page = runPage();
  await page.click('sample-load');
  let hit = '';
  for (const id of ['direct', 'direct-unset', 'subcontract-total', 'subcontract-total-unknown']) page.el(id).focus = () => { hit = id; };
  await page.click('confirm-change-role');
  assert.equal(hit, 'direct');
  await page.set('subcontract-total-unknown', true);
  await page.click('bid-run');
  await page.click('confirm-change-subcontract-total');
  assert.equal(hit, 'subcontract-total-unknown');
});

test('見本: 確かめの画面を通り、全部の行の出どころが見本。結果は「この内容で結果を見る」で開く', async () => {
  const page = runPage();
  await page.click('sample-load');
  assert.equal(page.el('panel-confirm').hidden, false);
  assert.equal(page.el('panel-2').hidden, true);
  for (const r of CONFIRM_ROWS) assert.match(value(page, r.key), /出どころ: 見本/, r.key);
  assert.match(value(page, 'contract-amount'), /286,000,000円/);
  await page.click('confirm-go');
  assert.equal(page.el('panel-2').hidden, false);
  assert.match(page.text('bid-status'), /見本を読み込みました/);
});

test('見本を入れ直すと、出どころも手入力に戻る', async () => {
  const page = runPage();
  await page.click('sample-load');
  await page.click('sample-reenter');
  await page.set('orderer', 'public');
  await page.click('bid-run');
  assert.match(value(page, 'orderer'), /出どころ: 手入力/);
});

test('公告: 拾った行は 出どころ 公告 と抜き書き、推定と確認が要ることを出す。予定価格は請負代金そのものでないと書く', () => {
  const t = parseIntakeFile(INTAKE);
  assert.equal(t.quotes.orderer, '発注者 架空町長');
  const values = { ...SAMPLE.form, ...t.form };
  const rows = confirmRows(values, markSources(values, '公告', t.quotes, Object.keys(t.form)));
  const get = (key) => rows.find((r) => r.key === key);
  assert.deepEqual(rows.filter((r) => r.estimated).map((r) => r.key), ['orderer', 'work-type', 'contract-amount']);
  assert.equal(get('license').source, '手入力');
  const text = renderConfirmRow(get('orderer'));
  assert.match(text, /出どころ: 公告「発注者 架空町長」/);
  assert.match(text, /推定/);
  assert.match(text, /確認が要ります/);
  assert.match(renderConfirmRow(get('contract-amount')), /予定価格は上限の見込みで、請負代金そのものではありません/);
  // 値を変えた行は手入力になり、推定は外れる
  const edited = { ...values, orderer: 'private' };
  const after = confirmRows(edited, markSources(values, '公告', t.quotes, Object.keys(t.form)));
  assert.equal(after.find((r) => r.key === 'orderer').source, '手入力');
  assert.equal(after.find((r) => r.key === 'orderer').estimated, false);
  assert.equal(after.find((r) => r.key === 'work-type').estimated, true);
});

test('公告: 画面で読み込んだあとも確認すると確かめの画面を通り、推定が出る', async () => {
  const page = runPage();
  await page.click('entry-intake');
  assert.equal(page.el('panel-1').hidden, false);
  page.el('intake-load').files = [{ size: INTAKE.length, text: async () => INTAKE }];
  await page.set('intake-load', '');
  await new Promise((r) => setImmediate(r));
  assert.match(page.text('intake-status'), /3 欄を入れました/);
  await page.click('bid-run');
  assert.equal(page.el('panel-confirm').hidden, false);
  assert.match(value(page, 'orderer'), /公共.*公告「発注者 架空町長」.*推定/);
  assert.match(value(page, 'contract-amount'), /82,500,000円.*推定/);
  assert.match(value(page, 'license'), /未回答/);
});

// F65a: 読み込んだときの知らせの予定価格の注意は、請負代金の欄に値が入るときだけ出す。
// 値なしは、予定価格を確かめが要るとして欄に入れなかった条件の形(撮る公告の予行で見つかった形)
const NO_AMOUNT = JSON.stringify({
  kind: 'bid-intake',
  source: { title: '架空の公告' },
  rows: [
    { key: 'orderer-name', label: '発注者', status: '拾えた', quote: '発注者 架空町長' },
    { key: 'work-class', label: '工事の種類', status: '拾えた', quote: '工事の種類 土木一式工事' },
    { key: 'budget', label: '予定価格', status: '確かめが要る', quote: '', flags: ['書いていないとされたが、語がある'] },
  ],
  form: { orderer: 'public', 'work-type': 'other' },
  formSkipped: [{ id: 'contract-amount', label: '請負代金の見込み', reason: '確かめが要る' }],
});
const STATUS_TAIL = '原文で確かめてください。ブラウザには保存しません。残りの欄を入れて「確認する」を押すと、入れた内容を確かめる画面へ進みます。';
async function readIntake(page, name, text) {
  page.el('intake-load').files = [{ name, size: text.length, text: async () => text }];
  await page.set('intake-load', '');
  await new Promise((r) => setImmediate(r));
}
async function intakePage() {
  const page = runPage();
  await page.click('entry-intake');
  return page;
}

test('F65a: 請負代金の欄の値が無い条件は、知らせに予定価格の注意を出さず、残りの文は同じ', async () => {
  const page = await intakePage();
  await readIntake(page, '条件.json', NO_AMOUNT);
  assert.equal(page.el('intake-status').textContent, '条件.json を読みました。「架空の公告」から 2 欄を入れました。' + STATUS_TAIL);
  assert.equal(page.el('contract-amount').value, '');
  await page.click('bid-run');
  assert.doesNotMatch(value(page, 'contract-amount'), /上限の見込み/);
});

test('F65a: 請負代金の欄の値がある条件は、知らせに今までと同じ文を出し、確かめの画面の注記も今のまま', async () => {
  const page = await intakePage();
  await readIntake(page, '条件.json', INTAKE);
  assert.equal(page.el('intake-status').textContent, '条件.json を読みました。「架空の公告」から 3 欄を入れました。予定価格は上限の見込みで、請負代金そのものではありません。' + STATUS_TAIL);
  assert.equal(page.el('contract-amount').value, '82500000');
  await page.click('bid-run');
  assert.match(value(page, 'contract-amount'), /予定価格は上限の見込みで、請負代金そのものではありません。/);
});

test('F65a: 続けて読むと、知らせはそのとき読んだ条件で決まる', async () => {
  const page = await intakePage();
  await readIntake(page, '値なし.json', NO_AMOUNT);
  assert.doesNotMatch(page.text('intake-status'), /上限の見込み/);
  await readIntake(page, '値あり.json', INTAKE);
  assert.match(page.text('intake-status'), /^値あり\.json を読みました。.*予定価格は上限の見込み/);
  await readIntake(page, '値なし.json', NO_AMOUNT);
  assert.doesNotMatch(page.text('intake-status'), /上限の見込み/);
});

test('抜き書きの文は HTML にせず、長い文は切る', () => {
  const r = { key: 'orderer', text: '公共', state: 'set', source: '公告', estimated: true, quote: '<img src=x>' + 'あ'.repeat(100) };
  const h = renderConfirmRow(r);
  assert.ok(!h.includes('<img'));
  assert.ok(h.includes('&lt;img'));
  assert.ok(h.includes('…'));
});

test('見た目: 押す所 44px の決まりの中のボタンで、狭い幅では1列寄りになり、長い値は折り返す。下の帯は「次へ」1つ', () => {
  assert.match(css, /\.confirm-row dd \{[^}]*overflow-wrap: anywhere/);
  assert.match(css, /@media[^{]*40rem[\s\S]*\.confirm-row \{ grid-template-columns: minmax\(0, 1fr\) auto; \}/);
  assert.match(css, /#next-step-3, #confirm-go \{ width: 100%; margin: 0; \}/);
  assert.equal(section.match(/step-next/g).length, 1);
  assert.ok(section.indexOf('confirm-back') < section.indexOf('step-next'));
  assert.ok(!/style=/.test(section));
});

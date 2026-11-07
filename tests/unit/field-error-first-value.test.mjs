// F59: 建築一式+土木の注意、金額の欄の誤りの文、確かめの画面の未回答の札、触っていない欄の「最初の値」
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHtml } from '../../build.mjs';
import { runPage } from '../acceptance/_helpers.mjs';
import { CONFIRM_ROWS, confirmRows, markSources, renderConfirmRow, workKindWarning } from '../../src/ui/confirm.mjs';
import { amountFieldError } from '../../src/ui/form.mjs';
import { SAMPLE } from '../../src/sample.mjs';

const html = buildHtml();
const body = html.slice(html.indexOf('<body>')).replace(/<script\b[\s\S]*?<\/script>/g, '');
const css = html.match(/<style>([\s\S]*?)<\/style>/)[1];
const value = (page, key) => page.el('confirm-value-' + key).innerHTML;
const WARN = '工種が土木のままです。建築の工事なら「変更」で選び直してください。';
const WARN_LOAD = '工種が土木のままです。建築の工事なら「工種」の欄で選び直してください。';
const UNREADABLE = '読めない値です。数字か、末尾に「円」を付けた億・万・千円・百万円で入れてください(例 200,000,000 や 2億円)';

const intakeFile = (workType) => JSON.stringify({
  kind: 'bid-intake',
  source: { title: '架空の公告' },
  rows: [
    { key: 'orderer-name', label: '発注者', status: '拾えた', quote: '発注者 架空町長' },
    { key: 'work-class', label: '工事の種類', status: '拾えた', quote: '工事の種類 架空の語' },
    { key: 'budget', label: '予定価格', status: '拾えた', quote: '予定価格 82,500,000円(税込み)' },
  ],
  form: { orderer: 'public', 'work-type': workType, 'contract-amount': '82500000' },
});
async function readIntake(page, text) {
  page.el('intake-load').files = [{ name: '条件.json', size: text.length, text: async () => text }];
  await page.set('intake-load', '');
  await new Promise((r) => setImmediate(r));
}
async function bidPage() {
  const page = runPage(html);
  await page.click('entry-bid');
  return page;
}
// 打っている途中: input だけが来る。欄を離れると change が来る
const typing = (page, id, v) => { const e = page.el(id); e.value = v; e.dispatchEvent({ type: 'input', bubbles: false }); };
const leave = (page, id) => page.el(id).dispatchEvent({ type: 'change', bubbles: false });

// (1) 建築一式+土木の注意
test('工種の注意: 工事の種類が建築一式で工種が土木のときだけ文を返す', () => {
  assert.equal(workKindWarning({ 'work-type': 'kenchiku-ikkatsu', 'work-kind': 'doboku' }), WARN);
  assert.equal(workKindWarning({ 'work-type': 'kenchiku-ikkatsu' }), WARN, '欄が無いときの工種は既定の土木');
  for (const k of ['kenchiku', 'denki', 'kan', 'tsushin', 'zoen', 'other']) assert.equal(workKindWarning({ 'work-type': 'kenchiku-ikkatsu', 'work-kind': k }), '', k);
  for (const t of ['other', 'unknown', '', undefined]) assert.equal(workKindWarning({ 'work-type': t, 'work-kind': 'doboku' }), '', String(t));
});

test('工種の注意: 確かめの画面の工種の行に出て、土木以外を選ぶと消える。値は変えない', async () => {
  const page = await bidPage();
  await page.set('work-type', 'kenchiku-ikkatsu');
  await page.click('bid-run');
  assert.ok(value(page, 'work-kind').includes(WARN));
  assert.equal(page.el('work-kind').value, 'doboku');
  for (const r of CONFIRM_ROWS.filter((x) => x.key !== 'work-kind')) assert.ok(!value(page, r.key).includes('土木のまま'), r.key);
  await page.click('confirm-change-work-kind');
  await page.set('work-kind', 'kenchiku');
  await page.click('bid-run');
  assert.ok(!value(page, 'work-kind').includes('土木のまま'));
  assert.match(value(page, 'work-kind'), /^<strong>建築<\/strong>/);
});

test('工種の注意: 工事の種類がそれ以外なら、土木のままでも出ない', async () => {
  const page = await bidPage();
  await page.set('work-type', 'other');
  await page.click('bid-run');
  assert.ok(!value(page, 'work-kind').includes('土木のまま'));
  assert.ok(!confirmRows(SAMPLE.form).some((r) => r.warning), '見本には出ない');
});

test('工種の注意: 公告の読み込みで建築一式になると知らせに1文を足す。値は変えず、確かめの画面にも出る', async () => {
  const page = runPage(html);
  await page.click('entry-intake');
  await readIntake(page, intakeFile('kenchiku-ikkatsu'));
  assert.ok(page.text('intake-status').includes('請負代金そのものではありません。' + WARN_LOAD + '原文で確かめてください。'));
  assert.equal(page.el('work-kind').value, 'doboku');
  await page.click('bid-run');
  assert.ok(value(page, 'work-kind').includes(WARN));
});

test('工種の注意: 読み込みの知らせは、それ以外の工事と、先に工種を選んだときには出ない', async () => {
  const other = runPage(html);
  await other.click('entry-intake');
  await readIntake(other, intakeFile('other'));
  assert.ok(!other.text('intake-status').includes('土木のまま'));
  const picked = runPage(html);
  await picked.click('entry-intake');
  await picked.set('work-kind', 'kenchiku');
  await readIntake(picked, intakeFile('kenchiku-ikkatsu'));
  assert.ok(!picked.text('intake-status').includes('土木のまま'));
});

// (2) 金額の欄の誤りの文
test('誤りの文の場所: 2つの欄の .row の中で説明より前にあり、空で隠れ、知らせの属性は持たない。hint の参照は静的なまま', () => {
  for (const id of ['contract-amount', 'subcontract-total']) {
    const tag = '<p id="' + id + '-error" class="field-error" hidden></p>';
    const row = body.slice(body.indexOf('<div class="row"><label for="' + id + '">'), body.indexOf('id="' + id + '-hint"'));
    assert.ok(row.includes(tag), id);
    assert.ok(row.indexOf(id + '-unknown') < row.indexOf(tag));
    assert.ok(row.indexOf(tag) < row.indexOf('<details'));
    assert.ok(body.includes('aria-describedby="' + id + '-plain ' + id + '-hint"'), id);
  }
  assert.match(css, /\.field-error \{ color: var\(--need\);/);
});

for (const id of ['contract-amount', 'subcontract-total']) {
  test('誤りの文: ' + id + ' は読めない値で文・aria-invalid・参照が付き、直すと誤りの id だけ消える', async () => {
    const page = await bidPage();
    const el = page.el(id);
    const note = page.el(id + '-error');
    await page.set(id, '約2億円');
    assert.equal(note.textContent, UNREADABLE);
    assert.equal(note.hidden, false);
    assert.equal(el.getAttribute('aria-invalid'), 'true');
    assert.equal(el.getAttribute('aria-describedby'), id + '-plain ' + id + '-hint ' + id + '-error');
    await page.set(id, 'まだ読めない');
    assert.equal(el.getAttribute('aria-describedby'), id + '-plain ' + id + '-hint ' + id + '-error', '同じ id を重ねない');
    await page.set(id, '120,000,000');
    assert.equal(note.textContent, '');
    assert.equal(note.hidden, true);
    assert.equal(el.hasAttribute('aria-invalid'), false);
    assert.equal(el.getAttribute('aria-describedby'), id + '-plain ' + id + '-hint');
  });
}

test('誤りの文: 打っている途中には出さず、欄を離れたときに出す。もう片方の欄の文は残る', async () => {
  const page = await bidPage();
  typing(page, 'contract-amount', 'abc');
  assert.equal(page.el('contract-amount-error').hidden, true);
  assert.equal(page.el('contract-amount').hasAttribute('aria-invalid'), false);
  assert.equal(page.el('contract-amount').getAttribute('aria-describedby'), 'contract-amount-plain contract-amount-hint');
  leave(page, 'contract-amount');
  assert.equal(page.el('contract-amount-error').hidden, false);
  await page.set('subcontract-total', '100');
  assert.equal(page.el('contract-amount-error').hidden, false);
  assert.equal(page.el('subcontract-total-error').hidden, true);
});

test('誤りの文: 空にすると消え、「分からない」に印を付けると消え、外すとまた出る', async () => {
  const page = await bidPage();
  await page.set('contract-amount', 'abc');
  await page.set('contract-amount-unknown', true);
  assert.equal(page.el('contract-amount-error').hidden, true);
  assert.equal(page.el('contract-amount').getAttribute('aria-describedby'), 'contract-amount-plain contract-amount-hint');
  await page.set('contract-amount-unknown', false);
  assert.equal(page.el('contract-amount-error').hidden, false);
  await page.set('contract-amount', '');
  assert.equal(page.el('contract-amount-error').hidden, true);
  assert.equal(page.el('contract-amount').hasAttribute('aria-invalid'), false);
});

test('誤りの文: 読めるのは文を出さない。数字だけで大きすぎる値には「数字だけで」と言わない', async () => {
  const page = await bidPage();
  for (const ok of ['１２,０００,０００円', '0', '1 000', '1億3,420万円', '134,200千円']) {
    await page.set('contract-amount', ok);
    assert.equal(page.el('contract-amount-error').hidden, true, ok);
  }
  for (const bad of ['1.5', '-100', '1万', '約1億円', '1億']) assert.equal(amountFieldError(bad), UNREADABLE, bad);
  await page.set('contract-amount', '99999999999999999');
  assert.equal(page.el('contract-amount-error').textContent, '金額が大きすぎます。桁を確かめてください(例 200,000,000)');
});

test('誤りの文: 「確認する」から「変更」で戻ると、欄の下に文がある(確かめの行も今のまま)', async () => {
  const page = await bidPage();
  typing(page, 'contract-amount', 'abc');
  await page.click('bid-run');
  assert.match(value(page, 'contract-amount'), /読めない値: abc。「変更」で直して/);
  await page.click('confirm-change-contract-amount');
  assert.equal(page.el('panel-1').hidden, false);
  assert.equal(page.el('contract-amount-error').textContent, UNREADABLE);
  assert.equal(page.el('contract-amount').getAttribute('aria-describedby'), 'contract-amount-plain contract-amount-hint contract-amount-error');
});

test('誤りの文: 公告の読み込みで読める値に置き換わると消える。読み込まなかった欄の文は残る', async () => {
  const page = runPage(html);
  await page.click('entry-intake');
  await page.set('contract-amount', 'abc');
  await page.set('subcontract-total', 'xyz');
  await readIntake(page, intakeFile('other'));
  assert.equal(page.el('contract-amount').value, '82500000');
  assert.equal(page.el('contract-amount-error').hidden, true);
  assert.equal(page.el('contract-amount').hasAttribute('aria-invalid'), false);
  assert.equal(page.el('subcontract-total-error').hidden, false);
});

test('誤りの文: 見本を入れ直すと消える', async () => {
  const page = runPage(html);
  await page.click('sample-load');
  await page.click('confirm-back');
  await page.set('contract-amount', 'abc');
  assert.equal(page.el('contract-amount-error').hidden, false);
  await page.click('sample-reenter');
  assert.equal(page.el('contract-amount-error').hidden, true);
  assert.equal(page.el('contract-amount').hasAttribute('aria-invalid'), false);
  assert.equal(page.el('contract-amount').getAttribute('aria-describedby'), 'contract-amount-plain contract-amount-hint');
});

// (3) 未回答の札
test('未回答の札: state が unset の行にだけ F14f と同じ印を付け、語は重ねない', async () => {
  const page = await bidPage();
  await page.set('contract-amount', 'abc');
  await page.set('subcontract-total-unknown', true);
  await page.set('orderer', 'public');
  await page.click('bid-run');
  const mark = '<span class="badge badge-unanswered"><span class="mark" aria-hidden="true">?</span> 未回答</span>';
  for (const key of ['role', 'work-type', 'license', 'engineer-qualification']) {
    assert.ok(value(page, key).includes(mark), key);
    assert.equal(value(page, key).split('未回答').length - 1, 1, key);
    assert.match(value(page, key), /まだ選んでいません.*出どころ: 入れていません/, key);
  }
  for (const key of ['orderer', 'contract-amount', 'subcontract-total', 'work-kind', 'ict-measure', 'participation-conditions']) assert.ok(!value(page, key).includes('badge-unanswered'), key);
  const empty = confirmRows({}).find((r) => r.key === 'contract-amount');
  assert.equal(empty.state, 'unset');
  assert.ok(renderConfirmRow(empty).includes(mark));
  assert.match(renderConfirmRow(empty), /まだ入れていません/);
});

// (4) 最初の値
test('最初の値: 読み込みの記録が無く開いたときの値のままなら最初の値、変えたら手入力', () => {
  const initial = { 'work-kind': 'doboku', 'ict-measure': false };
  const get = (values, sources = {}, first = initial) => confirmRows(values, sources, first).find((r) => r.key === 'ict-measure');
  assert.equal(get({ 'ict-measure': false }).source, '最初の値');
  assert.equal(get({ 'ict-measure': false }).estimated, false);
  assert.equal(get({ 'ict-measure': true }).source, '手入力');
  assert.equal(get({ 'ict-measure': false }, {}, null).source, '手入力', 'initial を渡さない形は今のまま');
  // 読み込みの記録がある欄は、最初の値に戻しても手で変えた扱い
  const sources = markSources({ 'ict-measure': true }, '見本');
  assert.equal(get({ 'ict-measure': true }, sources).source, '見本');
  assert.equal(get({ 'ict-measure': false }, sources).source, '手入力');
  // 空の欄は「入れていません」のまま
  const rows = confirmRows({ orderer: '', 'participation-conditions': '' }, {}, { orderer: '', 'participation-conditions': '' });
  assert.equal(rows.find((r) => r.key === 'orderer').source, '未入力');
  assert.equal(rows.find((r) => r.key === 'participation-conditions').source, '未入力');
  assert.match(renderConfirmRow(get({ 'ict-measure': false })), /出どころ: 最初の値\(変えていません\)/);
});

test('最初の値: 画面で触っていない工種と閲覧の措置に出て、変えると手入力、戻すと最初の値', async () => {
  const page = await bidPage();
  await page.set('work-type', 'other');
  await page.click('bid-run');
  assert.match(value(page, 'work-kind'), /土木.*出どころ: 最初の値\(変えていません\)/);
  assert.match(value(page, 'ict-measure'), /講じない.*出どころ: 最初の値\(変えていません\)/);
  assert.match(value(page, 'work-type'), /出どころ: 手入力/);
  await page.click('confirm-back');
  await page.set('work-kind', 'denki');
  await page.set('ict-measure', true);
  await page.click('bid-run');
  assert.match(value(page, 'work-kind'), /電気工事.*出どころ: 手入力/);
  assert.match(value(page, 'ict-measure'), /講じる.*出どころ: 手入力/);
  await page.click('confirm-back');
  await page.set('work-kind', 'doboku');
  await page.click('bid-run');
  assert.match(value(page, 'work-kind'), /出どころ: 最初の値/);
});

test('最初の値: 公告で入れなかった欄に出て、見本の値を手で戻した欄は手入力', async () => {
  const intake = runPage(html);
  await intake.click('entry-intake');
  await readIntake(intake, intakeFile('other'));
  await intake.click('bid-run');
  assert.match(value(intake, 'orderer'), /出どころ: 公告/);
  assert.match(value(intake, 'ict-measure'), /出どころ: 最初の値/);
  const sample = runPage(html);
  await sample.click('sample-load');
  for (const r of CONFIRM_ROWS) assert.match(value(sample, r.key), /出どころ: 見本/, r.key);
  await sample.click('confirm-back');
  await sample.set('work-kind', 'denki');
  await sample.set('work-kind', 'doboku');
  await sample.set('ict-measure', true);
  await sample.click('bid-run');
  assert.match(value(sample, 'work-kind'), /出どころ: 見本/, '同じ値に戻せば読み込んだときのまま');
  assert.match(value(sample, 'ict-measure'), /出どころ: 手入力/);
  await sample.click('confirm-back');
  await sample.set('ict-measure', false);
  await sample.click('bid-run');
  assert.match(value(sample, 'ict-measure'), /出どころ: 見本/);
});

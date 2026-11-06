// F83a7: 金額の欄の書き方(億・万・千円・百万円・全角)と、単位つきで読んだときの「n円 として読みました」の行(値はすべて架空)
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHtml } from '../../build.mjs';
import { runPage } from '../acceptance/_helpers.mjs';
import { parseYen, amountReadNote, amountFieldError, readBidForm } from '../../src/ui/form.mjs';
import { parseAmounts } from '../../plugin/skills/bid-intake/scripts/check-conditions.mjs';

const html = buildHtml();
const SAME = ['134,200,000円', '1億3,420万円', '134,200千円', '134.2百万円', '１億３，４２０万円'];
const READ = '134,200,000円 として読みました';

test('5つの書き方が同じ数 134,200,000 になり、「2億円」「1.5億円」も読める', () => {
  for (const s of SAME) assert.deepEqual(parseYen(s), { value: 134200000, error: null }, s);
  assert.equal(parseYen('2億円').value, 200000000);
  assert.equal(parseYen('1.5億円').value, 150000000);
  assert.equal(parseYen('１．５億円').value, 150000000, '全角の小数点');
  assert.equal(parseYen('1億3420万5000円').value, 134205000, '億・万・円の続き');
  assert.equal(parseYen('134,200 千円').value, 134200000, '千円の前の空白');
});

test('小数は字のまま桁をずらす(浮動小数の誤差を出さない)', () => {
  assert.equal(parseYen('1.1万円').value, 11000);
  assert.equal(parseYen('0.1億円').value, 10000000);
  assert.equal(parseYen('0.5千円').value, 500);
  assert.equal(parseYen('1.23456789億円').value, 123456789, '億の8桁までの小数は端数が出ない');
});

test('単位の取り違えを読み替えない: 「134,200円」は 134,200 のまま、読んだ値の行は出さない', () => {
  assert.deepEqual(parseYen('134,200円'), { value: 134200, error: null });
  assert.equal(amountReadNote('134,200円'), '');
  assert.equal(amountReadNote('134200000'), '', '数字だけの値には行を出さない');
  assert.equal(amountReadNote('約1億円'), '');
  assert.equal(amountReadNote(''), '');
  for (const s of SAME.slice(1)) assert.equal(amountReadNote(s), READ, s);
  assert.equal(amountReadNote('2億円'), '200,000,000円 として読みました');
});

test('「約」・端数が出る書き方・負・円の無い単位・漢数字の位は誤り', () => {
  for (const bad of ['約1億円', '1億円程度', '-1億円', '△1億円', '1億', '5千万円', '一億円', '1.5', '1.5円']) {
    const r = parseYen(bad);
    assert.equal(r.value, null, bad);
    assert.ok(r.error, bad);
  }
  for (const frac of ['1.234567891億円', '1.23456万円', '0.0001千円', '1.0000001百万円']) {
    assert.equal(parseYen(frac).value, null, frac);
    assert.match(parseYen(frac).error, /^円にすると1円未満の端数が出ます: /, frac);
    assert.equal(amountFieldError(frac), '円にすると1円未満の端数が出ます。桁を確かめてください(例 1.5億円)', frac);
  }
  assert.match(parseYen('99999999999億円').error, /^金額が大きすぎます: /);
  assert.match(parseYen('約1億円').error, /億・万・千円・百万円/, '誤りの文は今の動きを言う(「万」などの単位は使えない、と言わない)');
  assert.doesNotMatch(parseYen('約1億円').error, /単位は使えません/);
});

test('bid-intake の額の読み(parseAmounts)と、両方が読む書き方で同じ数になる', () => {
  for (const s of ['2億円', '1億3,420万円', '134,200千円', '１億３，４２０万円', '1.5億円', '134,200円', '12.5万円', '134,200,000円']) {
    assert.equal(parseYen(s).value, parseAmounts(s)[0].yen, s);
  }
});

test('判定に渡すのは読んだ円の値', () => {
  const v = readBidForm({ 'contract-amount': '134,200千円', 'subcontract-total': '4,500万円' });
  assert.equal(v.contractAmount, 134200000);
  assert.equal(v.subcontractTotal, 45000000);
  assert.equal(v.hasSubcontract, true);
});

async function bidPage() {
  const page = runPage(html);
  await page.click('entry-bid');
  return page;
}
const typing = (page, id, v) => { const e = page.el(id); e.value = v; e.dispatchEvent({ type: 'input', bubbles: false }); };
const leave = (page, id) => page.el(id).dispatchEvent({ type: 'change', bubbles: false });

for (const id of ['contract-amount', 'subcontract-total']) {
  test('読んだ値の行: ' + id + ' は単位つきで読めたとき欄の下に出し、数字だけ・読めない・「分からない」・打ち直しの途中では出さない', async () => {
    const page = await bidPage();
    const el = page.el(id);
    const read = page.el(id + '-read');
    assert.ok(read, '行の要素がある');
    assert.equal(read.hidden, true);
    await page.set(id, '1億3,420万円');
    assert.equal(read.textContent, READ);
    assert.equal(read.hidden, false);
    assert.equal(page.el(id + '-error').hidden, true);
    assert.equal(el.hasAttribute('aria-invalid'), false);
    assert.equal(el.getAttribute('aria-describedby'), id + '-hint ' + id + '-read');
    typing(page, id, '1億3,420万');
    assert.equal(read.hidden, true, '打ち直している間は古い値を見せない');
    assert.equal(el.getAttribute('aria-describedby'), id + '-hint');
    leave(page, id);
    assert.equal(read.hidden, true, '円の無い単位は読めない');
    assert.equal(page.el(id + '-error').hidden, false);
    await page.set(id, '134,200千円');
    assert.equal(read.textContent, READ);
    assert.equal(page.el(id + '-error').hidden, true);
    await page.set(id + '-unknown', true);
    assert.equal(read.hidden, true, '「分からない」なら欄の値は使わない');
    await page.set(id + '-unknown', false);
    assert.equal(read.hidden, false);
    await page.set(id, '134,200,000');
    assert.equal(read.hidden, true, '数字だけの値には出さない');
    assert.equal(read.textContent, '');
    assert.equal(el.getAttribute('aria-describedby'), id + '-hint');
  });
}

test('読んだ値の行の場所と色: 誤りの文の直後・説明より前にあり、本文の色で出す', () => {
  const body = html.slice(html.indexOf('<body>')).replace(/<script\b[\s\S]*?<\/script>/g, '');
  for (const id of ['contract-amount', 'subcontract-total']) {
    const error = '<p id="' + id + '-error" class="field-error" hidden></p>';
    const read = '<p id="' + id + '-read" class="field-read" hidden></p>';
    assert.ok(body.includes(error + '\n' + read), id);
    assert.ok(body.indexOf(read) < body.indexOf('id="' + id + '-hint"'), id);
  }
  assert.match(html, /\.field-read \{ color: var\(--ink\);/);
});

test('通し: 「1億3,420万円」と「134,200,000」で入力の確かめの値と結果が同じ', async () => {
  const shown = [];
  for (const v of ['1億3,420万円', '134,200,000']) {
    const page = await bidPage();
    await page.set('orderer', 'public');
    await page.set('direct', true);
    await page.set('work-type', 'other');
    await page.set('contract-amount', v);
    await page.set('subcontract-total', '6,000万円');
    await page.set('license', 'tokutei');
    await page.set('engineer-qualification', 'kanri');
    await page.click('bid-run');
    const row = page.el('confirm-value-contract-amount').innerHTML;
    assert.match(row, /134,200,000円/, v);
    await page.click('confirm-go');
    shown.push(page.el('bid-result').innerHTML);
  }
  assert.ok(shown[0].length > 0);
  assert.equal(shown[0], shown[1]);
});

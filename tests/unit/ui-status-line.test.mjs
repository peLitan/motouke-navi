// F38d: 押したあとの知らせの1行(#bid-status)と、金額の欄の aria-invalid。
// この環境にはブラウザが無いので、見た目は CSS の書いた値を、動きは作り物の DOM で確かめる
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildHtml } from '../../build.mjs';
import { amountValidity } from '../../src/ui/form.mjs';
import { runPage } from '../acceptance/_helpers.mjs';

const shell = fs.readFileSync(new URL('../../src/ui/shell.html', import.meta.url), 'utf8');
const css = shell.match(/<style>([\s\S]*?)<\/style>/)[1].replace(/\/\*[\s\S]*?\*\//g, '');
const screenCss = css.replace(/@media print \{[\s\S]*\n {2}\}/, '');
const rules = [...screenCss.replace(/@media [^{]*\{/g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2] }));
const ruleOf = (sel) => rules.find((r) => r.sel === sel)?.body;
const prop = (body, name) => body?.match(new RegExp('(?:^|;)\\s*' + name + '\\s*:\\s*([^;]+)'))?.[1].trim();
const html = buildHtml();
const status = (page) => page.text('bid-status').trim();
const NEXT = '「次にすること」から読んでください。';

test('知らせの行は結果の見出しの直下にあり、aria-live で、印刷には出さない', () => {
  assert.match(shell, /<h2 id="result-title" tabindex="-1">結果<\/h2>\n<p id="bid-status" class="no-print" aria-live="polite"><\/p>/);
});

test('確認する: 何も入れないと未回答だけなので、仮の結果と次の一手が ＊ 付きで入る', async () => {
  const page = runPage();
  assert.equal(status(page), '');
  await page.click('bid-run');
  assert.ok(status(page).startsWith('＊ 仮の結果が出ました(未回答 7問)。'), status(page));
  assert.ok(status(page).includes(NEXT), status(page));
});

test('見本で試す: 見本を読み込んだことと次の一手が入る', async () => {
  const page = runPage();
  await page.click('sample-load');
  assert.ok(status(page).startsWith('✓ 見本を読み込みました。'), status(page));
  assert.ok(status(page).includes(NEXT), status(page));
  assert.ok(page.text('sample-status').includes('見本'), '帯の文が消えた');
});

test('もう受注した: 条件が無ければ全部の行を出した旨が入り、段取りのページと注意が見える', async () => {
  const page = runPage();
  await page.click('entry-awarded');
  assert.ok(status(page).startsWith('✓ 段取りの全部の行を出しました。'), status(page));
  assert.equal(page.el('pg-2-schedule').hidden, false);
  assert.equal(page.el('awarded-notice').hidden, false);
});

test('もう受注した: 条件から出した結果があれば、その旨が入り、段取りのページに着く', async () => {
  const page = runPage();
  await page.click('bid-run');
  await page.click('entry-back');
  await page.click('entry-awarded');
  assert.ok(status(page).startsWith('✓ 入れた条件の段取りを出しています。'), status(page));
  assert.equal(page.el('pg-2-schedule').hidden, false);
  assert.equal(page.el('awarded-notice').hidden, true);
});

test('金額を読めないとき: 「結果が出ました」も ✓ も出さず、直す所を言う。もう受注したでも同じ', async () => {
  const page = runPage();
  await page.set('contract-amount', '約2億円');
  await page.click('bid-run');
  assert.ok(status(page).startsWith('金額の欄を読めませんでした。'), status(page));
  assert.ok(!status(page).includes('✓') && !status(page).includes('結果が出ました'), status(page));
  await page.click('entry-back');
  await page.click('entry-awarded');
  assert.ok(status(page).startsWith('金額の欄を読めませんでした。'), status(page));
});

test('条件を変えたら、前の「結果が出ました」を残さない。もう受注したでも古い結果を出たと言わない', async () => {
  const page = runPage();
  await page.click('bid-run');
  await page.set('contract-amount', '1000');
  assert.ok(status(page).startsWith('＊ 条件が変わりました。'), status(page));
  await page.click('entry-back');
  await page.click('entry-awarded');
  assert.ok(status(page).startsWith('＊ 条件が変わりました。'), status(page));
  await page.click('bid-run');
  assert.ok(status(page).startsWith('＊ 仮の結果が出ました(未回答 6問)。'), status(page));
});

test('全部の行のときは条件を変えても知らせを書き換えない(全部の行は条件から出していない)', async () => {
  const page = runPage();
  await page.click('entry-awarded');
  await page.set('ledger-input', '工事名: 架空の工事');
  await page.click('ledger-run'); // まとめが出た状態(条件を変えると古い印が付く)にする
  assert.equal(page.el('summary').hidden, false);
  await page.set('contract-amount', '1000');
  assert.ok(status(page).startsWith('✓ 段取りの全部の行を出しました。'), status(page));
});

test('入口に戻ると、自分の工事で入れ直すと、知らせは空に戻る', async () => {
  const page = runPage();
  await page.click('bid-run');
  await page.click('entry-back');
  assert.equal(status(page), '');
  await page.click('sample-load');
  await page.click('sample-reenter');
  assert.equal(status(page), '');
});

test('aria-invalid: 読めない金額の欄にだけ付き、直して押すと外れる。打っている途中は付かない(F59)', async () => {
  const page = runPage();
  const typed = page.el('contract-amount');
  typed.value = '約2億円';
  typed.dispatchEvent({ type: 'input', bubbles: false });
  assert.equal(typed.getAttribute('aria-invalid'), null, '打っている途中から付いた');
  await page.click('bid-run');
  assert.equal(page.el('contract-amount').getAttribute('aria-invalid'), 'true');
  assert.equal(page.el('subcontract-total').getAttribute('aria-invalid'), null);
  await page.set('contract-amount', '200000000');
  await page.click('bid-run');
  assert.equal(page.el('contract-amount').getAttribute('aria-invalid'), null);
});

test('aria-invalid: 「分からない」に印があれば付けない。入れ直すと外れる', async () => {
  assert.deepEqual(amountValidity({ 'contract-amount': '約2億円', 'contract-amount-unknown': true }), [['contract-amount', false], ['subcontract-total', false]]);
  assert.deepEqual(amountValidity({ 'subcontract-total': 'x' }), [['contract-amount', false], ['subcontract-total', true]]);
  const page = runPage();
  await page.set('contract-amount', '約2億円');
  await page.click('sample-load');
  await page.set('contract-amount', '約2億円');
  await page.click('bid-run');
  assert.equal(page.el('contract-amount').getAttribute('aria-invalid'), 'true');
  await page.click('sample-reenter');
  assert.equal(page.el('contract-amount').getAttribute('aria-invalid'), null);
});

test('CSS: 知らせは太字に主の色の左線。注記と見本の帯の文は太字にせず、色だけでなく太さでも分かれる', () => {
  const line = ruleOf('p[aria-live]:not(:empty)');
  assert.equal(prop(line, 'border-left'), '4px solid var(--primary)');
  assert.equal(prop(line, 'font-weight'), 'bold');
  const note = ruleOf('.note[aria-live]:not(:empty)');
  assert.equal(prop(note, 'border-left-color'), 'var(--line)');
  assert.equal(prop(note, 'font-weight'), 'normal');
  const band = ruleOf('.sample-banner p[aria-live]:not(:empty)');
  assert.equal(prop(band, 'border'), 'none');
  assert.equal(prop(band, 'font-weight'), 'normal');
});

test('CSS: 空の状態の文は補助の文字色。読めない欄は 2px の枠', () => {
  assert.equal(prop(ruleOf('.result > p:only-child'), 'color'), 'var(--ink-2)');
  assert.equal(prop(ruleOf('input[type="text"][aria-invalid="true"]'), 'border'), '2px solid var(--need)');
});

test('印刷は .no-print で知らせを出さない。index.html は build と同じで、外部の読み込みが無い', () => {
  assert.match(css, /@media print \{[\s\S]*button, \.export, \.no-print \{ display: none !important; \}/);
  assert.equal(fs.readFileSync(new URL('../../index.html', import.meta.url), 'utf8'), html);
  assert.doesNotMatch(html, /<(?:script|link|img)\b[^>]*(?:src|href)=["']https?:/i);
  assert.match(html, /default-src 'none'/);
  assert.match(html, /id="disclaimer"/);
  assert.match(html, /PDL/);
});

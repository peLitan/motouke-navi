// F83a15: 赤の3つの意味(要る・必須・失敗)を、色のほかの印と文字でも見分ける。色は変えない。値はすべて架空
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildHtml } from '../../build.mjs';
import { runPage } from '../acceptance/_helpers.mjs';
import { QUESTIONS } from '../../src/ui/answers.mjs';
import { renderErrors, renderEmptyInput } from '../../src/ui/view.mjs';

const html = buildHtml();
const shell = fs.readFileSync(new URL('../../src/ui/shell.html', import.meta.url), 'utf8');
const css = shell.match(/<style>([\s\S]*?)<\/style>/)[1].replace(/\/\*[\s\S]*?\*\//g, '');
const printCss = css.match(/@media print \{[\s\S]*\n {2}\}/)[0];
const screenCss = css.replace(printCss, '');
const rules = [...screenCss.replace(/@media [^{]*\{/g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sels: m[1].trim().split(/\s*,\s*/), body: m[2] }));
const ruleOf = (sel) => rules.find((r) => r.sels.includes(sel))?.body;
const prop = (body, name) => body?.match(new RegExp('(?:^|;)\\s*' + name + '\\s*:\\s*([^;]+)'))?.[1].trim();

const MARK = '"× 失敗: "';
const FAILED_LINE = '[data-kind="error"]:not(:empty)::before';
const text = (name, body) => ({ name, size: body.length, text: async () => body });

test('失敗の印の決まり: 知らせの行・欄の下の文・結果の見出し・まとめ・確かめの行の5つに「× 失敗: 」が付く', () => {
  for (const sel of [FAILED_LINE, '.fail-head::before', '.field-error::before', '.summary-error::before', 'span.errors::before']) {
    assert.equal(prop(ruleOf(sel), 'content'), MARK, sel);
  }
});

test('失敗の印のある要素: 読めないと印の決まりに当たり、読めると外れる。文そのものは変えない', async () => {
  const page = runPage(html);
  const status = page.el('rules-status');
  page.el('rules-load').files = [text('壊れた.json', '{')];
  await page.set('rules-load', '');
  assert.equal(status.getAttribute('data-kind'), 'error');
  assert.match(status.textContent, /^読み込めませんでした: /, '「×」は文の中でなく印で足す');
  assert.match(html, /<p id="rules-status"[^>]*aria-live="polite"/);
  page.el('rules-load').files = [text('架空.json', fs.readFileSync(new URL('../../data/specs/wakayama_r0711_rows.json', import.meta.url), 'utf8'))];
  await page.set('rules-load', '');
  assert.equal(status.getAttribute('data-kind'), null, '成功の文に印が残っている');
});

test('金額を読めないと、欄の下・結果の見出し・まとめのどれも失敗の印の決まりに当たる', async () => {
  const page = runPage(html);
  await page.set('contract-amount', '約2億円');
  await page.click('bid-run');
  assert.equal(page.el('bid-status').getAttribute('data-kind'), 'error');
  assert.equal(page.el('contract-amount-error').hidden, false);
  assert.match(page.el('bid-result').innerHTML, /^<div class="errors"><p class="fail-head">入力を読めませんでした。/);
  assert.match(html, /<p id="contract-amount-error" class="field-error" hidden><\/p>/);
  assert.match(page.el('summary').innerHTML ?? '', /class="summary-error"/);
});

test('失敗でない赤の文には印を付けない', () => {
  assert.match(renderErrors(['架空の文']), /class="fail-head"/);
  const empty = renderEmptyInput('まず条件を入れてください');
  assert.doesNotMatch(empty, /fail-head|summary-error|field-error|data-kind/, '入力が空は失敗ではない');
  assert.equal(ruleOf('.summary-stale::before'), undefined, '「条件が変わりました」は失敗ではない');
  assert.equal(ruleOf('div.errors::before'), undefined, '空の知らせも div.errors なので、枠には付けない');
});

test('必須の欄: 質問のすべてに「必須」の文字の札があり、札は枠と色で示す', () => {
  const form = shell.match(/<form id="bid-form"[\s\S]*?<\/form>/)[0];
  const must = [...form.matchAll(/<span class="req req-must">([^<]*)<\/span>/g)];
  assert.equal(must.length, QUESTIONS.length, '札の数と必須の質問の数が違う');
  for (const m of must) assert.match(m[1], /必須/);
  for (const q of QUESTIONS) {
    // 元請けか下請けかだけは選ぶ丸の組なので、名前は legend にある
    const head = q.id === 'direct' ? form.match(/<legend>(元請けか下請けか[\s\S]*?)<\/legend>/)?.[1]
      : form.match(new RegExp('<label for="' + q.id + '">([\\s\\S]*?)</label>'))?.[1];
    assert.match(head ?? '', /<span class="req req-must">※必須<\/span>/, q.id);
  }
  const body = ruleOf('.req-must');
  assert.equal(prop(body, 'color'), 'var(--need)', '色は変えない');
  assert.equal(prop(body, 'border'), '1px solid var(--need-line)');
  assert.equal(prop(ruleOf('.req-optional'), 'border'), undefined, '※任意は札にしない');
});

test('要るの札は今どおり: 印 ● と言葉、色と枠も変えない。失敗の印は付かない', async () => {
  const body = ruleOf('.badge-required');
  assert.equal(prop(body, 'color'), 'var(--need)');
  assert.equal(prop(body, 'border-color'), 'var(--need-line)');
  const page = runPage(html);
  await page.click('sample-load');
  const result = page.el('bid-result').innerHTML;
  const badges = [...result.matchAll(/<span class="badge badge-required">([\s\S]*?)<\/span>\s*(?:要る)?[^<]*/g)].map((m) => m[0]);
  assert.ok(badges.length > 0, '見本に要るの札が無い');
  for (const b of badges) {
    assert.match(b, /●/);
    assert.match(b, /要る/);
    assert.doesNotMatch(b, /[×]|失敗/);
  }
});

test('色の値は変えていない', () => {
  assert.match(css, /--need: #ce0000;/);
  assert.match(css, /--need-line: #ec0000;/);
});

test('印刷: 赤は黒になり、札の枠と失敗の印は消さない。知らせの行を紙に出さない決まりも今どおり', () => {
  assert.match(printCss, /--need: #000; --need-line: #000;/);
  assert.doesNotMatch(printCss, /(\.req|\.field-error|\.summary-error|\.fail-head|span\.errors|data-kind)[^{}]*\{/, '印刷に札や印の決まりを足していない');
  assert.match(printCss, /p\[aria-live\]:not\(\.note\):not\(#check-status\):not\(#checklist-status\):not\(#plan-status\) \{ display: none !important; \}/);
});

test('印は静的な CSS で足し、通信の道を増やしていない', () => {
  const added = FAILED_LINE + (ruleOf(FAILED_LINE) ?? '') + (ruleOf('.req-must') ?? '');
  assert.doesNotMatch(added, /url\(|https?:/);
});

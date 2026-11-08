// F88b: 上の進み具合で、今の段より前の段を押すと、その段の最初のページに戻る。今の段と先の段は押しても何も起きず、押せる見た目にしない。
// 前の段は button なのでキーボードでも押せる。入れた値は消さない。印刷は今のまま(進み具合は紙に出ない)
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHtml } from '../../build.mjs';
import { runPage } from '../acceptance/_helpers.mjs';

const html = buildHtml();
const body = html.slice(html.indexOf('<body')).replace(/<script\b[\s\S]*?<\/script>/g, '');
const css = html.match(/<style>([\s\S]*?)<\/style>/)[1].replace(/\/\*[\s\S]*?\*\//g, '');
const screen = css.slice(0, css.indexOf('@media print'));
const rules = [...screen.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2] }));
const ruleOf = (sel) => rules.find((r) => r.sel === sel)?.body;
const prop = (b, name) => b?.match(new RegExp('(?:^|;)\\s*' + name + '\\s*:\\s*([^;]+)'))?.[1].trim();

const IDS = ['step-0', 'step-1', 'step-2', 'step-3'];
const current = (page) => IDS.filter((id) => page.el(id).getAttribute('aria-current') === 'step');
const pressable = (page) => [0, 1, 2, 3].filter((i) => !page.el('step-back-' + i).disabled);
const PAGE_IDS = ['pg-1', 'pg-1-work', 'pg-1-amount', 'pg-1-license', 'pg-1-notice', 'pg-confirm', 'pg-2-top', 'pg-2-need', 'pg-2-open', 'pg-2-schedule', 'pg-3', 'pg-3-diagram', 'pg-3-check', 'pg-tools'];
const shownPages = (page) => PAGE_IDS.filter((id) => !page.el(id).hidden);
// 画面の今の形: 見えている段の枠・ページ・印・数
const where = (page) => ({
  panels: ['entry', 'panel-1', 'panel-confirm', 'panel-2', 'panel-3', 'panel-tools'].filter((id) => !page.el(id).hidden),
  pages: shownPages(page),
  steps: current(page),
  count: page.el('pg-num').textContent,
});
const FIELDS = ['contract-amount', 'subcontract-total', 'participation-conditions'];
const values = (page) => FIELDS.map((id) => page.el(id).value);

test('#steps: 段の丸と名前を button で包む。HTML の時点(入口)では4つとも押せない', () => {
  const list = body.match(/<ol class="steps" id="steps"[^>]*>[\s\S]*?<\/ol>/)?.[0] ?? '';
  const li = [...list.matchAll(/<li id="(step-\d)"[^>]*><button type="button" class="step-back" id="step-back-(\d)" disabled><span class="step-dot">(\d)<\/span><span class="step-name">([^<]+)<\/span><\/button><\/li>/g)];
  assert.deepEqual(li.map((m) => [m[1], m[2], m[3], m[4]]), [['step-0', '0', '1', '入口'], ['step-1', '1', '2', '条件'], ['step-2', '2', '3', '結果'], ['step-3', '3', '4', '書類']]);
  assert.equal((list.match(/<button\b/g) ?? []).length, 4, '段のほかに押せる物がある');
  assert.ok(!/<a\b|tabindex|onclick|\brole=/.test(list), 'リンク・tabindex・onclick・role がある');
  assert.match(body.match(/<div[^>]*id="progress"[^>]*>/)[0], /no-print/, '進み具合が紙に出る');
});

test('結果の段: 「②条件」で条件の最初のページ、「①入口」で入口に戻る。「③結果」「④書類」は押しても変わらない。入れた値が残る', async () => {
  const page = runPage(html);
  assert.deepEqual(pressable(page), [], '入口で押せる段がある');
  await page.click('sample-load');
  const before = values(page);
  assert.ok(before.some((v) => v !== ''), '見本の値が入っていない');
  await page.click('confirm-go');
  await page.click('pg-next');
  await page.click('pg-next'); // 結果の3ページ目
  const here = where(page);
  assert.deepEqual(here.steps, ['step-2']);
  assert.deepEqual(here.pages, ['pg-2-open']);
  assert.deepEqual(pressable(page), [0, 1], '結果の段で押せる段');
  for (const i of [2, 3]) {
    await page.click('step-back-' + i);
    assert.deepEqual(where(page), here, '「' + (i + 1) + '」を押して画面が変わった');
  }
  await page.click('step-back-1');
  assert.deepEqual(where(page), { panels: ['panel-1'], pages: ['pg-1'], steps: ['step-1'], count: '1/5' }, '条件の最初のページでない');
  assert.deepEqual(values(page), before, '条件の値が変わった');
  assert.deepEqual(pressable(page), [0], '条件の段で押せる段');

  // もう一度結果まで進んで、「①入口」で入口へ
  for (let i = 0; i < 4; i++) await page.click('pg-next');
  await page.click('bid-run');
  await page.click('confirm-go');
  assert.deepEqual(current(page), ['step-2']);
  await page.click('step-back-0');
  const { pages, ...entry } = where(page); // 入口では段の枠ごと隠れ、各一覧は1ページ目の形に戻る(hidePages)
  assert.deepEqual(entry, { panels: ['entry'], steps: ['step-0'], count: '' }, '入口に戻らない');
  assert.equal(page.el('pager').hidden, true, '下の帯が残っている');
  assert.deepEqual(pressable(page), [], '入口で押せる段がある');
  assert.deepEqual(values(page), before, '入口に戻って値が消えた');
  await page.click('entry-bid');
  assert.deepEqual(values(page), before, '条件を開き直して値が消えた');
});

test('書類の段: 「③結果」で結果の最初のページへ。「④書類」は変わらない。結果は残る', async () => {
  const page = runPage(html);
  await page.click('sample-load');
  await page.click('confirm-go');
  const result = page.el('bid-result').innerHTML;
  assert.ok(result.length > 0, '結果が出ていない');
  await page.click('next-step-3');
  await page.click('pg-next');
  const here = where(page);
  assert.deepEqual(here.pages, ['pg-3-diagram']);
  assert.deepEqual(pressable(page), [0, 1, 2]);
  await page.click('step-back-3');
  assert.deepEqual(where(page), here, '「④書類」を押して変わった');
  await page.click('step-back-2');
  assert.deepEqual(where(page), { panels: ['panel-2'], pages: ['pg-2-top'], steps: ['step-2'], count: '1/7' }, '結果の最初のページでない');
  assert.equal(page.el('bid-result').innerHTML, result, '結果が変わった');
});

test('確かめのページは条件の段: 「②条件」は押せず変わらない。「①入口」は押せる', async () => {
  const page = runPage(html);
  await page.click('sample-load');
  for (let i = 0; i < 4; i++) await page.click('pg-next');
  await page.click('bid-run');
  const here = where(page);
  assert.deepEqual(here.pages, ['pg-confirm']);
  assert.deepEqual(pressable(page), [0]);
  await page.click('step-back-1');
  assert.deepEqual(where(page), here, '確かめで「②条件」を押して変わった');
  await page.click('step-back-0');
  assert.equal(page.el('entry').hidden, false);
});

test('別の道具のページ: どの段にも印が無いので、どれも押せず、押しても変わらない', async () => {
  const page = runPage(html);
  await page.click('entry-tools');
  const here = where(page);
  assert.deepEqual(here.pages, ['pg-tools']);
  assert.deepEqual(pressable(page), []);
  for (const i of [0, 1, 2, 3]) await page.click('step-back-' + i);
  assert.deepEqual(where(page), here);
});

test('見た目: 押せない段は今までどおりの印で、押せる形にしない。前の段だけ押せる形で、キーボードの焦点の枠が付く', () => {
  const base = ruleOf('.step-back');
  assert.ok(base, '.step-back の決まりが無い');
  for (const [k, v] of [['padding', '0'], ['margin', '0'], ['background', 'none'], ['border', '0'], ['color', 'inherit']]) assert.equal(prop(base, k), v, '.step-back の ' + k);
  // 押せないときは button:disabled の灰色の地・枠・cursor: not-allowed を打ち消す(触れても変わらない)
  const off = ruleOf('.step-back:disabled, .step-back:disabled:hover');
  assert.ok(off, '押せない段の決まりが無い');
  for (const [k, v] of [['color', 'inherit'], ['background', 'none'], ['border', '0'], ['cursor', 'default']]) assert.equal(prop(off, k), v, '押せない段の ' + k);
  // 押せる形(下線・指・触れたときの色)は :enabled の段だけ
  for (const r of rules) {
    for (const s of r.sel.split(',').map((x) => x.trim())) {
      if (!/step-back|\.steps|step-dot|step-name/.test(s)) continue;
      if (/cursor:\s*pointer|text-decoration:\s*underline/.test(r.body) || /:hover|:active/.test(s)) {
        assert.ok(/\.step-back:enabled/.test(s) || (/:disabled/.test(s) && !/pointer|underline/.test(r.body)), s + ' が押せない段にも掛かる');
      }
    }
  }
  assert.match(prop(ruleOf('.step-back:enabled .step-name'), 'text-decoration') ?? '', /underline/, '前の段の名前に下線が無い');
  assert.equal(prop(ruleOf('.step-back:enabled'), 'cursor'), 'pointer');
  // 焦点の枠は button 全体の決まりで付く。段のボタンで消していない
  assert.match(screen, /(^|\n)\s*button:focus-visible[^{]*\{[^}]*outline: 2px solid/);
  assert.ok(!rules.some((r) => /step-back/.test(r.sel) && /outline:\s*(none|0)/.test(r.body)), '焦点の枠を消している');
  // 押せる大きさ: ほかのボタンと同じ高さ 44px(ui-visual の決まり)
  assert.equal(prop(base, 'min-height'), '2.75rem');
});

// F57: 結果の枠から aria-live を外し、1行の知らせと短い注記だけに残す。知らせの行に件数を書く。
// 属性の数は固定せず id の一覧で見る。この環境にはブラウザも読み上げソフトも無いので、
// 確かめているのは属性と文までで、実際に読まれるかは見ていない
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildHtml } from '../../build.mjs';
import { runPage, makeXlsx } from '../acceptance/_helpers.mjs';
import { loadLedgerFile, runLedgerCheck, runPlanCheck } from '../../src/ui/app.mjs';
import { BID_FORM_IDS } from '../../src/ui/form.mjs';
import { checkCountText, planCountText, requiredCountText } from '../../src/ui/view.mjs';

const shell = fs.readFileSync(new URL('../../src/ui/shell.html', import.meta.url), 'utf8');
const css = shell.match(/<style>([\s\S]*?)<\/style>/)[1];
const body = (html) => html.slice(html.indexOf('</style>'));

const RESULT_BOXES = ['bid-result', 'taicho-result', 'schedule-result', 'summary', 'open-items', 'ledger-unreadable', 'check-result', 'plan-result', 'ai-result'];
const STATUS_LINES = [
  'bid-status', 'sample-status', 'intake-status', 'drop-status', 'rules-status', 'schedule-status', 'safety-status', 'export-status',
  'ledger-file-status', 'check-status', 'checklist-status', 'plan-status', 'mask-industry-status', 'mask-file-status', 'mask-status',
  'mask-candidate-status', 'dict-status', 'dict-file-status', 'map-status', 'ai-status',
];
const SHORT_NOTES = ['mask-decoy', 'mask-residual'];
const tagOf = (html, id) => html.match(new RegExp('<[a-z0-9]+\\b[^>]*\\bid="' + id + '"[^>]*>'))?.[0];
// 属性は id の前後どちらにも書ける。組み立てた画面の作りを1つの形に固定しない
const liveTags = (html) => [...body(html).matchAll(/<([a-z0-9]+)\b[^>]*\baria-live="polite"[^>]*>/g)].map((m) => ({ tag: m[1], id: m[0].match(/\bid="([^"]+)"/)?.[1] }));

for (const [name, html] of [['shell.html', shell], ['組み立てた画面', buildHtml()]]) {
  test(name + ': 結果の枠9つに aria-live が無い', () => {
    for (const id of RESULT_BOXES) {
      const tag = tagOf(html, id);
      assert.ok(tag, '枠が無い: ' + id);
      assert.doesNotMatch(tag, /aria-live/, id);
    }
  });

  test(name + ': aria-live は知らせの行と短い注記だけに残り、ほかの要素には付いていない', () => {
    const tags = liveTags(html);
    assert.deepEqual(tags.map((t) => t.id).sort(), [...STATUS_LINES, ...SHORT_NOTES].sort());
    assert.deepEqual([...new Set(tags.map((t) => t.tag))], ['p'], '1行の p のほかに残っている');
  });
}

test('CSS の決まりは変えていない。見た目が結果の枠の属性に頼っていない', () => {
  const selectors = [...css.matchAll(/^\s*([^{}\n]*\[aria-live\][^{}\n]*?)\s*\{/gm)].map((m) => m[1]);
  assert.deepEqual(selectors, [
    'p[aria-live]:not(:empty)',
    '.note[aria-live]:not(:empty)',
    '.sample-banner p[aria-live]:not(:empty)',
    'p[aria-live]:not(.note):not(#check-status):not(#checklist-status):not(#plan-status)',
  ]);
});

// 見本の条件で結果を出す(要る項目があり、未回答が残らない形)
async function samplePage() {
  const page = runPage();
  await page.click('sample-load');
  return page;
}
const status = (page, id) => page.el(id).textContent;
const cardNumber = (page) => Number(page.el('result-top').innerHTML.match(/stat-required[^>]*><span class="stat-num">\D*(\d+)</)[1]);
const count = (html, re) => [...html.matchAll(re)].length;

test('bid-status: 頭を残して「要る n項目。」を足し、次の一手も残す。数はカードと同じ', async () => {
  const page = await samplePage();
  await page.click('bid-run');
  const m = status(page, 'bid-status').match(/^✓ 結果が出ました。要る (\d+)項目。下の「次にすること」から読んでください。/);
  assert.ok(m, status(page, 'bid-status'));
  assert.ok(Number(m[1]) > 0, '見本には要る項目があるはず');
  assert.equal(Number(m[1]), cardNumber(page));
  assert.ok(status(page, 'bid-status').includes('「次へ: 3 書類を確かめる」'));
  assert.doesNotMatch(status(page, 'bid-status'), /確認が要る/, '「確認が要る n」は書かない');
});

test('bid-status: 見本の文にも同じ数が入る(結果の枠が読まれないので、見本の道でも数を伝える)', async () => {
  const page = await samplePage();
  const m = status(page, 'bid-status').match(/^✓ 見本を読み込みました。要る (\d+)項目。/);
  assert.ok(m, status(page, 'bid-status'));
  assert.equal(Number(m[1]), cardNumber(page));
});

test('bid-status: 結果が無いときは件数を言わない。金額を読めない・条件が変わった', async () => {
  const page = await samplePage();
  await page.click('bid-run');
  await page.set('contract-amount', '2億円');
  assert.ok(status(page, 'bid-status').startsWith('＊ 条件が変わりました。'), status(page, 'bid-status'));
  assert.doesNotMatch(status(page, 'bid-status'), /要る \d/);
  await page.click('bid-run');
  assert.ok(status(page, 'bid-status').startsWith('＊ 金額の欄を読めませんでした。'), status(page, 'bid-status'));
  assert.doesNotMatch(status(page, 'bid-status'), /要る \d/);
});

test('もう受注した: 全部の行の知らせは変えない。段取りの数は schedule-status に出す', async () => {
  const page = runPage();
  await page.click('entry-awarded');
  assert.doesNotMatch(status(page, 'bid-status'), /要る \d/);
  const m = status(page, 'schedule-status').match(/^段取り (\d+)行。$/);
  assert.ok(m, status(page, 'schedule-status'));
  assert.equal(Number(m[1]), Number(page.el('schedule-result').innerHTML.match(/受注後の段取りは (\d+)件です/)[1]));
});

test('schedule-status: 結果に出した行の数を出し、条件を変えると数を残さない', async () => {
  const page = await samplePage();
  await page.click('bid-run');
  const m = status(page, 'schedule-status').match(/^段取り (\d+)行。$/);
  assert.ok(m, status(page, 'schedule-status'));
  assert.ok(Number(m[1]) > 0);
  assert.equal(Number(m[1]), Number(page.el('schedule-result').innerHTML.match(/受注後の段取りは (\d+)件です/)[1]));
  await page.set('contract-amount', '1000');
  assert.doesNotMatch(status(page, 'schedule-status'), /段取り \d/);
});

test('schedule-status: 表の無い工種では行を数えていないので「0行」と言わない', async () => {
  const page = await samplePage();
  await page.set('work-kind', 'other');
  await page.click('bid-run');
  assert.match(page.el('schedule-result').innerHTML, /この工種の仕様書は見ていない/);
  assert.equal(status(page, 'schedule-status'), '');
});

test('check-status: 候補の数と判断できない数を結果の枠と同じ数で出す', async () => {
  const page = await samplePage();
  const html = page.el('check-result').innerHTML;
  const cands = count(html, /<li class="candidate">/g);
  assert.ok(cands > 0, '見本には候補があるはず');
  const und = Number(html.match(/判断できない\((\d+)件\)/)?.[1] ?? 0);
  assert.equal(status(page, 'check-status'), '台帳の候補 ' + cands + '件' + (und ? '、判断できない ' + und + '件' : '') + '。');
});

test('plan-status: 候補の数を結果の枠と同じ数で出す', async () => {
  const page = await samplePage();
  const cands = count(page.el('plan-result').innerHTML, /<li class="candidate">/g);
  assert.equal(status(page, 'plan-status'), '目次の候補 ' + cands + '件。');
});

test('plan-status: 表の無い工種では「候補 0件」と言わず、判断できない数を出す', async () => {
  const page = await samplePage();
  await page.set('work-kind', 'other');
  await page.click('plan-run');
  assert.equal(status(page, 'plan-status'), '目次: 判断できない 1件。');
  assert.match(page.el('plan-result').innerHTML, /判断できない\(1件\)/);
});

test('件数の文: 0件の形と、判断できないだけのとき', () => {
  assert.equal(requiredCountText({ items: [{ status: 'required' }, { status: 'needs_check' }, { status: 'required' }] }), '要る 2項目。');
  assert.equal(checkCountText({ candidates: [], undecidable: [] }), '台帳の候補 0件。');
  assert.equal(checkCountText({ candidates: [], undecidable: [{}, {}] }), '台帳の候補 0件、判断できない 2件。', '0件だけに見せない');
  assert.equal(planCountText({ candidates: [{}, {}, {}], undecidable: [] }), '目次の候補 3件。');
  assert.equal(planCountText({ candidates: [], undecidable: [{}] }), '目次: 判断できない 1件。');
});

test('台帳・目次を変えると、前の結果の件数を残さない', async () => {
  const page = await samplePage();
  assert.match(status(page, 'check-status'), /台帳の候補/);
  assert.match(status(page, 'plan-status'), /目次の候補/);
  await page.set('ledger-input', '台帳の文を書き換えた');
  assert.doesNotMatch(status(page, 'check-status'), /候補 \d/);
  assert.ok(status(page, 'check-status').startsWith('台帳か条件が変わりました。'), status(page, 'check-status'));
  await page.set('plan-input', '1. 工事概要');
  assert.doesNotMatch(status(page, 'plan-status'), /候補 \d/);
  assert.ok(status(page, 'plan-status').startsWith('目次が変わりました。'), status(page, 'plan-status'));
});

// 作り物の画面には .xlsx を開く DecompressionStream が無いので、ledger-xlsx の試験と同じく関数を直に呼ぶ
test('台帳の Excel を読むと文が替わるので、前の件数を残さない。読めなかったときは前の文のままなので件数も残す', async () => {
  const els = {};
  for (const id of ['ledger-input', 'plan-input']) els[id] = { value: '' };
  for (const id of ['check-result', 'checklist-result', 'ledger-unreadable']) els[id] = { innerHTML: '' };
  for (const id of ['check-status', 'checklist-status', 'ledger-file-status']) els[id] = { textContent: '' };
  const doc = { getElementById: (id) => els[id] ?? null };
  const file = (name, bytes) => ({ name, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });
  els['ledger-input'].value = '| 商号 | 架空一建設株式会社 |';
  runLedgerCheck(doc);
  const counted = els['check-status'].textContent;
  assert.match(counted, /^台帳の候補 \d+件/);
  assert.equal(await loadLedgerFile(doc, file('壊れ.xlsx', new Uint8Array(Buffer.from('not a zip')))), false);
  assert.equal(els['check-status'].textContent, counted);
  assert.equal(await loadLedgerFile(doc, file('台帳.xlsx', makeXlsx([['商号', '架空二建設株式会社']]))), true);
  assert.match(els['ledger-input'].value, /架空二建設株式会社/);
  assert.ok(els['check-status'].textContent.startsWith('台帳か条件が変わりました。'), els['check-status'].textContent);
});

test('台帳・目次が空のときは、結果の枠の誤りのほかに知らせの行でも伝える。貼って押せば件数に替わる', async () => {
  const page = runPage();
  await page.set('ledger-input', '');
  await page.click('ledger-run');
  assert.equal(status(page, 'check-status'), '＊ 台帳の文が空です。');
  await page.set('plan-input', '');
  await page.click('plan-run');
  assert.equal(status(page, 'plan-status'), '＊ 目次が空です。');
  await page.set('plan-input', '1. 工事概要');
  await page.click('plan-run');
  assert.match(status(page, 'plan-status'), /^目次の候補 \d+件。$/);
});

test('点検が途中で止まったときも知らせの行で伝え、件数は出さない', () => {
  const els = {};
  for (const id of ['ledger-input', 'plan-input']) els[id] = { value: '架空の文' };
  for (const id of ['check-result', 'plan-result', 'checklist-result']) els[id] = { innerHTML: '' };
  for (const id of ['check-status', 'plan-status', 'checklist-status']) els[id] = { textContent: '' };
  const doc = { getElementById: (id) => { if (BID_FORM_IDS.includes(id)) throw new Error('試験の止まり'); return els[id] ?? null; } };
  runLedgerCheck(doc);
  assert.equal(els['check-status'].textContent, '＊ 点検の途中で止まりました。下の知らせを読んでください。');
  assert.match(els['check-result'].innerHTML, /点検の途中で止まりました/);
  runPlanCheck(doc);
  assert.equal(els['plan-status'].textContent, '＊ 点検の途中で止まりました。下の知らせを読んでください。');
  assert.match(els['plan-result'].innerHTML, /点検の途中で止まりました/);
});

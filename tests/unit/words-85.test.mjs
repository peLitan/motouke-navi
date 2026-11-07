// F85d: 文言の言い換え3つ。戻るの語を確かめの画面のボタンにそろえる / 失敗の知らせの頭の「＊」を除く(CSS が「× 失敗: 」を付ける) /
// 「この道具」を画面の語「このツール」にする。組み立てた画面の値で確かめる。値はすべて架空
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildHtml } from '../../build.mjs';
import { runPage } from '../acceptance/_helpers.mjs';
import { bidCheck } from '../../src/bid-check.mjs';

const read = (p) => fs.readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const html = buildHtml();
const BACK = '「条件を入れる」に戻る';
const OLD_BACK = '1 条件に戻る';
const NOTICE_AMOUNT = '金額の欄を読めませんでした。「条件を入れる」に戻って直し、もう一度「確認する」を押してください。';
const NOTICE_HALTED = '判定の途中で止まりました。結果の欄の知らせを読んでください。';

const go = (page) => page.el('result-top').innerHTML.match(/class="next-go"[^>]*>([^<]*)</)?.[1];
const line = (page) => page.el('bid-status').textContent;
const kind = (page) => page.el('bid-status').getAttribute('data-kind');
const sample = async () => {
  const page = runPage(html);
  await page.click('sample-load');
  await page.click('confirm-go');
  return page;
};

test('戻るの語: 組み立てた画面に「1 条件に戻る」が無く、確かめの画面のボタンは下の帯の「戻る」', () => {
  assert.ok(!html.includes(OLD_BACK));
  assert.ok(html.includes('<button type="button" id="confirm-back">戻る</button>'));
});

test('戻るの語: 金額の失敗の枝の go', async () => {
  const page = runPage(html);
  await page.set('contract-amount', '約2億円');
  await page.click('bid-run');
  assert.match(page.el('result-top').innerHTML, /金額の欄を直す/);
  assert.equal(go(page), BACK);
});

test('戻るの語: 条件が変わった枝の go', async () => {
  const page = await sample();
  await page.set('contract-amount', '1000');
  assert.match(page.el('result-top').innerHTML, /もう一度「確認する」を押す/);
  assert.equal(go(page), BACK);
});

test('戻るの語: 未回答の枝の go', async () => {
  const page = runPage(html);
  await page.click('bid-run');
  assert.match(page.el('result-top').innerHTML, /未回答の質問 \d+つに答える/);
  assert.equal(go(page), BACK);
});

test('失敗の知らせ: 金額の失敗は「金額の欄を読めませんでした。」で始まり、＊ が無く、data-kind が error', async () => {
  const page = runPage(html);
  await page.set('contract-amount', '約2億円');
  await page.click('bid-run');
  assert.equal(line(page), NOTICE_AMOUNT);
  assert.ok(line(page).startsWith('金額の欄を読めませんでした。'));
  assert.equal(kind(page), 'error');
});

test('失敗の知らせ: 判定の途中で止まった文も ＊ が無く、data-kind が error', async () => {
  const broken = html.replace('const bid = bidCheck(input);', "throw new Error('架空の止まり');");
  assert.notEqual(broken, html, '判定の呼び出しの文が見つからない');
  const page = runPage(broken);
  await page.click('bid-run');
  assert.equal(line(page), NOTICE_HALTED);
  assert.equal(kind(page), 'error');
});

test('失敗ではない知らせの ＊ は変えない: 条件が変わった文は ＊ で始まり、印が付かない', async () => {
  const page = await sample();
  await page.set('contract-amount', '1000');
  assert.ok(line(page).startsWith('＊ 条件が変わりました。'), line(page));
  assert.equal(kind(page), null);
});

test('「この道具」: bid-check の文に無く、特例の文は「このツール」で出る', () => {
  const base = { orderer: 'public', direct: true, workType: 'other', hasSubcontract: false, subcontractTotal: 0, license: 'tokutei', engineerQualification: 'kanri' };
  for (const contractAmount of [50_000_000, 200_000_000]) {
    const bid = bidCheck({ ...base, contractAmount });
    const all = JSON.stringify(bid);
    assert.ok(!all.includes('この道具'), all);
    assert.ok(bid.checks.find((c) => c.key === 'dedicated').message.includes('このツールは特例を判定していません。'));
  }
  assert.ok(!read('src/bid-check.mjs').includes('この道具'));
});

test('「この道具」: data/safety.json の文に無く、2つの note は「このツール」で出る', () => {
  const raw = read('data/safety.json');
  assert.ok(!raw.includes('この道具'));
  assert.equal(raw.match(/このツールには取り込んでいません/g)?.length, 2);
});

test('変えない物: 写しに入る文と CLI・枠の文の「この道具」は残す', () => {
  assert.ok(read('src/estimate/kyotsuhi.mjs').includes('この道具'));
  assert.ok(read('src/ui/app.mjs').includes('この道具の枠'));
  assert.ok(read('scripts/cli.mjs').includes('この道具は引数を取りません'));
});

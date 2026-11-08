// F78a: 見本の値を変えて「この内容で結果を見る」と進んだとき、帯と知らせが変わったことを伝える。前に見せた結果からの差も添える
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { resultDiffText, resultSnapshot } from '../../src/ui/view.mjs';
import { SAMPLE } from '../../src/sample.mjs';
import { bidCheck } from '../../src/bid-check.mjs';
import { readBidForm } from '../../src/ui/form.mjs';
import { runPage } from '../acceptance/_helpers.mjs';

const status = (page) => page.el('bid-status').textContent;
const banner = (page) => page.el('sample-status').textContent;
const NEXT = '「次にすること」から読んでください。';
const DIFF_40M = '前の結果から: 要る 6→5、確認が要る点 2→1。技術者を専任で置く必要があるか: 要る→要らない。';
const LOADED = '見本「' + SAMPLE.title + '」を読み込みました。' + SAMPLE.note + ' 欄の値を変えて、もう一度「確認する」を押すこともできます。';
const changedBanner = (n) => '見本「' + SAMPLE.title + '」から ' + n + '欄を変えました(架空の工事を元にしています。実在のものとは関係ありません)。';

async function samplePage() {
  const page = runPage();
  await page.click('sample-load');
  await page.click('confirm-go');
  return page;
}
// 結果から条件へ戻る(F86b: 進み具合は押せないので下の帯の「戻る」で。結果 → 確かめ → 条件)
async function toConditions(page) {
  await page.click('pg-back');
  await page.click('confirm-back');
}
// 段1 へ戻って欄を変え、確かめの画面を通って結果を見る(README 手順2 の押し方)
async function changeAndGo(page, fields) {
  await toConditions(page);
  for (const [id, v] of Object.entries(fields)) await page.set(id, v);
  await page.click('bid-run');
  await page.click('confirm-go');
}

test('見本の請負代金を変えて進む: 帯は変えた欄の数、知らせは結果が出た文で、前の結果からの差が末尾に付く', async () => {
  const page = await samplePage();
  await changeAndGo(page, { 'contract-amount': '40,000,000' });
  assert.equal(banner(page), changedBanner(1));
  assert.doesNotMatch(banner(page), /44,000,000円/, '見本の金額の文を残さない');
  assert.equal(status(page), '✓ 結果が出ました。要る 5項目。' + NEXT + DIFF_40M);
  assert.doesNotMatch(status(page), /見本を読み込みました/);
  assert.equal(page.el('panel-2').hidden, false);
});

test('差の数は結果の一番上のカードと同じ', async () => {
  const page = await samplePage();
  const cards = () => [...page.el('result-top').innerHTML.matchAll(/stat-(required|check)[^>]*><span class="stat-num">\D*(\d+)</g)].map((m) => m[2]);
  assert.deepEqual(cards(), ['6', '2']);
  await changeAndGo(page, { 'contract-amount': '40,000,000' });
  assert.deepEqual(cards(), ['5', '1']);
  assert.ok(status(page).includes('要る 6→5、確認が要る点 2→1。'), status(page));
});

test('変えずに進む: 読み込んだときの知らせと帯のまま。差も付かない', async () => {
  const page = runPage();
  await page.click('sample-load');
  await page.click('bid-run');
  await page.click('confirm-go');
  assert.equal(status(page), '✓ 見本を読み込みました。要る 6項目。' + NEXT);
  assert.equal(banner(page), LOADED);
});

test('「確認する」だけでは帯を変えず、差も足さない', async () => {
  const page = await samplePage();
  await toConditions(page);
  await page.set('contract-amount', '40,000,000');
  await page.click('bid-run');
  assert.equal(status(page), '✓ 結果が出ました。要る 5項目。' + NEXT);
  assert.equal(banner(page), LOADED);
  assert.equal(page.el('panel-confirm').hidden, false);
});

test('差は前に見せた結果と比べる。同じ値で進み直すと差は付かず、結果が同じなら欄を変えても付かない', async () => {
  const page = await samplePage();
  await changeAndGo(page, { 'contract-amount': '40,000,000' });
  await changeAndGo(page, { 'contract-amount': '40,000,000' });
  assert.equal(status(page), '✓ 結果が出ました。要る 5項目。' + NEXT, '同じ値どうしで差を出している');
  await changeAndGo(page, { 'contract-amount': '50,000,000' });
  assert.ok(status(page).endsWith('前の結果から: 要る 5→6、確認が要る点 1→3。技術者を専任で置く必要があるか: 要らない→要る。'), status(page));
  await changeAndGo(page, { 'contract-amount': '50,000,001' });
  assert.equal(status(page), '✓ 結果が出ました。要る 6項目。' + NEXT);
  assert.equal(banner(page), changedBanner(1));
});

test('見本の値に戻す: 帯は読み込んだときの文に戻り、知らせも見本の文になる。前の結果からの差は残る', async () => {
  const page = await samplePage();
  await changeAndGo(page, { 'contract-amount': '40,000,000' });
  assert.equal(banner(page), changedBanner(1));
  await changeAndGo(page, { 'contract-amount': String(SAMPLE.form['contract-amount']) });
  assert.equal(banner(page), LOADED);
  assert.equal(status(page), '✓ 見本を読み込みました。要る 6項目。' + NEXT + '前の結果から: 要る 5→6、確認が要る点 1→2。技術者を専任で置く必要があるか: 要らない→要る。');
});

test('変えた欄の数: 別の欄・消した欄・読めない値も数える', async () => {
  const page = await samplePage();
  await changeAndGo(page, { orderer: 'private', 'subcontract-total': '' });
  assert.equal(banner(page), changedBanner(2));
  await changeAndGo(page, { 'contract-amount': '4千万の見込み' });
  assert.equal(banner(page), changedBanner(3));
});

test('読めない金額: 失敗の文をそのまま出して印を付け、差を付けない。直したら最後に見せた結果と比べる', async () => {
  const page = await samplePage();
  await changeAndGo(page, { 'contract-amount': '4千万の見込み' });
  assert.ok(status(page).startsWith('金額の欄を読めませんでした。'), status(page));
  assert.doesNotMatch(status(page), /前の結果から/);
  assert.equal(page.el('bid-status').getAttribute('data-kind'), 'error');
  await changeAndGo(page, { 'contract-amount': '40,000,000' });
  assert.equal(page.el('bid-status').getAttribute('data-kind'), null);
  assert.ok(status(page).endsWith(DIFF_40M), status(page));
});

test('仮の結果: カードが「−」のときは差の数も「−」。要る 0 と言わない', async () => {
  const page = await samplePage();
  const blank = Object.fromEntries(['orderer', 'work-type', 'license', 'engineer-qualification', 'contract-amount', 'subcontract-total'].map((id) => [id, '']));
  await changeAndGo(page, blank);
  assert.equal(page.el('result-top').innerHTML.match(/stat-required[^>]*><span class="stat-num">([^<]*)</)[1], '−');
  assert.ok(status(page).startsWith('＊ 仮の結果が出ました(未回答 '), status(page));
  const points = page.el('result-top').innerHTML.match(/stat-check[^>]*><span class="stat-num">\D*(\d+)</)[1];
  assert.notEqual(points, '2', '確認が要る点の数も変わる形で見る');
  assert.ok(status(page).includes('前の結果から: 要る 6→−、確認が要る点 2→' + points + '。'), status(page));
  await changeAndGo(page, Object.fromEntries(Object.keys(blank).map((id) => [id, SAMPLE.form[id]])));
  assert.match(status(page), /前の結果から: 要る −→6、/);
});

test('自分の工事で入れ直す: 帯は空。そのあと進んでも差は付かない', async () => {
  const page = await samplePage();
  await changeAndGo(page, { 'contract-amount': '40,000,000' });
  await page.click('sample-reenter');
  assert.equal(banner(page), '');
  assert.equal(page.el('sample-banner').hidden, true);
  await page.click('bid-run');
  await page.click('confirm-go');
  assert.equal(banner(page), '');
  assert.doesNotMatch(status(page), /前の結果から|見本/, status(page));
});

test('見本を読み込み直すと、前の結果は読み込んだ見本になる', async () => {
  const page = await samplePage();
  await changeAndGo(page, { 'contract-amount': '40,000,000' });
  await page.click('sample-load');
  assert.equal(banner(page), LOADED);
  await page.click('confirm-go');
  assert.equal(status(page), '✓ 見本を読み込みました。要る 6項目。' + NEXT);
});

const snap = (form) => resultSnapshot(bidCheck(readBidForm(form)), form);
test('resultDiffText: 差が無ければ空。数が同じでも状態が変われば項目を書き、変わらない数は書かない', () => {
  const a = snap(SAMPLE.form);
  assert.equal(resultDiffText(a, a), '');
  const item = (key, status) => ({ key, label: key, status });
  const base = { required: 1, points: 0 };
  assert.equal(
    resultDiffText({ ...base, items: [item('x', 'required'), item('y', 'not_required')] }, { ...base, items: [item('x', 'not_required'), item('y', 'required')] }),
    '前の結果から: x: 要る→要らない、y: 要らない→要る。',
  );
  assert.equal(resultDiffText({ required: 1, points: 2, items: [] }, { required: 1, points: 3, items: [] }), '前の結果から: 確認が要る点 2→3。');
  assert.equal(resultDiffText({ required: 1, points: 2, items: [] }, { required: 4, points: 2, items: [] }), '前の結果から: 要る 1→4。');
});

test('resultDiffText: 項目の名前は2つまでで、残りは数で書く。名前が同じ順で出る', () => {
  const a = snap(SAMPLE.form);
  const b = snap({ ...SAMPLE.form, direct: false, 'direct-sub': true });
  assert.equal(
    resultDiffText(a, b),
    '前の結果から: 要る 6→2、確認が要る点 2→1。特定建設業の許可: 要る→要らない、施工体制台帳: 要る→要らない、ほか 2項目。',
  );
});

test('resultSnapshot: 要るの数は決まった項目の数。仮の結果なら「−」', () => {
  assert.equal(snap(SAMPLE.form).required, 6);
  assert.equal(snap(SAMPLE.form).points, 2);
  const unanswered = { orderer: '', 'work-type': '', license: '', 'engineer-qualification': '', 'contract-amount': '', 'subcontract-total': '' };
  const s = snap(unanswered);
  assert.equal(s.required, '−');
  assert.ok(s.items.some((it) => it.status === 'unanswered'));
});

test('README: 試し方の文と手順2 に、結果から条件へ戻る押し方がある(F86j でページの語にした)', () => {
  const lines = fs.readFileSync(new URL('../../README.md', import.meta.url), 'utf8').split('\n');
  const line = lines.find((l) => l.includes('入力欄の値を変えて'));
  assert.ok(line.includes('要点のページの「戻る」で確かめのページへ戻り、「条件を直す」から'), line);
  const step2 = fs.readFileSync(new URL('../../docs/details.md', import.meta.url), 'utf8').split('\n').find((l) => l.startsWith('2. 入口の「まず見本で試す」を押す。'));
  assert.ok(step2.includes('「戻る」で確かめのページへ戻り、「条件を直す」の「請負代金の見込みを変更」で請負代金を変え、「次へ」で公告のページまで進んで「確認する」'));
});

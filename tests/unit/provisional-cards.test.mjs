// F62b: 未回答が残り、決まった「要る」の項目が無いときは、0 と言い切らず仮の結果と書く。
// カードと知らせの行が同じ判定を使うことを、組み立てた画面の上で確かめる
import test from 'node:test';
import assert from 'node:assert/strict';
import { runPage } from '../acceptance/_helpers.mjs';
import { provisionalUnanswered, QUESTIONS } from '../../src/ui/answers.mjs';

const status = (page) => page.el('bid-status').textContent;
const cards = (page) => [...page.el('result-top').innerHTML.matchAll(/<span class="stat-num">([^<]*)<\/span><span class="stat-lab">([^<]*)<\/span><span class="stat-sub">([^<]*)<\/span>/g)].map((m) => m.slice(1));
const requiredCard = (page) => cards(page).find((c) => c[1] === '要るものの候補');
const nextTitle = (page) => page.el('result-top').innerHTML.match(/<p class="next-title">([^<]*)<\/p>/)[1];
const PROVISIONAL = /^＊ 仮の結果が出ました\(未回答 (\d+)問\)。下の「次にすること」から読んでください。/;
const NUMBER_FIELDS = ['contract-amount', 'subcontract-total'];
const CHOICE_FIELDS = ['orderer', 'work-type', 'license', 'engineer-qualification'];

async function allUnknown(page) {
  for (const k of CHOICE_FIELDS) await page.set(k, 'unknown');
  for (const k of NUMBER_FIELDS) await page.set(k + '-unknown', true);
  await page.set('direct-unknown', true);
}

test('何も入れない: カードは「−」、知らせは「＊ 仮の結果」で、数は「次にすること」と同じ', async () => {
  const page = runPage();
  await page.click('bid-run');
  assert.deepEqual(requiredCard(page), ['−', '要るものの候補', '質問に答えると出ます']);
  const m = status(page).match(PROVISIONAL);
  assert.ok(m, status(page));
  assert.equal(Number(m[1]), QUESTIONS.length);
  assert.equal(nextTitle(page), '次にすること: 未回答の質問 ' + m[1] + 'つに答える');
  assert.ok(status(page).includes('結果が出ました'), status(page));
  assert.ok(status(page).includes('「次へ: 書類を確かめる」'), '次の一手が消えた');
  assert.ok(!status(page).includes('✓'), '仮の結果に ✓ が付いている');
  assert.doesNotMatch(status(page), /要る \d/, '仮の結果に要る項目の数を書いている');
});

test('答えると未回答の数が減り、知らせの数も追いかける', async () => {
  const page = runPage();
  await page.set('contract-amount', '1000');
  await page.click('bid-run');
  assert.equal(status(page).match(PROVISIONAL)?.[1], String(QUESTIONS.length - 1), status(page));
  assert.equal(requiredCard(page)[0], '−');
});

test('要る項目が出たら、未回答が残っていても「✓ 結果が出ました。要る n項目。」に戻る。カードは数のまま', async () => {
  const page = runPage();
  await page.click('sample-load');
  await page.set('license', '');
  await page.click('bid-run');
  const m = status(page).match(/^✓ 結果が出ました。要る (\d+)項目。/);
  assert.ok(m, status(page));
  assert.ok(Number(m[1]) > 0);
  assert.deepEqual(requiredCard(page), ['● ' + m[1], '要るものの候補', '受注したら要るものの候補(項目)。仮の一覧']);
  assert.match(nextTitle(page), /未回答の質問 1つに答える/);
});

test('全問に答えて要る項目が無いときは、0 は決まった数なので今までどおり', async () => {
  const page = runPage();
  await allUnknown(page);
  await page.click('bid-run');
  assert.ok(status(page).startsWith('✓ 結果が出ました。要る 0項目。'), status(page));
  assert.deepEqual(requiredCard(page), ['● 0', '要るものの候補', '受注したら要るものの候補(項目)']);
});

test('確かめの画面を通っても同じ。見本の欄を消した形でも「見本を読み込みました」と言わない', async () => {
  const own = runPage();
  await own.click('bid-run');
  await own.click('confirm-go');
  assert.match(status(own), PROVISIONAL);
  const sample = runPage();
  await sample.click('sample-load');
  for (const k of [...CHOICE_FIELDS, ...NUMBER_FIELDS]) await sample.set(k, '');
  await sample.click('bid-run');
  await sample.click('confirm-go');
  assert.match(status(sample), PROVISIONAL);
  assert.equal(requiredCard(sample)[0], '−');
});

test('見本はそのままでは仮の結果にならない', async () => {
  const page = runPage();
  await page.click('sample-load');
  assert.ok(status(page).startsWith('✓ 見本を読み込みました。要る 6項目。'), status(page));
  await page.click('confirm-go');
  assert.doesNotMatch(status(page), /仮の結果/);
});

test('条件を変えたら仮の文を残さない。「確認する」を押すまでカードは前の条件のまま', async () => {
  const page = runPage();
  await page.click('bid-run');
  await allUnknown(page);
  assert.ok(status(page).startsWith('＊ 条件が変わりました。'), status(page));
  assert.doesNotMatch(status(page), /仮の結果/);
  assert.equal(requiredCard(page)[0], '−', '押す前の欄の値でカードが変わった');
  await page.click('bid-run');
  assert.ok(status(page).startsWith('✓ 結果が出ました。要る 0項目。'), status(page));
  assert.equal(requiredCard(page)[0], '● 0');
});

test('もう受注した: 段取りの知らせは仮の文に替えない(要る項目のことを言っていない)', async () => {
  const page = runPage();
  await page.click('bid-run');
  await page.click('entry-back');
  await page.click('entry-awarded');
  assert.ok(status(page).startsWith('✓ 入れた条件の段取りを出しています。'), status(page));
});

test('provisionalUnanswered: 未回答が残り要る項目が無いときだけ未回答の数を返す', () => {
  const none = { items: [{ key: 'a', status: 'not_required' }, { key: 'b', status: 'needs_check' }] };
  const some = { items: [{ key: 'a', status: 'required' }] };
  assert.equal(provisionalUnanswered(none, {}), QUESTIONS.length);
  assert.equal(provisionalUnanswered(none, { 'contract-amount': '1000' }), QUESTIONS.length - 1);
  assert.equal(provisionalUnanswered(some, {}), 0);
  assert.equal(provisionalUnanswered(none, null), 0, '欄の値が無いときは未回答を数えない');
  assert.equal(provisionalUnanswered(none, undefined), 0);
});

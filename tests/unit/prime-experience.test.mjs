// F49a: 元請けとしての施工実績を求める公告の知らせ。文はすべて架空
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { findPrimeExperience } from '../../src/prime-experience.mjs';
import { bidCheck } from '../../src/bid-check.mjs';
import { readBidForm } from '../../src/ui/form.mjs';
import { needsCheckPoints } from '../../src/ui/answers.mjs';
import { renderBidResult, renderOpenItems } from '../../src/ui/view.mjs';
import { stage1Rows } from '../../src/export.mjs';
import { judgeTaicho } from '../../src/taicho.mjs';
import { parseIntakeFile, intakeLines } from '../../src/intake-load.mjs';
import { SAMPLE } from '../../src/sample.mjs';
import { buildHtml } from '../../build.mjs';
import { runPage } from '../acceptance/_helpers.mjs';

const POINT = 'prime-experience';
const check = (text) => bidCheck({ ...readBidForm(SAMPLE.form), participationConditions: text });
const has = (out) => out.checks.some((c) => c.key === POINT);

test('元請けの実績を求める文は当たる(書き方の違い・PDF の折り返し)', () => {
  for (const s of [
    '平成29年度以降に、元請けとして同種工事の施工実績を有すること。',
    '元請として完成した工事の実績を有すること。',
    '元請負人としての同種の工事の施工実績があること。',
    '平成２２年度以降に元請けとして完成・引き渡しが完了した\n      同種工事の施工実績を有すること。',
    '発注者を問わず、元請けとしての施工実績を有すること。',
    '同種・類似公共工事の 元請けとしての実績 要',
    '国、地方公共団体、民間を問わず元請けとして同種工事の実績を有すること。',
    '同種工事の施工実績(下請けとしての実績は含まない)を有すること。',
    '元請けとしての施工実績を有すること(下請けとしての実績は含めない)。',
  ]) assert.ok(findPrimeExperience(s), s);
});

test('元請け・下請けを問わない実績の条件は当たらない', () => {
  for (const s of [
    '元請け、下請けを問わず同種工事の施工実績を有すること。',
    '元請・下請の別を問わず、同種工事の実績を有すること。',
    '元請けであるか下請けであるかを問わず、施工実績を有すること。',
    '元請け又は下請けとして同種工事の施工実績を有すること。',
    '元請けとしての実績のほか、下請けとしての実績も認める同種工事の施工実績を有すること。',
    '同種工事の施工実績を有すること(下請けでも可)。',
  ]) assert.equal(findPrimeExperience(s), null, s);
});

test('実績の条件が無い文・参加の条件でない文・技術者の経験は当たらない', () => {
  for (const s of [
    '', null, undefined,
    '一般競争入札参加資格を有すること。',
    '同種工事の施工実績を有すること。',
    '元請けとして施工体制台帳を作成すること。',
    '施工実績は問わない。',
    '元請けとしての施工実績の有無は問わない。',
    '元請けとしての同種工事の実績がある場合は加点する。',
    '配置予定技術者は、元請けとして同種工事の施工実績を有する者であること。',
    '工事で元請けとしての経験を有する者であること。',
    '同種・類似公共工事の 元請けとしての実績 不要',
    'ただし、元請けとして施工した架空市発注工事については、工事成績が65点未満のものは、本施工実績とはならない。',
  ]) assert.equal(findPrimeExperience(s), null, String(s));
});

test('文を分けて見る: 別の文の元請けと実績を結び付けない。問わない文と当たる文が並べば当たる文を返す', () => {
  assert.equal(findPrimeExperience('元請けは工程を管理する。\n同種工事の施工実績を有すること。'), null);
  assert.equal(findPrimeExperience('(1) 元請けとして入札すること\n(2) 同種工事の施工実績を有すること'), null);
  assert.equal(findPrimeExperience('元請け、下請けを問わず同種の工事の実績があること。また、元請けとして施工実績を有すること。'), 'また、元請けとして施工実績を有すること。');
});

test('入札前の確認: 文のとおりの知らせに抜き書きが付き、言い切らない。断り書きはいつも出る', () => {
  const quote = '平成29年度以降に、元請けとして同種工事の施工実績を有すること。';
  const out = check('(3) ' + quote);
  const c = out.checks.find((x) => x.key === POINT);
  assert.match(c.message, /^この工事は元請けとしての施工実績を参加の条件にしています。初めて元請けをする会社は参加できない場合があります。/);
  assert.match(c.message, /発注者が認める実績の範囲は、公告と説明書で確かめて/);
  assert.ok(c.message.includes('「(3) ' + quote + '」'));
  assert.ok(!/参加できません|参加できない(?!場合)/.test(c.message));
  assert.ok(out.disclaimer);
  assert.equal(out.disclaimer, check('').disclaimer);
  assert.ok(!has(check('元請け、下請けを問わず同種工事の施工実績を有すること。')));
  assert.ok(!has(check('')));
});

test('知らせは判定の項目を変えず、結果の画面・最後の一覧・書き出しに「確認が要る」で出る', () => {
  const input = readBidForm(SAMPLE.form);
  const before = bidCheck(input);
  const out = bidCheck({ ...input, participationConditions: '元請けとして同種工事の施工実績を有すること。' });
  assert.deepEqual(out.items, before.items);
  assert.equal(out.checks.length, before.checks.length + 1);
  assert.equal(needsCheckPoints(out, SAMPLE.form).length, needsCheckPoints(before, SAMPLE.form).length + 1);
  assert.equal(needsCheckPoints(out, SAMPLE.form).at(-1).status, 'needs_check');
  assert.match(renderBidResult(out, SAMPLE.form), /元請けの施工実績/);
  assert.match(renderOpenItems(out, SAMPLE.form), /元請けの施工実績/);
  const rows = stage1Rows(out, judgeTaicho(input), '注意');
  const row = rows.find((r) => r.includes('元請けの施工実績'));
  assert.ok(row.includes('確認が要る'), row.join('|'));
});

test('見本: 架空公告の拾った条件から欄の文が作られて知らせが出る。工事の見本には出ない', () => {
  const sample = fs.readFileSync(new URL('../../docs/samples/bid-intake/画面に入れる条件.json', import.meta.url), 'utf8');
  const t = parseIntakeFile(sample);
  assert.equal(findPrimeExperience(t.participation), '平成29年度以降に、元請けとして同種工事の施工実績を有すること。');
  assert.ok(intakeLines(t).some((x) => x.startsWith('確認が要る 元請けの施工実績')));
  assert.ok(!has(bidCheck(readBidForm(SAMPLE.form))));
});

test('読み込み: 「公告に書いていない」の施工実績は欄に入らず、知らせも出ない', () => {
  const t = parseIntakeFile(JSON.stringify({ kind: 'bid-intake', source: { title: '架空' }, rows: [{ key: 'past-work', label: '施工実績', status: '公告に書いていない', quote: '' }] }));
  assert.equal(t.participation, '');
  assert.ok(!intakeLines(t).some((x) => x.includes('元請け')));
});

const QUOTE = '平成29年度以降に、元請けとして同種工事の施工実績を有すること。';
const intakeFile = (rows) => JSON.stringify({ kind: 'bid-intake', source: { title: '架空の公告' }, rows, form: {} });
async function load(page, text) {
  page.el('intake-load').files = [{ size: text.length, text: async () => text }];
  await page.set('intake-load', '');
}

test('画面: 読み込むと欄と結果に出て、条件の無い公告へ替えると前の文が残らない', async () => {
  const page = runPage(buildHtml());
  await page.click('entry-bid');
  await load(page, intakeFile([{ key: 'past-work', label: '施工実績', status: '拾えた', quote: QUOTE }]));
  assert.equal(page.el('participation-conditions').value, QUOTE);
  assert.match(page.el('intake-result').innerHTML, /確認が要る 元請けの施工実績/);
  await page.click('bid-run');
  assert.match(page.el('confirm-value-participation-conditions').innerHTML, /元請けとして.*出どころ: 公告.*推定/);
  await page.click('confirm-go');
  assert.match(page.el('bid-result').innerHTML, /この工事は元請けとしての施工実績を参加の条件にしています/);
  assert.ok(page.el('bid-result').innerHTML.includes(QUOTE));
  assert.ok(page.el('bid-result').innerHTML.includes('人がしてください'));

  await load(page, intakeFile([{ key: 'past-work', label: '施工実績', status: '公告に書いていない' }]));
  assert.equal(page.el('participation-conditions').value, '');
  await page.click('bid-run');
  await page.click('confirm-go');
  assert.ok(!/元請けの施工実績/.test(page.el('bid-result').innerHTML));
});

test('画面: 手で入れた文でも出る。元請け下請けを問わない文では出ない。貼った文の記号は画面でそのまま文字になる', async () => {
  const page = runPage(buildHtml());
  await page.click('entry-bid');
  await page.set('participation-conditions', '元請けとして<b>同種工事</b>の施工実績を有すること。');
  await page.click('bid-run');
  assert.match(page.el('confirm-value-participation-conditions').innerHTML, /出どころ: 手入力/);
  await page.click('confirm-go');
  assert.ok(page.el('bid-result').innerHTML.includes('&lt;b&gt;同種工事'));
  await page.set('participation-conditions', '元請け、下請けを問わず同種工事の施工実績を有すること。');
  await page.click('bid-run');
  await page.click('confirm-go');
  assert.ok(!/元請けの施工実績/.test(page.el('bid-result').innerHTML));
});

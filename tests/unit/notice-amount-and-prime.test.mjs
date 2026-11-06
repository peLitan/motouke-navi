// F60a: 公告の照合で空白のある額を読み、元請けの実績の見落としと誤報を直す。文と値はすべて架空
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkConditions, parseAmounts, declaredUnit } from '../../plugin/skills/bid-intake/scripts/check-conditions.mjs';
import { findPrimeExperience } from '../../src/prime-experience.mjs';
import { bidCheck } from '../../src/bid-check.mjs';
import { readBidForm } from '../../src/ui/form.mjs';
import { SAMPLE } from '../../src/sample.mjs';
import { buildHtml } from '../../build.mjs';
import { runPage } from '../acceptance/_helpers.mjs';

const yen = (s) => parseAmounts(s).map((a) => a.yen);
const YEN = 134200000;
const src = (text, file = '公告.txt') => ({ file, text });
const run = (sources, value, quote) => checkConditions({ source: { title: '架空の公告' }, conditions: [{ key: 'budget', value, quote }] }, sources);

test('額: 数字と単位のあいだ・単位と次の数字のあいだに空白があっても同じ額で読む', () => {
  for (const s of [
    '134,200,000円', // 空白の無い形も同じ
    '134,200,000 円',
    '１３４，２００，０００　円',
    '1億3,420万 円',
    '1億 3,420万円',
    '1億 3,420 万 円',
    '1 億 3,420 万\t円',
    '１億　３，４２０万　円',
  ]) assert.deepEqual(yen(s), [YEN], s);
  assert.deepEqual(yen('1億 円'), [100000000]);
  assert.deepEqual(yen('1億 2,000万 500 円'), [120000500]);
  assert.deepEqual(yen('予定価格 金 82,500,000 円(税込み) 最低制限価格 70,000,000 円'), [82500000, 70000000]);
});

test('額: 抜き書きの位置と長さは元の文のまま(後ろの語の確かめに使う)', () => {
  const s = '工事費 1,000 円以上';
  const [a] = parseAmounts(s);
  assert.equal(a.raw, '1,000 円');
  assert.equal(s.slice(a.index + a.raw.length), '以上');
  assert.equal(parseAmounts('１億　３，４２０万　円')[0].raw.length, '１億　３，４２０万　円'.length);
  assert.equal(parseAmounts('12,34,000 円')[0].badComma, true);
  assert.equal(parseAmounts('1,234,000 円')[0].badComma, false);
});

test('額でないもの: 「円」で始まる語の前の数は読まない(空白があっても無くても)', () => {
  for (const s of ['3 円滑に', '3円滑に', '3　円滑に進める', '120 円形の管', '120円形の管', '2 円周方向', '5 円筒形', '4 円盤', '6 円柱', '7 円錐', '8 円弧', '1億 円滑', '3 万 円滑']) {
    assert.deepEqual(yen(s), [], s);
  }
  assert.deepEqual(yen('100 円 円滑に'), [100], '額のあとの語は巻き込まない');
});

test('改行をまたいで読まない', () => {
  assert.deepEqual(yen('134,200,000\n円'), []);
  assert.deepEqual(yen('134,200,000\r\n円'), []);
  assert.deepEqual(yen('120\n円形の管'), []);
  assert.deepEqual(yen('1億3,420万\n円'), []);
  assert.deepEqual(yen('1億\n3,420万円'), [34200000], '億の行はつなげない');
  assert.deepEqual(yen('1\n億 3,420万円'), [34200000]);
});

test('単位の語: 空白があっても額に数えず、原文の宣言として読む', () => {
  for (const s of ['(単位:千 円)', '(単位:千　円)', '(単位:百万 円)', '(単位:百 万円)', '(単位:千円)', '(単位:百万円)']) assert.deepEqual(yen(s), [], s);
  assert.deepEqual(yen('(単位:千 円) 12,000 円'), [12000]);
  assert.deepEqual(declaredUnit('(単位:千 円)'), { word: '千円', yen: 1000 });
  assert.deepEqual(declaredUnit('(単位:千　円)'), { word: '千円', yen: 1000 });
  assert.deepEqual(declaredUnit('(単位:百万 円)'), { word: '百万円', yen: 1000000 });
  assert.deepEqual(declaredUnit('(単位:万 円)'), { word: '万円', yen: 10000 });
  assert.equal(declaredUnit('(単位:円)'), null);
});

test('照合: 値が正しければ空白があっても「単位が無い」にしない。空白の無い形と同じ結果', () => {
  for (const q of ['予定価格 134,200,000 円(税込み)', '予定価格 １３４，２００，０００　円(税込み)', '予定価格 1億3,420万 円(税込み)', '予定価格 1億 3,420万円(税込み)']) {
    const r = run([src(q)], '134,200,000円', q);
    assert.equal(r.removed.length, 0, q);
    assert.deepEqual(r.rows.find((x) => x.key === 'budget').flags, [], q);
  }
  const same = '予定価格 134,200,000円(税込み)';
  assert.deepEqual(run([src(same)], '134,200,000円', same).rows.find((x) => x.key === 'budget').flags, []);
});

test('照合: 値が違うときは空白があっても見つける', () => {
  const q = '予定価格 134,200,000 円(税込み)';
  assert.match(run([src(q)], '134,200,001円', q).removed[0].reason, /値の金額が抜き書きに無い/);
});

test('照合: ファイルをまたいで比べる。行をまたいだ数は額にしないので「金額が違う」を出さない', () => {
  const q = '予定価格 134,200,000円(税込み)';
  const flags = (other) => run([src(q), src(other, '説明書.txt')], '134,200,000円', q).rows.find((x) => x.key === 'budget').flags.join(' / ');
  assert.equal(flags('予定価格 1億 3,420万 円'), '');
  assert.match(flags('予定価格 134,200,001 円'), /説明書\.txt 1行目.*金額が違う/);
  assert.equal(flags('予定価格\n120\n円形の管'), '');
  assert.equal(flags('予定価格 120 円形の管'), '');
});

test('照合: 宣言の「千 円」を掛けた値を外さず、単位が無いとも言わない', () => {
  const t = '(単位:千 円)\n予定価格 82,500 税込み';
  const r = run([src(t)], '82,500,000円', '予定価格 82,500 税込み');
  assert.equal(r.removed.length, 0);
  assert.ok(!r.rows.find((x) => x.key === 'budget').flags.join(' / ').includes('単位'));
});

const PRIME_MISSED = [
  '発注者から直接請け負った同種工事の施工実績を有すること。',
  '発注者から直接請負った同種工事の施工実績を有すること。',
  '発注者から直接受注した同種工事の施工実績を有すること。',
  '国、地方公共団体等から直接受注した同種工事の施工実績を有すること。',
  '国、地方公共団体等から直接請け負った工事の実績があること。',
];
const form = readBidForm(SAMPLE.form);
const alerted = (text) => bidCheck({ ...form, participationConditions: text }).checks.some((c) => c.key === 'prime-experience');

test('見落としていた言い回しで知らせが出る', () => {
  for (const s of PRIME_MISSED) {
    assert.equal(findPrimeExperience(s), s, s);
    assert.ok(alerted(s), s);
  }
});

test('技術者の経験の文は知らせない(「等」「など」が付いても)', () => {
  for (const s of [
    '配置予定の監理技術者等は、元請として施工した同種工事の経験を有する者',
    '配置予定の監理技術者等が、元請として施工した同種工事の経験を有すること。',
    '配置予定の技術者などは、元請けとしての同種工事の経験を有すること。',
    '配置予定の監理技術者等は、発注者から直接請け負った同種工事の経験を有する者',
  ]) {
    assert.equal(findPrimeExperience(s), null, s);
    assert.ok(!alerted(s), s);
  }
});

test('技術者の語が文の後ろにあるだけなら、会社の実績の条件として知らせる(頭の縛りを残す)', () => {
  for (const s of [
    '元請として同種工事の施工実績を有し、配置予定技術者は監理技術者資格者証を有すること。',
    '元請として同種工事の施工実績を有し、配置予定の監理技術者等は専任で配置すること。',
    '発注者から直接請け負った同種工事の実績を有し、配置予定技術者は同種工事の経験を有すること。',
  ]) {
    assert.equal(findPrimeExperience(s), s, s);
    assert.ok(alerted(s), s);
  }
});

test('足した言い回しでも、問わない文・加点の文・実績の無い文は知らせない', () => {
  for (const s of [
    '発注者から直接請け負った工事か下請工事かを問わず、同種工事の施工実績を有すること。',
    '発注者から直接請け負った工事又は下請工事として、同種工事の施工実績を有すること。',
    '国、地方公共団体等から直接受注した工事のほか、下請工事も対象の同種工事の実績を有すること。',
    '発注者から直接請け負った同種工事の施工実績がある場合は加点する。',
    '発注者から直接請け負った工事の実績は問わない。',
    '発注者から直接請け負った工事について、施工体制台帳を作成すること。',
  ]) assert.equal(findPrimeExperience(s), null, s);
  const s = '発注者から直接請け負った工事の実績に限り、下請工事は認めない。';
  assert.equal(findPrimeExperience(s), s, '読点の後ろの「下請工事は認めない」は問わない文ではない');
});

test('画面: 足した言い回しの文で知らせが出て、技術者の文では出ない', async () => {
  const page = runPage(buildHtml());
  await page.click('entry-bid');
  await page.set('participation-conditions', PRIME_MISSED[0]);
  await page.click('bid-run');
  await page.click('confirm-go');
  assert.match(page.el('bid-result').innerHTML, /この工事は元請けとしての施工実績を参加の条件にしています/);
  assert.ok(page.el('bid-result').innerHTML.includes(PRIME_MISSED[0]));
  await page.set('participation-conditions', '配置予定の監理技術者等は、元請として施工した同種工事の経験を有する者');
  await page.click('bid-run');
  await page.click('confirm-go');
  assert.ok(!/元請けの施工実績/.test(page.el('bid-result').innerHTML));
});

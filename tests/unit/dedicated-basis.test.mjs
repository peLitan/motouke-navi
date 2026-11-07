// F67a: 専任の確認の根拠の抜き書きと、現場を兼ねる特例の文(値はすべて架空)。金額と現場の数は取得した原文から読む
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { bidCheck, dedicatedThreshold, sharedSiteLimit, kanjiYen } from '../../src/bid-check.mjs';
import { checkTaicho } from '../../src/check-taicho.mjs';
import { checkQuote } from '../../src/quote-check.mjs';
import { bidCheckRows, bidRows, toCsv } from '../../src/export.mjs';
import { basisLabel, renderOpenItems } from '../../src/ui/view.mjs';
import quotesData from '../../data/quotes.json' with { type: 'json' };
import sourcesData from '../../data/sources/index.json' with { type: 'json' };
import { buildHtml } from '../../build.mjs';
import { runPage } from '../acceptance/_helpers.mjs';

const read = (p) => fs.readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const ANSWERED = { orderer: 'public', direct: true, workType: 'other', hasSubcontract: false, subcontractTotal: 0, license: 'tokutei', engineerQualification: 'kanri' };
const input = (contractAmount, over = {}) => ({ ...ANSWERED, contractAmount, ...over });
const ded = (i) => bidCheck(i).items.find((x) => x.key === 'dedicated');
const check = (i) => bidCheck(i).checks.find((c) => c.key === 'dedicated');
const kenchiku = { workType: 'kenchiku-ikkatsu' };
const SPECIAL = '特例があります。この道具は特例を判定していません';
const CANNOT = /兼ねる特例は使えません/;
const ARTICLE = /第\s*[0-9０-９一二三四五六七八九十百]+\s*[条項号]|施行令|建設業法/;
const NEW_QUOTES = ['q-rei-27-1-2', 'q-rei-27-1-3', 'q-rei-15-1', 'q-rei-15-3', 'q-rei-28', 'q-rei-30', 'q-kensetsu-26-5'];

test('根拠: 公共でも民間でも足した抜き書きがすべて basis にあり、原文の項・号の中にある', () => {
  const texts = Object.fromEntries(sourcesData.sources.filter((s) => s.file).map((s) => [s.id, read('data/sources/' + s.file)]));
  for (const orderer of ['public', 'private']) {
    const ids = ded(input(45_000_000, { orderer })).basis.map((b) => b.quoteId);
    for (const id of NEW_QUOTES) assert.ok(ids.includes(id), orderer + ' に ' + id + ' が無い');
  }
  for (const id of NEW_QUOTES) {
    const q = quotesData.quotes.find((x) => x.id === id);
    assert.deepEqual(checkQuote(q, texts), { ok: true }, id);
  }
});

test('根拠: 条番号は条文の呼び方どおりで、第3号は施設の並びを切り落とさない', () => {
  const labels = ded(input(45_000_000)).basis.map(basisLabel);
  for (const want of ['建設業法施行令 第27条第1項第2号', '建設業法施行令 第27条第1項第3号', '建設業法施行令 第15条第1号', '建設業法施行令 第15条第3号', '建設業法施行令 第28条', '建設業法施行令 第30条', '建設業法 第26条第5項']) assert.ok(labels.includes(want), want);
  const third = ded(input(45_000_000)).basis.find((b) => b.quoteId === 'q-rei-27-1-3').quote;
  for (const w of ['学校', '病院又は診療所', '共同住宅、寄宿舎又は下宿', '事務所', '工場、ドック又は倉庫', '展望塔']) assert.ok(third.includes(w), w);
});

test('特例の金額と現場の数: 原文の漢数字から読み、コードに数字を書かない', () => {
  const s = sharedSiteLimit();
  const quote = (id) => quotesData.quotes.find((q) => q.id === id).text;
  assert.equal(s.other, kanjiYen('一億円'));
  assert.equal(s.kenchiku, kanjiYen('二億円'));
  assert.equal(s.sites, 2);
  assert.ok(quote('q-rei-28').includes('一億円') && quote('q-rei-28').includes('二億円'));
  assert.ok(quote('q-rei-30').includes('二とする'));
  const code = read('src/bid-check.mjs');
  assert.doesNotMatch(code, /[12]億円|[12]つの現場|100_000_000 *[;,)]|200_000_000/);
});

test('請負代金 45,000,000・公共: 確認が要る点の全文の置き場と CSV の行に特例の一文がある', () => {
  const bid = bidCheck(input(45_000_000));
  const open = renderOpenItems(bid, {});
  assert.ok(open.includes(SPECIAL), open);
  assert.ok(open.includes('請負代金が1億円未満(建築一式は2億円未満)などの条件を満たすと、2つの現場まで兼ねられる'), open);
  const row = bidCheckRows(bid).find((r) => r[1] === '技術者を専任で置く必要があるか');
  assert.equal(row[0], '確認が要る点');
  assert.ok(row[3].includes(SPECIAL));
  assert.ok(toCsv(bidCheckRows(bid)).includes(SPECIAL));
});

test('副題: 行動を先にし、条番号を書かない', () => {
  const c = check(input(45_000_000));
  assert.match(c.message, /^公告で、発注者が国か地方公共団体か\(独立行政法人・特殊法人・地方公社ではないか\)を確かめてください。国か地方公共団体/);
  assert.match(c.message, /なら専任が要ります。それ以外なら工事の目的物/);
  assert.ok(!c.message.includes('専任としました'));
  assert.ok(c.message.indexOf('確かめてください') < c.message.indexOf('専任が要ります'));
  for (const amount of [45_000_000, 120_000_000]) assert.doesNotMatch(check(input(amount)).message, ARTICLE);
});

test('1億円以上(建築一式は2億円以上)だけ、兼ねる特例が使えない旨が出る', () => {
  for (const [amount, over, want] of [
    [45_000_000, {}, false], [99_999_999, {}, false], [100_000_000, {}, true], [120_000_000, {}, true],
    [90_000_000, kenchiku, false], [120_000_000, kenchiku, false], [199_999_999, kenchiku, false], [200_000_000, kenchiku, true],
  ]) {
    const i = input(amount, over);
    assert.equal(CANNOT.test(check(i).message), want, amount + ' ' + JSON.stringify(over));
    assert.equal(ded(i).exceptions.some((e) => /第1号の特例は使えない\(施行令 第28条\)/.test(e)), want, '例外の文 ' + amount);
    assert.ok(check(i).message.includes(SPECIAL), '判定していない旨は常に残す ' + amount);
  }
});

test('境目以上でも、金額の条件が無い第2号の特例まで無いとは言わない', () => {
  const m = check(input(120_000_000)).message;
  assert.match(m, /監理技術者を補佐する者を専任で置く場合の特例があります/);
  assert.match(m, /情報通信技術を使って2つの現場まで兼ねる特例は使えません/);
  assert.doesNotMatch(m, /特例はありません/);
});

test('例外の文: 数字と条を書き、CSV の例外の列に出る', () => {
  const it = ded(input(45_000_000));
  const e = it.exceptions[0];
  for (const w of ['1億円未満', '2億円未満', '2つの現場', '第26条第3項ただし書', '第4項', '施行令 第28条・第30条', '特例を判定していない']) assert.ok(e.includes(w), w);
  assert.match(e, /第2号\)には金額の条件が無く/);
  const row = bidRows(bidCheck(input(45_000_000))).find((r) => r[1] === it.label);
  assert.ok(row[8].includes('2つの現場まで兼ねられる特例'));
});

test('境目(45,000,000 と 44,999,999、建築一式 90,000,000 と 89,999,999)の判定は変わらない', () => {
  assert.deepEqual([dedicatedThreshold().other, dedicatedThreshold().kenchiku], [45_000_000, 90_000_000]);
  assert.equal(ded(input(45_000_000)).status, 'required');
  assert.equal(ded(input(44_999_999)).status, 'not_required');
  assert.equal(ded(input(90_000_000, kenchiku)).status, 'required');
  assert.equal(ded(input(89_999_999, kenchiku)).status, 'not_required');
  assert.ok(!bidCheck(input(44_999_999)).checks.some((c) => c.message.includes(SPECIAL)), '要らないときは特例の文も出ない');
});

test('民間: 確かめるときも特例の一文が出て、取り込んだ第15条を「無い」とは書かない', () => {
  const m = check(input(45_000_000, { orderer: 'private' })).message;
  assert.ok(m.includes(SPECIAL));
  assert.ok(!m.includes('取り込んでいない'));
  assert.ok(check(input(120_000_000, { orderer: 'private' })).message.match(CANNOT));
  const out = checkTaicho({ project: { ordererType: 'private', workType: 'other', contractAmount: 45_000_000 }, prime: { name: '架空建設', engineer: { role: 'kanri', name: '架空 太郎', qualification: '一級', dedicated: false } }, subcontractors: [] });
  const line = out.undecidable.find((u) => u.field === 'engineer.dedicated');
  assert.ok(line, '民間の非専任は判断できないに出る');
  assert.ok(!line.message.includes('取り込んでいない'), '点検の文も第15条を無いと書かない');
});

test('項が1つの印は足した4件だけで、ほかの条番号の書き方は変えない', () => {
  assert.deepEqual(quotesData.quotes.filter((q) => q.soleParagraph).map((q) => q.id).sort(), ['q-rei-15-1', 'q-rei-15-3', 'q-rei-28', 'q-rei-30']);
  assert.equal(basisLabel({ law: '建設業法施行令', article: '2', paragraph: 1, item: null }), '建設業法施行令 第2条第1項');
});

test('組み立てた画面: 見本の「次にすること」の飛び先に、確かめることと特例の文が出る', async () => {
  const page = runPage(buildHtml());
  await page.click('sample-load');
  await page.click('confirm-go');
  const top = page.el('result-top').innerHTML;
  const open = page.el(top.match(/class="next-go" href="#([\w-]+)"/)[1]).innerHTML;
  assert.match(open, /<strong>技術者を専任で置く必要があるか<\/strong>: 公告で、発注者が国か地方公共団体か/);
  assert.ok(open.includes('この道具は特例を判定していません。'), open);
});

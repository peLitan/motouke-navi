// F67b: 専任が要るときの技術者の選び方の1行、税抜きの入れ違いの知らせ、下請けの確かめる相手(値はすべて架空)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { bidCheck } from '../../src/bid-check.mjs';
import { checkQuote } from '../../src/quote-check.mjs';
import { bidCheckRows, toCsv } from '../../src/export.mjs';
import { basisLabel, renderBidResult, renderOpenItems } from '../../src/ui/view.mjs';
import quotesData from '../../data/quotes.json' with { type: 'json' };
import sourcesData from '../../data/sources/index.json' with { type: 'json' };
import { buildHtml } from '../../build.mjs';
import { runPage } from '../acceptance/_helpers.mjs';

const read = (p) => fs.readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const ANSWERED = { orderer: 'public', direct: true, workType: 'other', hasSubcontract: false, subcontractTotal: 0, license: 'tokutei', engineerQualification: 'kanri' };
const input = (contractAmount, over = {}) => ({ ...ANSWERED, contractAmount, ...over });
const kenchiku = { workType: 'kenchiku-ikkatsu' };
const TAX = '税抜きで入れていませんか(この欄は税込みです)';
const PERSON = '専任の技術者の資格と雇用関係';
const ded = (i) => bidCheck(i).items.find((x) => x.key === 'dedicated');
const person = (i) => bidCheck(i).checks.find((c) => c.label === PERSON);
const hasTax = (i) => bidCheck(i).checks.some((c) => c.message.includes(TAX));
const ARTICLE = /第\s*[0-9０-９一二三四五六七八九十百]+\s*[条項号]|施行令|建設業法/;

test('専任が要る公共: 資格者証と講習、3か月の雇用(法令の条ではない旨つき)の行が確認が要る点にある', () => {
  // 監理技術者になる入力でも主任技術者になる入力でも出る(3か月は元請けの専任の主任技術者にも掛かる)
  for (const over of [{}, { hasSubcontract: true, subcontractTotal: 60_000_000 }, { orderer: 'public', hasSubcontract: null, subcontractTotal: null }]) {
    const c = person(input(45_000_000, over));
    assert.ok(c, JSON.stringify(over));
    assert.match(c.message, /監理技術者資格者証の交付を受け/);
    assert.match(c.message, /登録を受けた講習を受講した人から選ばなければなりません/);
    assert.match(c.message, /現場を兼ねる特例の監理技術者を含む/);
    assert.match(c.message, /申込の無い指名競争は入札の執行日、随意契約は見積書の提出の日が基準です/);
    assert.match(c.message, /入札の申込の日以前に3か月以上の雇用関係/);
    assert.match(c.message, /公共工事の元請けでは/);
    assert.match(c.message, /監理技術者制度運用マニュアルによる運用で、法令の条ではない/);
    assert.doesNotMatch(c.message, ARTICLE, '条番号は根拠の折りたたみに出す');
  }
});

test('行の根拠: 第26条第5項と運用マニュアルの抜き書きで、画面と CSV に出る', () => {
  const bid = bidCheck(input(45_000_000));
  const c = bid.checks.find((x) => x.label === PERSON);
  assert.deepEqual(c.basis.map((b) => b.quoteId), ['q-kensetsu-26-5', 'q-mlit-manual-koyo']);
  const labels = c.basis.map(basisLabel);
  assert.equal(labels[0], '建設業法 第26条第5項');
  assert.match(labels[1], /^監理技術者制度運用マニュアル.* 二－四\(3\)① 9ページ$/);
  assert.ok(renderOpenItems(bid, {}).includes('監理技術者資格者証の交付を受け'));
  const row = bidCheckRows(bid).find((r) => r[1] === PERSON);
  assert.equal(row[0], '確認が要る点');
  assert.ok(row[3].includes('3か月以上'));
  assert.ok(row[4].includes('建設業法 第26条第5項') && row[4].includes('9ページ'));
  assert.ok(row[5].includes('元請の専任の主任技術者'));
  assert.ok(toCsv(bidCheckRows(bid)).includes('法令の条ではない'));
});

test('運用マニュアルの抜き書き: 原文にあり、元請の限定と例外を切り落とさない', () => {
  const source = sourcesData.sources.find((s) => s.id === 'mlit-kanri-manual');
  assert.equal(source.kind, 'document');
  assert.ok(new URL(source.url).hostname.endsWith('mlit.go.jp'));
  assert.equal(source.fetchedAt, '2026-11-06');
  const text = read('data/sources/' + source.file);
  const q = quotesData.quotes.find((x) => x.id === 'q-mlit-manual-koyo');
  assert.deepEqual(checkQuote(q, { [source.id]: text }), { ok: true });
  for (const w of ['元請の専任の主任技術者', '入札の申込のあった日', '指名競争', '見積書の提出のあった日', '三ヶ月以上の雇用関係', '合併、営業譲渡又は会社分割等', 'この限りではない']) assert.ok(q.text.includes(w), w);
  assert.ok(read('docs/details.md').includes(source.url), 'docs/details.md の「データと出典」に無い');
});

test('専任の行は、専任が要ると出たときだけ', () => {
  assert.equal(person(input(44_999_999)), undefined, '要らない');
  assert.equal(person(input(45_000_000, { orderer: 'private' })), undefined, '民間は確認が要るのまま');
  assert.equal(person(input(45_000_000, { orderer: null })), undefined, '発注者が分からない');
  assert.equal(person(input(89_999_999, kenchiku)), undefined, '建築一式の境目の下');
  assert.ok(person(input(90_000_000, kenchiku)), '建築一式の境目');
});

test('民間: 1行は足さず、確かめの文の中に資格の文だけを足す(3か月の定めは公共工事だけ)', () => {
  const m = (over) => bidCheck(input(45_000_000, { orderer: 'private', ...over })).checks.find((c) => c.key === 'dedicated').message;
  for (const direct of [true, null]) {
    assert.match(m({ direct }), /監理技術者資格者証の交付を受け/);
    assert.doesNotMatch(m({ direct }), /3か月/);
  }
  assert.doesNotMatch(m({ direct: false }), /資格者証/, '下請けには監理技術者の定めが掛からない');
  assert.equal(bidCheck(input(45_000_000, { orderer: 'private' })).checks.filter((c) => c.key === 'dedicated').length, 1, '項目1つに点1つのまま');
  assert.doesNotMatch(bidCheck(input(44_999_999, { orderer: 'private' })).items.find((x) => x.key === 'dedicated').note, /資格者証/);
});

test('下請けには専任の行を出さず、元請けか分からないときは出す', () => {
  assert.equal(person(input(45_000_000, { direct: false })), undefined);
  assert.ok(person(input(45_000_000, { direct: null })));
});

test('税抜きの知らせ: 公共・その他の工事は 41,000,000 で出て、40,000,000 と 45,000,000 では出ない', () => {
  assert.equal(hasTax(input(41_000_000)), true);
  assert.equal(hasTax(input(40_000_000)), false);
  assert.equal(hasTax(input(45_000_000)), false);
});

test('税抜きの知らせの境目: 1.1倍が境目以上になる額からで、小数の誤差が無い', () => {
  for (const [amount, over, want] of [
    [40_909_090, {}, false], [40_909_091, {}, true], [44_999_999, {}, true], [45_000_000, {}, false],
    [81_818_181, kenchiku, false], [81_818_182, kenchiku, true], [89_999_999, kenchiku, true], [90_000_000, kenchiku, false],
    [45_000_000, kenchiku, false],
  ]) assert.equal(hasTax(input(amount, over)), want, amount + ' ' + JSON.stringify(over));
});

test('税抜きの知らせは発注者と元請けか下請けかによらず、工事の種類か金額が無ければ出さない', () => {
  for (const over of [{ orderer: 'private' }, { orderer: null }, { direct: false }]) assert.equal(hasTax(input(41_000_000, over)), true, JSON.stringify(over));
  assert.equal(hasTax(input(41_000_000, { workType: null })), false);
  assert.equal(hasTax(input(null)), false);
  assert.equal(hasTax(input(undefined)), false);
  assert.equal(hasTax(input(-1)), false);
});

test('税抜きの知らせ: 判定は「要らない」のままで、答えで変わると項目に出す。根拠は税込みの抜き書き', () => {
  const bid = bidCheck(input(41_000_000));
  assert.equal(ded(input(41_000_000)).status, 'not_required');
  const c = bid.checks.find((x) => x.message.includes(TAX));
  assert.equal(c.key, 'dedicated');
  assert.equal(c.changes, true);
  assert.deepEqual(c.basis.map((b) => b.quoteId), ['q-rei-27-1', 'q-mlit-guideline-tax']);
  assert.ok(c.message.includes('消費税10%を足すと 45,000,000円 以上になり'));
  assert.ok(c.message.includes('答えが変わることがあります'), '金額を超えても専任とは限らないので言い切らない');
  assert.ok(renderBidResult(bid).replace(/<[^>]+>/g, '').includes('この「要らない」は、次のページの「確認が要る点」の答えで変わることがあります')); // F86f: リンクをやめ、ページの語にした
  assert.ok(bidCheck(input(41_000_000, kenchiku)).checks.every((x) => !x.message.includes(TAX)), '建築一式の境目は 90,000,000');
  assert.ok(bidCheck(input(85_000_000, kenchiku)).checks.find((x) => x.message.includes(TAX)).message.includes('90,000,000円'));
});

test('下請けのとき: 専任の文の確かめる相手は元請け', () => {
  const pub = bidCheck(input(45_000_000, { direct: false })).checks.find((c) => c.key === 'dedicated').message;
  assert.match(pub, /^元請けに、発注者が国か地方公共団体か/);
  assert.ok(!pub.includes('公告で'));
  const priv = bidCheck(input(45_000_000, { direct: false, orderer: 'private' })).checks.find((c) => c.key === 'dedicated').message;
  assert.ok(priv.includes('当たるかは工事の対象を元請けに確かめる。'), priv);
  const unknown = bidCheck(input(45_000_000, { direct: false, orderer: null })).checks.find((c) => c.key === 'dedicated').message;
  assert.ok(unknown.includes('発注者が公共か民間かは元請けに確かめる'), unknown);
});

test('元請けか、分からないときの文は変えない', () => {
  for (const direct of [true, null]) {
    const pub = bidCheck(input(45_000_000, { direct })).checks.find((c) => c.key === 'dedicated').message;
    assert.match(pub, /^公告で、発注者が国か地方公共団体か/);
    const priv = bidCheck(input(45_000_000, { direct, orderer: 'private' })).checks.find((c) => c.key === 'dedicated').message;
    assert.ok(priv.includes('当たるかは工事の対象で確かめる。'));
    assert.ok(!priv.includes('元請けに'));
    const unknown = bidCheck(input(45_000_000, { direct, orderer: null })).checks.find((c) => c.key === 'dedicated').message;
    assert.equal(unknown, '発注者が公共か民間かの入力が無いので判定できない');
  }
});

test('専任の境目の判定は変わらない', () => {
  assert.equal(ded(input(45_000_000)).status, 'required');
  assert.equal(ded(input(44_999_999)).status, 'not_required');
  assert.equal(ded(input(45_000_000, { direct: false })).status, 'required');
  assert.equal(ded(input(90_000_000, kenchiku)).status, 'required');
  assert.equal(ded(input(89_999_999, kenchiku)).status, 'not_required');
});

test('組み立てた画面: 見本の確認が要る点に行が出て、41,000,000 に直すと税抜きの知らせに替わる', async () => {
  const page = runPage(buildHtml());
  await page.click('sample-load');
  await page.click('bid-run');
  assert.ok(page.text('open-items').includes(PERSON));
  assert.ok(page.text('open-items').includes('法令の条ではない'));
  await page.set('work-type', 'other');
  await page.set('contract-amount', '41000000');
  await page.click('bid-run');
  assert.ok(page.text('open-items').includes(TAX));
  assert.ok(!page.text('open-items').includes(PERSON));
});

test('組み立てた画面: 下請けを選ぶと専任の文の相手が元請けになる', async () => {
  const page = runPage(buildHtml());
  await page.click('sample-load');
  await page.click('bid-run');
  await page.set('direct', false);
  await page.set('direct-sub', true);
  await page.click('bid-run');
  const t = page.text('open-items');
  assert.ok(t.includes('元請けに、発注者が国か地方公共団体か'), t);
  assert.ok(!t.includes(PERSON));
});

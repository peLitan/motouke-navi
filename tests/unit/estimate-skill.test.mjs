// 参考の積算額の Skill(F42b): 抜き書きと単位の照合、通った行だけの積み上げ、出どころと割合の出力
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { checkEstimate, renderMarkdown, summaryLine, exitCodeOf, loadTables, numbersIn, hasUnit, quantityProblem, findRow, uncoveredLines } from '../../plugin/skills/estimate/scripts/check-estimate.mjs';
import { searchPackages, rowsOf } from '../../plugin/skills/estimate/scripts/find-packages.mjs';

const SKILL = 'plugin/skills/estimate';
const SAMPLE = 'docs/samples/estimate';
const tables = loadTables(`${SAMPLE}/架空の標準単価表`);
const file = '数量.md';
const text = ['| 掘削 | 土砂 | m3 | 1,200 |', '| 上層路盤 | 砕石 | m2 | 2,400 |', '| 舗装版切断 | m | 40 |'].join('\n');
const sources = [{ file, text }];
const TQ = '掘削 ｍ３ 土砂 架空の方法A';
const line = (over = {}) => ({ name: '掘削', quantity: 1200, unit: 'm3', quote: '| 掘削 | 土砂 | m3 | 1,200 |', file, match: { no: 1, tableQuote: TQ, reason: '工種が同じ' }, ...over });
const run = (lines, conditions = {}) => checkEstimate({ source: { title: '架空' }, conditions: { kind: '道路改良工事', prefecture: '架空県', ...conditions }, lines }, sources, tables);

test('両方の抜き書きと単位が合う行は合計に入り、出どころが付く', () => {
  const r = run([line()]);
  assert.equal(r.notIncluded.length, 0);
  assert.equal(r.rows.length, 1);
  assert.equal(r.direct.total, r.rows[0].amount);
  assert.ok(r.rows[0].amount > 0);
  assert.equal(r.rows[0].quote, line().quote);
  assert.equal(r.rows[0].tableQuote, TQ);
  assert.equal(r.rows[0].source.no, 1);
  assert.equal(r.rows[0].reason, '工種が同じ');
  assert.ok(r.amount > r.direct.total);
});

for (const [title, over, word] of [
  ['抜き書きが数量の表に無い', { quote: '| 掘削 | 土砂 | m3 | 1,300 |', quantity: 1300 }, '数量の表にありません'],
  ['数量が抜き書きと違う', { quantity: 1300 }, '数量 1300'],
  ['名前が抜き書きに無い', { name: '盛土' }, '名前'],
  ['単位が抜き書きに無い', { unit: 'm2' }, '単位 m2'],
  ['抜き書きが空', { quote: '' }, '抜き書きがありません'],
  ['ファイルが渡されていない', { file: '別の表.md' }, '別の表.md'],
  ['抜き書きが2行', { quote: '| 掘削 | 土砂 | m3 | 1,200 |\n| 上層路盤 | 砕石 | m2 | 2,400 |' }, '2行'],
  ['番号が表に無い', { match: { no: 99, tableQuote: TQ } }, '番号 99'],
  ['表の抜き書きが行の一部', { match: { no: 1, tableQuote: '掘削 ｍ３ 土砂' } }, '番号 1'],
  ['表の抜き書きが別の番号の行', { match: { no: 2, tableQuote: TQ } }, '番号 2'],
]) {
  test(`機械が当てない: ${title}`, () => {
    const r = run([line(over)]);
    assert.equal(r.rows.length, 0);
    assert.equal(r.direct.total, 0);
    assert.equal(r.amount, null);
    assert.equal(r.notIncluded.length, 1);
    assert.equal(r.notIncluded[0].by, '機械');
    assert.match(r.notIncluded[0].reason, new RegExp(word));
  });
}

test('数量の表と標準単価表の単位が違う行は当てない(km と m を換算しない)', () => {
  const t = [{ file, text: '| 区画線 | km | 1.2 |\n' }];
  const r = checkEstimate({ conditions: { kind: '道路改良工事', prefecture: '架空県' }, lines: [{ name: '区画線', quantity: 1.2, unit: 'km', quote: '| 区画線 | km | 1.2 |', file, match: { no: 6, tableQuote: '区画線 ｍ 溶融式 架空の規格A' } }] }, t, tables);
  assert.equal(r.rows.length, 0);
  assert.equal(r.notIncluded[0].by, '機械');
  assert.match(r.notIncluded[0].reason, /単位が合わない/);
});

test('全角の数字と ㎥ の書き方は同じ単位として通る', () => {
  const q = '｜掘削｜㎥｜１，２００';
  assert.equal(quantityProblem({ name: '掘削', quantity: 1200, unit: 'm3', quote: q }, [{ file, text: q }]), null);
  const r = checkEstimate({ conditions: { kind: '道路改良工事' }, lines: [{ name: '掘削', quantity: 1200, unit: '㎥', quote: q, match: { no: 1, tableQuote: TQ } }] }, [{ file, text: q }], tables);
  assert.equal(r.rows.length, 1);
});

test('数字と単位の見分け: m3 の 3 は数量でなく、m は m3 に一致しない', () => {
  assert.deepEqual(numbersIn('| m3 | 1,200 |'), [1200]);
  assert.deepEqual(numbersIn('12.5 ｍ３'), [12.5]);
  assert.equal(hasUnit('| m3 | 1 |', 'm'), false);
  assert.equal(hasUnit('厚150mm', 'm'), false);
  assert.equal(hasUnit('| m3 | 1 |', 'm3'), true);
  assert.equal(hasUnit('| 120本 |', '本'), true);
  assert.equal(quantityProblem({ name: '掘削', quantity: 3, unit: 'm3', quote: '| 掘削 | m3 | 1,200 |' }, [{ file, text: '| 掘削 | m3 | 1,200 |' }]), '数量 3 が抜き書きにありません');
});

test('Claude が当てなかった行は理由つきで合計の外に出て、割合に数える', () => {
  const r = run([line(), line({ name: '上層路盤', quantity: 2400, unit: 'm2', quote: '| 上層路盤 | 砕石 | m2 | 2,400 |', match: null, reason: '当たる工種が無い' })]);
  assert.equal(r.rows.length, 1);
  assert.deepEqual([r.notIncluded[0].by, r.notIncluded[0].reason], ['Claude', '当たる工種が無い']);
  assert.equal(r.notIncludedPercent, 50);
  assert.match(renderMarkdown(r), /渡した 2 行のうち 1 行\(行の数で 50%\)/);
});

test('補正していない部分の額と割合を参考の額と並べて出し、人が補正する欄を空で残す', () => {
  const r = run([line()]);
  assert.ok(r.direct.uncorrectedAmount > 0 && r.direct.uncorrectedAmount < r.direct.total);
  assert.equal(r.direct.uncorrectedPercent, 70);
  const md = renderMarkdown(r);
  assert.match(md, /参考の額\(工事価格・税抜き\)/);
  assert.match(md, /補正していない部分 \| [\d,]+円 \| 直接工事費の 70%/);
  assert.match(md, /人が補正する欄\(空\): 架空の機械B\(構成比 50%\)/);
  assert.match(summaryLine(r), /補正していない部分/);
  assert.equal(r.rows[0].humanFields.every((h) => h.base === null && h.local === null), true);
});

test('人が入れた単価は補正に入る', () => {
  const a = run([line()]);
  const b = run([line({ manual: { K1: { base: 100, local: 120 } } })]);
  assert.ok(b.direct.total > a.direct.total);
  assert.ok(b.direct.uncorrectedPercent < a.direct.uncorrectedPercent);
});

test('都道府県の労務単価が無いときは前提に書き、労務を補正しない', () => {
  const r = run([line()], { prefecture: '無い県' });
  assert.equal(r.rows[0].applied.length, 0);
  assert.ok(r.assumptions.some((x) => /労務の補正はしていません/.test(x)));
});

test('確かめが要る: 同じ抜き書きの二度使い、漢字が重ならない当て方。どちらも合計には入る', () => {
  const r = run([line(), line({ name: '土砂', match: { no: 1, tableQuote: TQ } })]);
  assert.equal(r.rows.length, 2);
  assert.ok(r.flags.some((x) => /同じ抜き書き/.test(x)));
  const t = [{ file, text: '| 舗装 | m2 | 10 |' }];
  const r2 = checkEstimate({ conditions: { kind: '舗装工事' }, lines: [{ name: '舗装', quantity: 10, unit: 'm2', quote: '| 舗装 | m2 | 10 |', file, match: { no: 4, tableQuote: '表層 ｍ２ 再生密粒度 50mm' } }] }, t, tables);
  assert.equal(r2.rows.length, 1);
  assert.ok(r2.flags.some((x) => /漢字が1字も重なりません/.test(x)));
});

test('どの抜き書きにも入っていない文の行を数える', () => {
  const u = uncoveredLines(sources, [line()]);
  assert.deepEqual(u.map((x) => x.text), ['| 上層路盤 | 砕石 | m2 | 2,400 |', '| 舗装版切断 | m | 40 |']);
  assert.equal(run([line()]).uncovered.length, 2);
});

test('使わない語は Claude の文からも出さない。参考の額と書き、会社の原価を含まないことを書く', () => {
  const r = checkEstimate({ conditions: { kind: '道路改良工事', prefecture: '架空県' }, notes: [{ text: 'この額で入札してください' }], lines: [line({ match: { no: 1, tableQuote: TQ, reason: '予定価格に近い' } })] }, sources, tables);
  const md = renderMarkdown(r);
  assert.doesNotMatch(md, /予定価格|この額で入札/);
  assert.match(md, /参考の額/);
  assert.match(md, /会社の原価\(自社の人件費・下請けの見積もり\)は含みません/);
  assert.equal(r.label, '参考の額');
});

test('工種区分が表に無いときは止める', () => {
  assert.throws(() => run([line()], { kind: '道路改良' }), /conditions\.kind/);
});

test('標準単価表の照合は番号と行の文の全部で決まる', () => {
  assert.equal(findRow({ no: 1, tableQuote: '掘削 ｍ３ 岩塊 架空の方法B' }, tables.unitPrices).row.price, 1500);
  assert.match(findRow({ no: 7, tableQuote: '防護柵（材料費）' }, tables.unitPrices).problem, /番号 7/);
});

test('find-packages: 語で探し、行の文はそのまま抜き書きに使える', () => {
  assert.deepEqual(searchPackages(tables.unitPrices, ['掘削', '土砂']).map((p) => [p.no, p.rows, p.of]), [[1, 1, 2]]);
  assert.deepEqual(searchPackages(tables.unitPrices, ['防護柵']).map((p) => p.of), [0]);
  const [row] = rowsOf(tables.unitPrices, 1, ['岩塊']).rows;
  assert.equal(findRow({ no: 1, tableQuote: row.text }, tables.unitPrices).row.price, 1500);
  assert.equal(rowsOf(tables.unitPrices, 99), null);
});

test('架空の数量の表の見本: 結果の文書が今の出力と同じで、当たらない行の4通りが入っている', () => {
  const data = JSON.parse(fs.readFileSync(`${SAMPLE}/当てた結果.json`, 'utf8'));
  const name = '架空の数量総括表.md';
  const r = checkEstimate(data, [{ file: name, text: fs.readFileSync(`${SAMPLE}/${name}`, 'utf8') }], tables);
  assert.equal(renderMarkdown(r), fs.readFileSync(`${SAMPLE}/結果.md`, 'utf8'));
  assert.deepEqual(JSON.parse(fs.readFileSync(`${SAMPLE}/結果.json`, 'utf8')), JSON.parse(JSON.stringify(r)));
  assert.equal(r.rows.length, 4);
  assert.deepEqual(r.notIncluded.map((x) => x.by), ['機械', '機械', '機械', 'Claude']);
  assert.equal(r.uncovered.length, 1);
  assert.equal(r.direct.total, r.rows.reduce((a, x) => a + x.amount, 0));
  assert.match(fs.readFileSync(`${SAMPLE}/架空の数量総括表.md`, 'utf8'), /架空のもの/);
  assert.match(tables.unitPrices.meta.title, /実在の表の値ではない/);
});

test('終了コード: 機械が入れなかった行があれば 1、Claude が当てなかった行だけなら 0。最後の行に額と割合を出す', () => {
  const r = run([line(), line({ quantity: 1300 })]);
  assert.equal(exitCodeOf(r), 1);
  assert.equal(exitCodeOf(run([line(), line({ match: null, reason: '当たらない' })])), 0);
  assert.match(summaryLine(r), /参考の額 [\d,]+円。合計に入った行 1・入っていない行 1・補正していない部分/);
});

test('Skill の文書: 名前と手順があり、照合と計算のスクリプトは AI と通信を使わない', () => {
  const s = fs.readFileSync(`${SKILL}/SKILL.md`, 'utf8');
  assert.match(s, /^---\nname: estimate\n/);
  assert.match(s, /check-estimate\.mjs/);
  assert.match(s, /参考の額/);
  for (const f of ['check-estimate.mjs', 'find-packages.mjs', 'lib/estimate/direct.mjs', 'lib/estimate/indirect.mjs', 'lib/estimate/estimate.mjs']) {
    assert.doesNotMatch(fs.readFileSync(`${SKILL}/scripts/${f}`, 'utf8'), /\bfetch\(|https?:\/\/|anthropic|node:(https?|net)\b/i, f);
  }
});

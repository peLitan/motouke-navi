// F42a の単体の試験: 標準単価表・労務単価の表の読み取り。値はすべて架空(実物の表はリポジトリに入れない)
import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { pdfPages } from '../../scripts/pdf-text.mjs';
import { parseUnitPrices, parseLaborRates } from '../../scripts/estimate-tables.mjs';
import { summarize, FILES } from '../../scripts/fetch-estimate-data.mjs';

const it = (x, y, text) => ({ x, y, text });
const HEAD = [
  it(61, 778, 'No.007【　架空パッケージ　】'), it(61, 766, '＜　積算単位：ｍ３　＞'),
  it(253, 746, '標準単価'), it(67, 741, '架空の条件'),
  it(285, 741, 'K'), it(360, 741, 'R'), it(455, 741, 'Z'), it(550, 741, 'S'), it(1115, 741, 'S'),
  ...[['K1', 302], ['K2', 321], ['K3', 340], ['R1', 378], ['R2', 397], ['R3', 416], ['R4', 435], ['Z1', 473], ['Z2', 492], ['Z3', 511], ['Z4', 530]].map(([k, x]) => it(x, 735.7, k)),
  ...[['K1', 591], ['K2', 657], ['K3', 723], ['R1', 777], ['R2', 819], ['R3', 861], ['R4', 903], ['Z1', 945], ['Z2', 987], ['Z3', 1029], ['Z4', 1071]].map(([k, x]) => it(x, 735.7, k)),
  it(1153, 746, '備考'),
];
const row = (y, label, values, names = []) => [
  it(61, y, label),
  it(150, y, '-'), // 条件の欄の「-」は数に数えない
  ...values.map((v, n) => it(257 + n * 19, y, v)),
  ...names.map(([x, t]) => it(x, y, t)),
];
const V = ['1,234.5', '40.00', '30.00', '10.00', '-', '50.00', '50.00', '-', '-', '-', '10.00', '10.00', '-', '-', '-', '-'];

test('標準単価表の1頁を読む: 16 の数、列ごとの代表規格、折り返した名前', () => {
  const pages = [{ page: 12, items: [
    ...HEAD,
    ...row(711, '条件甲', V, [[562, '架空の機械 通'], [628, '架空の機械2'], [759, '普通作業員'], [928, '軽油']]),
    it(562, 705, '称10t'),
    ...row(680, '条件乙', ['2,000', ...V.slice(1)], [[759, '*運転手（特殊）']]),
  ] }];
  const { packages, skipped } = parseUnitPrices(pages);
  assert.equal(skipped.length, 0);
  const [p] = packages;
  assert.equal(p.no, 7);
  assert.equal(p.name, '架空パッケージ');
  assert.equal(p.unit, 'ｍ３');
  assert.equal(p.rows.length, 2);
  const r = p.rows[0];
  assert.equal(r.price, 1234.5);
  assert.deepEqual([r.K, r.K1, r.K2, r.K3, r.R, r.R1, r.Z, r.Z1, r.S], [40, 30, 10, null, 50, 50, 10, 10, null]);
  assert.equal(r.names.K1, '架空の機械 通称10t');
  assert.equal(r.names.K2, '架空の機械2');
  assert.equal(r.names.R1, '普通作業員');
  assert.equal(r.names.Z1, '軽油');
  assert.equal(r.names.R2, null);
  assert.match(r.condition, /条件甲/);
  assert.equal(r.page, 12);
  assert.equal(p.rows[1].price, 2000);
  assert.equal(p.rows[1].names.R1, '*運転手（特殊）');
});

test('続きの頁は同じパッケージにつなぐ。数の足りない行は数えて知らせる', () => {
  const a = [...HEAD, ...row(711, '甲', V)];
  const b = [...HEAD, ...row(711, '乙', V), ...row(690, '丙', V.slice(0, 10))];
  const { packages, skipped } = parseUnitPrices([{ page: 1, items: a }, { page: 2, items: b }]);
  assert.equal(packages.length, 1);
  assert.deepEqual(packages[0].pages, [1, 2]);
  assert.equal(packages[0].rows.length, 2);
  assert.equal(skipped.length, 1);
  assert.match(skipped[0].why, /16 でない/);
});

test('物価資料等によるパッケージは行なしで残す。見出しの無い頁は知らせる', () => {
  const r = parseUnitPrices([
    { page: 1, items: [it(61, 769, 'No.009【　架空の材料　】'), it(61, 741, '　物価資料等による')] },
    { page: 2, items: [it(61, 769, 'No.010【　架空の表　】')] },
    { page: 3, items: [it(61, 500, '表のない頁')] },
  ]);
  assert.equal(r.packages.length, 1);
  assert.equal(r.packages[0].rows.length, 0);
  assert.match(r.packages[0].note, /物価資料/);
  assert.equal(r.skipped.length, 1);
});

function laborPage(single) {
  const prefs = Array.from({ length: 47 }, (_, n) => ({ code: String(n + 1).padStart(2, '0'), name: n === 12 ? '東京都' : `架空${n + 1}県` }));
  const items = [];
  const put = (x, y, t) => {
    if (!single) { items.push(it(x, y, t)); return; }
    let at = x;
    for (const c of t) { items.push(it(at, y, c)); at += /[\d,]/.test(c) ? 4 : 8; }
  };
  put(144.4, 659, '甲作業員'); put(190, 663, '運転手'); put(190, 655, '（一般）');
  prefs.forEach((p, n) => {
    const y = 640 - n * 10;
    put(70, y, `${p.code} ${p.name}`);
    put(158.4, y, p.name === '東京都' ? '27,000' : '20,000');
    if (p.name !== '東京都') put(197.5, y, '21,000');
  });
  return { page: 8, items };
}

test('労務単価の表を読む: 折り返した職種名、空の欄、1字ずつの版', () => {
  for (const single of [false, true]) {
    const { rates } = parseLaborRates([laborPage(single), { page: 1, items: [it(1, 1, '表のない頁')] }]);
    assert.equal(Object.keys(rates).length, 47);
    assert.equal(rates['東京都']['甲作業員'], 27000);
    assert.equal(rates['東京都']['運転手（一般）'], undefined);
    assert.equal(rates['架空1県']['運転手（一般）'], 21000);
  }
});

test('まとめの数: 構成比の計が 100 から外れた行と、基準の表に無い職種を出す', () => {
  const s = summarize(
    { packages: [{ rows: [{ K: 50, R: 50, Z: null, S: null }, { K: 10, R: 10, Z: 10, S: null }] }], skipped: [] },
    { rates: { 東京都: { 甲: 1, 乙: 2 } } }, { 甲: 1 });
  assert.equal(s.rows, 2);
  assert.equal(s.ratioSumOff, 1);
  assert.deepEqual(s.baseJobsMissing, ['乙']);
});

test('取得先は国土交通省のサイトだけ', () => {
  for (const f of Object.values(FILES)) assert.match(f.url, /^https:\/\/www\.mlit\.go\.jp\//);
});

// 小さな PDF を作る。ToUnicode の範囲の形(連番・配列)と圧縮を確かめる
function tinyPdf() {
  const cmap = 'beginbfchar\n<0001> <6A19>\nendbfchar\nbeginbfrange\n<0002> <0003> <0041>\n<0004> <0005> [<6E96> <5358>]\nendbfrange\n';
  const content = 'BT /F1 10 Tf 1 0 0 1 72 700 Tm <00010002> Tj ET\nBT /F1 10 Tf 1 0 0 1 72 680 Tm [<0004> 5 <0005>] TJ ET\n';
  const z = zlib.deflateSync(Buffer.from(content, 'latin1')).toString('latin1');
  const objs = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n',
    `4 0 obj\n<< /Length ${z.length} /Filter /FlateDecode >>\nstream\n${z}\nendstream\nendobj\n`,
    '5 0 obj\n<< /Type /Font /ToUnicode 6 0 R >>\nendobj\n',
    `6 0 obj\n<< /Length ${cmap.length} >>\nstream\n${cmap}endstream\nendobj\n`,
  ];
  return Buffer.from('%PDF-1.5\n' + objs.join('') + 'trailer\n<< /Root 1 0 R >>\n', 'latin1');
}

test('PDF の読み取り: 圧縮した内容、ToUnicode の連番と配列', () => {
  const [p] = pdfPages(tinyPdf());
  assert.equal(p.page, 1);
  assert.deepEqual(p.items.map((i) => [i.text, i.x, i.y]), [['標A', 72, 700], ['準単', 72, 680]]);
});

test('PDF でないものは読まない', () => {
  assert.throws(() => pdfPages(Buffer.from('これは PDF ではない')), /読めません/);
});

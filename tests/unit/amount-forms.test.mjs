// F81a の単体の試験: 公告の額の書き方を読み、千円の単位の取り違えで判定が裏返らないこと。
// 通しの試験は、公告の文 → 照合 → 画面に入れる値のファイル → 欄の値 → 判定を本物の部品でつなぐ。
// 境目の値は src の定数(dedicatedThreshold)のまま使い、ここに数字を書かない。公告の文はすべて架空。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { checkConditions, parseAmounts } from '../../plugin/skills/bid-intake/scripts/check-conditions.mjs';
import { parseIntakeFile } from '../../src/intake-load.mjs';
import { readBidForm } from '../../src/ui/form.mjs';
import { bidCheck, dedicatedThreshold } from '../../src/bid-check.mjs';

const YEN = 134200000;
const yen = (s) => parseAmounts(s).map((a) => a.yen);

// 直す前に赤だった3つと、もう通っていた3つ。分けておくと直す前の出力で見分けられる
for (const [mark, s] of [
  ['赤', '134.2百万円'],
  ['赤', '￥134,200,000-'],
  ['赤', '134,200 千円'],
  ['緑', '１３４，２００千円'],
  ['緑', '134,200,000円'],
  ['緑', '1億3,420万円'],
]) {
  test(`額の書き方(${mark}): ${s} は同じ数に戻る`, () => {
    assert.deepEqual(yen(s), [YEN]);
  });
}

test('違う数: 1,342百万円 は別の数に読む', () => {
  assert.deepEqual(yen('1,342百万円'), [1342000000]);
  assert.notEqual(yen('1,342百万円')[0], YEN);
});

test('範囲の外: 「約」の付いた額は今までどおり数だけを読む(直していない。critic.md に書いた)', () => {
  assert.deepEqual(yen('約134百万円'), [134000000]);
});

test('単位の前の空白: 半角・全角・タブのどれでも読み、千と百万と千万で同じに扱う', () => {
  for (const s of ['134,200 千円', '134,200　千円', '134,200\t千円', '134,200 千 円', '１３４，２００　千円', '134.2 百万円', '134.2 百 万円']) {
    assert.deepEqual(yen(s), [YEN], s);
  }
  assert.deepEqual(yen('134 百万円'), [134000000]);
  assert.deepEqual(yen('3 千万円'), [30000000], '「千万円」だけを読まない');
  assert.deepEqual(yen('1億 3 千万円'), [130000000], '億の続きを落とさない');
  assert.deepEqual(yen('1万 5 千円'), [15000]);
});

test('額の途中から読まない: 空白で区切られた額は、後ろの一部だけを額にしない', () => {
  // 欄に入る値が額より小さくなる形。読めないなら額にしない(値は外れて人が見る)
  for (const s of ['3 千 5 百万円', '3千 5百万円', '1億 3 千 4 百万円', '5 千 3 百円', '3 千500万円', '3 千 500万円', '1億 3 千 4 百 2 十万円', '5 千3百円']) {
    assert.deepEqual(yen(s), [], s);
  }
  // 頭を断るだけだと、億の後ろの一部を読む。丸ごと読まない
  for (const s of ['千 23億 5,400万円', '百 72億2,800万円', '三百 502億 1 千万円', '十 84億4千4百7十万円']) {
    assert.deepEqual(yen(s), [], s);
  }
  assert.deepEqual(yen('千 ￥134,200,000-'), [YEN], '円の印のある額は前の語に左右されない');
  assert.deepEqual(yen('予定 100千円 200千円'), [100000, 200000], '別々の額は読む');
  assert.deepEqual(yen('3 千円 500万円'), [3000, 5000000], '円で終わる額の後は別の額');
  assert.deepEqual(yen('千円 500万円'), [5000000]);
  assert.deepEqual(yen('(単位:千円) 12,000 円'), [12000]);
});

test('照合: 額の途中だけを読んで、違う額のまま「拾えた」にしない', () => {
  const q = '予定価格 3 千 5 百万円(税込)';
  const { r } = budget('3 千 5 百万円', q);
  assert.equal(Object.hasOwn(r.form, 'contract-amount'), false);
  assert.deepEqual(r.removed.map((x) => x.reason), ['金額の値に「円」が無い']);
  assert.equal(budget('35,000,000円', q).r.removed.length, 1, '円に直した値も抜き書きの額と合わないので外す');
});

test('改行をまたいで読まない: 単位だけが次の行にある額は額にしない', () => {
  for (const s of ['134,200\n千円', '134,200\r\n千円', '134.2\n百万円', '134\r百万円', '￥\n134,200,000-', '134,200 \n 千円']) {
    assert.deepEqual(yen(s), [], s);
  }
  assert.deepEqual(yen('3\n千万円'), [10000000], '行をつなげない。次の行の「千万円」はそれだけの額に読む(前からの動き)');
  assert.deepEqual(yen('￥134,200,000\n-'), [YEN], '末尾の線は次の行にあっても数は読める');
});

test('単位の語: 数の無い千円・百万円は額に数えない。漢数字の見出し番号の後の空白も額にしない', () => {
  for (const s of ['(単位:千円)', '(単位:百万円)', '千 円', '百 万円', '￥千円', '￥百万', '金額(￥千円)', '二 千円', '三　百万円']) {
    assert.deepEqual(yen(s), [], s);
  }
});

test('小数: 百・千の前の小数を読み、桁区切りと一緒でも読み違えない', () => {
  assert.deepEqual(yen('134.2千円'), [134200]);
  assert.deepEqual(yen('1.5千万円'), [15000000]);
  assert.deepEqual(yen('0.5百万円'), [500000]);
  assert.deepEqual(yen('1,342.5百万円'), [1342500000]);
  assert.deepEqual(yen('1.2億円'), [120000000], '前からの形');
  assert.equal(parseAmounts('1,342.5百万円')[0].badComma, false);
  assert.equal(parseAmounts('12,34.5百万円')[0].badComma, true);
  assert.equal(parseAmounts('134,200 千円')[0].badComma, false);
  assert.equal(parseAmounts('12,34 千円')[0].badComma, true);
});

test('全角の小数点: 小数点の後ろだけを額にしない', () => {
  assert.deepEqual(yen('１３４．２百万円'), [YEN]);
  assert.deepEqual(yen('１．３４２億円'), [YEN]);
  assert.deepEqual(yen('￥１３４．２百万'), [YEN]);
});

test('数にならない並びは額にしない(NaN を返さない)', () => {
  for (const s of ['1.2.3円', '1.2.3百万円', '三.五億円', '1..2万円']) {
    const list = parseAmounts(s);
    assert.ok(list.every((a) => Number.isFinite(a.yen)), s);
  }
  assert.deepEqual(yen('1.2.3円'), []);
});

test('円の印: 半角・全角、空白、末尾の線の有無、線の字の違いで同じ数に読む', () => {
  for (const s of [
    '¥134,200,000-', '￥134,200,000', '¥134,200,000', '￥ 134,200,000-', '￥　134,200,000－', '￥134,200,000ー', '￥134,200,000.-',
    '￥134,200,000円', '￥１３４，２００，０００－', '￥134,200千円', '￥134.2百万円', '￥134.2百万', '￥134,200千', '￥1億3,420万-', '￥1億3,420万',
  ]) assert.deepEqual(yen(s), [YEN], s);
});

test('円の印: 長さと位置は元の文のまま。線も額の長さに入れ、後ろの語が見える', () => {
  const s = '工事費 ￥1,000,000-以上';
  const [a] = parseAmounts(s);
  assert.equal(a.raw, '￥1,000,000-');
  assert.equal(s.slice(a.index + a.raw.length), '以上');
  assert.equal(parseAmounts('￥12,34,000-')[0].badComma, true);
  assert.equal(parseAmounts('￥1,234,000-')[0].badComma, false);
  assert.equal(parseAmounts('￥134,200,000.-')[0].badComma, false);
  assert.equal(parseAmounts('￥1,000 円')[0].raw, '￥1,000 円');
  assert.equal(parseAmounts('￥1,000 と')[0].raw, '￥1,000');
});

test('円の印: 末尾の線はどの字でも額の長さに入る', () => {
  for (const dash of ['-', '－', 'ー', '―', '‐', '−', '–', '—']) {
    const [x] = parseAmounts(`￥1,000,000${dash}以上`);
    assert.equal(x.raw, `￥1,000,000${dash}`, dash);
  }
});

test('円の印: 並べても別の額に読み、印の無い数は額にしない', () => {
  assert.deepEqual(yen('￥100,000-￥200,000-'), [100000, 200000]);
  assert.deepEqual(yen('￥100,000 200,000'), [100000]);
  assert.deepEqual(yen('134,200,000-'), [], '印も「円」も無い数は読まない');
  assert.deepEqual(yen('￥0-'), []);
  assert.deepEqual(yen('￥' + '1'.repeat(41)), [], '長すぎる並びは途中まで読まない');
  assert.deepEqual(yen('￥一億円'), [100000000], '前からの形');
});

test('円の印: 「円」が無く、後ろに空白を挟んで十百千万億が続く額は読まない(額の続きか次の語か分からない)', () => {
  for (const s of [
    '￥134,200,000 千代田区', '￥134,200,000　千葉市', '￥134,200,000\t千歳市', '￥134,200,000 万代町', '￥134,200,000 百貨店', '￥100 億野', '￥100 万博', '￥100 十日町市',
    '￥134,200 千(税込)', '￥134,200 千', '￥1億 3,420 万(税込)', '￥1億 3,420 万', '￥38,382,000 千以上', '￥1,000 千税込',
    '￥127億8,200万 十日町市', '￥8.0百万 十日町市', '￥100万 千葉市', '￥100万千葉市',
  ]) assert.deepEqual(yen(s), [], s);
});

test('円の印: 額の途中で止めない(読み切れないなら途中までの数にしない)', () => {
  for (const s of [
    '￥9 千 8 百円', '¥6 千8百8十万円', '￥95億8千1 百3十万円', '￥15 億 4千 6百万円', '¥43億3 千2 百 8 十万円', '¥5百7十 7万円',
    '￥100,000一式', '￥3億9,600万一式', '￥1億 3,420万(税込)', '¥2千 1百1 十万円', '¥2千7百 7十万円', '￥100万 200万',
  ]) assert.deepEqual(yen(s), [], s);
});

test('円の印: 「円」があれば空白があっても読み、「円」が無くても単位が付いていれば読む', () => {
  assert.deepEqual(yen('￥134,200 千円'), [YEN]);
  assert.deepEqual(yen('￥134,200 千円税込'), [YEN]);
  assert.deepEqual(yen('￥1億 3,420 万円'), [YEN]);
  assert.deepEqual(yen('￥1億三千四百二十万円'), [YEN], '漢数字は「円」のある形で読む');
  assert.deepEqual(yen('￥100万以上'), [1000000]);
  assert.deepEqual(yen('￥134.2百万税込'), [YEN]);
  assert.deepEqual(yen('￥134,200,000 一式'), [YEN], '空白の後の一式は単位ではない');
  assert.deepEqual(yen('￥100 200円'), [100, 200]);
  assert.equal(parseAmounts('￥1億 (税込)')[0].raw, '￥1億');
});

// 読むなら正しい額、読めないなら額なし。違う額のまま「拾えた」になる形を、書き方と前後の語の組み合わせで探す
test('組み合わせ: 書き方と空白と前後の語をどう組んでも、読むなら正しい額で、違う額にはならない', () => {
  const gaps = ['', ' ', '　', '\t'];
  const FIVE = 35000000;
  const writes = (g, h) => [
    [`134,200${g}千${h}円`, YEN], [`134.2${g}百${h}万円`, YEN], [`134.2百万${g}円`, YEN], [`13,420${g}万${h}円`, YEN],
    [`1${g}億${h}3,420万円`, YEN], [`1億${g}3,420${h}万円`, YEN], [`1億${g}3千${h}4百2十万円`, YEN], [`1${g}億${h}3千4百2十万円`, YEN],
    [`3${g}千${h}5百万円`, FIVE], [`3千${g}5${h}百万円`, FIVE], [`3${g}千5${h}百万円`, FIVE],
    [`１３４，２００${g}千${h}円`, YEN], [`１３４．２${g}百${h}万円`, YEN],
    ...['￥', '¥', '￥ '].flatMap((mark) => [
      [`${mark}134,200,000${g}円`, YEN], [`${mark}134,200${g}千${h}円`, YEN], [`${mark}1${g}億${h}3,420万円`, YEN], [`${mark}1億${g}3千${h}4百2十万円`, YEN],
      [`${mark}134,200${g}千`, YEN], [`${mark}134.2${g}百万`, YEN], [`${mark}1${g}億${h}3,420万`, YEN], [`${mark}1億${g}3,420${h}万`, YEN], [`${mark}1億${g}3千${h}4百2十万`, YEN],
      [`${mark}3${g}千${h}5百万円`, FIVE], [`${mark}3${g}千${h}5百万`, FIVE], [`${mark}3千${g}5${h}百万`, FIVE],
    ]),
  ];
  const before = ['', '予定価格 ', '予定価格:', '金', '金 ', '| ', '(', '第3条 ', '2 ', '十 ', '千 ', '百 ', '三百 ', '千代田区 '];
  const after = ['', '(税込)', ' 税込み', '税込', ' 千代田区', ' 千葉市', ' 万代町', ' 百貨店', ' 十日町市', '　千歳市', '以上', ' 以下', '。', ' 一式', ' 3 ', ' |'];
  let n = 0;
  for (const g of gaps) for (const h of gaps) for (const [body, want] of writes(g, h)) for (const pre of before) for (const post of after) {
    const s = pre + body + post;
    const got = yen(s);
    n++;
    assert.ok(got.length === 0 || (got.length === 1 && got[0] === want), `${JSON.stringify(s)} は ${want} のはずが ${got}`);
  }
  assert.ok(n > 100000);
});

const src = (text, file = '公告.txt') => ({ file, text });
const budget = (value, quote, sources = [src(quote)]) => {
  const r = checkConditions({ source: { title: '架空の公告' }, conditions: [{ key: 'budget', value, quote }] }, sources);
  return { removed: r.removed, row: r.rows.find((x) => x.key === 'budget'), r };
};

test('照合: 値が正しければどの書き方の抜き書きでも外さず、確かめにも回さない', () => {
  for (const q of ['予定価格 134.2百万円(税込)', '予定価格 ￥134,200,000-(税込)', '予定価格 134,200 千円(税込)', '予定価格 １３４．２百万円(税込)']) {
    for (const value of ['134,200,000円', q.slice(5, -4)]) {
      const { removed, row } = budget(value, q);
      assert.deepEqual(removed, [], q + ' / ' + value);
      assert.deepEqual(row.flags, [], q + ' / ' + value);
    }
  }
});

test('照合: 千円を円と読み違えた値は桁が違うと出し、画面に入れない', () => {
  const q = '予定価格 134,200 千円(税込)';
  const { removed, row, r } = budget('134,200円', q);
  assert.deepEqual(removed, []);
  assert.match(row.flags.join(' / '), /桁が違う/);
  assert.equal(row.status, '確かめが要る');
  assert.equal(Object.hasOwn(r.form, 'contract-amount'), false);
});

test('照合: ファイルをまたいで書き方が違うだけなら食い違いにしない。額が違えば見つける', () => {
  const q = '予定価格 134,200,000円(税込)';
  const flags = (other) => budget('134,200,000円', q, [src(q), src(other, '説明書.txt')]).row.flags.join(' / ');
  for (const same of ['予定価格 134.2百万円', '予定価格 ￥134,200,000-', '予定価格 134,200 千円']) assert.equal(flags(same), '', same);
  assert.match(flags('予定価格 134.3百万円'), /説明書\.txt 1行目.*金額が違う/);
  assert.match(flags('予定価格 134,200円'), /説明書\.txt 1行目.*桁が違う/);
  assert.match(flags('予定価格 ￥13,420,000-'), /説明書\.txt 1行目.*桁が違う/);
});

test('照合: 円の印の額が見出しの語から探す範囲の端にかかっても、途中までの数にしない', () => {
  const q = '予定価格 134,200,000円(税込)';
  for (let pad = 20; pad <= 29; pad++) {
    const other = '予定価格' + 'は'.repeat(pad) + '￥134,200,000-';
    assert.equal(budget('134,200,000円', q, [src(q), src(other, '説明書.txt')]).row.flags.join(' / '), '', other);
  }
});

test('照合: 円の印の額の後に千や万で始まる語が続くと、1000倍の額にせず確かめに回す', () => {
  const q = '予定価格 ￥134,200,000 千代田区(税込)';
  const { row, removed, r } = budget('134,200,000円', q);
  assert.deepEqual(removed, []);
  assert.equal(row.status, '確かめが要る');
  assert.doesNotMatch(row.flags.join(' / '), /桁が違う/);
  assert.equal(Object.hasOwn(r.form, 'contract-amount'), false);
  const p = '予定価格 134,200,000円(税込)';
  assert.equal(budget('134,200,000円', p, [src(p), src('予定価格 ￥134,200,000 万代町', '説明書.txt')]).row.flags.join(' / '), '', '読まない額とは比べない');
});

test('照合: 見出しの語から離れた額は比べない。範囲の中で始まる額だけを比べる', () => {
  const q = '予定価格 134,200,000円(税込)';
  const flags = (pad) => budget('134,200,000円', q, [src(q), src('予定価格' + 'は'.repeat(pad) + '500,000円', '説明書.txt')]).row.flags.join(' / ');
  assert.match(flags(29), /説明書\.txt 1行目/);
  assert.equal(flags(30), '');
});

test('変えていない決まり: 税抜きの額は画面に入れず、宣言の単位との不一致は確かめに回す', () => {
  const out = budget('134.2百万円', '予定価格 134.2百万円(税抜)').r;
  assert.equal(Object.hasOwn(out.form, 'contract-amount'), false);
  assert.match(out.formSkipped.find((x) => x.id === 'contract-amount').reason, /税抜き/);
  const q = '予定価格 134,200 税込み';
  const { removed, row } = budget('134,200円', q, [src('(単位:千円)\n' + q)]);
  assert.deepEqual(removed, []);
  assert.match(row.flags.join(' / '), /単位:千円/);
});

// 通しの試験: 公共の土木で、額のほかは同じ公告
const ANSWERS = { direct: true, 'subcontract-total': '0', license: 'tokutei', 'engineer-qualification': 'kanri' };
const noticeLine = (amount) => `予定価格 ${amount}(税込)`;
function throughScreen(amount) {
  const text = ['入札公告', '発注者 架空県', '工事の種類 土木一式工事', noticeLine(amount), ''].join('\n');
  const picked = { source: { title: '架空の公告' }, conditions: [
    { key: 'orderer-name', value: '架空県', quote: '発注者 架空県', form: { orderer: 'public' } },
    { key: 'work-class', value: '土木一式工事', quote: '工事の種類 土木一式工事', form: { 'work-type': 'other' } },
    { key: 'budget', value: amount, quote: noticeLine(amount) },
  ] };
  const result = checkConditions(picked, [src(text)]);
  const intake = parseIntakeFile(JSON.stringify(result));
  return { result, intake, bid: bidCheck(readBidForm({ ...ANSWERS, ...intake.form })) };
}
const dedicated = (bid) => bid.items.find((x) => x.key === 'dedicated');

test('通し: 百万円の書き方と円の書き方で、画面に入る値と判定がすべて同じ', () => {
  const plain = throughScreen('134,200,000円');
  for (const amount of ['134.2百万円', '￥134,200,000-', '134,200 千円']) {
    const other = throughScreen(amount);
    assert.deepEqual(other.result.removed, [], amount);
    assert.equal(other.intake.form['contract-amount'], String(YEN), amount);
    assert.deepEqual(other.intake.form, plain.intake.form, amount);
    assert.deepEqual(other.bid, plain.bid, amount);
  }
  assert.equal(dedicated(plain.bid).status, 'required');
});

test('通し: 千円を円と読み違えた額では専任の項目が違う', () => {
  const line = dedicatedThreshold().other;
  assert.ok(134200 < line && line <= YEN, '試す額が境目の両側にある');
  const right = throughScreen('134,200,000円');
  const wrong = throughScreen('134,200円');
  // 小さい額は確かめに回るので画面の欄に入らず、判定は「額が無い」になる
  assert.equal(Object.hasOwn(wrong.intake.form, 'contract-amount'), false);
  assert.equal(dedicated(wrong.bid).status, 'needs_check');
  assert.notEqual(dedicated(wrong.bid).status, dedicated(right.bid).status);
  // その額を人が欄に入れると、境目の下に落ちて「要らない」に裏返る
  const typed = bidCheck(readBidForm({ ...ANSWERS, ...wrong.intake.form, 'contract-amount': '134,200' }));
  assert.equal(dedicated(typed).status, 'not_required');
});

test('通し: 額が違う 1,342百万円 は読めて、境目の同じ側なので専任の判定は同じ', () => {
  const big = throughScreen('1,342百万円');
  assert.equal(big.intake.form['contract-amount'], '1342000000');
  assert.equal(dedicated(big.bid).status, dedicated(throughScreen('134,200,000円').bid).status);
});

// 足した読み方が長い1行で固まらないこと。同期の照合は vm の timeout でしか止められない
const STOP_MS = 10000;
const LIMIT_MS = 2000;
for (const [name, long] of [
  ['円の印だけの10万字', '￥'.repeat(100000)],
  ['円の印+空白10万字', '￥' + ' '.repeat(100000)],
  ['円の印と数字の繰り返し', '￥1'.repeat(50000)],
  ['円の印+数字と読点の10万字', '￥' + '1,'.repeat(50000)],
  ['数字+空白10万字+千', '1' + ' '.repeat(100000) + '千'],
  ['数字+空白10万字', '1' + ' '.repeat(100000)],
  ['数字と空白と千の繰り返し', '1 千'.repeat(30000)],
  ['円の印+数字+空白10万字', '￥1' + ' '.repeat(100000)],
  ['円の印+億+空白10万字', '￥1億' + ' '.repeat(100000)],
  ['小数点の10万字', '.'.repeat(100000)],
  ['千+空白10万字+数字', '千' + ' '.repeat(100000) + '1円'],
  ['数字+空白10万字+千+円', '1' + ' '.repeat(100000) + '千円'],
  ['千と空白と数字の繰り返し', '千 1 '.repeat(30000)],
  ['円の印+数字+空白+千の繰り返し', '￥1 千'.repeat(30000)],
  ['円の印+数字+空白10万字+万+語', '￥1' + ' '.repeat(100000) + '万博'],
  ['空白の10万字', ' '.repeat(100000) + '円'],
]) {
  test(`長い1行: ${name} で固まらない`, () => {
    const start = performance.now();
    vm.runInNewContext('fn()', { fn: () => parseAmounts(long) }, { timeout: STOP_MS });
    assert.ok(performance.now() - start <= LIMIT_MS);
  });
}

test('critic.md の「残っていること」に件19 の行と、直していない書き方がある', () => {
  const critic = fs.readFileSync(new URL('../../docs/critic.md', import.meta.url), 'utf8');
  const line = critic.split('\n').find((l) => l.startsWith('- ') && l.includes('件19'));
  assert.ok(line, '件19 の行が無い');
  assert.match(line, /直した/);
  assert.match(line, /F81a/);
  assert.match(line, /amount-forms\.test\.mjs/);
  const untouched = critic.slice(critic.indexOf(line));
  assert.match(untouched, /約134百万円/);
  assert.match(untouched, /直していない/);
});

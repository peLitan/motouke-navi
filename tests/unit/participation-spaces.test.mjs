// F65c の単体の試験: 公告から拾った条件を読み込むとき、参加の条件の欄へ入れる文の空白と折り返しを詰める。
// 文は実在の公告の形だけをまねた架空のもの。実物の確かめは作品の外で行った(progress.md)
import test from 'node:test';
import assert from 'node:assert/strict';
import { tidyPdfText } from '../../src/pdf-text.mjs';
import { parseIntakeFile, intakeLines } from '../../src/intake-load.mjs';
import { findPrimeExperience } from '../../src/prime-experience.mjs';
import { buildHtml } from '../../build.mjs';
import { runPage } from '../acceptance/_helpers.mjs';

const flat = (s) => s.replace(/\s/g, '');
const RUN = /\s{2,}/;

const WRAPPED = '別表の１に示す期間に元請けとして、架空の同種工事を施工した実績を有すること(共同企業体の構成\n    員としての実績は、出資比率が 20%以上のものに限る。)。';
const BLANK_LINE = '実績期間：平成 23 年４月１日から令和８年３月 31 日までの間\n\n                                     に元請として完成・引渡しが完了した同種工事';
const NESTED = '同種工事：架空工事関係事業における工事（渓間工事、山腹工\n                         事、架空の造成工事（植栽を\n                         除く））であること。';
const NUMBER_WRAP = '架空市が発注した工事にあっては、その評定点が\n    65 点未満のものは実績として認めない。';
const TABLE_ROW = '４ 評定点の平均に係わる期間    期間：令和６年４月１日～令和８年３月 31 日（過去２年度）';
const ITEMS = '（４）平成２２年度以降に元請けとして完成した同種工事の施工実績を有すること。\n      （共同企業体の構成員としての実績は、出資比率２０％以上の場合のものに限る。）なお、当該施工実績が架空\n      省が発注した工事にあっては、「工事成績評定表」の\n      評定点合計が６５点未満のものを除くこと。\n      ・事務所の新築又は改修工事';
const ROWS = [WRAPPED, BLANK_LINE, NESTED, NUMBER_WRAP, TABLE_ROW, ITEMS];
const TIDY = [
  '別表の１に示す期間に元請けとして、架空の同種工事を施工した実績を有すること(共同企業体の構成員としての実績は、出資比率が 20%以上のものに限る。)。',
  '実績期間：平成 23 年４月１日から令和８年３月 31 日までの間に元請として完成・引渡しが完了した同種工事',
  '同種工事：架空工事関係事業における工事（渓間工事、山腹工事、架空の造成工事（植栽を除く））であること。',
  '架空市が発注した工事にあっては、その評定点が65 点未満のものは実績として認めない。',
  '４ 評定点の平均に係わる期間 期間：令和６年４月１日～令和８年３月 31 日（過去２年度）',
  '（４）平成２２年度以降に元請けとして完成した同種工事の施工実績を有すること。\n（共同企業体の構成員としての実績は、出資比率２０％以上の場合のものに限る。）なお、当該施工実績が架空省が発注した工事にあっては、「工事成績評定表」の評定点合計が６５点未満のものを除くこと。\n・事務所の新築又は改修工事',
];

test('公告の形: 連続した空白と文の途中の改行が詰まり、箇条の区切りは残る', () => {
  ROWS.forEach((row, i) => assert.equal(tidyPdfText(row), TIDY[i]));
});

test('連続した空白(半角・全角・混ざり・タブ)は1つにする。1つだけの空白は変えない', () => {
  for (const s of ['甲  乙', '甲　　乙', '甲 　乙', '甲　 乙', '甲\t\t乙', '甲\u00a0　乙', '甲          乙']) assert.equal(tidyPdfText(s), '甲 乙', s);
  for (const s of ['令和８年 10 月 21 日', '甲　乙', '甲 乙']) assert.equal(tidyPdfText(s), s);
  assert.equal(tidyPdfText('　　甲   \n'), '甲', '行の頭と終わりの空白は除く');
});

test('文の途中の改行を詰める。いろいろな改行の字と空の行も同じ', () => {
  for (const s of ['甲の\n乙', '甲の\r\n乙', '甲の\r乙', '甲の\f乙', '甲の\u2028乙', '甲の\n\n\n乙', '甲の  \n  \n   乙']) assert.equal(tidyPdfText(s), '甲の乙', JSON.stringify(s));
  assert.equal(tidyPdfText('甲の\n（乙）は丙'), '甲の（乙）は丙', '番号ではない括弧は箇条の頭にしない');
});

test('文の終わりの改行は残す。括弧の中の句点は文の途中なので詰める', () => {
  for (const s of ['甲。\n乙', '甲．\n乙', '甲(乙。)\n丙', '甲「乙。」\n丙', '甲。\n（乙）は丙']) assert.equal(tidyPdfText(s), s);
  assert.equal(tidyPdfText('甲を有する。\n\n   乙は除く。'), '甲を有する。\n乙は除く。', '空の行は1つの改行にする');
  assert.equal(tidyPdfText('甲(乙をいう。\n以下同じ。)は丙'), '甲(乙をいう。以下同じ。)は丙');
  assert.equal(tidyPdfText('甲(乙に限る。\n)。'), '甲(乙に限る。)。');
  assert.equal(tidyPdfText('甲(乙に限る。\n丙を有する。'), '甲(乙に限る。\n丙を有する。', '対の無い括弧は括弧として見ない');
});

test('箇条の区切りは、前の行に句点が無くても残す', () => {
  const heads = ['(1) 乙', '（１）乙', '(12)乙', '1) 乙', '１）乙', '1. 乙', '１．乙', '① 乙', '(ア) 乙', '（イ）乙', 'ア 乙', 'イ　乙', '・乙', '･乙', '※乙', '３ 同種工事の実績', '4 工事成績', '1 件名', '2 名称', '10 分任官', '12 日本語の書類', '5 回答の期限', '3 点検の方法'];
  for (const h of heads) assert.equal(tidyPdfText('甲\n' + h), '甲\n' + h, h);
  assert.equal(tidyPdfText('(1) 甲の\n    乙\n(2) 丙\n    ・丁の\n      戊'), '(1) 甲の乙\n(2) 丙\n・丁の戊', '箇条の中の折り返しは詰める');
});

test('行頭の数でも、単位や助詞が続けば番号ではなく文の続き', () => {
  const tails = ['65 点未満のもの', '6 点以上', '10 月 21 日まで', '21 日以内', '3 か月以内', '3 ヶ月以内', '3 箇月以内', '500 万円以上', '20 %以上', '20 ％以上', '1 級土木施工管理技士', '2 以上の工事', '5 以内', '10 未満', '1 の期間', '3 年以内', '2 名以上', '3.5 億円以上', '１．５ 倍'];
  for (const t of tails) assert.equal(tidyPdfText('甲が\n' + t), '甲が' + t, t);
});

test('英数字どうしをつなぐときは空白を1つ置く。語がくっつかない', () => {
  assert.equal(tidyPdfText('JIS\nA 1234'), 'JIS A 1234');
  assert.equal(tidyPdfText('ISO\n9001'), 'ISO 9001');
  assert.equal(tidyPdfText('甲 ISO\n乙'), '甲 ISO乙');
  assert.equal(tidyPdfText('甲\nISO'), '甲ISO');
});

test('空の文は空のまま', () => {
  for (const s of [null, undefined, '', '   ', '\n \n', '　\r\n　']) assert.equal(tidyPdfText(s), '');
});

// 決まった種から文を作る(毎回同じ列になる)
function* strings(n) {
  const parts = ['甲', '乙', 'の', '。', '、', '．', '(', ')', '（', '）', '「', '」', '1', '６', '65', '・', '･', 'ア', '点', '未満', '件名', 'A', 'b', '.', '％', '①', '(1)', '（２）', ' ', ' ', '　', '\t', '\n', '\n', '\r\n', '\f', '\u2028', '\u00a0'];
  let seed = 20261106;
  const next = (m) => { seed = (seed * 48271) % 2147483647; return seed % m; };
  for (let i = 0; i < n; i += 1) yield Array.from({ length: next(40) }, () => parts[next(parts.length)]).join('');
}

test('どんな文でも: 空白以外の字の並びは同じ。2つ以上続く空白は残らない', () => {
  for (const row of ROWS) assert.equal(flat(tidyPdfText(row)), flat(row));
  for (const s of strings(5000)) {
    const out = tidyPdfText(s);
    assert.equal(flat(out), flat(s), JSON.stringify(s));
    assert.ok(!RUN.test(out), JSON.stringify(s));
    assert.equal(out, out.trim(), JSON.stringify(s));
  }
});

// 作った文の全部では見ない。「3.」で終わる行の次が数の形だけ、1回目は番号、つないだ後は小数に見えて揺れる。
// 読み込みは原文から1回だけ通すので、この形の改行が1つ残っても害は無い
test('公告の形は2回通しても同じ', () => {
  for (const row of [...ROWS, ...TIDY]) assert.equal(tidyPdfText(tidyPdfText(row)), tidyPdfText(row));
});

const row = (quote, extra = {}) => ({ key: 'past-work', label: '施工実績', status: '拾えた', quote, ...extra });
const intakeFile = (rows, form = {}) => JSON.stringify({ kind: 'bid-intake', source: { title: '架空の公告' }, rows, form });

test('読み込み: 欄の文は詰まり、行の区切りは残り、根拠の抜き書きは原文のまま', () => {
  const quote = '  契約担当官\n        架空局長  ';
  const file = intakeFile([{ key: 'orderer-name', label: '発注者', status: '拾えた', quote }, ...ROWS.map((q) => row(q))], { orderer: 'public' });
  const t = parseIntakeFile(file);
  assert.equal(t.participation, TIDY.join('\n'));
  assert.ok(!RUN.test(t.participation));
  assert.deepEqual(t.rows, JSON.parse(file).rows, '行の抜き書きは1字も変わらない');
  assert.equal(t.quotes.orderer, quote, '確認の画面の抜き書きも原文のまま');
});

test('読み込み: 抜き書きが無い行は値を整える。空になる行は入れない', () => {
  const t = parseIntakeFile(intakeFile([row('', { value: '元請けの  同種工事の\n   実績' }), row('   \n  '), row(ITEMS, { status: '公告に書いていない' })]));
  assert.equal(t.participation, '元請けの 同種工事の実績');
});

test('知らせの判定は詰める前と変わらない(空白を除いて同じ文を選ぶ)', () => {
  const raw = ROWS.join('\n');
  const tidy = TIDY.join('\n');
  assert.equal(flat(findPrimeExperience(tidy)), flat(findPrimeExperience(raw)));
  assert.equal(findPrimeExperience(tidy), TIDY[0]);
  assert.equal(findPrimeExperience('元請け、下請けを問わず同種工事の\n    施工実績を有すること。'), null);
  assert.equal(findPrimeExperience(tidyPdfText('元請け、下請けを問わず同種工事の\n    施工実績を有すること。')), null);
  assert.ok(intakeLines(parseIntakeFile(intakeFile(ROWS.map((q) => row(q))))).some((x) => x.startsWith('確認が要る 元請けの施工実績')));
});

async function load(page, text) {
  page.el('intake-load').files = [{ size: text.length, text: async () => text }];
  await page.set('intake-load', '');
}

test('画面: 読み込むと欄に詰めた文が入り、確認の画面と結果の抜き書きも同じ文になる', async () => {
  const page = runPage(buildHtml());
  await page.click('entry-bid');
  await load(page, intakeFile(ROWS.map((q) => row(q))));
  const value = page.el('participation-conditions').value;
  assert.equal(value, TIDY.join('\n'));
  assert.ok(!RUN.test(value), '2つ以上続く空白が無い');
  await page.click('bid-run');
  const confirm = page.el('confirm-value-participation-conditions').innerHTML;
  assert.ok(confirm.includes(TIDY[0]), confirm);
  assert.match(confirm, /出どころ: 公告/);
  await page.click('confirm-go');
  assert.ok(page.el('bid-result').innerHTML.includes('公告の文: 「' + TIDY[0] + '」'));
  assert.ok(page.el('open-items').innerHTML.includes(TIDY[0]));
});

test('画面: 手で入れた文は変えない(詰めるのは読み込みのときだけ)', async () => {
  const page = runPage(buildHtml());
  await page.click('entry-bid');
  const typed = '元請けとして  同種工事の\n   施工実績を有すること。';
  await page.set('participation-conditions', typed);
  await page.click('bid-run');
  assert.equal(page.el('participation-conditions').value, typed);
  assert.match(page.el('confirm-value-participation-conditions').innerHTML, /出どころ: 手入力/);
});

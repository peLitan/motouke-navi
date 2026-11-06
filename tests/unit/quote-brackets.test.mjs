// F65b: 結果の知らせに出す公告の抜き書きの括弧。文はすべて架空。
// HEAD は実在の公告で見つかった形(括弧の中の句点、閉じの後の句点、PDF の折り返し)だけをまねた
import test from 'node:test';
import assert from 'node:assert/strict';
import { bracketPairs, cutQuote, splitSentences } from '../../src/brackets.mjs';
import { findPrimeExperience } from '../../src/prime-experience.mjs';
import { bidCheck } from '../../src/bid-check.mjs';
import { readBidForm } from '../../src/ui/form.mjs';
import { renderConfirmRow } from '../../src/ui/confirm.mjs';
import { SAMPLE } from '../../src/sample.mjs';
import { buildHtml } from '../../build.mjs';
import { runPage } from '../acceptance/_helpers.mjs';

// 作った部品を使わずに、括弧の対を確かめる
const CLOSE_OF = { '「': '」', '『': '』', '(': ')', '（': '）' };
function balanced(text) {
  const stack = [];
  for (const c of text) {
    if (CLOSE_OF[c]) stack.push(CLOSE_OF[c]);
    else if (Object.values(CLOSE_OF).includes(c) && stack.pop() !== c) return false;
  }
  return stack.length === 0;
}
const flat = (s) => s.replace(/\s/g, '');

const HEAD = '別紙に示す期間に元請けとして、以下に示す同種工事を施工した実績を有すること(共同企業体の構成\n    員としての実績は、出資比率が 20%以上のものに限る。)。';
const HEAD_ONE_LINE = '別紙に示す期間に元請けとして、以下に示す同種工事を施工した実績を有すること(共同企業体の構成員としての実績は、出資比率が 20%以上のものに限る。)。';
const ROWS = [HEAD, '実績期間：平成 23 年４月１日から令和８年３月 31 日までの間\n\n        に完成した同種工事', '同種工事：架空の工事（甲工事、乙工事（丙を\n        除く））であること。', '経常建設共同企業体にあっては、すべての構成員が上記の基準を満たす施工実績を有すること。'];
const BLOCK = ROWS.join('\n');

test('括弧の中の句点で切らない: 丸括弧(半角・全角・混ざり)、鉤括弧、二重鉤括弧、入れ子', () => {
  for (const s of [
    '甲を有すること(乙に限る。)。',
    '甲を有すること（乙に限る。）。',
    '甲を有すること(乙に限る。）。',
    '甲を有すること（乙に限る。)。',
    '「甲を有すること。」を満たすこと。',
    '『甲を有すること。』を満たすこと。',
    '甲を有すること(乙に限る(丙を除く。)。)。',
    '甲を有すること(「乙。」に限る。)。',
    '甲を有すること(乙に限る。ただし丙を除く。)。',
  ]) assert.deepEqual(splitSentences(s), [s], s);
});

test('括弧の外の句点では今までどおり切る。閉じの後の文は次の文になる', () => {
  assert.deepEqual(splitSentences('甲(乙)を有する。丙を有する。'), ['甲(乙)を有する。', '丙を有する。']);
  assert.deepEqual(splitSentences('甲を有すること(乙に限る。)。丙を有する。'), ['甲を有すること(乙に限る。)。', '丙を有する。']);
  assert.deepEqual(splitSentences('句点の無い文'), ['句点の無い文']);
  assert.deepEqual(splitSentences(''), []);
});

test('対の無い括弧は後ろの文を飲み込まない', () => {
  assert.deepEqual(splitSentences('甲(乙に限る。丙を有する。'), ['甲(乙に限る。', '丙を有する。']);
  assert.deepEqual(splitSentences('1) 甲を有する。2) 丙を有する。'), ['1) 甲を有する。', '2) 丙を有する。']);
  assert.deepEqual(splitSentences('甲「乙(丙)を有する。丁を有する。'), ['甲「乙(丙)を有する。', '丁を有する。']);
  assert.deepEqual(bracketPairs('1) 甲(乙 丙'), []);
  assert.deepEqual(bracketPairs('甲(乙「丙)丁」'), [[1, 5]], '閉じていない内側の開きは捨て、後ろの閉じと対にしない');
});

test('文の頭から始まって「。)」で閉じる丸括弧は1文。文の途中の括弧は続き', () => {
  assert.deepEqual(splitSentences('甲を有する。\n  (乙に限る。)なお、丙は除く。'), ['甲を有する。', '\n  (乙に限る。)', 'なお、丙は除く。']);
  assert.deepEqual(splitSentences('(乙に限る。)丙は除く。'), ['(乙に限る。)', '丙は除く。']);
  assert.deepEqual(splitSentences('(乙に限る。)。'), ['(乙に限る。)。']);
  assert.deepEqual(splitSentences('甲(乙をいう。以下同じ。)は丙を有する。'), ['甲(乙をいう。以下同じ。)は丙を有する。']);
  assert.deepEqual(splitSentences('「甲を有すること。」と定める。'), ['「甲を有すること。」と定める。']);
  assert.deepEqual(splitSentences('(1)甲を有する。'), ['(1)甲を有する。']);
});

test('文の列はつなぐと元の文に戻る(語も空白も変えない)', () => {
  for (const s of [HEAD, BLOCK, '甲を有する。\n  (乙に限る。)なお、丙は除く。', '甲(乙に限る。丙を有する。)'])
    assert.equal(splitSentences(s).join(''), s);
});

test('実在の公告の形: 抜き書きは閉じ括弧と句点まで出て、語は原文のまま(折り返しだけ詰まる)', () => {
  const quote = findPrimeExperience(BLOCK);
  assert.equal(quote, HEAD_ONE_LINE);
  assert.ok(balanced(quote), quote);
  assert.ok(flat(BLOCK).includes(flat(quote)));
});

test('括弧の中で切らないので、括弧の後ろの語も見る。法令の書き方の「以下同じ」でも元請けの条件が当たる', () => {
  const s = '元請け(発注者から直接請け負った者をいう。以下同じ。)として同種工事の施工実績を有すること。';
  assert.equal(findPrimeExperience(s), s);
});

test('当たらなかった文は当たらないまま: 括弧の前の語で後ろの文を判定しない', () => {
  // 「限る」は括弧の中の語。つなげて見ると、実績を外す文が「求めている形」に見えて当たってしまう
  assert.equal(findPrimeExperience('（共同企業体の構成員としての実績は、出資比率２０％以上に限る。）なお、元請けとして施工した架空市発注工事については、工事成績が65点未満のものは、本施工実績とはならない。'), null);
  assert.equal(findPrimeExperience('元請けは工程を管理する(同種工事の実績はこの公告では問わない。)。\n同種工事の施工実績を有すること。'), null);
});

test('確認が要る点の文で、抜き書きの括弧の対がそろう', () => {
  const out = bidCheck({ ...readBidForm(SAMPLE.form), participationConditions: BLOCK });
  const c = out.checks.find((x) => x.key === 'prime-experience');
  assert.ok(c.message.endsWith('公告の文: 「' + HEAD_ONE_LINE + '」'), c.message);
  assert.ok(balanced(c.message), c.message);
});

const LONG = '予定価格 82,500,000円(うち取引に係る消費税額及び地方消費税額の合計額を除いた額は架空の額であり、この額は' + 'あ'.repeat(60) + 'の範囲で定める。)';

test('長さで切る: 開いたままの括弧の閉じを残す。内側の括弧から順に閉じ、元の文の閉じ括弧の字を使う', () => {
  assert.equal(cutQuote('甲乙丙', 3), '甲乙丙');
  assert.equal(cutQuote('甲乙丙', 2), '甲乙…');
  assert.equal(cutQuote('甲(乙丙)丁', 3), '甲(乙…)');
  assert.equal(cutQuote('甲(乙)丙丁', 4), '甲(乙)…', '切る前に閉じた括弧には足さない');
  assert.equal(cutQuote('甲（乙「丙丁」戊）己', 5), '甲（乙「丙…」）');
  assert.equal(cutQuote('甲(乙丙丁', 3), '甲(乙…', '元の文で閉じていない括弧には足さない');
  assert.equal(cutQuote('甲(乙)', 3), '甲(乙…)', '閉じの字の手前で切っても落とさない');
});

test('入力の確かめの画面: 長い抜き書きを切っても括弧の対がそろう', () => {
  const r = { key: 'contract-amount', text: '82,500,000円', state: 'set', source: '公告', estimated: false, quote: LONG };
  assert.ok(!balanced(LONG.slice(0, 80)), '試験の文は 80 字で切ると括弧が開いたまま');
  const shown = renderConfirmRow(r).match(/出どころ: 公告「(.*?)」<\/small>/)[1];
  assert.equal(shown, LONG.slice(0, 80) + '…)');
  assert.ok(balanced(shown), shown);
});

const fileOf = (text) => ({ size: text.length, text: async () => text });
const intakeFile = (quotes) => JSON.stringify({
  kind: 'bid-intake',
  source: { title: '架空の治山工事 入札公告' },
  form: { orderer: 'public', 'work-type': 'other' },
  rows: [
    { key: 'orderer-name', label: '発注者', status: '拾えた', quote: '架空町長' },
    { key: 'work-class', label: '工事の種類', status: '拾えた', quote: '格付内容：土木一式' },
    ...quotes.map((quote) => ({ key: 'past-work', label: '施工実績', status: '拾えた', quote })),
  ],
});

test('画面: 実在の公告の形の条件を読み込んで結果まで進むと、知らせの抜き書きの括弧の対がそろう', async () => {
  const page = runPage(buildHtml());
  await page.click('entry-intake');
  page.el('intake-load').files = [fileOf(intakeFile(ROWS))];
  await page.set('intake-load', '');
  await page.click('bid-run');
  await page.click('confirm-go');
  for (const id of ['bid-result', 'open-items']) {
    const shown = page.el(id).innerHTML.match(/公告の文: 「(.*?)」</)?.[1];
    assert.equal(shown, HEAD_ONE_LINE, id + ' に閉じ括弧までの抜き書き');
    assert.ok(balanced(shown), id + ': ' + shown);
  }
});

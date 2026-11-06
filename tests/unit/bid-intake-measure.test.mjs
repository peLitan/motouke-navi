// F41b の単体の試験: 公告の拾いの採点。値はすべて架空
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { judge, matches, parseAnswer, measure, answerId, reportLines } from '../../scripts/measure-bid-intake.mjs';

test('断片の照合: / は全部、| はどれか、全角半角と空白は無視する', () => {
  assert.equal(matches('令和9年7月1日から令和10年3月24日', '令和9年7月1日 / 令和10年3月24日'), true);
  assert.equal(matches('令和9年7月1日から', '令和9年7月1日 / 令和10年3月24日'), false);
  assert.equal(matches('134,200,000円', '1億3,420万円&#124;134,200,000円'), true);
  assert.equal(matches('１８，２００ 千円', '18,200千円'), true);
});

test('分け方: 誤り・漏れ・作った値を正しいに数えない', () => {
  const v = { value: '土木一式' }, none = { value: '書いていない' };
  assert.equal(judge(v, { value: '土木一式工事' }), '正しい');
  assert.equal(judge(v, { value: '舗装工事' }), '誤り');
  assert.equal(judge(v, { absent: true }), '漏れ');
  assert.equal(judge(v, undefined), '漏れ');
  assert.equal(judge(none, { absent: true }), '正しく書いていない');
  assert.equal(judge(none, { value: '土木一式工事' }), '作った');
});

test('正解の表を読む', () => {
  const a = parseAnswer('原文: a.txt b.txt\n\n| 欄 | 値 | 備考 |\n|---|---|---|\n| budget | 3,960円 | 仕込み |\n');
  assert.deepEqual(a.files, ['a.txt', 'b.txt']);
  assert.deepEqual(a.rows, [{ key: 'budget', value: '3,960円', note: '仕込み' }]);
});

test('docs/評価.md の8 の数字は保存した拾いの結果と同じ', () => {
  const r = measure('docs/samples/bid-intake/測り');
  assert.deepEqual(r.total, { 正しい: 54, 正しく書いていない: 20, 誤り: 1 });
  assert.deepEqual([r.plant, r.plantHit, r.fine, r.falseCheck], [2, 2, 70, 0]);
});

test('正解の表の名前: N1.md も P1_正解.md も同じ形の id になり、.md のほかは読まない', () => {
  assert.equal(answerId('N1.md'), 'N1');
  assert.equal(answerId('P1_正解.md'), 'P1');
  assert.equal(answerId('P1_公告.txt'), null);
});

test('正解の表と原文のフォルダを引数で渡しても同じに数える', () => {
  const r = measure('docs/samples/bid-intake/測り', {
    answers: 'docs/samples/bid-intake/測り/正解', notices: 'fixtures/bid-intake/公告' });
  assert.deepEqual(r.total, { 正しい: 54, 正しく書いていない: 20, 誤り: 1 });
});

// ここから F65d: 1つの欄を何行にも分けて拾った出力の数え方
const line = (value, extra = {}) => ({ value, ...extra });

test('全部の行: 断片が別の行に分かれていても正しい。最初の1行では誤り', () => {
  const rows = [line('元請けとして同種工事を施工した実績を有すること'), line('同種工事: 架空川の護岸工事であること')];
  const row = { value: '元請 / 護岸' };
  assert.equal(judge(row, rows), '正しい');
  assert.equal(judge(row, rows.slice(0, 1)), '誤り');
});

test('全部の行: どの行にも無い断片があれば誤りのまま', () => {
  const rows = [line('元請けとして同種工事を施工した実績を有すること'), line('評定点が 65 点未満のものは認めない')];
  assert.equal(judge({ value: '元請 / 護岸' }, rows), '誤り');
});

test('全部の行: 行の境目をまたいで当てない', () => {
  const rows = [line('令和9年'), line('7月1日')];
  assert.equal(matches(rows.map((r) => r.value), '令和9年7月1日'), false);
  assert.equal(judge({ value: '令和9年7月1日' }, rows), '誤り');
});

test('全部の行: どれか(&#124;)と全部(/)を、1行のときと同じに扱う', () => {
  assert.equal(matches(['甲の工事', '乙の工事'], '丙&#124;乙 / 甲'), true);
  assert.equal(matches(['甲の工事', '乙の工事'], '丙&#124;丁 / 甲'), false);
  assert.equal(matches('甲の工事', '甲'), matches(['甲の工事'], '甲'));
});

test('全部の行: 空の行と absent の行は値に数えない', () => {
  assert.equal(judge({ value: '甲' }, [line('', {}), { absent: true }]), '漏れ');
  assert.equal(judge({ value: '書いていない' }, [{ absent: true }, line('')]), '正しく書いていない');
  assert.equal(judge({ value: '甲' }, [{ absent: true }, line('甲の工事')]), '正しい');
  assert.equal(judge({ value: '甲' }, []), '漏れ');
});

test('全部の行: 書いていない欄に2行目で値を入れたら作った。最初の1行では見逃す', () => {
  const rows = [{ absent: true }, line('架空の下請けの条件')];
  assert.equal(judge({ value: '書いていない' }, rows), '作った');
  assert.equal(judge({ value: '書いていない' }, rows.slice(0, 1)), '正しく書いていない');
});

test('正解の表を読む: 箇条の形の原文の行はファイルの名前だけ、備考の長い文もそのまま', () => {
  const a = parseAnswer('- 原文: `~/架空/公告.txt`(= `写し.txt` を LF にした版)\n\n| 欄 | 値 | 備考 |\n|---|---|---|\n| budget | 書いていない | 語あり(3行) |\n');
  assert.deepEqual(a.files, ['公告.txt']);
  assert.deepEqual(a.rows, [{ key: 'budget', value: '書いていない', note: '語あり(3行)' }]);
});

test('架空5件は1欄1行なので、2つの数え方が同じ', () => {
  const r = measure('docs/samples/bid-intake/測り');
  assert.deepEqual(r.first.total, r.total);
  assert.deepEqual([r.first.plant, r.first.plantHit, r.first.fine, r.first.falseCheck], [2, 2, 70, 0]);
  assert.ok(r.perNotice.every((n) => n.changed.length === 0));
});

// 架空の公告1件を置いて、測りの全体を2つの数え方で通す
function multiLineCase(t) {
  // init の試験は tmp/ の下だけ書ける
  const tmp = path.join(fileURLToPath(new URL('../..', import.meta.url)), 'tmp');
  fs.mkdirSync(tmp, { recursive: true });
  const root = fs.mkdtempSync(path.join(tmp, 'measure-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const notice = [
    '入札公告',
    '工事名 架空川護岸工事',
    '入札日時 令和9年6月1日',
    '参考の期日 令和9年6月1日から令和9年2月30日まで',
    '一般競争参加資格の認定を受けていること',
    '等級 Ａ等級、Ｂ等級',
    '元請けとして同種工事を施工した実績を有すること',
    '同種工事 架空川の護岸工事であること',
    '下請契約関係が不適切な者は除く',
  ].join('\n');
  const answer = [
    '- 原文: `~/架空/公告.txt`(架空)', '',
    '| 欄 | 値 | 備考 |', '|---|---|---|',
    '| work-name | 架空川護岸工事 | 2行 |',
    '| bid-date | 令和9年6月1日 | 仕込み(2行目の抜き書きに暦に無い日付) |',
    '| grade | Ａ / Ｂ | 6行。1行目は認定の文 |',
    '| past-work | 元請 / 護岸 | 7〜8行 |',
    '| subcontract | 書いていない | 語あり(9行) |', '',
  ].join('\n');
  const c = (key, value, quote) => ({ key, value, quote, file: '公告.txt' });
  const picked = { source: { title: '架空の公告' }, conditions: [
    c('work-name', '架空川護岸工事', '工事名 架空川護岸工事'),
    c('bid-date', '令和9年6月1日', '入札日時 令和9年6月1日'),
    c('bid-date', '令和9年6月1日', '参考の期日 令和9年6月1日から令和9年2月30日まで'),
    c('grade', '一般競争参加資格の認定を受けていること', '一般競争参加資格の認定を受けていること'),
    c('grade', 'Ａ等級、Ｂ等級', '等級 Ａ等級、Ｂ等級'),
    c('past-work', '元請けとして同種工事を施工した実績を有すること', '元請けとして同種工事を施工した実績を有すること'),
    c('past-work', '架空川の護岸工事であること', '同種工事 架空川の護岸工事であること'),
    { key: 'subcontract', absent: true },
  ] };
  fs.writeFileSync(path.join(root, '公告.txt'), notice);
  fs.writeFileSync(path.join(root, 'P9_正解.md'), answer);
  fs.writeFileSync(path.join(root, 'P9.json'), JSON.stringify(picked));
  return root;
}

test('測りの全体: 全部の行と最初の1行を並べて返し、分け方が違う欄を挙げる', (t) => {
  const root = multiLineCase(t);
  const r = measure(root, { answers: root, notices: root });
  assert.deepEqual(r.total, { 正しい: 4, 正しく書いていない: 1 });
  assert.deepEqual(r.first.total, { 正しい: 2, 誤り: 2, 正しく書いていない: 1 });
  assert.deepEqual(r.perNotice[0].changed, [
    { key: 'grade', all: '正しい', first: '誤り' },
    { key: 'past-work', all: '正しい', first: '誤り' },
  ]);
});

test('測りの全体: 欄のどの行かが確かめが要るなら欄を確かめが要るに数える。「語あり(…)」は誤報に数えない', (t) => {
  const root = multiLineCase(t);
  const r = measure(root, { answers: root, notices: root });
  assert.deepEqual([r.plant, r.plantHit, r.fine, r.falseCheck], [1, 1, 3, 0]);
  assert.deepEqual([r.first.plant, r.first.plantHit, r.first.fine, r.first.falseCheck], [1, 0, 3, 0]);
  assert.ok(r.first.misses.some((m) => m.key === 'bid-date' && m.kind === '機械の見逃し'));
});

test('台本の出力: 2つの数え方の数と、分け方が違う欄と、外れた欄を並べて出す', (t) => {
  const root = multiLineCase(t);
  const out = reportLines(measure(root, { answers: root, notices: root }));
  const at = (x) => out.indexOf(x);
  assert.ok(at('P9 全部の行: 正しい 4・正しく書いていない 1・誤り 0・漏れ 0・作った 0') >= 0);
  assert.equal(at('P9 最初の1行: 正しい 2・正しく書いていない 1・誤り 2・漏れ 0・作った 0'), at('P9 全部の行: 正しい 4・正しく書いていない 1・誤り 0・漏れ 0・作った 0') + 1);
  assert.ok(at('  P9 grade | 最初の1行: 誤り → 全部の行: 正しい') >= 0);
  assert.ok(at('  P9 past-work | 最初の1行: 誤り → 全部の行: 正しい') >= 0);
  assert.ok(at('合計 全部の行: 正しい 4・正しく書いていない 1・誤り 0・漏れ 0・作った 0') >= 0);
  assert.ok(at('合計 最初の1行: 正しい 2・正しく書いていない 1・誤り 2・漏れ 0・作った 0') >= 0);
  assert.ok(at('機械 全部の行: 仕込みの食い違い 1 のうち機械が確かめが要るにした 1。仕込みの無い欄 3 のうち誤報 0') >= 0);
  assert.ok(at('機械 最初の1行: 仕込みの食い違い 1 のうち機械が確かめが要るにした 0。仕込みの無い欄 3 のうち誤報 0') >= 0);
  // 全部の行では外れた欄が無く、最初の1行だけ外れた欄が出る
  const firstAt = at('最初の1行で外れた欄:');
  assert.equal(firstAt, at('全部の行で外れた欄:') + 1);
  assert.ok(out.slice(firstAt).some((l) => l.startsWith('- P9 grade 誤り')));
});

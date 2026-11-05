// F41b の単体の試験: 公告の拾いの採点。値はすべて架空
import test from 'node:test';
import assert from 'node:assert/strict';
import { judge, matches, parseAnswer, measure, answerId } from '../../scripts/measure-bid-intake.mjs';

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

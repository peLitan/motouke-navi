// 例外・参照の語の検出の単体テスト(値はすべて架空)
import test from 'node:test';
import assert from 'node:assert/strict';
import { scanExceptions, findExceptionWarnings } from '../../src/exception-scan.mjs';

test('改行で分かれた語も拾う', () => {
  assert.deepEqual(scanExceptions('架空の届を出す。ただ\nし、この限り　でない。'), ['ただし', 'この限りでない']);
});

test('項の抜き書きは、その項の範囲だけを調べる(他の項のただし書では警告しない)', () => {
  const sourceTexts = { a: '第九十九条　架空の者は、届を出す。\n２　架空の者は、表を作る。ただし、架空の場合は、この限りでない。' };
  const quotes = [
    { id: 'q1', sourceId: 'a', article: '99', paragraph: 1, item: null, text: '架空の者は、届を出す' },
    { id: 'q2', sourceId: 'a', article: '99', paragraph: 2, item: null, text: '架空の者は、表を作る' },
  ];
  const rules = [
    { id: 'r1', basis: [{ quoteId: 'q1' }], exceptions: [] },
    { id: 'r2', basis: [{ quoteId: 'q2' }], exceptions: ['   '] },
  ];
  const w = findExceptionWarnings(rules, quotes, sourceTexts);
  assert.deepEqual(w.map((x) => x.ruleId), ['r2']);
  assert.deepEqual(w[0].quoteIds, ['q2']);
});

test('「とあるのは」の形の読み替えも拾う', () => {
  assert.deepEqual(scanExceptions('架空の規定中「甲」とあるのは「乙」とする。'), ['読み替え']);
});

// F02c: 例外・参照の語の検出と、空欄の警告(条件 F02-3)
import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './_helpers.mjs';

const WORDS = ['ただし', 'を除き', 'この限りでない', '準用', '読み替え'];

test('scanExceptions: 5つの語をそれぞれ拾い、無ければ空', async () => {
  const { scanExceptions } = await load('src/exception-scan.mjs');
  for (const w of WORDS) {
    const found = scanExceptions(`第九十九条　架空の届は、次の場合${w}、出す。`);
    assert.ok(found.includes(w), w + ' を拾えない');
  }
  assert.deepEqual(scanExceptions('第九十九条　架空の届を出す。'), []);
  const many = scanExceptions('架空の届を出す。ただし、前条の規定を準用する場合は、この限りでない。');
  assert.deepEqual([...many].sort(), ['この限りでない', 'ただし', '準用'].sort());
  // 「読み替える」「読み替えて」も読み替えとして拾う
  assert.ok(scanExceptions('「甲」とあるのは「乙」と読み替えるものとする。').includes('読み替え'));
});

test('findExceptionWarnings: 原文に例外の語があり、例外・参照の欄が空の行だけを警告する', async () => {
  const { findExceptionWarnings } = await load('src/exception-scan.mjs');
  const sourceTexts = {
    a: '第九十九条　架空の者は、届を出す。ただし、架空の措置を講じたときは、この限りでない。',
    b: '第百条　架空の者は、表を作る。',
  };
  const quotes = [
    { id: 'qa', sourceId: 'a', article: '99', paragraph: null, item: null, text: '架空の者は、届を出す' },
    { id: 'qb', sourceId: 'b', article: '100', paragraph: null, item: null, text: '架空の者は、表を作る' },
  ];
  const rules = [
    { id: 'r1', basis: [{ quoteId: 'qa' }], exceptions: [] },
    { id: 'r2', basis: [{ quoteId: 'qa' }], exceptions: ['措置を講じたときは届は要らない(第九十九条ただし書)'] },
    { id: 'r3', basis: [{ quoteId: 'qb' }], exceptions: [] },
    { id: 'r4', basis: [{ quoteId: 'qa' }] },
  ];
  const w = findExceptionWarnings(rules, quotes, sourceTexts);
  assert.deepEqual(w.map((x) => x.ruleId).sort(), ['r1', 'r4']);
  const r1 = w.find((x) => x.ruleId === 'r1');
  assert.ok(r1.keywords.includes('ただし') && r1.keywords.includes('この限りでない'));
});

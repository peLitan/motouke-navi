// F02b: 抜き書きと原文の照合(条件 F02-2)
import test from 'node:test';
import assert from 'node:assert/strict';
import { readJson, load, loadSources, quoteInText, paragraphText } from './_helpers.mjs';

test('data/quotes.json の抜き書きは、条・項・号と原文を持ち、取得した原文と一致する', () => {
  const src = loadSources();
  const { quotes } = readJson('data/quotes.json');
  assert.ok(Array.isArray(quotes) && quotes.length >= 7, '抜き書きが少ない');
  const ids = new Set();
  for (const q of quotes) {
    assert.ok(q.id && !ids.has(q.id), 'id が無いか重複: ' + q.id); ids.add(q.id);
    assert.ok(src.byId[q.sourceId], '出典が無い: ' + q.sourceId);
    assert.ok('article' in q && 'paragraph' in q && 'item' in q, '条・項・号の欄が無い: ' + q.id);
    if (src.byId[q.sourceId].kind === 'law') assert.equal(String(q.article), String(src.byId[q.sourceId].article), '条が出典と食い違う: ' + q.id);
    assert.ok(quoteInText(q.text, src.texts[q.sourceId]), '原文に無い抜き書き: ' + q.id);
    if (src.byId[q.sourceId].kind === 'law') {
      assert.ok(Number.isInteger(q.paragraph) && q.paragraph >= 1, '項が無い: ' + q.id);
      const para = paragraphText(src.texts[q.sourceId], q.paragraph);
      assert.ok(para !== null && quoteInText(q.text, para), '書いた項の中に無い抜き書き: ' + q.id + '(第' + q.paragraph + '項)');
    }
  }
  // 取得した7つの条すべてに抜き書きがある
  for (const s of src.list.filter((x) => x.kind === 'law')) {
    assert.ok(quotes.some((q) => q.sourceId === s.id), '抜き書きの無い条: ' + s.id);
  }
});

test('verifyQuote: 空白の違いだけを許し、1字でも違えば一致しない', async () => {
  const { verifyQuote } = await load('src/quote-check.mjs');
  const text = '第九十九条　架空の者は、架空の届を\n出さなければならない。ただし、架空の場合は、この限りでない。';
  assert.equal(verifyQuote('架空の届を出さなければならない', text), true);
  assert.equal(verifyQuote('架空の届を 出さなければ　ならない', text), true);
  assert.equal(verifyQuote('架空の届を出さなくてもよい', text), false);
  assert.equal(verifyQuote('架空の屆を出さなければならない', text), false);
  assert.equal(verifyQuote('', text), false);
});

test('filterVerifiedRules: 原文と一致しない抜き書きを根拠にする行は規則表に入らない', async () => {
  const { filterVerifiedRules } = await load('src/quote-check.mjs');
  const sourceTexts = { s1: '第九十九条　架空の者は、架空の届を出さなければならない。' };
  const quotes = [
    { id: 'q-ok', sourceId: 's1', article: '99', paragraph: null, item: null, text: '架空の届を出さなければならない' },
    { id: 'q-ng', sourceId: 's1', article: '99', paragraph: null, item: null, text: '架空の届を出せばよい' },
  ];
  const rules = [
    { id: 'r-ok', basis: [{ quoteId: 'q-ok' }] },
    { id: 'r-ng', basis: [{ quoteId: 'q-ng' }] },
    { id: 'r-missing', basis: [{ quoteId: 'q-none' }] },
    { id: 'r-mixed', basis: [{ quoteId: 'q-ok' }, { quoteId: 'q-ng' }] },
    { id: 'r-empty', basis: [] },
  ];
  const { kept, dropped } = filterVerifiedRules(rules, quotes, sourceTexts);
  assert.deepEqual(kept.map((r) => r.id), ['r-ok']);
  assert.deepEqual(dropped.map((r) => r.id).sort(), ['r-empty', 'r-missing', 'r-mixed', 'r-ng']);
});

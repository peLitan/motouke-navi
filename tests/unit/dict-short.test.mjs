// F27d: 辞書に足した短い語が、長い会社名・メール・住所の形と重なったときの単体テスト。BOM 付きの辞書・対応表の読み込み。語はすべて架空
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMasker, parseDictFile, parseMapFile, shortTermWarning } from '../../src/mask/core.mjs';
import { CONSTRUCTION_DICT } from '../../src/mask/dict-construction.mjs';
import { addDictWord, importDictFile, resetMask } from '../../src/ui/mask-app.mjs';

const mk = () => createMasker({ dictionaries: [CONSTRUCTION_DICT] });

test('1字の姓を足しても、会社名は会社名として丸ごと置き換え、途中に記号を入れない', () => {
  const m = mk();
  m.addTerm('林', 'person');
  const { masked, map } = m.mask('発注者は小林建設株式会社です。');
  assert.equal(masked, '発注者は〔会社名1〕です。');
  assert.equal(map.length, 1);
  assert.equal(map[0].original, '小林建設株式会社');
  assert.equal(map[0].kind, 'company');
  assert.ok(!masked.includes('小〔'));
});

test('1字の英字を足しても、メールの途中に記号を入れない。英字の語の途中にも当てない', () => {
  const m = mk();
  m.addTerm('a', 'other');
  const { masked, map } = m.mask('連絡先 kono@example.com、資料は data フォルダ、担当 a');
  assert.ok(masked.includes('〔メール1〕'), masked);
  assert.ok(!masked.includes('ex〔'), masked);
  assert.ok(masked.includes('data フォルダ'), masked);
  assert.ok(masked.endsWith('担当 〔語1〕'), masked);
  assert.deepEqual(map.map((e) => e.original), ['kono@example.com', 'a']);
});

test('住所・電話の中に収まる足した語も、長い方を取る', () => {
  const m = mk();
  m.addTerm('川', 'person');
  m.addTerm('12', 'other');
  const { masked } = m.mask('所在地 東京都みほん市川向町1-2-3、電話 03-1234-5678');
  assert.ok(!/〔人名|〔語/.test(masked), masked);
  assert.match(masked, /〔住所1〕/);
  assert.match(masked, /〔電話1〕/);
});

test('足した語が形より長いときや、形の外にあるときは、今までどおり足した語を取る', () => {
  const m = mk();
  m.addTerm('林', 'person');
  m.addTerm('甲野建設株式会社 本店', 'company');
  const { masked } = m.mask('林さんに連絡。甲野建設株式会社 本店で会う。');
  assert.equal(masked, '〔人名1〕さんに連絡。〔会社名1〕で会う。');
});

test('1字の語は足せるが注意を返し、画面に出す。2字以上は注意を出さない', () => {
  const m = mk();
  const r = m.addTerm('林', 'person');
  assert.ok(r.warning);
  assert.match(r.warning, /1字/);
  assert.match(r.warning, /一部も置き換わります/);
  assert.equal(m.addTerm('林 一郎', 'person').warning, undefined);
  assert.equal(shortTermWarning('甲野'), '');
  assert.notEqual(shortTermWarning(' 林 '), '');

  const els = {};
  for (const id of ['dict-word', 'dict-kind', 'dict-status', 'dict-list', 'dict-file-status', 'mask-after', 'mask-review', 'mask-unchecked', 'mask-map', 'mask-before', 'unmask-output', 'mask-status', 'map-status']) els[id] = { value: '', innerHTML: '', textContent: '' };
  const doc = { getElementById: (id) => els[id] || null };
  resetMask(doc);
  els['dict-word'].value = '林';
  els['dict-kind'].value = 'person';
  addDictWord(doc);
  assert.match(els['dict-status'].textContent, /注意: .*1字/);
  els['dict-word'].value = '乙山 二郎';
  addDictWord(doc);
  assert.doesNotMatch(els['dict-status'].textContent, /注意/);
  // 読み込んだ辞書に1字の語があれば、件数を注意に出す
  assert.equal(importDictFile(doc, JSON.stringify({ format: 'mask-dict', version: 1, terms: [{ word: '森', kind: 'person' }, { word: '丙川 三郎', kind: 'person' }] })), true);
  assert.match(els['dict-file-status'].textContent, /1字の語が 1 件/);
  resetMask(doc);
});

test('BOM 付きの辞書のファイル・対応表のファイルも読める', () => {
  const dict = '﻿' + JSON.stringify({ format: 'mask-dict', version: 1, terms: [{ word: '甲野 一郎', kind: 'person' }] });
  assert.deepEqual(parseDictFile(dict, ['person']), [{ word: '甲野 一郎', kind: 'person' }]);
  const m = mk();
  assert.equal(m.importDict(dict).added, 1);
  assert.equal(m.mask('甲野 一郎 が確認').masked, '〔人名1〕 が確認');
  const map = '﻿' + JSON.stringify({ format: 'mask-map', version: 1, entries: [{ token: '〔人名1〕', original: '甲野 一郎', kind: 'person' }] });
  assert.equal(parseMapFile(map).entries.length, 1);
  // BOM が途中にあるなど、壊れたものは今までどおり読まない
  assert.throws(() => parseDictFile('x﻿{}', ['person']));
});

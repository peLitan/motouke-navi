// F11d: 対応表の書き出しと読み込みの単体テスト(値はすべて架空)
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMasker, parseMapFile, MAP_NOTICE } from '../../src/mask/core.mjs';
import { CONSTRUCTION_DICT } from '../../src/mask/dict-construction.mjs';

const fresh = () => createMasker({ dictionaries: [CONSTRUCTION_DICT] });

test('書き出したファイルに注意の文と足した語が入り、読み込むと足した語も戻る', () => {
  const a = fresh();
  a.addTerm('甲野 一郎', 'person');
  a.mask('甲野 一郎と甲野一郎。');
  const data = JSON.parse(a.exportMap());
  assert.equal(data.notice, MAP_NOTICE);
  assert.ok(MAP_NOTICE.includes('このファイルには元の名前が入って'));
  const b = fresh();
  b.importMap(a.exportMap());
  assert.deepEqual(b.terms().map((t) => t.word), ['甲野 一郎']);
  assert.equal(b.unmask('〔人名1〕'), '甲野 一郎');
});

test('読み込んだあとに新しく作る記号は、読み込んだ記号と重ならない', () => {
  const a = fresh();
  const r = a.mask('丙川建設株式会社と丁谷工業株式会社。');
  const b = fresh();
  b.importMap(a.exportMap());
  const r2 = b.mask('戊山産業株式会社。');
  const used = new Set(r.map.map((x) => x.token));
  assert.ok(!used.has(r2.map[0].token), '記号が重なった: ' + r2.map[0].token);
  assert.equal(b.unmask(r.masked + r2.masked), '丙川建設株式会社と丁谷工業株式会社。戊山産業株式会社。');
});

test('壊れた対応表を読み込もうとしても、今の対応表は変わらない', () => {
  const b = fresh();
  const r = b.mask('丙川建設株式会社。');
  assert.throws(() => b.importMap('[]'), /対応表のファイルではありません/);
  const bad = JSON.stringify({ format: 'mask-map', version: 1, entries: [{ token: '〔会社名1〕', original: 'A', kind: 'company' }, { token: '〔会社名1〕', original: 'B', kind: 'company' }] });
  assert.throws(() => b.importMap(bad), /重なって/);
  assert.equal(b.unmask(r.masked), '丙川建設株式会社。');
});

test('版の違うファイルや行の欠けたファイルは、理由を書いて止まる', () => {
  assert.throws(() => parseMapFile(JSON.stringify({ format: 'mask-map', version: 2, entries: [] })), /版/);
  assert.throws(() => parseMapFile(JSON.stringify({ format: 'mask-map', version: 1, entries: [{ token: '〔人名1〕' }] })), /1 行目/);
  assert.throws(() => parseMapFile(JSON.stringify({ format: 'mask-map', version: 1, entries: [], terms: [{ word: '' , kind: 'person' }] })), /足した語/);
});

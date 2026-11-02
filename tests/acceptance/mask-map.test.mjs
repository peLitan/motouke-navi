// F11d: 対応表の書き出しと読み込み(条件 F11-3)
import test from 'node:test';
import assert from 'node:assert/strict';
import { load, indexHtml, scriptsOf, withoutScripts, hasId } from './_helpers.mjs';

async function make() {
  const { createMasker } = await load('src/mask/core.mjs');
  const { CONSTRUCTION_DICT } = await load('src/mask/dict-construction.mjs');
  return () => createMasker({ dictionaries: [CONSTRUCTION_DICT] });
}

test('書き出した対応表を、別の置き換えの部品に読み込むと元に戻せ、同じ語は同じ記号のまま', async () => {
  const fresh = await make();
  const a = fresh();
  a.addTerm('乙野 花子', 'person');
  const text = '架空の連絡: 乙野 花子(otono@example.com)。丁谷工業株式会社。';
  const r = a.mask(text);
  const file = a.exportMap();
  assert.equal(typeof file, 'string');
  assert.ok(file.includes('乙野 花子') && file.includes('otono@example.com'), '対応表に元の語が無い');
  const b = fresh();
  b.importMap(file);
  assert.equal(b.unmask(r.masked), text);
  const again = b.mask('丁谷工業株式会社へ。');
  const tok = r.map.find((x) => x.original === '丁谷工業株式会社').token;
  assert.ok(again.masked.includes(tok), '読み込んだあと別の記号になった');
});

test('壊れた対応表は読み込まずに、分かる言葉で止まる', async () => {
  const fresh = await make();
  const b = fresh();
  assert.throws(() => b.importMap('{これは対応表ではない'), (e) => e instanceof Error && e.message.length > 0);
  assert.throws(() => b.importMap(JSON.stringify({ hello: 1 })), Error);
});

test('画面: 対応表の書き出しと読み込みがあり、書き出すときに元の名前が入っていると出す', () => {
  const html = indexHtml();
  assert.ok(hasId(html, 'map-export') && hasId(html, 'map-import'));
  const code = scriptsOf(html).map((s) => s.code).join('\n');
  assert.ok(code.includes('exportMap') && code.includes('importMap'));
  const all = withoutScripts(html) + code;
  assert.ok(/このファイルには元の名前が入って/.test(all), '元の名前が入っている旨の表示が無い');
});

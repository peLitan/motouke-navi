// F87d: 全部の紙の枚数を戻すため、後ろへ動いた法令の一覧(#scope)の余白だけを紙で詰める。一覧は動かさず、字と行間も変えない。
// ブラウザが無いので枚数は測らない(Edge の確かめは統括)。ここでは組み立てた画面の CSS と、一覧の文が残ることを見る
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildHtml } from '../../build.mjs';
import { esc } from '../../src/ui/view.mjs';

const { sources } = JSON.parse(fs.readFileSync(new URL('../../data/sources/index.json', import.meta.url), 'utf8'));
const html = buildHtml();
const css = html.match(/<style>([\s\S]*?)<\/style>/)[1].replace(/\/\*[\s\S]*?\*\//g, '');
const printBlocks = css.split(/^ {2}(?=@media )/m).filter((s) => s.startsWith('@media print {')).map((s) => s.slice(0, s.search(/^ {2}\}/m)));
const printRules = printBlocks.join('\n').split('\n').map((l) => l.trim());
const scopeRules = printRules.filter((l) => /^[^{]*(#scope|\.scope-cols)[^{]*\{/.test(l) && !l.startsWith('body.print-brief'));
const body = html.slice(html.indexOf('</style>'));
const scope = body.match(/<details class="scope" id="scope">([\s\S]*?)<\/details>/)?.[1] ?? '';
const textOf = (s) => s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

test('紙の決まりの中に一覧の余白を詰める3つの規則がある', () => {
  assert.deepEqual(scopeRules, [
    '#scope p, #scope li { margin: 0; padding: 0; }',
    '#scope ul { margin: 0; padding-left: 1rem; }',
    '.scope-cols { gap: 0 0.5rem; }',
  ]);
});

test('3つの規則は字の大きさと行間を持たず、中身を隠さない', () => {
  assert.equal(scopeRules.length, 3);
  for (const r of scopeRules) {
    assert.doesNotMatch(r, /font-size|line-height|font:/, r);
    assert.doesNotMatch(r, /display|visibility|opacity|overflow|height|columns?\s*:|column-count/, r);
  }
});

test('紙の決まりのブロックは1つのまま', () => {
  assert.equal((css.match(/@media print/g) ?? []).length, 1);
  assert.equal(printBlocks.length, 1);
});

test('余白を詰める規則は紙の決まりの中だけにあり、画面の一覧は今の間のまま', () => {
  const others = css.split(/^ {2}(?=@media )/m).filter((s) => !s.startsWith('@media print {')).join('');
  assert.doesNotMatch(others, /#scope p|#scope li|#scope ul/);
  assert.match(others, /\.scope-cols \{ display: grid; [^}]*gap: 0 1\.5rem; \}/);
});

test('全部の紙では一覧を隠さず、まとめの紙で隠す決まりは今のまま', () => {
  const hides = printRules.filter((l) => /display: none/.test(l) && /(^|[\s,])#scope\b/.test(l));
  assert.equal(hides.length, 1, hides.join('\n'));
  const selectors = hides[0].slice(0, hides[0].indexOf('{')).split(',').map((s) => s.trim());
  assert.deepEqual(selectors.filter((s) => s.includes('#scope')), ['body.print-brief #scope']);
});

test('一覧の置き場所を動かしていない: 使った資料の枠の中で、結果と書類より後ろ', () => {
  const at = (id) => body.indexOf('id="' + id + '"');
  assert.ok(at('ref-frame') < at('scope') && at('scope') < at('sources'), '使った資料の枠の中の順が違う');
  for (const id of ['panel-1', 'panel-2', 'panel-3', 'panel-tools']) assert.ok(at(id) >= 0 && at(id) < at('scope'), id + ' より前に動いた');
});

test('一覧の文が DOM に残る: 見ている法令・資料の全部と、見ていない法令・資料の全部', () => {
  const heads = [...scope.matchAll(/<p><strong>([^<]+)<\/strong>/g)].map((m) => m[1]);
  assert.deepEqual(heads, ['このツールが見ている法令・資料', '見ていない法令・資料']);
  const notItems = [...scope.match(/<ul id="scope-not">([\s\S]*?)<\/ul>/)[1].matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => textOf(m[1]));
  assert.equal(notItems.length, 7);
  for (const want of ['都道府県・市町村の条例・規則・要綱', '工事の契約書・請負契約約款', '発注者の特記仕様書・現場説明書・質問回答書']) {
    assert.ok(notItems.includes(want), want);
  }
  assert.ok(sources.length > 0, '見ている資料の一覧が空');
  const seen = scope.match(/<ul id="scope-seen">([\s\S]*?)<\/ul>/)[1];
  assert.equal(seen.match(/<li>/g).length, sources.length);
  for (const s of sources) assert.ok(seen.includes('<li>' + esc(s.title) + '</li>'), s.id);
});

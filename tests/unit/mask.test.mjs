// 置き換えの部品(src/mask/core.mjs)と画面の部品(src/ui/mask-app.mjs)の単体テスト(値はすべて架空)
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMasker, parseAmount, bandLabel } from '../../src/mask/core.mjs';
import { CONSTRUCTION_DICT } from '../../src/mask/dict-construction.mjs';
import { parseThresholds, renderMap } from '../../src/ui/mask-app.mjs';

const mk = () => createMasker({ dictionaries: [CONSTRUCTION_DICT] });

test('空白の有無だけ違う語は同じ記号。戻すと最初の書き方', () => {
  const m = mk();
  m.addTerm('甲野 一郎', 'person');
  const r = m.mask('甲野 一郎と甲野一郎と甲野　一郎');
  assert.equal(r.map.length, 1);
  assert.equal(r.masked, '〔人名1〕と〔人名1〕と〔人名1〕');
  assert.deepEqual(r.map[0].variants, ['甲野 一郎', '甲野一郎', '甲野　一郎']);
});

test('ひらがなの手前・後ろで会社名を切る。(株)の形とJV', () => {
  const r = mk().mask('下請けは株式会社乙川土工として、(株)丙野組と甲乙特定建設工事共同企業体。');
  const originals = r.map.map((e) => e.original);
  assert.deepEqual(originals, ['株式会社乙川土工', '(株)丙野組', '甲乙特定建設工事共同企業体']);
});

test('文の中に記号と同じ文字列があれば、別の記号を使う(戻したときに崩れない)', () => {
  const m = mk();
  m.addTerm('丁田', 'person');
  const t = '〔人名1〕という書き方の例。丁田さん。';
  const r = m.mask(t);
  assert.ok(!r.masked.includes('丁田'));
  assert.equal(m.unmask(r.masked), t);
});

test('許可番号(大臣・知事、全角の数字)と電話(括弧つき・ハイフン無し)', () => {
  const r = mk().mask('国土交通大臣 許可(般－５)第１２３号、電話 (03)0000-0000、0000000000');
  assert.deepEqual(r.map.map((e) => e.kind), ['license', 'phone', 'phone']);
});

test('金額の読み方と境目の形', () => {
  assert.equal(parseAmount('52,000,000円'), 52000000);
  assert.equal(parseAmount('1億2,000万円'), 120000000);
  assert.equal(parseAmount('５０００万'), 50000000);
  assert.equal(parseAmount('abc'), null);
  assert.equal(bandLabel(60000000, [50000000, 80000000]), '〔金額 50,000,000円以上80,000,000円未満〕');
  assert.equal(bandLabel(90000000, [80000000, 50000000]), '〔金額 80,000,000円以上〕');
  assert.equal(bandLabel(1, []), '〔金額〕');
  assert.equal(mk().mask('金 1億2,000万円', { amounts: 'band', thresholds: [50000000] }).masked, '金 〔金額 50,000,000円以上〕');
});

test('reset で対応表と足した語を消す', () => {
  const m = mk();
  m.addTerm('ひのき台', 'site');
  const r = m.mask('ひのき台');
  m.reset();
  assert.deepEqual(m.terms(), []);
  assert.equal(m.unmask(r.masked), r.masked);
  assert.equal(m.mask('ひのき台').masked, 'ひのき台');
});

test('画面の部品: 境目の欄を読む・対応表の文字をエスケープする', () => {
  assert.deepEqual(parseThresholds('50,000,000、8000万 x'), { nums: [50000000, 80000000], bad: ['x'] });
  const html = renderMap([{ token: '〔語1〕', label: '語', original: '<b>', variants: ['<b>'] }]);
  assert.ok(html.includes('&lt;b&gt;') && !html.includes('<b>'));
});

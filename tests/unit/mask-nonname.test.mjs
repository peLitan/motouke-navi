// F27c の単体テスト: 置き換えすぎを減らす。表の見出しの語・様式の語・職業名に「さん」・工区や工事の一般の語を人名・現場名にしない。
// 表の見出しの行では欄名の規則を当てない。名前・現場名はすべて架空
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMasker } from '../../src/mask/core.mjs';
import { CONSTRUCTION_DICT } from '../../src/mask/dict-construction.mjs';
import { personContextPatterns } from '../../src/mask/rules-person.mjs';

const mk = () => createMasker({ dictionaries: [CONSTRUCTION_DICT] });
const generic = () => createMasker({ dictionaries: [{ name: '一般', contextPatterns: personContextPatterns() }] });

// 何も置き換えてはいけない文(架空の例)
const UNTOUCHED = [
  // 表の見出しの語
  '| 氏名 | 年齢 | 職種 |',
  '| 氏名 | 性別 |\n| --- | --- |',
  '氏名 年齢 続柄',
  '氏名\t性別\t生年月日\t血液型',
  '| 担当者 | 所属 | 役職 | 備考 |',
  '| 作業員氏名 | 雇入年月日 | 経験年数 | 健康診断日 |',
  // 様式の語
  '担当 設計',
  '責任者 押印',
  '確認者 検印',
  '氏名 自署',
  '所長 不在',
  '主任技術者 選任予定',
  '代表者 記載省略',
  '担当 自動',
  '作成者: 自動入力',
  '監理技術者 未選任',
  // 職業名に「さん」
  '大工さんに図面を渡す。',
  '職人さんが休憩している。',
  '監督さんが来た。',
  '左官さんと型枠工さんの段取り',
  '現場監督さんへ連絡',
  // 工区・工事の一般の語
  '上流工区と下流工区の境',
  '事故現場の写真',
  '夜間工事のため通行止め',
  'ガス工事と断熱工事、防音工事を行う',
  '昼間工事・休日工事',
  '起点側工区',
];

test('表の見出し・様式の語・職業名に「さん」・工区や工事の一般の語を置き換えない(架空の例27件)', () => {
  assert.ok(UNTOUCHED.length >= 15);
  for (const text of UNTOUCHED) {
    const r = mk().mask(text);
    assert.equal(r.masked, text, '置き換えすぎ: ' + text + ' → ' + r.masked + ' ' + r.map.map((e) => e.original + '/' + e.rule).join(' '));
    assert.equal(r.map.length, 0, text);
  }
});

test('見出しの語を人名にしないので、文中の同じ語も置き換わらない', () => {
  const text = '| 氏名 | 年齢 | 職種 |\n年齢と職種は必ず書く。\n氏名: 甲野 一郎、年齢 45';
  const r = mk().mask(text);
  assert.ok(r.masked.includes('年齢と職種は必ず書く。'), r.masked);
  assert.ok(r.masked.includes('年齢 45'), r.masked);
  assert.ok(!r.masked.includes('甲野 一郎'), r.masked);
});

test('分野の語に頼らない一般の止める語は、建設の辞書が無くても効く', () => {
  for (const text of ['氏名 年齢 続柄', '責任者 押印', '所長 不在', '担当 記載省略', '職人さん', '| 氏名 | 性別 | 国籍 |']) {
    const r = generic().mask(text);
    assert.equal(r.masked, text, text + ' → ' + r.masked);
  }
});

// 置き換えすぎを減らしても、名前・現場名は今までどおり置き換える(漏れを増やさない)
const STILL_FOUND = [
  ['| 氏名 | 甲野 一郎 |', '甲野 一郎', 'person'],
  ['| 担当者 | 乙川 | 所属 | 工務部 |', '乙川', 'person'],
  ['| 氏名 | 丙田 次郎 | 年齢 | 45 |', '丙田 次郎', 'person'],
  ['氏名\t丁谷 三郎', '丁谷 三郎', 'person'],
  ['現場代理人 戊井 四郎(押印)', '戊井 四郎', 'person'],
  ['所長 己野', '己野', 'person'],
  ['庚田さんに伝える。', '庚田', 'person'],
  ['辛島監督に報告', '辛島', 'person'],
  ['壬生大工さん', '壬生大工', 'person'],
  ['甲野川上流工区', '甲野川上流工区', 'site'],
  ['乙川駅前ガス工事', '乙川駅前ガス工事', 'site'],
];

test('名前・現場名は今までどおり置き換える(架空の例)', () => {
  for (const [text, word, kind] of STILL_FOUND) {
    const r = mk().mask(text);
    assert.ok(!r.masked.includes(word), '置き換わっていない: ' + text + ' → ' + r.masked);
    const e = r.map.find((x) => x.original === word);
    assert.ok(e, '対応表に無い: ' + word + '(' + text + ')');
    assert.equal(e.kind, kind, word);
  }
});

test('表の見出しの行では欄名の規則を当てない(見出しの表に無い語でも)', () => {
  // 見出しの行: ほかの欄がすべて欄名・見出しの語。「甲斐見出」は止める語に無いが、見出しの行なので人名にしない
  const head = '| 氏名 | 甲斐見出 | 職種 | 年齢 |';
  assert.equal(mk().mask(head).masked, head);
  // 中身の行: 欄名の隣の名前は置き換える
  const body = '| 氏名 | 甲斐 一郎 | 職種 | 型枠工 |';
  assert.ok(!mk().mask(body).masked.includes('甲斐 一郎'));
  // 敬称の規則は欄名の規則ではないので、見出しの行の形でも当てる
  const hon = '| 乙川様 | 年齢 | 職種 |';
  assert.ok(!mk().mask(hon).masked.includes('乙川'));
});

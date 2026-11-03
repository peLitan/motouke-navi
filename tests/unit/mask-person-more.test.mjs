// F27b の単体テスト: 全角の括弧の区切り・名前の後ろの役職・読点で並ぶ2人目以降。名前はすべて架空
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMasker } from '../../src/mask/core.mjs';
import { CONSTRUCTION_DICT } from '../../src/mask/dict-construction.mjs';
import { personContextPatterns, PERSON_RULES } from '../../src/mask/rules-person.mjs';

const mk = () => createMasker({ dictionaries: [CONSTRUCTION_DICT] });
const generic = () => createMasker({ dictionaries: [{ name: '一般', contextPatterns: personContextPatterns() }] });

// [文, 置き換わるべき名前の並び, 規則の並び]
const FOUND = [
  // 全角の括弧(半角と同じに扱う)
  ['現場代理人（甲野 一郎）', ['甲野 一郎'], ['title']],
  ['担当者（乙川）', ['乙川'], ['label']],
  ['監理技術者（丙田次郎）が確認', ['丙田次郎'], ['title']],
  // 名前の後ろの役職
  ['甲野 一郎(監理技術者)', ['甲野 一郎'], ['title-after']],
  ['丁谷 三郎（主任技術者）', ['丁谷 三郎'], ['title-after']],
  ['乙川所長に報告した。', ['乙川'], ['title-after']],
  ['丙田部長 承認', ['丙田'], ['title-after']],
  ['書類は馬場課長へ渡す。', ['馬場'], ['title-after']],
  ['甲野一郎所長が出席', ['甲野一郎'], ['title-after']],
  // 読点・中黒で並ぶ2人目以降
  ['氏名: 甲野 一郎、乙川 二郎', ['甲野 一郎', '乙川 二郎'], ['label', 'list']],
  ['担当者 丁谷、戊井、己野', ['丁谷', '戊井', '己野'], ['label', 'list', 'list']],
  ['職長 庚田 四郎・辛島 五郎', ['庚田 四郎', '辛島 五郎'], ['title', 'list']],
  ['確認者：壬生 六郎，癸山 七郎', ['壬生 六郎', '癸山 七郎'], ['label', 'list']],
];

test('全角の括弧・名前の後ろの役職・並びの2人目以降を人名として置き換える(架空の例13件)', () => {
  for (const [text, names, rules] of FOUND) {
    const r = mk().mask(text);
    names.forEach((name, i) => {
      assert.ok(!r.masked.includes(name), '置き換わっていない: ' + text + ' → ' + r.masked);
      const e = r.map.find((x) => x.original === name);
      assert.ok(e, '対応表に無い: ' + name + '(' + text + ')');
      assert.equal(e.kind, 'person', name);
      assert.equal(e.rule, rules[i], name + ' の規則(' + text + ')');
    });
  }
});

test('一般の規則だけでも全角の括弧と並びの2人目を見つける(分野の辞書を使わない)', () => {
  const r = generic().mask('担当者（甲野 一郎）、部長（乙川）。氏名 丙田、丁谷。戊井部長に連絡');
  for (const n of ['甲野 一郎', '乙川', '丙田', '丁谷', '戊井']) assert.ok(!r.masked.includes(n), n + ' → ' + r.masked);
});

// 置き換えすぎない例: 部署・場所の語に付く役職、役職の一部、役職どうしの並び、括弧の中が役職でないもの
const KEPT = [
  '現場所長に報告', '工事部長 承認', '作業所長が確認', '出張所長', '東京支店長', '当現場所長', '営業部長', '所長室に置く',
  '工事主任の役目', '主任技術者（専任）', '担当者 甲野、確認済み', '代表取締役社長', '職長・安全衛生責任者 選任',
];

test('部署・場所の語や役職の一部を人名にしない(13件)', () => {
  for (const text of KEPT) {
    const r = mk().mask(text);
    const weak = r.map.filter((e) => e.rule && e.kind === 'person').map((e) => e.original);
    const expected = text === '担当者 甲野、確認済み' ? ['甲野'] : [];
    assert.deepEqual(weak, expected, text + ' → ' + r.masked);
  }
});

test('同じ文の中の同じ名前は、文脈の無い所でも同じ記号になる', () => {
  const r = mk().mask('乙川所長に報告した。乙川は了承した。');
  const e = r.map.find((x) => x.original === '乙川');
  assert.ok(e);
  assert.equal(r.masked, `${e.token}所長に報告した。${e.token}は了承した。`);
});

test('規則の一覧に役職の前・並びの2人目以降がある(画面の表示用)', () => {
  const ids = PERSON_RULES.map((r) => r.id);
  for (const id of ['honorific', 'title', 'label', 'title-after', 'list']) assert.ok(ids.includes(id), id);
});

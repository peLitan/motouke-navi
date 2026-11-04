// F36a の単体テスト: 部署の語の後ろの「姓 名」を人名として置き換える。発注者・部署の名前は残す。名前はすべて架空
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMasker } from '../../src/mask/core.mjs';
import { CONSTRUCTION_DICT } from '../../src/mask/dict-construction.mjs';
import { personContextPatterns } from '../../src/mask/rules-person.mjs';

const mk = () => createMasker({ dictionaries: [CONSTRUCTION_DICT] });
const generic = () => createMasker({ dictionaries: [{ name: '一般', contextPatterns: personContextPatterns() }] });
const persons = (r) => r.map.filter((e) => e.kind === 'person').map((e) => e.original);

// [文, 置き換わるべき名前の並び, 残るべき語の並び]
const FOUND = [
  // 評価のケースの行と同じ形(表の欄・部署の前の短い語・かっこの書き添え)
  ['| 発注者の監督員 | 市 水道課 甲野 花子(通知事項は別紙のとおり) |', ['甲野 花子'], ['市 水道課', '(通知事項は別紙のとおり)']],
  ['村 建設課 乙川 二郎(連絡は別紙)', ['乙川 二郎'], ['村 建設課', '(連絡は別紙)']],
  ['町 上下水道課 丙田 三郎（全角のかっこ）', ['丙田 三郎'], ['町 上下水道課', '（全角のかっこ）']],
  // 部署の語尾・区切り・空白の違い
  ['総務部 丁谷 四郎', ['丁谷 四郎'], ['総務部']],
  ['都市整備局　戊井　五郎', ['戊井　五郎'], ['都市整備局']],
  ['秘書室 己野 ハナ', ['己野 ハナ'], ['秘書室']],
  ['管理係: 庚田 さくら', ['庚田 さくら'], ['管理係']],
  ['| 上下水道課 | 辛島 六郎 |', ['辛島 六郎'], ['上下水道課']],
  // 部署の語が前の語に続く形
  ['架空町上下水道課 壬生 七郎', ['壬生 七郎'], ['架空町上下水道課']],
  // 並びの2人目
  ['総務課 癸山 八郎、甲斐 九郎', ['癸山 八郎', '甲斐 九郎'], ['総務課']],
];

test('部署の語の後ろの姓と名を人名として置き換え、部署の語と書き添えは残す(架空の例10件)', () => {
  for (const [text, names, kept] of FOUND) {
    const r = mk().mask(text);
    for (const name of names) {
      assert.ok(!r.masked.includes(name), '置き換わっていない: ' + text + ' → ' + r.masked);
      const e = r.map.find((x) => x.original === name);
      assert.ok(e, '対応表に無い: ' + name + '(' + text + ') ' + JSON.stringify(r.map));
      assert.equal(e.kind, 'person', name);
      assert.equal(e.rule, 'dept', name + ' の規則(' + text + ')');
    }
    for (const w of kept) assert.ok(r.masked.includes(w), '残るはず: ' + w + ' → ' + r.masked);
  }
});

test('一般の規則だけでも部署の後ろの姓と名を見つける(分野の辞書を使わない)', () => {
  assert.deepEqual(persons(generic().mask('市 総務課 甲野 一郎(別紙)')), ['甲野 一郎']);
});

// 置き換えすぎない例: 部署の名前だけ・発注者の名前だけ・部署の後ろの1語・部位の語・部署の中の語の並び・短い語
const KEPT = [
  '町 上下水道課',
  '市 建設部 道路課',
  '県 土木部 河川 砂防課',
  '県 建設部 営繕 管理室',
  '架空県しおかぜ町(しおかぜ町長)',
  '| 発注者 | 架空県みほん市 |',
  '| 発注者 | 架空県みほん市 総務課 |',
  '上下水道課 甲野',
  '上下水道課の担当',
  '企画部 経営 戦略',
  '建設部 都市 計画',
  '建設課 道路 維持',
  '開口部 補強 施工',
  '接合部 溶接 検査',
  '上部 工事 完成',
  '一部 変更 契約',
  '内部 確認 完了',
];

test('部署の名前だけ・発注者の名前だけ・部署の後ろの語の並びを人名にしない(17件)', () => {
  for (const text of KEPT) {
    const r = mk().mask(text);
    assert.deepEqual(persons(r), [], text + ' → ' + r.masked);
    assert.equal(r.masked, text, '変わらないはず');
  }
});

test('見出しの行と、行をまたいだ語は人名にしない', () => {
  assert.deepEqual(persons(mk().mask('| 上下水道課 | 氏名 | 年齢 |')), []);
  assert.deepEqual(persons(mk().mask('上下水道課\n工程 説明')), []);
});

test('見つけた名前は、同じ文の中で文脈の無い所でも同じ記号になる', () => {
  const r = mk().mask('町 総務課 甲野 一郎。甲野 一郎へ送る。');
  const e = r.map.find((x) => x.original === '甲野 一郎');
  assert.ok(e);
  assert.equal(r.masked, `町 総務課 ${e.token}。${e.token}へ送る。`);
});

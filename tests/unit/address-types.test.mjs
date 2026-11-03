// F24b: 住所の規則の単体テスト(src/mask/rules-address.mjs)。例はすべて架空(「架空県」「みほん市」など。番地も仮の値)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createMasker } from '../../src/mask/core.mjs';
import { CONSTRUCTION_DICT } from '../../src/mask/dict-construction.mjs';
import { MEDICAL_DICT } from '../../src/mask/dict-medical.mjs';
import { ADDRESS_RULES, PREFECTURES } from '../../src/mask/rules-address.mjs';

const mask = (t, dict = CONSTRUCTION_DICT) => createMasker({ dictionaries: [dict] }).mask(t);
const addresses = (t, dict) => mask(t, dict).map.filter((e) => e.kind === 'address').map((e) => e.original);

// 文 t の中で、住所として置き換わるのがちょうど want(並び)であること
function expectAddresses(t, want, dict) {
  assert.deepEqual(addresses(t, dict), want, t);
}

test('都道府県を書かない住所(市区町村 + 町名 + 番地)', () => {
  expectAddresses('工事はみほん市さくら町1-2-3で行う。', ['みほん市さくら町1-2-3']);
  expectAddresses('本社所在地みほん市あおば町1-2', ['みほん市あおば町1-2']);
  expectAddresses('ためし郡みほん町大字甲123番地の4', ['ためし郡みほん町大字甲123番地の4']);
  // 都道府県が無く、番地も無い市区町村だけは取らない(発注者の名前・役職と紛れる)
  expectAddresses('みほん市長 甲野', []);
});

test('空白で区切った住所', () => {
  expectAddresses('| 所在地 | 架空県みほん市 さくら町 0-0-0 |', ['架空県みほん市 さくら町 0-0-0']);
  expectAddresses('| 住所 | 架空県ためし市 北 0-0 |', ['架空県ためし市 北 0-0']);
  expectAddresses('| 発注者の住所 | 架空県 けんちょう通り 0-0 |', ['架空県 けんちょう通り 0-0']);
  expectAddresses('架空県　みほん市　さくら町　1丁目　2番3号', ['架空県　みほん市　さくら町　1丁目　2番3号']);
});

test('丁目・番地・号を最後まで(半角・全角・漢数字、ハイフンの揺れ)', () => {
  expectAddresses('みほん市さくら町一丁目2番3号', ['みほん市さくら町一丁目2番3号']);
  expectAddresses('みほん市さくら町一丁目二番三号です', ['みほん市さくら町一丁目二番三号']);
  expectAddresses('架空県みほん市さくら町１－２－３', ['架空県みほん市さくら町１－２－３']);
  for (const h of ['-', 'ー', '―', '－']) {
    expectAddresses(`みほん市さくら町1${h}2${h}3`, [`みほん市さくら町1${h}2${h}3`]);
  }
  expectAddresses('架空県ふもと町 ふもと野 0番地', ['架空県ふもと町 ふもと野 0番地']);
});

test('建物名・部屋番号', () => {
  expectAddresses('架空県みほん市さくら町1-2-3 みほんビル 3階 301号室', ['架空県みほん市さくら町1-2-3 みほんビル 3階 301号室']);
  expectAddresses('架空県みほん市さくら町1-2-3 さくらハイツB棟 105号室', ['架空県みほん市さくら町1-2-3 さくらハイツB棟 105号室']);
  expectAddresses('架空県みほん市さくら町1-2-3 コーポさくら 202', ['架空県みほん市さくら町1-2-3 コーポさくら 202']);
  expectAddresses('みほん市さくら町1-2-3 5階', ['みほん市さくら町1-2-3 5階']);
  expectAddresses('架空県みほん市さくら町1-2-3-101', ['架空県みほん市さくら町1-2-3-101']);
});

test('〒と郵便番号', () => {
  expectAddresses('〒000-0000 架空県みほん市さくら町1-2-3', ['〒000-0000 架空県みほん市さくら町1-2-3']);
  expectAddresses('送付先 〒０００－００００', ['〒０００－００００']);
  expectAddresses('郵便番号: 000-0000', ['000-0000']);
  // 欄名も〒も無い「000-0000」は郵便番号とみなさない
  expectAddresses('図面番号 000-0000', []);
});

test('住所の形が、続く会社名・人名・電話・発注者の名前を食わない', () => {
  const r1 = mask('架空県みほん市さくら町1-2-3 甲山建設株式会社');
  assert.equal(r1.masked, '〔住所1〕 〔会社名1〕');
  assert.deepEqual(addresses('架空県みほん市 さくら町 0-0 甲野 一郎'), ['架空県みほん市 さくら町 0-0']);
  const r3 = mask('架空県みほん市さくら町1-2-3 03-0000-0000');
  assert.equal(r3.masked, '〔住所1〕 〔電話1〕');
  // 「発注者名及び住所」の欄: 前の「架空県」は発注者の名前なので住所に入れない
  expectAddresses('架空県 架空県ためし市0-0', ['架空県ためし市0-0']);
  // 発注者・役職としての市区町村は住所にしない
  expectAddresses('発注者 架空県みほん市長 甲野', []);
  expectAddresses('架空県みほん市役所', []);
  // 建物名に見える所に法人の種類の語が入るなら、会社名として分ける
  assert.equal(mask('架空県みほん市さくら町1-2-3 さくら建設ハウス工業株式会社').masked, '〔住所1〕 〔会社名1〕');
});

test('番地の無い住所は、町名の終わり(町・村・丁目・地内・地先)まで。欄名の後ろなら都道府県 + 市区町村だけでも取る', () => {
  expectAddresses('架空県みほん市さくら町にある工場', ['架空県みほん市さくら町']);
  expectAddresses('工事場所 みほん市さくら町地内', ['みほん市さくら町地内']);
  expectAddresses('架空県ためし郡みほん町', ['架空県ためし郡みほん町']);
  expectAddresses('住所: 架空県みほん市', ['架空県みほん市']);
  expectAddresses('発注者: 架空県みほん市', []);
});

test('置き換えすぎない(住所ではない数・語)', () => {
  const NOT = [
    'みほん市 2026年度', 'みほん市 第3工区', '都市計画 1-2', '第3工区 1-2', 'A地区 1-2', '区間 1-2 の舗装', '町内会 1-2',
    '市道さくら町線の工事', '工期は令和8年10月1日から', '延長 120m 幅員 5.5m', 'No.3+20 から No.5', '架空ビル 3F 301号室',
    'みほん市 3', '請負代金額 52,000,000円', '架空県知事 許可(特-06)第90001号', '架空県甲野市道1号線', '甲野市道1号線道路改良工事',
  ];
  for (const t of NOT) expectAddresses(t, []);
});

test('業界を問わない(医療(例)の辞書でも同じ)', () => {
  expectAddresses('架空県みほん市さくら町1-2-3 みほんビル 2階', ['架空県みほん市さくら町1-2-3 みほんビル 2階'], MEDICAL_DICT);
  expectAddresses('〒000-0000 みほん市さくら町一丁目2番3号', ['〒000-0000 みほん市さくら町一丁目2番3号'], MEDICAL_DICT);
});

test('規則の一覧と出典(都道府県47・アドレス・ベース・レジストリ・日本郵便)', () => {
  assert.equal(PREFECTURES.length, 47);
  assert.ok(ADDRESS_RULES.length >= 2);
  const src = fs.readFileSync(new URL('../../src/mask/rules-address.mjs', import.meta.url), 'utf8');
  for (const u of ['https://www.digital.go.jp/policies/base_registry_address', 'https://www.post.japanpost.jp/service/search/zipcode/download/readme.html', 'https://www.soumu.go.jp/denshijiti/code.html']) {
    assert.ok(src.includes(u), '出典の URL が無い: ' + u);
  }
});

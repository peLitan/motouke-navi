// F31c: 語尾が前に来る施設名・条丁目と通り名の住所・文脈で見つけた長い名前の中の辞書の語(反証 第2弾の A-4・A-5・D-1(辞書))。
// 例はすべて架空か、語の形の説明に使う一般の地名。初めて見る書類(fixtures/unseen/)は使わない
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMasker } from '../../src/mask/core.mjs';
import { CONSTRUCTION_DICT } from '../../src/mask/dict-construction.mjs';
import { MEDICAL_DICT } from '../../src/mask/dict-medical.mjs';

const DICTS = [['建設', CONSTRUCTION_DICT], ['医療', MEDICAL_DICT]];
const run = (text, dict) => createMasker({ dictionaries: [dict] }).mask(text);

// 語が丸ごと1つの記号になり、字が残らない
function whole(text, word, kinds) {
  for (const [name, dict] of DICTS) {
    const { masked, map } = run(text, dict);
    const hit = map.find((e) => e.original === word);
    assert.ok(hit, `${name}: ${text} → ${masked}`);
    assert.ok(kinds.includes(hit.kind), `${name}: ${hit.kind}`);
    assert.ok(!masked.includes(word), `${name}: ${masked}`);
  }
}
function untouched(list) {
  for (const [name, dict] of DICTS) for (const text of list) assert.equal(run(text, dict).masked, text, name);
}

const ORG = ['company', 'site'];

test('A-4: 再現の入力の施設名を見つける', () => {
  whole('さくら市立ひまわり幼稚園の園庭', 'さくら市立ひまわり幼稚園', ORG);
  whole('甲野ひまわり幼稚園', '甲野ひまわり幼稚園', ORG);
  whole('デイサービスセンターひまわり', 'デイサービスセンターひまわり', ORG);
  whole('特別養護老人ホームさくらの里', '特別養護老人ホームさくらの里', ORG);
  whole('グループホーム甲野', 'グループホーム甲野', ORG);
  whole('社会福祉法人みほん会 ためし園', 'ためし園', ORG);
  whole('社会福祉法人みほん会 ためし園', '社会福祉法人みほん会', ORG);
});

test('A-4: 再現の入力に無い名前・種類でも見つける(語の決め打ちではない)', () => {
  whole('乙川市立つばさ小学校で工事', '乙川市立つばさ小学校', ORG);
  whole('丙山わかば診療所', '丙山わかば診療所', ORG);
  whole('グループホーム 丙山', 'グループホーム 丙山', ORG);
  whole('有料老人ホームあおぞらの丘に入居', '有料老人ホームあおぞらの丘', ORG);
  whole('ケアハウス乙川', 'ケアハウス乙川', ORG);
  whole('デイサービスセンターのぞみ', 'デイサービスセンターのぞみ', ORG);
  whole('グループホーム内田', 'グループホーム内田', ORG);
  whole('ひまわりデイサービスセンター', 'ひまわりデイサービスセンター', ORG);
  whole('(福)みほん会 ためし苑', 'ためし苑', ORG);
  whole('学校法人みほん学園 ためし寮', 'ためし寮', ORG);
  whole('デイサービスセンターひまわりの職員', 'デイサービスセンターひまわり', ORG);
});

test('A-4: 2つの施設を分ける。文脈の無い2か所目も同じ記号にする', () => {
  const { masked } = run('デイサービスセンターひまわり・グループホーム甲野', CONSTRUCTION_DICT);
  assert.equal(masked, '〔会社名1〕・〔会社名2〕');
  const again = run('社会福祉法人みほん会 ためし園。ためし園の工事。', CONSTRUCTION_DICT).masked;
  assert.ok(!again.includes('ためし園'), again);
});

test('A-4: 施設の一般の言い方・文を取らない', () => {
  untouched(['大きな病院', '通っている幼稚園', '素晴らしい病院', '新たな建設', 'グループホームです', '特別養護老人ホームなどの施設',
    '特別養護老人ホームの入所者', 'グループホーム入居者', 'デイサービスセンター利用者', 'デイサービス利用', 'グループホームは利用者',
    '特別養護老人ホームがあります', '老人ホーム2階', 'グループホーム等', '認知症グループホーム', 'デイサービスセンターの送迎']);
  // 法人の名前は取るが、続く一般の語は取らない。園で終わる語は福祉・医療・学校などの法人の後ろだけ
  for (const [text, rest] of [['社会福祉法人みほん会 中央公園', '中央公園'], ['社会福祉法人みほん会 保育園', '保育園'], ['株式会社甲野 みほん園', 'みほん園']]) {
    assert.ok(run(text, CONSTRUCTION_DICT).masked.endsWith(' ' + rest), text);
  }
});

test('A-5: 条丁目は全部を1つにする', () => {
  for (const a of ['北海道札幌市北区北8条西5丁目1-1', '札幌市中央区南1条西2丁目', '札幌市北区北二十条東一丁目2番3号', '札幌市豊平区平岸3条5丁目', '旭川市4条通8丁目',
    '北海道みほん市南1条 西2丁目3-4', '札幌市中央区南1条西2丁目 みほんビル301号室']) {
    whole(`所在地 ${a} まで`, a, ['address']);
  }
});

test('A-5: 京都の通り名は全部を1つにする。上る・下る が無ければ番地までか全部', () => {
  for (const a of ['京都市中京区寺町通御池上る上本能寺前町488', '京都市東山区四条通大和大路西入中之町200', '京都市下京区烏丸通七条下る東塩小路町721-1',
    '京都市中京区河原町通三条上ル下丸屋町403番地', '京都府京都市中京区寺町通御池上る上本能寺前町', '京都市中京区河原町通三条上る二筋目東入恵比須町1',
    '京都府京都市中京区寺町通御池', '京都市左京区みほん通寺町東入ル二丁目下ル甲野町1番地の2']) {
    whole(`所在地 ${a} まで`, a, ['address']);
  }
  // 通りの名前が市区町村の形に見えなくても、区までを取って通りの名前を残さない
  whole('所在地 京都府京都市中京区烏丸通御池 まで', '京都府京都市中京区烏丸通御池', ['address']);
  whole('所在地 京都市中京区烏丸通御池 まで', '京都市中京区烏丸通御池', ['address']);
  assert.equal(run('架空県ためし郡みほん町交通事故', CONSTRUCTION_DICT).masked, '〔住所1〕交通事故');
  // 「寺町」だけを取って「通御池」を残さない
  const { masked } = run('現場は京都府京都市中京区寺町通御池です', CONSTRUCTION_DICT);
  assert.ok(!masked.includes('通御池'), masked);
  assert.equal(run('京都市中京区寺町通御池上るところ', CONSTRUCTION_DICT).masked, '〔住所1〕ところ');
});

test('A-5: 法令の条と文の中の「上る」を住所にしない', () => {
  untouched(['みほん市交通局', 'みほん市烏丸通御池', 'みほん市条例3条', '架空県みほん市条例3条の規定', '工事は南3条の規定', 'みほん市の坂を上る', 'みほん市 3条']);
  assert.equal(run('架空県みほん市さくら町通信工事', CONSTRUCTION_DICT).masked, '〔住所1〕通信工事');
});

function withTerm(word, text) {
  const m = createMasker({ dictionaries: [CONSTRUCTION_DICT] });
  m.addTerm(word, 'person');
  return m.mask(text);
}

test('D-1(辞書): 足した語が文脈で見つけた長い名前の中にあれば、長い方を取る', () => {
  assert.equal(withTerm('林', '担当者: 小林 一郎').masked, '担当者: 〔人名1〕');
  assert.equal(withTerm('山田', '責任者: 小山田 二郎').masked, '責任者: 〔人名1〕');
  assert.equal(withTerm('林', '小林 一郎 様').masked, '〔人名1〕 様');
  assert.deepEqual(withTerm('林', '担当者: 小林 一郎').map.map((e) => e.original), ['小林 一郎']);
});

test('D-1(辞書): 文脈の無い2か所目でも、名が漏れない', () => {
  const { masked } = withTerm('林', '担当者: 小林 一郎\n確認は小林 一郎が行う');
  assert.ok(!masked.includes('一郎'), masked);
  assert.ok(!masked.includes('小〔'), masked);
});

test('D-1(辞書): 足した語の単独の所は今までどおり。文脈の語が形に負けるときは足した語を残す', () => {
  assert.equal(withTerm('林', '林さんに連絡').masked, '〔人名1〕さんに連絡');
  const m = withTerm('甲野', '甲野に連絡し、担当者: 小林 一郎').masked;
  assert.ok(m.startsWith('〔人名1〕に連絡'), m);
  // 文脈の語「甲野 乙川」は形の語「乙川㈱」と一部だけ重なる。足した語を外すと「甲野」が漏れる
  assert.equal(withTerm('甲野', '担当者: 甲野 乙川㈱').masked, '担当者: 〔人名1〕 〔会社名1〕');
});

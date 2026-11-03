// 人名の文脈規則(F17a、src/mask/rules-person.mjs)の単体テスト。名前・会社名・電話はすべて架空
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createMasker } from '../../src/mask/core.mjs';
import { CONSTRUCTION_DICT } from '../../src/mask/dict-construction.mjs';
import { personContextPatterns, PERSON_RULES } from '../../src/mask/rules-person.mjs';

const mk = () => createMasker({ dictionaries: [CONSTRUCTION_DICT] });
// 分野の辞書を使わず、一般の規則だけを持つ辞書
const generic = () => createMasker({ dictionaries: [{ name: '一般', contextPatterns: personContextPatterns() }] });
const persons = (r) => r.map.filter((e) => e.kind === 'person').map((e) => e.original);

// 辞書に足さなくても人名の候補として置き換わる例(架空)
const FOUND = [
  ['甲野様、いつもお世話になっております。', '甲野', 'honorific'],
  ['代表取締役 戊井 健 殿', '戊井 健', 'honorific'],
  ['甲野氏が来た。', '甲野', 'honorific'],
  ['長谷川一郎さんに伝える。', '長谷川一郎', 'honorific'],
  ['現場代理人 甲野 一郎', '甲野 一郎', 'title'],
  ['監理技術者:乙川次郎', '乙川次郎', 'title'],
  ['担当者 丁谷太郎(090-0000-0000)', '丁谷太郎', 'label'],
  ['作業主任者\t己野 三郎\t一級', '己野 三郎', 'title'],
  ['代表者 代表取締役 甲野一郎', '甲野一郎', 'title'],
  ['職長 壬生 五郎は休み。', '壬生 五郎', 'title'],
  ['監理技術者補佐 癸山 六郎', '癸山 六郎', 'title'],
  ['氏名: 丙田 さくら が確認しました', '丙田 さくら', 'label'],
  ['| 氏名 | 辛島 四郎 |', '辛島 四郎', 'label'],
  ['作成者:子安 二夫', '子安 二夫', 'label'],
];

test('敬称・役職・欄名の隣の語を、辞書に無くても人名として置き換える(架空の例14件)', () => {
  for (const [text, name, rule] of FOUND) {
    const r = mk().mask(text);
    assert.ok(!r.masked.includes(name), '置き換わっていない: ' + text + ' → ' + r.masked);
    const e = r.map.find((x) => x.original === name);
    assert.ok(e, '対応表に無い: ' + name + '(' + text + ')');
    assert.equal(e.kind, 'person', name);
    assert.equal(e.rule, rule, name + ' の規則');
  }
});

// 置き換えすぎにしない例: 敬称・役職・欄名の隣にあるが人名ではない語
const NOT_NAMES = [
  'お客様各位、皆様、お得意様',
  '監理技術者 専任、現場代理人 未定、氏名: 同上',
  '連絡先: 本社 総務課',
  '主任技術者証、現場代理人等、所長代理',
  '標準仕様、特記仕様、同様、多様、仕様書、様式、様々',
  '発注者様、施主様、ご担当者様、ご家族様、ご一同様',
  '工事担当者 なし、作業主任者 選任',
  '代表取締役社長、部長 兼 課長',
  '氏名欄に書く。氏名又は名称',
  '担当: 工務部、連絡先 営業所',
];

test('置き換えすぎにしない: 役職・欄名・止める語・人名に付かない字で終わる語(10件)', () => {
  for (const text of NOT_NAMES) {
    const r = mk().mask(text);
    assert.deepEqual(persons(r), [], '人名にした: ' + text + ' → ' + r.masked);
    assert.equal(r.masked, text);
  }
});

test('前に別の漢字が続く名前は取らない(「担当者甲野さん」を丸ごと人名にしない)', () => {
  const r = mk().mask('担当者甲野さん');
  assert.deepEqual(persons(r), []);
});

test('会社名・辞書の語と重なれば、文脈の規則より辞書・形を取る', () => {
  const r = mk().mask('甲山建設株式会社 様、株式会社乙川土工 殿');
  assert.deepEqual(r.map.map((e) => [e.original, e.kind]), [['甲山建設株式会社', 'company'], ['株式会社乙川土工', 'company']]);
  const m = mk();
  m.addTerm('甲野', 'person');
  const r2 = m.mask('甲野様');
  assert.equal(r2.map[0].rule, undefined, '足した語は確信の弱い語にしない');
});

test('文脈で見つけた語は、同じ文の文脈の無い所も同じ記号にする。戻すと元に戻る', () => {
  const m = mk();
  const t = '職長 壬生 五郎は休み。壬生 五郎の代わりに弟が来る。';
  const r = m.mask(t);
  assert.equal(r.map.length, 1);
  assert.equal(r.masked, '職長 〔人名1〕は休み。〔人名1〕の代わりに弟が来る。');
  assert.equal(m.unmask(r.masked), t);
  // 空白の有無だけ違う書き方も同じ語(戻すときは最初の書き方。F11a と同じ)
  assert.equal(m.mask('職長 壬生 五郎。壬生五郎の弟').masked, '職長 〔人名1〕。〔人名1〕の弟');
});

test('文脈で見つけた語が、あとで辞書の語としても出たら、確信の弱い印を外す', () => {
  const m = mk();
  assert.equal(m.mask('氏名: 甲野 一郎').map[0].rule, 'label');
  m.addTerm('甲野 一郎', 'person');
  m.mask('甲野 一郎');
  assert.equal(m.entries()[0].rule, undefined);
});

test('一般の規則だけでも動く(分野の役職は辞書から足す)', () => {
  assert.deepEqual(persons(generic().mask('部長 甲野 一郎、氏名: 乙川次郎、丙田様')), ['甲野 一郎', '乙川次郎', '丙田']);
  // 建設の役職は一般の規則には無い
  assert.deepEqual(persons(generic().mask('監理技術者 甲野 一郎')), []);
  assert.deepEqual(persons(mk().mask('監理技術者 甲野 一郎')), ['甲野 一郎']);
});

test('規則のファイルは分野の語を持たない。規則の一覧がある', () => {
  const src = fs.readFileSync(new URL('../../src/mask/rules-person.mjs', import.meta.url), 'utf8');
  for (const w of ['建設', '工事', '施工', '下請', '元請', '許可', '現場代理人', '技術者']) assert.ok(!src.includes(w), '規則に建設の語: ' + w);
  assert.deepEqual(PERSON_RULES.map((r) => r.id), ['honorific', 'title', 'label']);
});

test('既にある形(メール・電話・許可番号)はそのまま', () => {
  const r = mk().mask('担当者 甲野 一郎(kono@example.com、03-0000-0000)、架空県知事 許可(特-06)第90001号');
  assert.deepEqual(r.map.map((e) => e.kind), ['person', 'email', 'phone', 'license']);
});

// 現場名の語尾の規則(F17b、src/mask/rules-site.mjs・src/mask/suffix-construction.mjs)の単体テスト。現場名・人名・会社名はすべて架空
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createMasker } from '../../src/mask/core.mjs';
import { CONSTRUCTION_DICT } from '../../src/mask/dict-construction.mjs';
import { siteSuffixPatterns, SITE_RULES } from '../../src/mask/rules-site.mjs';
import { CONSTRUCTION_SITE_TABLE, CONSTRUCTION_SITE_SUFFIXES } from '../../src/mask/suffix-construction.mjs';

const mk = () => createMasker({ dictionaries: [CONSTRUCTION_DICT] });
const sites = (r) => r.map.filter((e) => e.kind === 'site').map((e) => e.original);

// 辞書に足さなくても現場名の候補として置き換わる例(架空)
const FOUND = [
  ['工事名: みほん市道 架空3号線 道路改良工事(第1工区)', 'みほん市道 架空3号線 道路改良工事(第1工区)', 'site-label'],
  ['工事名称：甲野川改修工事', '甲野川改修工事', 'site-label'],
  ['| 工事名 | ためし台共同住宅 新築工事 |', 'ためし台共同住宅 新築工事', 'site-label'],
  ['工事名: (仮称)ためし台共同住宅 新築工事', 'ためし台共同住宅 新築工事', 'site-label'],
  ['件名\t架空町 こころみ川 護岸整備工事', '架空町 こころみ川 護岸整備工事', 'site-label'],
  ['工事名甲野川改修工事について', '甲野川改修工事', 'site-suffix'],
  ['甲野市道1号線道路改良工事の施工計画', '甲野市道1号線道路改良工事', 'site-suffix'],
  ['丙田作業所の所長に届ける。', '丙田作業所', 'site-suffix'],
  ['甲野川改修工事第2工区で行う。', '甲野川改修工事第2工区', 'site-suffix'],
  ['乙山ビル新築工事、丁町一丁目地区工事', '乙山ビル新築工事', 'site-suffix'],
  ['戊浜倉庫現場に集合', '戊浜倉庫現場', 'site-suffix'],
];

test('語尾(工事・工区・作業所・現場)で終わる語を、辞書に無くても現場名として置き換える(架空の例11件)', () => {
  for (const [text, name, rule] of FOUND) {
    const r = mk().mask(text);
    assert.ok(!r.masked.includes(name), '置き換わっていない: ' + text + ' → ' + r.masked);
    const e = r.map.find((x) => x.original === name);
    assert.ok(e, '対応表に無い: ' + name + '(' + text + ') → ' + JSON.stringify(sites(r)));
    assert.equal(e.kind, 'site', name);
    assert.equal(e.rule, rule, name + ' の規則');
  }
});

test('欄名は置き換えず、欄名の後ろの値だけを置き換える。「(仮称)」は残す', () => {
  assert.equal(mk().mask('工事名: 甲野川改修工事').masked, '工事名: 〔現場名1〕');
  assert.equal(mk().mask('工事名甲野川改修工事について').masked, '工事名〔現場名1〕について');
  assert.equal(mk().mask('工事名: (仮称)ためし台共同住宅 新築工事').masked, '工事名: (仮称)〔現場名1〕');
});

// 置き換えすぎにしない例: 一般の語だけの「〜工事」、語尾の後ろに漢字が続くもの、指示語
const NOT_SITE = [
  '下請工事', '土木一式工事', '建設現場', '第2工区', '当該工事の工事費', 'とび・土工工事業', '公共工事', 'この工事は', '電気通信工事', '本工事',
  '附帯工事', '擁壁工事の仮設足場', '給排水衛生設備の手直し・追加工事', '現場代理人', '1級管工事施工管理技士', '工事現場への備え付け', '直接建設工事',
  '6. 躯体工事計画', '1.1 工事名・工事場所・工期', 'その他工事', '北工区',
];

test('一般の語だけの「〜工事」や「工事費」「現場代理人」などは現場名にしない(架空の例21件)', () => {
  for (const text of NOT_SITE) {
    const r = mk().mask(text);
    assert.deepEqual(sites(r), [], '置き換えすぎ: ' + text + ' → ' + r.masked);
  }
});

test('規則で見つけた現場名は、同じ文の中の文脈の無い所の同じ語も同じ記号にし、元に戻せる', () => {
  const m = mk();
  const text = '工事名: こころみ川 護岸整備工事\n本書は こころみ川 護岸整備工事 の計画です。';
  const r = m.mask(text);
  assert.ok(!r.masked.includes('こころみ川'), r.masked);
  assert.equal(r.map.filter((e) => e.kind === 'site').length, 1);
  assert.equal(m.unmask(r.masked), text);
});

test('辞書の形(共同企業体の名前)・足した語と重なれば、そちらを取る', () => {
  const r = mk().mask('甲乙特定建設工事共同企業体');
  assert.deepEqual(r.map.map((e) => [e.kind, e.rule]), [['company', undefined]]);
  const m = mk();
  m.addTerm('甲野川改修工事', 'site');
  const r2 = m.mask('工事名: 甲野川改修工事');
  assert.equal(r2.map[0].rule, undefined, '足した語は確信の弱い語にしない');
  // 人名の規則とぶつからない
  const r3 = mk().mask('現場代理人 甲野 一郎(甲野川改修工事)');
  assert.deepEqual(r3.map.map((e) => e.kind).sort(), ['person', 'site']);
});

test('語尾の表は差し替えられる: 規則は分野の語を持たず、別の業界の表(例)を渡せば、その語尾で動く', () => {
  assert.deepEqual(siteSuffixPatterns(), [], '表が無ければ規則も無い');
  const example = { suffixes: ['病院', 'クリニック'], labels: ['施設名'], genericWords: ['総合', '市立'] };
  const m = createMasker({ dictionaries: [{ name: '例', contextPatterns: siteSuffixPatterns(example) }] });
  const r = m.mask('施設名: みほん台 中央クリニック\n甲野記念病院へ紹介。総合病院・市立病院は除く。甲野川改修工事');
  assert.deepEqual(sites(r).sort(), ['みほん台 中央クリニック', '甲野記念病院'].sort());
  // 規則のファイルに建設の語尾・欄名を置かない(建設の語は suffix-construction.mjs だけ)
  const src = fs.readFileSync(new URL('../../src/mask/rules-site.mjs', import.meta.url), 'utf8').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  for (const w of [...CONSTRUCTION_SITE_SUFFIXES, ...CONSTRUCTION_SITE_TABLE.labels]) assert.ok(!src.includes(`'${w}'`), '規則のファイルに建設の語: ' + w);
  assert.deepEqual(SITE_RULES.map((x) => x.id), ['site-label', 'site-suffix']);
});

test('語尾の表には 工事・工区・作業所・現場・JV があり、建設の辞書が使っている', () => {
  for (const w of ['工事', '工区', '作業所', '現場', 'JV']) assert.ok(CONSTRUCTION_SITE_SUFFIXES.includes(w), w);
  const rules = CONSTRUCTION_DICT.contextPatterns.map((p) => p.rule);
  assert.ok(rules.includes('site-label') && rules.includes('site-suffix'));
  assert.ok(rules.includes('honorific'), '人名の規則も残っている');
});

test('ほかの形(電話・メール・人名の規則)はそのまま動く', () => {
  const r = mk().mask('甲野作業所 担当者 丁谷太郎 03-0000-0000 info@example.com');
  const kinds = r.map.map((e) => e.kind).sort();
  assert.deepEqual(kinds, ['email', 'person', 'phone', 'site']);
});

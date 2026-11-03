// F19b: 医療の語尾の表(src/mask/suffix-medical.mjs・src/mask/dict-medical.mjs)と画面の業界の切り替えの単体テスト。
// 施設名・人名はすべて架空。医療の表は「例」で、漏れの率は測っていない
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createMasker } from '../../src/mask/core.mjs';
import { MEDICAL_DICT } from '../../src/mask/dict-medical.mjs';
import { MEDICAL_SITE_TABLE } from '../../src/mask/suffix-medical.mjs';
import { CONSTRUCTION_DICT } from '../../src/mask/dict-construction.mjs';
import { CONSTRUCTION_SITE_TABLE } from '../../src/mask/suffix-construction.mjs';
import { indexHtml, withoutScripts, hasId, labelFor, readText } from '../acceptance/_helpers.mjs';
import { setIndustry, currentIndustry, runMask, addDictWord, resetMask, INDUSTRIES, INDUSTRY_SWITCH_NOTICE } from '../../src/ui/mask-app.mjs';

const med = () => createMasker({ dictionaries: [MEDICAL_DICT] });
const sites = (r) => r.map.filter((e) => e.kind === 'site').map((e) => e.original);

test('表の形は建設の表と同じ(suffixes・labels・genericWords)で、医療の語尾がある', () => {
  assert.deepEqual(Object.keys(MEDICAL_SITE_TABLE).sort(), Object.keys(CONSTRUCTION_SITE_TABLE).sort());
  for (const w of ['病院', '医院', 'クリニック', '診療所', '薬局']) assert.ok(MEDICAL_SITE_TABLE.suffixes.includes(w), w);
  assert.equal(MEDICAL_DICT.labels.site, '施設名');
  // 種類の key は建設の辞書と同じ(辞書のファイルをどちらでも読めるように)
  assert.deepEqual(Object.keys(med().labels()).sort(), Object.keys(createMasker({ dictionaries: [CONSTRUCTION_DICT] }).labels()).sort());
});

test('施設名を語尾・欄名から見つける', () => {
  const cases = [
    ['紹介先: みほん台こころみクリニック', 'みほん台こころみクリニック', 'site-label'],
    ['病院名\t架空市立 みほん病院', '架空市立 みほん病院', 'site-label'],
    ['甲野記念病院に紹介した。', '甲野記念病院', 'site-suffix'],
    ['乙川内科医院で受診した。', '乙川内科医院', 'site-suffix'],
    ['丙田薬局で薬を受け取る。', '丙田薬局', 'site-suffix'],
    ['戊浜歯科医院の予約', '戊浜歯科医院', 'site-suffix'],
    ['丁川町訪問看護ステーションが訪問する。', '丁川町訪問看護ステーション', 'site-suffix'],
    ['己山診療所に連絡', '己山診療所', 'site-suffix'],
  ];
  for (const [text, name, rule] of cases) {
    const r = med().mask(text);
    const e = r.map.find((x) => x.original === name);
    assert.ok(e, '対応表に無い: ' + name + '(' + text + ') → ' + JSON.stringify(sites(r)));
    assert.equal(e.kind, 'site');
    assert.equal(e.rule, rule, name);
    assert.ok(e.token.startsWith('〔施設名'), e.token);
    assert.ok(!r.masked.includes(name), r.masked);
  }
});

test('一般の言い方は施設名にしない(置き換えすぎにしない)', () => {
  for (const text of ['総合病院へ行く', '調剤薬局で受け取る', '大学病院に紹介', '近くの病院', '整形外科クリニックに通う', '当院の内科', '市立病院', '担当医 未定']) {
    const r = med().mask(text);
    assert.deepEqual(r.map, [], '置き換えすぎ: ' + text + ' → ' + r.masked);
  }
});

test('医療の役職・欄名の後ろの人名を見つけ、戻せる', () => {
  const m = med();
  const text = '主治医 甲野 一郎\n患者氏名: 乙川 花子\n看護師長 丙田 さくら 様';
  const r = m.mask(text);
  const persons = r.map.filter((e) => e.kind === 'person').map((e) => e.original);
  assert.deepEqual(persons.sort(), ['丙田 さくら', '乙川 花子', '甲野 一郎'].sort());
  assert.equal(m.unmask(r.masked), text);
});

test('建設の辞書は医療の語尾を使わず、医療の辞書は建設の形(許可番号・JV)を使わない', () => {
  const c = createMasker({ dictionaries: [CONSTRUCTION_DICT] }).mask('甲野記念病院に紹介した。');
  assert.deepEqual(sites(c), []);
  const r = med().mask('国土交通大臣 許可(特-06)第00000号');
  assert.deepEqual(r.map, []);
  // 分野によらない形(電話)は医療でも置き換える
  assert.ok(med().mask('電話 03-0000-0000').map.some((e) => e.kind === 'phone'));
});

// 部品を直接動かす小さな画面
function fakeDoc(confirmAnswer = true) {
  const els = {};
  const el = (id) => (els[id] ||= {
    id, value: '', _html: '', _text: '',
    get innerHTML() { return this._html; }, set innerHTML(v) { this._html = String(v); this._text = this._html.replace(/<[^>]+>/g, ''); },
    get textContent() { return this._text; }, set textContent(v) { this._text = String(v ?? ''); this._html = this._text; },
  });
  for (const id of ['mask-industry', 'mask-industry-status', 'mask-input', 'mask-amounts', 'mask-thresholds', 'mask-before', 'mask-after', 'mask-status',
    'mask-review', 'mask-unchecked', 'mask-map', 'unmask-output', 'dict-word', 'dict-kind', 'dict-status', 'dict-list', 'map-status', 'dict-file-status']) el(id);
  els['mask-industry'].value = 'construction';
  const doc = { getElementById: (id) => els[id] || null, els };
  const win = { confirm: (msg) => { doc.confirmed = msg; return confirmAnswer; } };
  return { doc, win };
}

test('画面: 業界を切り替えると医療の表で置き換え、足した語は残り、対応表は消える', () => {
  const { doc, win } = fakeDoc(true);
  resetMask(doc);
  setIndustry(doc, 'construction', win);
  doc.els['dict-word'].value = '庚野';
  doc.els['dict-kind'].value = 'person';
  addDictWord(doc);
  doc.els['mask-input'].value = '甲野記念病院の庚野先生';
  runMask(doc);
  assert.ok(doc.els['mask-after'].textContent.includes('甲野記念病院'), '建設では病院を置き換えない');
  assert.ok(setIndustry(doc, 'medical', win));
  assert.equal(currentIndustry(), 'medical');
  assert.equal(doc.confirmed.split('\n')[0], INDUSTRY_SWITCH_NOTICE);
  assert.equal(doc.els['mask-map'].innerHTML, '');
  assert.equal(doc.els['mask-after'].textContent, '');
  assert.match(doc.els['mask-industry-status'].textContent, /例の表で、医療の書類での漏れの率は測っていません/);
  assert.match(doc.els['mask-industry-status'].textContent, /足した語 1 件/);
  runMask(doc);
  const after = doc.els['mask-after'].textContent;
  assert.ok(!after.includes('甲野記念病院') && !after.includes('庚野'), after);
  assert.ok(after.includes('〔施設名1〕'), after);
  // 戻す
  assert.ok(setIndustry(doc, 'construction', win));
  assert.equal(currentIndustry(), 'construction');
  assert.equal(doc.els['mask-industry'].value, 'construction');
});

test('画面: 対応表があるとき確かめ、やめたら業界も選びも元のまま。知らない業界は拒む', () => {
  const { doc, win } = fakeDoc(false);
  resetMask(doc);
  setIndustry(doc, 'construction', { confirm: () => true });
  doc.els['mask-input'].value = '電話 03-0000-0000';
  runMask(doc);
  doc.els['mask-industry'].value = 'medical';
  assert.equal(setIndustry(doc, 'medical', win), false);
  assert.equal(currentIndustry(), 'construction');
  assert.equal(doc.els['mask-industry'].value, 'construction');
  assert.ok(doc.els['mask-map'].innerHTML.includes('03-0000-0000'), '対応表は消さない');
  assert.equal(setIndustry(doc, 'toString', win), false);
  assert.equal(setIndustry(doc, 'xxxx', win), false);
  assert.equal(currentIndustry(), 'construction');
  assert.deepEqual(Object.keys(INDUSTRIES), ['construction', 'medical']);
});

test('index.html に業界の切り替えと「例」・率は測っていない旨があり、README にも書いてある', () => {
  const body = withoutScripts(indexHtml());
  assert.ok(hasId(body, 'mask-industry') && hasId(body, 'mask-industry-note') && hasId(body, 'mask-industry-status'));
  assert.equal(labelFor(body, 'mask-industry'), '業界(語尾・役職の表)');
  assert.ok(body.includes('<option value="medical">医療(例)</option>'));
  assert.match(body, /医療の書類での漏れの率は測っていません/);
  const readme = readText('README.md');
  assert.match(readme, /src\/mask\/suffix-medical\.mjs/);
  assert.ok(readme.includes('医療(例)'));
  assert.match(readme, /医療の書類での漏れの率は測っていません/);
  // 外の読み込みを足していない
  assert.ok(!/import\s.*https?:/.test(fs.readFileSync(new URL('../../src/mask/dict-medical.mjs', import.meta.url), 'utf8')));
});

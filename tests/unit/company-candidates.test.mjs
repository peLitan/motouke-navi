// 辞書に足す候補(F36b)の試験。会社名・人名はすべて架空
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMasker } from '../../src/mask/core.mjs';
import { CONSTRUCTION_DICT } from '../../src/mask/dict-construction.mjs';
import { MEDICAL_DICT } from '../../src/mask/dict-medical.mjs';
import { findCompanyCandidates } from '../../src/mask/company-candidates.mjs';
import { indexHtml, withoutScripts } from '../acceptance/_helpers.mjs';
import {
  runMask, decideCandidate, resetMask, startMask, maskedText, renderCandidates, setIndustry,
} from '../../src/ui/mask-app.mjs';

const find = (text, dict = CONSTRUCTION_DICT) => {
  const m = createMasker({ dictionaries: [dict] });
  return findCompanyCandidates(text, m.spans(text), dict.candidates);
};
const words = (text, dict) => find(text, dict).map((c) => c.word);

function fakeDoc() {
  const els = {};
  const el = (id) => (els[id] ||= {
    id, value: '', hidden: false, _html: '', _text: '', handlers: {},
    get innerHTML() { return this._html; }, set innerHTML(v) { this._html = String(v); this._text = this._html.replace(/<[^>]+>/g, ''); },
    get textContent() { return this._text; }, set textContent(v) { this._text = String(v ?? ''); this._html = this._text; },
    addEventListener(type, f) { this.handlers[type] = f; },
  });
  for (const id of ['mask-input', 'mask-amounts', 'mask-thresholds', 'mask-before', 'mask-after', 'mask-map', 'mask-review', 'mask-candidates', 'mask-candidate-status',
    'mask-unchecked', 'mask-status', 'mask-decoy', 'mask-residual', 'mask-industry', 'mask-industry-status', 'unmask-input', 'unmask-output', 'map-status', 'dict-word', 'dict-kind', 'dict-status', 'dict-list', 'dict-file-status']) el(id);
  return { getElementById: (id) => els[id] || null, els, defaultView: null };
}

test('候補に出る: 表の横に値が並ぶ欄(| 区切り・タブ区切り)', () => {
  assert.deepEqual(words('| 項目 | 内容 |\n|---|---|\n| 商号 | みほんリペア |\n| 下請負人 | ためし技研 |\n| 工種 | 舗装 |\n'), ['みほんリペア', 'ためし技研']);
  assert.deepEqual(words('会社名\tふもと野テクノ\n住所\t\n'), ['ふもと野テクノ']);
  assert.deepEqual(words('| 商号 | みほんリペア | 住所 | |\n'), ['みほんリペア']);
  assert.deepEqual(words('| 一次下請負人(商号) | ためし技研 御中 |'), ['ためし技研']);
});

test('候補に出る: 見出しの行の下に値が並ぶ表(複数行・タブ区切り)。表が終われば読まない', () => {
  const md = '| 次数 | 会社名 | 工種 |\n|---|---|---|\n| 一次 | みほんリペア | 舗装 |\n| 二次 | ためし技研 | 区画線 |\n\n| 備考 | 値 |\n|---|---|\n| 一式 | ふもと野テクノ |\n';
  assert.deepEqual(words(md), ['みほんリペア', 'ためし技研']);
  assert.deepEqual(words('下請負人\t工種\t下請契約の日\nみほんリペア\t舗装\t令和7年4月1日\nためし技研\t区画線\t令和7年4月2日\n'), ['みほんリペア', 'ためし技研']);
});

test('候補に出る: 「欄名: 値」と行の頭の「欄名 値」。読点で並ぶ値は分ける', () => {
  assert.deepEqual(words('下請負人: みほんリペア、ためし技研'), ['みほんリペア', 'ためし技研']);
  assert.deepEqual(words('・協力会社:ふもと野テクノ'), ['ふもと野テクノ']);
  assert.deepEqual(words('工事の概要 商号: みほんリペア 住所は別紙'), ['みほんリペア']);
  assert.deepEqual(words('商号 みほん リペア'), ['みほん リペア']);
});

test('候補に出る: 法人の種類に近い形と慣用の語尾。根拠の語を添える', () => {
  const cases = {
    '社団法人みほん協和と協議する': '社団法人みほん協和',
    'ためし技研(同)へ発注する': 'ためし技研(同)',
    '（資）ふもと野テクノが納入する': '（資）ふもと野テクノ',
    'Mihon Trading Co., Ltd.へ連絡する': 'Mihon Trading Co., Ltd.',
    '当社はみほん土木に依頼した': 'みほん土木',
    '資材は甲川商事から買う': '甲川商事',
    '乙川電設が配線を担当': '乙川電設',
    '丙川運輸の車両': '丙川運輸',
  };
  for (const [text, word] of Object.entries(cases)) assert.deepEqual(words(text), [word], text);
  const [c] = find('乙川電設が配線を担当');
  assert.equal(c.source, 'shape');
  assert.ok(c.basis.includes('電設'));
  assert.ok(find('| 商号 | みほんリペア |')[0].basis.includes('商号'));
});

test('候補に出ない: 普通の言葉', () => {
  for (const text of [
    '土木工事と電気設備の施工について', '公共土木の発注', '建設コンサルタントに委託する', '給排水衛生設備と空調設備を更新する', '電気設備・消防設備・換気設備',
    '外壁塗装と屋根塗装を行う', '運送の手配をする', '不動産の登記', '社団法人は設立できる', '商事の分野', '会社名を記入する', '下請負人の選定について', '下請負人は通知する',
    '当社は商号を変更した', '工事名称: みほん市道', '| 工事名 | 甲 |', '## 一次下請負人 一覧',
  ]) assert.deepEqual(words(text), [], text);
});

test('候補に出ない: 欄の値が空欄の印・数・見出しの語・文', () => {
  for (const v of ['なし', '無', '同上', '別紙のとおり', '未定', '-', '―', '○', '〇〇', '令和7年4月1日', '12,000,000', '住所', '代表者', '合計', '記入してください。', 'xxxx', '(主任技術者']) {
    assert.deepEqual(words('| 商号 | ' + v + ' |\n'), [], v);
  }
  // 見出しの語の並び(区切りの行が無い)を横の値と読まない
  assert.deepEqual(words('| 商号 | 住所 | 代表者 |\n'), []);
});

test('候補に出ない: すでに置き換えた語と、足した語', () => {
  assert.deepEqual(words('| 商号 | 架空土木株式会社 |\n| 下請負人 | 甲野工務店 |\n元請はみほん建設株式会社'), []);
  const m = createMasker({ dictionaries: [CONSTRUCTION_DICT] });
  const text = '| 商号 | みほんリペア |';
  m.addTerm('みほんリペア', 'company');
  assert.deepEqual(findCompanyCandidates(text, m.spans(text), CONSTRUCTION_DICT.candidates), []);
  // 欄の値の一部だけ置き換わったときは、残りの所だけを見る
  assert.deepEqual(words('| 下請負人 | 架空土木株式会社 本店 |'), []);
});

test('同じ語は1件にまとめ、回数を数える。欄の値を先に並べる', () => {
  const r = find('乙川電設が来る。乙川電設が帰る。\n| 商号 | みほんリペア |\n商号: みほんリペア');
  assert.deepEqual(r.map((c) => [c.word, c.source, c.count]), [['みほんリペア', 'field', 2], ['乙川電設', 'shape', 2]]);
});

test('業界の語: 建設の語尾・欄名は医療の辞書では使わない。業界を問わない語は使う', () => {
  assert.deepEqual(words('乙川電設が来る', MEDICAL_DICT), []);
  assert.deepEqual(words('| 下請負人 | みほんリペア |', MEDICAL_DICT), []);
  assert.deepEqual(words('甲川商事から買う\n| 会社名 | みほんリペア |', MEDICAL_DICT), ['みほんリペア', '甲川商事']);
});

test('探すだけで置き換えない: 候補の部品は語を対応表に入れず、文も変えない', () => {
  const m = createMasker({ dictionaries: [CONSTRUCTION_DICT] });
  const text = '| 商号 | みほんリペア |\n乙川電設が来る';
  const spans = m.spans(text);
  assert.equal(findCompanyCandidates(text, spans, CONSTRUCTION_DICT.candidates).length, 2);
  const r = m.mask(text);
  assert.equal(r.masked, text);
  assert.deepEqual(r.map, []);
  assert.deepEqual(m.terms(), []);
});

test('画面: 候補は自動で置き換えず、「足さない」でも残り、「辞書に足す」で初めて置き換わる', () => {
  const doc = fakeDoc();
  resetMask(doc);
  doc.els['mask-input'].value = '| 商号 | みほんリペア |\n乙川電設が来る。元請は架空土木株式会社。';
  runMask(doc);
  const after = () => doc.els['mask-after'].textContent;
  // 置き換えていない
  assert.ok(after().includes('みほんリペア') && after().includes('乙川電設'));
  assert.ok(maskedText().includes('みほんリペア'));
  assert.ok(!doc.els['mask-map'].innerHTML.includes('みほんリペア'));
  assert.ok(after().includes('〔会社名1〕'));
  const box = () => doc.els['mask-candidates'].innerHTML;
  assert.equal((box().match(/data-candidate="add"/g) || []).length, 2);
  assert.equal((box().match(/data-candidate="skip"/g) || []).length, 2);
  assert.ok(box().includes('自動では置き換えません'));
  assert.ok(box().includes('未選択 2 件'));

  // 足さない: 語は残り、辞書にも入らない。置き換え直しても「足さない」のまま
  assert.equal(decideCandidate(doc, '乙川電設', 'skip'), true);
  assert.ok(after().includes('乙川電設'));
  assert.ok(!doc.els['dict-list'].innerHTML.includes('乙川電設'));
  assert.ok(box().includes('未選択 1 件'));
  runMask(doc);
  assert.ok(box().includes('未選択 1 件'));
  assert.ok(box().includes('data-candidate="skip" data-word="乙川電設" aria-pressed="true"'));

  // 辞書に足す: 会社名として足し、置き換え直す。候補から消え、後の欄に残らない
  assert.equal(decideCandidate(doc, 'みほんリペア', 'add'), true);
  assert.ok(!after().includes('みほんリペア'));
  assert.ok(after().includes('〔会社名2〕'));
  assert.ok(doc.els['dict-list'].innerHTML.includes('みほんリペア(会社名)'));
  assert.ok(doc.els['mask-map'].innerHTML.includes('みほんリペア'));
  assert.ok(!box().includes('data-word="みほんリペア"'));
  assert.ok(doc.els['mask-candidate-status'].textContent.includes('足し、置き換え直しました'));

  // 一覧に無い語・知らない選びは受けない
  assert.equal(decideCandidate(doc, '架空の語', 'add'), false);
  assert.equal(decideCandidate(doc, '乙川電設', 'replace'), false);

  // 消すと、候補と「足さない」の選びも消える
  resetMask(doc);
  assert.equal(box(), '');
  runMask(doc);
  assert.ok(box().includes('未選択 2 件'));
  resetMask(doc);
});

test('画面: 候補の表の枠で押されたボタンを受ける。語はエスケープして出す', () => {
  const doc = fakeDoc();
  resetMask(doc);
  startMask(doc);
  doc.els['mask-input'].value = '乙川電設が来る';
  runMask(doc);
  const btn = { getAttribute: (k) => ({ 'data-word': '乙川電設', 'data-candidate': 'add' })[k] };
  doc.els['mask-candidates'].handlers.click({ target: { closest: () => btn }, preventDefault() {} });
  assert.ok(!doc.els['mask-after'].textContent.includes('乙川電設'));
  resetMask(doc);
  const html = renderCandidates([{ word: '<b>"甲"</b>', basis: '<i>', count: 1 }], () => false);
  assert.ok(!html.includes('<b>') && !html.includes('<i>') && html.includes('&lt;b&gt;'));
});

test('画面: 候補が無いときはそう書き、保証の言い方にしない。件数が多いときは残りの数を出す', () => {
  const none = renderCandidates([]);
  assert.ok(none.includes('見つかりませんでした') && none.includes('目で確かめて'));
  const many = Array.from({ length: 53 }, (_, i) => ({ word: 'みほん' + i, basis: '語尾', count: 1 }));
  const html = renderCandidates(many, () => false);
  assert.equal((html.match(/data-candidate="add"/g) || []).length, 50);
  assert.ok(html.includes('ほか 3 件'));
});

test('画面: 業界を切り替えると候補と選びを消す', () => {
  const doc = fakeDoc();
  resetMask(doc);
  doc.els['mask-input'].value = '乙川電設が来る';
  runMask(doc);
  decideCandidate(doc, '乙川電設', 'skip');
  setIndustry(doc, 'medical', null);
  assert.equal(doc.els['mask-candidates'].innerHTML, '');
  setIndustry(doc, 'construction', null);
  runMask(doc);
  assert.ok(doc.els['mask-candidates'].innerHTML.includes('未選択 1 件'));
  resetMask(doc);
});

test('index.html: 候補の枠が選ぶ表の下にあり、作り直してある', () => {
  const html = indexHtml();
  const body = withoutScripts(html);
  assert.ok(body.indexOf('id="mask-review"') < body.indexOf('id="mask-candidates"'));
  assert.ok(body.indexOf('id="mask-candidates"') < body.indexOf('<h3>対応表</h3>'));
  assert.ok(html.includes('findCompanyCandidates'));
});

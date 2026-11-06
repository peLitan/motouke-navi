// F19a: 辞書(足した語と種類)の書き出しと読み込みの単体テスト。語はすべて架空
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMasker, parseDictFile, DICT_NOTICE, DICT_FORMAT } from '../../src/mask/core.mjs';
import { CONSTRUCTION_DICT } from '../../src/mask/dict-construction.mjs';
import { indexHtml, withoutScripts, hasId, labelFor } from '../acceptance/_helpers.mjs';
import { addDictWord, exportDictFile, importDictFile, resetMask } from '../../src/ui/mask-app.mjs';

const fresh = () => createMasker({ dictionaries: [CONSTRUCTION_DICT] });

test('往復: 書き出した辞書を別の画面で読み込むと、同じ語と種類が戻り、置き換えに使われる', () => {
  const a = fresh();
  a.addTerm('甲野 一郎', 'person');
  a.addTerm('みほん台の現場', 'site');
  a.addTerm('KY-0000', 'license');
  const text = a.exportDict();
  const data = JSON.parse(text);
  assert.equal(data.format, DICT_FORMAT);
  assert.equal(data.notice, DICT_NOTICE);
  assert.ok(DICT_NOTICE.includes('元の名前'));
  // 辞書のファイルには対応表(記号)を入れない
  assert.equal(data.entries, undefined);
  assert.ok(!text.includes('〔'));
  const b = fresh();
  const n = b.importDict(text);
  assert.deepEqual(n, { read: 3, added: 3, changed: 0, total: 3 });
  assert.deepEqual(b.terms().map((t) => [t.word, t.kind]), [['甲野 一郎', 'person'], ['みほん台の現場', 'site'], ['KY-0000', 'license']]);
  const r = b.mask('担当は甲野一郎。場所はみほん台の現場。');
  assert.ok(!r.masked.includes('甲野') && !r.masked.includes('みほん台'), r.masked);
  assert.equal(b.unmask(r.masked), '担当は甲野一郎。場所はみほん台の現場。');
  // 書き出し → 読み込み → 書き出しで同じ中身
  assert.equal(b.exportDict(), text);
});

test('読み込みは今の足した語に加える。同じ語は読み込んだ種類にし、対応表は変えない', () => {
  const a = fresh();
  a.addTerm('甲野 一郎', 'person');
  a.addTerm('乙川', 'company');
  const b = fresh();
  b.addTerm('乙川', 'person');
  b.addTerm('丙田', 'person');
  const r = b.mask('丙田と話した。');
  const n = b.importDict(a.exportDict());
  assert.deepEqual(n, { read: 2, added: 1, changed: 1, total: 3 });
  assert.deepEqual(b.terms().map((t) => [t.word, t.kind]), [['乙川', 'company'], ['丙田', 'person'], ['甲野 一郎', 'person']]);
  assert.equal(b.unmask(r.masked), '丙田と話した。');
});

test('壊れたファイル・形の違うファイルは理由を出して拒み、今の辞書は変わらない', () => {
  const kinds = Object.keys(fresh().labels());
  const bad = [
    ['{壊れ', /JSON の形になっていません/],
    ['[]', /このツールで書き出した辞書ではないか、版が違います/],
    ['null', /このツールで書き出した辞書ではないか、版が違います/],
    [JSON.stringify({ format: 'mask-map', version: 1, entries: [] }), /対応表のファイルです/],
    [JSON.stringify({ format: 'other', version: 1, terms: [] }), /このツールで書き出した辞書ではないか、版が違います/],
    [JSON.stringify({ format: 'mask-dict', version: 2, terms: [{ word: 'a', kind: 'person' }] }), /版/],
    [JSON.stringify({ format: 'mask-dict', version: 1 }), /このツールで書き出した辞書ではないか、版が違います/],
    [JSON.stringify({ format: 'mask-dict', version: 1, terms: [] }), /1つもありません/],
    [JSON.stringify({ format: 'mask-dict', version: 1, terms: [{ word: '甲野', kind: 'person' }, { kind: 'person' }] }), /2 番目の語が読めません/],
    [JSON.stringify({ format: 'mask-dict', version: 1, terms: [{ word: '甲野', kind: '' }] }), /1 番目の語が読めません/],
    [JSON.stringify({ format: 'mask-dict', version: 1, terms: [{ word: '甲野', kind: 'weapon' }] }), /種類 "weapon"/],
    [JSON.stringify({ format: 'mask-dict', version: 1, terms: [{ word: '甲野', kind: 'person' }, { word: '甲野', kind: 'company' }] }), /違う種類で重なって/],
    [JSON.stringify({ format: 'mask-dict', version: 1, terms: [{ word: 'x'.repeat(201), kind: 'person' }] }), /長すぎます/],
    [JSON.stringify({ format: 'mask-dict', version: 1, terms: [{ word: '甲野\n乙川', kind: 'person' }] }), /改行/],
    [JSON.stringify({ format: 'mask-dict', version: 1, terms: ['甲野'] }), /1 番目の語が読めません/],
  ];
  for (const [text, re] of bad) {
    assert.throws(() => parseDictFile(text, kinds), re, text.slice(0, 60));
    const b = fresh();
    b.addTerm('丁谷', 'person');
    // 1つ目は正しく、後ろが壊れていても、途中まで足すことはしない
    assert.throws(() => b.importDict(text), re);
    assert.deepEqual(b.terms().map((t) => t.word), ['丁谷']);
  }
  // 同じ語と種類の重なりは1つにまとめる
  assert.deepEqual(parseDictFile(JSON.stringify({ format: 'mask-dict', version: 1, terms: [{ word: ' 甲野 ', kind: 'person' }, { word: '甲野', kind: 'person' }] }), kinds), [{ word: '甲野', kind: 'person' }]);
});

// 部品を直接動かす小さな画面
function fakeDoc(confirmAnswer = true) {
  const els = {};
  const el = (id) => (els[id] ||= {
    id, value: '', _html: '', _text: '',
    get innerHTML() { return this._html; }, set innerHTML(v) { this._html = String(v); this._text = this._html.replace(/<[^>]+>/g, ''); },
    get textContent() { return this._text; }, set textContent(v) { this._text = String(v ?? ''); this._html = this._text; },
  });
  for (const id of ['dict-word', 'dict-kind', 'dict-status', 'dict-list', 'dict-file-status', 'mask-after', 'mask-review', 'mask-unchecked', 'mask-map']) el(id);
  const downloads = [];
  const doc = {
    getElementById: (id) => els[id] || null, els, downloads,
    body: { appendChild() {} },
    createElement: () => ({ click() { downloads.push({ name: this.download, href: this.href }); }, remove() {} }),
  };
  const win = { confirm: (msg) => { doc.confirmed = msg; return confirmAnswer; } };
  return { doc, win };
}

test('画面: 書き出すときに「元の名前が入っている」と出し、確かめてから書き出す。読み込みで足した語の一覧が変わる', () => {
  const { doc, win } = fakeDoc(true);
  resetMask(doc);
  assert.equal(exportDictFile(doc, win), false);
  assert.match(doc.els['dict-file-status'].textContent, /書き出す語がまだありません/);
  doc.els['dict-word'].value = '甲野 一郎';
  doc.els['dict-kind'].value = 'person';
  addDictWord(doc);
  assert.equal(exportDictFile(doc, win), true);
  assert.ok(doc.confirmed.includes(DICT_NOTICE));
  assert.equal(doc.downloads.length, 1);
  assert.match(doc.downloads[0].name, /^置き換えの辞書_\d{4}-\d{2}-\d{2}\.json$/);
  assert.ok(doc.els['dict-file-status'].textContent.includes(DICT_NOTICE));
  // やめたら書き出さない
  const n2 = fakeDoc(false);
  assert.equal(exportDictFile(n2.doc, n2.win), false);
  assert.equal(n2.doc.downloads.length, 0);
  assert.match(n2.doc.els['dict-file-status'].textContent, /やめました/);
  // 読み込み
  const text = JSON.stringify({ format: 'mask-dict', version: 1, terms: [{ word: '乙山 二郎', kind: 'person' }] });
  assert.equal(importDictFile(doc, text), true);
  assert.match(doc.els['dict-list'].innerHTML, /甲野 一郎/);
  assert.match(doc.els['dict-list'].innerHTML, /乙山 二郎/);
  assert.match(doc.els['dict-file-status'].textContent, /新しく足した語 1/);
  // 壊れたファイルは理由を出し、一覧はそのまま
  const before = doc.els['dict-list'].innerHTML;
  assert.equal(importDictFile(doc, '{'), false);
  assert.match(doc.els['dict-file-status'].textContent, /読み込めませんでした: .*JSON.*今の辞書はそのままです/);
  assert.equal(doc.els['dict-list'].innerHTML, before);
  resetMask(doc);
});

test('index.html: 書き出し・読み込みのボタンと注意の文があり、ブラウザに保存する仕組みを使わない', () => {
  const html = indexHtml();
  const body = withoutScripts(html);
  assert.ok(hasId(body, 'dict-export') && hasId(body, 'dict-import') && hasId(body, 'dict-file-status'));
  assert.equal(labelFor(body, 'dict-import'), '辞書を読み込む');
  assert.match(body, /id="dict-file-note"[^>]*>[^<]*ブラウザには保存しません[^<]*元の名前が入っています/);
  assert.ok(html.includes(DICT_NOTICE), '書き出すときの注意の文が bundle に無い');
  assert.ok(!/localStorage|sessionStorage|indexedDB/.test(html));
});

// 確信の弱い語の強調と、1件ずつ「置き換える」「残す」(F17c、src/ui/mask-app.mjs)の構造の試験。人名・現場名・会社名はすべて架空
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { indexHtml, runPage, withoutScripts } from '../acceptance/_helpers.mjs';
import {
  runMask, decideMask, resetMask, importMaskMap, addDictWord, startMask, maskedText,
  renderAfter, renderReview, weakEntries, UNCHECKED_NOTICE,
} from '../../src/ui/mask-app.mjs';

const TEXT = '工事名: みほん市道 架空3号線 道路改良工事\n現場代理人 乙山 二郎、甲山建設株式会社。乙山 二郎が確かめる。';

// 部品を直接動かすための小さな画面(getElementById・value・textContent・innerHTML・hidden・addEventListener だけ)
function fakeDoc() {
  const els = {};
  const el = (id) => (els[id] ||= {
    id, value: '', hidden: false, _html: '', _text: '', handlers: {},
    get innerHTML() { return this._html; }, set innerHTML(v) { this._html = String(v); this._text = this._html.replace(/<[^>]+>/g, ''); },
    get textContent() { return this._text; }, set textContent(v) { this._text = String(v ?? ''); this._html = this._text; },
    addEventListener(type, f) { this.handlers[type] = f; },
  });
  for (const id of ['mask-input', 'mask-amounts', 'mask-thresholds', 'mask-before', 'mask-after', 'mask-map', 'mask-review', 'mask-unchecked', 'mask-status', 'unmask-output', 'map-status', 'dict-word', 'dict-kind', 'dict-status', 'dict-list']) el(id);
  return { getElementById: (id) => els[id] || null, els, defaultView: null };
}
const marks = (html) => [...html.matchAll(/<mark class="mask-weak mask-(\w+)"[^>]*>([^<]*)<\/mark>/g)].map((m) => [m[1], m[2]]);

test('画面の形: 後の欄の下に選ぶ表の枠、「元に戻す」の欄の上に「未確認の語があります」の欄(最初は隠す)', () => {
  const html = indexHtml();
  const body = withoutScripts(html);
  const iAfter = body.indexOf('id="mask-after"');
  const iReview = body.indexOf('id="mask-review"');
  const iWarn = body.indexOf('id="mask-unchecked"');
  const iUnmask = body.indexOf('<h2 id="unmask-title" tabindex="-1">元に戻す</h2>'); // F86i: ページの見出しにした
  assert.ok(iAfter > 0 && iAfter < iReview && iReview < iWarn && iWarn < iUnmask, '並びが違う');
  assert.match(body, /<p class="note" id="mask-unchecked" role="status" hidden><\/p>/);
  // 目立つ枠は増やさない(.disclaimer は使わない)。印の色は CSS にある
  assert.ok(/mark\.mask-weak\s*\{/.test(html) && /mark\.mask-unchecked\s*\{/.test(html));
});

test('画面を動かす: 規則だけで見つけた語に印が付き、辞書・形で見つけた語には付かない。未確認の知らせが出る', async () => {
  const page = runPage();
  await page.set('mask-input', TEXT);
  await page.click('mask-run');
  const after = page.el('mask-after').innerHTML;
  const ms = marks(after);
  assert.deepEqual(ms.map((m) => m[0]), ['unchecked', 'unchecked', 'unchecked'], after);
  assert.deepEqual(ms.map((m) => m[1]), ['〔現場名1〕', '〔人名1〕', '〔人名1〕']);
  assert.ok(after.includes('〔会社名1〕') && !/<mark[^>]*>〔会社名1〕/.test(after), '会社名(形で見つけた語)に印が付いた');
  for (const w of ['乙山 二郎', '道路改良工事', '甲山建設株式会社']) assert.ok(!page.text('mask-after').includes(w), '後の欄に残る: ' + w);
  assert.ok(page.text('mask-unchecked').includes(UNCHECKED_NOTICE + '(2 件)'));
  assert.equal(page.el('mask-unchecked').hidden, false);
  const rv = page.el('mask-review').innerHTML;
  assert.equal((rv.match(/data-mask-decide="replace"/g) || []).length, 2);
  assert.equal((rv.match(/data-mask-decide="keep"/g) || []).length, 2);
  assert.equal((rv.match(/<td>未確認<\/td>/g) || []).length, 2);
  assert.ok(rv.includes('役職の後ろ') && rv.includes('欄名の後ろの、語尾で終わる値'), '見つけ方が出ない');
  assert.ok(rv.includes('class="table-scroll"'), '表が枠に入っていない');
});

test('1件ずつ選ぶ: 「残す」は後の欄で元の語に戻し、「置き換える」は記号のまま。すべて選ぶと知らせが消える', () => {
  const doc = fakeDoc();
  resetMask(doc);
  doc.els['mask-input'].value = TEXT;
  runMask(doc);
  assert.equal(doc.els['mask-unchecked'].hidden, false);
  assert.equal(decideMask(doc, '〔人名1〕', 'keep'), true);
  let after = doc.els['mask-after'].innerHTML;
  assert.deepEqual(marks(after).map((m) => m.join(':')), ['unchecked:〔現場名1〕', 'keep:乙山 二郎', 'keep:乙山 二郎']);
  assert.ok(maskedText().includes('現場代理人 乙山 二郎') && maskedText().includes('〔現場名1〕') && !maskedText().includes('<mark'));
  assert.ok(doc.els['mask-unchecked'].textContent.includes(UNCHECKED_NOTICE + '(1 件)'));
  assert.ok(doc.els['mask-review'].innerHTML.includes('<td>残す</td>'));
  assert.ok(doc.els['mask-review'].innerHTML.includes('data-mask-decide="keep" data-token="〔人名1〕" aria-pressed="true"'));
  assert.equal(decideMask(doc, '〔現場名1〕', 'replace'), true);
  assert.equal(doc.els['mask-unchecked'].hidden, true);
  assert.equal(doc.els['mask-unchecked'].textContent, '');
  assert.ok(maskedText().includes('工事名: 〔現場名1〕'));
  // 選び直せる
  decideMask(doc, '〔人名1〕', 'replace');
  assert.ok(!maskedText().includes('乙山'));
  // 知らない記号・知らない選びは受けない
  assert.equal(decideMask(doc, '〔会社名1〕', 'keep'), false);
  assert.equal(decideMask(doc, '〔人名1〕', 'maybe'), false);
});

test('同じ文で置き換え直すと選びは残る。消す・対応表を読み込むと選びも消える', () => {
  const doc = fakeDoc();
  resetMask(doc);
  doc.els['mask-input'].value = TEXT;
  runMask(doc);
  decideMask(doc, '〔人名1〕', 'keep');
  runMask(doc);
  assert.ok(maskedText().includes('乙山 二郎'), '置き換え直したら選びが消えた');
  resetMask(doc);
  assert.equal(doc.els['mask-review'].innerHTML, '');
  assert.equal(doc.els['mask-unchecked'].hidden, true);
  runMask(doc);
  assert.ok(!maskedText().includes('乙山 二郎'), '消したのに選びが残った');
  assert.equal(doc.els['mask-unchecked'].hidden, false);
  decideMask(doc, '〔人名1〕', 'keep');
  const file = JSON.stringify({ format: 'mask-map', version: 1, entries: [{ token: '〔人名1〕', original: '乙山 二郎', kind: 'person' }], terms: [] });
  assert.equal(importMaskMap(doc, file), true);
  assert.equal(doc.els['mask-after'].textContent, '');
  assert.equal(doc.els['mask-unchecked'].hidden, true);
  runMask(doc);
  assert.ok(!maskedText().includes('乙山 二郎'), '読み込んだあとに前の選びが残った');
});

test('辞書に足した語は確信の弱い語にしない(印も選ぶ行も出ない)', () => {
  const doc = fakeDoc();
  resetMask(doc);
  doc.els['dict-word'].value = '乙山 二郎';
  doc.els['dict-kind'].value = 'person';
  addDictWord(doc);
  doc.els['mask-input'].value = TEXT;
  runMask(doc);
  const ms = marks(doc.els['mask-after'].innerHTML);
  assert.deepEqual(ms.map((m) => m[1]), ['〔現場名1〕']);
  assert.ok(!doc.els['mask-review'].innerHTML.includes('乙山'));
  assert.ok(doc.els['mask-unchecked'].textContent.includes('(1 件)'));
  resetMask(doc);
});

test('選ぶ表のボタンは表の枠で受ける(描き直しても動く)', () => {
  const doc = fakeDoc();
  resetMask(doc);
  startMask(doc);
  doc.els['mask-input'].value = TEXT;
  runMask(doc);
  const btn = { getAttribute: (k) => ({ 'data-token': '〔現場名1〕', 'data-mask-decide': 'keep' })[k] };
  doc.els['mask-review'].handlers.click({ target: { closest: (sel) => (sel === 'button[data-mask-decide]' ? btn : null) }, preventDefault() {} });
  assert.ok(maskedText().includes('みほん市道 架空3号線 道路改良工事'));
  // ボタンの外を押しても何もしない
  doc.els['mask-review'].handlers.click({ target: { closest: () => null } });
  resetMask(doc);
});

test('部品の形: 印の中も外も文字を逃がす。確信の弱い語が無ければ表を出さない', () => {
  const map = [{ token: '〔人名1〕', original: '<b>甲野</b>', label: '人名', kind: 'person', rule: 'honorific' }, { token: '〔会社名1〕', original: 'x', label: '会社名', kind: 'company' }];
  assert.deepEqual(weakEntries(map).map((e) => e.token), ['〔人名1〕']);
  const r = renderAfter('a<i>〔人名1〕様 〔会社名1〕', map, () => 'keep');
  assert.equal(r.text, 'a<i><b>甲野</b>様 〔会社名1〕');
  assert.ok(!r.html.includes('<b>') && !r.html.includes('<i>') && r.html.includes('&lt;b&gt;'));
  assert.equal(renderReview([{ token: '〔会社名1〕', original: 'x', label: '会社名', kind: 'company' }]), '');
  assert.equal(renderAfter('〔会社名1〕', []).html, '〔会社名1〕');
});

test('選びはメモリだけに持つ(ブラウザに保存しない・外へ送らない)', () => {
  const code = fs.readFileSync(new URL('../../src/ui/mask-app.mjs', import.meta.url), 'utf8');
  assert.ok(!/localStorage|sessionStorage|indexedDB|document\.cookie|fetch\(|XMLHttpRequest|WebSocket/.test(code));
});

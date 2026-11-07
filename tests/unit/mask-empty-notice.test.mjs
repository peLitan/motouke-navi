// 文の置き換え A を空のまま「置き換える」で押したときの知らせ(F84b、src/ui/mask-app.mjs)の試験。人名・会社名はすべて架空
import test from 'node:test';
import assert from 'node:assert/strict';
import { runPage } from '../acceptance/_helpers.mjs';
import {
  runMask, decideCandidate, resetMask, maskedText, lastDecoyCheck, lastResidualCheck, MASK_DEFER_CHARS, MASK_RUNNING,
} from '../../src/ui/mask-app.mjs';

const NOTICE = '＊ 置き換える文が空です。';
const TEXT = '現場代理人 乙山 二郎、甲山建設株式会社。乙山 二郎が確かめる。';

// 空のときに残っていてはいけない欄と、そこに出ていた文
const QUIET = ['mask-decoy', 'mask-residual', 'mask-before', 'mask-after', 'mask-map', 'mask-review', 'mask-candidates', 'mask-candidate-status'];
function assertEmptyNotice(page, label) {
  const status = page.el('mask-status');
  assert.equal(status.textContent, NOTICE, label);
  // 入力が空の知らせは失敗の知らせではない(段3 の空の知らせと同じく、失敗の印を付けない)
  assert.equal(status.getAttribute('data-kind'), null, label);
  for (const id of QUIET) assert.equal(page.text(id).trim(), '', label + ': ' + id + ' に文が残る');
  assert.equal(page.el('mask-unchecked').hidden, true, label);
}

test('画面: 空のまま押すと知らせだけが出る。見本の確かめ・残りの点検・対応表の文は出さない', async () => {
  const page = runPage();
  await page.click('mask-run');
  assertEmptyNotice(page, '空');
  const all = QUIET.map((id) => page.text(id)).join(' ');
  for (const w of ['確かめのための見本', '元に戻す前の点検', '置き換えた語はありません', '名前らしい語']) assert.ok(!all.includes(w), '出ている: ' + w);
});

test('画面: 空白・全角の空白・改行だけの文も空として扱う(段3 の台帳と同じ)', async () => {
  for (const blank of [' ', '　', '\n\n', ' 　\r\n\t']) {
    const page = runPage();
    await page.set('mask-input', blank);
    await page.click('mask-run');
    assertEmptyNotice(page, JSON.stringify(blank));
  }
});

test('画面: 文があるときは知らせを出さず、見本の確かめと残りの点検を出す', async () => {
  const page = runPage();
  await page.set('mask-input', TEXT);
  await page.click('mask-run');
  assert.equal(page.el('mask-status').textContent, '');
  assert.ok(page.text('mask-decoy').includes('確かめのための見本'));
  assert.ok(page.text('mask-residual').includes('元に戻す前の点検'));
  assert.ok(page.text('mask-after').includes('〔人名1〕'));
});

test('画面: 結果が出たあとに空で押すと前の結果を消す。対応表は残り「元に戻す」は使える。文を入れ直せば知らせは消える', async () => {
  const page = runPage();
  await page.set('mask-input', TEXT);
  await page.click('mask-run');
  assert.ok(page.text('mask-review').includes('確かめてほしい語'), '前提: 選ぶ表が出ている');
  assert.equal(page.el('mask-unchecked').hidden, false, '前提: 未確認の知らせが出ている');

  await page.set('mask-input', '');
  await page.click('mask-run');
  assertEmptyNotice(page, '前の結果の後');

  await page.set('unmask-input', '〔人名1〕');
  await page.click('unmask-run');
  assert.equal(page.el('unmask-output').textContent, '乙山 二郎');

  await page.set('mask-input', TEXT);
  await page.click('mask-run');
  assert.equal(page.el('mask-status').textContent, '');
  assert.ok(page.text('mask-decoy').includes('確かめのための見本'));
  assert.ok(page.text('mask-residual').includes('元に戻す前の点検'));
  assert.ok(page.text('mask-after').includes('〔人名1〕'), '記号が変わった');
});

test('画面: 金額を「境目」の形にしていても、空のときは境目の知らせを足さない', async () => {
  const page = runPage();
  await page.set('mask-amounts', 'band');
  await page.set('mask-thresholds', 'みほん');
  await page.click('mask-run');
  assertEmptyNotice(page, '境目');
});

// 長い文の道は setTimeout を通るので、本物の時計で動かす(runPage の setTimeout はすぐ走る)
function fakeDoc() {
  const els = {};
  const el = (id) => (els[id] ||= {
    id, value: '', hidden: false, _html: '', _text: '', attrs: {},
    get innerHTML() { return this._html; }, set innerHTML(v) { this._html = String(v); this._text = this._html.replace(/<[^>]+>/g, ''); },
    get textContent() { return this._text; }, set textContent(v) { this._text = String(v ?? ''); this._html = this._text; },
    setAttribute(k, v) { this.attrs[k] = String(v); }, removeAttribute(k) { delete this.attrs[k]; },
  });
  return { getElementById: el, els, defaultView: null };
}

test('長い文の道: 空白だけの長い文でも「置き換えています…」のあとに知らせを出し、作業中の印を外す', async () => {
  const doc = fakeDoc();
  resetMask(doc);
  doc.getElementById('mask-input').value = '　'.repeat(MASK_DEFER_CHARS + 1);
  const later = runMask(doc);
  assert.ok(later, '長い文の道を通っていない');
  assert.equal(doc.getElementById('mask-status').textContent, MASK_RUNNING);
  await later;
  assert.equal(doc.getElementById('mask-status').textContent, NOTICE);
  assert.equal(doc.getElementById('mask-status').attrs['aria-busy'], undefined);
  assert.equal(doc.getElementById('mask-decoy').textContent, '');
});

test('長い文の道: 待つ間に欄を空にしても、古い結果を書かず知らせを出す', async () => {
  const doc = fakeDoc();
  resetMask(doc);
  const input = doc.getElementById('mask-input');
  input.value = 'あ'.repeat(MASK_DEFER_CHARS + 1);
  const later = runMask(doc);
  input.value = '';
  await later;
  assert.equal(doc.getElementById('mask-status').textContent, NOTICE);
  assert.equal(doc.getElementById('mask-after').textContent, '');
  assert.equal(doc.getElementById('mask-decoy').textContent, '');
});

test('空で押すと、外へ貼る文と見本・残りの点検の結果も持たない。候補の知らせも消す', () => {
  const doc = fakeDoc();
  resetMask(doc);
  const input = doc.getElementById('mask-input');
  input.value = TEXT + '\n| 商号 | みほんリペア |\n';
  runMask(doc);
  assert.ok(maskedText().includes('〔人名1〕') && lastDecoyCheck() && lastResidualCheck(), '前提: 結果がある');
  assert.equal(decideCandidate(doc, 'みほんリペア', 'skip'), true);
  assert.ok(doc.getElementById('mask-candidate-status').textContent.includes('足しません'), '前提: 候補の知らせが出ている');

  input.value = '';
  runMask(doc);
  assert.equal(maskedText(), '');
  assert.equal(lastDecoyCheck(), null);
  assert.equal(lastResidualCheck(), null);
  assert.equal(doc.getElementById('mask-candidate-status').textContent, '');
});

test('候補: 欄を空にしてから「辞書に足す」を押すと、語は足すが「置き換え直しました」とは言わない', () => {
  const doc = fakeDoc();
  resetMask(doc);
  const text = '| 商号 | みほんリペア |\n';
  const input = doc.getElementById('mask-input');
  input.value = text;
  runMask(doc);
  assert.ok(doc.getElementById('mask-candidates').innerHTML.includes('data-word="みほんリペア"'), '前提: 候補に出ている');

  input.value = '';
  assert.equal(decideCandidate(doc, 'みほんリペア', 'add'), true);
  assert.equal(doc.getElementById('mask-status').textContent, NOTICE);
  const said = doc.getElementById('mask-candidate-status').textContent;
  assert.ok(said.includes('「みほんリペア」を') && said.includes('足しました'), said);
  assert.ok(!said.includes('置き換え直しました'), said);
  assert.ok(doc.getElementById('dict-list').innerHTML.includes('みほんリペア'));

  input.value = text;
  runMask(doc);
  assert.ok(!doc.getElementById('mask-after').textContent.includes('みほんリペア'), '足した語が次の置き換えで使われていない');
});

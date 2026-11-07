// 文の置き換え A の上限は1行の長さで掛ける(F85f、src/ui/mask-app.mjs)の試験。人名・会社名はすべて架空
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { runPage } from '../acceptance/_helpers.mjs';
import {
  MASK_MAX_LINE_CHARS, longestLineChars, runMask, resetMask, maskedText, lastDecoyCheck, lastResidualCheck, MASK_DEFER_CHARS, MASK_RUNNING,
} from '../../src/ui/mask-app.mjs';

const TEXT = '現場代理人 乙山 二郎、甲山建設株式会社。乙山 二郎が確かめる。';
const notice = (n) => '1行が長すぎます(いちばん長い行 ' + n + '字。1行 150,000字まで)。改行を入れて分けてください。名前が区切りをまたぐと置き換わらないことがあるので、区切りは段落の境目にしてください。';
const TOO_LONG = 'あ'.repeat(150001);

// 断ったときに残っていてはいけない欄
const QUIET = ['mask-decoy', 'mask-residual', 'mask-before', 'mask-after', 'mask-map', 'mask-review', 'mask-candidates', 'mask-candidate-status'];
function assertRefused(page, n, label) {
  const status = page.el('mask-status');
  assert.equal(status.textContent, notice(n), label);
  assert.equal(status.getAttribute('data-kind'), 'error', label + ': 失敗の印が無い');
  for (const id of QUIET) assert.equal(page.text(id).trim(), '', label + ': ' + id + ' に文が残る');
  assert.equal(page.el('mask-unchecked').hidden, true, label);
}

test('上限は 150,000字', () => {
  assert.equal(MASK_MAX_LINE_CHARS, 150000);
});

test('いちばん長い行の字数: 250万字・70,000行の文で 191 を返し、上限の内なので断らない形である', () => {
  const short = 'か'.repeat(35);
  const lines = Array.from({ length: 70000 }, (_, i) => (i === 41234 ? 'き'.repeat(191) : short));
  const text = lines.join('\n');
  assert.ok(text.length >= 2500000, '前提: 250万字ある ' + text.length);
  assert.equal(lines.length, 70000);
  assert.equal(longestLineChars(text), 191);
  assert.ok(longestLineChars(text) <= MASK_MAX_LINE_CHARS);
});

test('いちばん長い行の字数: 改行は \\n と \\r\\n の両方で数え、\\r は字に数えない', () => {
  assert.equal(longestLineChars('あい\nあいう\nあ'), 3);
  assert.equal(longestLineChars('あい\r\nあいう\r\nあ'), 3);
  assert.equal(longestLineChars('あいう\r\n'), 3);
  assert.equal(longestLineChars('あ\nあいう\r\nあい'), 3);
  assert.equal(longestLineChars('\r\n\r\n'), 0);
  assert.equal(longestLineChars(''), 0);
  assert.equal(longestLineChars('あいうえお'), 5, '改行の無い文は全体が1行');
  // 行の数が多くても動く(引数に広げると落ちる数)
  assert.equal(longestLineChars('あ\n'.repeat(1000000)), 1);
});

test('画面: 1行 150,001字は置き換えず、知らせと失敗の印を出す。後の欄・見本の確かめ・残りの点検は出さない', async () => {
  const page = runPage();
  await page.set('mask-input', TOO_LONG);
  await page.click('mask-run');
  assertRefused(page, '150,001', '150,001字');
});

test('画面: 1行 150,000字ちょうどは断らない(\\r\\n の \\r を字に数えない)', async () => {
  const page = runPage();
  await page.set('mask-input', 'あ'.repeat(150000) + '\r\n' + TEXT);
  await page.click('mask-run');
  assert.equal(page.el('mask-status').getAttribute('data-kind'), null);
  assert.ok(!page.el('mask-status').textContent.includes('長すぎます'));
  assert.ok(page.text('mask-after').includes('〔人名1〕'));
});

test('画面: 上限は全体の字数ではなく1行で見る。長い行が途中にあっても断り、\\r\\n の文でも同じ', async () => {
  const page = runPage();
  await page.set('mask-input', TEXT + '\r\n' + TOO_LONG + '\r\n' + TEXT);
  await page.click('mask-run');
  assertRefused(page, '150,001', '途中の行');
  assert.ok(!page.text('mask-status').includes('乙山'), '知らせに文の中身を出している');
});

test('画面: 全体が上限より長くても、どの行も短ければ断らない', async () => {
  const page = runPage();
  const line = TEXT + 'さ'.repeat(200);
  const text = Array.from({ length: Math.ceil((MASK_MAX_LINE_CHARS + 1) / line.length) + 1 }, () => line).join('\n');
  assert.ok(text.length > MASK_MAX_LINE_CHARS, '前提: 全体は上限より長い');
  await page.set('mask-input', text);
  await page.click('mask-run');
  assert.equal(page.el('mask-status').textContent, '');
  assert.equal(page.el('mask-status').getAttribute('data-kind'), null);
  assert.ok(page.text('mask-after').includes('〔人名1〕'));
});

test('画面: 前の結果を消す。対応表は残り「元に戻す」は使える。足した語も残る', async () => {
  const page = runPage();
  await page.set('dict-word', '丙川 三郎');
  await page.click('dict-add');
  await page.set('mask-input', TEXT + '丙川 三郎');
  await page.click('mask-run');
  assert.ok(page.text('mask-review').includes('確かめてほしい語'), '前提: 選ぶ表が出ている');
  assert.ok(page.text('mask-after').includes('〔人名1〕'), '前提: 結果が出ている');

  await page.set('mask-input', TOO_LONG);
  await page.click('mask-run');
  assertRefused(page, '150,001', '前の結果の後');

  await page.set('unmask-input', '〔人名1〕');
  await page.click('unmask-run');
  assert.equal(page.el('unmask-output').textContent, '乙山 二郎');
  assert.ok(page.text('dict-list').includes('丙川 三郎'), '足した語が消えた');

  // 文を直して押すと、知らせも印も消え、同じ記号で置き換わる
  await page.set('mask-input', TEXT + '丙川 三郎');
  await page.click('mask-run');
  const status = page.el('mask-status');
  assert.equal(status.textContent, '');
  assert.equal(status.getAttribute('data-kind'), null, '失敗の印が成功の後に残る');
  assert.ok(page.text('mask-after').includes('〔人名1〕'), '記号が変わった');
  assert.ok(page.text('mask-decoy').includes('確かめのための見本'));
});

test('画面: 断った後に欄を空にして押すと、空の知らせのままで失敗の印は付かない', async () => {
  const page = runPage();
  await page.set('mask-input', TOO_LONG);
  await page.click('mask-run');
  await page.set('mask-input', '');
  await page.click('mask-run');
  const status = page.el('mask-status');
  assert.equal(status.textContent, '＊ 置き換える文が空です。');
  assert.equal(status.getAttribute('data-kind'), null);
});

test('画面: 空白だけの長い1行は、長さの知らせではなく空の知らせ', async () => {
  const page = runPage();
  await page.set('mask-input', '　'.repeat(MASK_MAX_LINE_CHARS + 1));
  await page.click('mask-run');
  const status = page.el('mask-status');
  assert.equal(status.textContent, '＊ 置き換える文が空です。');
  assert.equal(status.getAttribute('data-kind'), null);
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

test('長い文の道: 「置き換えています…」のあとに断り、作業中の印を外し、外へ貼る文と点検の結果を持たない', async () => {
  const doc = fakeDoc();
  resetMask(doc);
  const input = doc.getElementById('mask-input');
  input.value = TEXT;
  runMask(doc);
  assert.ok(maskedText().includes('〔人名1〕') && lastDecoyCheck() && lastResidualCheck(), '前提: 結果がある');

  input.value = TOO_LONG;
  assert.ok(input.value.length > MASK_DEFER_CHARS);
  const later = runMask(doc);
  assert.ok(later, '長い文の道を通っていない');
  const status = doc.getElementById('mask-status');
  assert.equal(status.textContent, MASK_RUNNING);
  await later;
  assert.equal(status.textContent, notice('150,001'));
  assert.equal(status.attrs['data-kind'], 'error');
  assert.equal(status.attrs['aria-busy'], undefined);
  assert.equal(maskedText(), '');
  assert.equal(lastDecoyCheck(), null);
  assert.equal(lastResidualCheck(), null);
});

test('説明書: 置き換えの節に上限と測りの値があり、測りはほかの Edge が同時に動く中の値だと書く', () => {
  const manual = fs.readFileSync(new URL('../../docs/manual.md', import.meta.url), 'utf8');
  const start = manual.indexOf('## 文の置き換え(外のサービスに貼る前に)');
  assert.ok(start >= 0);
  const section = manual.slice(start, manual.indexOf('\n## ', start + 1));
  for (const w of ['1行 150,000字まで', '15万字', '2.3 秒', '30万字', '22.7 秒', '100万字', '204 秒', '250万字', '191字', '6.2 秒', 'ほかの Edge が同時に動く中']) {
    assert.ok(section.includes(w), '置き換えの節に無い: ' + w);
  }
});

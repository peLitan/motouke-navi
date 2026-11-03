// F28b: 「元に戻す」の前に、対応表の元の語が後の欄に残っていないかを探し直して件数を出す(全角半角・空白の揺れも)。
// 例の名前・会社名はすべて架空
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMasker } from '../../src/mask/core.mjs';
import { CONSTRUCTION_DICT } from '../../src/mask/dict-construction.mjs';
import { findResiduals, residualMessage, normalizeWithMap } from '../../src/mask/residual.mjs';
import { runMask, runUnmask, resetMask, decideMask, lastResidualCheck, weakEntries, maskedText } from '../../src/ui/mask-app.mjs';
import { indexHtml, runPage, withoutScripts } from '../acceptance/_helpers.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const entry = (token, label, original, variants = [original]) => ({ token, label, kind: 'x', original, variants });

test('残りが無いとき: 件数 0 で、残っていないと出す', () => {
  const m = createMasker({ dictionaries: [CONSTRUCTION_DICT] });
  const r = m.mask('担当者: 甲野 太郎\n株式会社ミホン建設に依頼した。\n後日、甲野　太郎が来た。甲野太郎の確認。電話 03-1234-5678、０３－１２３４－５６７８');
  const x = findResiduals(r.masked, m.entries());
  assert.equal(x.count, 0);
  assert.deepEqual(x.items, []);
  assert.equal(x.checked, m.entries().length);
  assert.match(residualMessage(x), /^元に戻す前の点検: 後の欄に、対応表の元の語は残っていません\(対応表の \d+語を/);
  assert.ok(!residualMessage(x).includes('注意'));
});

test('残りがあるとき: 全角・半角、空白、ハイフン、大文字・小文字の違いで残った所を数え、場所と元の語を返す', () => {
  const entries = [
    entry('〔現場名1〕', '現場名', 'ミホン台'),
    entry('〔会社名1〕', '会社名', 'KAKUU'),
    entry('〔人名1〕', '人名', '甲野 太郎', ['甲野 太郎', '甲野太郎']),
    entry('〔電話1〕', '電話', '03-1234-5678'),
  ];
  const text = '現場は〔現場名1〕。ﾐﾎﾝ台の北側。\n〔会社名1〕と協議、ＫＡＫＵＵから回答。kakuu。\n〔人名1〕、甲 野太郎、甲野　太郎。\n電話 ０３ー１２３４ー５６７８';
  const x = findResiduals(text, entries);
  assert.equal(x.count, 6);
  assert.deepEqual(x.items.map((h) => [h.found, h.token]), [
    ['ﾐﾎﾝ台', '〔現場名1〕'], ['ＫＡＫＵＵ', '〔会社名1〕'], ['kakuu', '〔会社名1〕'],
    ['甲 野太郎', '〔人名1〕'], ['甲野　太郎', '〔人名1〕'], ['０３ー１２３４ー５６７８', '〔電話1〕'],
  ]);
  for (const h of x.items) assert.equal(text.slice(h.start, h.end), h.found);
  const msg = residualMessage(x);
  assert.match(msg, /^注意: 元に戻す前の点検で、後の欄に対応表の元の語が 6か所残っていました: 「ﾐﾎﾝ台」\(〔現場名1〕 の元の語「ミホン台」\)/);
  assert.match(msg, /辞書に足して「置き換える」をもう一度押してください/);
});

test('記号の中は探さない・重なる短い語は数えない・1字の語は探さない・長音はカタカナの中ではハイフンにしない', () => {
  // 元の語「人名」が記号〔人名1〕の中にあっても残りにしない
  assert.equal(findResiduals('〔人名1〕が来た', [entry('〔その他1〕', 'その他', '人名')]).count, 0);
  // 「甲野建設」と「甲野」が重なるときは長い方だけ
  const x = findResiduals('甲野建設の甲野', [entry('〔人名1〕', '人名', '甲野'), entry('〔会社名1〕', '会社名', '甲野建設')]);
  assert.deepEqual(x.items.map((h) => h.found), ['甲野建設', '甲野']);
  assert.deepEqual(x.items.map((h) => h.token), ['〔会社名1〕', '〔人名1〕']);
  // 1字の語
  const one = findResiduals('乙が来た', [entry('〔人名1〕', '人名', '乙')]);
  assert.equal(one.count, 0);
  assert.deepEqual(one.skipped, ['〔人名1〕']);
  assert.match(residualMessage(one), /1字の語 1語は探していません/);
  // カタカナの長音はハイフンと同じにしない(「ミーホ」は「ミ-ホ」に当たらない)
  assert.equal(findResiduals('ミ-ホ', [entry('〔会社名1〕', '会社名', 'ミーホ')]).count, 0);
  assert.equal(normalizeWithMap('1ー2').norm, '1-2');
  // 残っていても、わざと残した語(skipTokens)は数えない
  const k = findResiduals('甲野が来た', [entry('〔人名1〕', '人名', '甲野')], { skipTokens: ['〔人名1〕'] });
  assert.equal(k.count, 0);
  assert.equal(k.kept, 1);
});

test('対応表を変えない・後の欄の文を変えない(探すだけ)', () => {
  const m = createMasker({ dictionaries: [CONSTRUCTION_DICT] });
  m.addTerm('ミホン台', 'site');
  const r = m.mask('現場はミホン台。ﾐﾎﾝ台の北側。');
  const before = JSON.stringify(m.entries());
  const masked = r.masked;
  const x = findResiduals(r.masked, m.entries());
  assert.equal(x.count, 1);
  assert.equal(JSON.stringify(m.entries()), before);
  assert.equal(r.masked, masked);
});

function fakeDoc(input) {
  const els = {};
  const el = (id) => (els[id] ||= {
    id, value: '', hidden: false, _html: '', _text: '', handlers: {},
    get innerHTML() { return this._html; }, set innerHTML(v) { this._html = String(v); this._text = this._html.replace(/<[^>]+>/g, ''); },
    get textContent() { return this._text; }, set textContent(v) { this._text = String(v ?? ''); this._html = this._text; },
    addEventListener(type, f) { this.handlers[type] = f; },
  });
  for (const id of ['mask-input', 'mask-amounts', 'mask-thresholds', 'mask-before', 'mask-after', 'mask-map', 'mask-review', 'mask-unchecked', 'mask-status', 'mask-decoy', 'mask-residual', 'unmask-input', 'unmask-output', 'map-status', 'dict-word', 'dict-kind', 'dict-status', 'dict-list', 'dict-file-status']) el(id);
  els['mask-input'].value = input;
  els['mask-amounts'].value = 'keep';
  return { getElementById: (id) => els[id] || null, els, defaultView: null };
}

test('画面の部品: 置き換えるたび・「元に戻す」を押すたびに件数を出し、前の文の名前が次の文に残れば数える', () => {
  const doc = fakeDoc('担当者: 甲野 太郎\n株式会社ミホン建設に依頼した。');
  resetMask(doc);
  runMask(doc);
  assert.equal(lastResidualCheck().count, 0);
  assert.match(doc.els['mask-residual'].textContent, /^元に戻す前の点検: 後の欄に、対応表の元の語は残っていません/);
  // 同じ対応表のまま、文脈の無い書き方で同じ名前が出る次の文(対応表には前の文の語が残っている)
  doc.els['mask-input'].value = '打合せの記録。甲野太郎の件。';
  runMask(doc);
  const r = lastResidualCheck();
  assert.ok(r.items.some((h) => h.found === '甲野太郎' && h.original === '甲野 太郎'), JSON.stringify(r.items));
  assert.equal(doc.els['mask-residual'].textContent, residualMessage(r));
  assert.match(doc.els['mask-residual'].textContent, /^注意: 元に戻す前の点検で、後の欄に対応表の元の語が \d+か所残っていました/);
  // 「元に戻す」を押しても同じ点検を出し直す。戻した結果は今までどおり
  doc.els['mask-residual'].textContent = '';
  doc.els['unmask-input'].value = '〔人名1〕に連絡';
  runUnmask(doc);
  assert.equal(doc.els['unmask-output'].textContent, '甲野 太郎に連絡');
  assert.equal(doc.els['mask-residual'].textContent, residualMessage(r));
  resetMask(doc);
  assert.equal(doc.els['mask-residual'].textContent, '');
});

test('画面の部品: 確かめてほしい語で「残す」を選んだ語は数えない', () => {
  // 規則(役職の後ろ)で見つけた語は、確かめてほしい語になる
  const doc = fakeDoc('工事名: みほん市道 架空3号線 道路改良工事\n現場代理人 乙山 二郎、甲山建設株式会社。乙山 二郎が確かめる。');
  resetMask(doc);
  runMask(doc);
  assert.equal(lastResidualCheck().count, 0);
  assert.ok(decideMask(doc, '〔人名1〕', 'keep'));
  // 後の欄には元の語が出るが、わざと残したので残りに数えない
  assert.ok(maskedText().includes('乙山 二郎'));
  assert.equal(lastResidualCheck().count, 0);
  assert.equal(lastResidualCheck().kept, 1);
  assert.match(doc.els['mask-residual'].textContent, /「残す」を選んだ 1語は数えていません/);
  // 「置き換える」に戻すと、また数える対象になる(後の欄には記号だけ)
  assert.ok(decideMask(doc, '〔人名1〕', 'replace'));
  assert.equal(lastResidualCheck().kept, 0);
  assert.equal(lastResidualCheck().count, 0);
  resetMask(doc);
});

test('画面(index.html): 見本の結果の下に点検の欄があり、置き換えると件数が出る', async () => {
  const body = withoutScripts(indexHtml());
  const iDecoy = body.indexOf('id="mask-decoy"');
  const iRes = body.indexOf('id="mask-residual"');
  const iAfter = body.indexOf('id="mask-after"');
  assert.ok(iDecoy > 0 && iDecoy < iRes && iRes < iAfter, '並びが違う');
  const page = runPage();
  await page.set('mask-input', '担当者: 甲野 太郎\n株式会社ミホン建設に依頼した。');
  await page.click('mask-run');
  assert.match(page.text('mask-residual'), /^元に戻す前の点検: 後の欄に、対応表の元の語は残っていません/);
  await page.set('mask-input', '甲野太郎の件。');
  await page.click('mask-run');
  assert.match(page.text('mask-residual'), /^注意: 元に戻す前の点検で、後の欄に対応表の元の語が 1か所残っていました: 「甲野太郎」/);
});

test('residual.mjs は外部と通信せず、保存もしない', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src', 'mask', 'residual.mjs'), 'utf8');
  for (const w of ['fetch(', 'XMLHttpRequest', 'localStorage', 'import(', 'node:fs', 'WebSocket']) assert.ok(!src.includes(w), w);
});

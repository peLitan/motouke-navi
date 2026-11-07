// F85h: 段3 の注意は、候補があるときは候補の後ろで閉じ、候補が無いときは先頭で開いたまま。空の知らせは1か所にする
// この環境にはブラウザが無いので、高さは測れない。組み立てた文の順・open の有無・知らせの枠の中身で確かめる。値はすべて架空
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHtml } from '../../build.mjs';
import { renderCheckResult, renderEmptyInput } from '../../src/ui/view.mjs';
import { openDetailsForPrint, restoreDetailsAfterPrint } from '../../src/ui/app.mjs';
import { runPage } from '../acceptance/_helpers.mjs';

const CAND = { target: '架空三工業株式会社', field: 'estimateOk', message: '架空の候補の文', basis: [] };
const UND = { target: '架空一建設株式会社', field: 'subcontractTotal', message: '架空の判断できない文' };
const WARN = ['架空の読めなかった行', '架空の読めなかった金額'];
const NOTES = ['架空の点検の注意'];

const plain = (s) => String(s).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const count = (text, word) => text.split(word).length - 1;
const detailsOf = (html, cls) => {
  const m = html.match(new RegExp('<details class="' + cls + '"[^>]*>[\\s\\S]*?</details>'));
  assert.ok(m, cls + ' の details が無い');
  return m[0];
};
const isOpen = (block) => /^<details\b[^>]*\sopen\b/.test(block);

test('候補あり: 候補の見出しが注意より前で、注意は閉じた details に件数がある', () => {
  const html = renderCheckResult({ candidates: [CAND], undecidable: [UND], notes: NOTES }, WARN);
  const warn = detailsOf(html, 'warnings');
  assert.equal(isOpen(warn), false, '候補があるのに注意が開いている');
  assert.ok(warn.includes('<summary>台帳の文を読んだときの注意(2件)</summary>'), warn);
  for (const w of WARN) assert.ok(warn.includes(w), w);
  const at = ['抜け・食い違いの候補(1件)', '判断できない(1件)', '台帳の文を読んだときの注意(2件)', '点検の注意(1件)', 'class="human"'].map((w) => html.indexOf(w));
  assert.ok(at.every((n) => n >= 0), String(at));
  assert.deepEqual(at, [...at].sort((a, b) => a - b), '候補・判断できない・注意・点検の注意・最後の断り の順でない: ' + at);
});

test('候補あり: out.notes は閉じた details「点検の注意(n件)」に入る', () => {
  const html = renderCheckResult({ candidates: [CAND], undecidable: [], notes: [...NOTES, '架空の2つ目'] });
  const notes = detailsOf(html, 'notes');
  assert.equal(isOpen(notes), false, 'out.notes が開いている');
  assert.ok(notes.includes('<summary>点検の注意(2件)</summary>'), notes);
  for (const n of [...NOTES, '架空の2つ目']) assert.ok(notes.includes('<li>' + n + '</li>'), n);
  assert.doesNotMatch(html, /<ul class="notes">/, '開いたままの out.notes の並びが残っている');
});

test('候補あり: 注意も out.notes も無ければ、空の details を出さない', () => {
  const html = renderCheckResult({ candidates: [CAND], undecidable: [], notes: [] });
  assert.doesNotMatch(html, /<details class="(warnings|notes)"/);
  assert.ok(!html.includes('点検の注意') && !html.includes('台帳の文を読んだときの注意'));
});

test('候補 0 件: 注意が先頭で開いたまま、out.notes も今の形のまま(判断できないだけの結果も同じ)', () => {
  for (const und of [[], [UND]]) {
    const html = renderCheckResult({ candidates: [], undecidable: und, notes: NOTES }, WARN);
    assert.ok(html.startsWith('<details class="warnings" open><summary>台帳の文を読んだときの注意(2件)</summary>'), html.slice(0, 80));
    assert.ok(html.indexOf('台帳の文を読んだときの注意') < html.indexOf('抜け・食い違いの候補'));
    assert.ok(html.includes('<ul class="notes"><li>架空の点検の注意</li></ul>'), 'out.notes の形が変わった');
    assert.ok(!html.includes('点検の注意('), '候補 0 件で out.notes を畳んでいる');
  }
});

test('紙で開く: 候補ありの閉じた details は、全部の印刷で開いて本文が紙に残り、終われば閉じる', () => {
  const html = renderCheckResult({ candidates: [CAND], undecidable: [UND], notes: NOTES }, WARN);
  const tags = [...html.matchAll(/<details\b[^>]*>/g)].map((m) => m[0]);
  const closed = tags.filter((t) => /class="(warnings|notes)"/.test(t));
  assert.equal(closed.length, 2, tags.join(' '));
  // 紙で summary ごと隠す class(fold)と、紙に出さない class(no-print)を付けない
  for (const t of closed) assert.doesNotMatch(t, /\b(fold|no-print)\b/, t);
  const list = tags.map((t) => ({ open: /\sopen\b/.test(t) }));
  assert.ok(list.some((d) => !d.open));
  openDetailsForPrint({ querySelectorAll: (sel) => (sel === 'details' ? list : []) });
  assert.ok(list.every((d) => d.open), '紙で開かない details がある');
  restoreDetailsAfterPrint();
  assert.equal(list.filter((d, i) => d.open !== /\sopen\b/.test(tags[i])).length, 0, '印刷の後に元へ戻らない');
  const css = buildHtml();
  const style = css.slice(css.indexOf('<style'), css.indexOf('</style>'));
  assert.doesNotMatch(style, /details\.(warnings|notes)[^{]*\{[^}]*display:\s*none/, '注意の details を紙で隠している');
});

test('空の結果: 失敗の線が無く、同じ文が2か所に無い(台帳)', async () => {
  const page = runPage(buildHtml());
  await page.set('ledger-input', '');
  await page.click('ledger-run');
  const box = page.el('check-result').innerHTML;
  const status = page.el('check-status').textContent;
  assert.equal(status, '＊ 台帳の文が空です。');
  assert.equal(plain(box), '台帳を貼るか、入口の「まず見本で試す」を押してください。');
  assert.doesNotMatch(box, /class="errors"|fail-head/, '空なのに失敗の線が付いている');
  assert.equal(count(status + box, '台帳の文が空です'), 1, '同じ文が2か所にある');
});

test('空の結果: 失敗の線が無く、同じ文が2か所に無い(目次)', async () => {
  const page = runPage(buildHtml());
  await page.set('plan-input', '');
  await page.click('plan-run');
  const box = page.el('plan-result').innerHTML;
  const status = page.el('plan-status').textContent;
  assert.equal(status, '＊ 目次が空です。');
  assert.equal(plain(box), '施工計画書の目次を貼るか、入口の「まず見本で試す」を押してください。');
  assert.doesNotMatch(box, /class="errors"|fail-head/, '空なのに失敗の線が付いている');
  assert.equal(count(status + box, '目次が空です'), 1, '同じ文が2か所にある');
});

test('renderEmptyInput は文を写すだけで、失敗の枠を持たない', () => {
  assert.equal(renderEmptyInput('架空の次の手の<文>'), '<p>架空の次の手の&lt;文&gt;</p>');
});

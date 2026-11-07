// F37b: 説明を折りたたみへ移した。最初の画面の折りたたみの外の文字を 450字以内に抑え、畳んではいけない表示は外に残す
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildHtml } from '../../build.mjs';
import { loadRulesFile, clearRulesTable } from '../../src/ui/app.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const html = buildHtml();
const body = html.slice(html.indexOf('<body>')).replace(/<script\b[\s\S]*?<\/script>/g, '');

// details の中身を除く(summary は見えるので残す)。入れ子も数える
function outsideFolds(h) {
  let out = '';
  let depth = 0;
  let summaryDepth = 0;
  for (const part of h.split(/(<\/?details\b[^>]*>|<\/?summary\b[^>]*>)/)) {
    if (/^<details\b/.test(part)) depth++;
    else if (part === '</details>') depth--;
    else if (/^<summary\b/.test(part)) summaryDepth = depth;
    else if (part === '</summary>') summaryDepth = 0;
    else if (depth === 0 || (depth === 1 && summaryDepth === 1)) out += part;
  }
  return out;
}
const chars = (h) => h.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/\s/g, '').length;
// その id の開くタグの前で、閉じていない details の id の並び
function foldsAround(id) {
  const at = body.indexOf('id="' + id + '"');
  assert.ok(at >= 0, id + ' が無い');
  const stack = [];
  for (const m of body.slice(0, at).matchAll(/<details\b[^>]*>|<\/details>/g)) {
    if (m[0] === '</details>') stack.pop();
    else stack.push(m[0].match(/id="([^"]+)"/)?.[1] ?? '(id なし)');
  }
  return stack;
}

test('最初の画面(題から、段の前の通信しない表示まで)の折りたたみの外の文字は 450字以内', () => {
  // 短い注意の行(F83a4)は、この画面では隠れているので数えない。本文へ飛ぶリンク(F83a10)も、焦点が来るまで画面の外にあるので数えない
  const first = body.slice(body.indexOf('<body>'), body.indexOf('<section id="panel-1"')).replace(/<details class="notice-more no-print" id="notice-more" hidden>[\s\S]*?<\/details>/, '').replace('<a class="skip-link no-print" href="#main">本文へ飛ぶ</a>', '');
  const n = chars(outsideFolds(first));
  console.log('# 折りたたみの外の文字 ' + n + '字');
  assert.ok(n <= 450, '多い: ' + n + '字');
  assert.ok(n > 100, '数え方が壊れている: ' + n + '字');
});

test('数え方: details の中は数えず、summary は数える(入れ子も)', () => {
  assert.equal(chars(outsideFolds('あ<details id="x"><summary>い</summary>う<details><summary>え</summary>お</details>か</details>き')), 3);
});

test('畳まない: 断り書き・通信しない表示・見ていない法令の1行・入口・出典の表示・取得日は、どの折りたたみの中にも無く、段の中にも無い', () => {
  for (const id of ['disclaimer', 'scope-not-line', 'start', 'sources-dates', 'credits']) assert.deepEqual(foldsAround(id), [], id);
  assert.ok(body.indexOf('この画面は外部と通信しません') < body.indexOf('<section id="panel-1"'));
  assert.ok(outsideFolds(body).includes('この画面は外部と通信しません'));
  const credits = body.slice(body.indexOf('<footer id="credits">'));
  assert.ok(outsideFolds(credits).includes('PDL1.0'));
  assert.ok(outsideFolds(credits).includes('国土交通省が作成したものではない'));
  for (const panel of ['panel-1', 'panel-2', 'panel-3']) {
    const start = body.indexOf('<section id="' + panel + '"');
    assert.ok(body.indexOf('id="disclaimer"') < start);
    assert.ok(body.indexOf('id="credits"') > start);
  }
});

test('畳まない: 国の直轄の例の注記は段の中で見えたまま。A・B の注意は別の道具を開けばすぐ見える', () => {
  for (const id of ['schedule-notice', 'plan-notice']) assert.deepEqual(foldsAround(id), [], id);
  for (const id of ['mask-warning', 'map-warning', 'dict-file-note', 'ai-note']) assert.deepEqual(foldsAround(id), ['other-tools'], id);
});

test('7問と任意の欄の説明: 閉じた折りたたみの中にあり、id と aria-describedby は残り、見出しの読み上げは欄ごとに違う', () => {
  const ids = ['orderer', 'direct', 'work-type', 'contract-amount', 'subcontract-total', 'license', 'engineer-qualification', 'ict-measure'];
  const form = body.match(/<form id="bid-form"[\s\S]*?<\/form>/)[0];
  const labels = new Set();
  for (const id of ids) {
    assert.deepEqual(foldsAround(id + '-hint'), ['(id なし)'], id);
    assert.match(form, new RegExp('aria-describedby="(?:' + id + '-plain )?' + id + '-hint"'), id);
    const m = form.match(new RegExp('<details class="fold hint-fold"><summary aria-label="([^"]+)">(?:説明|くわしく)</summary><p id="' + id + '-hint" class="hint">[^<]+</p></details>'));
    assert.ok(m, id + ' の折りたたみが無い');
    labels.add(m[1]);
  }
  assert.equal(labels.size, ids.length);
  assert.match(form, /<select id="work-type" name="work-type" aria-describedby="work-type-hint">/);
  assert.match(form, /<label for="subcontract-total">[^<]*税込/);
  assert.match(form, /<label for="contract-amount">[^<]*税込/);
});

test('畳んだ説明の文言は消していない(できること3つ・必須と任意の説明・Excel・体系図・段取りの作り方・目次の範囲)', () => {
  assert.deepEqual(foldsAround('can-do'), ['can-do-more']);
  assert.equal((body.match(/<ul id="can-do">([\s\S]*?)<\/ul>/)[1].match(/<li>/g) ?? []).length, 3);
  for (const s of ['推測で埋めません', '「仮の一覧」', '※任意の欄は', '許可番号・下請負人の欄は読まない', '下請負人の一覧・下請けの技術者の氏名', '公共工事標準請負契約約款 第32条', '見出しの言葉だけで比べ', 'ブラウザに保存しません']) {
    assert.ok(body.includes(s), s);
  }
  assert.ok(!outsideFolds(body).includes('公共工事標準請負契約約款 第32条'), '説明が外に残っている');
  assert.ok(!body.includes('上の「1.」の選ぶ欄'), '段を分けたので「上の」は見えない');
  assert.ok(!body.includes('上の欄の「工事の種類」'), '段を分けたので「上の」は見えない');
});

test('別の道具: A・B は最初は閉じた1つの折りたたみの中。見出しの h2 は summary にあり、出典と取得日は外。B は今までどおり印刷に出る', () => {
  assert.match(body, /<details class="other-tools" id="other-tools">\s*<summary class="no-print"><h2>ここからは別の道具<\/h2>/);
  assert.deepEqual(foldsAround('mask'), ['other-tools']);
  assert.deepEqual(foldsAround('ai-check'), ['other-tools']);
  assert.deepEqual(foldsAround('sources'), []);
  assert.match(body, /<section id="mask" class="no-print">/);
  assert.match(body, /<section id="ai-check">/, 'AI の候補が印刷に出なくなる');
});

test('最初から開いている折りたたみは足していない。印刷では説明の見出しを消し、中身は開いて出す', () => {
  const open = [...body.matchAll(/<details\b[^>]*>/g)].filter((m) => /\sopen\b/.test(m[0]));
  assert.deepEqual(open.map((m) => m[0]), []);
  const print = html.match(/@media print \{[\s\S]*?\n {2}\}/)[0];
  assert.match(print, /details\.fold > summary \{ display: none; \}/);
  assert.ok(!/details(\.[a-z-]+)?\s*\{[^}]*display: none/.test(print), '折りたたみの中身まで消している');
});

test('読み込んだ表を使うと、国の例の説明は折りたたみの見出しごと隠れ、戻すと出る', () => {
  const file = fs.readFileSync(path.join(ROOT, 'data/specs/wakayama_r0711_rows.json'), 'utf8');
  const els = new Map();
  const doc = {
    getElementById(id) {
      if (!els.has(id)) {
        const fold = { hidden: false };
        els.set(id, { innerHTML: '', textContent: '', value: '', hidden: false, fold, closest: (s) => (s === 'details' ? fold : null) });
      }
      return els.get(id);
    },
  };
  assert.equal(loadRulesFile(doc, file), true);
  for (const id of ['schedule-about', 'plan-about']) assert.equal(doc.getElementById(id).fold.hidden, true, id);
  clearRulesTable(doc);
  for (const id of ['schedule-about', 'plan-about']) assert.equal(doc.getElementById(id).fold.hidden, false, id);
  for (const id of ['schedule-about', 'plan-about']) assert.equal(foldsAround(id).length, 1, id + ' の折りたたみの中身が1つでない');
  for (const fold of ['schedule-about-fold', 'plan-about-fold']) {
    assert.equal((body.match(new RegExp('<details class="fold" id="' + fold + '">[\\s\\S]*?</details>'))[0].match(/<p\b/g) ?? []).length, 1, fold);
  }
});

test('07 の決まりは崩さない: 断り書き・PDL・CSP で通信先無し・外部の読み込み無し・保存の API 無し・index.html が build と同じ', () => {
  assert.ok(body.includes('id="disclaimer"'));
  assert.ok(body.includes('PDL1.0'));
  assert.match(html, /Content-Security-Policy" content="[^"]*default-src 'none'/);
  assert.ok(!/<(script|link|img)[^>]*\s(src|href)="https?:/i.test(html), '外部の読み込みがある');
  assert.ok(!/localStorage|sessionStorage|indexedDB/.test(html), '保存の API がある');
  assert.equal(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'), html, 'index.html が作り直されていない');
});

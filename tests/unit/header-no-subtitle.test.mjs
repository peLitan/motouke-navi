// F88a: 一番上の帯の「Motouke Navi」に添えた括弧書き(.topbar-sub)を画面に出さない。
// ページの title と見出しの読み上げの名前(h1 の文)は今のまま残すので、括弧書きは消さずに読み上げ用に画面の外へ置く。
// ブラウザが無いので帯の高さは測らない(Edge の 1280・390 の確かめは統括)。ここでは組み立てた画面の CSS と HTML を見る
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHtml } from '../../build.mjs';

const html = buildHtml();
const css = html.match(/<style>([\s\S]*?)<\/style>/)[1].replace(/\/\*[\s\S]*?\*\//g, '');
const body = html.slice(html.indexOf('<body>')).replace(/<script\b[\s\S]*?<\/script>/g, '');
const text = (h) => h.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
const SUB = 'はじめての元請けの確認ツール';
const OFF_SCREEN = 'position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap;';

// @media のブロックごとに分ける(頭が2つの空白の行で始まる)
const blocks = css.split(/^ {2}(?=@media )/m);
const printCss = blocks.filter((s) => s.startsWith('@media print {')).join('\n');
const notPrint = blocks.filter((s) => !s.startsWith('@media print {')).join('\n');
// 紙のほかで .topbar-sub を選ぶ規則の中身
const subRules = (src) => [...src.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .filter((m) => m[1].split(',').map((s) => s.trim()).some((s) => /\.topbar-sub\b/.test(s)))
  .map((m) => m[2].trim());

const header = body.slice(body.indexOf('<header'), body.indexOf('</header>'));
const h1 = header.match(/<h1>([\s\S]*?)<\/h1>/)[1];

test('title と見出しの読み上げの名前は今のまま', () => {
  assert.equal(html.match(/<title>([^<]*)<\/title>/)[1], 'Motouke Navi(' + SUB + ')');
  assert.equal(text(h1), 'Motouke Navi(' + SUB + ')');
  assert.ok(!/aria-hidden/.test(h1), '括弧書きが読み上げから外れている');
  assert.ok(!/aria-label/.test(header.match(/<h1[^>]*>/)[0]), '見出しの名前を aria-label で差し替えている');
});

test('帯の中で括弧書きの字は .topbar-sub の中だけにあり、帯のほかの所に無い', () => {
  const outside = header.replace(/<span class="topbar-sub">[\s\S]*?<\/span>/, '');
  assert.ok(header.includes('<span class="topbar-sub">(' + SUB + ')</span>'));
  assert.ok(!outside.includes(SUB), '括弧書きの字が .topbar-sub の外にもある');
});

test('画面では .topbar-sub を読み上げに残して画面の外へ置く(どの幅でも)', () => {
  const rules = subRules(notPrint);
  assert.deepEqual(rules, [OFF_SCREEN], '.topbar-sub の画面の規則が画面の外へ置く1つでない: ' + JSON.stringify(rules));
  // display: none・visibility: hidden は読み上げからも消えるので使わない
  assert.ok(!rules.some((r) => /display:\s*(none|block|inline)|visibility:\s*hidden/.test(r)));
});

test('紙は今のまま隠す(F66c)', () => {
  assert.deepEqual(subRules(printCss), ['display: none !important;']);
});

test('帯に見える字は作品名と右のリンクだけで、作品名は1行の短い字', () => {
  const visible = text(header.replace(/<span class="topbar-sub">[\s\S]*?<\/span>/, '').replace(/<svg\b[\s\S]*?<\/svg>/g, ''));
  assert.equal(visible, 'Motouke Navi 使った資料');
  // 帯は横に並べ、行を折り返さない作りのまま
  assert.ok(/\.topbar \.wrap \{ display: flex; align-items: center;/.test(css));
});

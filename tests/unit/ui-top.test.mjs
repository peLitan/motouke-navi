// F14a: 画面の冒頭と流れ(できること3行・まず見本で試す・段階の表示・節の番号 1〜3 と A・B)の構造を確かめる
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildHtml } from '../../build.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const html = buildHtml();
const body = html.slice(html.indexOf('<body>'));
const h2s = [...body.matchAll(/<h2>([^<]*)<\/h2>/g)].map((m) => m[1]);

test('h1 のすぐ後に「このツールでできること」と3つの箇条がある', () => {
  const h1 = body.indexOf('<h1>');
  const lead = body.indexOf('id="lead"');
  const main = body.indexOf('<main');
  assert.ok(h1 >= 0 && h1 < lead && lead < main, 'できることの説明が h1 と main の間に無い');
  assert.ok(body.includes('このツールでできること'));
  const ul = body.match(/<ul id="can-do">([\s\S]*?)<\/ul>/);
  assert.ok(ul, 'できることの箇条が無い');
  assert.equal((ul[1].match(/<li>/g) || []).length, 3);
});

test('入口の枠「どこから始めますか」に3択が同じ形で並び、見本が先頭(見本を読み込むボタン)', () => {
  const start = body.slice(body.indexOf('<div class="start no-print" id="start">'), body.indexOf('id="entry-back"'));
  assert.ok(start.includes('<h2>どこから始めますか</h2>'));
  const btns = [...start.matchAll(/<button type="button" id="(sample-load|entry-bid|entry-awarded)" class="([^"]*)">([\s\S]*?)<\/button>/g)];
  assert.deepEqual(btns.map((m) => m[1]), ['sample-load', 'entry-bid', 'entry-awarded']);
  for (const m of btns) assert.ok(m[2].split(' ').includes('entry-button'), m[1] + ' が同じ形でない');
  assert.ok(btns[0][2].split(' ').includes('sample-button'), '見本だけ色を濃くする印が無い');
  assert.ok(btns[0][3].includes('まず見本で試す') && btns[0][3].includes('初めての方はこちら') && btns[0][3].includes('見本を読み込む'));
  assert.ok(btns[1][3].includes('これから入札する'));
  assert.ok(btns[2][3].includes('もう受注した'));
  assert.match(html, /\.entry-button \{[^}]*font-size: 1\.25rem/, 'ボタンの文字が大きくない');
  assert.equal((body.match(/id="sample-load"/g) || []).length, 1, '見本のボタンが2つある');
  assert.ok(body.indexOf('id="start"') < body.indexOf('id="bid-form"'));
});

test('段階の表示が 1 条件を入れる → 2 結果を見る → 3 書類を確かめる の順にある', () => {
  const ol = body.match(/<ol class="steps" id="steps"[^>]*>([\s\S]*?)<\/ol>/);
  assert.ok(ol, '段階の表示が無い');
  const items = [...ol[1].matchAll(/<li><button [^>]*>([^<]*)<\/button><\/li>/g)].map((m) => m[1]);
  assert.deepEqual(items, ['1 条件を入れる', '2 結果を見る', '3 書類を確かめる']);
});

test('節の番号は 1・2・3、そのあと「ここからは別の道具」の下に A・B', () => {
  const numbered = h2s.filter((t) => /^(\d+(-\d+)?|[A-Z])\. /.test(t)).map((t) => t.split('.')[0]);
  assert.deepEqual(numbered, ['1', '2', '3', 'A', 'B']);
  assert.ok(!body.includes('2-2.'), '2-2 の番号が残っている');
  const other = h2s.indexOf('ここからは別の道具');
  assert.ok(other > h2s.findIndex((t) => t.startsWith('3. ')) && other < h2s.findIndex((t) => t.startsWith('A. ')));
  assert.ok(h2s.some((t) => t.startsWith('3. 施工計画書の目次の点検')));
  assert.ok(h2s.some((t) => t.startsWith('A. 文の置き換え')));
  assert.ok(h2s.some((t) => t.startsWith('B. Claude で点検した結果')));
});

test('節の番号を変えたあとも、画面の文の中の参照が古い番号のままでない', () => {
  assert.ok(!/「3\.」で置き換え/.test(body));
  assert.ok(!/「4\. Claude/.test(body));
  assert.ok(body.includes('「A.」で置き換えた後の文だけ'));
});

test('07 の決まりは崩さない: 断り書き・PDL の表示・CSP で通信先無し・外部の読み込み無し', () => {
  assert.ok(body.includes('id="disclaimer"'));
  assert.ok(body.includes('PDL1.0'));
  assert.match(html, /Content-Security-Policy" content="[^"]*default-src 'none'/);
  assert.ok(!/<(script|link|img)[^>]*\s(src|href)="https?:/i.test(html), '外部の読み込みがある');
  assert.equal(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'), html, 'index.html が作り直されていない');
});

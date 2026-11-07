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
// 「1.」は紙だけの .print-num の中(F86b)。紙の字のまま読む
const h2s = [...body.replace(/<span class="print-num">([^<]*)<\/span>/g, '$1').matchAll(/<h2(?: id="(?:bid|result|ledger|tools)-title" tabindex="-1")?>([^<]*)<\/h2>/g)].map((m) => m[1]);

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

test('入口の題「まず、どう始めますか」に3つのタイルが同じ形で並び、見本が先頭で主の形(見本を読み込むボタン)', () => {
  const start = body.slice(body.indexOf('<div class="start no-print" id="start">'), body.indexOf('id="offline-note"'));
  assert.ok(start.includes('<h2>まず、どう始めますか</h2>'));
  const btns = [...start.matchAll(/<button type="button" id="(sample-load|entry-bid|entry-intake)" class="([^"]*)"[^>]*>([\s\S]*?)<\/button>/g)];
  assert.deepEqual(btns.map((m) => m[1]), ['sample-load', 'entry-bid', 'entry-intake']);
  for (const m of btns) {
    assert.ok(m[2].split(' ').includes('entry-button'), m[1] + ' が同じ形でない');
    assert.match(m[3], /<svg class="entry-icon"[^>]*aria-hidden="true"/, m[1] + ' の印の絵');
  }
  assert.ok(btns[0][2].split(' ').includes('sample-button'), '見本だけ色を濃くする印が無い');
  assert.equal(btns.filter((m) => m[2].includes('sample-button')).length, 1);
  assert.ok(btns[0][3].includes('まず見本で試す') && btns[0][3].includes('初めての方はこちら') && btns[0][3].includes('見本を読み込む'));
  assert.ok(btns[1][3].includes('条件を入れる'));
  // F83a6: 公告のタイルは PDF も読むので、主の文を「公告を読み込む」に短くし、副の文で PDF と条件のファイルを言う
  assert.ok(btns[2][3].includes('<span class="btn-main">公告を読み込む</span>') && btns[2][3].includes('公告の PDF か、AI がまとめた条件のファイル(.json)を選ぶ'));
  assert.match(html, /\.entry-button \{[^}]*font-size: 1\.1875rem/, 'ボタンの文字が大きくない');
  assert.equal((body.match(/id="sample-load"/g) || []).length, 1, '見本のボタンが2つある');
  assert.ok(body.indexOf('id="start"') < body.indexOf('id="bid-form"'));
});

test('もう受注した人は、タイルより小さな下線の字のボタン。押す所は 44px', () => {
  const m = body.match(/<button type="button" id="entry-awarded" class="([^"]*)">([^<]*)<\/button>/);
  assert.ok(m, 'entry-awarded が無い');
  assert.equal(m[1], 'entry-link');
  assert.ok(m[2].includes('もう受注した'));
  assert.ok(body.indexOf('id="entry-intake"') < body.indexOf('id="entry-awarded"'));
  const css = html.match(/\.entry-link \{([^}]*)\}/)[1];
  assert.match(css, /min-height: 44px/);
  assert.match(css, /text-decoration: underline/);
  assert.match(css, /border: none/);
  assert.ok(!/font-size/.test(css), 'タイルと同じ大きさにしない(既定の 16px のまま)');
});

test('用意するものは短い語の並びで、押せる印に見えない(ボタン・枠・影・地・四角の印が無い)', () => {
  const prep = body.match(/<div class="entry-prep" id="entry-prep">([\s\S]*?)<\/div>/)[1];
  assert.ok(prep.includes('用意するもの') && prep.includes('分からない'));
  assert.ok((prep.match(/<li>/g) || []).length >= 3);
  assert.ok(!/<button|<a\b|<input|☐/.test(prep));
  const rules = [...html.matchAll(/\.entry-prep[^{]*\{([^}]*)\}/g)].map((m) => m[1]).join(' ');
  assert.ok(!/border|box-shadow|background|cursor|☐/.test(rules), rules);
  assert.ok(rules.includes('"・"'));
});

test('画面の文に作る側の語(Skill・ファイル名・機能の番号)が出ない', () => {
  const visible = body.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ');
  assert.ok(!/Skill|bid-intake|check-conditions|check-rows|spec-to-rules|\.mjs|\bF\d{2}[a-z]?\b/.test(visible), (visible.match(/.{0,20}(Skill|bid-intake|check-conditions|check-rows|spec-to-rules|\.mjs|\bF\d{2}[a-z]?\b).{0,20}/) || [])[0]);
});

test('進み具合が 入口 → 条件 → 結果 → 書類 の順にある', () => {
  const ol = body.match(/<ol class="steps" id="steps"[^>]*>([\s\S]*?)<\/ol>/);
  assert.ok(ol, '進み具合が無い');
  // 番号は丸、名前は別の span(F43a)。見える字は「番号+名前」
  const items = [...ol[1].matchAll(/<li id="step-\d"[^>]*>(.*?)<\/li>/g)].map((m) => m[1].replace(/<[^>]+>/g, ''));
  assert.deepEqual(items, ['1入口', '2条件', '3結果', '4書類']);
});

test('節の番号は紙だけの 1 のほかは無く、そのあと「ここからは別の道具」の下に A・B', () => {
  const numbered = h2s.filter((t) => /^(\d+(-\d+)?|[A-Z])\. /.test(t)).map((t) => t.split('.')[0]);
  assert.deepEqual(numbered, ['1', 'A', 'B']); // F86b: 3-1・3-2 を外した。1 は .print-num で紙だけ
  assert.ok(!body.includes('2-2.'), '2-2 の番号が残っている');
  const other = h2s.indexOf('ここからは別の道具');
  assert.ok(other > h2s.findIndex((t) => t.startsWith('施工計画書の目次の点検')) && other < h2s.findIndex((t) => t.startsWith('A. ')));
  assert.ok(h2s.some((t) => t.startsWith('施工体制台帳の点検')));
  assert.ok(h2s.some((t) => t.startsWith('施工計画書の目次の点検')));
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

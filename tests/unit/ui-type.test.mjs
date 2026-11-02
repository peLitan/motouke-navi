// F14d: 文字・色・注意の枠・言葉。本文16px以上・行間1.7・システムフォント。文字と地のコントラスト 4.5:1 以上。
// 目立つ枠は冒頭の断り書きと対応表の警告だけにし、ほかは灰色の左線の注記にする。入力欄に ※必須/※任意 と1行の補足。CSV の説明
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildHtml } from '../../build.mjs';

const shell = fs.readFileSync(new URL('../../src/ui/shell.html', import.meta.url), 'utf8');
const css = shell.match(/<style>([\s\S]*?)<\/style>/)[1].replace(/\/\*[\s\S]*?\*\//g, '');
// 印刷の決まり(@media print)は紙の大きさの指定なので、画面の文字の大きさの点検から外す
const screenCss = css.replace(/@media print \{[\s\S]*\n {2}\}/, '');
const rules = [...screenCss.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2] }));
const prop = (body, name) => body.match(new RegExp('(?:^|;)\\s*' + name + '\\s*:\\s*([^;]+)'))?.[1].trim();
const body = buildHtml().split('<body>')[1].replace(/<script\b[\s\S]*?<\/script>/g, '');

// WCAG の相対輝度とコントラスト比
function lum(hex) {
  let h = hex.replace('#', '');
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const hexOf = (v) => v?.match(/#[0-9a-f]{3,6}\b/i)?.[0];

test('本文は16px以上・行間1.7・システムフォント(system-ui, Hiragino Sans, Yu Gothic UI, Meiryo)', () => {
  const b = rules.find((r) => r.sel === 'body').body;
  assert.equal(prop(b, 'font-size'), '1rem');
  assert.equal(prop(b, 'line-height'), '1.7');
  assert.match(prop(b, 'font-family'), /^system-ui, "Hiragino Sans", "Yu Gothic UI", Meiryo, sans-serif$/);
  assert.match(css, /html \{ font-size: 100%; \}/, '根の文字の大きさを利用者の設定(既定16px)より小さくしている');
  // 画面の文字の大きさは 1rem(16px)より小さくしない
  for (const r of rules) {
    const fs = prop(r.body, 'font-size');
    if (!fs || fs === 'inherit' || r.sel === 'html') continue;
    const m = fs.match(/^([\d.]+)rem$/);
    assert.ok(m, r.sel + ' の font-size が rem でない: ' + fs);
    assert.ok(Number(m[1]) >= 1, r.sel + ' の文字が16pxより小さい: ' + fs);
  }
  // 入力欄・ボタンはブラウザの既定(13px 前後)のままにしない
  assert.ok(rules.some((r) => /button, input, select, textarea/.test(r.sel) && prop(r.body, 'font') === 'inherit'), '入力欄・ボタンの文字が本文の大きさにならない');
});

test('文字と地の色のコントラストは、色を決めたすべての決まりで 4.5:1 以上', () => {
  const bodyColor = hexOf(prop(rules.find((r) => r.sel === 'body').body, 'color'));
  let checked = 0;
  for (const r of rules) {
    const fg = hexOf(prop(r.body, 'color'));
    const bg = hexOf(prop(r.body, 'background') ?? prop(r.body, 'background-color'));
    if (!fg && !bg) continue;
    const ratio = contrast(fg ?? bodyColor, bg ?? '#fff');
    assert.ok(ratio >= 4.5, r.sel + ' の文字(' + (fg ?? bodyColor) + ')と地(' + (bg ?? '#fff') + ')のコントラストが ' + ratio.toFixed(2) + ':1');
    checked++;
  }
  assert.ok(checked >= 15, '点検した決まりが少ない: ' + checked);
});

test('目立つ枠は冒頭の必須の断り書きと対応表の警告の2つだけ。ほかの注意は灰色の左線の注記', () => {
  const boxed = [...body.matchAll(/<[a-z]+\b[^>]*class="[^"]*\bdisclaimer\b[^"]*"[^>]*>/g)].map((m) => m[0].match(/id="([^"]+)"/)?.[1]);
  assert.deepEqual(boxed, ['disclaimer', 'map-warning']);
  for (const id of ['ledger-file-note', 'mask-warning', 'mask-limits', 'mask-file-note', 'ai-note', 'schedule-notice']) {
    assert.match(body, new RegExp('<p class="[^"]*\\bnote\\b[^"]*" id="' + id + '"'), id + ' が注記になっていない');
  }
  const note = rules.find((r) => r.sel === '.note').body;
  assert.match(note, /border-left: 4px solid #6b7280/);
  assert.ok(!prop(note, 'background'), '注記に地の色が付いている(枠に見える)');
  const disc = rules.find((r) => r.sel === '.disclaimer').body;
  assert.match(disc, /border: 3px solid/);
});

test('入札前の確認の入力欄に ※必須/※任意 と1行の補足がある', () => {
  const form = body.match(/<form id="bid-form"[\s\S]*?<\/form>/)[0];
  // F14f で説明を「分からない」と「未回答」の扱いに書き換えた
  assert.match(form, /「分からない」を選んだ質問を使う項目は「確認が要る」に、まだ答えていない質問を使う項目は「未回答」にします/);
  // 欄ごとの名前(label・legend)に印
  const need = { orderer: '必須', 'work-type': '必須', 'contract-amount': '必須', 'subcontract-total': '必須', license: '必須', 'engineer-qualification': '必須', 'ict-measure': '任意' };
  for (const [id, kind] of Object.entries(need)) {
    const label = form.match(new RegExp('<label for="' + id + '">([\\s\\S]*?)</label>'))[1];
    assert.ok(label.includes('<span class="req req-' + (kind === '必須' ? 'must' : 'optional') + '">※' + kind + '</span>'), id + ' に ※' + kind + ' が無い');
    assert.match(form, new RegExp('id="' + id + '"[^>]*aria-describedby="' + id + '-hint"'), id + ' の補足が欄とつながっていない');
    assert.match(form, new RegExp('<p id="' + id + '-hint" class="hint">[^<]+</p>'), id + ' の補足が無い');
  }
  assert.match(form, /<legend>元請けか下請けか<span class="req req-must">※必須<\/span><\/legend>/);
  // 補足の中身: 直接請け負うの意味・技術者の資格・閲覧の措置
  assert.match(form, /id="direct-hint" class="hint">発注者から直接請け負うなら「元請け」/);
  assert.match(form, /id="engineer-qualification-hint" class="hint">[^<]*監理技術者になれる人か、主任技術者になれる人か/);
  assert.match(form, /id="ict-measure-hint" class="hint">[^<]*写しを出す代わりに、発注者が台帳を見られるようにする[^<]*発注者に確かめて/);
  // 法令の言い過ぎをしない: 補足で「必ず」「義務」「違反」と言い切らない
  const hints = [...form.matchAll(/class="hint">([^<]+)</g)].map((m) => m[1]).join('');
  assert.ok(!/必ず|義務|違反|罰/.test(hints), '補足で言い切っている: ' + hints);
  // 印の色は地(白)に対して 4.5:1 以上
  for (const sel of ['.req-must', '.req-optional']) assert.ok(contrast(hexOf(prop(rules.find((r) => r.sel === sel).body, 'color')), '#fff') >= 4.5);
});

test('CSV の説明は「Excel で開ける CSV として、この PC に保存します(外へは送りません)」', () => {
  assert.match(body, /<p id="csv-note">Excel で開ける CSV として、この PC に保存します\(外へは送りません\)。/);
  assert.ok(!body.includes('BOM つきの UTF-8'), '利用者に分かりにくい言葉(BOM)が残っている');
  const app = fs.readFileSync(new URL('../../src/ui/app.mjs', import.meta.url), 'utf8');
  assert.ok(!app.includes('BOM つき UTF-8)。'), '書き出したあとの知らせに BOM が残っている');
});

test('07 の決まり: 外部の読み込み・通信・保存が無く、断り書きと PDL の表示を常に出す', () => {
  const html = buildHtml();
  assert.ok(!/<(script|link|img|iframe)\b[^>]*\b(src|href)=["']https?:/i.test(html), '外部の読み込みがある');
  assert.ok(!/@import|url\(/.test(css), 'CSS で外部を読んでいる');
  assert.ok(!/\bfetch\(|XMLHttpRequest|WebSocket|localStorage|sessionStorage|indexedDB/.test(html), '通信か保存の処理がある');
  assert.match(html, /connect-src 'none'/);
  assert.match(html, /font-src|default-src 'none'/);
  assert.ok(body.includes('id="disclaimer"'));
  assert.ok(body.includes('PDL1.0'));
});

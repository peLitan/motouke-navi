// F14g: 最初の1画面(幅1280・高さ900)に、題・断り書き・できること3行・「見本で試す」のボタン・段階の表示が入る。
// 法令の2つの一覧は題の分かる閉じた details にし、「見ていない法令・資料」があることは details の外の1行で常に見せる。
// この環境にはブラウザが無いので、高さは実測ではなく見積もる: 画面が出す HTML の文と CSS の値から、各ブロックの行数×行の高さ+余白を
// 多めに数える(和文は1字1em、英数字も0.6emとし、行末の禁則の分として1行あたり1字ぶん幅を減らし、上下の余白は重ねずに足す)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildHtml } from '../../build.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const html = buildHtml();
const css = html.match(/<style>([\s\S]*?)<\/style>/)[1].replace(/\/\*[\s\S]*?\*\//g, '');
const screenCss = css.replace(/@media print \{[\s\S]*\n {2}\}/, '').replace(/@media \(max-width[^{]*\{[^{}]*\{[^{}]*\}\s*\}/g, '').replace(/@media \(max-width[^{]*\{[\s\S]*?\n {2}\}/g, '');
const body = html.slice(html.indexOf('<body>')).replace(/<script\b[\s\S]*?<\/script>/g, '');
const text = (h) => h.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

const REM = 16;
const VIEW_W = 1280;
const VIEW_H = 900;
const SCROLLBAR = 17;

// CSS の値(最後に書いた決まりが勝つ)
function cssValue(sel, prop) {
  let v;
  for (const m of screenCss.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!m[1].split(',').map((x) => x.trim()).includes(sel)) continue;
    const p = m[2].match(new RegExp('(?:^|;)\\s*' + prop + '\\s*:\\s*([^;]+)'));
    if (p) v = p[1].trim();
  }
  return v;
}
const px = (v) => { const m = String(v).match(/^([\d.]+)(rem|px)$/); assert.ok(m, '長さが読めない: ' + v); return Number(m[1]) * (m[2] === 'rem' ? REM : 1); };
// margin の上と下(0.25rem 0 0.5rem のような書き方)
function marginTB(sel) {
  const v = cssValue(sel, 'margin');
  assert.ok(v, sel + ' の margin が無い');
  const a = v.split(/\s+/).map((x) => (x === '0' ? 0 : px(x)));
  return a.length === 1 ? a[0] * 2 : a[0] + (a.length >= 3 ? a[2] : a[0]);
}

// 文の幅(em)。全角は1em、半角は0.6em(多めに)
const ems = (s) => [...s].reduce((n, c) => n + (/[ -~]/.test(c) ? 0.6 : 1), 0);
function lines(s, fontPx, widthPx) {
  const perLine = Math.floor((widthPx - fontPx) / fontPx);
  return Math.max(1, Math.ceil(ems(s) / perLine));
}
const block = (s, fontPx, lh, widthPx) => lines(s, fontPx, widthPx) * fontPx * lh;

function estimate() {
  const bodyMax = px(cssValue('body', 'max-width'));
  const pad = px(cssValue('body', 'padding'));
  const W = Math.min(bodyMax, VIEW_W - SCROLLBAR) - pad * 2;
  const LH = Number(cssValue('body', 'line-height'));
  const parts = [];
  const add = (name, h) => parts.push({ name, h });
  add('body の上の余白', pad);

  // 題
  const h1 = text(body.match(/<h1>([\s\S]*?)<\/h1>/)[1]);
  const h1Font = px(cssValue('h1', 'font-size'));
  add('題', block(h1, h1Font, Number(cssValue('h1', 'line-height')), W) + marginTB('h1'));

  // 断り書き(枠 3px・内側 0.75rem 1rem)
  const disc = text(body.match(/<p class="disclaimer" id="disclaimer">([\s\S]*?)<\/p>/)[1]);
  add('断り書き', block(disc, REM, LH, W - 2 * REM - 6) + 0.75 * REM * 2 + 6 + marginTB('.disclaimer'));

  // できること(見出しの1行と3つの箇条)
  const lead = body.match(/<div class="lead" id="lead">([\s\S]*?)<\/div>/)[1];
  let h = marginTB('.lead') + block(text(lead.match(/<p>([\s\S]*?)<\/p>/)[1]), REM, LH, W) + marginTB('.lead ul');
  for (const m of lead.matchAll(/<li>([\s\S]*?)<\/li>/g)) h += block(text(m[1]), REM, LH, W - 1.5 * REM);
  add('できること3行', h);

  // 見ていない法令・資料の1行と、閉じた details の見出し
  add('見ていない法令の1行', block(text(body.match(/<p class="scope-not-line" id="scope-not-line">([\s\S]*?)<\/p>/)[1]), REM, LH, W) + marginTB('.scope-not-line'));
  const sum = text(body.match(/<details class="scope" id="scope"><summary>([\s\S]*?)<\/summary>/)[1]);
  add('法令の一覧の見出し(閉じた details)', Math.max(px(cssValue('details > summary', 'padding').split(/\s+/)[0]) * 2 + block(sum, REM, LH, W - REM), 2.75 * REM) + marginTB('details.scope'));

  // header と main の間にほかのブロックがあれば、ここで落とす(見積もりから漏らさない)
  const between = body.slice(body.indexOf('</details>', body.indexOf('id="scope"')), body.indexOf('<section id="bid">'));
  assert.equal(text(between), '', '法令の一覧と 1. の節の間に、見積もっていない文がある: ' + text(between));

  // 1. の見出し(h2 は 1.5em)
  const sec = body.slice(body.indexOf('<section id="bid">'));
  add('1. の見出し', block(text(sec.match(/<h2>([\s\S]*?)<\/h2>/)[1]), 1.5 * REM, LH, W) + marginTB('#bid > h2'));

  // 見本の枠(枠 2px・内側 0.75rem 1rem)
  const start = sec.match(/<div class="start no-print" id="start">([\s\S]*?)<\/div>/)[1];
  const inner = W - 2 * REM - 4;
  h = marginTB('.start') + 0.75 * REM * 2 + 4;
  h += block(text(start.match(/<h2>([\s\S]*?)<\/h2>/)[1]), px(cssValue('.start h2', 'font-size')), LH, inner) + marginTB('.start h2');
  for (const m of start.matchAll(/<p(?: [^>]*)?>([\s\S]*?)<\/p>/g)) {
    if (text(m[1]) === '') continue; // #sample-status は押す前は空(余白も 0)
    h += block(text(m[1]), REM, LH, inner) + marginTB('.start p');
  }
  const btnMain = text(start.match(/<span class="btn-main">([\s\S]*?)<\/span>/)[1]);
  const btnSub = text(start.match(/<span class="btn-sub">([\s\S]*?)<\/span>/)[1]);
  const btnW = inner - 1.5 * REM * 2 - 4;
  h += 0.75 * REM * 2 + 4 + block(btnMain, 1.25 * REM, LH, btnW) + block(btnSub, REM, LH, btnW) + marginTB('button');
  const steps = [...start.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => text(m[1]));
  // 段階は横に並ぶ。全部の幅が枠に入らなければ2行と数える
  const stepsW = steps.reduce((n, s) => n + (ems(s) + 2) * REM + 1.5 * REM + 2 + 0.5 * REM, 0);
  const rows = Math.ceil(stepsW / inner);
  h += marginTB('.steps') + rows * (REM * LH + 0.2 * REM * 2 + 2) + (rows - 1) * 0.5 * REM;
  add('見本の枠(ボタンと段階の表示まで)', h);
  return { parts, total: parts.reduce((n, p) => n + p.h, 0), W };
}

test('幅1280・高さ900の最初の1画面に、題・断り書き・できること・見本のボタン・段階の表示が入る(見積もり)', () => {
  const { parts, total, W } = estimate();
  const detail = parts.map((p) => `${p.name} ${Math.round(p.h)}px`).join('、');
  console.log(`# 本文の幅 ${W}px。見積もり ${Math.round(total)}px / ${VIEW_H}px: ${detail}`);
  assert.ok(total <= VIEW_H, `最初の1画面に入らない(見積もり ${Math.round(total)}px): ${detail}`);
});

test('並び: 題 → 断り書き → できること → 見ていない法令の1行 → 法令の一覧(閉じた details) → 見本のボタン → 段階の表示', () => {
  const order = ['<h1>', 'id="disclaimer"', 'id="lead"', 'id="scope-not-line"', '<details class="scope" id="scope">', 'id="sample-load"', 'id="steps"'].map((k) => body.indexOf(k));
  assert.ok(order.every((n) => n >= 0), '冒頭のどれかが無い: ' + order);
  for (let i = 1; i < order.length; i++) assert.ok(order[i - 1] < order[i], '並びが違う: ' + i);
});

test('法令の2つの一覧は、題の分かる閉じた details の中にある。「見ていない」があることは details の外で1行で見せる', () => {
  const d = body.match(/<details class="scope" id="scope">([\s\S]*?)<\/details>/);
  assert.ok(d, '法令の一覧の details が無い');
  assert.ok(!/<details class="scope" id="scope" open/.test(body), '最初から開いている');
  const summary = text(d[1].match(/<summary>([\s\S]*?)<\/summary>/)[1]);
  assert.match(summary, /見ている法令・資料/);
  assert.match(summary, /見ていない法令・資料/);
  assert.ok(d[1].includes('id="scope-seen"') && d[1].includes('id="scope-not"'), '2つの一覧が details の中に無い');
  // details の外の1行(画面にも印刷にも出す)
  const line = body.match(/<p class="scope-not-line" id="scope-not-line">([\s\S]*?)<\/p>/);
  assert.ok(line, '「見ていない法令・資料」の1行が無い');
  const before = body.slice(0, body.indexOf('<details class="scope"'));
  assert.ok(before.includes('id="scope-not-line"'), '1行が details の外(前)に無い');
  assert.match(text(line[1]), /^見ていない法令・資料があります/);
  assert.ok(text(line[1]).length <= 55, '1行に収まらない長さ: ' + text(line[1]).length);
  assert.ok(!/no-print/.test(body.match(/<p class="scope-not-line"[^>]*>/)[0]), '印刷で消える');
});

test('題は何のツールか分かる名前(作品名が決まるまでは(仮))。<title> も同じ', () => {
  const h1 = text(body.match(/<h1>([\s\S]*?)<\/h1>/)[1]);
  assert.equal(h1, '初めての元請けの確認ツール(仮)');
  assert.equal(html.match(/<title>([^<]*)<\/title>/)[1], h1);
  assert.ok(!html.includes('施工体制の確認の候補'), '古い題が残っている');
});

test('通信しないことの説明は消さず、見本の枠の下に置いた', () => {
  const i = body.indexOf('この画面は外部と通信しません');
  assert.ok(i > body.indexOf('id="steps"') && i < body.indexOf('id="bid-form"'));
});

test('07 の決まりは崩さない: 断り書き・PDL の表示・CSP で通信先無し・外部の読み込み無し・index.html を作り直した', () => {
  assert.ok(body.includes('id="disclaimer"'));
  assert.ok(body.includes('PDL1.0'));
  assert.match(html, /Content-Security-Policy" content="[^"]*default-src 'none'/);
  assert.ok(!/<(script|link|img)[^>]*\s(src|href)="https?:/i.test(html), '外部の読み込みがある');
  assert.equal(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'), html, 'index.html が作り直されていない');
});

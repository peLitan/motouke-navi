// F84e: 「PDF で保存・印刷」のまとめの紙で、見出し「入れた条件」だけが1枚目の一番下に残り、表が次の紙へ分かれていた。
// 見出しはまとめのカードの <summary> で、紙の切れ目は見出しと中身の間にも来られる。この間で切らない決まりを、まとめの紙だけに足す。
// F85i: 見出しの決まりだけでは紙で効かなかった(3通りの撮り方で見出しは1枚目の一番下のまま、表は2枚目から)。
// 統括の測りで効いたのは、カードの枠に中で切らない決まりを足す形だけで、見本の条件で見出しが2枚目へ移り3枚のまま。これを足した。
// この環境にはブラウザが無いので、切れ目の位置と枚数は測れない。CSS の決まりと、画面が出す HTML の形を確かめる
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildHtml } from '../../build.mjs';
import { renderSummary } from '../../src/ui/view.mjs';

const html = buildHtml();
// まとめの印刷で開くカードの一覧。app.mjs は外へ出していないので、書いた文から読む
const summaryFolds = fs.readFileSync(new URL('../../src/ui/app.mjs', import.meta.url), 'utf8').match(/const SUMMARY_FOLDS = \[([^\]]*)\]/)[1].match(/[a-z-]+/g);
const css = html.slice(html.indexOf('<style'), html.indexOf('</style>')).replace(/\/\*[\s\S]*?\*\//g, '');
const printText = css.match(/@media print \{([\s\S]*)\n {2}\}/)[1].replace(/@page \{[^{}]*\}/, '');
const screen = css.slice(0, css.indexOf('@media print'));

const parse = (text) => [...text.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2].trim() }));
const print = parse(printText);
const selectorsOf = (r) => r.sel.split(',').map((s) => s.trim());
const prop = (r, name) => r?.body.match(new RegExp('(?:^|;)\\s*' + name + '\\s*:\\s*([^;]+)'))?.[1].trim();

const HEADING = 'body.print-brief details.open-card > summary';
const CARD = 'body.print-brief details.open-card';
const BREAK = /(?:^|;)\s*(?:page-)?break-(?:before|after|inside)\s*:/;
const breakRules = print.filter((r) => BREAK.test(r.body));
const inBrief = (r) => selectorsOf(r).every((s) => s.startsWith('body.print-brief '));

test('まとめの紙で開く2つのカードは、見出しのすぐ次に表が来る(切れ目の候補は見出しの直後の1か所)', () => {
  assert.deepEqual(summaryFolds.slice().sort(), ['summary-conditions', 'summary-docs']);
  const out = renderSummary({ values: {} });
  assert.match(out, /<details class="open-card" id="summary-conditions"><summary><span>入れた条件<\/span><\/summary><dl class="summary-list">/);
  assert.match(out, /<details class="open-card" id="summary-docs"><summary><span>台帳と目次の点検の候補<\/span>[^\n]*?<\/summary><div class="table-scroll"[^>]*><table class="summary-table">/);
});

test('まとめの紙: カードの見出しの直後では切らない', () => {
  const r = print.find((x) => selectorsOf(x).includes(HEADING));
  assert.ok(r, HEADING + ' の決まりが無い');
  assert.equal(prop(r, 'break-after'), 'avoid');
});

test('決まりの効く形: 見出しは紙でもブロックの箱で、まとめの紙で隠さない', () => {
  // break-after はブロックの箱にしか効かない。画面の決まりが flex なのは確かめの前提で、変わったらここを見直す
  const base = parse(screen).find((x) => selectorsOf(x).includes('details.open-card > summary'));
  assert.equal(prop(base, 'display'), 'flex', '見出しの箱の形が変わった');
  const touching = print.filter((x) => selectorsOf(x).some((s) => /details(\.open-card)? > summary$/.test(s)));
  assert.ok(touching.length > 0);
  for (const x of touching) assert.equal(prop(x, 'display'), undefined, x.sel + ' が紙で見出しの箱の形を変えている');
  // .fold の見出しは紙で隠すので、カードに .fold が付くと見出しごと消える
  assert.ok(!/<details class="[^"]*\bfold\b[^"]*" id="summary-(conditions|docs)"/.test(renderSummary({ values: {} })));
});

test('全部の紙は変えない: 切れ目の決まりで印の無いものは、今までの4つだけ', () => {
  assert.deepEqual(breakRules.filter((r) => !inBrief(r)).map((r) => r.sel).sort(), ['.item, .reasons li', '.sign-off', 'table', 'tr'].sort());
  for (const s of breakRules.filter((r) => /break-after/.test(r.body)).flatMap(selectorsOf)) assert.ok(s.startsWith('body.print-brief '), s + ' は全部の紙にも効く');
  assert.ok(!parse(screen).some((r) => BREAK.test(r.body)), '画面の決まりに切れ目の指定がある');
});

test('見出しを表と分けない: まとめの紙の切れ目の決まりは見出しとカードの枠の2つだけ(全部の紙は変えない)', () => {
  const brief = breakRules.filter(inBrief);
  assert.deepEqual(brief.map((r) => r.sel).sort(), [CARD, HEADING].sort());
  assert.equal(brief.find((r) => r.sel === HEADING).body, 'break-after: avoid;', '見出しの決まりに別の切れ目の指定が混ざった');
  assert.equal(brief.find((r) => r.sel === CARD).body, 'break-inside: avoid;', 'カードの枠の決まりに別の切れ目の指定が混ざった');
  // カードの枠のほかに、中で切らない決まりは足さない。.open-card を全部の紙へ広げず、表や行の並びにも当てない
  const whole = /\.open-card(?! > summary)|#summary|\.summary\b|\.summary-list|\.summary-row|\.summary-table|\.table-scroll/;
  for (const r of breakRules.filter((x) => /break-inside\s*:\s*avoid/.test(x.body))) {
    for (const s of selectorsOf(r).filter((x) => x !== CARD)) assert.ok(!whole.test(s), s + ' は中で切らない決まりをカードの枠より広く当てている');
  }
  // 行の中で切らない決まりは今のまま tr にある。カードが1枚に入らないときの表は、行の境で紙をまたげる
  assert.equal(prop(print.find((r) => r.sel === 'table'), 'break-inside'), 'auto');
});

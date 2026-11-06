// F66d: まとめの紙を見本の工事で A4 3枚以内に戻す。ブラウザが無いので、CSS の書いた値を読む(枚数は測っていない)。
// 紙に残す要素の一覧は print-brief.test.mjs の F66c の試験がそのまま見る
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHtml } from '../../build.mjs';

const html = buildHtml();
const css = html.slice(html.indexOf('<style'), html.indexOf('</style>')).replace(/\/\*[\s\S]*?\*\//g, '');
const print = css.match(/@media print \{([\s\S]*)\n {2}\}/)[1];
const screen = css.slice(0, css.indexOf('@media print'));

const parse = (text) => [...text.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2].trim() }));
const rules = parse(print.replace(/@page \{[^{}]*\}/, ''));
const selectorsOf = (r) => r.sel.split(',').map((s) => s.trim());
const prop = (r, name) => r?.body.match(new RegExp('(?:^|;)\\s*' + name + '\\s*:\\s*([^;]+)'))?.[1].trim();
const ruleFor = (sel) => rules.find((r) => selectorsOf(r).includes(sel));
const pt = (v) => {
  const m = String(v).match(/^([\d.]+)pt$/);
  assert.ok(m, 'pt で書いていない: ' + v);
  return Number(m[1]);
};

const SOURCES = 'body.print-brief #sources-list';
const BASIS = 'body.print-brief details.basis > summary';
const BODY_PT = pt(prop(ruleFor('body'), 'font-size'));
const BRIEF_LH = Number(prop(ruleFor('body.print-brief'), 'line-height'));
// 紙の出典の行の中身。どれも消さない
const KEPT_IN_LINE = ['.source-url', '.source-date', '.source-name', '.basis', '#sources-list', '#sources'];

test('用紙は A4 で、余白は 15mm のまま', () => {
  const page = print.match(/@page \{([^{}]*)\}/)?.[1];
  assert.ok(page, '@page が無い');
  assert.equal(page.trim(), 'size: A4; margin: 15mm;');
  assert.equal((print.match(/@page/g) ?? []).length, 1);
});

test('出典の一覧と「根拠を見る」の行: 字は本文より小さく 8pt 以上、行間は本文より詰める', () => {
  assert.equal(BODY_PT, 10.5);
  for (const sel of [SOURCES, BASIS]) {
    const r = ruleFor(sel);
    assert.ok(r, sel + ' の規則が無い');
    const size = pt(prop(r, 'font-size'));
    assert.ok(size >= 8, sel + ' の字が 8pt より小さい: ' + size);
    assert.ok(size < BODY_PT, sel + ' の字が本文より小さくない: ' + size);
    assert.ok(Math.abs(size - 9) <= 0.5, sel + ' の字が 9pt 前後でない: ' + size);
    const lh = Number(prop(r, 'line-height'));
    assert.ok(lh > 1 && lh < BRIEF_LH, sel + ' の行間: ' + lh);
  }
});

test('出典の字は ul に書いて li が受け継ぐ。あいだで字を決める規則が無い', () => {
  // li の margin の規則は F66c が固定している。li や中の span に字の大きさを足すと、ここの 9pt が効かなくなる
  for (const r of [...parse(screen), ...rules]) {
    if (!/#sources-list li|\.source-(name|date|url)/.test(r.sel)) continue;
    assert.equal(prop(r, 'font-size'), undefined, r.sel + ' が字の大きさを決めている');
    assert.equal(prop(r, 'line-height'), undefined, r.sel + ' が行間を決めている');
  }
});

test('折りたたみの見出しは紙で押す所の高さと余白を外す(画面の規則のままだと字を縮めても1行が 33pt 残る)', () => {
  const on = parse(screen).find((r) => r.sel === 'details > summary');
  assert.ok(prop(on, 'min-height') && prop(on, 'padding'), '画面の規則の形が変わった');
  const r = ruleFor('body.print-brief details > summary');
  assert.ok(r, '紙の規則が無い');
  assert.equal(prop(r, 'padding'), '0');
  assert.equal(prop(r, 'min-height'), '0');
  assert.equal(prop(ruleFor('body.print-brief .summary a'), 'padding'), '0');
  assert.equal(prop(ruleFor('body.print-brief .summary a'), 'display'), 'inline');
});

test('全部の紙は変えない: 字・行間・高さ・余白の新しい規則は、どれも body.print-brief の下だけ', () => {
  const newRules = rules.filter((r) => selectorsOf(r).some((s) => [SOURCES, BASIS, 'body.print-brief details > summary', 'body.print-brief .summary a'].includes(s)));
  assert.equal(newRules.length, 3);
  for (const r of newRules) {
    for (const s of selectorsOf(r)) assert.ok(s.startsWith('body.print-brief '), s + ' は全部の紙にも効く');
  }
  // 印の無い印刷の規則で字の大きさを決めるのは、本文と足の2つだけ。行間と高さは決めない
  const open = rules.filter((r) => !r.sel.includes('body.print-brief'));
  assert.deepEqual(open.filter((r) => prop(r, 'font-size')).map((r) => r.sel).sort(), ['body', 'footer']);
  assert.deepEqual(open.filter((r) => prop(r, 'line-height') || prop(r, 'min-height')).map((r) => r.sel), []);
  // 根拠の折りたたみの見出しで印の無い印刷の規則は、色だけ
  assert.equal(ruleFor('details.basis > summary')?.body, 'color: inherit;');
});

test('消した物が無い: F66d の規則に隠す指定が無く、出典の行の中身と根拠は隠す規則に入っていない', () => {
  const added = rules.filter((r) => selectorsOf(r).some((s) => [SOURCES, BASIS, 'body.print-brief details > summary', 'body.print-brief .summary a'].includes(s)));
  for (const r of added) {
    assert.ok(!/visibility|opacity|overflow|max-height|height: 0/.test(r.body.replace(/min-height: 0/, '')), r.sel + ' が中身を隠す');
    assert.ok(!/display: none/.test(r.body), r.sel + ' が中身を隠す');
  }
  const hidden = rules.filter((r) => /display: none/.test(r.body)).flatMap(selectorsOf);
  for (const k of KEPT_IN_LINE) assert.ok(!hidden.some((s) => s.includes(k)), k + ' が紙から消える');
});

test('字の規則は pt か比で書く(rem は紙の字の大きさに連動しない)。2列にしない', () => {
  for (const sel of [SOURCES, BASIS, 'body.print-brief details > summary', 'body.print-brief .summary a']) {
    const r = ruleFor(sel);
    assert.ok(!/rem|px/.test(r.body), sel + ': ' + r.body);
    assert.ok(!/columns?\s*:|column-count|grid-template-columns/.test(r.body), sel + ': ' + r.body);
  }
});

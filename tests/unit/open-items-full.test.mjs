// F85a: 「確認が要る点を見る」の飛び先(#open-items)に全部の点の全文を出し、次にすることの枠は短くして、参照の往復を無くす。
// この環境にはブラウザが無いので、見た目は測れない。組み立てた画面の HTML から、画面に見える文と紙に出る文を取り出して確かめる
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildHtml } from '../../build.mjs';
import { runPage } from '../acceptance/_helpers.mjs';
import { bidCheck } from '../../src/bid-check.mjs';
import { SAMPLE } from '../../src/sample.mjs';
import { readBidForm } from '../../src/ui/form.mjs';
import { needsCheckPoints } from '../../src/ui/answers.mjs';
import { basisLabel, renderBidResult, renderOpenItems, renderResultTop, renderSummary } from '../../src/ui/view.mjs';

const html = buildHtml();
const RESULT_BOXES = ['sample-status', 'result-top', 'bid-result', 'taicho-result', 'schedule-result', 'safety-result', 'open-items', 'summary'];
const SEE_NEXT = '→ 次のページの「確認が要る点と未回答の質問」で確かめます'; // F86f: 飛ばない文にした
const SEE_NEXT_STEP = '→ 上の「次にすること」';
const VOID = new Set(['br', 'hr', 'img', 'input', 'meta', 'link']);
const BLOCK = /^(p|li|h\d|div|summary|td|th|dt|dd|blockquote|ul|ol|tr|table|dl|details)$/;
const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

// 見える字を取り出す。画面は .print-only・.print-inline・hidden と、閉じた折りたたみの summary の外を除く。紙は .no-print を除く
function textOf(source, { paper = false } = {}) {
  const stack = [];
  const hiddenNow = () => stack.some((f) => f.hide);
  let out = '';
  let at = 0;
  for (const m of source.matchAll(/<(\/?)([a-zA-Z][\w-]*)([^>]*)>/g)) {
    if (!hiddenNow()) out += source.slice(at, m.index);
    at = m.index + m[0].length;
    const [, close, tag, attrs] = m;
    const name = tag.toLowerCase();
    if (VOID.has(name)) continue;
    if (close) {
      if (BLOCK.test(name)) out += '\n';
      stack.pop();
      continue;
    }
    if (BLOCK.test(name) && !hiddenNow()) out += '\n';
    const classes = (attrs.match(/class="([^"]*)"/)?.[1] ?? '').split(/\s+/);
    const parent = stack[stack.length - 1];
    const has = (c) => classes.includes(c);
    const hide = paper
      ? has('no-print')
      : has('print-only') || has('print-inline') || /\shidden(\s|$)/.test(attrs) || (parent?.closedDetails === true && name !== 'summary');
    stack.push({ hide, closedDetails: !paper && name === 'details' && !/\sopen(\s|$)/.test(attrs) });
  }
  if (!hiddenNow()) out += source.slice(at);
  return decode(out);
}

async function samplePage() {
  const page = runPage(html);
  await page.click('sample-load');
  await page.click('confirm-go');
  return page;
}
const bid = () => bidCheck(readBidForm(SAMPLE.form));
const points = () => needsCheckPoints(bid(), SAMPLE.form);
const labelsOf = (list) => [...new Set(list.map(basisLabel))].join('、');
const subOf = (state) => decode(renderResultTop(state).match(/<p class="next-sub">([\s\S]*?)<\/p>/)[1]);
const basisLines = (text) => text.split('\n').filter((l) => l.startsWith('根拠を見る: '));

test('この試験の数え方: 紙にだけ出す物・閉じた折りたたみの中身は画面の字に入らず、画面だけの物は紙の字に入らない', () => {
  assert.equal(textOf('<p>見える<span class="print-inline">紙だけ</span></p><div class="print-only"><ul><li>紙だけ</li></ul></div>').trim(), '見える');
  assert.equal(textOf('<details class="basis"><summary>見出し</summary><p>中身</p></details>').trim(), '見出し');
  assert.equal(textOf('<p class="no-print">画面だけ</p><p class="print-only">紙</p>', { paper: true }).trim(), '紙');
});

test('見本: #open-items の画面に見える文に全部の点の全文があり、参照の行が無い', async () => {
  const page = await samplePage();
  const open = page.el('open-items').innerHTML;
  const text = textOf(open);
  assert.ok(points().length >= 2, '見本で点が2件ない形では全部を見たことにならない');
  for (const p of points()) {
    assert.ok(text.includes(p.label + ': ' + p.message), p.label + ' の全文が画面に無い: ' + text.slice(0, 200));
  }
  assert.ok(!open.includes('see-above'), '参照の行がある');
  assert.ok(!/→ [上下]の「/.test(text), text.slice(0, 200));
  assert.match(text, new RegExp('確認が要る点\\(' + points().length + '件\\)'));
});

test('根拠: 項目のカードと違う根拠の点には画面に折りたたみがあり、同じ根拠の点の折りたたみは紙にだけ出る', async () => {
  const page = await samplePage();
  const open = page.el('open-items').innerHTML;
  const screen = basisLines(textOf(open));
  const paper = basisLines(textOf(open, { paper: true }));
  const items = bid().items.filter((it) => it.basis?.length).map((it) => labelsOf(it.basis));
  const withBasis = points().filter((p) => p.basis?.length);
  const same = withBasis.filter((p) => items.includes(labelsOf(p.basis)));
  const other = withBasis.filter((p) => !items.includes(labelsOf(p.basis)));
  assert.ok(same.length > 0 && other.length > 0, '見本に両方の点が無いと、この試験は何も見ていない');
  for (const p of other) assert.ok(screen.some((l) => l === '根拠を見る: ' + labelsOf(p.basis)), p.label + ' の折りたたみが画面に無い');
  for (const p of same) assert.ok(!screen.some((l) => l === '根拠を見る: ' + labelsOf(p.basis)), p.label + ' の見出しが画面で2回になる');
  for (const p of withBasis) assert.ok(paper.some((l) => l === '根拠を見る: ' + labelsOf(p.basis)), p.label + ' の根拠が紙から消えた');
});

test('次にすることの sub: 1件目の名前の短い1文で、40字以下で message を含まない', async () => {
  const page = await samplePage();
  const sub = decode(page.el('result-top').innerHTML.match(/<p class="next-sub">([\s\S]*?)<\/p>/)[1]);
  assert.equal(sub, '1件目: ' + points()[0].label);
  assert.ok(sub.length <= 40, sub);
  for (const p of points()) assert.ok(!sub.includes(p.message.slice(0, 12)), p.label + ' の文が枠に入っている');
  // どの項目の名前が1件目になっても 40字に収まる
  for (const it of bid().items) {
    const one = subOf({ bid: { items: [it], checks: [{ key: it.key, label: it.label, message: '文' }] } });
    assert.ok(one.length <= 40, one);
  }
});

test('.next-go の行き先は #open-items のままで、項目はページの語で同じ所を指し、数のカードは押せず、行き先に点の全文がある', async () => {
  const page = await samplePage();
  const top = page.el('result-top').innerHTML;
  const go = top.match(/class="next-go" href="#([\w-]+)"/)[1];
  assert.equal(go, 'open-items');
  assert.ok(top.includes('>確認が要る点を見る</a>'));
  assert.match(top, /<div class="stat stat-check">/);
  assert.match(page.el('bid-result').innerHTML, /class="item-depends">＊ [^<]*<span class="no-print">次のページの「<\/span>確認が要る点<span class="no-print">」<\/span>/); // F86f: 行き先の名前の文にした
  const text = textOf(page.el(go).innerHTML);
  for (const p of points()) assert.ok(text.includes(p.message), p.label);
});

test('#bid-result の画面: 件数の見出しと説明の行と「→ 次のページの…」の1行で、点の文は画面に出ない', async () => {
  const page = await samplePage();
  const out = page.el('bid-result').innerHTML;
  const text = textOf(out);
  assert.equal(text.split(SEE_NEXT).length - 1, 1, '「→ 次のページの…」は1回');
  assert.ok(out.includes('<span class="see-next">' + SEE_NEXT + '</span>'), '飛ばない文になっていない');
  assert.match(text, new RegExp('確認が要る点\\(' + points().length + '件\\)'));
  assert.match(out, /<p class="points-note" id="bid-checks">項目の札/);
  for (const p of points()) assert.ok(!text.includes(p.message), p.label + ' の文が画面に残っている');
});

test('「→ 上の「次にすること」」が結果のどこにも無く、#result-top へ戻るリンクも無い', async () => {
  const page = await samplePage();
  for (const id of RESULT_BOXES) {
    const out = page.el(id).innerHTML;
    assert.ok(!out.includes(SEE_NEXT_STEP), id);
    assert.ok(!out.includes('href="#result-top"'), id);
  }
});

test('紙: 全部の紙(#bid-result と #open-items)とまとめの紙(#open-items)に全部の点の文と根拠が残り、参照の行は出ない', async () => {
  const page = await samplePage();
  const open = textOf(page.el('open-items').innerHTML, { paper: true });
  const full = textOf(page.el('bid-result').innerHTML, { paper: true });
  for (const text of [open, full]) {
    for (const p of points()) {
      assert.ok(text.includes(p.message), p.label);
      if (p.basis?.length) assert.ok(text.includes('根拠を見る: ' + labelsOf(p.basis)), p.label + ' の根拠');
    }
    assert.ok(!/→ [上下]の「/.test(text), '紙に参照の行がある');
  }
});

test('まとめの文は #open-items を指し、「確認が要る点と未回答の質問」に出していると言う', () => {
  const out = renderSummary({ values: SAMPLE.form, bid: bid() });
  assert.ok(out.includes('<a href="#open-items">確認が要る点 ' + points().length + '件</a>を「確認が要る点と未回答の質問」に出しています。'), out.slice(0, 300));
  assert.ok(!out.includes('入札前の確認の欄に出しています'));
});

test('点が無ければ「→ 下の…」は出さず、点の行も出さない', () => {
  const none = { items: [{ key: 'n', label: 'いらない', status: 'not_required', basis: [] }], checks: [] };
  assert.ok(!renderBidResult(none, {}).includes('→ 下の'));
  const open = renderOpenItems(none, {});
  assert.ok(!open.includes('<ul class="open-checks">'));
  assert.ok(textOf(open).includes('ありません'));
});

test('ほかの枝の文は変えない: 金額の失敗・条件の変更・元請けの実績・未回答', () => {
  const b = bid();
  assert.equal(subOf({ errors: ['x'] }), '読めない欄に印を付けました。直してから、もう一度「確認する」を押してください。');
  assert.equal(subOf({ bid: b, stale: true }), '条件が変わりました。下の数は前の条件の結果です。');
  assert.equal(subOf({ bid: { ...b, checks: [...b.checks, { key: 'prime-experience', label: 'x', message: 'y' }] } }), '公告の抜き書きを確かめ、認められる実績の範囲を発注者の公告と説明書で確かめてください。');
  assert.match(subOf({ bid: b, values: {} }), /。答えるか「分からない」を選ぶまで、結果は仮の一覧です。$/);
});

test('前の仕掛けの名前が src に無い', () => {
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(new URL(e.name + '/', dir)) : [new URL(e.name, dir)]));
  for (const file of walk(new URL('../../src/', import.meta.url))) {
    if (!/\.(mjs|html|css)$/.test(file.pathname)) continue;
    const text = fs.readFileSync(file, 'utf8');
    for (const word of ['showsPoint', 'nextShowsPoint', 'first-point-above', 'point-full', 'point-ref']) {
      assert.ok(!text.includes(word), file.pathname + ': ' + word);
    }
  }
});

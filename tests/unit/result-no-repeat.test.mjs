// F83a12: 結果の画面(段2)で、20字以上の同じ文を2回出さない。2回目からは「→ 上の「節の名前」を見てください」の1行にする。
// 紙は節ごとに読むので文を残す(閉じた折りたたみの中身・.print-only・.print-inline は「全部を印刷」の分で、数えない)
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHtml } from '../../build.mjs';
import { runPage } from '../acceptance/_helpers.mjs';
import { renderBidResult, renderOpenItems, renderResultTop } from '../../src/ui/view.mjs';
import { SAMPLE } from '../../src/sample.mjs';
import { readBidForm } from '../../src/ui/form.mjs';
import { bidCheck } from '../../src/bid-check.mjs';

const html = buildHtml();
const RESULT_BOXES = ['sample-status', 'result-top', 'bid-result', 'taicho-result', 'schedule-result', 'safety-result', 'open-items', 'summary'];
const MIN = 20;
const VOID = new Set(['br', 'hr', 'img', 'input', 'meta', 'link']);
const BLOCK = /^(p|li|h\d|div|summary|td|th|dt|dd|blockquote|ul|ol|tr|table|dl|details)$/;
const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

// 画面に見える字を取り出す。pointAbove は #bid-result に first-point-above が付いているとき
function visibleText(source, { pointAbove = false, paper = false } = {}) {
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
      : has('print-only') || has('print-inline') || has('point-ref') !== pointAbove && (has('point-ref') || has('point-full')) || /\shidden(\s|$)/.test(attrs)
        || (parent?.closedDetails === true && name !== 'summary');
    const closedDetails = !paper && name === 'details' && !/\sopen(\s|$)/.test(attrs);
    stack.push({ name, hide, closedDetails });
  }
  if (!hiddenNow()) out += source.slice(at);
  return decode(out);
}
function sentences(text) {
  return text.split('\n').flatMap((line) => line.split(/(?<=。)/)).map((s) => s.trim()).filter((s) => s.length >= MIN);
}
function repeats(page) {
  const pointAbove = page.el('bid-result').classList.contains('first-point-above');
  const seen = new Map();
  for (const id of RESULT_BOXES) {
    for (const s of sentences(visibleText(page.el(id).innerHTML, { pointAbove: id === 'bid-result' && pointAbove }))) {
      seen.set(s, [...(seen.get(s) ?? []), id]);
    }
  }
  return [...seen].filter(([, where]) => where.length > 1).map(([s, where]) => where.join('+') + ': ' + s.slice(0, 60));
}
async function samplePage() {
  const page = runPage(html);
  await page.click('sample-load');
  await page.click('confirm-go');
  return page;
}
const SEE_ABOVE = /→ 上の「[^」]+」を見てください/;
const SEE_BELOW = /→ 下の「[^」]+」を見てください/;
const bid = () => bidCheck(readBidForm(SAMPLE.form));

test('見本の結果: 画面に見える文で、20字以上の同じ文が2回以上出ない', async () => {
  assert.deepEqual(repeats(await samplePage()), []);
});

test('この試験の数え方: 外した文は数えず、見える文の重なりは見つける', () => {
  assert.deepEqual(sentences('あいうえおかきくけこさしすせそたちつてとな。短い。'), ['あいうえおかきくけこさしすせそたちつてとな。']);
  const text = (h) => visibleText(h).trim();
  assert.equal(text('<details class="basis"><summary>見出し</summary><p>中身</p></details>'), '見出し');
  assert.equal(text('<details open><summary>見出し</summary><p>中身</p></details>').replace(/\s/g, ''), '見出し中身');
  assert.equal(text('<p>見える<span class="print-inline">紙だけ</span></p><ul class="print-only"><li>紙だけ</li></ul>'), '見える');
  assert.equal(visibleText('<span class="point-full">文</span><span class="point-ref no-print">参照</span>').trim(), '文');
  assert.equal(visibleText('<span class="point-full">文</span><span class="point-ref no-print">参照</span>', { pointAbove: true }).trim(), '参照');
  assert.equal(visibleText('<p class="no-print">画面だけ</p><p class="print-only">紙</p>', { paper: true }).trim(), '紙');
});

test('確認が要る点の文は最後の一覧に全文で出て、入札前の確認の節は参照の1行になる。行き先は最後の一覧', () => {
  const b = bid();
  const shown = visibleText(renderOpenItems(b, SAMPLE.form));
  const out = renderBidResult(b, SAMPLE.form);
  const section = visibleText(out);
  assert.ok(section.includes('→ 下の「確認が要る点と未回答の質問」を見てください'), section);
  assert.equal(section.match(new RegExp(SEE_BELOW.source, 'g')).length, 1, '1行にする');
  assert.ok(out.includes('href="#open-items">→ 下の「'));
  assert.ok(!SEE_ABOVE.test(shown), shown);
  assert.match(out, /<h3>確認が要る点\(\d+件\)<\/h3>(<p class="points-note">[^<]*<\/p>)?<p class="points-note" id="bid-checks">/);
  for (const c of b.checks) {
    assert.ok(shown.includes(c.message), c.label);
    assert.ok(!section.includes(c.message.slice(0, 20)), c.label);
  }
  // 件数の見出しは画面に残す
  assert.match(shown, /確認が要る点\(\d+件\)/);
  assert.match(section, /確認が要る点\(\d+件\)/);
});

test('確認が要る点が無ければ、参照の行は出さない', () => {
  const open = renderOpenItems({ items: [], checks: [] }, {});
  assert.ok(!SEE_ABOVE.test(open));
  assert.ok(visibleText(open).includes('ありません'));
});

test('紙: 確認が要る点の文と根拠は、まとめの紙(#open-items)にも全部の紙(#bid-result)にも残る。参照の行は紙に出ない', () => {
  const b = bid();
  const open = visibleText(renderOpenItems(b, SAMPLE.form), { paper: true });
  const full = visibleText(renderBidResult(b, SAMPLE.form), { paper: true });
  assert.ok(b.checks.length >= 2);
  for (const c of b.checks) {
    for (const text of [open, full]) {
      assert.ok(text.includes(c.message), c.label);
      assert.ok(!SEE_ABOVE.test(text), '紙に参照の行がある');
    }
  }
  assert.ok(open.includes('根拠を見る: ') && full.split('根拠を見る: 建設業法 第26条第3項').length >= 3, '根拠の見出しが紙から消えた');
  assert.ok(full.includes('当てはまるかは「根拠を見る」で確かめてください。'));
});

test('画面と紙の決まり: .print-inline と .print-only は画面で隠し、紙で出す。参照の1行は紙で隠す', () => {
  const css = html.match(/<style>([\s\S]*?)<\/style>/)[1].replace(/\/\*[\s\S]*?\*\//g, '');
  const at = css.indexOf('@media print');
  const screen = css.slice(0, at);
  const paper = css.slice(at);
  assert.match(screen, /\.print-only \{ display: none; \}/);
  assert.match(screen, /\.print-inline \{ display: none; \}/);
  assert.match(paper, /\.print-only \{ display: block; \}/);
  assert.match(paper, /\.print-inline \{ display: inline; \}/);
  assert.match(paper, /\.no-print \{ display: none !important; \}/);
});

test('1件目の文: カードには出さず最後の一覧に出て、条件が変わってカードの文が替わっても最後の一覧に残る', async () => {
  const page = await samplePage();
  const open = page.el('open-items');
  const first = bid().checks[0];
  assert.ok(page.el('result-top').innerHTML.includes('確認が要る点'));
  assert.ok(!page.el('result-top').innerHTML.includes(first.message));
  assert.ok(visibleText(open.innerHTML).includes(first.message));
  page.set('orderer', 'private');
  const input = page.el('orderer');
  input.dispatchEvent?.({ type: 'change', target: input, bubbles: true });
  const stale = page.el('result-top').innerHTML.includes('もう一度「確認する」を押す');
  if (stale) assert.ok(visibleText(open.innerHTML).includes(first.message), '条件が変わったら文が消えた');
  assert.ok(stale, '条件を変えたあとのカードの形を確かめられなかった');
});

test('次にすることのカードは、どの状態でも点の文を出さない', () => {
  const b = bid();
  const top = (state) => renderResultTop(state).includes(b.checks[0].message);
  const cases = [
    { bid: b, values: SAMPLE.form },
    { bid: b, values: SAMPLE.form, stale: true },
    { bid: b, values: {} },
    { errors: ['x'], bid: b },
    { bid: { ...b, checks: [...b.checks, { key: 'prime-experience', label: 'x', message: 'y' }] }, values: SAMPLE.form },
    { bid: { ...b, checks: [] }, values: SAMPLE.form },
  ];
  assert.deepEqual(cases.map(top), [false, false, false, false, false, false]);
});

test('項目のカードと同じ根拠の折りたたみは画面で1回。別の根拠の点は最後の一覧に残す', () => {
  const open = renderOpenItems(bid(), SAMPLE.form);
  const shown = visibleText(renderBidResult(bid(), SAMPLE.form)) + '\n' + visibleText(open);
  const labels = shown.split('\n').filter((l) => l.startsWith('根拠を見る: '));
  assert.equal(new Set(labels).size, labels.length, '同じ根拠の見出しが2回ある');
  assert.ok(visibleText(open).split('\n').some((l) => l.startsWith('根拠を見る: ') && l.includes('監理技術者制度運用マニュアル')), '別の根拠の点の折りたたみが消えた');
  assert.equal(open.split('<div class="print-only"><details class="basis">').length - 1, 1);
});

test('要る項目の決まった文は画面では節の頭の1回で、カードごとの文は紙に残す', () => {
  const out = renderBidResult(bid(), SAMPLE.form);
  const shown = visibleText(out, { pointAbove: true });
  assert.ok(shown.indexOf('次にすることの行が当てはまるかは、各項目の「根拠を見る」で確かめてください。') < shown.indexOf('次にすること: '));
  assert.ok(!shown.includes('当てはまるかは「根拠を見る」で確かめてください。'));
  assert.equal(out.split('<span class="item-next-note print-inline">').length - 1, 6);
  const none = renderBidResult({ items: [{ key: 'n', label: 'いらない', status: 'not_required', basis: [] }], checks: [] });
  assert.ok(!none.includes('次にすることの行が'), '要るの項目が無いのに出ている');
});

test('まとめの「このうち」の文は、入札前の確認の見出しの下に1回。紙のまとめには残す', async () => {
  const page = await samplePage();
  const sum = page.el('summary').innerHTML;
  assert.ok(visibleText(sum, { paper: true }).includes('このうち 2件は'));
  assert.ok(!visibleText(sum).includes('このうち 2件は'));
  assert.ok(visibleText(page.el('bid-result').innerHTML, { pointAbove: true }).includes('このうち 2件は'));
});

test('安全の候補: 同じ作業の文は2つ目の候補で最初の候補を指す1行になり、紙には文が残る', async () => {
  const page = await samplePage();
  const out = page.el('safety-result').innerHTML;
  const shown = visibleText(out);
  const ref = shown.match(/→ 上の「([^」]+)」を見てください/);
  assert.ok(ref, '参照の行が無い');
  const paper = visibleText(out, { paper: true });
  for (const s of ['技能講習を修了した者などのうちから作業主任者', '第十四条の義務は「事業者」に掛かります', '＊「同じ場所で常時働く人の数」を入れると判断できます']) {
    assert.equal(shown.split(s).length - 1, 1, s);
    assert.equal(paper.split(s).length - 1, 2, '紙で減った: ' + s);
  }
  for (const m of out.matchAll(/class="see-above" href="#([\w-]+)"/g)) assert.ok(out.includes('id="' + m[1] + '"'), m[1]);
});

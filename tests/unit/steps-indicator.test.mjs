// F86b: 進み具合は「①入口 ─ ②条件 ─ ③結果 ─ ④書類」の押せない印。段の番号は画面の文から外す。
// ブラウザが無いので、幅 320・390 で1行に入るかは字の幅の見積もりで見る(Edge の確かめは統括)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildHtml } from '../../build.mjs';
import { runPage } from '../acceptance/_helpers.mjs';

const read = (p) => fs.readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const html = buildHtml();
const body = html.slice(html.indexOf('<body')).replace(/<script\b[\s\S]*?<\/script>/g, '');
const css = html.match(/<style>([\s\S]*?)<\/style>/)[1].replace(/\/\*[\s\S]*?\*\//g, '');
const printCss = css.match(/@media print \{([\s\S]*)\n {2}\}/)[1];
const narrow = css.match(/@media \(max-width: 40rem\) \{[\s\S]*?\n {2}\}/)[0];
const pager = () => import('../../src/ui/pager.mjs');

const IDS = ['step-0', 'step-1', 'step-2', 'step-3'];
const current = (page) => IDS.filter((id) => page.el(id).getAttribute('aria-current') === 'step');
const ol = () => body.match(/<ol class="steps" id="steps"[^>]*>[\s\S]*?<\/ol>/)?.[0] ?? '';

// 画面に出る文: HTML は紙だけの印(.print-num)を除いた残り、.mjs は注釈を除いた文字列の値(ui-terms と同じ読み方)
const htmlText = (s) => s.replace(/<style>[\s\S]*?<\/style>/g, '').replace(/<script\b[\s\S]*?<\/script>/g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/<span class="print-num">[^<]*<\/span>/g, '');
function mjsText(s) {
  const code = s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  return [...code.matchAll(/'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g)].map((m) => m[0]).join('\n');
}
const SCREEN = {
  'src/ui/shell.html': htmlText(read('src/ui/shell.html')),
  'src/ui/view.mjs': mjsText(read('src/ui/view.mjs')),
  'src/ui/safety-view.mjs': mjsText(read('src/ui/safety-view.mjs')),
  'src/ui/app.mjs': mjsText(read('src/ui/app.mjs')),
  'src/ui/mask-app.mjs': mjsText(read('src/ui/mask-app.mjs')),
};

test('#steps: button もリンクも無く、入口・条件・結果・書類の4つの順で番号が1から付く', () => {
  const list = ol();
  assert.ok(list, '#steps が無い');
  assert.ok(!/<(button|a)\b/.test(list), '押せる物がある');
  assert.ok(!/tabindex|onclick|\brole=/.test(list), '押せる物に見せる属性がある');
  const li = [...list.matchAll(/<li id="(step-\d)"[^>]*><span class="step-dot">(\d)<\/span><span class="step-name">([^<]+)<\/span><\/li>/g)];
  assert.deepEqual(li.map((m) => [m[1], m[2], m[3]]), [['step-0', '1', '入口'], ['step-1', '2', '条件'], ['step-2', '3', '結果'], ['step-3', '4', '書類']]);
});

test('#steps: 押す仕掛けが残っていない', async () => {
  assert.ok(!/step-'/.test(read('src/ui/app.mjs')), 'app.mjs が段の印を触っている');
  assert.ok(!/\.steps button|\.steps [^{]*:hover|\.step-dot:hover/.test(css), '段の印に押す形の決まりがある');
  const page = runPage(html);
  await page.click('sample-load');
  await page.click('confirm-go');
  await page.click('step-1');
  assert.equal(page.el('panel-2').hidden, false, '印を押すと段が替わった');
  assert.deepEqual(current(page), ['step-2']);
});

test('今の段だけ aria-current: 入口でも印が付き、確かめは条件の段に数える', async () => {
  const page = runPage(html);
  assert.deepEqual(current(page), ['step-0'], '開いた直後');
  assert.match(ol(), /<li id="step-0" aria-current="step">/, '組み立てた HTML の時点で入口に印が無い');
  await page.click('entry-bid');
  assert.deepEqual(current(page), ['step-1'], '条件');
  await page.click('bid-run');
  assert.deepEqual(current(page), ['step-1'], '確かめ');
  await page.click('confirm-go');
  assert.deepEqual(current(page), ['step-2'], '結果');
  await page.click('next-step-3');
  assert.deepEqual(current(page), ['step-3'], '書類');
  await page.click('pg-back');
  assert.deepEqual(current(page), ['step-2'], '書類から戻る');
  await page.click('pg-back');
  assert.deepEqual(current(page), ['step-1'], '結果から確かめへ戻る');
  await page.click('confirm-back');
  assert.deepEqual(current(page), ['step-1'], '確かめから条件へ戻る');
  await page.click('pg-back');
  assert.deepEqual(current(page), ['step-0'], '入口へ戻る');
});

test('別の道具のページでは、どの段にも印を付けない。入口に戻ると入口に印が付く', async () => {
  const page = runPage(html);
  const tools = page.el('other-tools');
  tools.open = true;
  tools.dispatchEvent({ type: 'toggle', bubbles: false });
  assert.equal(page.el('pg-tools').hidden, false, '別の道具のページが開いていない');
  assert.deepEqual(current(page), []);
  await page.click('pg-back');
  assert.deepEqual(current(page), ['step-0']);
});

test('進み具合は入口でも見える: 入口の中に入れず、#entry の前に置く', () => {
  const at = body.indexOf('id="progress"');
  assert.ok(at > 0, '#progress が無い');
  assert.ok(at > body.indexOf('id="start"') && at < body.indexOf('id="entry"'), '入口のタイルの上に無い');
  assert.ok(!/[^\n]*hidden/.test(body.match(/<div[^>]*id="progress"[^>]*>/)[0]));
  assert.ok(!/(^|[\s,}])(#steps|\.steps|#progress|\.progress)\s*\{[^}]*display: none/.test(css.replace(printCss, '')), '画面で隠している');
});

test('#pg-count: 進み具合の横にあり「1/7 要点」の形で、幅 40rem 以下は名前を隠す。紙に出ない', async () => {
  const row = body.match(/<div[^>]*id="progress"[^>]*>[\s\S]*?<\/ol>\s*(<span id="pg-count">[\s\S]*?)<\/div>/);
  assert.ok(row, '#pg-count が進み具合の横に無い');
  assert.match(row[1], /<span id="pg-num"><\/span> <span id="pg-name"><\/span>/);
  assert.match(body.match(/<div[^>]*id="progress"[^>]*>/)[0], /no-print/);
  assert.ok(!body.match(/<nav\b[^>]*id="pager"[^>]*>[\s\S]*?<\/nav>/)[0].includes('pg-count'), '下の帯に残っている');
  assert.match(narrow, /#pg-name \{ display: none; \}/);
  assert.ok(!/#pg-num[^{]*\{[^}]*display: none/.test(css), '番号を隠している');

  const { PAGES, showPage, hidePages } = await pager();
  const saved = PAGES[2];
  const els = {};
  const el = (id) => (els[id] ??= { id, hidden: false, scrollTop: 0, textContent: '', attrs: {}, focus() {}, setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; } });
  const doc = { getElementById: el };
  PAGES[2] = [['pg-x', '要点', 'x-title'], ['pg-y', '要るもの', 'y-title']];
  try {
    showPage(doc, 2, 1);
    assert.equal(el('pg-num').textContent + ' ' + el('pg-name').textContent, '2/2 要るもの');
    assert.equal(el('step-2').attrs['aria-current'], 'step');
    showPage(doc, 'confirm', 0);
    assert.equal(el('pg-num').textContent + el('pg-name').textContent, '', '1ページの一覧に数を出している');
    assert.equal(el('step-2').attrs['aria-current'], undefined);
    assert.equal(el('step-1').attrs['aria-current'], 'step');
    showPage(doc, 2, 0);
    hidePages(doc);
    assert.equal(el('pg-num').textContent + el('pg-name').textContent, '', '入口に数が残っている');
    assert.equal(el('step-0').attrs['aria-current'], 'step');
  } finally { PAGES[2] = saved; hidePages(doc); }
});

test('幅 320・390 の見積もり: 字を小さくせず、丸・線・4つの名前・「1/7」が1行に入る', () => {
  const REM = 16;
  const rem = (block, sel, prop) => {
    const rule = [...block.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find((m) => m[1].trim() === sel)?.[2] ?? '';
    return parseFloat(rule.match(new RegExp('(?:^|[;\\s])' + prop + ': ([\\d.]+)rem'))?.[1] ?? 'NaN') * REM;
  };
  assert.ok(!/\.step|#steps|#pg-/.test((narrow.match(/[^{}]*\{[^}]*font-size[^}]*\}/g) ?? []).join('\n')), '狭い画面で段の字を小さくしている');
  assert.ok(!/step-name/.test(narrow), '狭い画面で段の名前を隠している');
  const dot = rem(narrow, '.step-dot', 'width');
  const line = rem(narrow, '.steps li + li::before', 'width');
  const gap = rem(css, '.steps li', 'gap');
  const rowGap = rem(css, '.progress', 'gap');
  assert.ok(dot > 0 && line > 0 && gap > 0 && rowGap > 0, '見積もりに使う決まりが読めない');
  const names = 2 * REM;
  const steps = 4 * (dot + gap + names) + 3 * (line + gap);
  const count = 1.5 * REM; // 「1/7」は半角3字で 1.5em ほど
  const used = steps + rowGap + count;
  for (const width of [320, 390]) assert.ok(used <= width - 0.75 * REM * 2, width + ' に入らない: ' + used);
});

test('「1.」の見出しの番号は画面で隠し紙に残す。3-1・3-2 の番号は無い', () => {
  assert.match(body, /<h2 id="bid-title" tabindex="-1"><span class="print-num">1\. <\/span>入札前の確認と、施工体制台帳が要るか<\/h2>/);
  assert.match(css.slice(0, css.indexOf('@media print')), /(^|\n)\s*\.print-num \{ display: none; \}/);
  assert.match(printCss, /\.print-num \{ display: inline; \}/);
  assert.match(body, /<h2 id="ledger-title" tabindex="-1">施工体制台帳の点検<\/h2>/);
  assert.match(body, /<h2>施工計画書の目次の点検<\/h2>/);
});

test('古い番号の語が画面の文に無い', () => {
  const OLD = ['1 条件を入れる', '2 結果を見る', '3 書類を確かめる', '1 条件に戻る', '上の 1.', '上の「1.」', '〜3.', '〜「3.」', '上の進み具合', '段階の「', '3-1.', '3-2.', '1. 入札前'];
  for (const [file, text] of Object.entries(SCREEN)) {
    for (const w of OLD) assert.ok(!text.includes(w), file + ' に「' + w + '」が残っている');
  }
  // 見張りが効くこと
  assert.ok(htmlText('<p>上の 1.〜3.</p>').includes('上の 1.'));
  assert.ok(mjsText("const x = '3 書類を確かめる';").includes('3 書類を確かめる'));
});

test('直した文: 戻り方の文のとおりに押せて、語が今の席に合う', async () => {
  const words = {
    'confirm-back': '戻る',
    'next-step-3': '次へ: 書類を確かめる',
  };
  for (const [id, text] of Object.entries(words)) assert.ok(body.includes('id="' + id + '">' + text + '</button>'), id);
  const note = body.match(/<p[^>]*id="panel-3-print-note"[^>]*>([^<]*)<\/p>/)[1];
  assert.ok(note.startsWith('紙や PDF にするときは、「戻る」で「結果」のページに戻り、「全部を印刷する」を押してください。'), note);
  const page = runPage(html);
  await page.click('sample-load');
  await page.click('confirm-go');
  await page.click('next-step-3');
  await page.click('pg-back');
  assert.equal(page.el('panel-2').hidden, false, '書類の「戻る」で結果に着かない');
});

test('文の直しで言わない語を足していない', () => {
  for (const w of ['事故を防げる', '指名停止を防ぐ', '初心者でもできる', 'あらゆる公共工事に対応', '積算できる']) {
    for (const [file, text] of Object.entries(SCREEN)) assert.ok(!text.includes(w), file + ' に「' + w + '」がある');
  }
});

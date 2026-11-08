// F89a: 表を枠で見せるページ(受注後の段取り・記載事項の表・置き換えた結果)で、枠がページの残りの高さをほぼ取る。
// ブラウザが無いので実測はしない(Edge の確かめは統括)。組み立てた画面の HTML と CSS の値から、1280×900 と 390×844 の高さを見積もる。
// 見積もりの決まり:
// - ページの高さ = 画面の高さ − ページの外の帯(上の帯・注意の帯・進み具合・下の帯。この機能では変えないので見積もりの値を置く)
// - 残り = ページの高さ − 見出し − 知らせ(注記と aria-live の行)。枠の割合 = 枠 ÷ 残り = 1 − 枠の外の物 ÷ 残り
// - 枠の外の物 = 折りたたみの見出しと CSV のボタンの行、画面に出る説明の文。行の高さは字の数と幅から折り返しを数える(全角1字 = 1em、半角 = 0.55em)
// 基準(統括の判断 2026-11-08): 1280×900 で 9割以上、390×844 で 8割以上。押す所は枠の外のまま
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHtml } from '../../build.mjs';

const html = buildHtml();
const body = html.slice(html.indexOf('<body>')).replace(/<script\b[\s\S]*?<\/script>/g, '');
const css = html.match(/<style>([\s\S]*?)<\/style>/)[1].replace(/\/\*[\s\S]*?\*\//g, '');
const mediaBlocks = (head) => css.split(/^ {2}(?=@media )/m).filter((s) => s.startsWith(head + ' {')).map((s) => s.slice(0, s.search(/^ {2}\}/m)));
const screenCss = mediaBlocks('@media screen').join('\n');
const narrowCss = mediaBlocks('@media screen and (max-width: 40rem)').join('\n');
const lowCss = mediaBlocks('@media screen and (max-height: 30rem)').join('\n');

const REM = 16;
const LINE = 1.7 * REM; // 本文の行の高さ
const VIEWS = [
  // bands: 上の帯・注意の帯・進み具合・下の帯の高さ(px)。min: 枠の割合の下限
  { name: '1280×900', width: 1280, height: 900, narrow: false, coarse: false, bands: [60, 59, 52, 61], min: 0.9 },
  { name: '390×844', width: 390, height: 844, narrow: true, coarse: true, bands: [56, 86, 56, 65], min: 0.8 },
];
// 表の1行が取る高さの見積もり(一度に見える行の数を notes に書くため。1280 は表の行、390 はカード)
const ROW_PX = { 'pg-2-schedule': { wide: 80, narrow: 330 }, 'pg-3-table': { wide: 60, narrow: 230 } };

const pageHtml = (id) => {
  const at = body.indexOf('<div class="pg pg-framed" id="' + id + '"');
  assert.ok(at >= 0, id);
  const end = body.indexOf('<div class="pg', at + 10);
  return body.slice(at, end < 0 ? undefined : end);
};
// CSS の規則: セレクタの並びにその名前がそのまま入る規則の宣言を、書いた順に重ねる
function decl(text, sel) {
  const out = {};
  for (const m of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!m[1].split(',').map((s) => s.trim()).includes(sel)) continue;
    for (const d of m[2].split(';')) {
      const i = d.indexOf(':');
      if (i > 0) out[d.slice(0, i).trim()] = d.slice(i + 1).trim();
    }
  }
  return out;
}
const at = (view, sel) => ({ ...decl(screenCss, sel), ...(view.narrow ? decl(narrowCss, sel) : {}) });
const px = (v) => (v.endsWith('rem') ? parseFloat(v) * REM : parseFloat(v) || 0);
const marginY = (v, fallback) => {
  if (v === undefined) return fallback;
  const p = v.split(/\s+/).map(px);
  return p[0] + (p.length > 2 ? p[2] : p[0]);
};
const em = (s) => [...s].reduce((n, c) => n + (/[\x20-\x7e]/.test(c) ? 0.55 : 1), 0);
const lines = (s, fontPx, width) => Math.max(1, Math.ceil((em(s) * fontPx) / width));
// その幅で画面の外へ置く(読み上げに残す)クラス
const offScreen = (view, cls) => /clip-path: inset\(50%\)/.test(Object.entries(at(view, '.' + cls)).map(([k, v]) => k + ': ' + v).join('; '));
const visibleText = (view, inner) => inner
  .replace(/<span class="([^"]+)">([^<]*)<\/span>/g, (m, cls, t) => (offScreen(view, cls) ? '' : t))
  .replace(/<[^>]+>/g, '').replace(/&[a-z]+;/g, 'x').trim();
// grid の置き場: 2つの名前が grid-template-areas の同じ行にあるか
function sameRow(view, pageSel, a, b) {
  const page = at(view, pageSel + ':not([hidden])');
  if (page.display !== 'grid' || !page['grid-template-areas']) return false;
  const area = (sel) => at(view, sel)['grid-area'];
  const [x, y] = [area(a), area(b)];
  return !!x && !!y && page['grid-template-areas'].match(/"[^"]*"/g).some((row) => row.split(/[\s"]+/).includes(x) && row.split(/[\s"]+/).includes(y));
}

// ページごとに、枠の外の物を数える
const PAGES = [
  {
    id: 'pg-2-schedule', heading: 'schedule-heading', headingMargin: 24, frame: 'schedule-frame',
    notices: [['schedule-notice', null]], status: { id: 'schedule-status', text: '段取り 23行。', inBar: true },
    fold: { sel: '#schedule-more', summary: '#schedule-more > summary' }, bar: { sel: '#pg-2-schedule > .export', button: 'schedule-csv-btn' },
  },
  {
    id: 'pg-3-table', heading: 'checklist-title', headingMargin: 24, frame: null,
    notices: [], status: { id: 'checklist-status', text: '記載事項の表を出しました。', inBar: false },
    fold: { sel: '#pg-3-table > details.fold', summary: '#pg-3-table > details.fold > summary' }, bar: { sel: '#pg-3-table > .row', button: 'checklist-csv-btn' },
  },
];

function estimate(view, spec) {
  const src = pageHtml(spec.id);
  const W = Math.min(view.width, 60 * REM) - (view.narrow ? 1.5 : 2) * REM - 0.5 * REM; // .wrap と .pg の左右の余白
  const minH = (view.coarse ? 3 : 2.75) * REM;
  const page = view.height - view.bands.reduce((a, b) => a + b, 0);
  // 見出し
  const h = src.match(new RegExp('<h[23] id="' + spec.heading + '"[^>]*>([\\s\\S]*?)</h[23]>'));
  const hd = at(view, '#' + spec.heading);
  const heading = lines(visibleText(view, h[1]), 1.1875 * REM, W) * 1.1875 * REM * 1.4 + marginY(hd.margin, spec.headingMargin);
  // 注記(左の線と余白の分だけ幅が狭い)
  let notices = 0;
  for (const [id] of spec.notices) {
    const t = visibleText(view, src.match(new RegExp('id="' + id + '"[^>]*>([^<]*)<'))[1]);
    notices += lines(t, REM, W - 28) * LINE + 8 + 4;
  }
  // 折りたたみの見出しとボタンの行
  const side = sameRow(view, '#' + spec.id, spec.fold.sel, spec.bar.sel);
  const pageRule = at(view, '#' + spec.id + ':not([hidden])');
  const colGap = side ? px(pageRule['column-gap'] ?? '0') : 0;
  const btn = src.match(new RegExp('<button type="button" id="' + spec.bar.button + '">([\\s\\S]*?)</button>'));
  const btnText = visibleText(view, btn[1]);
  const nowrap = at(view, '#' + spec.bar.button)['white-space'] === 'nowrap';
  const btnW = em(btnText) * REM + 2 * REM + 2 + 0.25 * REM;
  const statusW = em(spec.status.text) * REM;
  let col1 = W;
  let col2 = W;
  if (side) {
    const cols = pageRule['grid-template-columns'] ?? '';
    col2 = cols.endsWith('min-content') ? (nowrap ? btnW : REM) : Math.min(btnW + 0.75 * REM + statusW, W - colGap);
    col1 = W - colGap - col2;
  }
  const sumPad = px((at(view, spec.fold.summary).padding ?? '0.75rem').split(/\s+/)[0]) * 2;
  const sumText = visibleText(view, src.match(new RegExp(spec.fold.sel.startsWith('#schedule') ? '<details class="fold" id="schedule-more"><summary>([\\s\\S]*?)</summary>' : '<details class="fold"><summary>([\\s\\S]*?)</summary>'))[1]);
  const summary = Math.max(minH, lines('▶ ' + sumText, REM, col1) * LINE + sumPad);
  const btnLines = nowrap || btnW <= col2 ? 1 : lines(btnText, REM, Math.max(REM, col2 - 2.25 * REM));
  const button = Math.max(minH, btnLines * LINE + REM + 2) + 0.5 * REM + marginY(at(view, spec.bar.sel).margin, spec.bar.sel.endsWith('.row') ? REM : 0.25 * REM);
  const statusWrapped = btnW + 0.75 * REM + statusW > col2;
  let others;
  if (side) {
    others = Math.max(summary, button);
    if (spec.status.inBar && statusWrapped) notices += Math.max(0, button + LINE - others);
  } else {
    others = summary + button;
    if (spec.status.inBar && statusWrapped) notices += LINE;
  }
  if (!spec.status.inBar) notices += LINE + marginY(at(view, '#' + spec.status.id).margin, 2 * REM);
  // 画面に出る説明の文(print-only・hidden・知らせでない、ページの直下の p)
  const [, intro] = src.match(/<\/h[23]>\n((?:<p>[^<]*<\/p>\n)*)/) ?? [];
  for (const m of (intro ?? '').matchAll(/<p>([^<]*)<\/p>/g)) others += lines(m[1], REM, W) * LINE + 2 * REM;
  const remaining = page - heading - notices;
  const frame = remaining - others;
  return { page, remaining, frame, others, side, ratio: frame / remaining };
}

for (const view of VIEWS) {
  for (const spec of PAGES) {
    test(view.name + ' ' + spec.id + ': 枠が残りの高さの ' + view.min * 100 + '% 以上', () => {
      const e = estimate(view, spec);
      const rows = (e.frame / ROW_PX[spec.id][view.narrow ? 'narrow' : 'wide']).toFixed(1);
      const msg = `ページ ${e.page.toFixed(0)}px・残り ${e.remaining.toFixed(0)}px・枠 ${e.frame.toFixed(0)}px・枠の外 ${e.others.toFixed(0)}px・割合 ${(e.ratio * 100).toFixed(1)}%・一度に見える行 約${rows}`;
      test.diagnostic?.(msg);
      console.log(view.name, spec.id, msg);
      assert.ok(e.ratio >= view.min, msg);
      // ページ全体は縦に動かない: 枠の最小の高さ(12rem)を足しても画面に収まる
      assert.ok(e.page - e.remaining + e.others + 12 * REM <= e.page, msg);
    });
  }
}

test('押す所(折りたたみの見出しと CSV のボタン)は枠の外のままで、HTML の順は変えていない', () => {
  const s = pageHtml('pg-2-schedule');
  const frame = s.match(/<div class="ref-frame" id="schedule-frame">[\s\S]*?\n<\/div>/)[0];
  for (const id of ['schedule-more', 'schedule-csv-btn']) assert.ok(!frame.includes('id="' + id + '"'), id);
  assert.ok(s.indexOf('id="schedule-more"') < s.indexOf('id="schedule-frame"') && s.indexOf('id="schedule-frame"') < s.indexOf('id="schedule-csv-btn"'));
  const t = pageHtml('pg-3-table');
  const tf = t.match(/<div class="ref-frame">[\s\S]*?<\/div><\/div>/)[0];
  assert.ok(!tf.includes('checklist-csv-btn'));
  const order = ['<details class="fold">', 'id="checklist-csv-btn"', 'id="checklist-status"', 'class="ref-frame"'];
  const pos = order.map((m) => t.indexOf(m));
  assert.deepEqual(pos, [...pos].sort((a, b) => a - b), '記載事項の表のページの順');
});

test('CSV のボタンの名前は読み上げで今のまま(画面の外へ置くのは幅 40rem 以下の前置きだけ)', () => {
  for (const [id, name] of [['schedule-csv-btn', '段取りを CSV に書き出す'], ['checklist-csv-btn', '記載事項の表を CSV に書き出す']]) {
    const inner = body.match(new RegExp('<button type="button" id="' + id + '">([\\s\\S]*?)</button>'))[1];
    assert.equal(inner.replace(/<[^>]+>/g, ''), name, id);
    assert.ok(visibleText(VIEWS[0], inner).includes(name), id + ' は 1280 で全部見える');
    assert.ok(visibleText(VIEWS[1], inner).endsWith('CSV に書き出す'), id + ' は 390 でも何をするかが見える');
  }
});

test('記載事項の表の説明の文は紙に残り、画面では「この表の見方」の中にある', () => {
  const t = pageHtml('pg-3-table');
  const intro = t.match(/<p class="print-only">([^<]*)<\/p>/);
  assert.ok(intro, '説明の文が紙に残っていない');
  const fold = t.match(/<details class="fold"><summary>この表の見方と「確認した」の印<\/summary>\n<p>([^<]*)<\/p>/)[1];
  for (const w of ['「台帳を点検する」を押すと', '記載事項ごとに', '「空」か「判断できない」かを表で出します']) {
    assert.ok(intro[1].includes(w) && fold.includes(w), w);
  }
});

test('置き換えた結果のページは見出しと枠だけで、枠の外に押す所や説明が無い', () => {
  const r = pageHtml('pg-tools-result');
  assert.match(r, /^<div class="pg pg-framed" id="pg-tools-result" hidden>\n<h2 id="mask-result-title" tabindex="-1">置き換えた結果<\/h2>\n<div class="ref-frame" id="mask-frame">/);
  assert.match(r, /\n<\/div>\n<\/div>\n?$/);
});

test('背の低い画面では grid も外して全体が動く形に戻す', () => {
  for (const id of ['pg-2-schedule', 'pg-3-table']) {
    assert.equal(decl(screenCss, '#' + id + ':not([hidden])').display, 'grid', id);
    assert.equal(decl(lowCss, '#' + id + ':not([hidden])').display, 'block', id);
  }
});

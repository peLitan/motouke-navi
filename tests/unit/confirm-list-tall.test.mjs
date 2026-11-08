// F89b: 条件の確かめのページ(pg-confirm)で、「入れた条件を確かめてください」の一覧の枠がページの残りの高さをほぼ取る。
// ブラウザが無いので実測はしない(Edge の確かめは統括)。組み立てた画面の HTML と CSS の値から、1280×900 と 390×844 の高さを見積もる。
// 見積もりの決まり(F89a の table-frames-tall と同じ):
// - ページの高さ = 画面の高さ − ページの外の帯(上の帯・注意の帯・進み具合・下の帯。この機能では変えないので見積もりの値を置く)
// - 残り = ページの高さ − 見出し(このページに知らせの行は無い)。枠の割合 = 枠 ÷ 残り
// - 枠の外の物 = 画面に出る説明の文と、閉じた折りたたみの見出し。grid のときは同じ行の物の高い方と行の間を数え、flex のときは足す
// - 行の高さは字の数と幅から折り返しを数える(全角1字 = 1em、半角 = 0.55em)
// 基準(統括の判断 2026-11-08。F89a の回答 B で「F89b も同じ基準で」): 1280×900 で 9割以上、390×844 で 8割以上
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHtml } from '../../build.mjs';

const html = buildHtml();
const body = html.slice(html.indexOf('<body>')).replace(/<script\b[\s\S]*?<\/script>/g, '');
const css = html.match(/<style>([\s\S]*?)<\/style>/)[1].replace(/\/\*[\s\S]*?\*\//g, '');
const baseCss = css.split(/^ {2}(?=@media )/m)[0];
const mediaBlocks = (head) => css.split(/^ {2}(?=@media )/m).filter((s) => s.startsWith(head + ' {')).map((s) => s.slice(0, s.search(/^ {2}\}/m)));
const screenCss = mediaBlocks('@media screen').join('\n');
const narrowCss = mediaBlocks('@media screen and (max-width: 40rem)').join('\n');
const lowCss = mediaBlocks('@media screen and (max-height: 30rem)').join('\n');

const REM = 16;
const LINE = 1.7 * REM; // 本文の行の高さ
const VIEWS = [
  // bands: 上の帯・注意の帯・進み具合・下の帯の高さ(px。F89a と同じ見積もり)。min: 枠の割合の下限。row: 一覧の1行の高さの見積もり
  { name: '1280×900', width: 1280, height: 900, narrow: false, coarse: false, bands: [60, 59, 52, 61], min: 0.9, row: 71 },
  { name: '390×844', width: 390, height: 844, narrow: true, coarse: true, bands: [56, 86, 56, 65], min: 0.8, row: 107 },
];

const page = (() => {
  const at = body.indexOf('<div class="pg pg-framed" id="pg-confirm"');
  assert.ok(at >= 0, 'pg-confirm');
  return body.slice(at, body.indexOf('</div></section>', at));
})();
// ページの直下の物(折りたたみの中身と枠の中を除く)
const frameHtml = page.match(/<div class="ref-frame">[\s\S]*?<\/dl>\n<\/div>/)[0];
const foldsHtml = [...page.matchAll(/<details class="fold"(?: id="([^"]+)")?><summary>([^<]*)<\/summary>[\s\S]*?\n<\/details>/g)];
const topHtml = foldsHtml.reduce((s, m) => s.replace(m[0], ''), page.replace(frameHtml, ''));
const topParas = [...topHtml.matchAll(/<p(?: id="([^"]+)")?(?: class="([^"]+)")?>([^<]*)<\/p>/g)]
  .filter((m) => !/\b(print-only|sr-only)\b/.test(m[2] ?? ''))
  .map((m) => ({ sel: m[1] ? '#' + m[1] : 'p', text: m[3] }));
const folds = foldsHtml.map((m) => ({ sel: m[1] ? '#' + m[1] : 'details.fold', summarySel: (m[1] ? '#' + m[1] : 'details.fold') + ' > summary', text: m[2], inner: m[0] }));

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
const at = (view, ...sels) => Object.assign({}, ...sels.flatMap((sel) => [decl(baseCss, sel), decl(screenCss, sel), view.narrow ? decl(narrowCss, sel) : {}]));
const px = (v) => (v.endsWith('rem') ? parseFloat(v) * REM : parseFloat(v) || 0);
const marginY = (v, fallback) => {
  if (v === undefined) return fallback;
  const p = v.split(/\s+/).map(px);
  return p[0] + (p.length > 2 ? p[2] : p[0]);
};
const em = (s) => [...s].reduce((n, c) => n + (/[\x20-\x7e]/.test(c) ? 0.55 : 1), 0);
const lines = (s, fontPx, width) => Math.max(1, Math.ceil((em(s) * fontPx) / width));

function estimate(view) {
  const W = Math.min(view.width, 60 * REM) - (view.narrow ? 1.5 : 2) * REM - 0.5 * REM; // .wrap と .pg の左右の余白
  const minH = (view.coarse ? 3 : 2.75) * REM;
  const pageH = view.height - view.bands.reduce((a, b) => a + b, 0);
  // 見出し
  const hd = at(view, 'h2', '#confirm-title');
  const hText = page.match(/<h2 id="confirm-title"[^>]*>([^<]*)<\/h2>/)[1];
  const fs = px(hd['font-size'] ?? '1.5rem');
  const heading = lines(hText, fs, W) * fs * parseFloat(hd['line-height'] ?? '1.4') + marginY(hd.margin, 2 * REM);
  // 枠の外の物の高さ(幅 w のとき。余白を含む)
  const paraH = (p, w) => lines(p.text, REM, w) * LINE + marginY(at(view, p.sel).margin, 2 * REM);
  const foldH = (f, w) => {
    const pad = (at(view, 'details > summary', f.summarySel).padding ?? '0.75rem 0').split(/\s+/).map(px)[0] * 2;
    return Math.max(minH, lines('▶ ' + f.text, REM, w) * LINE + pad) + marginY(at(view, 'details.fold', f.sel).margin, 0.5 * REM);
  };
  const foldW = (f) => em('▶ ' + f.text) * REM + 0.5 * REM;
  const rule = at(view, '#pg-confirm:not([hidden])');
  let others = 0;
  let grid = false;
  if (rule.display === 'grid' && rule['grid-template-areas']) {
    grid = true;
    const items = [...topParas.map((p) => ({ kind: 'p', ...p })), ...folds.map((f) => ({ kind: 'fold', ...f }))];
    for (const it of items) it.area = at(view, it.sel)['grid-area'];
    assert.ok(items.every((it) => it.area), '枠の外の物に grid-area が無い');
    const rows = rule['grid-template-areas'].match(/"[^"]*"/g).map((r) => r.slice(1, -1).trim().split(/\s+/));
    const frameArea = at(view, '#pg-confirm > .ref-frame')['grid-area'];
    const headArea = at(view, '#confirm-title')['grid-area'];
    const colGap = px(rule['column-gap'] ?? '0');
    const rowGap = px(rule['row-gap'] ?? '0');
    let n = 0;
    for (const row of rows) {
      if (row.includes(frameArea) || row.includes(headArea)) continue;
      const names = [...new Set(row)];
      const inRow = names.map((a) => items.find((it) => it.area === a)).filter(Boolean);
      // 折りたたみは見出しの幅、文は残りの幅
      const fixed = inRow.filter((it) => it.kind === 'fold' && names.length > 1).reduce((s, it) => s + foldW(it), 0);
      const flexW = W - fixed - colGap * (names.length - 1);
      const hs = inRow.map((it) => (it.kind === 'p' ? paraH(it, flexW) : foldH(it, names.length > 1 ? foldW(it) + REM : W)));
      others += Math.max(0, ...hs);
      n++;
    }
    others += rowGap * (n + 1); // 見出しの下と枠の上も数える
  } else {
    for (const p of topParas) others += paraH(p, W);
    for (const f of folds) others += foldH(f, W);
  }
  const remaining = pageH - heading;
  const frame = remaining - others;
  const rowsSeen = (frame - REM - 2) / view.row; // 枠の上下の余白(0.5rem×2)と線を除く
  return { pageH, heading, remaining, others, frame, grid, ratio: frame / remaining, rowsSeen };
}

for (const view of VIEWS) {
  test(view.name + ' 確かめの一覧の枠が残りの高さの ' + view.min * 100 + '% 以上で、ページ全体は縦に動かない', () => {
    const e = estimate(view);
    const msg = `ページ ${e.pageH.toFixed(0)}px・見出し ${e.heading.toFixed(0)}px・残り ${e.remaining.toFixed(0)}px・枠の外 ${e.others.toFixed(0)}px・枠 ${e.frame.toFixed(0)}px・割合 ${(e.ratio * 100).toFixed(1)}%・一度に見える行 約${e.rowsSeen.toFixed(1)}`;
    test.diagnostic?.(msg);
    console.log(view.name, 'pg-confirm', msg);
    assert.ok(e.ratio >= view.min, msg);
    // ページ全体は縦に動かない: 枠の最小の高さ(12rem)を足しても画面に収まる
    assert.ok(e.heading + e.others + 12 * REM <= e.pageH, msg);
  });
}

test('枠は grid の最後の行(1fr)を取り、背の低い画面では grid を外して全体が動く形に戻す', () => {
  const rule = decl(screenCss, '#pg-confirm:not([hidden])');
  assert.equal(rule.display, 'grid');
  const area = decl(screenCss, '#pg-confirm > .ref-frame')['grid-area'];
  assert.ok(area, '枠に grid-area が無い');
  const rows = rule['grid-template-areas'].match(/"[^"]*"/g);
  assert.ok(rows.at(-1).includes(area), '枠が最後の行に無い');
  assert.match(rule['grid-template-rows'], /(^|\s)1fr$/);
  assert.equal(decl(lowCss, '#pg-confirm:not([hidden])').display, 'block');
});

test('上の説明は短い1文だけで、長い所は閉じた「くわしく」の中にある(消していない)', () => {
  const shown = topParas.map((p) => p.text).join('');
  assert.ok(em(shown) <= 24, '画面に出る説明が長い: ' + shown);
  assert.match(shown, /違うときは「条件を直す」から直せます/);
  const more = folds.find((f) => f.text === 'くわしく');
  assert.ok(more, '「くわしく」の折りたたみが無い');
  assert.ok(!/<details[^>]* open/.test(more.inner), '「くわしく」が開いている');
  for (const w of ['発注者や金額の1つの違いで、要るものが変わります。', '「分からない」のままでも結果は出ます(その項目は「確認が要る」になります)。']) {
    assert.ok(more.inner.includes(w), w);
  }
});

test('押す所(「くわしく」と「条件を直す」)は枠の外で、HTML の順と見た目の順が同じ', () => {
  assert.ok(!frameHtml.includes('<details') && !frameHtml.includes('<button'), '枠の中に押す所がある');
  const order = ['id="confirm-title"', 'id="confirm-lead"', 'id="confirm-more"', 'id="confirm-edit"', 'class="ref-frame"'];
  const pos = order.map((m) => page.indexOf(m));
  assert.ok(pos.every((p) => p >= 0), JSON.stringify(pos));
  assert.deepEqual(pos, [...pos].sort((a, b) => a - b), 'HTML の順');
  // 見た目の順: grid-template-areas を左上から読んだ順
  for (const view of VIEWS) {
    const rule = at(view, '#pg-confirm:not([hidden])');
    const seq = [...new Set(rule['grid-template-areas'].match(/"[^"]*"/g).flatMap((r) => r.slice(1, -1).trim().split(/\s+/)))];
    const areas = ['#confirm-title', '#confirm-lead', '#confirm-more', '#confirm-edit', '#pg-confirm > .ref-frame'].map((s) => at(view, s)['grid-area']);
    assert.deepEqual(seq, areas, view.name + ' の見た目の順');
  }
});

test('折りたたみを開いたら、中身を全幅にするため1列に積む', () => {
  const open = decl(screenCss, '#pg-confirm:not([hidden]):has(> details[open])');
  const rows = open['grid-template-areas'].match(/"[^"]*"/g).map((r) => [...new Set(r.slice(1, -1).trim().split(/\s+/))]);
  assert.ok(rows.every((r) => r.length === 1), JSON.stringify(rows));
  assert.equal(open['grid-template-columns'], 'minmax(0, 1fr)');
});

// F83a10: 本文へ飛ぶリンク・h2 の焦点の輪・文字と地の濃さの比(WCAG 2.4.1・2.4.7・1.4.3)。
// ブラウザが無いので、CSS の書いた値を WCAG の式で計算する(描いた結果ではない)。
// ui-visual は「同じ決まりの中の文字と地」を見る。ここは重なりも見る: 自分の地を持たない文字は、
// 親の地(触れたときの地・ドラッグ中の地を含む)の上に乗るので、薄い地のどれに乗っても基準以上であることを確かめる。
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHtml } from '../../build.mjs';

const html = buildHtml();
const css = html.match(/<style>([\s\S]*?)<\/style>/)[1].replace(/\/\*[\s\S]*?\*\//g, '');
const screenCss = css.replace(/@media print \{[\s\S]*\n {2}\}/, '');
const rules = [...screenCss.replace(/@media [^{]*\{/g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2] }));
const prop = (body, name) => body?.match(new RegExp('(?:^|;)\\s*' + name + '\\s*:\\s*([^;]+)'))?.[1].trim();
const selectors = (sel) => sel.split(/,(?![^(]*\))/).map((s) => s.trim());
const ruleWith = (sel) => rules.find((r) => selectors(r.sel).includes(sel))?.body;
const vars = Object.fromEntries([...ruleWith(':root').matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));

// WCAG 2 の相対輝度と濃さの比
function luminance(hex) {
  let h = hex.replace('#', '');
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const ratio = (a, b) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

const varName = (v) => v?.match(/^var\((--[\w-]+)\)$/)?.[1];
const fgOf = (r) => varName(prop(r.body, 'color'));
const bgOf = (r) => varName(prop(r.body, 'background'));
const painted = rules.filter((r) => r.sel !== ':root');

// 大きい字: 24px 以上か、太字で 18.66px 以上(WCAG の決まり)。同じ字が幅で小さくなる決まりもあるので、いちばん小さい値で見る
const LAST = (sel) => sel.split(/\s+/).at(-1);
function isLarge(sel) {
  const own = rules.filter((r) => selectors(r.sel).includes(LAST(sel)) || r.sel === sel);
  const sizes = own.map((r) => prop(r.body, 'font-size')).filter(Boolean).map((v) => (v.endsWith('rem') ? parseFloat(v) * 16 : NaN));
  if (!sizes.length || sizes.some(Number.isNaN)) return false;
  const px = Math.min(...sizes);
  const bold = own.some((r) => prop(r.body, 'font-weight') === 'bold');
  return px >= 24 || (bold && px >= 18.66);
}
const need = (sel) => (isLarge(sel) ? 3 : 4.5);

test('比の式: WCAG の端の値と、知られた組で合う', () => {
  assert.equal(ratio('#000', '#fff'), 21);
  assert.equal(ratio('#fff', '#fff'), 1);
  assert.equal(ratio('#767676', '#fff').toFixed(2), '4.54');
});

test('文字と地: 同じ決まりで両方を決めた組は基準以上', () => {
  const pairs = painted.filter((r) => fgOf(r) && bgOf(r));
  assert.ok(pairs.length >= 25, '見た組が少ない: ' + pairs.length);
  for (const r of pairs) {
    const v = ratio(vars[fgOf(r)], vars[bgOf(r)]);
    assert.ok(v >= need(r.sel), r.sel + ': ' + fgOf(r) + ' と ' + bgOf(r) + ' の比 ' + v.toFixed(2));
  }
});

test('文字と地: 自分の地を持たない字は、親の薄い地のどれに乗っても基準以上', () => {
  const light = [...new Set(painted.map(bgOf).filter((n) => n && luminance(vars[n]) > 0.5))];
  for (const n of ['--paper', '--paper-2', '--primary-bg', '--mark-weak']) assert.ok(light.includes(n), n + ' を地に使っていない(試験の前提が古い)');
  const bare = painted.filter((r) => fgOf(r) && !bgOf(r));
  assert.ok(bare.length >= 20, '見た決まりが少ない: ' + bare.length);
  for (const r of bare) {
    for (const ground of light) {
      const v = ratio(vars[fgOf(r)], vars[ground]);
      assert.ok(v >= need(r.sel), r.sel + ': ' + fgOf(r) + ' を ' + ground + ' に置くと ' + v.toFixed(2));
    }
  }
});

test('文字と地: 触れたときだけ地が変わる決まりは、元の字の色の上で基準以上', () => {
  const base = { 'button:hover': 'button', 'button:active': 'button', '.entry-button:hover': '.entry-button', '#pager.seat-plain #pg-next:hover': '#pager.seat-plain #pg-next', '#entry-back:hover': '#entry-back', 'input[type="file"]::file-selector-button:hover': 'input[type="file"]::file-selector-button' };
  for (const [hover, from] of Object.entries(base)) {
    const fg = rules.filter((r) => selectors(r.sel).includes(from)).map(fgOf).find(Boolean);
    const bg = rules.filter((r) => selectors(r.sel).includes(hover)).map(bgOf).find(Boolean);
    assert.ok(fg && bg, hover + ' の組が取れない');
    assert.ok(ratio(vars[fg], vars[bg]) >= 4.5, hover + ': ' + fg + ' と ' + bg + ' の比 ' + ratio(vars[fg], vars[bg]).toFixed(2));
  }
});

test('確認が要るの字は白地でぎりぎりなので、白地の決まりの中でだけ使う', () => {
  const uses = painted.filter((r) => fgOf(r) === '--check');
  assert.ok(uses.length >= 1);
  for (const r of uses) assert.equal(bgOf(r), '--paper', r.sel);
});

test('濃い地の字は濃い地の決まりで決め、上の帯にリンクを置かない(主の色のリンクは帯の上で読めない)', () => {
  const dark = painted.filter((r) => bgOf(r) && luminance(vars[bgOf(r)]) <= 0.5);
  assert.ok(dark.length >= 3, '見た決まりが少ない: ' + dark.length);
  for (const r of dark) {
    assert.ok(fgOf(r), r.sel + ' に字の色が無い');
    assert.ok(ratio(vars[fgOf(r)], vars[bgOf(r)]) >= 4.5, r.sel);
  }
  const topbar = html.match(/<header class="topbar">[\s\S]*?<\/header>/)[0];
  assert.ok(!/<a\b/.test(topbar), '上の帯にリンクがある');
});

test('本文へ飛ぶ: body の最初の部品で、#main を指す', () => {
  const after = html.slice(html.indexOf('<body>') + '<body>'.length).trimStart();
  assert.ok(after.startsWith('<a class="skip-link no-print" href="#main">本文へ飛ぶ</a>'), after.slice(0, 80));
  assert.equal((html.match(/<main id="main">/g) || []).length, 1);
  assert.equal((html.match(/\bid="main"/g) || []).length, 1);
});

test('本文へ飛ぶ: いつもは画面の外で、焦点が来たときだけ画面に入る。読み上げから隠さない', () => {
  const rest = ruleWith('.skip-link');
  assert.equal(prop(rest, 'position'), 'absolute');
  assert.ok(parseFloat(prop(rest, 'top')) < 0, '画面の外にない');
  assert.ok(!/display: *none|visibility: *hidden/.test(rest), '焦点が届かない隠し方');
  assert.ok(parseFloat(prop(ruleWith('.skip-link:focus'), 'top')) >= 0, '焦点で画面に入らない');
  assert.equal(prop(rest, 'min-height'), '2.75rem');
  assert.ok(ratio(vars[fgOf({ body: rest })], vars[bgOf({ body: rest })]) >= 4.5);
});

test('焦点: h2 の輪はボタンと同じ決まりで、スクリプトが焦点を移す見出しに効く', () => {
  assert.equal(ruleWith('h2:focus-visible'), ruleWith('button:focus-visible'));
  assert.ok(ruleWith('h2:focus-visible'));
  assert.match(html, /<h2 id="confirm-title" tabindex="-1">/);
});

// F38b: 押す所の形と焦点。ブラウザが無いので、CSS の書いた値と静的な HTML で確かめる(描いた結果ではない)。
// ボタンの形(主・副・押せない・選んでいる)、入力欄の枠、押す所の高さ 44px 以上、角の丸み 4px の1種、焦点の2重の輪、入口に戻るの置き場所
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildHtml } from '../../build.mjs';

const shell = fs.readFileSync(new URL('../../src/ui/shell.html', import.meta.url), 'utf8');
const css = shell.match(/<style>([\s\S]*?)<\/style>/)[1].replace(/\/\*[\s\S]*?\*\//g, '');
const screenCss = css.replace(/@media print \{[\s\S]*\n {2}\}/, '');
// 幅の決まりの中も見るので、@media の行を外してから決まりに分ける
const rules = [...screenCss.replace(/@media [^{]*\{/g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2] }));
const prop = (body, name) => body?.match(new RegExp('(?:^|;)\\s*' + name + '\\s*:\\s*([^;]+)'))?.[1].trim();
const ruleOf = (sel) => rules.find((r) => r.sel === sel)?.body;
const indexOfRule = (sel) => rules.findIndex((r) => r.sel === sel);
const html = buildHtml();
const body = html.split('<body>')[1].replace(/<script\b[\s\S]*?<\/script>/g, '');
const REM = 16;
const toPx = (v) => { const m = String(v).match(/^([\d.]+)(rem|px)$/); return m ? Number(m[1]) * (m[2] === 'rem' ? REM : 1) : NaN; };

function lum(hex) {
  let h = hex.replace('#', '');
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const vars = Object.fromEntries([...ruleOf(':root').matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
const color = (v) => { const m = String(v).match(/var\((--[\w-]+)\)/); assert.ok(m && m[1] in vars, '変数でない: ' + v); return vars[m[1]]; };
const atLeast = (fg, bg, min, label) => {
  const r = contrast(fg, bg);
  assert.ok(r >= min, label + ': ' + fg + ' と ' + bg + ' の比 ' + r.toFixed(2) + ' < ' + min);
};

const PRIMARY_IDS = ['bid-run', 'ledger-run', 'plan-run', 'next-step-3'];
const primarySel = (suffix) => [...PRIMARY_IDS.map((id) => '#' + id + suffix), '.sample-button' + suffix];
const selectors = (sel) => sel.split(',').map((s) => s.trim());
const ruleWith = (sel) => rules.find((r) => selectors(r.sel).includes(sel))?.body;

test('焦点: 全部の部品が同じ2重の輪で、輪の2色は白地でも主の色の塗りの上でも見える', () => {
  const body = ruleWith('button:focus-visible');
  for (const tag of ['input', 'select', 'textarea', 'summary', 'a']) assert.equal(ruleWith(tag + ':focus-visible'), body, tag + ' の焦点が同じ決まりでない');
  assert.equal(prop(ruleOf('.table-scroll:focus-visible'), 'outline'), prop(body, 'outline'));
  assert.equal(prop(ruleOf('.table-scroll:focus-visible'), 'box-shadow'), prop(body, 'box-shadow'));
  const outline = prop(body, 'outline').match(/^2px solid (var\(--[\w-]+\))$/);
  assert.ok(outline, '外の輪が 2px solid でない: ' + prop(body, 'outline'));
  assert.equal(prop(body, 'outline-offset'), '2px');
  const shadow = prop(body, 'box-shadow').match(/^0 0 0 2px (var\(--[\w-]+\))$/);
  assert.ok(shadow, '内の輪が 2px でない: ' + prop(body, 'box-shadow'));
  const outer = color(outline[1]);
  const inner = color(shadow[1]);
  atLeast(outer, vars['--paper'], 3, '外の輪と白地');
  atLeast(inner, vars['--primary'], 3, '内の輪と主の色の塗り');
  atLeast(inner, outer, 3, '2つの輪の境');
  // 焦点の決まりは上の2つだけにする(部品ごとに書くと食い違う)
  const focusRules = rules.filter((r) => r.sel.includes(':focus-visible'));
  assert.equal(focusRules.length, 2, focusRules.map((r) => r.sel).join(' / '));
  // 焦点の輪を消す決まりが無く、outline は焦点と未確認の語の印のほかに使わない(選んでいる形と紛れないように)
  assert.ok(!/outline: *(none|0)\b/.test(css), '焦点の輪を消している');
  const others = rules.filter((r) => prop(r.body, 'outline') && !r.sel.includes(':focus-visible')).map((r) => r.sel);
  assert.deepEqual(others, ['mark.mask-unchecked']);
});

test('押す所: ボタン・入力欄・ファイルの欄・折りたたみの見出し・印の行は高さ 44px 以上', () => {
  for (const sel of ['button', 'input[type="text"], select', 'textarea', 'input[type="file"]', 'details > summary', '.entry-button', '.radio-group div', '.unknown-check', '.check-row']) {
    const h = toPx(prop(ruleOf(sel), 'min-height'));
    assert.ok(h >= 44, sel + ' の min-height が 44px 未満: ' + prop(ruleOf(sel), 'min-height'));
  }
  // 幅の決まりを含めて、44px より低くする決まりが無い(印の 20px は高さの決まりで、行の高さで補う)
  for (const r of rules) {
    const v = prop(r.body, 'min-height');
    if (v) assert.ok(toPx(v) >= 44, r.sel + ' の min-height: ' + v);
    if (/\b(button|summary)\b/.test(r.sel)) assert.equal(prop(r.body, 'height'), undefined, r.sel + ' が高さを決めている');
  }
  // 画面の四角の印は、どれも 44px の行かラベルの中にある(1つでも外に出たら落とす)
  const boxes = [...body.matchAll(/<input type="checkbox" id="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(boxes.includes('ict-measure') && boxes.length >= 3, boxes.join(' '));
  for (const id of boxes) {
    const before = body.slice(0, body.indexOf('id="' + id + '"'));
    const parent = before.slice(Math.max(before.lastIndexOf('<div'), before.lastIndexOf('<span')));
    assert.match(parent, /class="[^"]*(check-row|unknown-check)/, id + ' の行が低い');
  }
  assert.ok((body.match(/<input type="file"/g) ?? []).length >= 5, 'ファイルの欄が少ない');
});

test('角の丸みは 4px の1種', () => {
  const values = new Set(rules.map((r) => prop(r.body, 'border-radius')).filter(Boolean));
  assert.deepEqual([...values], ['4px']);
  for (const sel of ['button', '.entry-button', 'input[type="text"], select', 'textarea', '.badge', '.result', '.start', '.radio-group']) assert.equal(prop(ruleOf(sel), 'border-radius'), '4px', sel);
  // 段階の表示も既定のボタンの丸みのまま
  assert.equal(prop(ruleOf('.steps button'), 'border-radius'), undefined);
});

test('ボタンの形: 既定は副、主の5つだけ塗り、押せない・選んでいるは形で分かる', () => {
  // 副: 白地に主の色の枠と字
  const base = ruleOf('button');
  assert.equal(color(prop(base, 'color')), vars['--primary']);
  assert.equal(color(prop(base, 'background')), vars['--paper']);
  assert.equal(prop(base, 'border'), '1px solid var(--primary)');
  atLeast(vars['--primary'], vars['--primary-bg'], 4.5, '副のボタンに触れたとき');
  assert.equal(color(prop(ruleOf('button:hover'), 'background')), vars['--primary-bg']);
  // 主: 塗りと白の太字。「次へ: 3 書類を確かめる」も主
  const main = rules.find((r) => selectors(r.sel).includes('#bid-run'));
  assert.deepEqual(selectors(main.sel).sort(), primarySel('').sort());
  assert.equal(color(prop(main.body, 'background')), vars['--primary']);
  assert.equal(prop(main.body, 'font-weight'), 'bold');
  atLeast(color(prop(main.body, 'color')), vars['--primary'], 4.5, '主のボタンの字');
  for (const id of [...PRIMARY_IDS, 'sample-load']) assert.match(body, new RegExp('<button type="button" id="' + id + '"'), id + ' が画面に無い');
  assert.match(body, /id="sample-load" class="[^"]*sample-button/);
  assert.match(body, /<button type="button" id="next-step-3">次へ: 3 書類を確かめる<\/button>/);
  // .sample-button は .entry-button と同じ強さなので、後に書かないと塗りが消える
  assert.ok(rules.indexOf(main) > indexOfRule('.entry-button'), '主の決まりが .entry-button より前にある');
  // 触れた・押している間も白い字のまま暗い塗りになる(.sample-button は button:active より弱いので、書かないと白い字が薄い地に乗る)
  const pressed = rules.find((r) => selectors(r.sel).includes('.sample-button:active'));
  assert.ok(pressed, '.sample-button:active が無い');
  assert.deepEqual(selectors(pressed.sel).sort(), [...primarySel(':hover'), ...primarySel(':active')].sort());
  assert.equal(color(prop(pressed.body, 'background')), vars['--primary-dark']);
  atLeast(color(prop(pressed.body, 'color')), vars['--primary-dark'], 4.5, '主のボタンを押している間の字');
  // 押せない: 灰色の字と地。触れても変わらない
  const off = ruleWith('button:disabled');
  assert.equal(off, ruleWith('button:disabled:hover'));
  assert.equal(color(prop(off, 'background')), vars['--paper-2']);
  assert.equal(prop(off, 'cursor'), 'not-allowed');
  atLeast(color(prop(off, 'color')), vars['--paper-2'], 4.5, '押せないボタンの字');
  // 段階の押せない形が button:disabled:hover(同じ強さ)に負けないよう、後に書く
  assert.ok(indexOfRule('.steps button:disabled') > rules.findIndex((r) => selectors(r.sel).includes('button:disabled:hover')));
  // 選んでいる: 3か所とも薄い地・2px の枠・太字。outline は使わない
  const on = rules.find((r) => selectors(r.sel).includes('.rules-switch button[aria-pressed="true"]'));
  assert.equal(selectors(on.sel).length, 3);
  assert.equal(color(prop(on.body, 'background')), vars['--primary-bg']);
  assert.equal(prop(on.body, 'border'), '2px solid var(--primary)');
  assert.equal(prop(on.body, 'font-weight'), 'bold');
  assert.equal(prop(on.body, 'outline'), undefined);
  atLeast(color(prop(on.body, 'color')), vars['--primary-bg'], 4.5, '選んでいるボタンの字');
});

test('入力欄: 1px の灰色の枠で、文字入力・選ぶ欄・複数行が同じ形', () => {
  for (const sel of ['input[type="text"], select', 'textarea']) {
    const r = ruleOf(sel);
    assert.equal(prop(r, 'border'), '1px solid var(--line)', sel);
    assert.equal(color(prop(r, 'background')), vars['--paper'], sel);
    atLeast(color(prop(r, 'color')), vars['--paper'], 4.5, sel);
  }
  atLeast(vars['--line'], vars['--paper'], 3, '入力欄の枠');
  assert.equal(prop(ruleOf('input[type="radio"], input[type="checkbox"]'), 'accent-color'), 'var(--primary)');
});

test('入口に戻る: 段の列の外の別の行に、灰色の枠で置く', () => {
  const ol = body.match(/<ol class="steps"[\s\S]*?<\/ol>/)[0];
  assert.ok(!ol.includes('entry-back'), '入口に戻るが段の列の中にある');
  assert.match(body, /<\/ol>\s*<button type="button" id="entry-back" hidden>入口に戻る<\/button>/);
  assert.equal(prop(ruleOf('.steps'), 'display'), 'flex');
  const r = ruleOf('#entry-back');
  assert.equal(color(prop(r, 'color')), vars['--ink']);
  assert.equal(color(prop(r, 'border-color')), vars['--line']);
  assert.equal(prop(r, 'margin'), '0.5rem 0 0');
  // display を決めると hidden で隠れなくなる
  assert.ok(!rules.some((x) => x.sel.includes('#entry-back') && prop(x.body, 'display')), '#entry-back に display がある');
  // 触れても段(主の色)の形にならない
  assert.equal(color(prop(ruleWith('#entry-back:hover'), 'background')), vars['--paper-2']);
  assert.equal(ruleWith('#entry-back:active'), ruleWith('#entry-back:hover'));
});

test('結果の中のリンクは縦に余白を足した形', () => {
  const r = ruleWith('.summary a');
  assert.equal(r, ruleWith('.result a'));
  assert.equal(prop(r, 'display'), 'inline-block');
  assert.equal(prop(r, 'padding'), '0.2rem 0');
});

test('07 の決まり: 外部と通信しない・外部の読み込み無し・断り書きと PDL の表示・保存しない・index.html 1つで動く', () => {
  assert.equal(fs.readFileSync(new URL('../../index.html', import.meta.url), 'utf8'), html, 'index.html が build と違う');
  assert.ok(!/<(script|link|img|iframe)\b[^>]*\b(src|href)=["']https?:/i.test(html), '外部の読み込みがある');
  assert.ok(!/@import|@font-face|url\(/.test(css), 'CSS で外部を読んでいる');
  assert.ok(!/\bfetch\(|XMLHttpRequest|WebSocket|localStorage|sessionStorage|indexedDB/.test(html), '通信か保存の処理がある');
  assert.match(html, /default-src 'none'/);
  assert.match(html, /connect-src 'none'/);
  assert.ok(body.includes('id="disclaimer"'));
  assert.ok(body.includes('PDL1.0'));
});

// F38b: 押す所の形と焦点。ブラウザが無いので、CSS の書いた値と静的な HTML で確かめる(描いた結果ではない)。
// ボタンの形(主・副・押せない・選んでいる)、入力欄の枠、押す所の高さ 44px 以上、角の丸み 4px の1種、焦点の2重の輪、入口に戻るの置き場所
// F38c: 札・表・枠。札が色だけに頼らないこと、枠の色と地の比、選んでいる印の字、まとめと表の線
// F38e: 決まりを総なめにした文字の比・線の比・押す所の大きさと、印刷の決まり
// F43a: 上の帯、印つきの1行の断り書き、角の丸いカードと薄い影、文字と余白の段階、番号と線の進み具合
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildHtml } from '../../build.mjs';
import { statusBadge, STATUS_MARK, BID_STATUS } from '../../src/ui/view.mjs';
import { renderCandidates } from '../../src/ui/mask-app.mjs';

const shell = fs.readFileSync(new URL('../../src/ui/shell.html', import.meta.url), 'utf8');
const css = shell.match(/<style>([\s\S]*?)<\/style>/)[1].replace(/\/\*[\s\S]*?\*\//g, '');
const screenCss = css.replace(/@media print \{[\s\S]*\n {2}\}/, '');
const printCss = css.match(/@media print \{([\s\S]*)\n {2}\}/)[1];
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

const PRIMARY_IDS = ['bid-run', 'ledger-run', 'plan-run', 'next-step-3', 'confirm-go'];
const primarySel = (suffix) => [...PRIMARY_IDS.map((id) => '#' + id + suffix), '.sample-button' + suffix];
// :not( の中のカンマでは分けない
const selectors = (sel) => sel.split(/,(?![^(]*\))/).map((s) => s.trim());
const ruleWith = (sel) => rules.find((r) => selectors(r.sel).includes(sel))?.body;

// 文字か線が乗る地の色。決まりに地が無い(か透明)ときは、外側の地を使う。ページの地は全部 白(F43a で入口の薄い青の枠をやめた)
const groundOf = (r) => {
  const bg = prop(r.body, 'background');
  if (bg && bg !== 'transparent') return color(bg);
  return vars['--paper'];
};
const isButton = (sel) => /button|#bid-run|#ledger-run|#plan-run|#next-step-3|#confirm-go|\.next-go/.test(sel);

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

test('角の丸み: 部品は 8px、カードは 12px、番号の丸は 50% の3種', () => {
  const values = new Set(rules.map((r) => prop(r.body, 'border-radius')).filter(Boolean));
  assert.deepEqual([...values].sort(), ['12px', '50%', '8px']);
  for (const sel of ['button', 'input[type="text"], select', 'textarea', '.badge', '.radio-group', '.sample-banner', '.warning-box']) assert.equal(prop(ruleOf(sel), 'border-radius'), '8px', sel);
  for (const sel of ['.result', '.form', '.summary', '.other-tools', '.entry-button']) assert.equal(prop(ruleOf(sel), 'border-radius'), '12px', sel);
  assert.deepEqual(rules.filter((r) => prop(r.body, 'border-radius') === '50%').map((r) => r.sel), ['.step-dot']);
  // 段階の表示も既定のボタンの丸みのまま
  assert.equal(prop(ruleOf('.steps button'), 'border-radius'), undefined);
});

test('カード: 白地に --line の縁(3:1)と薄い影。影は1種で、印刷では消える', () => {
  for (const sel of ['.result', '.form', '.summary', '.other-tools']) {
    const r = ruleOf(sel);
    assert.equal(prop(r, 'border'), '1px solid var(--line)', sel);
    assert.equal(color(prop(r, 'background')), vars['--paper'], sel);
    assert.equal(prop(r, 'box-shadow'), 'var(--shadow)', sel);
  }
  assert.equal(prop(ruleOf('.entry-button'), 'box-shadow'), 'var(--shadow)');
  assert.equal(vars['--shadow'], '0 1px 2px rgba(0, 0, 0, .12)');
  // 焦点の輪のほかに、影を直に書かない
  const raw = rules.filter((r) => prop(r.body, 'box-shadow') && prop(r.body, 'box-shadow') !== 'var(--shadow)' && !r.sel.includes(':focus-visible'));
  assert.deepEqual(raw.map((r) => r.sel), []);
  atLeast(vars['--line'], vars['--paper'], 3, 'カードの縁');
  assert.equal(printVars['--shadow'], 'none');
  assert.match(body, /<form id="bid-form" class="form"/);
});

test('文字と余白の段階: 文字は 16・19・24・32px、余白は 4・8・12・16・24・32・40px だけ', () => {
  const sizes = new Set(rules.filter((r) => r.sel !== 'html').map((r) => prop(r.body, 'font-size')).filter(Boolean));
  assert.deepEqual([...sizes].sort(), ['1.1875rem', '1.5rem', '1rem', '2rem']);
  const scale = new Set([4, 8, 12, 16, 24, 32, 40]);
  let seen = 0;
  for (const r of rules) {
    for (const m of r.body.matchAll(/(?:^|;)\s*((?:margin|padding|gap|column-gap|row-gap)(?:-[a-z]+)*)\s*:\s*([^;]+)/g)) {
      for (const v of m[2].trim().split(/\s+/)) {
        if (v === '0' || v === 'auto') continue;
        seen += 1;
        assert.ok(scale.has(toPx(v)), r.sel + ' の ' + m[1] + ' が段階の外: ' + v);
      }
    }
  }
  assert.ok(seen >= 80, '見た余白が少ない: ' + seen);
});

test('上の帯: 作品名を端まで塗った帯に置き、字と地は 4.5:1 以上、印刷では白地に黒', () => {
  assert.match(body, /^\s*<header class="topbar"><div class="wrap">/);
  const bar = ruleOf('.topbar');
  atLeast(color(prop(bar, 'color')), color(prop(bar, 'background')), 4.5, '帯の字');
  assert.equal(prop(ruleOf('body'), 'max-width'), undefined, '帯が端まで塗れない');
  assert.equal(prop(ruleOf('.wrap'), 'max-width'), '60rem');
  assert.match(body, /<\/header>\s*<div class="wrap page">/);
  assert.match(body.match(/<header[\s\S]*?<\/header>/)[0], /<svg [^>]*aria-hidden="true"/);
  assert.equal(printVars['--bar-bg'], '#fff');
  assert.equal(printVars['--bar-ink'], '#000');
});

test('断り書き: 帯のすぐ下の印つきの1行。文はそのままで、閉じた中にも隠れた段の中にも無い', () => {
  const p = body.match(/<\/header>\s*<div class="wrap page">\s*<p class="disclaimer" id="disclaimer">([\s\S]*?)<\/p>/);
  assert.ok(p, '断り書きが帯のすぐ下に無い');
  assert.match(p[1], /^<svg [^>]*aria-hidden="true"[\s\S]*?<\/svg><span>/, '印が無い');
  assert.equal(p[1].replace(/<[^>]+>/g, ''), '指摘の候補です。抜けが無いことの保証や合否ではありません。最終の確認は担当者と発注者との協議で行ってください');
  const before = body.slice(0, body.indexOf('id="disclaimer"'));
  assert.equal((before.match(/<details\b/g) ?? []).length, 0, '断り書きが閉じた中にある');
  assert.ok(!/\shidden[\s>=]/.test(before), '断り書きが隠れる物の中にある');
  // 枠はやめても弱くしない: 濃い字の太字。消す決まりが無い(画面でも紙でも)
  const r = ruleOf('.disclaimer');
  assert.equal(prop(r, 'border'), undefined);
  assert.equal(color(prop(r, 'color')), vars['--ink']);
  assert.equal(prop(r, 'font-weight'), 'bold');
  assert.ok(!/visibility|opacity/.test(r), '断り書きを消せる決まりがある');
  assert.ok(!rules.some((x) => x.sel.includes('.disclaimer') && /display: none/.test(x.body)));
});

test('進み具合: 番号の丸と線で、全部の段の名前を出す。段の切り替えはボタンのまま', () => {
  const ol = body.match(/<ol class="steps"[\s\S]*?<\/ol>/)[0];
  const li = [...ol.matchAll(/<li><button type="button" id="step-(\d)" disabled aria-label="(\d) ([^"]+)"><span class="step-dot">(\d)<\/span><span class="step-name">([^<]+)<\/span><\/button><\/li>/g)];
  assert.equal(li.length, 3);
  for (const m of li) { assert.equal(m[1], m[2]); assert.equal(m[1], m[4]); assert.equal(m[3], m[5], '読み上げと見える名前が違う'); }
  // 線は枠線で描くので、総なめの 3:1 と印刷の黒の検査に掛かる
  assert.equal(prop(ruleOf('.steps li + li::before'), 'border-top'), '2px solid var(--line)');
  assert.equal(prop(ruleOf('.steps li:has(~ li > button[aria-current="step"]) + li::before'), 'border-top-color'), 'var(--primary)');
  // 3つの状態が塗りと線の形で分かる: 押せない=破線の丸、押せる=実線の丸、今の段=塗った丸
  assert.equal(prop(ruleOf('.steps button:disabled .step-dot'), 'border'), '2px dashed var(--ink-2)');
  assert.equal(prop(ruleOf('.step-dot'), 'border'), '2px solid var(--primary)');
  const on = ruleOf('.steps button[aria-current="step"] .step-dot');
  assert.equal(color(prop(on, 'background')), vars['--primary']);
  atLeast(color(prop(on, 'color')), vars['--primary'], 4.5, '今の段の番号');
  assert.equal(prop(ruleOf('.steps button[aria-current="step"]'), 'font-weight'), 'bold');
  // 丸が 44px の押す所の中に収まる
  assert.ok(toPx(prop(ruleOf('.step-dot'), 'height')) + toPx('0.25rem') * 2 <= 44);
});

test('ボタンの形: 既定は副、主の6つだけ塗り、押せない・選んでいるは形で分かる', () => {
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
  assert.equal(prop(r, 'padding'), '0.25rem 0');
});

test('札: 色を抜いても、印と言葉で4つの状態が見分けられる', () => {
  const statuses = Object.keys(BID_STATUS);
  assert.deepEqual(statuses.sort(), ['needs_check', 'not_required', 'required', 'unanswered']);
  const seen = new Set();
  for (const st of statuses) {
    const badge = statusBadge(st);
    const mark = badge.match(/<span class="mark" aria-hidden="true">([^<]+)<\/span>/)?.[1];
    assert.equal(mark, STATUS_MARK[st], st + ' の印が無い');
    const words = badge.replace(/<span class="mark"[^>]*>[^<]*<\/span>/, '').replace(/<[^>]+>/g, '').trim();
    assert.equal(words, BID_STATUS[st], st + ' の言葉が無い');
    seen.add(mark);
    seen.add(words);
  }
  assert.equal(seen.size, statuses.length * 2, '印か言葉が重なっている');
  // 札の地はどれも白。文字は白地で 4.5:1、枠は 3:1 以上。印は札の中で太字
  for (const st of statuses) {
    const r = ruleOf('.badge-' + st);
    assert.equal(color(prop(r, 'background')), vars['--paper'], st);
    atLeast(color(prop(r, 'color')), vars['--paper'], 4.5, st + ' の字');
    atLeast(color(prop(r, 'border-color')), vars['--paper'], 3, st + ' の枠');
  }
  assert.equal(prop(ruleOf('.badge'), 'font-weight'), 'bold');
  assert.equal(prop(ruleOf('.badge .mark'), 'font-weight'), 'bold');
});

test('枠の色と地の比: 線はどれも 3:1 以上(押せない物と、枠が塗りと同じ色の物を除く)', () => {
  let checked = 0;
  for (const r of rules) {
    if (r.sel === ':root' || r.sel.includes(':disabled')) continue;
    const bg = prop(r.body, 'background') ?? 'var(--paper)';
    for (const m of r.body.matchAll(/(?:^|;)\s*(border(?:-[a-z]+)*|outline)\s*:\s*([^;]+)/g)) {
      const v = m[2].match(/var\(--[\w-]+\)/)?.[0];
      if (!v) continue;
      if (v === bg) { atLeast(color(bg), vars['--paper'], 3, r.sel + ' の塗り'); continue; }
      atLeast(color(v), groundOf(r), 3, r.sel + ' の ' + m[1]);
      checked += 1;
    }
  }
  assert.ok(checked >= 20, '見た線が少ない: ' + checked);
});

test('選んでいる印: 3か所とも「✓ 選択中」の字が出る。CSS で足すので文言と aria-pressed の扱いは変えない', () => {
  const on = rules.find((r) => selectors(r.sel).includes('.rules-switch button[aria-pressed="true"]::before'));
  assert.ok(on, '選んでいる印の字の決まりが無い');
  assert.deepEqual(selectors(on.sel).sort(), ['#mask-candidates', '#mask-review', '.rules-switch'].map((p) => p + ' button[aria-pressed="true"]::before').sort());
  assert.equal(prop(on.body, 'content'), '"✓ 選択中 "');
  assert.match(on.body, /content: "✓ 選択中 " \/ "";/);
  assert.match(body, /<button type="button" id="rules-national" aria-pressed="true">国の直轄の例/);
});

test('まとめ・見本の帯・対応表の警告: 黒い太枠は対応表の警告の1つだけ', () => {
  const sum = ruleOf('.summary');
  assert.equal(prop(sum, 'border'), '1px solid var(--line)');
  assert.equal(prop(sum, 'border-left-width'), undefined);
  const banner = ruleOf('.sample-banner');
  assert.equal(prop(banner, 'border'), '1px solid var(--primary)');
  assert.equal(color(prop(banner, 'background')), vars['--paper']);
  assert.equal(prop(ruleOf('.warning-box'), 'border'), '3px solid var(--line-strong)');
  assert.equal(color(prop(ruleOf('.warning-box'), 'background')), vars['--paper'], 'クリーム色に戻っている');
  // --line-strong の太い枠(全周)は1つの決まりだけで、その class が付くのは対応表の警告の1か所
  const heavy = rules.filter((r) => /(?:^|;)\s*border: *[2-9]px solid var\(--line-strong\)/.test(r.body)).map((r) => r.sel);
  assert.deepEqual(heavy, ['.warning-box']);
  assert.deepEqual([...body.matchAll(/class="warning-box[^"]*"(?: id="([^"]+)")?/g)].map((m) => m[1]), ['map-warning']);
  assert.deepEqual([...body.matchAll(/class="disclaimer[^"]*"(?: id="([^"]+)")?/g)].map((m) => m[1]), ['disclaimer']);
});

test('表: 見出しの下は黒い 2px、行は灰色の 1px、回数の列は右寄せ。カードでは行の線を消す', () => {
  assert.equal(prop(ruleOf('th'), 'border-bottom'), '2px solid var(--line-strong)');
  assert.equal(prop(ruleOf('td'), 'border-bottom'), '1px solid var(--line)');
  assert.equal(prop(ruleOf('table'), 'border-collapse'), 'collapse');
  assert.equal(prop(ruleOf('th.num, td.num'), 'text-align'), 'right');
  const cands = renderCandidates([{ word: '架空建設', basis: '語尾', count: 3 }], () => false);
  assert.match(cands, /<th class="num">回数<\/th>/);
  assert.match(cands, /<td class="num">3<\/td>/);
  // 狭い画面のカードは枠で区切るので、各欄の下の線を出さない
  const narrow = css.match(/@media \(max-width: 40rem\) \{[\s\S]*?\n {2}\}/)[0];
  assert.match(narrow, /table\.schedule td \{[^}]*border-bottom: none/);
});

test('まとめの項目は札と名前を1行に並べる', () => {
  const li = ruleOf('.summary-items li');
  assert.equal(prop(li, 'display'), 'flex');
  assert.equal(prop(li, 'align-items'), 'baseline');
});

test('文字の比: 色か地を決めた決まりは、どれも文字と地が 4.5:1 以上', () => {
  const seen = [];
  for (const r of rules) {
    if (r.sel === ':root') continue;
    const fgProp = prop(r.body, 'color');
    const bgProp = prop(r.body, 'background');
    if (!fgProp && !bgProp) continue;
    // 文字色を決めていない決まりは、ボタンなら既定の主の色、ほかは本文の色で見る
    const fgs = fgProp && fgProp !== 'inherit' ? [color(fgProp)] : fgProp ? [] : [isButton(r.sel) ? vars['--primary'] : vars['--ink']];
    for (const fg of fgs) {
      atLeast(fg, groundOf(r), 4.5, r.sel);
      seen.push(r.sel);
    }
  }
  assert.ok(seen.length >= 30, '見た決まりが少ない: ' + seen.length);
  // 総なめで見えない重なり: 語の印の地の上の字と、語の印の枠
  atLeast(color(prop(ruleOf('mark.mask-weak'), 'color')), vars['--mark-weak'], 4.5, '確信の弱い語');
  atLeast(vars['--check'], vars['--mark-weak'], 3, '未確認の語の枠と語の地');
  atLeast(vars['--check'], vars['--paper'], 3, '未確認の語の枠と白地');
  atLeast(vars['--primary'], vars['--paper'], 3, '四角と丸の印の色');
});

test('押す所: 丸の印は 44px の行にあり、結果の中のリンクは 24px 以上', () => {
  const radios = [...body.matchAll(/<input type="radio"[^>]*>/g)];
  assert.ok(radios.length >= 2, 'ラジオが少ない');
  for (const m of radios) {
    const before = body.slice(0, m.index);
    assert.ok(before.endsWith('<div>'), m[0] + ' が行の中にない');
    assert.ok(before.lastIndexOf('radio-group"') > before.lastIndexOf('</fieldset>'), m[0] + ' が .radio-group の外にある');
  }
  const lh = Number(prop(ruleOf('body'), 'line-height'));
  assert.equal(lh, 1.7);
  const pad = toPx(prop(ruleWith('.result a'), 'padding').split(' ')[0]);
  const h = REM * lh + pad * 2;
  assert.ok(h >= 24, '結果の中のリンクの高さ ' + h + 'px');
});

const printRules = [...printCss.replace(/@page \{[^{}]*\}/, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2] }));
const printVars = { ...vars, ...Object.fromEntries([...printRules.find((r) => r.sel === ':root').body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()])) };
const printHidden = printRules.filter((r) => /display: none !important/.test(r.body)).flatMap((r) => selectors(r.sel));

test('印刷: 余白があり、文字と線はどれも黒、塗りは白(ボタンは紙に出ない)', () => {
  assert.match(printCss, /@page \{ margin: 15mm; \}/);
  let lines = 0;
  for (const r of rules) {
    if (r.sel === ':root') continue;
    for (const m of r.body.matchAll(/(?:^|;)\s*([a-z-]+)\s*:\s*([^;]*var\(--[\w-]+\)[^;]*)/g)) {
      const name = m[2].match(/var\((--[\w-]+)\)/)[1];
      if (m[1] === 'background') {
        // 語の印のほかに、紙に塗りが残らない
        if (!isButton(r.sel) && name !== '--mark-weak') assert.equal(printVars[name], '#fff', r.sel + ' の地: ' + name);
      } else if (m[1] === 'box-shadow' && !r.sel.includes(':focus-visible')) {
        assert.equal(printVars[name], 'none', r.sel + ' の影が紙に残る');
      } else if (m[1] !== 'accent-color' && !r.sel.includes(':focus-visible') && !(name === '--paper' && isButton(r.sel))) {
        assert.equal(printVars[name], '#000', r.sel + ' の ' + m[1] + ': ' + name);
        lines += 1;
      }
    }
  }
  assert.ok(lines >= 40, '見た決まりが少ない: ' + lines);
  // 見る決まりの外に色の直書きが無い(あれば変数の置き換えが効かない)
  for (const r of rules) if (r.sel !== ':root') assert.ok(!/#[0-9a-f]{3,6}\b(?![^(]*\))/i.test(r.body), r.sel + ' に色の直書きがある');
  for (const r of printRules) if (r.sel !== ':root') assert.ok(!/#[0-9a-f]{3,6}\b/i.test(r.body), '印刷の ' + r.sel + ' に色の直書きがある');
  // 断り書きの字は紙でも黒、対応表の警告の枠も黒のまま残る
  assert.equal(printVars[prop(ruleOf('.disclaimer'), 'color').match(/--[\w-]+/)[0]], '#000');
  assert.equal(prop(ruleOf('.warning-box'), 'border'), '3px solid var(--line-strong)');
});

test('結果の先頭: 数字のカードと次へのボタンは押す所 44px 以上、スマホでは1列', () => {
  assert.equal(prop(ruleOf('.next-go'), 'min-height'), '2.75rem');
  // カードは 数字 32px と 2行の文で 44px を超える
  assert.equal(prop(ruleOf('.stat-num'), 'font-size'), '2rem');
  assert.equal(prop(ruleOf('.stat'), 'display'), 'block');
  assert.equal(prop(ruleOf('.stats'), 'grid-template-columns'), 'repeat(3, minmax(0, 1fr))');
  assert.match(html, /@media \(max-width: 40rem\) \{[\s\S]*?\.stats \{ grid-template-columns: minmax\(0, 1fr\);/);
});

test('安全の法令の候補: 色だけに頼らず印を付け、主の色(リンクの色)にしない', () => {
  const safety = rules.filter((r) => r.sel.includes('stat-safety'));
  assert.ok(safety.length > 0);
  for (const r of safety) assert.ok(!r.body.includes('--primary'), r.sel + ' が主の色');
  assert.ok(!prop(ruleOf('.stat'), 'color').includes('--primary'), 'カードの字が主の色');
  atLeast(vars['--ink-2'], vars['--paper'], 3, '安全のカードの線');
});

test('開くカード: 件数つきのカードの見出しは 44px で、開く・閉じるの字があり、紙には出ない', () => {
  assert.ok(html.includes('details.open-card > summary::after, details#bid-fold > summary::after, details.schedule-table > summary::after, details.safety-fold > summary::after { content: "開く ▾";'));
  assert.ok(html.includes('details.safety-fold[open] > summary::after { content: "閉じる ▴"; }'));
  assert.ok(printCss.includes('details.safety-fold > summary::after { content: none; }'));
  assert.equal(prop(ruleOf('details > summary'), 'min-height'), '2.75rem');
});

test('スマホで下に止まる帯は「次へ」の1つだけ。流れの中に置き、紙には出ない', () => {
  assert.equal((html.match(/position: (sticky|fixed)/g) ?? []).length, 1);
  assert.match(html, /@media \(max-width: 40rem\) \{[\s\S]*?\.step-next \{ position: sticky; bottom: 0;/);
  const bar = body.match(/<div class="row no-print step-next">([\s\S]*?)<\/div>/)[1];
  assert.equal((bar.match(/<button/g) ?? []).length, 1);
  assert.ok(bar.includes('次へ'));
  // 太字の知らせや広い面を止めない: 帯の中身はボタン1つで、幅の広い決まりを持たない
  assert.ok(!/\.step-next \{[^}]*height/.test(html));
});

test('印刷: 幅の枠は紙の幅いっぱいになる', () => {
  assert.equal(prop(printRules.find((r) => selectors(r.sel).includes('.wrap')).body, 'max-width'), 'none');
});

test('印刷: 札は黒の枠で残り、未回答の札は破線で見分ける', () => {
  assert.ok(!printRules.some((r) => /\.badge/.test(r.sel)), '印刷で札の形を変えている');
  assert.ok(!printHidden.some((s) => s.includes('badge')), '札が紙に出ない');
  for (const st of Object.keys(BID_STATUS)) assert.equal(printVars[prop(ruleOf('.badge-' + st), 'border-color').match(/--[\w-]+/)[0]], '#000', st);
  assert.equal(prop(ruleOf('.badge'), 'border'), '2px solid');
  assert.equal(prop(ruleOf('.badge-unanswered'), 'border-style'), 'dashed');
});

test('印刷: 知らせの行は出さず、前の結果だと伝える行と注記と断り書きと出典は残す', () => {
  const live = printHidden.find((s) => s.startsWith('p[aria-live]'));
  assert.ok(live, '知らせの行の決まりが無い');
  const hides = (tag) => !(tag.classes.includes('note') && live.includes(':not(.note)')) && !live.includes(':not(#' + tag.id + ')');
  const tags = [...body.matchAll(/<p id="([^"]+)"(?: class="([^"]*)")? aria-live="polite">/g)].map((m) => ({ id: m[1], classes: (m[2] ?? '').split(' ') }));
  assert.ok(tags.length >= 15, '知らせの行が少ない: ' + tags.length);
  const kept = tags.filter((t) => !hides(t)).map((t) => t.id).sort();
  assert.deepEqual(kept, ['check-status', 'checklist-status', 'mask-decoy', 'mask-residual', 'plan-status']);
  assert.ok(tags.find((t) => t.id === 'bid-status').classes.includes('no-print'));
  assert.ok(printHidden.includes('.no-print') && printHidden.includes('button') && printHidden.includes('.export'));
  // 紙に出す物が隠れていない
  assert.doesNotMatch(body.match(/<p class="disclaimer" id="disclaimer"[^>]*>/)[0], /no-print/);
  assert.doesNotMatch(body.match(/<footer[^>]*>/)[0], /no-print/);
  assert.ok(body.split(/<footer[^>]*>/)[1].includes('PDL1.0'), '出典の表示が footer に無い');
  assert.ok(!printHidden.some((s) => /disclaimer|footer|summary/.test(s)));
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

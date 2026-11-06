// F14e: 狭い画面(スマホ。幅320〜400px)。ページ全体が横に動かない。入力欄は max-width:100%、表は枠(.table-scroll)の中だけで横に動く。
// 置き換えの前と後の2列は狭い画面で1列にする。ボタン・入力欄・折りたたみの見出しは指で押せる高さ(44px)にする。
// この環境にはブラウザが無いので、実際の幅は測れない。CSS の決まりと、画面が出す HTML の形(表がすべて枠に入っているか)を確かめる
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildHtml } from '../../build.mjs';
import { runPage } from '../acceptance/_helpers.mjs';
import { renderXlsxResult, scrollTable } from '../../src/ui/view.mjs';
import { renderMap } from '../../src/ui/mask-app.mjs';

const shell = fs.readFileSync(new URL('../../src/ui/shell.html', import.meta.url), 'utf8');
const css = shell.match(/<style>([\s\S]*?)<\/style>/)[1].replace(/\/\*[\s\S]*?\*\//g, '');
const screenCss = css.replace(/@media print \{[\s\S]*\n {2}\}/, '');
const printCss = css.match(/@media print \{([\s\S]*)\n {2}\}/)[1];
const rules = [...screenCss.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2] }));
const prop = (body, name) => body.match(new RegExp('(?:^|;)\\s*' + name + '\\s*:\\s*([^;]+)'))?.[1].trim();
const ruleOf = (sel) => rules.find((r) => r.sel === sel)?.body;
const html = buildHtml();
const body = html.split('<body>')[1].replace(/<script\b[\s\S]*?<\/script>/g, '');
const REM = 16;
const toPx = (v) => { const m = String(v).match(/^([\d.]+)(rem|px)$/); return m ? Number(m[1]) * (m[2] === 'rem' ? REM : 1) : NaN; };

// 狭い画面の決まり(@media (max-width: …))の中身と、その幅(px)
function narrowMedia() {
  const out = [];
  for (const m of screenCss.matchAll(/@media \(max-width: ([\d.]+(?:rem|px))\) \{([\s\S]*?)\n {2}\}/g)) {
    out.push({ width: toPx(m[1]), rules: [...m[2].matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((r) => ({ sel: r[1].trim(), body: r[2] })) });
  }
  return out;
}

// HTML の中の <table> が、すべて .table-scroll の枠の中にあるか
function tablesOutsideScroll(h) {
  const bad = [];
  let depth = 0;
  for (const m of h.matchAll(/<(\/?)(div|table)\b([^>]*)>/g)) {
    const [, close, tag, attrs] = m;
    if (tag === 'div') {
      if (!close) depth = /class="table-scroll"/.test(attrs) || depth > 0 ? depth + 1 : 0;
      else if (depth > 0) depth--;
    } else if (!close && depth === 0) bad.push(h.slice(m.index, m.index + 60));
  }
  return bad;
}
const countTables = (h) => (h.match(/<table\b/g) ?? []).length;

test('ページ全体が横に動かない: 幅は枠の内側で数え、長い語は折り返し、入力欄は枠の幅まで', () => {
  assert.match(css, /\*, \*::before, \*::after \{ box-sizing: border-box; \}/, '幅に枠線と余白を含めていない');
  assert.equal(prop(ruleOf('body'), 'overflow-wrap'), 'break-word', '長い URL などが折り返さない');
  assert.equal(prop(ruleOf('input, select, textarea'), 'max-width'), '100%', '入力欄が枠の幅を超える');
  assert.equal(prop(ruleOf('textarea'), 'width'), '100%', 'textarea の cols=80 のまま広がる');
  assert.equal(prop(ruleOf('pre'), 'max-width'), '100%');
  assert.equal(prop(ruleOf('pre'), 'overflow-x'), 'auto');
  // 画面の CSS で、表の枠の外に 320px より広い幅を決めていない(max-width は狭める向きなのでよい)
  for (const r of rules) {
    for (const name of ['width', 'min-width']) {
      const v = prop(r.body, name);
      if (!v || v === '100%' || r.sel.startsWith('.table-scroll ')) continue;
      assert.ok(!(toPx(v) > 320 - 2 * REM), r.sel + ' の ' + name + ' が狭い画面より広い: ' + v);
    }
  }
  // 項目名と値の一覧の2列(.summary-row)も、狭い画面では1列
  assert.ok(narrowMedia().some((m) => m.rules.some((r) => r.sel === '.summary-row' && /grid-template-columns: 1fr/.test(r.body))));
});

test('表は .table-scroll の枠の中だけで横に動く(見本の結果・対応表・Excel の読めた欄)', async () => {
  const sc = ruleOf('.table-scroll');
  assert.equal(prop(sc, 'overflow-x'), 'auto');
  assert.equal(prop(sc, 'max-width'), '100%');
  assert.ok(ruleOf('.table-scroll:focus-visible'), 'キーボードで枠に来たときの印が無い');
  // 段取りの表は最小の幅を持たない。狭い画面では行ごとのカードになる(F37f。tests/unit/ui-cards.test.mjs)
  assert.equal(ruleOf('.table-scroll table.schedule'), undefined);
  // 部品の形: 名前つきの枠でキーボードでも動かせる
  assert.equal(scrollTable('段取りの表', '<table></table>'), '<div class="table-scroll" role="region" tabindex="0" aria-label="段取りの表"><table></table></div>');

  // 見本を押したあとの画面にある表は、すべて枠の中
  const page = runPage(html);
  await page.click('sample-load');
  let seen = 0;
  for (const id of ['summary', 'bid-result', 'taicho-result', 'schedule-result', 'check-result', 'plan-result']) {
    const h = page.el(id).innerHTML;
    seen += countTables(h);
    assert.deepEqual(tablesOutsideScroll(h), [], id + ' に枠の外の表がある');
  }
  assert.ok(seen >= 4, '見本のあとの表が少ない(まとめ1・段取りの段3のはず): ' + seen);
  // 置き換えの対応表
  page.el('mask-input').value = '担当は甲野 一郎。電話 03-0000-0000、メール xxxx@example.com';
  await page.click('mask-run');
  const map = page.el('mask-map').innerHTML;
  assert.equal(countTables(map), 1, map);
  assert.deepEqual(tablesOutsideScroll(map), []);
  assert.deepEqual(tablesOutsideScroll(renderMap([{ token: '〔人名1〕', label: '人名', original: '甲野 一郎' }])), []);
  // 台帳の Excel の読めた欄
  const x = renderXlsxResult({ found: { company: { value: 'B3' } }, unreadable: [], ledger: { company: '(架空)株式会社' } }, { company: '会社名' });
  assert.equal(countTables(x), 1);
  assert.deepEqual(tablesOutsideScroll(x), []);
  // 作品のコードに、枠を通らずに <table を書いている所が無い
  for (const f of ['src/ui/view.mjs', 'src/ui/mask-app.mjs', 'src/ui/app.mjs', 'src/ui/ai-app.mjs']) {
    const code = fs.readFileSync(new URL('../../' + f, import.meta.url), 'utf8');
    for (const line of code.split('\n').filter((l) => l.includes("'<table"))) assert.match(line, /scrollTable\(/, f + ': ' + line.trim());
  }
  // 印刷では枠で切らずに全部を出す
  assert.match(printCss, /\.table-scroll \{ overflow: visible; \}/);
});

test('置き換えの前と後の2列は、狭い画面(400px を含む幅)で1列になる', () => {
  assert.match(prop(ruleOf('.mask-cols'), 'grid-template-columns'), /^minmax\(0, 1fr\) minmax\(0, 1fr\)$/, '2列の中身が枠を押し広げる');
  const one = narrowMedia().filter((m) => m.width >= 400 && m.rules.some((r) => r.sel === '.mask-cols' && prop(r.body, 'grid-template-columns') === 'minmax(0, 1fr)'));
  assert.ok(one.length, '狭い画面で1列にする決まりが無い');
  assert.match(body, /<div class="mask-cols">\s*<div><h3>前<\/h3><pre id="mask-before"><\/pre><\/div>\s*<div><h3>後<\/h3><pre id="mask-after"><\/pre><\/div>/);
  // 入口のタイルも狭い画面では1列にして幅いっぱい
  assert.ok(one.some((m) => m.rules.some((r) => r.sel === '.entry-choices' && prop(r.body, 'grid-template-columns') === 'minmax(0, 1fr)')));
  assert.equal(prop(ruleOf('.entry-button'), 'width'), '100%');
});

test('ボタン・入力欄・選ぶ印・折りたたみの見出しは指で押せる大きさ(44px)', () => {
  assert.ok(toPx(prop(ruleOf('button'), 'min-height')) >= 44, 'ボタンが低い');
  assert.ok(toPx(prop(ruleOf('input[type="text"], select'), 'min-height')) >= 44, '入力欄が低い');
  assert.ok(toPx(prop(ruleOf('.entry-button'), 'min-height')) >= 44);
  // 丸・四角の印そのものは 20px にし、行(ラベルを含む)を 44px にする。ラベルは for で印とつながり、押すと選べる
  const box = ruleOf('input[type="radio"], input[type="checkbox"]');
  assert.ok(toPx(prop(box, 'width')) >= 20 && toPx(prop(box, 'height')) >= 20);
  assert.ok(toPx(prop(ruleOf('.radio-group div'), 'min-height')) >= 44);
  for (const id of ['direct-unset', 'direct', 'direct-sub', 'ict-measure']) assert.match(body, new RegExp('<label for="' + id + '">'), id + ' にラベルが無い');
  // 折りたたみの見出しの高さ = 行の高さ(1.7 × 16px)+ 上下の余白
  const pad = prop(ruleOf('details > summary'), 'padding').split(' ')[0];
  assert.ok(1.7 * REM + 2 * toPx(pad) >= 44, '折りたたみの見出しが低い: ' + pad);
  // ボタンどうしが詰まらないように間を空ける
  assert.ok(prop(ruleOf('button'), 'margin'));
  assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1">/);
});

test('07 の決まり: 外部の読み込み・通信・保存が無く、断り書きと PDL の表示を常に出す', () => {
  assert.ok(!/<(script|link|img|iframe)\b[^>]*\b(src|href)=["']https?:/i.test(html), '外部の読み込みがある');
  assert.ok(!/@import|url\(/.test(css), 'CSS で外部を読んでいる');
  assert.ok(!/\bfetch\(|XMLHttpRequest|WebSocket|localStorage|sessionStorage|indexedDB/.test(html), '通信か保存の処理がある');
  assert.match(html, /connect-src 'none'/);
  assert.ok(body.includes('id="disclaimer"'));
  assert.ok(body.includes('PDL1.0'));
  // index.html 1つで動く(作り直した index.html が今の src と同じ)
  assert.equal(fs.readFileSync(new URL('../../index.html', import.meta.url), 'utf8'), html, 'index.html を作り直していない');
});

// F54a: スマホ幅の結果の先頭の行・押す所・帯の焦点
const mediaBody = (cond) => screenCss.match(new RegExp('@media \\(' + cond + '\\) \\{([\\s\\S]*?)\\n {2}\\}'))?.[1];
const phoneRules = () => [...mediaBody('max-width: 40rem').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2] }));
const phoneRule = (sel) => phoneRules().find((r) => r.sel === sel)?.body;

test('F54a (1) 画面の CSS で order を使わない(DOM の順と見た目の順を合わせる)', () => {
  assert.ok(!/(?<![-\w])order\s*:/.test(css), 'order がある');
});

test('F54a (2) .phone-only は既定で隠し、40rem の中で出し、印刷では隠す', () => {
  assert.equal(prop(ruleOf('.phone-only'), 'display'), 'none');
  assert.equal(prop(phoneRule('.phone-only'), 'display'), 'block');
  assert.equal(prop(phoneRule('li.phone-only'), 'display'), 'list-item');
  assert.ok([...printCss.matchAll(/([^{}]+)\{([^{}]*)\}/g)].some((m) => m[1].split(',').map((x) => x.trim()).includes('.phone-only') && /display: none !important/.test(m[2])), '印刷で隠していない');
});

test('F54a (3) 下の帯が焦点を隠さない: 40rem の中の scroll-padding-bottom が帯の高さ(61px)以上', () => {
  assert.ok(toPx(prop(phoneRule('html'), 'scroll-padding-bottom')) >= 61);
  assert.equal(prop(ruleOf('html'), 'scroll-padding-bottom'), undefined, 'パソコン幅にも効いている');
});

test('F54a (4) 下に止まる決まりは1つのまま', () => {
  assert.equal((css.match(/position: sticky/g) ?? []).length, 1);
});

test('F54a (5) 40rem の中の .stat は grid の行で、説明を隠さない', () => {
  const st = phoneRule('.stat');
  assert.equal(prop(st, 'display'), 'grid');
  assert.equal(prop(st, 'grid-template-columns'), '4.5rem minmax(0, 1fr)');
  assert.ok([4, 8, 12, 16, 24, 32, 40].includes(toPx(prop(st, 'column-gap'))));
  assert.equal(prop(phoneRule('.stat-num'), 'font-size'), '1.5rem');
  for (const r of rules) if (r.sel.split(',').some((x) => x.includes('.stat-sub'))) assert.ok(!/display: none|visibility: hidden/.test(r.body), r.sel);
  for (const c of ['.stat-required', '.stat-check', '.stat-safety', '.stat-schedule']) assert.ok(prop(phoneRule(c), 'border-left-color'), c);
  assert.equal(prop(ruleOf('.stat'), 'display'), 'block', 'パソコン幅のカードが変わった');
});

test('F54a 主なボタンは 40rem の中で幅いっぱい', () => {
  assert.equal(prop(phoneRule('.next-go'), 'width'), '100%');
  const wide = phoneRules().find((r) => r.sel.includes('#bid-run'));
  for (const s of ['#bid-run', '#ledger-run', '#plan-run', '.rules-switch button', '.sample-banner button']) assert.ok(wide.sel.split(',').map((x) => x.trim()).includes(s), s);
  assert.equal(prop(wide.body, 'width'), '100%');
  assert.equal(prop(phoneRule('.sample-banner'), 'padding'), '0.5rem 0.75rem');
});

test('F54a (6) pointer: coarse の中は min-height だけで、44px 以上。節 4.5 の部品がそろう', () => {
  const inner = [...mediaBody('pointer: coarse').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2] }));
  assert.ok(inner.length > 0);
  for (const r of inner) {
    const names = [...r.body.matchAll(/([\w-]+)\s*:/g)].map((m) => m[1]);
    assert.deepEqual(names, ['min-height'], r.sel);
    assert.ok(toPx(prop(r.body, 'min-height')) >= 48, r.sel);
  }
  const sels = inner.flatMap((r) => r.sel.split(',').map((x) => x.trim()));
  for (const s of ['button', 'input[type="text"]', 'select', 'input[type="file"]', 'textarea', 'details > summary', '.radio-group div', '.unknown-check', '.check-row', '.entry-link', '.next-go']) assert.ok(sels.includes(s), s);
});

test('F54a (7) pointer の @media は @media print より前', () => {
  const print = css.indexOf('@media print');
  const found = [...css.matchAll(/@media \((?:any-)?pointer:/g)];
  assert.ok(found.length > 0);
  for (const m of found) assert.ok(m.index < print, m[0]);
});

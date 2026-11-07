// F85e: 「くわしく」の読み上げの名に見えている語を入れる(WCAG 2.5.3 Label in Name)。ラジオを行の中で縮めない。
// 文の置き換え A の空の注記の線を消す。この環境にはブラウザも読み上げソフトも無いので、
// 確かめているのは属性と CSS の決まりまでで、実際の幅と読み上げは見ていない
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildHtml } from '../../build.mjs';

const shell = fs.readFileSync(new URL('../../src/ui/shell.html', import.meta.url), 'utf8');
const built = buildHtml();
const PAGES = [['shell.html', shell], ['組み立てた画面', built]];

const decode = (s) => s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
// aria-label の付いた summary を、名前・見えている語・開く先の説明の id の組にして返す
const namedSummaries = (html) => [...html.matchAll(/<summary aria-label="([^"]*)">([^<]*)<\/summary><p id="([a-z-]+)"/g)]
  .map((m) => ({ name: decode(m[1]), visible: decode(m[2]), hint: m[3] }));
// style の決まりを、セレクタの一覧と宣言の組にして返す。@media の中の決まりも1つずつ見る
const cssRules = (html) => {
  const css = html.match(/<style>([\s\S]*?)<\/style>/)[1].replace(/\/\*[\s\S]*?\*\//g, '');
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    selectors: m[1].split(',').map((s) => s.trim()),
    decls: Object.fromEntries(m[2].split(';').map((d) => d.trim()).filter(Boolean).map((d) => {
      const i = d.indexOf(':');
      return [d.slice(0, i).trim(), d.slice(i + 1).trim()];
    })),
  }));
};
const rulesFor = (html, selector) => cssRules(html).filter((r) => r.selectors.includes(selector));

const WIDE = {
  'work-kind-hint': '工種の説明をくわしく',
  'contract-amount-hint': '請負代金の見込みの説明をくわしく',
  'subcontract-total-hint': '下請けの総額の説明をくわしく',
  'license-hint': '元請けの許可の種類の説明をくわしく',
  'engineer-qualification-hint': '置ける技術者の資格の説明をくわしく',
};
const PLAIN = {
  'orderer-hint': '発注者の説明',
  'direct-hint': '元請けか下請けかの説明',
  'work-type-hint': '工事の種類の説明',
  'ict-measure-hint': '閲覧できる措置の説明',
  'participation-conditions-hint': '公告の参加の条件の説明',
};

for (const [title, html] of PAGES) {
  test(title + ': 「くわしく」の summary の名は全部「くわしく」を含み、挙げた文のとおり', () => {
    const wide = namedSummaries(html).filter((s) => s.visible === 'くわしく');
    assert.deepEqual(Object.fromEntries(wide.map((s) => [s.hint, s.name])), WIDE);
    for (const s of wide) assert.ok(s.name.includes('くわしく'), s.hint);
  });

  test(title + ': 「説明」の summary の名は変えず、「説明」と「くわしく」の作り分けも残る', () => {
    const plain = namedSummaries(html).filter((s) => s.visible === '説明');
    assert.deepEqual(Object.fromEntries(plain.map((s) => [s.hint, s.name])), PLAIN);
  });

  test(title + ': aria-label の付いた summary は、見えている語を名に含み、名は別々のまま', () => {
    const all = namedSummaries(html);
    assert.equal(all.length, Object.keys(WIDE).length + Object.keys(PLAIN).length);
    for (const s of all) assert.ok(s.name.includes(s.visible), s.hint);
    assert.equal(new Set(all.map((s) => s.name)).size, all.length);
  });

  test(title + ': ラジオと四角の印の決まりに flex: none があり、行の中で縮まない', () => {
    for (const selector of ['input[type="radio"]', 'input[type="checkbox"]']) {
      const rules = rulesFor(html, selector);
      assert.ok(rules.length > 0, selector);
      assert.ok(rules.some((r) => r.decls.flex === 'none'), selector);
    }
    // 大きさの決まりは今のまま(縮まないようにしただけで、印の大きさは変えない)
    const base = rulesFor(html, 'input[type="radio"]').find((r) => r.decls.flex === 'none');
    assert.equal(base.decls.width, '1.25rem');
    assert.equal(base.decls.height, '1.25rem');
  });

  test(title + ': 空の #mask-decoy・#mask-residual の決まりは左線と余白を消し、隠さない', () => {
    for (const id of ['mask-decoy', 'mask-residual']) {
      const rules = rulesFor(html, '#' + id + ':empty');
      assert.equal(rules.length, 1, id);
      assert.deepEqual(rules[0].decls, { 'border-left': 'none', padding: '0', margin: '0' });
    }
  });

  test(title + ': 2つの注記を隠す決まりは無く、aria-live は残り、文が入れば .note の線が出る', () => {
    const named = cssRules(html).filter((r) => r.selectors.some((s) => /#mask-(decoy|residual)\b/.test(s)));
    assert.ok(named.length > 0);
    for (const r of named) {
      assert.equal(r.decls.display, undefined, r.selectors.join(', '));
      assert.equal(r.decls.visibility, undefined, r.selectors.join(', '));
      for (const s of r.selectors) assert.doesNotMatch(s, /\[aria-live\]/);
    }
    for (const id of ['mask-decoy', 'mask-residual']) {
      assert.ok(html.includes('<p id="' + id + '" class="note" aria-live="polite"></p>'), id);
    }
    assert.equal(rulesFor(html, '.note')[0].decls['border-left'], '4px solid var(--line)');
    assert.equal(rulesFor(html, '.note[aria-live]:not(:empty)')[0].decls['border-left-color'], 'var(--line)');
    assert.equal(rulesFor(html, '.note:empty:not([aria-live])')[0].decls.display, 'none');
  });
}

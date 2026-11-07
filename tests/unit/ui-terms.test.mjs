// F83a6: 画面の語のゆれを見張る。古い呼び方を表にして、画面に出る文(shell.html・view.mjs・app.mjs・mask-app.mjs)に残っていないことを見る。
// 今後ゆれを見つけたら、この表に1行足す。あわせて、入口の公告のタイルの文と、入口で押せないステップの丸の見た目を確かめる
// この環境にはブラウザが無いので、見た目は CSS の書いた値と静的な HTML、組み立てた画面の動きで確かめる(描いた結果ではない)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildHtml } from '../../build.mjs';
import { runPage } from '../acceptance/_helpers.mjs';

// 語の表: old は画面に出してはいけない呼び方、now は今の呼び方(画面のどこかに出る)
const TERMS = [
  { old: '条件の画面に戻る', now: '「条件を入れる」に戻る', why: '戻る先は段の名前で呼ぶ(F83a6)。番号は F86b で外した' },
  { old: '『確認する』', now: '「確認する」', why: 'ボタンの名前は一重のかぎで囲む(F83a6)' },
  { old: '確認が要る候補', now: '確認が要る点', why: '確かめる点の数の呼び方は「確認が要る点」(F83a1)' },
  { old: '2. 施工体制台帳の点検', now: '施工体制台帳の点検', why: '見出しに段の番号を付けない(F86b)' },
  { old: '3. 施工計画書の目次の点検', now: '施工計画書の目次の点検', why: '見出しに段の番号を付けない(F86b)' },
  { old: '3-1. 施工体制台帳の点検', now: '施工体制台帳の点検', why: '見出しに段の番号を付けない(F86b)' },
  { old: '3-2. 施工計画書の目次の点検', now: '施工計画書の目次の点検', why: '見出しに段の番号を付けない(F86b)' },
];

const read = (p) => fs.readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
// HTML は style・script・注釈を除いた残り(属性の値も読み上げに出るので残す)
const htmlText = (s) => s.replace(/<style>[\s\S]*?<\/style>/g, '').replace(/<script\b[\s\S]*?<\/script>/g, '').replace(/<!--[\s\S]*?-->/g, '');
// .mjs は注釈の行を除き、文字列の値だけを集める(画面に出る文は文字列の中にある)
function mjsText(s) {
  const code = s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  return [...code.matchAll(/'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g)].map((m) => m[0]).join('\n');
}
const SCREEN = {
  'src/ui/shell.html': htmlText(read('src/ui/shell.html')),
  'src/ui/view.mjs': mjsText(read('src/ui/view.mjs')),
  'src/ui/app.mjs': mjsText(read('src/ui/app.mjs')),
  'src/ui/mask-app.mjs': mjsText(read('src/ui/mask-app.mjs')),
};
const html = buildHtml();

test('語の表: 古い呼び方が画面に出る文に無く、今の呼び方はどこかに出る', () => {
  for (const t of TERMS) {
    for (const [file, text] of Object.entries(SCREEN)) assert.ok(!text.includes(t.old), file + ' に「' + t.old + '」が残っている(' + t.why + ')');
    assert.ok(!htmlText(html).includes(t.old), 'index.html に「' + t.old + '」が残っている');
    assert.ok(Object.values(SCREEN).some((text) => text.includes(t.now)), '「' + t.now + '」が画面のどこにも無い');
  }
  // 表の見張りが本当に効くこと: 古い呼び方を入れた文は引っ掛かる
  for (const t of TERMS) assert.ok(mjsText("const x = '" + t.old + "';").includes(t.old));
});

test('確かめの戻るは下の帯の「戻る」で、次にすることの語が段の名前で呼ぶ。段3 の見出しに番号が無い。根拠の無い項目の「理由を見る」は残す', () => {
  assert.match(html, /<button type="button" id="confirm-back">戻る<\/button>/);
  assert.ok(SCREEN['src/ui/view.mjs'].includes("'「条件を入れる」に戻る'"), '戻る先の段の名前が変わっている');
  const panel3 = html.slice(html.indexOf('<section id="panel-3"'), html.indexOf('<details class="other-tools'));
  const h2 = [...panel3.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/g)].map((m) => m[1]);
  assert.deepEqual(h2.slice(0, 2), ['施工体制台帳の点検', '施工計画書の目次の点検']);
  assert.ok(SCREEN['src/ui/view.mjs'].includes("'理由を見る'"), '「理由を見る」が無くなっている');
});

test('入口の公告のタイル: PDF を読める口なら「公告を読み込む」、1280 幅で主の文が1行に収まる', () => {
  const tile = html.match(/<button type="button" id="entry-intake"[^>]*>([\s\S]*?)<\/button>/)[1];
  const main = tile.match(/<span class="btn-main">([^<]*)<\/span>/)[1];
  const sub = tile.match(/<span class="btn-sub">([^<]*)<\/span>/)?.[1];
  const accept = html.match(/<input\b[^>]*\bid="intake-load"[^>]*>/)[0].match(/accept="([^"]*)"/)[1].split(',');
  if (accept.includes('.pdf')) {
    assert.equal(main, '公告を読み込む');
    assert.equal(sub, '公告の PDF か、AI がまとめた条件のファイル(.json)を選ぶ');
  } else {
    assert.equal(main, '公告の条件を読み込む');
  }
  // 1280 幅の見積もり: 枠 .wrap は 60rem(border-box なので中は左右 1rem を引く)、タイルは3列で間は 1rem、タイルの中は左右 1.5rem と枠 2px を引く。
  // 全角の字は1字が字の大きさ 1.1875rem の幅として数える(半角も1字に数えるので多めに見る)
  const css = read('src/ui/shell.html');
  assert.match(css, /\.wrap \{ max-width: 60rem; margin: 0 auto; padding: 0 1rem; \}/);
  assert.match(css, /\.entry-choices \{ display: grid; grid-template-columns: repeat\(3, minmax\(0, 1fr\)\); gap: 1rem; \}/);
  assert.match(css, /\.entry-button \{[^}]*font-size: 1\.1875rem;[^}]*padding: 1rem 1\.5rem;[^}]*border: 2px solid/);
  assert.match(css, /\*, \*::before, \*::after \{ box-sizing: border-box; \}/);
  const REM = 16;
  const inner = ((60 - 2) * REM - 2 * REM) / 3 - 2 * 1.5 * REM - 2 * 2;
  const width = (s) => [...s].length * 1.1875 * REM;
  assert.ok(width(main) <= inner, '「' + main + '」は ' + width(main) + 'px で、タイルの中 ' + inner.toFixed(1) + 'px に収まらない');
  // 前の文は収まらなかった(見積もりが甘すぎないこと)
  assert.ok(width('公告から拾った条件を読み込む') > inner);
});

test('入口ではステップの丸を押せる見た目にしない(主の色の輪と字を使わない)', async () => {
  const css = read('src/ui/shell.html').match(/<style>([\s\S]*?)<\/style>/)[1].replace(/\/\*[\s\S]*?\*\//g, '');
  const screen = css.replace(/@media print \{[\s\S]*\n {2}\}/, '').replace(/@media [^{]*\{/g, '');
  const rules = [...screen.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2] }));
  const ruleOf = (sel) => rules.find((r) => r.sel === sel)?.body;
  const prop = (body, name) => body?.match(new RegExp('(?:^|;)\\s*' + name + '\\s*:\\s*([^;]+)'))?.[1].trim();
  const off = ruleOf('.steps li');
  const dot = ruleOf('.step-dot');
  assert.ok(off && dot, '段の決まりが無い');
  // これからの段の字・輪・地に主の色(--primary 系)を使わない(F86b: 印は押せないので全部の段に掛ける。前の段と今の段だけ別の決まりで主の色)
  for (const [body, names] of [[off, ['color']], [dot, ['color', 'background', 'border']]]) {
    for (const n of names) {
      assert.ok(prop(body, n), n + ' を決めていない');
      assert.doesNotMatch(prop(body, n), /--primary/, n + ' が主の色');
    }
  }
  assert.equal(prop(dot, 'border'), '2px solid var(--ink-2)');
  // 指の形にしない(ボタンでないので cursor の決まりを持たない)
  assert.ok(!rules.some((r) => /\.steps|step-dot/.test(r.sel) && /cursor/.test(r.body)), '段の印に cursor の決まりがある');
  // 触れた・押したときに色を変える決まりが段の丸に無い
  assert.ok(!rules.some((r) => r.sel.split(',').some((s) => /\.steps|step-dot/.test(s) && /:hover|:active/.test(s))), '段の丸に触れたときの決まりがある');
  // 入口にいる間は、入口の丸だけが塗られ、ほかの丸は主の色にならない: 開いたとき、段を選んで「戻る」で戻ったとき
  const page = runPage(html);
  const steps = () => ['step-0', 'step-1', 'step-2', 'step-3'].filter((id) => page.el(id).getAttribute('aria-current') === 'step');
  assert.deepEqual(steps(), ['step-0']);
  await page.click('entry-bid');
  assert.deepEqual(steps(), ['step-1']);
  await page.click('pg-back');
  assert.equal(page.el('entry').hidden, false);
  assert.deepEqual(steps(), ['step-0']);
});

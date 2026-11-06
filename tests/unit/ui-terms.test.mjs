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
  { old: '条件の画面に戻る', now: '「1 条件を入れる」に戻る', why: '戻る先は段の名前で呼ぶ(F83a6)' },
  { old: '『確認する』', now: '「確認する」', why: 'ボタンの名前は一重のかぎで囲む(F83a6)' },
  { old: '確認が要る候補', now: '確認が要る点', why: '確かめる点の数の呼び方は「確認が要る点」(F83a1)' },
  { old: '2. 施工体制台帳の点検', now: '3-1. 施工体制台帳の点検', why: '段3 の中の見出しは段の番号の下に置く(F83a6)' },
  { old: '3. 施工計画書の目次の点検', now: '3-2. 施工計画書の目次の点検', why: '段3 の中の見出しは段の番号の下に置く(F83a6)' },
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

test('戻るボタンは段の名前で呼び、段3 の見出しは 3-1・3-2。根拠の無い項目の「理由を見る」は残す', () => {
  assert.match(html, /<button type="button" id="confirm-back">「1 条件を入れる」に戻る<\/button>/);
  assert.match(html, /<button type="button" id="step-1" disabled aria-label="1 条件を入れる">/, '戻る先の段の名前が変わっている');
  const panel3 = html.slice(html.indexOf('<section id="panel-3"'), html.indexOf('<details class="other-tools'));
  const h2 = [...panel3.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/g)].map((m) => m[1]);
  assert.deepEqual(h2.slice(0, 2), ['3-1. 施工体制台帳の点検', '3-2. 施工計画書の目次の点検']);
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
  const off = ruleOf('.steps button:disabled');
  const dot = ruleOf('.steps button:disabled .step-dot');
  assert.ok(off && dot, '押せない段の決まりが無い');
  // 字・輪・地を押せない形で上書きし、主の色(--primary 系)を使わない
  for (const [body, names] of [[off, ['color', 'background', 'border']], [dot, ['color', 'background', 'border']]]) {
    for (const n of names) {
      assert.ok(prop(body, n), n + ' を上書きしていない');
      assert.doesNotMatch(prop(body, n), /--primary/, n + ' が主の色');
    }
  }
  assert.equal(prop(dot, 'border'), '2px dashed var(--ink-2)');
  // 指の形にも「押せない」の形にもしない(案内の表示として普通の矢印)
  assert.equal(prop(off, 'cursor'), 'default');
  // 触れた・押したときに色を変える決まりが段の丸に無い
  assert.ok(!rules.some((r) => r.sel.split(',').some((s) => /\.steps|step-dot/.test(s) && /:hover|:active/.test(s))), '段の丸に触れたときの決まりがある');
  // 決まりは一般の button の決まりより強い(.steps と :disabled の分)ので、button:hover・button:active の主の色に負けない
  for (const sel of ['button', 'button:hover', 'button:active']) assert.ok(ruleOf(sel) !== undefined, sel + ' の決まりが無い');

  // 入口にいる間は丸が押せない: 開いたとき、段を選んで「入口に戻る」で戻ったとき
  const page = runPage(html);
  const steps = () => ['step-1', 'step-2', 'step-3'].map((id) => page.el(id).disabled);
  assert.deepEqual(steps(), [true, true, true]);
  await page.click('entry-bid');
  assert.deepEqual(steps(), [false, false, false]);
  await page.click('entry-back');
  assert.equal(page.el('entry').hidden, false);
  assert.deepEqual(steps(), [true, true, true]);
});

// F86c: 入口を1画面にする。入口に残すのは 題・断り書き・1文・用意するもの・3つのタイル・別の道具への2つの入り口・閉じた「くわしく」だけ。
// 説明と注意は「くわしく」へ、出典と PDL の表示は使った資料のページへ移す。消さない。紙には今のまま全部出す
// ブラウザが無いので、実物の字の数と高さは測らない(Edge の確かめは統括)。ここでは組み立てた画面の HTML・CSS と、押したときの hidden を見る
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHtml } from '../../build.mjs';
import { runPage } from '../acceptance/_helpers.mjs';
import { openDetailsForPrint, openSummaryForPrint, restoreDetailsAfterPrint } from '../../src/ui/app.mjs';

const html = buildHtml();
const body = html.slice(html.indexOf('<body>')).replace(/<script\b[\s\S]*?<\/script>/g, '');
const css = html.match(/<style>([\s\S]*?)<\/style>/)[1].replace(/\/\*[\s\S]*?\*\//g, '');
const printCss = css.match(/@media print \{([\s\S]*)\n {2}\}/)[1];
const text = (h) => h.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

// details の中身を除く(summary は見えるので残す)。入れ子も数える。ui-fold と同じ数え方
function outsideFolds(h) {
  let out = '';
  let depth = 0;
  let summaryDepth = 0;
  for (const part of h.split(/(<\/?details\b[^>]*>|<\/?summary\b[^>]*>)/)) {
    if (/^<details\b/.test(part)) depth++;
    else if (part === '</details>') depth--;
    else if (/^<summary\b/.test(part)) summaryDepth = depth;
    else if (part === '</summary>') summaryDepth = 0;
    else if (depth === 0 || (depth === 1 && summaryDepth === 1)) out += part;
  }
  return out;
}
const chars = (h) => h.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/\s/g, '').length;
// 開くタグの前で閉じていない要素の id の並び(外から順)。id の無い物は省く
function ancestors(id) {
  const at = body.indexOf('id="' + id + '"');
  assert.ok(at >= 0, id + ' が無い');
  const open = body.lastIndexOf('<', at);
  const stack = [];
  for (const m of body.slice(0, open).matchAll(/<(\/?)([a-zA-Z][\w-]*)\b((?:[^>"]|"[^"]*")*?)(\/?)>/g)) {
    if (/^(br|hr|img|input|meta|link|path|circle|rect)$/i.test(m[2]) || m[4]) continue;
    if (m[1]) stack.pop();
    else stack.push({ id: m[3].match(/\sid="([^"]+)"/)?.[1], tag: m[2].toLowerCase(), cls: m[3].match(/\sclass="([^"]+)"/)?.[1] ?? '' });
  }
  return stack;
}
const idsAround = (id) => ancestors(id).map((a) => a.id).filter(Boolean);
const foldsAround = (id) => ancestors(id).filter((a) => a.tag === 'details').map((a) => a.id);
const noPrintAround = (id) => ancestors(id).filter((a) => /(^|\s)no-print(\s|$)/.test(a.cls)).map((a) => a.id);
const tagOf = (id) => body.match(new RegExp('<[a-z][a-z0-9]*\\b[^>]*\\bid="' + id + '"[^>]*>'))?.[0] ?? '';

const firstScreen = () => body.slice(body.indexOf('<body>'), body.indexOf('<section id="panel-1"'))
  .replace(/<details class="notice-more no-print" id="notice-more" hidden>[\s\S]*?<\/details>/, '')
  .replace('<a class="skip-link no-print" href="#main">本文へ飛ぶ</a>', '');

test('入口の折りたたみの外の字は 450字以内', () => {
  const n = chars(outsideFolds(firstScreen()));
  console.log('# 入口の折りたたみの外の字 ' + n + '字');
  assert.ok(n <= 450, '多い: ' + n + '字');
  assert.ok(n > 100, '数え方が壊れている: ' + n + '字');
});

test('入口に残す物: 題・断り書き・1文・用意するもの・3つのタイル・2つの入り口・閉じた「くわしく」が1つ', () => {
  const first = firstScreen();
  for (const id of ['disclaimer', 'lead', 'entry-prep', 'sample-load', 'entry-bid', 'entry-intake', 'entry-awarded', 'entry-tools', 'entry-more']) assert.ok(first.includes('id="' + id + '"'), id);
  assert.deepEqual(foldsAround('entry-awarded'), []);
  assert.deepEqual(foldsAround('entry-tools'), []);
  assert.deepEqual([...first.matchAll(/<details\b[^>]*>/g)].length, 1, '入口の折りたたみは「くわしく」の1つ');
  assert.equal(text(body.match(/<details\b[^>]*id="entry-more"[^>]*><summary>([\s\S]*?)<\/summary>/)[1]), 'くわしく');
  assert.equal(text(body.match(/id="entry-tools"[^>]*>([\s\S]*?)<\/button>/)[1]), '文の置き換え(別の道具)');
  assert.equal(text(body.match(/<div class="lead" id="lead">([\s\S]*?)<\/div>/)[1]), '工事の条件から要るものと段取りを、台帳・目次から抜けの候補を、根拠の条つきで出します。');
  // 2つの入り口は 1280 でも2行に分ける
  assert.match(css, /\.entry-aside \.entry-link \{ display: block; \}/);
});

test('くわしくの中に できること・見ていない法令の1行・通信しない注意があり、閉じて始まる', () => {
  assert.doesNotMatch(tagOf('entry-more'), /\sopen[\s>]/, '最初から開いている');
  assert.deepEqual(foldsAround('can-do'), ['entry-more']);
  assert.deepEqual(foldsAround('scope-not-line'), ['entry-more']);
  assert.deepEqual(foldsAround('offline-note'), ['entry-more']);
  assert.equal((body.match(/<ul id="can-do">([\s\S]*?)<\/ul>/)[1].match(/<li>/g) ?? []).length, 3);
  assert.ok(text(body.match(/<ul id="can-do">([\s\S]*?)<\/ul>/)[1]).includes('施工計画書の目次を貼ると'));
  assert.equal(text(body.match(/id="scope-not-line">([\s\S]*?)<\/p>/)[1]), '見ていない法令・資料があります(条例・契約書・特記仕様書・省令など)。別に確かめてください。');
  assert.equal(text(body.match(/id="offline-note">([\s\S]*?)<\/p>/)[1]), 'この画面は外部と通信しません(ページの設定で通信先を「無し」にしています)。入れた内容はこの端末の中だけで扱います。');
});

test('使った資料のページ: #panel-ref の枠の中に 法令の一覧・出典・PDL の表示・版がある', () => {
  assert.match(tagOf('panel-ref'), /\shidden[\s>]/);
  assert.match(body, /<div class="pg" id="pg-ref">/);
  for (const id of ['scope', 'sources', 'sources-dates', 'credits', 'tool-version']) {
    const around = idsAround(id);
    assert.ok(around.includes('panel-ref') && around.includes('pg-ref') && around.includes('ref-frame'), id + ': ' + around);
  }
  assert.match(tagOf('ref-frame'), /class="ref-frame"/);
  const ref = body.slice(body.indexOf('<section id="panel-ref"'), body.indexOf('<nav class="no-print" id="pager"'));
  assert.ok(ref.includes('PDL1.0'));
  assert.ok(ref.includes('国土交通省が作成したものではない'));
  assert.ok(ref.includes('<ul id="scope-not">'));
  assert.ok(ref.includes('<ul id="sources-list">'));
  assert.match(text(body.match(/<p id="tool-version">([\s\S]*?)<\/p>/)[1]), /^道具の版 \S+/);
  // 使った資料のページの外には置かない(同じ文を2か所に持たない)
  assert.ok(!body.slice(0, body.indexOf('<section id="panel-ref"')).includes('PDL1.0'));
});

test('断り書きは閉じた物の中に無い。PDL の表示は使った資料のページで閉じた物の外にあり、印刷からも消えない', () => {
  assert.deepEqual(foldsAround('disclaimer'), []);
  assert.deepEqual(noPrintAround('disclaimer'), []);
  assert.ok(idsAround('disclaimer').every((id) => !id.startsWith('panel-')), '断り書きが段の中にある');
  assert.ok(body.indexOf('id="disclaimer"') < body.indexOf('<main id="main">'), '全部のページの上に無い');
  for (const id of ['credits', 'sources-dates']) assert.deepEqual(foldsAround(id), [], id);
  const credits = body.slice(body.indexOf('<footer id="credits">'), body.indexOf('</footer>'));
  assert.ok(outsideFolds(credits).includes('PDL1.0'));
  assert.ok(outsideFolds(credits).includes('公共データ利用規約'));
  assert.ok(outsideFolds(credits).includes('国土交通省が作成したものではない'));
  assert.ok(outsideFolds(credits).includes('e-Gov 法令 API'));
});

test('CSP と外部の読み込み: 移した後も通信先は無しで、外から読み込まない', () => {
  assert.match(html, /Content-Security-Policy" content="[^"]*default-src 'none'/);
  assert.doesNotMatch(html, /connect-src\s+[^;'"]*https?:/);
  assert.ok(!/<(script|link|img|iframe)[^>]*\s(src|href)="https?:/i.test(html), '外部の読み込みがある');
  const ref = body.slice(body.indexOf('<section id="panel-ref"'), body.indexOf('</main>'));
  assert.ok(!/<(script|link|img|iframe|a)\b[^>]*\s(src|href)="https?:/i.test(ref), '使った資料のページに外へのリンクや読み込みがある');
});

test('紙に全部出る: 移した物は紙から消えず、隠れたページも出す。印刷の決まりは1つのまま', () => {
  assert.equal((css.match(/@media print/g) ?? []).length, 1);
  for (const id of ['lead', 'can-do', 'scope-not-line', 'scope', 'sources', 'credits', 'tool-version']) assert.deepEqual(noPrintAround(id), [], id + ' が紙から消える');
  assert.match(printCss, /\.pg\[hidden\], #panel-ref\[hidden\], #panel-tools\[hidden\] \{ display: block; \}/);
  // 枠の中で縦に動かす決まりは画面だけ
  assert.ok(!/\.ref-frame/.test(printCss) || /\.ref-frame \{ overflow: visible; \}/.test(printCss), '紙で枠が切れる');
  const beforePrint = css.slice(0, css.indexOf('@media print'));
  const frame = beforePrint.match(/(@media screen[^{]*\{)(?:(?!@media)[\s\S])*?\.ref-frame \{[^}]*overflow-y: auto/);
  assert.ok(frame, '.ref-frame の縦に動く決まりが @media screen の中に無い');
  // 新しい見出しと「くわしく」の見出しは紙に足さない
  assert.match(tagOf('ref-title'), /class="[^"]*no-print/, '紙に新しい見出しが出る');
  assert.match(body, /<details class="fold" id="entry-more">/, '紙で見出しを隠す印 fold が無い');
  // 紙の順: 断り書き → 1文 → できること → 見ていない法令の1行 → 段 → 法令の一覧 → 出典 → 表示 → 署名
  const order = ['id="disclaimer"', 'id="lead"', 'id="can-do"', 'id="scope-not-line"', 'id="panel-1"', 'id="panel-tools"', 'id="scope"', 'id="sources"', 'id="credits"', 'id="sign-off"'].map((k) => body.indexOf(k));
  for (let i = 1; i < order.length; i++) assert.ok(order[i - 1] > 0 && order[i - 1] < order[i], '紙の順が違う: ' + i);
});

test('紙に全部出る: 印刷の前に「くわしく」も開く', () => {
  const page = runPage(html);
  const fold = page.el('entry-more');
  assert.ok(!fold.open);
  const doc = { querySelectorAll: () => [fold, page.el('scope')] };
  openDetailsForPrint(doc);
  assert.equal(fold.open, true);
  assert.equal(page.el('scope').open, true);
});

test('紙に全部出る: まとめの紙でも「くわしく」を開く(見ていない法令の1行が閉じた物の中に残らない)。終わると閉じる', () => {
  const folds = { 'entry-more': { open: false }, 'summary-docs': { open: false } };
  const doc = { getElementById: (id) => folds[id] ?? null };
  openSummaryForPrint(doc);
  assert.equal(folds['entry-more'].open, true, 'まとめの紙で「見ていない法令」の1行が消える');
  restoreDetailsAfterPrint();
  assert.equal(folds['entry-more'].open, false, '印刷のあとも開いたまま');
});

test('まとめの紙: できることの箇条は今のまま隠し、見ていない法令の1行は残す', () => {
  const brief = printCss.match(/body\.print-brief #lead,[^{]*\{([^}]*)\}/);
  assert.ok(brief, 'まとめの紙で隠す決まりが無い');
  const selectors = brief[0].split('{')[0];
  assert.ok(selectors.includes('body.print-brief #can-do-more'), 'できることがまとめの紙に出る');
  assert.ok(selectors.includes('body.print-brief #scope'));
  assert.ok(!selectors.includes('#entry-more') && !selectors.includes('#scope-not-line'), '見ていない法令の1行がまとめの紙から消える');
  assert.ok(idsAround('can-do').includes('can-do-more'));
  assert.ok(!idsAround('scope-not-line').includes('can-do-more'));
});

test('「くわしく」は入口だけに出る。画面の決まりで段のページから隠す', () => {
  const screen = css.slice(0, css.indexOf('@media print'));
  assert.match(screen, /@media screen \{[\s\S]*?body\.in-pages #entry-more \{ display: none; \}/);
  assert.ok(!printCss.includes('in-pages'), '紙の決まりが画面のページに結びついている');
});

test('入口には別の道具の折りたたみを出さず、#entry-tools で別の道具のページへ。戻ると閉じて入口へ', async () => {
  const page = runPage(html);
  assert.equal(page.el('panel-tools').hidden, true, '入口に別の道具が出ている');
  assert.equal(page.el('panel-ref').hidden, true);
  await page.click('entry-tools');
  assert.equal(page.el('entry').hidden, true);
  assert.equal(page.el('panel-tools').hidden, false);
  assert.equal(page.el('pg-tools').hidden, false);
  assert.equal(page.el('other-tools').open, true, '別の道具が開いていない');
  assert.equal(page.el('pager').hidden, false);
  assert.equal(page.el('entry-back').hidden, false);
  await page.click('pg-back');
  assert.equal(page.el('entry').hidden, false);
  assert.equal(page.el('other-tools').open, false, '開いたまま入口に戻った');
  assert.equal(page.el('panel-tools').hidden, true);
});

test('「使った資料」は上の帯の1つのボタンで開き、右の席は入口に戻る。そのページではボタンを隠す', async () => {
  assert.ok(body.indexOf('id="ref-open"') < body.indexOf('</header>'), '上の帯に無い');
  assert.ok(/class="[^"]*no-print/.test(tagOf('ref-open')));
  assert.equal(text(body.match(/id="ref-open"[^>]*>([\s\S]*?)<\/button>/)[1]), '使った資料');
  const page = runPage(html);
  assert.notEqual(page.el('ref-open').hidden, true);
  await page.click('ref-open');
  assert.equal(page.el('entry').hidden, true);
  assert.equal(page.el('panel-ref').hidden, false);
  assert.equal(page.el('pg-ref').hidden, false);
  assert.equal(page.el('ref-open').hidden, true, 'そのページでボタンが残っている');
  assert.equal(page.el('entry-back').hidden, false);
  assert.equal(page.el('pg-next').hidden, true);
  await page.click('entry-back');
  assert.equal(page.el('entry').hidden, false);
  assert.equal(page.el('panel-ref').hidden, true);
  assert.notEqual(page.el('ref-open').hidden, true, '入口でボタンが戻らない');
});

test('使った資料の「戻る」は来たページへ: 入口・確かめ・結果・別の道具', async () => {
  const fromEntry = runPage(html);
  await fromEntry.click('ref-open');
  await fromEntry.click('pg-back');
  assert.equal(fromEntry.el('entry').hidden, false);

  const page = runPage(html);
  await page.click('sample-load');
  assert.equal(page.el('pg-confirm').hidden, false, '見本で確かめのページが開かない');
  await page.click('ref-open');
  assert.equal(page.el('pg-confirm').hidden, true);
  await page.click('pg-back');
  assert.equal(page.el('pg-confirm').hidden, false, '確かめへ戻らない');
  assert.equal(page.el('panel-ref').hidden, true);
  await page.click('confirm-go');
  await page.click('ref-open');
  assert.equal(page.el('panel-2').hidden, true);
  await page.click('pg-back');
  assert.equal(page.el('panel-2').hidden, false, '結果へ戻らない');

  const tools = runPage(html);
  await tools.click('entry-tools');
  await tools.click('ref-open');
  assert.equal(tools.el('panel-tools').hidden, true);
  await tools.click('pg-back');
  assert.equal(tools.el('pg-tools').hidden, false, '別の道具へ戻らない');
  assert.equal(tools.el('other-tools').open, true);
});

test('使った資料はどの段にも印を付けない。ページの数も出さない', async () => {
  const page = runPage(html);
  await page.click('sample-load');
  await page.click('ref-open');
  const on = [0, 1, 2, 3].filter((i) => page.el('step-' + i).getAttribute('aria-current') === 'step');
  assert.deepEqual(on, []);
  assert.equal(page.el('pg-num').textContent, '');
});

test('使った資料のページでも断り書きは1行の形で見える', async () => {
  const page = runPage(html);
  await page.click('ref-open');
  assert.equal(page.el('notice-more').hidden, false);
  await page.click('entry-back');
  assert.equal(page.el('notice-more').hidden, true, '入口は全文のまま');
});

test('枠は背の低い画面で動きを外す(全体が動く形に戻す)', () => {
  const low = css.match(/@media screen and \(max-height: 30rem\) \{([\s\S]*?)\n {2}\}/)[1];
  assert.match(low, /\.ref-frame \{[^}]*overflow-y: visible/);
  assert.match(low, /#panel-ref:not\(\[hidden\]\)/);
});

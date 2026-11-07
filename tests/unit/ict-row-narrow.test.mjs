// F84d: 段1 の「閲覧できる措置」の行は、印・名前・説明の折りたたみが flex で横に並ぶ。
// 名前が長いので、幅が足りないと折りたたみも一緒に縮み、「▶ 説明」が1字ずつ縦に折れていた(幅 390 で 22px・320 で 17px)。
// 幅 40rem 以下では折りたたみを行の下に回し、印と名前は1行目に並べたままにする。
// それより広い幅でも、見出しの文字は折り返さない(折りたたみの幅が見出しより細くならない)。
// この環境にはブラウザが無いので、実際の幅は測れない。CSS の決まりと、画面が出す HTML の形を確かめる
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildHtml } from '../../build.mjs';

const html = buildHtml();
const body = html.split('<body>')[1].replace(/<script\b[\s\S]*?<\/script>/g, '');
const css = html.match(/<style>([\s\S]*?)<\/style>/)[1].replace(/\/\*[\s\S]*?\*\//g, '');

const rulesIn = (text) => [...text.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2].trim() }));
const prop = (rule, name) => rule?.body.match(new RegExp('(?:^|;)\\s*' + name + '\\s*:\\s*([^;]+)'))?.[1].trim();

// @media の塊を、括弧を数えて取り出す(1行で書いた塊もあるので、字下げには頼らない)
function splitMedia(text) {
  const blocks = [];
  let rest = '';
  let at = 0;
  for (const m of text.matchAll(/@media ([^{]+)\{/g)) {
    if (m.index < at) continue;
    let depth = 1;
    let i = m.index + m[0].length;
    while (depth > 0) {
      if (text[i] === '{') depth++;
      if (text[i] === '}') depth--;
      i++;
    }
    blocks.push({ cond: m[1].trim(), text: text.slice(m.index + m[0].length, i - 1) });
    rest += text.slice(at, m.index);
    at = i;
  }
  return { blocks, rest: rest + text.slice(at) };
}
const { blocks: mediaBlocks, rest: outsideMedia } = splitMedia(css);
const narrow = rulesIn(mediaBlocks.find((b) => b.cond === '(max-width: 40rem)').text);
const narrowRule = (sel) => narrow.find((r) => r.sel === sel);
// どの @media にも入っていない決まり(広い画面の見た目はここで決まる)
const base = rulesIn(outsideMedia);
const baseRule = (sel) => base.find((r) => r.sel === sel);

// flex の省略の書き方を、伸び・縮み・基準の幅に分ける
function flexOf(rule) {
  const [grow, shrink, basis] = (prop(rule, 'flex') ?? '').split(/\s+/);
  return { grow, shrink, basis };
}

test('閲覧できる措置の行は、印・名前・折りたたみが行の直下に並ぶ', () => {
  const row = body.match(/<div class="row check-row"><input type="checkbox" id="ict-measure"[\s\S]*?<\/details><\/div>/)?.[0];
  assert.ok(row, '閲覧できる措置の行が無い');
  assert.match(row, /<label for="ict-measure">[\s\S]*?<\/label>\s*<details class="fold hint-fold"><summary aria-label="閲覧できる措置の説明">説明<\/summary>/);
  assert.equal(prop(baseRule('.check-row'), 'display'), 'flex', '行が flex でなくなったら、この試験の決まりは見直す');
});

test('幅 40rem 以下: 折りたたみが行の下に回る', () => {
  assert.equal(prop(narrowRule('.row.check-row'), 'flex-wrap'), 'wrap', '行が折り返さない');
  const fold = flexOf(narrowRule('.row.check-row > details'));
  assert.equal(fold.basis, '100%', '折りたたみが1行分の幅を取らず、名前の隣に残る');
  assert.equal(fold.shrink, '0', '折りたたみが縮む');
});

test('幅 40rem 以下: 印と名前は1行目に並び、名前は残りの幅で折り返す', () => {
  // 基準の幅が 0 でないと、長い名前が印の次の行へ落ちる
  const label = flexOf(narrowRule('.row.check-row > label'));
  assert.equal(label.grow, '1', '名前が残りの幅を使わない');
  assert.equal(label.basis, '0', '長い名前が印の下の行へ落ちる');
  assert.equal(prop(baseRule('.check-row > input'), 'flex'), 'none', '印が縮む');
});

test('どの幅でも、説明の見出しの文字は折り返さない', () => {
  // 40rem より広くても、名前と折りたたみの合計が行より長いと折りたたみは縮む。見出しが折り返さなければ、見出しより細くならない
  assert.equal(prop(baseRule('.check-row > details > summary'), 'white-space'), 'nowrap');
});

test('パソコンの幅の決まりは変えない: 行は1行に並び、折りたたみは名前の隣のまま', () => {
  assert.equal(baseRule('.check-row').body, 'display: flex; align-items: center; min-height: 2.75rem;');
  assert.equal(baseRule('.check-row > input').body, 'flex: none;');
  // 行の中の並びを変える決まりは、幅 40rem 以下の塊の中だけにある
  for (const r of base) {
    if (!/check-row/.test(r.sel)) continue;
    assert.ok(['.check-row', '.check-row > input', '.check-row > details > summary'].includes(r.sel), '広い画面に決まりが増えた: ' + r.sel);
  }
  for (const b of mediaBlocks) {
    if (b.cond === '(max-width: 40rem)') continue;
    assert.ok(!/\.row\.check-row/.test(b.text), b.cond + ' に行の決まりがある');
  }
});

test('折りたたみの無い印の行(労働安全の確かめなど)は変えない', () => {
  const bare = narrow.filter((r) => /(^|,\s*)\.check-row\b/.test(r.sel));
  assert.deepEqual(bare.map((r) => r.sel), [], '.row の付かない印の行まで折り返す');
});

test('折りたたみを持つ印の行は、すべて幅 40rem 以下の決まりの対象になる', () => {
  const rows = [...body.matchAll(/<div class="([^"]*\bcheck-row\b[^"]*)">([\s\S]*?)<\/div>/g)].filter((m) => m[2].includes('<details'));
  assert.equal(rows.length, 1, '折りたたみを持つ印の行の数が変わった');
  for (const m of rows) assert.ok(m[1].split(/\s+/).includes('row'), m[1] + ' に row が無い');
});

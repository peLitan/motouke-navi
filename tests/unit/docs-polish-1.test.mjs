// 説明の文書の数が互いに合うことを確かめる(F51a)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p) => fs.readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const readme = read('README.md');
// README.md から docs/details.md へ移した節を見る(2026-11-08 統括: README を整えた)
const details = read('docs/details.md');
const overview = read('docs/overview.md');
const manual = read('docs/manual.md');
const hyouka = read('docs/評価.md');
const script = read('docs/demo-script.md');

test('場面の数: README と台本の見出しの数が、台本の表の行の数と同じ', () => {
  const rows = script.split('\n').filter((l) => /^\| \d+ \| \d:\d\d〜/.test(l)).length;
  assert.ok(script.includes(`長さ: ${rows}場面で`));
  assert.ok(readme.includes(`${rows}場面・`));
});

test('台本の札1: 公告2件・1人・各1回の形で、測れなかったときの外し方が2通りある(F72a)', () => {
  const note = script.split('\n').find((l) => l.startsWith('- 10 の札1:'));
  assert.ok(note, '補足に 10 の札1 の行がある');
  for (const w of ['実在の公告2件', '「2件・1人・各1回」', '「手で ○分/道具で ○分」', '何割減']) assert.ok(note.includes(w), w);
  assert.match(note, /2件とも測れなかったら札1 と声の1文目を外し/);
  assert.match(note, /1件だけ測れたら札1 をその1件の形で出し、隅の「2件」を「1件」に、「各1回」を「1回」に替える/);
  for (const w of ['同じ公告1件', '1人・1回']) assert.ok(!script.includes(w), w);
});

test('実在の公告の外れた欄: overview が評価.md の 30欄のうち1欄(岡山の15欄のうち1欄)と同じ', () => {
  assert.ok(hyouka.includes('15欄のうち1欄が外れ'));
  assert.ok(hyouka.includes('全部の行の数え方で30欄のうち1欄が外れ'));
  assert.ok(hyouka.includes('最初の1行の数え方で30欄のうち3欄が外れ'));
  assert.ok(overview.includes('実在の公開の公告2件(30欄)は 1欄が外れ'));
  assert.ok(overview.includes('欄の最初の1行だけで判定すると 3欄'));
  assert.ok(!overview.includes('2欄'));
});

test('積算のずれ: overview が評価.md の 9 の数を書き、測っていないと書かない', () => {
  assert.ok(!overview.includes('額のずれは測っていない'));
  for (const n of ['-11.4%〜-0.5%', '12 種別', '0.5〜4.7%']) {
    assert.ok(hyouka.includes(n), n);
    assert.ok(overview.includes(n), n);
  }
});

test('見落としの差: どの文書もあり 5/30・なし 0/30 で、差が無いと丸めない', () => {
  assert.ok(/\| あり\(6回\) \| 5\/30 \|/.test(hyouka));
  assert.ok(/\| なし\(6回\) \| 0\/30 \|/.test(hyouka));
  for (const text of [details, overview, manual, hyouka]) {
    assert.ok(/あり 5\/30.*なし 0\/30/.test(text));
    assert.ok(!text.includes('ほぼ0'));
  }
  assert.ok(!readme.includes('見落としに差は出ませんでした'));
  assert.ok(!details.includes('見落としに差は出ませんでした'));
});

test('抜き書きの数: README・overview・manual・評価.md が同じ', () => {
  const total = hyouka.match(/^\| 合計 \| (\d{3}) \| (\d{3}) \| 100\.0% \|$/m);
  assert.ok(total);
  for (const text of [details, overview, manual]) assert.ok(text.includes(`規則表の抜き書き ${total[1]} 件が原文にある`));
});

test('仕込みの確かめ・モデルの選び方・期間の分け方の文がある', () => {
  for (const text of [details, hyouka]) assert.ok(/仕込みの出力の確かめ: 2026-11-06 に版 7ba4f4f と版 7055986/.test(text));
  assert.ok(/^\| モデルの選び方 \|.*`model: inherit`/m.test(overview));
  assert.ok(read('plugin/agents/refuter.md').includes('model: inherit'));
  assert.ok(readme.includes('受け入れ条件の文書と自走の仕組みは開始前に用意し、受け入れテストのコードと作品は期間中に書きました'));
});

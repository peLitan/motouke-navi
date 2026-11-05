// 説明の文書の数が互いに合うことを確かめる(F51a)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p) => fs.readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const readme = read('README.md');
const overview = read('docs/overview.md');
const manual = read('docs/manual.md');
const hyouka = read('docs/評価.md');
const script = read('docs/demo-script.md');

test('場面の数: README と台本の見出しの数が、台本の表の行の数と同じ', () => {
  const rows = script.split('\n').filter((l) => /^\| \d+ \| \d:\d\d〜/.test(l)).length;
  assert.ok(script.includes(`長さ: ${rows}場面で`));
  assert.ok(readme.includes(`${rows}場面・`));
});

test('実在の公告の外れた欄: overview が評価.md の 15欄のうち1欄と同じ', () => {
  assert.ok(hyouka.includes('15欄のうち1欄が外れ'));
  assert.ok(overview.includes('実在の公開の公告1件(15欄)は 1欄が外れ'));
  assert.ok(!overview.includes('2欄'));
});

test('積算のずれ: overview が評価.md の 9 の数を書き、測っていないと書かない', () => {
  assert.ok(!overview.includes('額のずれは測っていない'));
  for (const n of ['-11.4%〜-0.5%', '13 種別', '0.5〜4.7%']) {
    assert.ok(hyouka.includes(n), n);
    assert.ok(overview.includes(n), n);
  }
});

test('見落としの差: どの文書もあり 5/30・なし 0/30 で、差が無いと丸めない', () => {
  assert.ok(/\| あり\(6回\) \| 5\/30 \|/.test(hyouka));
  assert.ok(/\| なし\(6回\) \| 0\/30 \|/.test(hyouka));
  for (const text of [readme, overview, manual, hyouka]) {
    assert.ok(/あり 5\/30.*なし 0\/30/.test(text));
    assert.ok(!text.includes('ほぼ0'));
  }
  assert.ok(!readme.includes('見落としに差は出ませんでした'));
});

test('抜き書きの数: README・overview・manual・評価.md が同じ', () => {
  const total = hyouka.match(/^\| 合計 \| (\d{3}) \| (\d{3}) \| 100\.0% \|$/m);
  assert.ok(total);
  for (const text of [readme, overview, manual]) assert.ok(text.includes(`規則表の抜き書き ${total[1]} 件が原文にある`));
});

test('仕込みの確かめ・モデルの選び方・期間の分け方の文がある', () => {
  for (const text of [readme, hyouka]) assert.ok(/仕込みの出力の確かめ: 2026-11-06 に版 7ba4f4f と版 7055986/.test(text));
  assert.ok(/^\| モデルの選び方 \|.*`model: inherit`/m.test(overview));
  assert.ok(read('plugin/agents/refuter.md').includes('model: inherit'));
  assert.ok(readme.includes('受け入れ条件の文書と自走の仕組みは開始前に用意し、受け入れテストのコードと作品は期間中に書きました'));
});

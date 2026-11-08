// README と docs/overview.md の冒頭の数字が docs/評価.md と食い違わないことを確かめる(F35c)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p) => fs.readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const hyouka = read('docs/評価.md');

// 評価の文書から数字を読む(冒頭の数字を試験に決め打ちしない)
const total = hyouka.match(/^\| 合計 \| (\d+) \| \*\*(\d+)\*\* \| \*\*(\d+)\*\* \|/m);
const rows = hyouka.match(/結果は同じ (\d+) のうち (\d+) だった/);

// 確かめた数字と版。README と overview の「## 評価」の節にある(冒頭から移した。README は F51a、overview は F53a)
function assertNumbers(text) {
  assert.ok(total && rows, '評価の文書から数字を読めない');
  assert.ok(text.includes(`${total[1]}件のうち見つけたのは${total[2]}件`));
  assert.ok(text.includes(`見落としが${total[3]}件`));
  assert.ok(text.includes(`${rows[1]}行のうち抜き書きが原文と合ったのは${rows[2]}行`));
  for (const version of ['2026-11-04', '7ba4f4f', '1fcb4ec', '令和7年11月版']) {
    assert.ok(text.includes(version), version);
  }
  assert.ok(!/\d+ *(%|割)/.test(text.split('\n').find((l) => l.includes('見つけたのは'))), '時間の減り方は書かない');
}

test('docs/overview.md の冒頭は要約の箇条で、評価の文書と同じ数字と版は評価の節にある', () => {
  const overview = read('docs/overview.md');
  const summary = overview.split('\n').slice(5, 9).join('');
  assert.ok(summary.includes('使う前は'));
  assert.ok(summary.includes('使うと'));
  assert.ok(!/\d/.test(summary), '要約の箇条に数字を置かない');
  assertNumbers(overview.slice(overview.indexOf('\n## 評価\n'), overview.indexOf('\n## 限界\n')));
});

test('README.md の冒頭は作者の言葉と作者の立場の段落のあとに誰の・どんな場面で・何を・どうの4行で、数字は評価の節にある', () => {
  const readme = read('README.md');
  const lines = readme.split('\n');
  assert.equal(lines[1], read('docs/overview.md').split('\n')[1], '作者の言葉の行');
  assert.deepEqual(lines.slice(5, 9).map((l) => l.slice(0, 5)), ['- 誰の:', '- どんな', '- 何を:', '- どう:']);
  assert.ok(lines[8].includes('使う前は') && lines[8].includes('使うと'));
  assert.ok(!/\d/.test(lines.slice(5, 9).join('')), '要約の箇条に数字を置かない');
  const details = read('docs/details.md'); // README から移した「## 評価」の節
  const section = details.slice(details.indexOf('\n## 評価\n'), details.indexOf('\n## データと出典\n'));
  assertNumbers(section);
});

// README と docs/overview.md の冒頭の数字が docs/評価.md と食い違わないことを確かめる(F35c)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p) => fs.readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const hyouka = read('docs/評価.md');

// 評価の文書から数字を読む(冒頭の数字を試験に決め打ちしない)
const total = hyouka.match(/^\| 合計 \| (\d+) \| \*\*(\d+)\*\* \| \*\*(\d+)\*\* \|/m);
const rows = hyouka.match(/結果は同じ (\d+) のうち (\d+) だった/);

// 確かめた数字と版。overview は冒頭3行に、README は「## 評価」の節にある(F51a で README の冒頭から移した)
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

test('docs/overview.md の冒頭3行に、使う前と後の文と、評価の文書と同じ数字と版がある', () => {
  const head = read('docs/overview.md').split('\n').slice(0, 3).join('\n');
  assert.ok(head.includes('使う前は'));
  assert.ok(head.includes('使うと'));
  assertNumbers(head);
});

test('README.md の冒頭は作者の言葉のあとに誰の・何を・どうの3行で、数字は評価の節にある', () => {
  const readme = read('README.md');
  const lines = readme.split('\n');
  assert.equal(lines[1], read('docs/overview.md').split('\n')[1], '作者の言葉の行');
  assert.deepEqual(lines.slice(3, 6).map((l) => l.slice(0, 5)), ['- 誰の:', '- 何を:', '- どう:']);
  assert.ok(lines[5].includes('使う前は') && lines[5].includes('使うと'));
  assert.ok(!/\d/.test(lines.slice(3, 6).join('')), '要約の3行に数字を置かない');
  const section = readme.slice(readme.indexOf('\n## 評価\n'), readme.indexOf('\n## データと出典\n'));
  assertNumbers(section);
});

// README と docs/overview.md の冒頭の数字が docs/評価.md と食い違わないことを確かめる(F35c)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p) => fs.readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const hyouka = read('docs/評価.md');

// 評価の文書から数字を読む(冒頭の数字を試験に決め打ちしない)
const total = hyouka.match(/^\| 合計 \| (\d+) \| \*\*(\d+)\*\* \| \*\*(\d+)\*\* \|/m);
const rows = hyouka.match(/結果は同じ (\d+) のうち (\d+) だった/);

for (const file of ['README.md', 'docs/overview.md']) {
  test(`${file} の冒頭3行に、評価の文書と同じ数字と版がある`, () => {
    const head = read(file).split('\n').slice(0, 3).join('\n');
    assert.ok(total && rows, '評価の文書から数字を読めない');
    assert.ok(head.includes('使う前は'));
    assert.ok(head.includes('使うと'));
    assert.ok(head.includes(`${total[1]}件のうち見つけたのは${total[2]}件`));
    assert.ok(head.includes(`見落としが${total[3]}件`));
    assert.ok(head.includes(`${rows[1]}行のうち抜き書きが原文と合ったのは${rows[2]}行`));
    for (const version of ['2026-11-04', '7ba4f4f', '1fcb4ec', '令和7年11月版']) {
      assert.ok(head.includes(version), version);
    }
    assert.ok(!/\d+ *(%|割)/.test(head), '時間の減り方は書かない');
  });
}

// F74a: README と docs/overview.md の冒頭で、作者の立場の段落を箇条の上に置く(作者の決定)。
// 下の2つの文字列は移す前のファイルから写した。行を動かしても字句は変えないことを、この値と比べて確かめる
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p) => fs.readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const WORDS = '経験、ノウハウがないからこそ一から調べてやらなければならない<br>多くの経験がない若手や元請けを請けたことがない建設業に届いてほしい。<br>道具を使うことで若手に任せられるものが増えて、若手の教育を効率化できる。<br><br>';
const STANCE = '最初の3文は作者の言葉です。作者は建設の現場で働く1年目で、作者のいる部署は、いま初めて元請けに取り組もうとしています。大会のあと最初に使うのは、その仕事で、作者と身近にいる経験のある人です(入札の前と受注したあと)。3文目は作者の考えで、測った結果ではありません。';

for (const file of ['README.md', 'docs/overview.md']) {
  const lines = read(file).split('\n');
  const find = (head) => lines.findIndex((l) => l.startsWith(head));

  test(`${file}: 作者の3つの言葉の行が移す前と同じ`, () => {
    assert.equal(lines[1], WORDS);
    assert.equal(lines.filter((l) => l === WORDS).length, 1);
  });

  test(`${file}: 作者の立場の段落の文字の並びが移す前と同じで、1か所だけにある`, () => {
    const found = lines.filter((l) => l.includes('最初の3文は作者の言葉です'));
    assert.deepEqual(found, [STANCE]);
  });

  test(`${file}: 作者の立場の段落は作者の言葉のすぐ下で、4つの箇条より上にある`, () => {
    assert.equal(lines[2], '');
    assert.equal(lines[3], STANCE);
    assert.equal(lines[4], '');
    const bullets = ['- 誰の: ', '- どんな場面で: ', '- 何を: ', '- どう: '].map(find);
    assert.deepEqual(bullets, [5, 6, 7, 8]);
  });

  test(`${file}: 箇条の下は段落を抜いた跡が残らず、次の段落へ続く`, () => {
    assert.equal(lines[9], '');
    assert.ok(lines[10].startsWith('元請けとしての決まりは建設業法などの法令と発注者の仕様書に分かれています。'), lines[10].slice(0, 20));
  });
}

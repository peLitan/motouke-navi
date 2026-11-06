// 説明の仕上げ 2周目(F53a): overview の冒頭の要約と、README の期間の文を確かめる
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const read = (p) => fs.readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const readme = read('README.md');
const overview = read('docs/overview.md');
const author = '経験、ノウハウがないからこそ一から調べてやらなければならない<br>多くの経験がない若手や元請けを請けたことがない建設業に届いてほしい。<br>道具を使うことで若手に任せられるものが増えて、若手の教育を効率化できる。<br><br>';

test('overview の冒頭: 作者の言葉の行のあとに README と同じ3行の要約がある', () => {
  const r = readme.split('\n');
  const o = overview.split('\n');
  assert.equal(o[1], author);
  assert.equal(r[1], author);
  assert.deepEqual(o.slice(3, 6).map((l) => l.slice(0, 5)), ['- 誰の:', '- 何を:', '- どう:']);
  assert.deepEqual(o.slice(3, 6), r.slice(3, 6));
});

test('overview の説明の文: 要約を挟んでも「最初の3文」と指せて、数字は評価の節へ移っている', () => {
  assert.ok(overview.includes('最初の3文は作者の言葉です'));
  assert.ok(!overview.includes('上の3文'));
  assert.ok(overview.indexOf('確かめた数字:') > overview.indexOf('\n## 評価\n'));
});

test('README の期間の文: キックオフの日時と、git の最初のコミットの日時がある', () => {
  const line = readme.split('\n').find((l) => l.startsWith('> Built with Claude'));
  assert.ok(line.includes('キックオフは 2026-11-02 12:00〜12:30'));
  const first = execFileSync('git', ['log', '--reverse', '--format=%ad', '--date=format:%F %H:%M'], {
    cwd: new URL('../../', import.meta.url),
    encoding: 'utf8',
  }).split('\n')[0];
  const [day, time] = first.split(' ');
  assert.equal(day, '2026-11-02');
  assert.ok(line.includes(`最初のコミットは同じ日の ${time}`), first);
});

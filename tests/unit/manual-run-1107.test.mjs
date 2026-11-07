// F85l の単体の試験: 版 17b7bc2 の画面なしの入口の走らせの値と、見張り・PDF の走らせの結果が
// docs/manual.md と docs/development.md に書いてあることを見る。値はこの試験の期待の値に照らす。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const MANUAL = read('docs/manual.md');
const DEV = read('docs/development.md');
const between = (text, from, to) => {
  const i = text.indexOf(from);
  assert.ok(i >= 0, from);
  const j = text.indexOf(to, i + from.length);
  return text.slice(i, j > 0 ? j : undefined);
};
const SECTION = between(MANUAL, '## Claude で点検(画面なしの Claude Code)', '\n## ');
const LINES = SECTION.split('\n');
const HEADER = LINES.findIndex((l) => l.startsWith('| 版 | 日時 | 往復 | 秒 | 費用 |'));
const cells = (l) => l.split('|').slice(1, -1).map((c) => c.trim());

test('manual の表: 版 17b7bc2 の1行があり、値が記録のとおり', () => {
  assert.ok(HEADER > 0);
  assert.deepEqual(cells(LINES[HEADER + 2]), [
    '17b7bc2',
    '2026-11-07 15:45〜15:53',
    '23',
    '483',
    '$1.75',
    '主: Skill 1・ToolSearch 2・list_masked 1・Read 9・Bash 1・read_masked 2・check_articles 2・Agent 2・SendMessage 1/係: read_masked 4・check_articles 2',
    'なし',
    'あり(4件)',
    '欄なし(無いとき省かれる)',
    'masked-files connected、claude.ai Claude Docs pending',
    '0(記録が無く、動けない)',
  ]);
  assert.ok(!LINES[HEADER + 3].startsWith('|'), '値の行は1行だけ');
});

test('manual: 「統括が足す」の語が無く、古い「走らせていない」の文が残っていない', () => {
  assert.ok(!MANUAL.includes('統括が足す'));
  assert.ok(!MANUAL.includes('値は統括'));
  assert.ok(!MANUAL.includes('替えた後の版ではこの入口を走らせていません'));
  assert.ok(!MANUAL.includes('Claude Code に読み込ませて動かしてはいません'));
  assert.ok(!MANUAL.includes('1回の点検にかかる額は測っていません'));
});

test('manual の表の下: 流れ・許可なしの回・催促が 0 の理由・旗を外した回・入口を走らせていない断りがある', () => {
  const below = LINES.slice(HEADER + 3, HEADER + 12).join('\n');
  for (const w of [
    'opus',
    'Skill → read_masked → check_articles → refuter → 答え',
    '候補19件',
    '残る17',
    '崩れた2',
    '21秒',
    '$0.18',
    '`--no-session-persistence`',
    'Stop の催促が 0 なのは',
    '記録のファイルが無く',
    '`check-done` が動けなかったため',
    'sonnet',
    '80秒+23秒',
    '$0.42',
    '催促が1回出ました',
    '旗を外した入口では走らせていません',
  ]) assert.ok(below.includes(w), w);
  assert.ok(!below.includes('直した入口'), '入口は直していないので、直したと読める語を書かない');
});

test('manual の催促の限界の節: 画面なしの入口と記録の関係の1行があり、旗を外さない理由がある', () => {
  const limit = between(MANUAL, '### 手順の抜けの催促の限界', '\n## ');
  const rows = limit.split('\n').filter((l) => l.startsWith('- 画面なしの入口:'));
  assert.equal(rows.length, 1);
  for (const w of ['`scripts/claude-headless.mjs`', '`--no-session-persistence`', '`check-done`', '催促は出ません', '置き換えた後の書類の中身']) assert.ok(rows[0].includes(w), w);
  // 動かした記録がある今は、確かめたことの行もそれに触れる
  const done = limit.split('\n').filter((l) => l.startsWith('- 確かめたこと:'));
  assert.equal(done.length, 1);
  assert.ok(done[0].includes('17b7bc2'));
  assert.ok(done[0].includes('opus'), '見ていない範囲も書く');
});

test('manual の bid-intake の PDF の行の次に、走らせた結果の1行がある', () => {
  const lines = between(MANUAL, '## 公告から条件を拾う(Skill `bid-intake`)', '\n## ').split('\n');
  const i = lines.findIndex((l) => l.startsWith('- PDF の公告:'));
  assert.ok(i > 0);
  const row = lines[i + 1];
  for (const w of ['架空の PDF', '2回とも', '`pdf-to-text.mjs`', '複合の命令', '断られ', 'スクリプトは動いていません', '公開の公告の PDF では試していません']) assert.ok(row.includes(w), w);
});

test('development: 残 5 の行が消えず今の形で、ほかの行の未測の参照も今の形', () => {
  const rows = DEV.split('\n').filter((l) => l.startsWith('| 残 5 |'));
  assert.equal(rows.length, 1);
  const [num, state, what, where] = cells(rows[0]);
  assert.equal(num, '残 5');
  assert.equal(state, '走らせた');
  for (const w of ['画面なしの入口', '17b7bc2', 'Stop の見張り', '`--no-session-persistence`']) assert.ok(what.includes(w), w);
  assert.ok(!what.includes('走らせていない'));
  assert.equal(where, '`docs/manual.md` の「走らせた記録」');
  assert.ok(!DEV.includes('F56a の後は未測(残 5)'));
});

test('overview: check_articles の行が走らせた事実に合う', () => {
  const rows = read('docs/overview.md').split('\n').filter((l) => l.startsWith('| MCP `check_articles` |'));
  assert.equal(rows.length, 1);
  assert.ok(!rows[0].includes('まだ走らせていない'));
  assert.ok(rows[0].includes('17b7bc2'));
});

test('公開の文書から設計の文書を指さない。CHANGELOG の行に版・F番号のほかの数字が無い', () => {
  for (const [name, text] of [['manual', MANUAL], ['development', DEV]]) assert.ok(!text.includes('prep/'), name);
  const rows = read('CHANGELOG.md').split('\n').filter((l) => l.startsWith('- F85l: '));
  assert.equal(rows.length, 1);
  assert.doesNotMatch(rows[0].slice('- F85l: '.length), /[0-9０-９一二三四五六七八九十百千]/);
});

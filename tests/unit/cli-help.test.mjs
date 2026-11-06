// 画面なしの入口の引数(F83a5): run-fixtures・measure-bid-intake・check-quotes・build.mjs を main(argv, io) で呼んで確かめる
// 書くのはリポジトリの tmp/ の下だけ(init の試験はそこにしか書けない)。index.html は読むだけで比べる
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as runFixtures from '../../scripts/run-fixtures.mjs';
import * as measureBid from '../../scripts/measure-bid-intake.mjs';
import * as checkQuotes from '../../scripts/check-quotes.mjs';
import * as build from '../../build.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
fs.mkdirSync(path.join(ROOT, 'tmp'), { recursive: true });
const WORK = fs.mkdtempSync(path.join(ROOT, 'tmp', 'cli-help-'));
after(() => fs.rmSync(WORK, { recursive: true, force: true }));

// 出力を集める io。cwd は相対のパスの起点
function makeIo(cwd = WORK) {
  const out = []; const err = [];
  return { out, err, io: { log: (s) => out.push(String(s)), error: (s) => err.push(String(s)), cwd } };
}
const noStack = (lines) => lines.every((l) => !/\n\s+at |^\s*at |Error:/.test(l));
const listWork = () => fs.readdirSync(WORK).sort();

const TOOLS = [
  ['run-fixtures', runFixtures],
  ['measure-bid-intake', measureBid],
  ['check-quotes', checkQuotes],
  ['build.mjs', build],
];

test('4本とも --help と -h で使い方(読むもの・引数・例)を出して 0', () => {
  for (const [name, mod] of TOOLS) {
    for (const flag of ['--help', '-h']) {
      const { out, err, io } = makeIo();
      assert.equal(mod.main([flag], io), 0, name + ' ' + flag);
      const text = out.join('\n');
      assert.match(text, /^使い方: node /, name);
      assert.match(text, /読むもの: /, name + ' は何を読むかを書く');
      assert.match(text, /引数:/, name);
      assert.match(text, /\n例: node /, name + ' は例を1つ書く');
      assert.deepEqual(err, [], name);
    }
  }
});

test('run-fixtures --help は --help という名のファイルを作らない', () => {
  const before = listWork();
  const { io } = makeIo();
  assert.equal(runFixtures.main(['--help'], io), 0);
  assert.equal(runFixtures.main(['-h', 'out.json'], io), 0, '--help があれば、ほかの引数があっても書かない');
  assert.deepEqual(listWork(), before);
  assert.equal(fs.existsSync(path.join(ROOT, '--help')), false);
});

test('4本とも - で始まる知らない引数は「知らない引数」と使い方の1行で 2。ファイルを作らない', () => {
  const before = listWork();
  for (const [name, mod] of TOOLS) {
    for (const arg of ['--out', '-o', '--check']) {
      const { out, err, io } = makeIo();
      assert.equal(mod.main([arg], io), 2, name + ' ' + arg);
      assert.deepEqual(err, ['知らない引数: ' + arg, mod.USAGE_LINE], name);
      assert.deepEqual(out, [], name + ' は何も出さない(点検も測りもしない)');
    }
  }
  assert.deepEqual(listWork(), before);
});

test('run-fixtures: 入力のつもりの JSON を出力先に渡すと、中身を変えずに「上書きしません」で 1', () => {
  const file = path.join(WORK, 'N1.json');
  const input = JSON.stringify({ notice: '架空の公告', conditions: [{ key: 'grade', value: 'xxxx' }] }, null, 2) + '\n';
  fs.writeFileSync(file, input);
  for (const given of ['N1.json', file]) {
    const { out, err, io } = makeIo();
    assert.equal(runFixtures.main([given], io), 1);
    assert.equal(err.length, 1);
    assert.match(err[0], /^上書きしません: /);
    assert.deepEqual(out, []);
    assert.equal(fs.readFileSync(file, 'utf8'), input, '中身が変わらない');
  }
  // JSON でない文・フォルダも上書きしない
  fs.writeFileSync(path.join(WORK, 'memo.txt'), 'メモ\n');
  fs.mkdirSync(path.join(WORK, 'out-dir'), { recursive: true });
  for (const given of ['memo.txt', 'out-dir']) {
    const { io } = makeIo();
    assert.equal(runFixtures.main([given], io), 1, given);
  }
  assert.equal(fs.readFileSync(path.join(WORK, 'memo.txt'), 'utf8'), 'メモ\n');
});

test('run-fixtures: 前の出力の形なら上書きし、無いファイルには書く(中身は標準出力と同じ)', () => {
  const stdout = makeIo();
  assert.equal(runFixtures.main([], stdout.io), 0, '引数の無いときは標準出力');
  const json = stdout.out.join('\n') + '\n';
  assert.equal(runFixtures.isPreviousOutput(json), true);

  const fresh = makeIo();
  assert.equal(runFixtures.main(['run-fixtures.json'], fresh.io), 0);
  assert.equal(fs.readFileSync(path.join(WORK, 'run-fixtures.json'), 'utf8'), json);

  const old = JSON.stringify({ note: runFixtures.NOTE, cases: [] }, null, 2) + '\n';
  fs.writeFileSync(path.join(WORK, 'old.json'), old);
  assert.equal(runFixtures.main(['old.json'], makeIo().io), 0);
  assert.equal(fs.readFileSync(path.join(WORK, 'old.json'), 'utf8'), json);

  // 鍵が足されている・note が違うものは前の出力の形ではない
  assert.equal(runFixtures.isPreviousOutput(JSON.stringify({ note: runFixtures.NOTE, cases: [], extra: 1 })), false);
  assert.equal(runFixtures.isPreviousOutput(JSON.stringify({ note: '別の文', cases: [] })), false);
  assert.equal(runFixtures.isPreviousOutput('[]'), false);
});

test('run-fixtures: 出力先のフォルダが無いときは1行で 1、引数が多いときは 2', () => {
  const a = makeIo();
  assert.equal(runFixtures.main(['無いフォルダ/out.json'], a.io), 1);
  assert.equal(a.err.length, 1);
  assert.match(a.err[0], /^フォルダがありません: /);
  assert.ok(noStack(a.err));
  const b = makeIo();
  assert.equal(runFixtures.main(['a.json', 'b.json'], b.io), 2);
  assert.match(b.err[0], /^引数が多すぎます: b\.json$/);
  assert.equal(fs.existsSync(path.join(WORK, 'a.json')), false);
});

test('measure-bid-intake: 無いパスは Error のスタックを出さず1行で 1。正解の表より先に入力を確かめる', () => {
  // 正解の表のフォルダにも無いパスを渡す。先に正解の表を読むなら、そちらの名前が出る
  const { out, err, io } = makeIo();
  assert.equal(measureBid.main(['無い入力', '--answers', '無い正解', '--notices', '無い原文'], io), 1);
  assert.deepEqual(err, ['フォルダがありません: ' + path.join(WORK, '無い入力')]);
  assert.deepEqual(out, []);
  assert.ok(noStack(err));
});

test('measure-bid-intake: フォルダの中の1つが無いときも、スタックを出さずにそのファイルの名前で 1', () => {
  // 作り物の正解の表(本物の正解の表は読まない)。N9.json は置かない
  const answers = path.join(WORK, 'answers'); const input = path.join(WORK, 'picked');
  fs.mkdirSync(answers, { recursive: true }); fs.mkdirSync(input, { recursive: true });
  fs.writeFileSync(path.join(answers, 'N9.md'), '原文: xxxx.txt\n\n| 欄 | 値 | 備考 |\n|---|---|---|\n| grade | xxxx | |\n');
  const { err, io } = makeIo();
  assert.equal(measureBid.main(['picked', '--answers', 'answers', '--notices', 'picked'], io), 1);
  assert.deepEqual(err, ['ファイルがありません: ' + path.join(input, 'N9.json')]);
  assert.ok(noStack(err));
  // 入力がファイルなら、フォルダではないと言う
  fs.writeFileSync(path.join(WORK, 'one.json'), '{}\n');
  const b = makeIo();
  assert.equal(measureBid.main(['one.json'], b.io), 1);
  assert.deepEqual(b.err, ['フォルダではありません: ' + path.join(WORK, 'one.json')]);
});

test('measure-bid-intake: 値の無いオプションと多すぎる引数は 2', () => {
  const a = makeIo();
  assert.equal(measureBid.main(['--answers'], a.io), 2);
  assert.deepEqual(a.err, ['値がありません: --answers', measureBid.USAGE_LINE]);
  const b = makeIo();
  assert.equal(measureBid.main(['x', 'y'], b.io), 2);
  assert.match(b.err[0], /^引数が多すぎます: y$/);
});

test('check-quotes: 引数の無いときは今のとおり照らして 0。引数を渡すと照らさずに 2', () => {
  const { out, err, io } = makeIo();
  assert.equal(checkQuotes.main([], io), 0);
  assert.match(out.at(-1), /^抜き書き \d+ 件のうち 不一致 0 件$/);
  assert.ok(out.some((l) => l.startsWith('一致\t')));
  assert.deepEqual(err, []);
  const b = makeIo();
  assert.equal(checkQuotes.main(['data/quotes.json'], b.io), 2);
  assert.deepEqual(b.err, ['この道具は引数を取りません: data/quotes.json', checkQuotes.USAGE_LINE]);
  assert.deepEqual(b.out, []);
});

test('build.mjs: 知らない引数・余分な引数・--help では index.html を書かない(中身が変わらない)', () => {
  const file = path.join(ROOT, 'index.html');
  const before = fs.readFileSync(file);
  const stat = fs.statSync(file);
  for (const argv of [['--check'], ['--out', 'x.html'], ['index.html'], ['--help']]) {
    const { io } = makeIo();
    assert.equal(build.main(argv, io), argv[0] === '--help' ? 0 : 2, argv.join(' '));
  }
  assert.deepEqual(fs.readFileSync(file), before);
  assert.equal(fs.statSync(file).mtimeMs, stat.mtimeMs, '書き直してもいない');
  assert.equal(fs.existsSync(path.join(WORK, 'x.html')), false);
});

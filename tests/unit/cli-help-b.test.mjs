// sync-plugin・claude-headless の引数(F83b9): F83a5 と同じ形の --help と知らない引数の断り。
// sync-plugin は写しの根を差し替えられるので、リポジトリの plugin/ には書かない。書くのは tmp/ の下だけ(init の試験はそこにしか書けない)。
// claude-headless は走らせる部分を差し替え、本物の claude は呼ばない。子プロセスは node だけで、通信しない
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as sync from '../../scripts/sync-plugin.mjs';
import * as headless from '../../scripts/claude-headless.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
fs.mkdirSync(path.join(ROOT, 'tmp'), { recursive: true });
const WORK = fs.mkdtempSync(path.join(ROOT, 'tmp', 'cli-help-b-'));
after(() => fs.rmSync(WORK, { recursive: true, force: true }));
const noChild = process.permission ? !process.permission.has('child') : false;
const childSkip = { skip: noChild && '子プロセスを許さない権限(init の試験)。node --test で確かめる' };

function makeIo() {
  const out = []; const err = [];
  return { out, err, io: { log: (s) => out.push(String(s)), error: (s) => err.push(String(s)), cwd: WORK } };
}
const listAll = (dir) => fs.readdirSync(dir, { recursive: true }).map(String).sort();

// 元のファイルだけを持つ根(写しの plugin/ は無い)。子プロセス用に道具も写す
function sourceRoot(name) {
  const root = path.join(WORK, name);
  for (const rel of [...new Set(sync.PLUGIN_COPIES.map(([src]) => src)), 'scripts/sync-plugin.mjs', 'scripts/cli.mjs']) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.copyFileSync(path.join(ROOT, rel), path.join(root, rel));
  }
  return root;
}
const runNode = (script, args, cwd) => spawnSync(process.execPath, [script, ...args], { cwd, encoding: 'utf8', timeout: 60000 });

// ---- sync-plugin ----
test('sync-plugin: --help と -h は使い方を出して 0。写しを作らない', () => {
  const root = sourceRoot('sync-help');
  const before = listAll(root);
  for (const argv of [['--help'], ['-h'], ['--check', '--help'], ['-h', '--nope']]) {
    const { out, err, io } = makeIo();
    assert.equal(sync.main(argv, io, root), 0, argv.join(' '));
    assert.deepEqual(out, [sync.USAGE]);
    assert.deepEqual(err, []);
  }
  assert.deepEqual(listAll(root), before);
  assert.match(sync.USAGE, /^使い方: node scripts\/sync-plugin\.mjs/);
  assert.match(sync.USAGE, /読むもの: /);
  assert.match(sync.USAGE, /書くもの: /);
  assert.match(sync.USAGE, /引数:/);
  assert.match(sync.USAGE, /\n例: node /);
  assert.match(sync.USAGE, /--check/);
});

test('sync-plugin: 知らない引数・余分な引数は 2。写しを作らず、確かめもしない', () => {
  const root = sourceRoot('sync-unknown');
  const before = listAll(root);
  for (const [argv, msg] of [
    [['--nope'], '知らない引数: --nope'],
    [['-x'], '知らない引数: -x'],
    [['--chek'], '知らない引数: --chek'],
    [['--check', '--nope'], '知らない引数: --nope'],
    [['--nope', '--check'], '知らない引数: --nope'],
    [['foo'], 'この道具は引数を取りません: foo'],
    [['--check', 'foo'], 'この道具は引数を取りません: foo'],
  ]) {
    const { out, err, io } = makeIo();
    assert.equal(sync.main(argv, io, root), 2, argv.join(' '));
    assert.deepEqual(err, [msg, sync.USAGE_LINE]);
    assert.deepEqual(out, []);
  }
  assert.deepEqual(listAll(root), before);
});

test('sync-plugin: 引数なしは写しを作り直し、--check は同じなら 0、違えば写しを直さず 1(文は今のまま)', () => {
  const root = sourceRoot('sync-same');
  const n = sync.PLUGIN_COPIES.length;
  const made = makeIo();
  assert.equal(sync.main([], made.io, root), 0);
  assert.deepEqual(made.out, [`plugin の写しを作り直した(${n} ファイル)`]);
  assert.deepEqual(made.err, []);
  assert.deepEqual(sync.staleCopies(root), []);

  const same = makeIo();
  assert.equal(sync.main(['--check'], same.io, root), 0);
  assert.deepEqual(same.out, [`plugin の写しは元と同じ(${n} ファイル)`]);
  assert.deepEqual(same.err, []);

  const [, dst] = sync.PLUGIN_COPIES[0];
  fs.appendFileSync(path.join(root, dst), '// 違い\n');
  const changed = fs.readFileSync(path.join(root, dst));
  const ng = makeIo();
  assert.equal(sync.main(['--check'], ng.io, root), 1);
  assert.deepEqual(ng.out, []);
  assert.deepEqual(ng.err, ['元と違う写し: ' + dst]);
  assert.ok(fs.readFileSync(path.join(root, dst)).equals(changed), '--check は直さない');
});

test('sync-plugin: 本物の入口の出力と終了コード(子プロセス)', childSkip, () => {
  const root = sourceRoot('sync-child');
  const script = path.join(root, 'scripts/sync-plugin.mjs');
  const n = sync.PLUGIN_COPIES.length;
  const before = listAll(root);
  const help = runNode(script, ['--help'], root);
  assert.equal(help.status, 0, help.stderr);
  assert.equal(help.stdout, sync.USAGE + '\n');
  assert.equal(help.stderr, '');
  const bad = runNode(script, ['--nope'], root);
  assert.equal(bad.status, 2);
  assert.equal(bad.stdout, '');
  assert.equal(bad.stderr, `知らない引数: --nope\n${sync.USAGE_LINE}\n`);
  assert.deepEqual(listAll(root), before, '--help と知らない引数は何も書かない');

  const stale = runNode(script, ['--check'], root);
  assert.equal(stale.status, 1);
  assert.equal(stale.stdout, '');
  assert.equal(stale.stderr, '元と違う写し: ' + sync.PLUGIN_COPIES.map(([, d]) => d).join(', ') + '\n');
  const made = runNode(script, [], root);
  assert.equal(made.status, 0, made.stderr);
  assert.equal(made.stdout, `plugin の写しを作り直した(${n} ファイル)\n`);
  const ok = runNode(script, ['--check'], root);
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(ok.stdout, `plugin の写しは元と同じ(${n} ファイル)\n`);
});

// ---- claude-headless ----
function workDir(name) {
  const w = path.join(WORK, name);
  fs.mkdirSync(path.join(w, 'raw'), { recursive: true });
  fs.writeFileSync(path.join(w, 'raw', 'a.txt'), '架空の書類\n');
  fs.writeFileSync(path.join(w, 'raw', 'b.txt'), '架空の書類\n');
  return w;
}
const notCalled = async () => { throw new Error('走らせてはいけない'); };

test('claude-headless: --help と -h は使い方を出して 0。claude を動かさず何も書かない', async () => {
  const w = workDir('hl-help');
  const before = listAll(w);
  for (const argv of [['--help'], ['-h'], ['--work', w, '--help'], ['-h', '--nope'], ['--work', '--help']]) {
    const { out, err, io } = makeIo();
    assert.equal(await headless.main(argv, io, notCalled), 0, argv.join(' '));
    assert.deepEqual(out, [headless.USAGE]);
    assert.deepEqual(err, []);
  }
  assert.deepEqual(listAll(w), before);
  assert.match(headless.USAGE, /^使い方: node scripts\/claude-headless\.mjs/);
  assert.match(headless.USAGE, /読むもの: /);
  assert.match(headless.USAGE, /書くもの: /);
  assert.match(headless.USAGE, /引数:/);
  assert.match(headless.USAGE, /\n例: node /);
  for (const flag of ['--work', '--doc', '--log', '--max-budget-usd']) assert.ok(headless.USAGE.includes(flag), flag);
});

test('claude-headless: 知らない引数は 2。claude を動かさず何も書かない', async () => {
  const w = workDir('hl-unknown');
  const before = listAll(w);
  for (const [argv, msg] of [
    [['--nope'], '知らない引数: --nope'],
    [['-x'], '知らない引数: -x'],
    [['--work', w, '--nope'], '知らない引数: --nope'],
    [['--work', w, '--doc', 'raw/a.txt', '--docs', 'raw/b.txt'], '知らない引数: --docs'],
    [['--work=' + w], '知らない引数: --work=' + w],
    [['--work', w, 'raw/a.txt'], '知らない引数: raw/a.txt'],
    [['--check'], '知らない引数: --check'],
    [['--work'], '値がありません: --work'],
    [['--work', '--log', 'x.jsonl'], '値がありません: --work'],
    [['--work', w, '--doc'], '値がありません: --doc'],
    [['--work', w, '--log'], '値がありません: --log'],
    [['--work', w, '--max-budget-usd'], '値がありません: --max-budget-usd'],
  ]) {
    const { out, err, io } = makeIo();
    assert.equal(await headless.main(argv, io, notCalled), 2, argv.join(' '));
    assert.deepEqual(err, [msg, headless.USAGE_LINE]);
    assert.deepEqual(out, []);
  }
  assert.deepEqual(listAll(w), before);
});

test('claude-headless: 引数なしと --work なしは今のとおり使い方を標準出力に出して 2', async () => {
  for (const argv of [[], ['--doc', 'raw/a.txt'], ['--max-budget-usd', '2']]) {
    const { out, err, io } = makeIo();
    assert.equal(await headless.main(argv, io, notCalled), 2);
    assert.deepEqual(out, [headless.USAGE_LINE]);
    assert.deepEqual(err, []);
  }
});

test('claude-headless: 正しい引数は今のとおり渡る(--doc は2つ以上)。--max-budget-usd の誤りは今のとおり止まる', async () => {
  const w = workDir('hl-ok');
  const calls = [];
  const run = async (a) => { calls.push(a); return { code: 0, summary: headless.summarize('') }; };
  const log = path.join(w, 'x.jsonl');
  const { out, io } = makeIo();
  await headless.main(['--work', w, '--doc', 'raw/a.txt', '--doc', 'raw/b.txt', '--log', log, '--max-budget-usd', '2'], io, run);
  assert.deepEqual(calls, [{ work: path.resolve(w), log, docs: ['raw/a.txt', 'raw/b.txt'], maxBudgetUsd: 2 }]);
  assert.deepEqual(out, []);

  const failed = makeIo();
  const code = await headless.main(['--work', w, '--log', log], failed.io, run);
  assert.equal(code, 1, 'result の無い記録は失敗');
  assert.ok(failed.err.includes('記録: ' + log + '(置き換えた後の書類の中身が入ります。外へ渡さないでください)'));
  assert.ok(failed.err.some((l) => l.startsWith('注意: 終わりの知らせ')));

  for (const v of ['0', '-1', 'abc']) {
    await assert.rejects(headless.main(['--work', w, '--max-budget-usd', v], makeIo().io, notCalled), /--max-budget-usd は 0 より大きい数/);
  }
});

test('claude-headless: 本物の入口の終了コード(claude は呼ばない)', childSkip, () => {
  const script = path.join(ROOT, 'scripts/claude-headless.mjs');
  const help = runNode(script, ['--help'], WORK);
  assert.equal(help.status, 0, help.stderr);
  assert.equal(help.stdout, headless.USAGE + '\n');
  assert.equal(help.stderr, '');
  const bad = runNode(script, ['--nope'], WORK);
  assert.equal(bad.status, 2);
  assert.equal(bad.stdout, '');
  assert.equal(bad.stderr, `知らない引数: --nope\n${headless.USAGE_LINE}\n`);
  const none = runNode(script, [], WORK);
  assert.equal(none.status, 2);
  assert.equal(none.stdout, headless.USAGE_LINE + '\n');
  assert.equal(none.stderr, '');
  const noRaw = runNode(script, ['--work', path.join(WORK, '無いフォルダ')], WORK);
  assert.equal(noRaw.status, 1);
  assert.match(noRaw.stderr, /^止まりました: 作業フォルダに raw\/ がありません: /);
  const budget = runNode(script, ['--work', WORK, '--max-budget-usd', '-1'], WORK);
  assert.equal(budget.status, 1);
  assert.match(budget.stderr, /^止まりました: --max-budget-usd は 0 より大きい数/);
});

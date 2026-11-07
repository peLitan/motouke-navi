// 直下の package.json の決まり(F83b8)。部品を入れずに npm test と npm run build が動く形を保つ。
// scripts.test が回すファイルは、README の試験の命令が回すファイルと同じであること。
// `node --test tests/` は Node 22 以降ではフォルダをファイルとして開いて落ちるので、字ではなく回す先で比べる。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');

const files = (patterns) => {
  const hits = patterns.flatMap((p) => fs.globSync(p, { cwd: root }));
  return [...new Set(hits.map((h) => h.split(path.sep).join('/')))].sort();
};
const argsOf = (command) => command.trim().split(/\s+/).slice(2).map((a) => a.replace(/^"(.*)"$/, '$1'));

test('部品に頼らない(依存の欄が1つも無い)', () => {
  for (const key of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
    assert.equal(key in pkg, false, key + ' が有る');
  }
});

test('公開しない・ES モジュール・build は build.mjs', () => {
  assert.equal(pkg.private, true);
  assert.equal(pkg.type, 'module');
  assert.equal(pkg.scripts.build, 'node build.mjs');
  assert.ok(fs.existsSync(path.join(root, 'build.mjs')));
});

test('engines の Node の版は README の書いている版と同じ', () => {
  const m = readme.match(/Node\.js (\d+) 以降/);
  assert.ok(m, 'README に Node の版の文が無い');
  assert.equal(pkg.engines.node, '>=' + m[1]);
});

test('scripts.test は README の試験の命令と同じファイルを回す', () => {
  const commands = [...readme.matchAll(/`(node --test [^`]+)`/g)].map((m) => m[1]);
  assert.ok(commands.length >= 2, 'README に試験の命令が無い');
  assert.match(pkg.scripts.test, /^node --test /);
  const want = files(commands.flatMap(argsOf));
  assert.ok(want.some((f) => f.startsWith('tests/acceptance/')));
  assert.ok(want.some((f) => f.startsWith('tests/unit/')));
  assert.deepEqual(files(argsOf(pkg.scripts.test)), want);
});

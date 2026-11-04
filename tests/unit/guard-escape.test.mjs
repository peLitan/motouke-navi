// F31a の単体の試験: 引用符の外の \ と、読み込んだ別のファイルの中の読み取りを見る(値はすべて架空)
// 反証 第2弾の再現の入力(C-1)が止まる/人に回ることと、止めすぎていないことを確かめる
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as pluginGuard from '../../plugin/scripts/guard-raw.mjs';
import * as baseGuard from '../../integration/claude-code/hooks/guard-raw.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ENV = { HOME: '/home/example' };
const HUMAN = '人が中身を確かめて';

const FILES = {
  'raw/a.txt': '現場代理人 甲野 一郎(架空)',
  'masked/b.txt': '〔人名1〕',
  // C-1 の形: main は import だけで、別のファイルが fs で読む
  'main.mjs': "import { dump } from './helper.mjs';\ndump(process.argv[2]);\n",
  'helper.mjs': "import fs from 'node:fs';\nexport const dump = (p) => console.log(fs.readFileSync(p, 'utf8'));\n",
  // 二段目で読む・multi-line の import・export from・拡張子を省いた require
  'two.mjs': "import {\n  dump,\n} from './main.mjs';\n",
  'reexport.mjs': "export * from './helper.mjs';\n",
  'cjs.cjs': "const h = require('./helper-cjs');\nh.dump(process.argv[2]);\n",
  'helper-cjs.cjs': "exports.dump = (p) => console.log(require('fs').readFileSync(p, 'utf8'));\n",
  'side.mjs': "import './helper.mjs';\n",
  'missing-import.mjs': "import './nothing.mjs';\n",
  'worker.mjs': "import { Worker } from 'node:worker_threads';\nnew Worker('./helper.mjs');\n",
  'made-require.mjs': "import { createRequire } from 'node:module';\ncreateRequire(import.meta.url)('./helper-cjs.cjs');\n",
  'lib/inner.mjs': "export { dump } from '../helper.mjs';\n",
  'nested.mjs': "import { dump } from './lib/inner.mjs';\n",
  // Python の手元の import
  'main.py': 'import helper_py\nhelper_py.dump()\n',
  'from.py': 'from helper_py import dump\ndump()\n',
  'pkgmain.py': 'from pkg import reader\nreader.dump()\n',
  'helper_py.py': "def dump():\n    print(open('a').read())\n",
  'pkg/__init__.py': '',
  'pkg/reader.py': "from .deep import dump\n",
  'pkg/deep.py': "def dump():\n    print(open('a').read())\n",
  // 通すもの
  'pure-main.mjs': "import { add } from './pure.mjs';\nimport data from './data.json' with { type: 'json' };\nimport path from 'node:path';\nconsole.log(add(1, 2), data, path.sep);\n",
  'pure.mjs': "export const add = (a, b) => a + b;\n",
  'data.json': '{"open (": 1}\n',
  'cycle-a.mjs': "import './cycle-b.mjs';\n",
  'cycle-b.mjs': "import './cycle-a.mjs';\n",
  'pure.py': 'import json, os.path as p\nfrom collections import OrderedDict\nimport pure_helper\nprint(json, p, OrderedDict, pure_helper.ONE)\n',
  'pure_helper.py': 'ONE = 1\n',
};

function makeWork(name) {
  const dir = path.join(ROOT, 'tmp', 'f31a-' + name);
  fs.rmSync(dir, { recursive: true, force: true });
  for (const [p, text] of Object.entries(FILES)) {
    fs.mkdirSync(path.dirname(path.join(dir, p)), { recursive: true });
    fs.writeFileSync(path.join(dir, p), text);
  }
  return dir;
}

const bash = (g, command, cwd) => g.decideTool({ tool_name: 'Bash', tool_input: { command }, cwd }, ENV);
const ps = (g, command, cwd) => g.decideTool({ tool_name: 'PowerShell', tool_input: { command }, cwd }, ENV);

for (const [label, g] of [['プラグインの写し', pluginGuard], ['integration の元', baseGuard]]) {
  const key = g === pluginGuard ? 'p' : 'b';

  test(`${label}: 引用符の外の \\ は bash と同じに読む(C-1 の再現の入力が止まる)`, () => {
    const cwd = makeWork('esc-' + key);
    const blocked = [
      'cat r\\aw/a.txt', 'base64 r\\aw/a.txt', 'xxd r\\aw/a.txt', 'od -c r\\aw/a.txt', 'tail -n +1 r\\aw/a.txt', 'awk 1 r\\aw/a.txt',
      'cp r\\aw/a.txt /tmp/z', 'cat ./r\\aw/a.txt', 'cat r\\aw/*.txt',
      // すでに止まっていた形が止まったままであること
      'cat "r\\aw/a.txt"', "cat 'r'aw/a.txt",
      // 同じ原因の別の形
      'cat ra\\w/a.txt', 'cat \\r\\a\\w/a.txt', 'cat raw\\/a.txt', 'cd r\\aw && cat a.txt', 'cat < r\\aw/a.txt',
      'cat ra\\\nw/a.txt', 'cat "ra\\\nw/a.txt"', 'c\\at r\\aw/a.txt', 'sudo cat r\\aw/a.txt', 'CAT=1 cat R\\AW/a.txt',
    ];
    for (const c of blocked) assert.equal(bash(g, c, cwd).block, true, '止まらない: ' + c);
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  test(`${label}: raw/ が無い作業フォルダでも、外の raw/ を \\ で隠した指定は止まる`, () => {
    const cwd = path.join(ROOT, 'tmp', 'f31a-noraw-' + key);
    fs.rmSync(cwd, { recursive: true, force: true });
    fs.mkdirSync(cwd, { recursive: true });
    assert.equal(bash(g, 'cat ../work/r\\aw/a.txt', cwd).block, true);
    assert.equal(bash(g, 'cat masked/b.txt', cwd).block, false);
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  test(`${label}: 環境変数のパスが止まる`, () => {
    const cwd = makeWork('env-' + key);
    for (const c of ['P=r\\aw/a.txt node main.mjs', 'P=r\\aw/a.txt node pure-main.mjs', 'env P=r\\aw/a.txt node pure-main.mjs', 'export P=r\\aw/a.txt; node pure-main.mjs', "P='r'aw/a.txt node pure-main.mjs"]) {
      assert.equal(bash(g, c, cwd).block, true, '止まらない: ' + c);
    }
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  test(`${label}: 読み込んだ別のファイルの中の読み取りが止まり、人に回る`, () => {
    const cwd = makeWork('load-' + key);
    const blocked = [
      'node main.mjs r\\aw/a.txt', 'node main.mjs masked/b.txt', 'node ./main.mjs x', 'node two.mjs', 'node reexport.mjs', 'node side.mjs', 'node cjs.cjs x', 'node nested.mjs',
      'node missing-import.mjs', 'node worker.mjs', 'node made-require.mjs', 'node -r ./helper-cjs.cjs pure-main.mjs', 'node --import ./helper.mjs pure-main.mjs', 'node --import=./helper.mjs pure-main.mjs',
      'python3 main.py', 'python3 from.py', 'python3 pkgmain.py',
    ];
    for (const c of blocked) {
      const r = bash(g, c, cwd);
      assert.equal(r.block, true, '止まらない: ' + c);
      assert.ok(r.reason.includes(HUMAN) || r.reason.includes('read_masked'), '人に回らない: ' + c + ' → ' + r.reason);
    }
    assert.match(bash(g, 'node main.mjs masked/b.txt', cwd).reason, /helper\.mjs/);
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  test(`${label}: 止めすぎない(読み取りの無い読み込み・循環・raw に届かない \\)`, () => {
    const cwd = makeWork('ok-' + key);
    const passed = [
      'node pure-main.mjs', 'node cycle-a.mjs', 'python3 pure.py', 'cat masked/b.txt', 'cat masked\\/b.txt', 'cat mas\\ked/b.txt', 'echo a\\ b', "printf 'r\\aw\\n'", 'echo "a\\nb"',
      'cat masked/b.txt \\\n  masked/b.txt', 'echo \\*',
    ];
    for (const c of passed) {
      const r = bash(g, c, cwd);
      assert.equal(r.block, false, '止めすぎ: ' + c + ' → ' + r.reason);
    }
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  test(`${label}: PowerShell では \\ をパスの区切りのまま読む`, () => {
    const cwd = makeWork('ps-' + key);
    for (const c of ['node .\\pure-main.mjs', 'Get-Content masked\\b.txt', 'node lib\\..\\pure-main.mjs']) {
      const r = ps(g, c, cwd);
      assert.equal(r.block, false, '止めすぎ(PowerShell): ' + c + ' → ' + r.reason);
    }
    for (const c of ['Get-Content raw\\a.txt', 'Get-Content .\\raw\\a.txt', 'node .\\main.mjs', 'Get-Content r?w\\a.txt']) {
      assert.equal(ps(g, c, cwd).block, true, '止まらない(PowerShell): ' + c);
    }
    // Bash の道具でも、\ を区切りと読む形は前と同じく止める
    assert.equal(bash(g, 'cat masked\\..\\raw\\a.txt', cwd).block, true);
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  test(`${label}: splitCommand の読み方`, () => {
    const texts = (c, o) => g.splitCommand(c, o).flat().map((w) => w.text);
    assert.deepEqual(texts('cat r\\aw/a.txt'), ['cat', 'raw/a.txt']);
    assert.deepEqual(texts('cat r\\aw/a.txt', { backslashPath: true }), ['cat', 'r\\aw/a.txt']);
    assert.deepEqual(texts('cat ra\\\nw'), ['cat', 'raw']);
    assert.deepEqual(texts('echo a\\ b; ls'), ['echo', 'a b', 'ls']);
    assert.equal(g.splitCommand('echo r\\?w').flat()[1].glob, false);
  });
}

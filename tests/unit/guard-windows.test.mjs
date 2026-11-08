// Claude Security の指摘 F1・F2 の単体の試験(2026-11-08。値はすべて架空)
// F1: Windows のパスの作業フォルダ(C:\work)で、パスなしの Grep・r?w の glob が止まる(調べられないときは止める側)
// F2: 末尾に点・空白を付けた raw.\a.txt・raw. /a.txt・Get-Content raw.\a.txt が止まる
// Windows の実機は無いので、Linux の上で cwd に Windows のパスを渡し、必要なら setPlatformForTest('win32') で動く OS を替えて確かめる
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as pluginGuard from '../../plugin/scripts/guard-raw.mjs';
import * as baseGuard from '../../integration/claude-code/hooks/guard-raw.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ENV = { HOME: '/home/example' };
const WIN = 'C:\\work';
const GUARDS = [['plugin', pluginGuard], ['integration', baseGuard]];

test('F1: Windows のパスは path.win32 で解決する(Linux のパスは前と同じ)', () => {
  for (const [label, g] of GUARDS) {
    assert.equal(g.resolveAbs('raw\\a.txt', WIN), 'C:/work/raw/a.txt', label);
    assert.equal(g.resolveAbs('..\\other\\b.txt', 'C:\\work\\sub'), 'C:/work/other/b.txt', label);
    assert.equal(g.resolveAbs('D:/data/c.txt', WIN), 'D:/data/c.txt', label);
    assert.equal(g.resolveAbs('\\data\\c.txt', 'C:/work'), 'C:/data/c.txt', label);
    assert.equal(g.resolveAbs('a/b.txt', '/work/example'), '/work/example/a/b.txt', label);
    assert.equal(g.resolveAbs('../b.txt', '/work/example'), '/work/b.txt', label);
  }
});

test('F1: Windows の作業フォルダ C:\\work で、パスなしの Grep・r?w の glob は止める(調べられないので閉じる)', () => {
  for (const [label, g] of GUARDS) {
    const t = (tool_name, tool_input) => g.decideTool({ tool_name, tool_input, cwd: WIN }, ENV).block;
    assert.equal(t('Grep', { pattern: '株式会社' }), true, label + ' Grep パスなし');
    assert.equal(t('Grep', { pattern: '株式会社', path: '.' }), true, label + ' Grep .');
    assert.equal(t('Grep', { pattern: '株式会社', glob: '**/*.txt' }), true, label + ' Grep glob');
    assert.equal(t('Glob', { pattern: 'r?w/*.txt' }), true, label + ' Glob r?w');
    assert.equal(t('Glob', { pattern: '*/台帳.txt' }), true, label + ' Glob */');
    assert.equal(t('Bash', { command: 'cat r?w/台帳.txt' }), true, label + ' Bash r?w');
    assert.equal(t('PowerShell', { command: 'Get-Content .\\r*\\台帳.txt' }), true, label + ' PowerShell r*');
    assert.equal(t('Bash', { command: 'grep -r 株式会社 .' }), true, label + ' grep -r');
    // raw に当たらない形・raw を含まないパスの Read は通す
    assert.equal(t('Glob', { pattern: '*.md' }), false, label + ' Glob *.md');
    assert.equal(t('Read', { file_path: 'C:\\work\\masked\\a.txt' }), false, label + ' Read masked');
  }
});

test('F1: win32 で動くときも、調べられる作業フォルダでは raw/ の有無で決める', () => {
  const dir = path.join(ROOT, 'tmp', 'guard-windows');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(path.join(dir, 'masked'), { recursive: true });
  try {
    for (const [label, g] of GUARDS) {
      g.setPlatformForTest('win32');
      try {
        const t = (tool_name, tool_input) => g.decideTool({ tool_name, tool_input, cwd: dir }, ENV).block;
        assert.equal(t('Grep', { pattern: 'x' }), false, label + ' raw/ が無ければ通す');
        assert.equal(t('Glob', { pattern: 'r?w/*.txt' }), false, label + ' raw/ が無ければ通す');
        fs.mkdirSync(path.join(dir, 'raw'), { recursive: true });
        assert.equal(t('Grep', { pattern: 'x' }), true, label + ' raw/ があれば止める');
        assert.equal(t('Glob', { pattern: 'r?w/*.txt' }), true, label + ' raw/ があれば止める');
        assert.equal(t('Grep', { pattern: 'x', path: 'masked' }), false, label + ' masked/ は通す');
        fs.rmSync(path.join(dir, 'raw'), { recursive: true, force: true });
      } finally {
        g.setPlatformForTest();
      }
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('F1: Linux のパスの作業フォルダは前と同じ(無いフォルダでも raw/ の無い所として扱う)', () => {
  for (const [label, g] of GUARDS) {
    const t = (tool_name, tool_input) => g.decideTool({ tool_name, tool_input, cwd: '/work/example' }, ENV).block;
    assert.equal(t('Grep', { pattern: 'x', path: 'masked' }), false, label);
    assert.equal(t('Grep', { pattern: 'x' }), false, label);
    assert.equal(t('Bash', { command: 'cat masked/a.txt' }), false, label);
  }
});

test('F2: 末尾に点・空白を付けた raw の部分も raw として止める', () => {
  for (const [label, g] of GUARDS) {
    for (const cwd of [WIN, '/work/example']) {
      const t = (tool_name, tool_input) => g.decideTool({ tool_name, tool_input, cwd }, ENV).block;
      assert.equal(t('Read', { file_path: 'raw.\\a.txt' }), true, `${label} ${cwd} raw.\\a.txt`);
      assert.equal(t('Read', { file_path: 'raw. /a.txt' }), true, `${label} ${cwd} raw. /a.txt`);
      assert.equal(t('Read', { file_path: 'C:\\work\\raw.\\台帳.txt' }), true, `${label} ${cwd} 絶対パス`);
      assert.equal(t('Read', { file_path: 'RAW..\\a.txt' }), true, `${label} ${cwd} RAW..`);
      assert.equal(t('PowerShell', { command: 'Get-Content raw.\\a.txt' }), true, `${label} ${cwd} Get-Content`);
      assert.equal(t('Bash', { command: 'cat raw./a.txt' }), true, `${label} ${cwd} cat raw./`);
      assert.equal(t('Grep', { pattern: 'x', path: 'raw.' }), true, `${label} ${cwd} Grep raw.`);
      assert.equal(g.decidePrompt({ prompt: '@raw.\\a.txt', cwd }).block, true, `${label} ${cwd} @raw.`);
      // 似た名前は通す
      assert.equal(t('Read', { file_path: 'raw.txt' }), false, `${label} ${cwd} raw.txt`);
      assert.equal(t('Read', { file_path: 'docs\\rawdata-note.md' }), false, `${label} ${cwd} rawdata`);
      assert.equal(t('PowerShell', { command: 'Get-Content raw.txt' }), false, `${label} ${cwd} Get-Content raw.txt`);
    }
    assert.equal(g.globSegMatchesRaw('r?w.'), true, label);
    assert.equal(g.globSegMatchesRaw('raw.txt'), false, label);
  }
});

test('写し: 2つの guard-raw.mjs は同じバイト', () => {
  const a = fs.readFileSync(path.join(ROOT, 'plugin', 'scripts', 'guard-raw.mjs'));
  const b = fs.readFileSync(path.join(ROOT, 'integration', 'claude-code', 'hooks', 'guard-raw.mjs'));
  assert.ok(a.equals(b));
});

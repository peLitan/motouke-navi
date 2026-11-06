// F75b の単体の試験: 反証の係に check_articles を持たせたこと、MCP の返事の保存の書き方
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));

test('refuter.md: tools に check_articles が2つの名前の形であり、読む道具の2つの形も残る', () => {
  const tools = read('plugin/agents/refuter.md').match(/^tools: (.+)$/m)[1].split(',').map((s) => s.trim());
  assert.deepEqual(tools.slice().sort(), [
    'mcp__masked-files__check_articles',
    'mcp__masked-files__read_masked',
    'mcp__plugin_motouke-navi-guard_masked-files__check_articles',
    'mcp__plugin_motouke-navi-guard_masked-files__read_masked',
  ]);
});

test('refuter.md: 本文は2つの道具の文で、手順2 の原文の項に check_articles の文がある', () => {
  const text = read('plugin/agents/refuter.md');
  assert.equal(text.includes('`read_masked` だけです'), false);
  assert.ok(text.includes('`read_masked` と `check_articles` の2つです'));
  const step2 = text.slice(text.indexOf('2. 指摘を1件ずつ'), text.indexOf('3. 1件ごとに結果を返す'));
  const line = step2.split('\n').find((l) => l.includes('- 原文:'));
  assert.ok(line.includes('条番号が原文にあるかは `check_articles` で確かめる(抜き書きの一致は渡された抜き書きで見る。この道具は中身の正しさを確かめない)'));
});

test('manual: 反証の係の道具の文を直し、抜き書きを見抜けない限界の文は残す', () => {
  const text = read('docs/manual.md');
  assert.ok(text.includes('持たせた道具は `masked-files` の `read_masked` と `check_articles` だけで'));
  assert.ok(text.includes('呼び出した側が渡した抜き書きが原文と違っていても、係はそれを見抜けません'));
});

test('overview: 反証の係の文と使い分けの表の行が check_articles を含み、表の行は4列のまま', () => {
  const lines = read('docs/overview.md').split('\n');
  assert.ok(lines.some((l) => l.startsWith('3. 道具を `read_masked` と `check_articles` に絞った `refuter`')));
  const row = lines.find((l) => l.startsWith('| 反証の係'));
  assert.equal(row.split('|').length - 2, 4);
  assert.ok(row.includes('`read_masked` と `check_articles` に絞るため'));
  assert.equal(row.includes('`read_masked` だけ'), false);
});

test('manual: read_masked の項に MCP の返事の保存の2行があり、保存の場所は書かない', () => {
  const text = read('docs/manual.md');
  const start = text.indexOf('- `.mcp.json` と `mcp/masked-files.mjs`');
  const section = text.slice(start, text.indexOf('  - 注意: `list_masked`', start));
  for (const w of ['https://code.claude.com/docs/en/mcp', '50,000', '25,000', 'MAX_MCP_OUTPUT_TOKENS', '場所は公式に書いていない', '1MB', 'Claude Code の側の動き']) {
    assert.ok(section.includes(w), w);
  }
  assert.equal(text.includes('~/.claude/projects/'), false);
});

test('maxResultSizeChars を文書にもプラグインの設定にも書いていない', () => {
  for (const f of ['docs/manual.md', 'README.md', 'plugin/.mcp.json', ...walk(path.join(ROOT, 'plugin/mcp')).map((p) => path.relative(ROOT, p))]) {
    assert.equal(read(f).includes('maxResultSizeChars'), false, f);
  }
});

// F13 の単体の試験(値はすべて架空)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decideTool, decidePrompt, decide, mentionsOf } from '../../integration/claude-code/hooks/guard-raw.mjs';
import { handleMessage } from '../../integration/claude-code/mcp/masked-files.mjs';
import { createMasker } from '../../src/mask/core.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const cwd = '/work/example';

test('フック: Bash のコマンドの中の raw/ を止め、似た名前は通す', () => {
  for (const command of ['cat raw/a.txt', 'head -5 "./raw/台帳.txt"', 'type C:\\work\\raw\\a.txt', 'ls raw']) {
    assert.equal(decideTool({ tool_name: 'Bash', tool_input: { command }, cwd }).block, true, command);
  }
  for (const command of ['cat masked/a.txt', 'cat docs/rawdata-note.md', 'echo draw/a']) {
    assert.equal(decideTool({ tool_name: 'Bash', tool_input: { command }, cwd }).block, false, command);
  }
});

test('フック: Windows の区切り・Edit・Grep の glob・入力の誤り', () => {
  assert.equal(decideTool({ tool_name: 'Read', tool_input: { file_path: 'C:\\work\\example\\raw\\a.txt' }, cwd: 'C:\\work\\example' }).block, true);
  assert.equal(decideTool({ tool_name: 'Edit', tool_input: { file_path: 'raw/a.txt' }, cwd }).block, true);
  assert.equal(decideTool({ tool_name: 'Grep', tool_input: { pattern: 'x', glob: 'raw/*.txt' }, cwd }).block, true);
  assert.equal(decideTool({ tool_name: 'Grep', tool_input: { pattern: 'x', path: 'masked' }, cwd }).block, false);
  assert.equal(decideTool(null).block, true);
  assert.equal(decide({ hook_event_name: 'UserPromptSubmit', prompt: '@raw/a.txt' }).block, true);
});

test('フック: 場所を指定しない Grep は、探す場所の直下に raw/ があれば止める', () => {
  const dir = path.join(ROOT, 'tmp', 'f13-grep');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(path.join(dir, 'raw'), { recursive: true });
  assert.equal(decideTool({ tool_name: 'Grep', tool_input: { pattern: '株式会社' }, cwd: dir }).block, true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('フック: @ の取り出し(引用符つき・かっこの後)とメールの @ は対象外', () => {
  assert.deepEqual(mentionsOf('見て @"raw/名前 空白.txt" と @masked/b.txt'), ['raw/名前 空白.txt', 'masked/b.txt']);
  assert.equal(decidePrompt({ prompt: '見て @"raw/名前 空白.txt"' }).block, true);
  assert.equal(decidePrompt({ prompt: '連絡先は kono@example.com です' }).block, false);
});

test('MCP の道具: 知らない道具・知らないメソッド・通知・raw/ の外・対応表で人名も置き換える', async () => {
  const root = path.join(ROOT, 'tmp', 'f13-unit');
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(path.join(root, 'raw'), { recursive: true });
  fs.writeFileSync(path.join(root, 'raw', 'a.txt'), '現場代理人 山野 一郎(架空)。乙川工業株式会社。');
  fs.writeFileSync(path.join(root, 'raw', 'b.xlsx'), 'x');
  fs.writeFileSync(path.join(root, 'secret.txt'), '外のファイル');
  assert.equal(await handleMessage({ jsonrpc: '2.0', method: 'notifications/initialized' }, { root }), null);
  assert.equal((await handleMessage({ jsonrpc: '2.0', id: 1, method: 'resources/list' }, { root })).error.code, -32601);
  assert.ok((await handleMessage({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'other', arguments: {} } }, { root })).error);
  for (const p of ['secret.txt', 'raw/../secret.txt', path.join(root, 'secret.txt'), 'raw/b.xlsx', 'raw', '']) {
    const r = await handleMessage({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'read_masked', arguments: { path: p } } }, { root });
    assert.equal(r.result.isError, true, p);
    assert.ok(!r.result.content[0].text.includes('外のファイル'));
  }
  // 対応表なし: 人名は残る(限界)。対応表あり: 人名も置き換わる
  const m = createMasker();
  m.addTerm('山野 一郎', 'person');
  m.mask('山野 一郎');
  const mapPath = path.join(root, 'map.json');
  fs.writeFileSync(mapPath, m.exportMap());
  const call = (mp) => handleMessage({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'read_masked', arguments: { path: 'raw/a.txt' } } }, { root, mapPath: mp });
  const without = (await call(null)).result.content[0].text;
  assert.ok(!without.includes('乙川工業株式会社'));
  const withMap = (await call(mapPath)).result.content[0].text;
  assert.ok(!withMap.includes('山野') && !withMap.includes('乙川工業株式会社'), withMap);
  assert.ok(withMap.includes('現場代理人'));
  // 壊れた対応表は元の語を出さずに断る
  fs.writeFileSync(mapPath, '{"format":"mask-map","entries":[{"original":"山野 一郎"}]}');
  const bad = (await call(mapPath)).result;
  assert.equal(bad.isError, true);
  assert.ok(!bad.content[0].text.includes('山野'));
  fs.rmSync(root, { recursive: true, force: true });
});

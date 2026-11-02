// F13: Claude Code に組み込む(置き換えた後の中身だけを返す MCP の道具、raw/ を読ませない設定)(条件 F13-1〜F13-3)
// 置き場: integration/claude-code/(利用者が自分の作業フォルダに写して使う)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { load, readJson, readText, exists, p, GUARANTEE_RE } from './_helpers.mjs';

const DIR = 'integration/claude-code';

test('設定: permissions.deny で raw/ の Read を止め、PreToolUse と UserPromptSubmit のフックがある', () => {
  const s = readJson(`${DIR}/.claude/settings.json`);
  const deny = s.permissions?.deny || [];
  assert.ok(deny.some((r) => /^Read\(.*raw\//.test(r)), 'raw/ の Read の deny が無い');
  const pre = s.hooks?.PreToolUse || [];
  assert.ok(pre.length > 0 && JSON.stringify(pre).includes('guard-raw'), 'PreToolUse のフックが無い');
  assert.ok(JSON.stringify(s.hooks?.UserPromptSubmit || []).includes('guard-raw'), 'UserPromptSubmit のフックが無い');
  const mcp = readJson(`${DIR}/.mcp.json`);
  assert.ok(JSON.stringify(mcp).includes('masked-files'), 'MCP の道具の登録が無い');
  assert.ok(exists(`${DIR}/hooks/guard-raw.mjs`) && exists(`${DIR}/mcp/masked-files.mjs`));
});

test('フック: raw/ の Read・Grep・Glob を止め、それ以外は通す', async () => {
  const { decideTool } = await load(`${DIR}/hooks/guard-raw.mjs`);
  const cwd = '/work/example';
  for (const ti of [{ tool_name: 'Read', tool_input: { file_path: 'raw/台帳.xlsx' } }, { tool_name: 'Read', tool_input: { file_path: '/work/example/raw/a.txt' } }, { tool_name: 'Read', tool_input: { file_path: 'masked/../raw/a.txt' } }, { tool_name: 'Grep', tool_input: { pattern: '株式会社', path: 'raw' } }, { tool_name: 'Glob', tool_input: { pattern: 'raw/**/*' } }]) {
    assert.equal(decideTool({ ...ti, cwd }).block, true, '止まらない: ' + JSON.stringify(ti));
  }
  for (const ti of [{ tool_name: 'Read', tool_input: { file_path: 'masked/台帳.txt' } }, { tool_name: 'Read', tool_input: { file_path: 'docs/rawdata-note.md' } }]) {
    assert.equal(decideTool({ ...ti, cwd }).block, false, '止めすぎ: ' + JSON.stringify(ti));
  }
});

test('フック: @ で raw/ のファイルを入れようとすると止まる', async () => {
  const { decidePrompt } = await load(`${DIR}/hooks/guard-raw.mjs`);
  assert.equal(decidePrompt({ prompt: '@raw/台帳.txt を点検して' }).block, true);
  assert.equal(decidePrompt({ prompt: 'これを見て @./raw/a.docx' }).block, true);
  assert.equal(decidePrompt({ prompt: '@masked/台帳.txt を点検して' }).block, false);
});

test('MCP の道具: 一覧に出て、raw/ のファイルを置き換えた後の中身だけを返す。外へは出られない', async () => {
  const { handleMessage } = await load(`${DIR}/mcp/masked-files.mjs`);
  const root = p('tmp', 'f13-test');
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(path.join(root, 'raw'), { recursive: true });
  const original = '架空の台帳。甲山建設株式会社、連絡は kono@example.com、電話 03-0000-0000。';
  fs.writeFileSync(path.join(root, 'raw', 'a.txt'), original);
  const init = await handleMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } } }, { root });
  assert.equal(init.id, 1); assert.ok(init.result?.serverInfo);
  const list = await handleMessage({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, { root });
  const names = list.result.tools.map((t) => t.name);
  assert.ok(names.includes('read_masked'));
  const call = await handleMessage({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'read_masked', arguments: { path: 'raw/a.txt' } } }, { root });
  const text = call.result.content.map((c) => c.text).join('\n');
  for (const w of ['甲山建設株式会社', 'kono@example.com', '03-0000-0000']) assert.ok(!text.includes(w), '元の語が返った: ' + w);
  assert.ok(text.includes('架空の台帳'));
  const out = await handleMessage({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'read_masked', arguments: { path: '../../package.json' } } }, { root });
  assert.ok(out.error || out.result?.isError, 'raw/ の外を読めた');
  fs.rmSync(root, { recursive: true, force: true });
});

test('README に、cat などのコマンドの読み取りは WSL の sandbox では止まり Windows では止まらないことを書き、「保証」と書かない', () => {
  const md = readText('README.md');
  assert.ok(/cat/.test(md) && /sandbox/i.test(md) && /WSL/.test(md) && /Windows/.test(md));
  assert.ok(!GUARANTEE_RE.test(md));
});

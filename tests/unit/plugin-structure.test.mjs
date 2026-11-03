// F20a の単体の試験: plugin/ の骨組み(値はすべて架空)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PLUGIN_COPIES, staleCopies } from '../../scripts/sync-plugin.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PLUGIN = path.join(ROOT, 'plugin');
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(PLUGIN, rel), 'utf8'));

// プラグインの係(agents)で無視される項目(公式のページの記述。README の「プラグインで配る」)
export const IGNORED_AGENT_FIELDS = ['permissionMode', 'hooks', 'mcpServers', 'initialPrompt'];

// ${CLAUDE_PLUGIN_ROOT} をプラグインのフォルダに置き換える(Claude Code が起動するときと同じ形にする)
const expand = (s, root) => String(s).replaceAll('${CLAUDE_PLUGIN_ROOT}', root);

test('plugin.json: .claude-plugin/ にあり、JSON が読め、name が kebab-case。.claude-plugin/ には plugin.json だけ', () => {
  const m = readJson('.claude-plugin/plugin.json');
  assert.match(m.name, /^[a-z0-9]+(-[a-z0-9]+)*$/);
  assert.deepEqual(fs.readdirSync(path.join(PLUGIN, '.claude-plugin')), ['plugin.json']);
  // 部品は plugin/ の直下に置く
  for (const d of ['hooks', 'scripts', 'mcp']) assert.ok(fs.statSync(path.join(PLUGIN, d)).isDirectory(), d);
});

test('hooks.json: 一番上が hooks。PreToolUse に raw/ を読める道具がそろい、UserPromptSubmit は matcher なし。どちらも ${CLAUDE_PLUGIN_ROOT} の guard-raw.mjs を動かす', () => {
  const h = readJson('hooks/hooks.json');
  assert.deepEqual(Object.keys(h), ['hooks']);
  const pre = h.hooks.PreToolUse;
  assert.equal(pre.length, 1);
  const tools = pre[0].matcher.split('|');
  for (const t of ['Read', 'Grep', 'Glob', 'Bash', 'PowerShell', 'Edit', 'Write', 'NotebookEdit']) assert.ok(tools.includes(t), t);
  const ups = h.hooks.UserPromptSubmit;
  assert.equal(ups.length, 1);
  assert.equal(ups[0].matcher, undefined);
  for (const entry of [...pre, ...ups]) {
    for (const hook of entry.hooks) {
      assert.equal(hook.type, 'command');
      assert.match(hook.command, /\$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/guard-raw\.mjs/);
      assert.ok(!hook.command.includes('CLAUDE_PROJECT_DIR'), 'プラグインのフックはプロジェクトのフォルダに頼らない');
    }
  }
  assert.ok(fs.existsSync(path.join(PLUGIN, 'scripts', 'guard-raw.mjs')));
});

test('hooks.json のコマンドが指すフック(プラグインの中の写し): raw/ の Read・Bash・@ は止め、ほかは通す。入力が読めないときも止める', async () => {
  // init の試験は子のプロセスを起こせないので、コマンドが指すファイルを読み込んで判断の関数を確かめる
  const h = readJson('hooks/hooks.json');
  const commands = [h.hooks.PreToolUse[0].hooks[0].command, h.hooks.UserPromptSubmit[0].hooks[0].command];
  const files = commands.map((c) => /^node "(.+)"$/.exec(expand(c, PLUGIN))?.[1]);
  assert.deepEqual(files, [path.join(PLUGIN, 'scripts', 'guard-raw.mjs'), path.join(PLUGIN, 'scripts', 'guard-raw.mjs')]);
  const src = fs.readFileSync(files[0], 'utf8');
  assert.match(src, /process\.exit\(2\)/);
  assert.match(src, /process\.stderr\.write\(r\.reason/);
  const { decide } = await import(pathToFileURL(files[0]).href);
  const cwd = '/work/example';
  assert.equal(decide({ hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: 'raw/台帳.txt' }, cwd }).block, true);
  assert.match(decide({ hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: 'raw/台帳.txt' }, cwd }).reason, /raw\//);
  assert.equal(decide({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'cat ./raw/a.txt' }, cwd }).block, true);
  assert.equal(decide({ hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: 'masked/台帳.txt' }, cwd }).block, false);
  assert.equal(decide({ hook_event_name: 'UserPromptSubmit', prompt: '@raw/a.txt を見て', cwd }).block, true);
  assert.equal(decide({ hook_event_name: 'UserPromptSubmit', prompt: '@masked/a.txt を見て', cwd }).block, false);
  assert.equal(decide(null).block, true);
});

test('.mcp.json: プラグインの直下にあり、masked-files を ${CLAUDE_PLUGIN_ROOT} の写しで起動する。${CLAUDE_PROJECT_DIR} に頼らない', () => {
  const m = readJson('.mcp.json');
  const s = m.mcpServers['masked-files'];
  assert.equal(s.command, 'node');
  assert.deepEqual(s.args, ['${CLAUDE_PLUGIN_ROOT}/mcp/masked-files.mjs']);
  assert.equal(s.env.MASK_TOOL_DIR, '${CLAUDE_PLUGIN_ROOT}');
  assert.ok(!JSON.stringify(m).includes('CLAUDE_PROJECT_DIR'));
  assert.ok(fs.existsSync(path.join(PLUGIN, 'mcp', 'masked-files.mjs')));
  assert.ok(fs.existsSync(path.join(PLUGIN, 'src', 'mask', 'core.mjs')));
});

test('写し: plugin/ の中のフック・道具・置き換えの部品は元(integration/claude-code/・src/mask/)と同じ', () => {
  assert.ok(PLUGIN_COPIES.length >= 7);
  assert.deepEqual(staleCopies(ROOT), [], 'node scripts/sync-plugin.mjs で作り直す');
  // 置き換えの部品が読む別のファイルも写してある
  for (const f of fs.readdirSync(path.join(PLUGIN, 'src', 'mask'))) {
    const text = fs.readFileSync(path.join(PLUGIN, 'src', 'mask', f), 'utf8');
    for (const m of text.matchAll(/from '\.\/([^']+)'/g)) assert.ok(fs.existsSync(path.join(PLUGIN, 'src', 'mask', m[1])), `${f} が読む ${m[1]}`);
  }
});

test('道具: plugin/ だけを別の場所に写しても(入れたときと同じ)、作業フォルダの raw/ を置き換えた後の中身だけを返す', async () => {
  const tmp = path.join(ROOT, 'tmp', 'f20a-plugin');
  fs.rmSync(tmp, { recursive: true, force: true });
  const installed = path.join(tmp, 'cache', 'motouke-navi-guard');
  fs.cpSync(PLUGIN, installed, { recursive: true });
  const work = path.join(tmp, 'work');
  fs.mkdirSync(path.join(work, 'raw'), { recursive: true });
  fs.writeFileSync(path.join(work, 'raw', 'a.txt'), '元請 乙川工業株式会社(架空)。連絡先 kono@example.com 電話 03-0000-0000。');
  const s = JSON.parse(fs.readFileSync(path.join(installed, '.mcp.json'), 'utf8')).mcpServers['masked-files'];
  // .mcp.json の env と args を、Claude Code が起動するときと同じく ${CLAUDE_PLUGIN_ROOT} を写した先にして読み込む
  const saved = process.env.MASK_TOOL_DIR;
  process.env.MASK_TOOL_DIR = expand(s.env.MASK_TOOL_DIR, installed);
  try {
    const entry = expand(s.args[0], installed);
    assert.ok(entry.startsWith(installed));
    const { handleMessage } = await import(pathToFileURL(entry).href + '?f20a');
    const init = await handleMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }, { root: work });
    assert.equal(init.result.serverInfo.name, 'masked-files');
    const r = await handleMessage({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'read_masked', arguments: { path: 'raw/a.txt' } } }, { root: work, mapPath: '' });
    assert.equal(r.result.isError, false);
    const text = r.result.content[0].text;
    for (const original of ['乙川工業株式会社', 'kono@example.com', '03-0000-0000']) assert.ok(!text.includes(original), original);
    assert.match(text, /〔[^〕]+〕/);
    const out = await handleMessage({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'read_masked', arguments: { path: '../outside.txt' } } }, { root: work, mapPath: '' });
    assert.equal(out.result.isError, true);
  } finally {
    if (saved === undefined) delete process.env.MASK_TOOL_DIR; else process.env.MASK_TOOL_DIR = saved;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('係(agents): 置いた係のファイルに、プラグインでは無視される項目を書かない', () => {
  const dir = path.join(PLUGIN, 'agents');
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.md')) : [];
  for (const f of files) {
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    const fm = /^---\n([\s\S]*?)\n---/.exec(text);
    assert.ok(fm, `${f} に frontmatter が無い`);
    for (const key of IGNORED_AGENT_FIELDS) assert.ok(!new RegExp(`^${key}\\s*:`, 'm').test(fm[1]), `${f} に ${key}`);
  }
});

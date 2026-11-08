// F23a の単体の試験: MCP の道具 list_masked(raw/ の中のファイルの名前だけを返す)。値はすべて架空
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleMessage, listRawFiles, TOOLS } from '../../integration/claude-code/mcp/masked-files.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TMP = path.join(ROOT, 'tmp');
fs.mkdirSync(TMP, { recursive: true });
const SECRET = '乙川工業株式会社 kono@example.com 03-0000-0000';

function makeWork() {
  const work = fs.mkdtempSync(path.join(TMP, 'list-masked-'));
  fs.mkdirSync(path.join(work, 'raw', '工事A'), { recursive: true });
  fs.writeFileSync(path.join(work, 'raw', '台帳.txt'), SECRET);
  fs.writeFileSync(path.join(work, 'raw', '工事A', '通知書.csv'), SECRET);
  fs.writeFileSync(path.join(work, 'raw', '工事A', '図面.pdf'), 'xxxx');
  // raw/ の外のファイル(返してはいけない)
  fs.writeFileSync(path.join(work, 'outside.txt'), SECRET);
  fs.mkdirSync(path.join(work, 'masked'));
  fs.writeFileSync(path.join(work, 'masked', 'b.txt'), SECRET);
  return work;
}
const call = (root, args = {}) => handleMessage({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'list_masked', arguments: args } }, { root, mapPath: '' });

test('tools/list に list_masked があり、入力は dir だけ(任意)', async () => {
  const work = makeWork();
  try {
    const r = await handleMessage({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, { root: work });
    const t = r.result.tools.find((x) => x.name === 'list_masked');
    assert.ok(t);
    assert.deepEqual(Object.keys(t.inputSchema.properties), ['dir']);
    assert.equal(t.inputSchema.required, undefined);
    assert.ok(TOOLS.some((x) => x.name === 'read_masked'));
    const init = await handleMessage({ jsonrpc: '2.0', id: 2, method: 'initialize', params: {} }, { root: work });
    assert.match(init.result.instructions, /list_masked/);
  } finally { fs.rmSync(work, { recursive: true, force: true }); }
});

test('名前だけを返し、中身は返さない。読めない形は分けて挙げる', async () => {
  const work = makeWork();
  try {
    const r = await call(work);
    assert.equal(r.result.isError, false);
    const text = r.result.content[0].text;
    for (const name of ['raw/台帳.txt', 'raw/工事A/通知書.csv', 'raw/工事A/図面.pdf']) assert.ok(text.includes(name), name);
    for (const s of SECRET.split(' ')) assert.ok(!text.includes(s), '中身が出た: ' + s);
    assert.ok(!text.includes('xxxx'));
    // 図面.pdf は読めない形の側に出る
    assert.ok(text.indexOf('raw/工事A/図面.pdf') > text.indexOf('読めない形'));
    assert.ok(text.indexOf('raw/台帳.txt') < text.indexOf('読めない形'));
    // 関数も、名前と読めるかだけを持つ
    const { files } = listRawFiles(work);
    for (const f of files) assert.deepEqual(Object.keys(f).sort(), ['path', 'readable']);
    // 返った名前は read_masked にそのまま渡せる
    const rd = await handleMessage({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'read_masked', arguments: { path: files.find((f) => f.readable).path } } }, { root: work, mapPath: '' });
    assert.equal(rd.result.isError, false);
  } finally { fs.rmSync(work, { recursive: true, force: true }); }
});

test('raw/ の外は返さない: 外のファイルの名前を出さず、外のフォルダの指定は断る', async () => {
  const work = makeWork();
  try {
    const text = (await call(work)).result.content[0].text;
    assert.ok(!text.includes('outside.txt'));
    assert.ok(!text.includes('masked/b.txt'));
    for (const dir of ['.', '..', 'masked', 'raw/../masked', '/etc', 'raw/../../']) {
      const r = await call(work, { dir });
      assert.equal(r.result.isError, true, dir);
      assert.ok(!r.result.content[0].text.includes('b.txt'), dir);
    }
    // raw/ の中のフォルダは絞れる
    const sub = (await call(work, { dir: 'raw/工事A' })).result.content[0].text;
    assert.ok(sub.includes('raw/工事A/通知書.csv'));
    assert.ok(!sub.includes('raw/台帳.txt'));
  } finally { fs.rmSync(work, { recursive: true, force: true }); }
});

test('raw/ の中のシンボリックリンクで外へ出るものは挙げない。raw/ が無いときは断る', async () => {
  const work = makeWork();
  try {
    let linked = true;
    try {
      fs.symlinkSync(path.join(work, 'outside.txt'), path.join(work, 'raw', '外へのリンク.txt'));
      fs.symlinkSync(path.join(work, 'masked'), path.join(work, 'raw', '外のフォルダ'));
      fs.symlinkSync(path.join(work, 'raw', '台帳.txt'), path.join(work, 'raw', '中へのリンク.txt'));
    } catch { linked = false; }
    if (linked) {
      const text = (await call(work)).result.content[0].text;
      assert.ok(!text.includes('外へのリンク'));
      assert.ok(!text.includes('外のフォルダ'));
      assert.ok(!text.includes('b.txt'));
      assert.ok(text.includes('raw/中へのリンク.txt'));
      const r = await call(work, { dir: 'raw/外のフォルダ' });
      assert.equal(r.result.isError, true);
    }
    const empty = fs.mkdtempSync(path.join(TMP, 'list-masked-none-'));
    try {
      const r = await call(empty);
      assert.equal(r.result.isError, true);
      assert.match(r.result.content[0].text, /raw\/ がありません/);
    } finally { fs.rmSync(empty, { recursive: true, force: true }); }
  } finally { fs.rmSync(work, { recursive: true, force: true }); }
});

test('SKILL.md に「書類の名前が分からないときは list_masked」、README に名前に個人情報が入りうること', () => {
  const skill = fs.readFileSync(path.join(ROOT, 'plugin', 'skills', 'construction-check', 'SKILL.md'), 'utf8');
  assert.match(skill, /名前が分からない[^\n]*list_masked/);
  const readme = fs.readFileSync(path.join(ROOT, 'docs', 'details.md'), 'utf8');
  assert.match(readme, /list_masked/);
  assert.match(readme, /list_masked[^\n]*(ファイルの名前|ファイル名)[^\n]*(人名|会社名|個人情報)/);
});

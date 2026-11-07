// F83b3 の単体の試験: MCP の read_masked と check_conditions の名前の決まり(代替データストリーム・デバイス名・作業フォルダの .git と .claude・MASK_MAP と MASK_DICT の解き方)
// ファイルの中身は作り物の印 CANARY-* だけ。Linux では : やデバイス名のファイルを実際に置き、読めてしまう形を字の決まりで断ることを見る(Windows の本物の動きは統括の sec-win.mjs)
// init は node の権限の決まりの中で試験を動かし、記号リンクを作れないので、リンクの形は飛ばす(このファイルを node --test で直接動かして確かめる)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleMessage } from '../../integration/claude-code/mcp/masked-files.mjs';
import { createMasker } from '../../src/mask/core.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MARK = 'CANARY-NAME-RULES';
const OK_MARK = 'CANARY-OK-KOUKOKU';
const line = (mark) => `工事名: ${mark}\n`;
const COLON = /名前に : のあるパスは読めません/;
const DEVICE = /Windows のデバイス名/;
const HIDDEN = /secrets\/・\.claude\/・\.git\/ の下/;
const MASK_FILE = /MASK_MAP・MASK_DICT のファイルは読めません/;

function work(t) {
  fs.mkdirSync(path.join(ROOT, 'tmp'), { recursive: true });
  const dir = fs.mkdtempSync(path.join(ROOT, 'tmp', 'f83b3-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function put(dir, rel, text = line(MARK)) {
  const file = path.join(dir, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return file;
}

// リンクを作れないときだけ飛ばす(mcp-open-then-check.test.mjs の allowed と同じ)
function allowed(t, make) {
  try {
    make();
    return true;
  } catch (e) {
    if (e.code !== 'ERR_ACCESS_DENIED' && e.code !== 'EPERM') throw e;
    t.skip('リンクを作る権限が無い環境(init の試験など)');
    return false;
  }
}

const POSIX_NAMES = { skip: process.platform === 'win32' && 'Windows では : やデバイス名のファイルを置けない(統括の sec-win.mjs で見る)' };

const conditions = (root, file) => handleMessage({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'check_conditions', arguments: { data: '{"conditions":[]}', files: [file] } } }, { root });
const masked = (root, file, opts = { mapPath: '', dictPath: '' }) => handleMessage({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'read_masked', arguments: { path: file } } }, { root, ...opts });

// 断りの形: 印が返事のどこにも無く、道具の誤りの文が1つ。印を先に見るので、読めてしまったときは漏れとして落ちる
const refused = (r, name = '') => {
  const all = JSON.stringify(r);
  assert.ok(!all.includes(MARK), `${name} 印が返事に出た: ${all.slice(0, 240)}`);
  assert.equal(r.result.isError, true, name);
  assert.equal(r.result.content.length, 1, name);
  return r.result.content[0].text;
};

test('前提: 断らなければ返事に印が出る(「印が無い」の確かめが空振りでない)', async (t) => {
  const dir = work(t);
  put(dir, '公告/本文.txt');
  const r = await conditions(dir, '公告/本文.txt');
  assert.equal(r.result.isError, false);
  assert.ok(r.result.content[0].text.includes(MARK));
});

test('作業フォルダの中の公告を絶対パスで渡すと今どおり読める。作業フォルダのパスの : は見ない(Windows のドライブの C: と同じ形)', async (t) => {
  const dir = work(t);
  for (const base of [dir, path.join(dir, 'C:', 'work')]) {
    const file = put(base, '公告/本文.txt', line(OK_MARK));
    assert.equal(path.isAbsolute(file), true);
    assert.equal((await conditions(base, file)).result.isError, false, base);
    assert.equal((await conditions(base, '公告/本文.txt')).result.isError, false, base);
    const raw = put(base, 'raw/台帳.txt', line(OK_MARK));
    const r = await masked(base, raw);
    assert.equal(r.result.isError, false, base);
    assert.ok(r.result.content[0].text.includes(OK_MARK), base);
  }
});

test('check_conditions: 作業フォルダからのパスに : があれば断る', POSIX_NAMES, async (t) => {
  const dir = work(t);
  for (const name of ['raw:s.txt', 'RAW:s.txt', 'secrets:s.txt', 'key.pem:s.txt', '公告.txt:s.txt', '公告/a.txt:s.txt', 'sub:x/a.txt']) {
    put(dir, name);
    assert.match(refused(await conditions(dir, name), name), COLON, name);
    assert.match(refused(await conditions(dir, path.join(dir, name)), name + ' 絶対パス'), COLON, name);
  }
});

test('read_masked: raw/ の中のパスに : があれば断る。raw:s.txt は raw/ の外なので今どおり断る', POSIX_NAMES, async (t) => {
  const dir = work(t);
  put(dir, 'raw/台帳.txt');
  for (const name of ['raw/台帳.txt:s.txt', 'raw/台帳.txt::$DATA.txt', 'raw/sub:x/a.txt']) {
    put(dir, name);
    assert.match(refused(await masked(dir, name), name), COLON, name);
  }
  put(dir, 'raw:s.txt');
  assert.match(refused(await masked(dir, 'raw:s.txt'), 'raw:s.txt'), /raw\/ の中のファイルだけ/);
});

test('実体のパスの : も見る: : の無い名前のリンクの先が : のあるファイルなら断る', POSIX_NAMES, async (t) => {
  const dir = work(t);
  put(dir, '公告:s.txt');
  put(dir, 'raw/台帳:s.txt');
  if (!allowed(t, () => fs.symlinkSync(path.join(dir, '公告:s.txt'), path.join(dir, 'リンク.txt')))) return;
  assert.match(refused(await conditions(dir, 'リンク.txt')), COLON);
  fs.symlinkSync('台帳:s.txt', path.join(dir, 'raw', 'リンク.txt'));
  assert.match(refused(await masked(dir, 'raw/リンク.txt')), COLON);
});

test('デバイス名: パスのどの部分でも、拡張子を除いた名前で、大文字小文字・末尾の点と空白を問わず断る', POSIX_NAMES, async (t) => {
  const dir = work(t);
  const names = ['CON.txt', 'nul.TXT', 'com1.txt.', 'sub/aux.md', 'Prn.csv', 'LPT9.json', 'COM9.tsv', 'con', 'CON.', 'aux ', 'con .txt', 'nul.tar.txt', 'aux/公告.txt', 'sub/LPT1/公告.txt', 'com1.txt. '];
  for (const name of names) {
    put(dir, name);
    assert.match(refused(await conditions(dir, name), name), DEVICE, name);
    put(dir, 'raw/' + name);
    assert.match(refused(await masked(dir, 'raw/' + name), 'raw/' + name), DEVICE, name);
  }
});

test('デバイス名: 開く前に字で断る(無いファイルでも「ファイルがありません」にならない)', async (t) => {
  const dir = work(t);
  assert.match(refused(await conditions(dir, '無い/CON.txt')), DEVICE);
  assert.match(refused(await masked(dir, 'raw/無い/nul.md')), DEVICE);
});

test('デバイス名: 似た名前は読む', async (t) => {
  const dir = work(t);
  for (const name of ['console.txt', 'nullable.md', 'com10.txt', 'lpt0.txt', 'com.txt', 'auxiliary.csv', 'prn1.txt', 'a.con.txt', 'mycon.txt', 'com1x/公告.txt']) {
    put(dir, name, line(OK_MARK));
    assert.equal((await conditions(dir, name)).result.isError, false, name);
    put(dir, 'raw/' + name, line(OK_MARK));
    assert.equal((await masked(dir, 'raw/' + name)).result.isError, false, 'raw/' + name);
  }
});

test('実体のパスのデバイス名も見る: 普通の名前のリンクの先が CON.txt なら断る', POSIX_NAMES, async (t) => {
  const dir = work(t);
  put(dir, 'CON.txt');
  if (!allowed(t, () => fs.symlinkSync(path.join(dir, 'CON.txt'), path.join(dir, 'リンク.txt')))) return;
  assert.match(refused(await conditions(dir, 'リンク.txt')), DEVICE);
});

test('作業フォルダ: 実体のパスのどの階層に .git があっても断り、.claude は .claude/worktrees/<名前> の下だけ許す', async (t) => {
  const dir = work(t);
  const notice = (rel) => {
    const base = path.join(dir, rel);
    put(base, '公告/本文.txt');
    return conditions(base, '公告/本文.txt');
  };
  for (const rel of ['.git/sub', '.git/sub/deep', 'x/.git/sub', '.GIT/sub', '.claude/sub', '.claude/sub/deep', '.CLAUDE/sub', '.claude/worktree/wt', '.claude/worktrees', '.claude/worktrees/wt/.claude/sub', '.claude/worktrees/wt/.git/sub', '.git/.claude/worktrees/wt']) {
    assert.match(refused(await notice(rel), rel), HIDDEN, rel);
  }
  for (const rel of ['.claude/worktrees/wt', '.claude/worktrees/wt/sub', '.CLAUDE/Worktrees/wt', '.claude/worktrees/wt/.claude/worktrees/w2', '.github/sub', 'x.git/sub', '.claude-x/sub', '.隠し/作業']) {
    assert.equal((await notice(rel)).result.isError, false, rel);
  }
});

test('作業フォルダ: 見るのは実体のパス。リンクで .git の下を指す作業フォルダは断る', async (t) => {
  const dir = work(t);
  put(dir, '.git/sub/公告/本文.txt');
  const link = path.join(dir, '作業');
  if (!allowed(t, () => fs.symlinkSync(path.join(dir, '.git', 'sub'), link))) return;
  assert.match(refused(await conditions(link, '公告/本文.txt')), HIDDEN);
});

test('read_masked は作業フォルダの .git と .claude を見ない(返すのは置き換えた後の中身で、今の動きのまま)', async (t) => {
  const dir = work(t);
  const base = path.join(dir, '.claude', 'sub');
  put(base, 'raw/台帳.txt', line(OK_MARK));
  assert.equal((await masked(base, 'raw/台帳.txt')).result.isError, false);
});

// 環境変数を入れて試し、戻す。道具は呼ばれるたびに読む
function withEnv(t, values) {
  const saved = Object.fromEntries(Object.keys(values).map((k) => [k, process.env[k]]));
  t.after(() => {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  });
  for (const [k, v] of Object.entries(values)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
}

const TERM = '山野 一郎';

test('MASK_MAP: 相対パスを作業フォルダから解き、起動の場所が違っても対応表を check_conditions で断り、read_masked は同じファイルを使う', async (t) => {
  const dir = work(t);
  assert.notEqual(path.resolve(process.cwd()), path.resolve(dir));
  const m = createMasker();
  m.addTerm(TERM, 'person');
  m.mask(TERM);
  put(dir, 'sub/対応表.json', m.exportMap());
  put(dir, 'raw/台帳.txt', `責任者: ${TERM}\n`);
  put(dir, '公告/本文.txt', line(OK_MARK));
  withEnv(t, { MASK_MAP: 'sub/対応表.json', MASK_DICT: undefined });
  assert.match(refused(await conditions(dir, 'sub/対応表.json')), MASK_FILE);
  const r = await masked(dir, 'raw/台帳.txt', {});
  assert.equal(r.result.isError, false, JSON.stringify(r.result));
  assert.ok(!r.result.content[0].text.includes(TERM), r.result.content[0].text);
});

test('MASK_DICT: 相対パスを作業フォルダから解き、起動の場所が違っても辞書を check_conditions で断り、read_masked は同じファイルを使う', async (t) => {
  const dir = work(t);
  const m = createMasker();
  m.addTerm(TERM, 'person');
  put(dir, '辞書.json', m.exportDict());
  put(dir, 'raw/台帳.txt', `責任者: ${TERM}\n`);
  withEnv(t, { MASK_MAP: undefined, MASK_DICT: '辞書.json' });
  assert.match(refused(await conditions(dir, '辞書.json')), MASK_FILE);
  const r = await masked(dir, 'raw/台帳.txt', {});
  assert.equal(r.result.isError, false, JSON.stringify(r.result));
  assert.ok(!r.result.content[0].text.includes(TERM), r.result.content[0].text);
});

test('MASK_MAP: 起動の場所からだけ解けるファイルは読まない(読むファイルと断るファイルを分けない)', async (t) => {
  const dir = work(t);
  const m = createMasker();
  m.addTerm(TERM, 'person');
  m.mask(TERM);
  put(dir, 'raw/台帳.txt', `責任者: ${TERM}\n`);
  // 起動の場所(リポジトリの直下)からのパスとしては在る対応表
  const file = put(dir, '対応表.json', m.exportMap());
  const fromCwd = path.relative(process.cwd(), file);
  withEnv(t, { MASK_MAP: fromCwd, MASK_DICT: undefined });
  const r = await masked(dir, 'raw/台帳.txt', {});
  assert.match(refused(r), /MASK_MAP の対応表を読めませんでした/);
});

test('MASK_MAP・MASK_DICT: 絶対パスと空は今どおり', async (t) => {
  const dir = work(t);
  const m = createMasker();
  m.addTerm(TERM, 'person');
  m.mask(TERM);
  const file = put(dir, '対応表.json', m.exportMap());
  put(dir, 'raw/台帳.txt', `責任者: ${TERM}\n`);
  withEnv(t, { MASK_MAP: file, MASK_DICT: undefined });
  assert.match(refused(await conditions(dir, '対応表.json')), MASK_FILE);
  assert.ok(!(await masked(dir, 'raw/台帳.txt', {})).result.content[0].text.includes(TERM));
  withEnv(t, { MASK_MAP: '', MASK_DICT: '' });
  assert.equal((await conditions(dir, '対応表.json')).result.isError, false);
  assert.equal((await masked(dir, 'raw/台帳.txt', {})).result.isError, false);
});

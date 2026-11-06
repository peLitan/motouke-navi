// F83b6 の単体の試験: 断る物の実体の (dev, ino) の集合と、Linux の /proc/self/fd の確かめ。ファイルの中身は作り物の印 CANARY-* だけ
// init は node の権限の決まりの中で試験を動かし、記号リンクを作れず /proc も読めないので、リンクの形は飛ばす(このファイルを node --test で直接動かして確かめる)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as tool from '../../integration/claude-code/mcp/masked-files.mjs';
import { staleCopies } from '../../scripts/sync-plugin.mjs';

const { handleMessage, __testHooks } = tool;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const RAW_MARK = 'CANARY-RAW-DAICHO';
const KEY_MARK = 'CANARY-SECRET-KEY';
const STORE_MARK = 'CANARY-STORE-SHORUI';
const GIT_MARK = 'CANARY-GIT-OBJECT';
const OK_MARK = 'CANARY-OK-KOUKOKU';
const DENIED = '読まない所のファイルは読めません(raw/・secrets/・.git/・.claude/ の下、名前が raw・secrets のリンクの先、MASK_MAP・MASK_DICT): ';
const TOO_MANY = 'raw/ などが大きすぎて確かめられません(50,000件まで)。終わった工事の書類を作業フォルダの外へ移してください';
const TOO_DEEP = 'raw/ などの階層が深すぎて確かめられません(8段まで)。終わった工事の書類を作業フォルダの外へ移してください';
const line = (mark) => `工事名: ${mark}\n`;

function put(dir, rel, text) {
  const file = path.join(dir, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return file;
}

function work(t) {
  fs.mkdirSync(path.join(ROOT, 'tmp'), { recursive: true });
  const dir = fs.mkdtempSync(path.join(ROOT, 'tmp', 'f83b6-'));
  t.after(() => {
    __testHooks.afterOpen = null;
    __testHooks.afterResolve = null;
    fs.rmSync(dir, { recursive: true, force: true });
  });
  put(dir, 'raw/台帳.txt', line(RAW_MARK));
  put(dir, 'secrets/鍵.txt', line(KEY_MARK));
  put(dir, '公告/本文.txt', line(OK_MARK));
  return dir;
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

// Windows では開いているファイルの途中のフォルダを付け替えられないので、この手順の差し替えは起きない(統括の sec-win.mjs で見る)
const SWAPS_OPEN_FILE = { skip: process.platform === 'win32' && '開いているファイルの途中のフォルダを付け替えられない' };

const conditions = (root, ...files) => handleMessage({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'check_conditions', arguments: { data: '{"conditions":[]}', files } } }, { root });
const masked = (root, file) => handleMessage({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'read_masked', arguments: { path: file } } }, { root, mapPath: '', dictPath: '' });
const statOf = (file) => fs.statSync(file, { bigint: true });
const inSet = (set, file) => set.has(tool.inodeKey(statOf(file)));

const refused = (r, name = '') => {
  const all = JSON.stringify(r);
  for (const m of [RAW_MARK, KEY_MARK, STORE_MARK, GIT_MARK]) assert.ok(!all.includes(m), `${name} 印が返事に出た: ${all.slice(0, 240)}`);
  assert.equal(r.result.isError, true, name);
  assert.equal(r.result.content.length, 1, name);
  return r.result.content[0].text;
};

// Windows・mac の形: fd からパスを取る口が無く、集合だけで見る
const withoutFdPath = (t) => t.mock.method(fs, 'readlinkSync', () => { throw Object.assign(new Error('無い'), { code: 'ENOENT' }); });

// 差し替え2回の途中のフォルダ: name を goal へのリンクにして開き、開いた直後に普通のフォルダへ替える(実体のパスの確かめが通る)。確かめの直後にリンクへ戻す(dev と ino の比べが通る)
function swapFolderTwice(dir, name, goal, file) {
  const link = path.join(dir, name);
  const parked = link + '.link';
  const plain = link + '.plain';
  fs.symlinkSync(goal, link);
  put(plain, file, line(OK_MARK));
  const times = { open: 0, resolve: 0 };
  __testHooks.afterOpen = () => { times.open += 1; fs.renameSync(link, parked); fs.renameSync(plain, link); };
  __testHooks.afterResolve = () => { times.resolve += 1; fs.renameSync(link, plain); fs.renameSync(parked, link); };
  return times;
}

test('差し替え2回(途中のフォルダ): check_conditions は集合で断り、印が無い', SWAPS_OPEN_FILE, async (t) => {
  const dir = work(t);
  if (!allowed(t, () => fs.symlinkSync(path.join(dir, 'raw'), path.join(dir, '試し')))) return;
  fs.unlinkSync(path.join(dir, '試し'));
  withoutFdPath(t);
  const times = swapFolderTwice(dir, 'd', path.join(dir, 'raw'), '台帳.txt');
  assert.equal(refused(await conditions(dir, 'd/台帳.txt')), DENIED + 'd/台帳.txt');
  assert.deepEqual(times, { open: 1, resolve: 1 });
});

test('差し替え2回(途中のフォルダ): /proc/self/fd が読める所でも断り、印が無い', SWAPS_OPEN_FILE, async (t) => {
  const dir = work(t);
  if (!allowed(t, () => fs.symlinkSync(path.join(dir, 'raw'), path.join(dir, '試し')))) return;
  fs.unlinkSync(path.join(dir, '試し'));
  const times = swapFolderTwice(dir, 'd', path.join(dir, 'raw'), '台帳.txt');
  refused(await conditions(dir, 'd/台帳.txt'));
  assert.deepEqual(times, { open: 1, resolve: 1 });
});

test('差し替え2回(名前): 普通のファイルに替えて確かめさせ、リンクへ戻しても集合で断る', SWAPS_OPEN_FILE, async (t) => {
  const dir = work(t);
  const flip = path.join(dir, 'flip.txt');
  if (!allowed(t, () => fs.symlinkSync(path.join(dir, 'raw', '台帳.txt'), flip))) return;
  withoutFdPath(t);
  put(dir, 'plain.tmp', line(OK_MARK));
  const parked = path.join(dir, 'link.tmp');
  const plain = path.join(dir, 'plain.tmp');
  __testHooks.afterOpen = () => { fs.renameSync(flip, parked); fs.renameSync(plain, flip); };
  __testHooks.afterResolve = () => { fs.renameSync(flip, plain); fs.renameSync(parked, flip); };
  assert.equal(refused(await conditions(dir, 'flip.txt')), DENIED + 'flip.txt');
});

test('差し替え2回: read_masked でも secrets/ の中身は置き換えた形でも出ない', SWAPS_OPEN_FILE, async (t) => {
  const dir = work(t);
  if (!allowed(t, () => fs.symlinkSync(path.join(dir, 'secrets'), path.join(dir, '試し')))) return;
  fs.unlinkSync(path.join(dir, '試し'));
  withoutFdPath(t);
  const times = swapFolderTwice(path.join(dir, 'raw'), 'd', path.join(dir, 'secrets'), '鍵.txt');
  assert.equal(refused(await masked(dir, 'raw/d/鍵.txt')), DENIED + 'raw/d/鍵.txt');
  assert.deepEqual(times, { open: 1, resolve: 1 });
});

test('Linux の /proc/self/fd: 集合に入れない .git/objects を2回の差し替えで読む形も断る', { skip: process.platform !== 'linux' && 'Linux だけの口' }, async (t) => {
  const dir = work(t);
  const blob = put(dir, '.git/objects/ab/控え.txt', line(GIT_MARK));
  try {
    const fd = fs.openSync(blob, 'r');
    try { fs.readlinkSync('/proc/self/fd/' + fd); } finally { fs.closeSync(fd); }
    fs.symlinkSync(path.join(dir, '.git', 'objects', 'ab'), path.join(dir, '試し'));
  } catch (e) {
    if (e.code !== 'ERR_ACCESS_DENIED' && e.code !== 'ENOENT' && e.code !== 'EPERM') throw e;
    t.skip('/proc/self/fd が読めないかリンクを作れない環境(init の試験など)');
    return;
  }
  fs.unlinkSync(path.join(dir, '試し'));
  assert.ok(!inSet(tool.deniedInodes(dir, 'source'), blob), '.git/objects は集合に入れない');
  const times = swapFolderTwice(dir, 'd', path.join(dir, '.git', 'objects', 'ab'), '控え.txt');
  assert.match(refused(await conditions(dir, 'd/控え.txt')), /secrets\/・\.claude\/・\.git\/ の下/);
  assert.deepEqual(times, { open: 1, resolve: 1 });
});

test('fd の実体のパスに今の決まりを当てる: 開いた fd の番号で /proc/self/fd を読み、raw/ と外と拡張子を断る。読めなければ集合だけで見る', { skip: process.platform !== 'linux' && 'Linux だけの口' }, async (t) => {
  const dir = work(t);
  const real = fs.realpathSync.native(dir);
  let answer;
  const asked = [];
  t.mock.method(fs, 'readlinkSync', (p) => {
    asked.push(p);
    if (answer === undefined) throw Object.assign(new Error('読めない'), { code: 'EACCES' });
    return answer;
  });
  assert.equal((await conditions(dir, '公告/本文.txt')).result.isError, false);
  assert.match(asked[0], /^\/proc\/self\/fd\/\d+$/);
  answer = path.join(real, 'raw', '台帳.txt');
  assert.match(refused(await conditions(dir, '公告/本文.txt')), /raw\/ の書類/);
  answer = path.join(path.dirname(real), '外.txt');
  assert.match(refused(await conditions(dir, '公告/本文.txt')), /作業フォルダの中のファイルだけ/);
  answer = path.join(real, '公告', '図.pdf');
  assert.match(refused(await conditions(dir, '公告/本文.txt')), /^読めるのは文のファイル/);
  answer = path.join(real, 'secrets', '鍵.txt');
  assert.match(refused(await masked(dir, 'raw/台帳.txt')), /raw\/ の中のファイルだけ/);
  answer = path.join(real, '公告', '本文.txt');
  assert.equal((await conditions(dir, '公告/本文.txt')).result.isError, false);
  // 開いた後に名前が消えたファイル: 消える前のパスに決まりを当てる
  answer = path.join(real, 'raw', '台帳.txt') + ' (deleted)';
  assert.match(refused(await conditions(dir, '公告/本文.txt')), /raw\/ の書類/);
  answer = path.join(real, '公告', '本文.txt') + ' (deleted)';
  assert.equal((await conditions(dir, '公告/本文.txt')).result.isError, false);
});

test('sub/raw → ../store のとき store/s.txt を断る。名前は大文字小文字を問わず、secrets も同じ。リンクの先の下の階層も断る', async (t) => {
  const dir = work(t);
  put(dir, 'store/s.txt', line(STORE_MARK));
  put(dir, 'store/下/t.txt', line(STORE_MARK));
  put(dir, 'keys/k.txt', line(KEY_MARK));
  put(dir, 'upper/u.txt', line(STORE_MARK));
  put(dir, 'single/f.txt', line(STORE_MARK));
  fs.mkdirSync(path.join(dir, 'sub'));
  if (!allowed(t, () => {
    fs.symlinkSync(path.join('..', 'store'), path.join(dir, 'sub', 'raw'));
    fs.symlinkSync(path.join('..', 'keys'), path.join(dir, 'sub', 'secrets'));
    fs.symlinkSync(path.join('..', 'upper'), path.join(dir, 'sub', 'RAW'));
    fs.symlinkSync(path.join('..', 'single', 'f.txt'), path.join(dir, 'sub', 'Secrets'));
  })) return;
  for (const file of ['store/s.txt', 'store/下/t.txt', 'keys/k.txt', 'upper/u.txt', 'single/f.txt']) {
    assert.equal(refused(await conditions(dir, file), file), DENIED + file, file);
  }
  assert.equal((await conditions(dir, '公告/本文.txt')).result.isError, false);
});

test('名前が raw・secrets のリンクは作業フォルダの4段まで探す(5段目は見分けられない限界を固定する)。raw/ の中のリンクも見る', async (t) => {
  const dir = work(t);
  put(dir, 'store4/s.txt', line(STORE_MARK));
  put(dir, 'store5/s.txt', line(OK_MARK));
  put(dir, 'store6/s.txt', line(STORE_MARK));
  fs.mkdirSync(path.join(dir, 'a/b/c/d/e'), { recursive: true });
  if (!allowed(t, () => {
    fs.symlinkSync(path.join(dir, 'store4'), path.join(dir, 'a/b/c/d/raw'));
    fs.symlinkSync(path.join(dir, 'store5'), path.join(dir, 'a/b/c/d/e/raw'));
    fs.symlinkSync(path.join(dir, 'store6'), path.join(dir, 'raw', 'secrets'));
  })) return;
  assert.equal(refused(await conditions(dir, 'store4/s.txt')), DENIED + 'store4/s.txt');
  assert.equal(refused(await conditions(dir, 'store6/s.txt')), DENIED + 'store6/s.txt');
  assert.equal((await conditions(dir, 'store5/s.txt')).result.isError, false);
});

test('リンクを探すのは 20,000件までで、raw/ の件数で探す分を使い切らない', async (t) => {
  const dir = work(t);
  put(dir, 'store/s.txt', line(STORE_MARK));
  // 名前の順で sub より先に歩かれやすい所に数を置く。raw/ は集める側で歩くので、探す数に入らない
  for (let i = 0; i < 20100; i += 1) fs.writeFileSync(path.join(dir, 'raw', i + '.txt'), '');
  fs.mkdirSync(path.join(dir, 'sub'));
  if (!allowed(t, () => fs.symlinkSync(path.join('..', 'store'), path.join(dir, 'sub', 'raw')))) return;
  assert.equal(refused(await conditions(dir, 'store/s.txt')), DENIED + 'store/s.txt');
});

test('リンクを探すのは幅優先: 2段目より深い所に 20,000件を超える数があっても、上の段のリンクを先に見る', async (t) => {
  const dir = work(t);
  put(dir, 'near/s.txt', line(STORE_MARK));
  fs.mkdirSync(path.join(dir, 'many/一'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'zz'));
  for (let i = 0; i < 20100; i += 1) fs.writeFileSync(path.join(dir, 'many', '一', i + '.txt'), '');
  if (!allowed(t, () => fs.symlinkSync(path.join('..', 'near'), path.join(dir, 'zz', 'raw')))) return;
  assert.equal(refused(await conditions(dir, 'near/s.txt')), DENIED + 'near/s.txt');
});

test('リンクを探すのは 20,000件まで: 上の段の件数で届いた所まで見て、超えた先のリンクは見分けられない限界を固定する', async (t) => {
  const dir = work(t);
  put(dir, 'store/s.txt', line(OK_MARK));
  fs.mkdirSync(path.join(dir, 'many'));
  fs.mkdirSync(path.join(dir, 'zz/下'), { recursive: true });
  for (let i = 0; i < 19900; i += 1) fs.writeFileSync(path.join(dir, 'many', i + '.txt'), '');
  if (!allowed(t, () => fs.symlinkSync(path.join('..', '..', 'store'), path.join(dir, 'zz', '下', 'raw')))) return;
  // 1段目までの数が 20,000件に届かないので、2段目のリンクが見える
  assert.equal(refused(await conditions(dir, 'store/s.txt')), DENIED + 'store/s.txt');
  for (let i = 19900; i < 20100; i += 1) fs.writeFileSync(path.join(dir, 'many', i + '.txt'), '');
  // 1段目で 20,000件を使い切るので、2段目のリンクは見えない
  assert.equal((await conditions(dir, 'store/s.txt')).result.isError, false);
});

test('名前が raw のリンクが輪になっても止まらず、同じフォルダを2回数えない', async (t) => {
  const dir = work(t);
  put(dir, 'x/f.txt', line(STORE_MARK));
  put(dir, 'y/g.txt', line(STORE_MARK));
  if (!allowed(t, () => {
    fs.symlinkSync(path.join('..', 'y'), path.join(dir, 'x', 'raw'));
    fs.symlinkSync(path.join('..', 'x'), path.join(dir, 'y', 'raw'));
  })) return;
  assert.equal(refused(await conditions(dir, 'x/f.txt')), DENIED + 'x/f.txt');
  assert.equal(refused(await conditions(dir, 'y/g.txt')), DENIED + 'y/g.txt');
  assert.equal((await conditions(dir, '公告/本文.txt')).result.isError, false);
});

test('2つのリンクが同じフォルダを指しても2回数えない(合わせて 50,000件の数を倍にしない)', async (t) => {
  const dir = work(t);
  // 探す数を先に使い切らないよう、リンクより深い段に置く
  fs.mkdirSync(path.join(dir, '深/一/store'), { recursive: true });
  for (let i = 0; i < 30000; i += 1) fs.writeFileSync(path.join(dir, '深', '一', 'store', i + '.txt'), '');
  fs.mkdirSync(path.join(dir, 'x'));
  fs.mkdirSync(path.join(dir, 'y'));
  if (!allowed(t, () => {
    fs.symlinkSync(path.join('..', '深', '一', 'store'), path.join(dir, 'x', 'raw'));
    fs.symlinkSync(path.join('..', '深', '一', 'store'), path.join(dir, 'y', 'raw'));
  })) return;
  assert.equal((await conditions(dir, '公告/本文.txt')).result.isError, false);
  assert.equal(refused(await conditions(dir, '深/一/store/0.txt')), DENIED + '深/一/store/0.txt');
});

test('作業フォルダの直下に 20,000件を超える物があっても、直下の raw/・secrets/ を集合から落とさない', (t) => {
  const dir = work(t);
  for (let i = 0; i < 20100; i += 1) fs.writeFileSync(path.join(dir, String(i).padStart(6, '0') + '.txt'), '');
  const source = tool.deniedInodes(dir, 'source');
  assert.ok(inSet(source, path.join(dir, 'raw', '台帳.txt')));
  assert.ok(inSet(source, path.join(dir, 'secrets', '鍵.txt')));
  assert.ok(inSet(tool.deniedInodes(dir, 'raw'), path.join(dir, 'secrets', '鍵.txt')));
});

test('.git・.claude が raw へのリンクでも、raw/ の下の objects・worktrees という名前を飛ばさない', (t) => {
  const dir = work(t);
  const a = put(dir, 'raw/objects/控え.txt', line(RAW_MARK));
  const b = put(dir, 'raw/worktrees/控え.txt', line(RAW_MARK));
  if (!allowed(t, () => {
    fs.symlinkSync('raw', path.join(dir, '.git'));
    fs.symlinkSync('raw', path.join(dir, '.claude'));
  })) return;
  const set = tool.deniedInodes(dir, 'source');
  assert.ok(inSet(set, a));
  assert.ok(inSet(set, b));
});

test('下の階層の本物のフォルダ(写真/RAW)は数の上限で全体を止めず、足せるだけ足す。リンクの先と直下は止める', async (t) => {
  const dir = work(t);
  const first = put(dir, '写真/RAW/0.txt', '');
  for (let i = 1; i < 50100; i += 1) fs.writeFileSync(path.join(dir, '写真', 'RAW', i + '.txt'), '');
  assert.equal((await conditions(dir, '公告/本文.txt')).result.isError, false);
  assert.equal((await masked(dir, 'raw/台帳.txt')).result.isError, false);
  assert.ok(tool.deniedInodes(dir, 'source').size > 49000, String(first));
  if (!allowed(t, () => fs.symlinkSync(path.join('..', '写真', 'RAW'), path.join(dir, '公告', 'raw')))) return;
  assert.equal(refused(await conditions(dir, '公告/本文.txt')), TOO_MANY);
});

test('中の1件を確かめられなくても(開けない・途中で消えた)全体を止めず、ほかの物は集める', (t) => {
  const dir = work(t);
  const broken = put(dir, 'secrets/開けない.txt', 'x');
  const lstat = fs.lstatSync;
  t.mock.method(fs, 'lstatSync', (p, ...rest) => {
    if (p === broken) throw Object.assign(new Error('開けない'), { code: 'EACCES' });
    return lstat(p, ...rest);
  });
  const set = tool.deniedInodes(dir, 'source');
  assert.ok(inSet(set, path.join(dir, 'secrets', '鍵.txt')));
  assert.ok(inSet(set, path.join(dir, 'raw', '台帳.txt')));
});

test('集合の単体: .git(objects を除く)・.claude(worktrees を除く)・raw/・secrets/・MASK_MAP・MASK_DICT が入り、read_masked の分に raw/ は入らない', (t) => {
  const dir = work(t);
  const config = put(dir, '.git/config', '[core]\n');
  const head = put(dir, '.git/refs/heads/main', 'x\n');
  const blob = put(dir, '.git/objects/ab/cdef', 'x');
  const pack = put(dir, '.git/modules/下/objects/ab/cdef', 'x');
  const local = put(dir, '.claude/settings.local.json', '{}\n');
  const hook = put(dir, '.claude/hooks/a.mjs', '\n');
  const tree = put(dir, '.claude/worktrees/wt/公告.txt', '\n');
  const treeRaw = put(dir, '.claude/worktrees/wt/raw/書類.txt', '\n');
  const nested = put(dir, '.claude/下/worktrees/控え.txt', '\n');
  const map = put(dir, '置き場/対応表.json', '{}\n');
  const dictFile = put(dir, '置き場/辞書.json', '{}\n');
  const before = [process.env.MASK_MAP, process.env.MASK_DICT];
  t.after(() => {
    for (const [k, v] of [['MASK_MAP', before[0]], ['MASK_DICT', before[1]]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  });
  process.env.MASK_MAP = map;
  process.env.MASK_DICT = path.join('置き場', '辞書.json'); // 相対は作業フォルダから
  const source = tool.deniedInodes(dir, 'source');
  const rawKind = tool.deniedInodes(dir, 'raw');
  for (const [name, set] of [['source', source], ['raw', rawKind]]) {
    for (const f of [config, head, local, hook, nested, map, dictFile, path.join(dir, 'secrets', '鍵.txt')]) assert.ok(inSet(set, f), `${name}: ${f}`);
    for (const f of [blob, pack, tree, treeRaw, path.join(dir, '公告', '本文.txt')]) assert.ok(!inSet(set, f), `${name}: ${f}`);
  }
  assert.ok(inSet(source, path.join(dir, 'raw', '台帳.txt')));
  assert.ok(!inSet(rawKind, path.join(dir, 'raw', '台帳.txt')));
});

test('集合の単体: .git/config と .claude/settings.local.json のハードリンクは (dev, ino) が同じなので比べに当たる', (t) => {
  const dir = work(t);
  const config = put(dir, '.git/config', '[core]\n');
  const local = put(dir, '.claude/settings.local.json', '{}\n');
  const links = [path.join(dir, 'c.txt'), path.join(dir, 'l.txt')];
  if (!allowed(t, () => { fs.linkSync(config, links[0]); fs.linkSync(local, links[1]); })) return;
  const set = tool.deniedInodes(dir, 'source');
  for (const f of links) assert.ok(inSet(set, f), f);
});

test('集合の単体: 下の階層の本物のフォルダ raw・secrets も入る(Windows・mac で2回の差し替えを止める)。read_masked の分は raw の名前を見ず、raw/ の中の secrets も入れない', (t) => {
  const dir = work(t);
  const lower = put(dir, '工事B/raw/書類.txt', line(STORE_MARK));
  const keys = put(dir, '工事B/secrets/鍵.txt', line(KEY_MARK));
  const inside = put(dir, 'raw/secrets/控え.txt', line(RAW_MARK));
  const source = tool.deniedInodes(dir, 'source');
  const rawKind = tool.deniedInodes(dir, 'raw');
  assert.ok(inSet(source, lower));
  assert.ok(inSet(source, keys));
  assert.ok(!inSet(rawKind, lower));
  assert.ok(inSet(rawKind, keys));
  assert.ok(!inSet(rawKind, inside));
});

test('前のとおり読む形: raw/ の中の secrets というフォルダは read_masked で読める', async (t) => {
  const dir = work(t);
  put(dir, 'raw/secrets/控え.txt', line(OK_MARK));
  const r = await masked(dir, 'raw/secrets/控え.txt');
  assert.equal(r.result.isError, false);
  assert.ok(r.result.content[0].text.includes(OK_MARK));
});

test('.git がファイル(worktree の印)でも集合に入り、普通の入力を断らない', async (t) => {
  const dir = work(t);
  const pointer = put(dir, '.git', 'gitdir: /tmp/example\n');
  assert.ok(inSet(tool.deniedInodes(dir, 'source'), pointer));
  assert.equal((await conditions(dir, '公告/本文.txt')).result.isError, false);
  assert.equal((await masked(dir, 'raw/台帳.txt')).result.isError, false);
});

test('raw/ の中のフォルダへのリンクはたどらない: 輪になるリンクで止まらず、普通の入力を断らない', async (t) => {
  const dir = work(t);
  if (!allowed(t, () => fs.symlinkSync('..', path.join(dir, 'raw', '輪')))) return;
  assert.equal((await conditions(dir, '公告/本文.txt')).result.isError, false);
});

test('MASK_MAP を raw/ に置いても read_masked で読めない(置き換えた形で対応表が出ない)', async (t) => {
  const dir = work(t);
  put(dir, 'raw/対応表.json', '{"map":"CANARY-RAW-DAICHO"}\n');
  const before = process.env.MASK_MAP;
  t.after(() => { if (before === undefined) delete process.env.MASK_MAP; else process.env.MASK_MAP = before; });
  process.env.MASK_MAP = path.join('raw', '対応表.json');
  assert.equal(refused(await masked(dir, 'raw/対応表.json')), DENIED + 'raw/対応表.json');
});

test('E1・E3 の普通の入力を断らない(公告の2ファイルと E1 の raw/ の書類。.git と .claude のある作業フォルダで)', async (t) => {
  const dir = work(t);
  fs.rmSync(path.join(dir, 'raw'), { recursive: true });
  fs.cpSync(path.join(ROOT, 'plugin', 'evals', 'cases', 'E1_しおかぜ町下水道', 'raw'), path.join(dir, 'raw'), { recursive: true });
  for (const [from, to] of [['N3_市の公告.txt', '公告.txt'], ['N3_市の説明書.txt', '説明書.txt']]) {
    fs.copyFileSync(path.join(ROOT, 'fixtures', 'bid-intake', '公告', from), path.join(dir, '公告', to));
  }
  put(dir, '.git/config', '[core]\n');
  put(dir, '.claude/settings.local.json', '{}\n');
  const files = fs.readdirSync(path.join(dir, 'raw'));
  assert.equal(files.length, 2);
  for (const f of files) assert.equal((await masked(dir, 'raw/' + f)).result.isError, false, f);
  const data = fs.readFileSync(path.join(ROOT, 'docs', 'samples', 'bid-intake', '測り', 'N3.json'), 'utf8');
  const r = await handleMessage({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'check_conditions', arguments: { data, files: ['公告/公告.txt', '公告/説明書.txt'] } } }, { root: dir });
  assert.equal(r.result.isError, false, r.result.content[0].text);
});

test('1回の呼び出しで集合は1回だけ作る(ファイルの数で歩く回数が増えない)', async (t) => {
  const dir = work(t);
  put(dir, '公告/二.txt', line(OK_MARK));
  put(dir, '公告/三.txt', line(OK_MARK));
  await conditions(dir, '公告/本文.txt'); // 部品の読み込みを数に入れない
  const readdir = fs.readdirSync;
  let walks = 0;
  t.mock.method(fs, 'readdirSync', (...args) => { walks += 1; return readdir(...args); });
  await conditions(dir, '公告/本文.txt');
  const one = walks;
  walks = 0;
  await conditions(dir, '公告/本文.txt', '公告/二.txt', '公告/三.txt');
  assert.ok(one > 0);
  assert.equal(walks, one);
});

test('断る数の境目: 合わせて 50,000件ちょうどは通り、1件超えると次の手を添えて断る。read_masked は raw/ を歩かない', async (t) => {
  const dir = work(t);
  // work の raw/台帳.txt と secrets/鍵.txt で 2件
  for (let i = 0; i < 49998; i += 1) fs.writeFileSync(path.join(dir, 'raw', i + '.txt'), '');
  assert.equal((await conditions(dir, '公告/本文.txt')).result.isError, false);
  put(dir, '.claude/一.txt', 'x'); // .claude のフォルダの分は数えず、中の1件で合わせて 50,001件
  assert.equal(refused(await conditions(dir, '公告/本文.txt')), TOO_MANY);
  assert.equal((await masked(dir, 'raw/台帳.txt')).result.isError, false);
});

test('8段を超える raw/ でも次の手を添えて断り、8段ちょうどは通る', async (t) => {
  const dir = work(t);
  const eight = '1/2/3/4/5/6/7/8';
  put(dir, `raw/${eight}/書類.txt`, 'x');
  assert.equal((await conditions(dir, '公告/本文.txt')).result.isError, false);
  put(dir, `raw/${eight}/9/書類.txt`, 'x');
  assert.equal(refused(await conditions(dir, '公告/本文.txt')), TOO_DEEP);
  // read_masked は raw/ を歩かないので断らない。secrets/ の深さは断る
  assert.equal((await masked(dir, 'raw/台帳.txt')).result.isError, false);
  put(dir, `secrets/${eight}/9/鍵.txt`, 'x');
  assert.equal(refused(await masked(dir, 'raw/台帳.txt')), TOO_DEEP);
});

test('字で断る物は集合を作らずに断る(大きすぎる作業フォルダでも、理由はパスの方を返す)', async (t) => {
  const dir = work(t);
  const readdir = fs.readdirSync;
  let walks = 0;
  t.mock.method(fs, 'readdirSync', (...args) => { walks += 1; return readdir(...args); });
  assert.match(refused(await masked(dir, '公告/本文.txt')), /raw\/ の中のファイルだけ/);
  assert.match(refused(await conditions(dir, 'raw/台帳.txt')), /raw\/ の書類/);
  assert.equal(walks, 0);
});

test('plugin/ の写しが元と同じ。manual の限界に残る形を書いた', () => {
  assert.deepEqual(staleCopies().filter((p) => p.includes('masked-files')), []);
  const manual = fs.readFileSync(path.join(ROOT, 'docs', 'manual.md'), 'utf8');
  for (const words of [
    'raw/ から外へ移すのは道具では止められない',
    'Windows・mac では集合に入れない所を2回の差し替えで読む形が残りうる',
    'ファイルの番号を返さないドライブ(exFAT の USB など)では読めない',
  ]) assert.ok(manual.includes(words), words);
  assert.ok(!manual.includes('(差し替え2回)は、この確かめでは見分けられない'));
  assert.ok(!manual.includes('集める側で歩くフォルダの中の件数'));
  assert.ok(manual.includes('`raw` そのものがリンクのときは'));
});

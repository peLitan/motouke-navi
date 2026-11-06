// F83b1 の単体の試験: read_masked と check_conditions の読み口 readChecked(開いてから確かめる)。ファイルの中身は作り物の印 CANARY-* だけ
// check_conditions は語のある行の先頭を返すので、読まない所を読むと印が返事に出る。read_masked は置き換えた後の中身に印が残る(下の「前提」の試験)
// init は node の権限の決まりの中で試験を動かし、記号リンクと子のプロセスを作れないので、その形は飛ばす(このファイルを node --test で直接動かして確かめる)
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { handleMessage, __testHooks } from '../../integration/claude-code/mcp/masked-files.mjs';
import { staleCopies } from '../../scripts/sync-plugin.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TOOL = path.join(ROOT, 'integration', 'claude-code', 'mcp', 'masked-files.mjs');
const RAW_MARK = 'CANARY-RAW-DAICHO';
const KEY_MARK = 'CANARY-SECRET-KEY';
const OK_MARK = 'CANARY-OK-KOUKOKU';
const REPLACED = '読む間にファイルが替わりました。もう一度呼んでください';
const line = (mark) => `工事名: ${mark}\n`;

function work(t) {
  fs.mkdirSync(path.join(ROOT, 'tmp'), { recursive: true });
  const dir = fs.mkdtempSync(path.join(ROOT, 'tmp', 'f83b1-'));
  t.after(() => {
    __testHooks.afterOpen = null;
    __testHooks.afterResolve = null;
    fs.rmSync(dir, { recursive: true, force: true });
  });
  for (const [rel, mark] of [['raw/台帳.txt', RAW_MARK], ['secrets/鍵.txt', KEY_MARK], ['公告/本文.txt', OK_MARK]]) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), line(mark));
  }
  return dir;
}

// リンクと子のプロセスを作れないときだけ飛ばす(check-conditions-tool.test.mjs の linked と同じ。Windows の記号リンクの権限の無い形も飛ばす)
function allowed(t, make) {
  try {
    make();
    return true;
  } catch (e) {
    if (e.code !== 'ERR_ACCESS_DENIED' && e.code !== 'EPERM') throw e;
    t.skip('リンクと子のプロセスを作る権限が無い環境(init の試験など)');
    return false;
  }
}

// Windows では開いているファイルへ名前を付け替えられないので、この手順の差し替えは起きない(Windows の差し替えは統括の sec-win.mjs で見る)
const SWAPS_OPEN_FILE = { skip: process.platform === 'win32' && '開いているファイルへ名前を付け替えられない' };

const conditions = (root, file) => handleMessage({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'check_conditions', arguments: { data: '{"conditions":[]}', files: [file] } } }, { root });
const masked = (root, file) => handleMessage({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'read_masked', arguments: { path: file } } }, { root, mapPath: '', dictPath: '' });

// 断りの形: 印が返事のどこにも無く、道具の誤りの文が1つ。印を先に見るので、読めてしまったときは漏れとして落ちる
const refused = (r, name = '') => {
  const all = JSON.stringify(r);
  for (const m of [RAW_MARK, KEY_MARK]) assert.ok(!all.includes(m), `${name} 印が返事に出た: ${all.slice(0, 240)}`);
  assert.equal(r.result.isError, true, name);
  assert.equal(r.result.content.length, 1, name);
  return r.result.content[0].text;
};

// 開いた直後に1回だけ差し替える。呼ばれた回数を返す関数で、差し替えが本当に走ったことを確かめる
function afterOpen(swap) {
  let times = 0;
  __testHooks.afterOpen = () => { times += 1; swap(); };
  return () => times;
}

// 記号リンクで開いた直後に、その名前を同じ実体のハードリンクへ替える。実体のパスは読める所を指し、dev と ino も合う。fstat の時のリンクの数は 1 なので、今の数でしか止まらない
function hardlinkSwap(dir, src, flip) {
  const tmp = path.join(dir, 'link.tmp');
  return afterOpen(() => {
    fs.linkSync(src, tmp);
    fs.renameSync(tmp, flip);
  });
}

test('前提: 読めたときは返事に印が出る(「印が無い」の確かめが空振りでない)。試験の口は本番では null', async (t) => {
  assert.deepEqual(__testHooks, { afterOpen: null, afterResolve: null });
  const dir = work(t);
  const r = await conditions(dir, '公告/本文.txt');
  assert.equal(r.result.isError, false);
  assert.ok(r.result.content[0].text.includes(OK_MARK));
  const m = await masked(dir, 'raw/台帳.txt');
  assert.equal(m.result.isError, false);
  assert.ok(m.result.content[0].text.includes(RAW_MARK));
});

test('(a) raw/ のファイルのハードリンクを check_conditions に渡すと断り、印が無い', async (t) => {
  const dir = work(t);
  if (!allowed(t, () => fs.linkSync(path.join(dir, 'raw', '台帳.txt'), path.join(dir, '写し.txt')))) return;
  assert.equal(refused(await conditions(dir, '写し.txt')), 'リンクの数が2以上のファイル(ハードリンク)は読みません。写し(コピー)を置いてください: 写し.txt');
});

test('(a) raw/ の中にリンクの数が2のファイルがあると read_masked も断る(secrets/ の中身が置き換えた形で出ない)', async (t) => {
  const dir = work(t);
  if (!allowed(t, () => fs.linkSync(path.join(dir, 'secrets', '鍵.txt'), path.join(dir, 'raw', '控え.txt')))) return;
  assert.equal(refused(await masked(dir, 'raw/控え.txt')), 'リンクの数が2以上のファイル(ハードリンク)は読みません。写し(コピー)を置いてください: raw/控え.txt');
});

test('(b) 開いた後に普通のファイル → raw へのリンクに替える: 実体のパスの確かめで断る', SWAPS_OPEN_FILE, async (t) => {
  const dir = work(t);
  fs.writeFileSync(path.join(dir, 'flip.txt'), line(OK_MARK));
  if (!allowed(t, () => fs.symlinkSync(path.join(dir, 'raw', '台帳.txt'), path.join(dir, 'link.tmp')))) return;
  const times = afterOpen(() => fs.renameSync(path.join(dir, 'link.tmp'), path.join(dir, 'flip.txt')));
  assert.match(refused(await conditions(dir, 'flip.txt')), /raw\/ の書類/);
  assert.equal(times(), 1);
});

test('(c) 開いた後に raw へのリンク → 普通のファイルに替える: 実体のパスは普通のファイルを指すので、dev と ino の比べで断る', SWAPS_OPEN_FILE, async (t) => {
  const dir = work(t);
  fs.writeFileSync(path.join(dir, 'file.tmp'), line(OK_MARK));
  if (!allowed(t, () => fs.symlinkSync(path.join(dir, 'raw', '台帳.txt'), path.join(dir, 'flip.txt')))) return;
  const times = afterOpen(() => fs.renameSync(path.join(dir, 'file.tmp'), path.join(dir, 'flip.txt')));
  assert.equal(refused(await conditions(dir, 'flip.txt')), REPLACED);
  assert.equal(times(), 1);
});

test('(c) 開いた後に raw へのリンク → 同じ実体のハードリンクに替える: dev と ino が合うので、今のリンクの数で断る', SWAPS_OPEN_FILE, async (t) => {
  const dir = work(t);
  const src = path.join(dir, 'raw', '台帳.txt');
  const flip = path.join(dir, 'flip.txt');
  if (!allowed(t, () => fs.symlinkSync(src, flip))) return;
  const times = hardlinkSwap(dir, src, flip);
  assert.equal(refused(await conditions(dir, 'flip.txt')), REPLACED);
  assert.equal(times(), 1);
});

test('(c) 途中のフォルダを1回替える: raw へのリンク → 同じ実体のハードリンクを置いたフォルダへのリンク。今のリンクの数で断る', SWAPS_OPEN_FILE, async (t) => {
  const dir = work(t);
  const d = path.join(dir, 'd');
  if (!allowed(t, () => fs.symlinkSync(path.join(dir, 'raw'), d))) return;
  const times = afterOpen(() => {
    fs.mkdirSync(path.join(dir, 'e'));
    fs.linkSync(path.join(dir, 'raw', '台帳.txt'), path.join(dir, 'e', '台帳.txt'));
    fs.symlinkSync(path.join(dir, 'e'), path.join(dir, 'link.tmp'));
    fs.renameSync(path.join(dir, 'link.tmp'), d);
  });
  assert.equal(refused(await conditions(dir, 'd/台帳.txt')), REPLACED);
  assert.equal(times(), 1);
});

test('(d) read_masked: 開いた直後に secrets/ へのリンクに替えると断り、印が無い', SWAPS_OPEN_FILE, async (t) => {
  const dir = work(t);
  fs.writeFileSync(path.join(dir, 'raw', 'a.txt'), line(OK_MARK));
  if (!allowed(t, () => fs.symlinkSync(path.join(dir, 'secrets', '鍵.txt'), path.join(dir, 'link.tmp')))) return;
  const times = afterOpen(() => fs.renameSync(path.join(dir, 'link.tmp'), path.join(dir, 'raw', 'a.txt')));
  assert.match(refused(await masked(dir, 'raw/a.txt')), /raw\/ の中のファイルだけ/);
  assert.equal(times(), 1);
});

test('(d) read_masked: 開いた後に secrets/ へのリンク → 普通のファイルに替えても、dev と ino の比べで断る', SWAPS_OPEN_FILE, async (t) => {
  const dir = work(t);
  fs.writeFileSync(path.join(dir, 'file.tmp'), line(OK_MARK));
  if (!allowed(t, () => fs.symlinkSync(path.join(dir, 'secrets', '鍵.txt'), path.join(dir, 'raw', 'a.txt')))) return;
  const times = afterOpen(() => fs.renameSync(path.join(dir, 'file.tmp'), path.join(dir, 'raw', 'a.txt')));
  assert.equal(refused(await masked(dir, 'raw/a.txt')), REPLACED);
  assert.equal(times(), 1);
});

test('(d) read_masked: 開いた後に secrets/ へのリンク → 同じ実体のハードリンクに替えても、今のリンクの数で断る', SWAPS_OPEN_FILE, async (t) => {
  const dir = work(t);
  const src = path.join(dir, 'secrets', '鍵.txt');
  const flip = path.join(dir, 'raw', 'a.txt');
  if (!allowed(t, () => fs.symlinkSync(src, flip))) return;
  const times = hardlinkSwap(dir, src, flip);
  assert.equal(refused(await masked(dir, 'raw/a.txt')), REPLACED);
  assert.equal(times(), 1);
});

test('開いた後に別の普通のファイルを被せる: ino の比べで断る(記号リンクを使わないので init の下でも走る)', SWAPS_OPEN_FILE, async (t) => {
  const dir = work(t);
  const flip = path.join(dir, '公告', 'flip.txt');
  fs.writeFileSync(flip, line(OK_MARK));
  fs.writeFileSync(path.join(dir, '公告', '別.tmp'), line(OK_MARK));
  const times = afterOpen(() => fs.renameSync(path.join(dir, '公告', '別.tmp'), flip));
  assert.equal(refused(await conditions(dir, '公告/flip.txt')), REPLACED);
  assert.equal(times(), 1);
});

test('開いた後にハードリンクを足す: 今のリンクの数で断る(記号リンクを使わないので init の下でも走る)', async (t) => {
  const dir = work(t);
  const times = afterOpen(() => fs.linkSync(path.join(dir, '公告', '本文.txt'), path.join(dir, '公告', '控え.txt')));
  assert.equal(refused(await conditions(dir, '公告/本文.txt')), REPLACED);
  assert.equal(times(), 1);
});

test('dev も比べる: ino が同じでも別のドライブのファイルなら断る', async (t) => {
  const dir = work(t);
  const stat = fs.statSync;
  t.mock.method(fs, 'statSync', (p, opts) => {
    const st = stat(p, opts);
    if (opts?.bigint) st.dev += 1n;
    return st;
  });
  assert.equal(refused(await conditions(dir, '公告/本文.txt')), REPLACED);
});

test('実体の確かめの後にファイルが消えたら、例外で抜けずに断る', SWAPS_OPEN_FILE, async (t) => {
  const dir = work(t);
  __testHooks.afterResolve = (target) => fs.unlinkSync(target);
  assert.equal(refused(await conditions(dir, '公告/本文.txt')), REPLACED);
});

test('開けない形のうち無いのと同じ物は「ファイルがありません」で返す(途中がファイル・長すぎる名前・リンクの輪)', async (t) => {
  const dir = work(t);
  for (const file of ['公告/無い.txt', '公告/本文.txt/下.txt', '公告/' + 'あ'.repeat(200) + '.txt']) {
    assert.equal(refused(await conditions(dir, file), file), 'ファイルがありません: ' + file);
  }
  assert.equal(refused(await masked(dir, 'raw/台帳.txt/下.txt')), 'ファイルがありません: raw/台帳.txt/下.txt');
  if (!allowed(t, () => fs.symlinkSync('輪.txt', path.join(dir, '公告', '輪.txt')))) return;
  assert.equal(refused(await conditions(dir, '公告/輪.txt')), 'ファイルがありません: 公告/輪.txt');
});

test('確かめの後に差し替えても、開いた fd から読むので替えた先の中身は出ない', SWAPS_OPEN_FILE, async (t) => {
  const dir = work(t);
  const flip = path.join(dir, 'flip.txt');
  fs.writeFileSync(flip, line(OK_MARK));
  if (!allowed(t, () => fs.symlinkSync(path.join(dir, 'raw', '台帳.txt'), path.join(dir, 'link.tmp')))) return;
  // dev と ino の比べの stat が返った直後に差し替える。ここから先は名前を見ない
  const stat = fs.statSync;
  let swapped = 0;
  t.mock.method(fs, 'statSync', (p, ...rest) => {
    const st = stat(p, ...rest);
    if (p === flip && !swapped) { swapped += 1; fs.renameSync(path.join(dir, 'link.tmp'), flip); }
    return st;
  });
  const r = await conditions(dir, 'flip.txt');
  assert.equal(swapped, 1);
  assert.ok(!JSON.stringify(r).includes(RAW_MARK), '印が返事に出た');
  assert.equal(r.result.isError, false);
  assert.ok(r.result.content[0].text.includes(OK_MARK));
});

test('読む間に大きさが変わったら断る(足された分や切られた分を混ぜた文を渡さない)', async (t) => {
  const dir = work(t);
  for (const [name, change] of [['足す', (p) => fs.appendFileSync(p, line(RAW_MARK))], ['切る', (p) => fs.truncateSync(p, 4)]]) {
    const file = path.join(dir, '公告', name + '.txt');
    fs.writeFileSync(file, line(OK_MARK));
    const times = afterOpen(() => change(file));
    assert.equal(refused(await conditions(dir, '公告/' + name + '.txt'), name), REPLACED, name);
    assert.equal(times(), 1, name);
  }
});

test('afterResolve は実体の確かめが通った後で呼ばれ、断る物では呼ばれない(F83b6 が使う)', async (t) => {
  const dir = work(t);
  const seen = [];
  __testHooks.afterResolve = (target) => seen.push(path.basename(target));
  assert.equal((await conditions(dir, '公告/本文.txt')).result.isError, false);
  assert.deepEqual(seen, ['本文.txt']);
  fs.writeFileSync(path.join(dir, '公告', '図.pdf'), 'x');
  assert.match(refused(await conditions(dir, '公告/図.pdf')), /読めるのは文のファイル/);
  assert.deepEqual(seen, ['本文.txt']);
});

test('(e) POSIX だけ: FIFO を渡しても止まらず、2秒以内に断る(子のプロセスで走らせ、止まっても試験は固まらない)', { skip: process.platform === 'win32' }, (t) => {
  const dir = work(t);
  const fifos = [path.join(dir, 'fifo.txt'), path.join(dir, 'raw', 'fifo.txt')];
  let made;
  if (!allowed(t, () => { made = spawnSync('mkfifo', fifos); })) return;
  if (made.error?.code === 'ENOENT') { t.skip('mkfifo が無い'); return; }
  assert.equal(made.status, 0);
  const child = `
    const [url, root] = process.argv.slice(1);
    const { handleMessage } = await import(url);
    const out = [];
    for (const [name, args] of [['check_conditions', { data: '{"conditions":[]}', files: ['fifo.txt'] }], ['read_masked', { path: 'raw/fifo.txt' }]]) {
      const start = performance.now();
      const r = await handleMessage({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, { root, mapPath: '', dictPath: '' });
      out.push({ name, ms: performance.now() - start, isError: r.result.isError, text: r.result.content[0].text });
    }
    console.log(JSON.stringify(out));
  `;
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', child, pathToFileURL(TOOL).href, dir], { encoding: 'utf8', timeout: 10000 });
  assert.equal(run.error, undefined, '子のプロセスが止まった(FIFO を開いて待っている)');
  assert.equal(run.status, 0, run.stderr);
  const out = JSON.parse(run.stdout);
  assert.equal(out.length, 2);
  for (const r of out) {
    assert.equal(r.isError, true, r.name);
    assert.match(r.text, /^ファイルではありません: /, r.name);
    assert.ok(r.ms < 2000, `${r.name} ${r.ms}ms`);
  }
});

test('(f) 読めた回も断った回も、300回呼んだ後に開いた fd の数が増えていない', async (t) => {
  const dir = work(t);
  const count = () => fs.readdirSync('/proc/self/fd').length;
  try {
    count();
  } catch (e) {
    if (e.code !== 'ENOENT' && e.code !== 'ERR_ACCESS_DENIED') throw e;
    t.skip('/proc/self/fd が読めない');
    return;
  }
  fs.writeFileSync(path.join(dir, '公告', '図.pdf'), 'x'); // 開いた後の実体の確かめで断る
  const calls = [['読める', '公告/本文.txt', false], ['実体で断る', '公告/図.pdf', true]];
  fs.writeFileSync(path.join(dir, '公告', '元.txt'), line(OK_MARK)); // 読める回のファイルとは別のファイルにリンクを作る
  if (!allowed(t, () => fs.linkSync(path.join(dir, '公告', '元.txt'), path.join(dir, '公告', '写し.txt')))) return;
  calls.push(['fstat で断る', '公告/写し.txt', true]);
  await conditions(dir, '公告/本文.txt'); // 初めの1回の部品の読み込みを数に入れない
  const before = count();
  for (const [name, file, isError] of calls) {
    for (let i = 0; i < 300; i += 1) assert.equal((await conditions(dir, file)).result.isError, isError, name);
    assert.ok(count() <= before, `${name}: ${before} → ${count()}`);
  }
});

test('1MB の上限は実体の確かめの後で見る: 大きい Excel には文にして置く案内を返す(大きさを縮める話にしない)', async (t) => {
  const dir = work(t);
  const big = Buffer.alloc(1024 * 1024 + 1, 0x61);
  fs.writeFileSync(path.join(dir, 'raw', '台帳.xlsx'), big);
  fs.writeFileSync(path.join(dir, '公告', '図.pdf'), big);
  fs.writeFileSync(path.join(dir, '公告', '長い.txt'), big);
  assert.match(refused(await masked(dir, 'raw/台帳.xlsx')), /Excel・Word は画面か表計算で文にしてから raw\/ に置いてください/);
  assert.match(refused(await conditions(dir, '公告/図.pdf')), /^読めるのは文のファイル/);
  assert.equal(refused(await conditions(dir, '公告/長い.txt')), 'ファイルが大きすぎます(1MB まで): 公告/長い.txt');
});

test('1MB の上限は実体の確かめの後で見る: 外や raw/ へのリンクで、リンクの先の大きさが返事から分からない', async (t) => {
  const dir = work(t);
  const big = Buffer.alloc(1024 * 1024 + 1, 0x61);
  fs.writeFileSync(path.join(dir, 'raw', '大.txt'), big);
  fs.writeFileSync(path.join(dir, 'secrets', '大.txt'), big);
  if (!allowed(t, () => {
    fs.symlinkSync(path.join(dir, 'raw', '大.txt'), path.join(dir, '公告', 'リンク.txt'));
    fs.symlinkSync(path.join(dir, 'secrets', '大.txt'), path.join(dir, 'raw', 'リンク.txt'));
  })) return;
  assert.match(refused(await conditions(dir, '公告/リンク.txt')), /raw\/ の書類/);
  assert.match(refused(await masked(dir, 'raw/リンク.txt')), /raw\/ の中のファイルだけ/);
});

test('番号の取れないドライブ: fstat の ino が 0 なら、理由と次の手で断る', async (t) => {
  const dir = work(t);
  const fstat = fs.fstatSync;
  t.mock.method(fs, 'fstatSync', (fd, opts) => {
    const st = fstat(fd, opts);
    st.ino = 0n;
    return st;
  });
  const text = 'このドライブではファイルの番号が取れないので読めません。作業フォルダを NTFS などのドライブに置いてください';
  assert.equal(refused(await conditions(dir, '公告/本文.txt')), text);
  assert.equal(refused(await masked(dir, 'raw/台帳.txt')), text);
});

test('前のとおり読む形: 作業フォルダの中のリンクは読む(O_NOFOLLOW を使わない)', async (t) => {
  const dir = work(t);
  if (!allowed(t, () => {
    fs.symlinkSync(path.join(dir, '公告', '本文.txt'), path.join(dir, '本物へ.txt'));
    fs.symlinkSync(path.join(dir, 'raw', '台帳.txt'), path.join(dir, 'raw', '中へ.txt'));
  })) return;
  assert.ok((await conditions(dir, '本物へ.txt')).result.content[0].text.includes(OK_MARK));
  assert.ok((await masked(dir, 'raw/中へ.txt')).result.content[0].text.includes(RAW_MARK));
});

test('plugin/ の写しが元と同じ。manual の限界を今の動きに合わせた', () => {
  assert.deepEqual(staleCopies().filter((p) => p.includes('masked-files')), []);
  const manual = fs.readFileSync(path.join(ROOT, 'docs', 'manual.md'), 'utf8');
  assert.ok(manual.includes('ファイルの番号を返さないドライブ(exFAT の USB など)では読めない'));
  assert.ok(!manual.includes('ハードリンクは見分けられない'));
});

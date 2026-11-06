// F76a の単体の試験: MCP の道具 check_conditions(masked-files)と、Skill bid-intake の手順・文書。公告と書類の文はすべて架空
// init の試験は子のプロセスを起こせないので、handleMessage を読み込んで確かめる。CLI の出力は、見本の --out・--md のファイルと比べる
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { handleMessage, TOOLS, checkConditionsFiles } from '../../integration/claude-code/mcp/masked-files.mjs';
import { checkConditions, renderMarkdown, summaryLine } from '../../plugin/skills/bid-intake/scripts/check-conditions.mjs';
import { staleCopies } from '../../scripts/sync-plugin.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PLUGIN = path.join(ROOT, 'plugin');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const SAMPLE = 'docs/samples/bid-intake/';
const DATA = read(SAMPLE + '拾った条件.json');
const NOTICES = ['架空公告.md', '架空説明書.md'];
const FILES = NOTICES.map((f) => '公告/' + f);
const SOURCES = NOTICES.map((f) => ({ file: f, text: read(SAMPLE + f) }));
const COMPANY = '架空の台帳。予定価格は甲山建設株式会社の内部の控え 12,345,678円。';

const write = (dir, rel, body) => {
  const p = path.join(dir, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body);
};

// 公告を raw/ の外に、会社の書類と設定を断る所に置いた作業フォルダ
function work(t) {
  fs.mkdirSync(path.join(ROOT, 'tmp'), { recursive: true });
  const dir = fs.mkdtempSync(path.join(ROOT, 'tmp', 'f76a-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const f of NOTICES) write(dir, '公告/' + f, read(SAMPLE + f));
  for (const f of ['raw/台帳.txt', '工事A/raw/台帳.txt', 'secrets/a.txt', '工事A/secrets/a.json', '.claude/settings.json', '.git/note.txt', '.env.txt', '公告/.隠し/a.md']) write(dir, f, COMPANY);
  return dir;
}

// init.mjs は node の権限の決まりの中で試験を動かし、リンクを作れない。そのときだけ飛ばす(node --test で直接動かすと確かめる)
function linked(t, make) {
  try {
    make();
    return true;
  } catch (e) {
    if (e.code !== 'ERR_ACCESS_DENIED') throw e;
    t.skip('リンクを作る権限が無い環境(init の試験)');
    return false;
  }
}

const call = (root, args, handler = handleMessage) => handler({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'check_conditions', arguments: args } }, { root });

// 断りの形: JSON-RPC の誤りではなく道具の誤りの文1つ。原文の字は入らない
const refused = (r, name) => {
  assert.equal(r.error, undefined, name);
  assert.equal(r.result.isError, true, name);
  assert.equal(r.result.content.length, 1, name);
  assert.ok(!r.result.content[0].text.includes('甲山建設'), name);
  return r.result.content[0].text;
};

// plugin/ を tmp/ に写す(入れたときと同じ)。change で写しを変えてから、その写しの道具を読み込む
async function installed(t, change = () => {}) {
  fs.mkdirSync(path.join(ROOT, 'tmp'), { recursive: true });
  const dir = fs.mkdtempSync(path.join(ROOT, 'tmp', 'f76a-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.cpSync(PLUGIN, dir, { recursive: true });
  change(dir);
  const saved = process.env.MASK_TOOL_DIR;
  process.env.MASK_TOOL_DIR = dir;
  try {
    return { dir, ...(await import(pathToFileURL(path.join(dir, 'mcp', 'masked-files.mjs')).href)) };
  } finally {
    if (saved === undefined) delete process.env.MASK_TOOL_DIR; else process.env.MASK_TOOL_DIR = saved;
  }
}

test('tools/list: 4つの道具。check_conditions の引数は data と files で、どちらも要る', async () => {
  const list = await handleMessage({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, { root: ROOT });
  assert.deepEqual(list.result.tools.map((t) => t.name), ['read_masked', 'list_masked', 'check_articles', 'check_conditions']);
  const tool = TOOLS.find((t) => t.name === 'check_conditions');
  assert.deepEqual(Object.keys(tool.inputSchema.properties), ['data', 'files']);
  assert.equal(tool.inputSchema.properties.data.type, 'string');
  assert.equal(tool.inputSchema.properties.files.type, 'array');
  assert.deepEqual(tool.inputSchema.required, ['data', 'files']);
  assert.equal(tool.inputSchema.additionalProperties, false);
});

test('initialize: instructions に check_conditions の文がある', async () => {
  const r = await handleMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }, { root: ROOT });
  assert.ok(r.result.instructions.includes('公告から拾った条件は check_conditions で照らしてください。'));
});

test('返事: 1つ目は表+最後の行、2つ目は --out と同じ形の JSON で、見本の CLI の出力と1字も違わない', async (t) => {
  const r = await call(work(t), { data: DATA, files: FILES });
  assert.equal(r.error, undefined);
  assert.equal(r.result.isError, false);
  const expected = checkConditions(JSON.parse(DATA), SOURCES);
  assert.deepEqual(r.result.content, [
    { type: 'text', text: renderMarkdown(expected) + summaryLine(expected) },
    { type: 'text', text: JSON.stringify(expected, null, 2) + '\n' },
  ]);
  // 見本の 画面に入れる条件.json・拾った結果.md は CLI の --out・--md で作ったもの
  assert.equal(r.result.content[1].text, read(SAMPLE + '画面に入れる条件.json'));
  assert.ok(r.result.content[0].text.startsWith(read(SAMPLE + '拾った結果.md')));
  // file は CLI と同じくファイルの名前だけ
  const rows = JSON.parse(r.result.content[1].text).rows.filter((x) => x.file);
  assert.ok(rows.length > 0);
  assert.ok(rows.every((x) => NOTICES.includes(x.file)));
});

test('返事: 外した値があっても道具の誤りにしない', async (t) => {
  const data = JSON.parse(DATA);
  data.conditions.push({ key: 'grade', value: 'A', quote: '原文に無い抜き書きの文(架空)' });
  const r = await call(work(t), { data: JSON.stringify(data), files: FILES });
  assert.equal(r.result.isError, false);
  const out = JSON.parse(r.result.content[1].text);
  assert.equal(out.removed.length, 1);
  assert.equal(out.removed[0].reason, '抜き書きが原文に無い');
  assert.ok(r.result.content[0].text.endsWith('(外した値 1)'));
});

test('断る: 作業フォルダの外・raw/・secrets/・.claude/・.git/・. で始まる部分。投げず、中身を返さない', async (t) => {
  const dir = work(t);
  write(path.dirname(dir), path.basename(dir) + '-外.txt', COMPANY);
  t.after(() => fs.rmSync(dir + '-外.txt', { force: true }));
  const RAW = /raw\/ の書類は check_conditions に渡せません。公告は raw\/ の外に置いてください/;
  const HIDDEN = /secrets\/・\.claude\/・\.git\/ の下と、名前が \. で始まる部分のあるパスは読めません/;
  const OUT = /作業フォルダの中のファイルだけを読めます/;
  const cases = [
    ['raw/台帳.txt', RAW],
    ['./raw/台帳.txt', RAW],
    ['RAW/台帳.txt', RAW],
    ['Raw/台帳.txt', RAW],
    ['raw\\台帳.txt', RAW],
    ['公告/../raw/台帳.txt', RAW],
    ['公告\\..\\raw\\台帳.txt', RAW],
    ['工事A/raw/台帳.txt', RAW],
    [path.join(dir, 'raw', '台帳.txt'), RAW],
    ['raw', RAW],
    ['../' + path.basename(dir) + '-外.txt', OUT],
    [dir + '-外.txt', OUT],
    ['../../package.json', OUT],
    ['/etc/hostname.txt', OUT],
    ['.', OUT],
    ['secrets/a.txt', HIDDEN],
    ['Secrets/a.txt', HIDDEN],
    ['工事A/secrets/a.json', HIDDEN],
    ['.claude/settings.json', HIDDEN],
    ['.CLAUDE/settings.json', HIDDEN],
    ['.git/note.txt', HIDDEN],
    ['.GIT/note.txt', HIDDEN],
    ['.env.txt', HIDDEN],
    ['公告/.隠し/a.md', HIDDEN],
  ];
  for (const [p, re] of cases) assert.match(refused(await call(dir, { data: DATA, files: [p] }), p), re, p);
});

test('断る: 断る所は、ファイルがあっても無くても同じ文で、あるかどうかが返事から分からない', async (t) => {
  const dir = work(t);
  for (const [there, none] of [['raw/台帳.txt', 'raw/無い.txt'], ['.claude/settings.json', '.claude/無い.json'], ['secrets/a.txt', 'secrets/無い.txt']]) {
    assert.equal(refused(await call(dir, { data: DATA, files: [there] }), there), refused(await call(dir, { data: DATA, files: [none] }), none));
  }
});

test('断る: 読めない原文が1つでもあれば、ほかの原文があっても全体を断る', async (t) => {
  const dir = work(t);
  assert.match(refused(await call(dir, { data: DATA, files: [FILES[0], 'raw/台帳.txt'] }), 'raw'), /raw\/ の書類/);
  assert.match(refused(await call(dir, { data: DATA, files: [FILES[0], '公告/無い.md'] }), '無い'), /ファイルがありません: 公告\/無い\.md/);
});

test('リンク: 実体で確かめ、外・raw/・断る所へ出るリンクを断る。中の公告へのリンクは読む', async (t) => {
  const dir = work(t);
  write(path.dirname(dir), path.basename(dir) + '-外.txt', COMPANY);
  t.after(() => fs.rmSync(dir + '-外.txt', { force: true }));
  const made = linked(t, () => {
    fs.symlinkSync(path.join(dir, 'raw', '台帳.txt'), path.join(dir, '公告へ見せかけ.txt'));
    fs.symlinkSync(path.join(dir, 'raw'), path.join(dir, '別名'));
    fs.symlinkSync(dir + '-外.txt', path.join(dir, '外へ.txt'));
    fs.symlinkSync(path.join(dir, 'secrets', 'a.txt'), path.join(dir, '鍵.txt'));
    fs.symlinkSync(path.join(dir, '.claude', 'settings.json'), path.join(dir, '設定.json'));
    fs.symlinkSync(path.join(dir, '公告', '架空公告.md'), path.join(dir, '本物へ.md'));
  });
  if (!made) return;
  assert.match(refused(await call(dir, { data: DATA, files: ['公告へ見せかけ.txt'] }), 'a'), /raw\/ の書類/);
  assert.match(refused(await call(dir, { data: DATA, files: ['別名/台帳.txt'] }), 'b'), /raw\/ の書類/);
  assert.match(refused(await call(dir, { data: DATA, files: ['外へ.txt'] }), 'c'), /作業フォルダの中/);
  assert.match(refused(await call(dir, { data: DATA, files: ['鍵.txt'] }), 'd'), /secrets\//);
  assert.match(refused(await call(dir, { data: DATA, files: ['設定.json'] }), 'e'), /secrets\//);
  const r = await call(dir, { data: DATA, files: ['本物へ.md'] });
  assert.equal(r.result.isError, false);
});

test('リンク: 深い階層の断る所と . で始まるファイルへのリンクも、実体のパスの部分で断る', async (t) => {
  const dir = work(t);
  const links = [
    ['深い台帳.txt', '工事A/raw/台帳.txt', /raw\/ の書類/],
    ['深い鍵.json', '工事A/secrets/a.json', /secrets\//],
    ['隠しへ.md', '公告/.隠し/a.md', /secrets\//],
    ['点の名前へ.txt', '.env.txt', /secrets\//],
  ];
  if (!linked(t, () => { for (const [link, to] of links) fs.symlinkSync(path.join(dir, ...to.split('/')), path.join(dir, link)); })) return;
  for (const [link, , re] of links) assert.match(refused(await call(dir, { data: DATA, files: [link] }), link), re, link);
});

test('リンク: raw/ そのものが作業フォルダの中の別のフォルダへのリンクのとき、実体の側のパスも断る', async (t) => {
  fs.mkdirSync(path.join(ROOT, 'tmp'), { recursive: true });
  const dir = fs.mkdtempSync(path.join(ROOT, 'tmp', 'f76a-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  write(dir, '書類/会社/台帳.txt', COMPANY);
  write(dir, '書類/金庫/a.txt', COMPANY);
  const made = linked(t, () => {
    fs.symlinkSync(path.join(dir, '書類', '会社'), path.join(dir, 'raw'));
    fs.symlinkSync(path.join(dir, '書類', '金庫'), path.join(dir, 'secrets'));
  });
  if (!made) return;
  assert.match(refused(await call(dir, { data: DATA, files: ['書類/会社/台帳.txt'] }), 'raw'), /raw\/ の書類/);
  assert.match(refused(await call(dir, { data: DATA, files: ['書類/金庫/a.txt'] }), 'secrets'), /secrets\//);
});

test('リンク: 作業フォルダそのものがリンクの先でも読め、raw/ は断る', async (t) => {
  const dir = work(t);
  const link = dir + '-リンク';
  if (!linked(t, () => fs.symlinkSync(dir, link))) return;
  t.after(() => fs.rmSync(link, { force: true }));
  assert.equal((await call(link, { data: DATA, files: FILES })).result.isError, false);
  assert.match(refused(await call(link, { data: DATA, files: ['raw/台帳.txt'] }), 'raw'), /raw\/ の書類/);
});

test('作業フォルダの名前: raw/・secrets/ の中と .claude・.git そのものは断り、. で始まるフォルダの下は読む', async (t) => {
  const dir = work(t);
  const notice = async (rel) => {
    const inner = path.join(dir, rel);
    for (const f of NOTICES) write(inner, '公告/' + f, read(SAMPLE + f));
    return call(inner, { data: DATA, files: FILES });
  };
  // worktree は .claude/ の下に置かれるので、.claude の下の作業フォルダは読む
  assert.equal((await notice('.隠し/作業')).result.isError, false);
  assert.equal((await notice('.claude/worktrees/作業')).result.isError, false);
  assert.match(refused(await notice('raw/作業'), 'raw/作業'), /raw\/ の書類/);
  assert.match(refused(await notice('RAW'), 'RAW'), /raw\/ の書類/);
  assert.match(refused(await notice('secrets/作業'), 'secrets/作業'), /secrets\//);
  assert.match(refused(await notice('.claude'), '.claude'), /secrets\//);
  assert.match(refused(await notice('.git'), '.git'), /secrets\//);
});

test('対応表と辞書: MASK_MAP・MASK_DICT のファイルは raw/ の外でも断る。指定が空なら断らない', async (t) => {
  const dir = work(t);
  write(dir, '対応表.json', JSON.stringify({ 甲山建設株式会社: '〔会社名1〕' }));
  const saved = { map: process.env.MASK_MAP, dict: process.env.MASK_DICT };
  t.after(() => {
    for (const [k, v] of [['MASK_MAP', saved.map], ['MASK_DICT', saved.dict]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  });
  for (const k of ['MASK_MAP', 'MASK_DICT']) {
    delete process.env.MASK_MAP;
    delete process.env.MASK_DICT;
    process.env[k] = path.join(dir, '対応表.json');
    assert.match(refused(await call(dir, { data: DATA, files: ['対応表.json'] }), k), /MASK_MAP・MASK_DICT のファイルは読めません/, k);
    assert.equal((await call(dir, { data: DATA, files: FILES })).result.isError, false, k);
  }
  process.env.MASK_MAP = '';
  delete process.env.MASK_DICT;
  assert.equal((await call(dir, { data: DATA, files: ['対応表.json'] })).result.isError, false);
});

test('空の原文と files の本数: 空のファイルは断り(「公告に書いていない」と言わない)、51 ファイルからは断る', async (t) => {
  const dir = work(t);
  write(dir, '公告/空.txt', '');
  write(dir, '公告/空白.txt', ' \n\u3000\n');
  for (const f of ['公告/空.txt', '公告/空白.txt']) assert.match(refused(await call(dir, { data: DATA, files: [f] }), f), /: 中身がありません/, f);
  assert.match(refused(await call(dir, { data: DATA, files: [FILES[0], '公告/空.txt'] }), '混ぜる'), /中身がありません/);
  assert.equal((await call(dir, { data: DATA, files: Array(50).fill(FILES[0]) })).result.isError, false);
  assert.match(refused(await call(dir, { data: DATA, files: Array(51).fill(FILES[0]) }), '51'), /50 ファイルまで/);
});

test('ハードリンク: 実体のパスでは見分けられないので、開いたファイルのリンクの数で断る(F83b1)', async (t) => {
  const dir = work(t);
  const data = JSON.stringify({ conditions: [{ key: 'grade', value: '12,345,678', quote: '甲山建設株式会社の内部の控え 12,345,678円' }] });
  if (!linked(t, () => fs.linkSync(path.join(dir, 'raw', '台帳.txt'), path.join(dir, '写し.txt')))) return;
  assert.match(refused(await call(dir, { data, files: ['写し.txt'] }), 'ハードリンク'), /ハードリンク.*写し\.txt$/);
});

test('読まないパスの字に似た名前は断らない(部分の名前で見る)', async (t) => {
  const dir = work(t);
  for (const f of ['raw.txt', 'rawdata/公告.md', 'secrets.md', '公告/a.b/公告.md', 'draw/公告.md']) {
    write(dir, f, read(SAMPLE + NOTICES[0]));
    assert.equal((await call(dir, { data: DATA, files: [f] })).result.isError, false, f);
  }
});

test('原文の読み方: 無い・フォルダ・文でない形・大きい・NUL・文字で読めないファイルは、どれか分かる文で断る', async (t) => {
  const dir = work(t);
  write(dir, '公告/図.pdf', 'x');
  write(dir, '公告/大きい.txt', Buffer.alloc(1024 * 1024 + 1, 0x61));
  write(dir, '公告/ちょうど.txt', Buffer.alloc(1024 * 1024, 0x61));
  write(dir, '公告/nul.txt', 'a\u0000b');
  write(dir, '公告/壊れ.txt', Buffer.from([0x81]));
  const cases = [
    ['公告/無い.md', /^ファイルがありません: 公告\/無い\.md$/],
    ['公告', /^ファイルではありません: 公告$/],
    ['公告/図.pdf', /読めるのは文のファイル.*: 公告\/図\.pdf$/],
    ['公告/大きい.txt', /1MB まで.*公告\/大きい\.txt$/],
    ['公告/nul.txt', /^公告\/nul\.txt: 文のファイルではないようです/],
    ['公告/壊れ.txt', /^公告\/壊れ\.txt: 文字のファイルとして読めません/],
  ];
  for (const [p, re] of cases) assert.match(refused(await call(dir, { data: DATA, files: [p] }), p), re, p);
  assert.equal((await call(dir, { data: DATA, files: ['公告/ちょうど.txt'] })).result.isError, false);
});

// Node は Shift_JIS に encode できないので、decoder を逆に引いた表でバイト列を作る(mcp-shift-jis.test.mjs と同じ)
function encodeSjis(text) {
  const decoder = new TextDecoder('shift_jis', { fatal: true });
  const table = new Map();
  for (let lead = 0x81; lead <= 0xfc; lead += 1) {
    if (lead >= 0xa0 && lead <= 0xdf) continue;
    for (let trail = 0x40; trail <= 0xfc; trail += 1) {
      if (trail === 0x7f) continue;
      try {
        const ch = decoder.decode(Uint8Array.from([lead, trail]));
        if (!table.has(ch)) table.set(ch, [lead, trail]);
      } catch { /* 無い組 */ }
    }
  }
  return Buffer.from([...text].flatMap((ch) => (ch.codePointAt(0) < 0x80 ? [ch.codePointAt(0)] : table.get(ch))));
}

test('Shift_JIS の公告: 道具は読める。CLI のように UTF-8 として読むと同じ結果にならない(manual の注意)', async (t) => {
  const dir = work(t);
  const notice = '工事名: 架空町 ためし川 護岸補修工事\n工事場所: 架空県こころみ町 地内\n';
  const bytes = encodeSjis(notice);
  write(dir, '公告/sjis.txt', bytes);
  const data = { conditions: [{ key: 'work-name', value: '架空町 ためし川 護岸補修工事', quote: '工事名: 架空町 ためし川 護岸補修工事' }] };
  const r = await call(dir, { data: JSON.stringify(data), files: ['公告/sjis.txt'] });
  assert.equal(r.result.isError, false);
  const tool = JSON.parse(r.result.content[1].text);
  assert.equal(tool.removed.length, 0);
  assert.equal(r.result.content[1].text, JSON.stringify(checkConditions(data, [{ file: 'sjis.txt', text: notice }]), null, 2) + '\n');
  const cli = checkConditions(data, [{ file: 'sjis.txt', text: bytes.toString('utf8') }]);
  assert.equal(cli.removed.length, 1);
});

test('壊れた data・files: 投げずに断りの文で返す', async (t) => {
  const dir = work(t);
  const broken = [
    [undefined, /data がありません/], ['', /data がありません/], [' \n', /data がありません/], [3, /data がありません/], [{ conditions: [] }, /data がありません/],
    ['{', /JSON として読めません/], ['架空の文', /JSON として読めません/],
    ['null', /conditions の配列がありません/], ['[]', /conditions の配列がありません/], ['3', /conditions の配列がありません/],
    ['"文"', /conditions の配列がありません/], ['{}', /conditions の配列がありません/], ['{"conditions":"文"}', /conditions の配列がありません/],
    ['{"conditions":[],"notes":"文"}', /拾った条件を照らせませんでした/],
  ];
  for (const [data, re] of broken) assert.match(refused(await call(dir, { data, files: FILES }), String(data)), re, String(data));
  for (const files of [undefined, [], '公告/架空公告.md', [3], [''], ['  '], [FILES[0], null]]) {
    assert.match(refused(await call(dir, { data: DATA, files }), String(files)), /files がありません/, String(files));
  }
  assert.match(refused(await call(dir, undefined), 'undefined'), /data がありません/);
});

test('場所(リポジトリ): 既定の場所と toolDir がリポジトリの直下のどちらでも plugin/ の下で解ける', async (t) => {
  const dir = work(t);
  const a = await checkConditionsFiles(dir, DATA, FILES);
  const b = await checkConditionsFiles(dir, DATA, FILES, { toolDir: ROOT });
  assert.deepEqual(a, b);
  assert.equal(a.json, read(SAMPLE + '画面に入れる条件.json'));
});

test('場所(入れた後の写し): tmp/ に写した plugin の直下の skills/ で解け、写しの部品を使う', async (t) => {
  const dir = work(t);
  const a = await installed(t);
  const r = await call(dir, { data: DATA, files: FILES }, a.handleMessage);
  assert.equal(r.result.isError, false);
  assert.equal(r.result.content[1].text, read(SAMPLE + '画面に入れる条件.json'));
  // 写しの部品の文を変えると返事が変わるので、リポジトリの部品を読んでいない
  const script = path.join('skills', 'bid-intake', 'scripts', 'check-conditions.mjs');
  const b = await installed(t, (d) => {
    const p = path.join(d, script);
    fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace('拾った値の候補です。', '写しの部品の文です。'));
  });
  const reply = await call(dir, { data: DATA, files: FILES }, b.handleMessage);
  assert.ok(reply.result.content[0].text.includes('写しの部品の文です。'));
});

test('どちらの場所にも無いときは、投げずに「照らせない」と返し、tools/list は落ちない', async (t) => {
  const dir = work(t);
  const { handleMessage: handle } = await installed(t, (d) => fs.rmSync(path.join(d, 'skills', 'bid-intake', 'scripts'), { recursive: true }));
  const list = await handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, { root: dir });
  assert.equal(list.result.tools.length, 4);
  assert.match(refused(await call(dir, { data: DATA, files: FILES }, handle), '無い'), /^照らせない: .*どの値も照らしていません/);
});

test('SKILL.md: 手順5 は道具で、Bash の命令の行が無い。手順7 に --out の1行と Bash が使えないときの文がある', () => {
  const skill = read('plugin/skills/bid-intake/SKILL.md');
  const steps = skill.split('## 手順')[1].split('\n## ')[0];
  const step = (n) => steps.split(/^(?=\d+\. )/m).find((s) => s.startsWith(n + '. '));
  assert.ok(step(5).includes('`check_conditions`'));
  assert.ok(step(5).includes('`data`') && step(5).includes('`files`'));
  assert.ok(step(5).includes('作業フォルダの外'));
  assert.ok(step(2).includes('パスを付けず、名前だけ'));
  assert.ok(!step(5).split('\n').some((l) => l.trim().startsWith('node ')));
  assert.ok(!step(5).includes('--out'));
  const seven = step(7);
  const cli = seven.split('\n').filter((l) => l.trim().startsWith('node '));
  assert.equal(cli.length, 1);
  assert.ok(cli[0].includes('scripts/check-conditions.mjs') && cli[0].includes('--out'));
  assert.ok(seven.includes('Bash が使えないとき'));
  assert.ok(seven.includes('2つ目の返事'));
  assert.equal(skill.split('\n').filter((l) => l.trim().startsWith('node ')).length, 1, 'node の行は手順7 の1つだけ');
  // 説明の「スクリプト」は道具の名前に直した
  const description = skill.split('---')[1];
  assert.ok(description.includes('check_conditions'));
  assert.ok(!skill.includes('スクリプト'));
});

test('文書: plugin.json・overview の4列の行・README と評価.md の --allow-tools・manual の CLI と Shift_JIS の注意', () => {
  const m = JSON.parse(read('plugin/.claude-plugin/plugin.json'));
  assert.ok(m.description.includes('check_conditions'));
  assert.equal(m.version, '0.2.0');
  const overview = read('docs/overview.md').split('\n');
  const rows = overview.filter((l) => l.startsWith('| MCP'));
  assert.deepEqual(rows.map((r) => /^\| MCP `(\w+)`/.exec(r)[1]), ['read_masked', 'list_masked', 'check_articles', 'check_conditions']);
  for (const r of rows) assert.equal(r.split(' | ').length, 4, r.slice(0, 40));
  assert.ok(rows[3].includes('tests/unit/check-conditions-tool.test.mjs'));
  const tools = ['read_masked', 'list_masked', 'check_articles', 'check_conditions'].map((n) => 'mcp__plugin_motouke-navi-guard_masked-files__' + n);
  for (const f of ['README.md', 'docs/評価.md']) {
    const line = read(f).split('\n').find((l) => l.includes('--allow-tools mcp__'));
    assert.ok(line, f);
    for (const t of tools) assert.ok(line.includes(t), f + ' ' + t);
  }
  assert.ok(read('README.md').includes('`--allow-tools` の4つの道具'));
  const manual = read('docs/manual.md').split('公告から条件を拾う(Skill `bid-intake`)')[1].split('\n## ')[0];
  assert.ok(manual.includes('`check_conditions`'));
  assert.ok(manual.includes('端末で使うとき'));
  assert.ok(manual.split('\n').some((l) => l.includes('Shift_JIS') && l.includes('CLI')));
  assert.ok(read('CHANGELOG.md').includes('- F76a: '));
});

test('写し: plugin/mcp/masked-files.mjs は元と同じ', () => {
  assert.deepEqual(staleCopies(ROOT), []);
});

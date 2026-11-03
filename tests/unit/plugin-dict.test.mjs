// F28c の単体の試験: プラグインの道具 read_masked が、画面で書き出した辞書のファイル(mask-dict)を MASK_DICT で読む(値はすべて架空)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { handleMessage, readMaskedWithCheck } from '../../integration/claude-code/mcp/masked-files.mjs';
import { createMasker } from '../../src/mask/core.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PLUGIN = path.join(ROOT, 'plugin');

// 規則だけでは見つからない語(文脈の無い人名・現場名)
const PERSON = '架野花子';
const SITE = 'ためし台みほん橋';
const TEXT = `${PERSON}の件。${SITE}の進み具合。元請 乙川工業株式会社(架空)。電話 03-0000-0000。`;

function setup(name) {
  const root = path.join(ROOT, 'tmp', name);
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(path.join(root, 'raw'), { recursive: true });
  fs.writeFileSync(path.join(root, 'raw', 'a.txt'), TEXT);
  return root;
}

// 画面の「辞書を書き出す」と同じ部品(core.mjs の exportDict)で辞書のファイルを作る
function writeDict(root, terms) {
  const m = createMasker();
  for (const [word, kind] of terms) m.addTerm(word, kind);
  const p = path.join(root, '置き換えの辞書_example.json');
  fs.writeFileSync(p, m.exportDict());
  return p;
}

const call = (root, opts) => handleMessage({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'read_masked', arguments: { path: 'raw/a.txt' } } }, { root, mapPath: null, ...opts });

test('辞書を渡すと、足した語が記号に置き換わる。渡さなければ残る(限界)', async () => {
  const root = setup('f28c-basic');
  try {
    const without = (await call(root, { dictPath: null })).result;
    assert.equal(without.isError, false);
    assert.ok(without.content[0].text.includes(PERSON) && without.content[0].text.includes(SITE), '辞書なしでは残る前提が崩れた');
    const dictPath = writeDict(root, [[PERSON, 'person'], [SITE, 'site']]);
    const r = (await call(root, { dictPath })).result;
    assert.equal(r.isError, false);
    const text = r.content[0].text;
    for (const w of [PERSON, SITE, '乙川工業株式会社', '03-0000-0000']) assert.ok(!text.includes(w), w);
    assert.match(text, /〔人名1〕の件。/);
    assert.match(text, /〔現場名1〕の進み具合/);
    // 2つ目の文(見本の語の確かめ、F28a)はそのまま付き、辞書の語は入らない
    assert.equal(r.content.length, 2);
    assert.match(r.content[1].text, /確かめのための見本/);
    assert.ok(!r.content[1].text.includes(PERSON) && !r.content[1].text.includes(SITE));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('環境変数 MASK_DICT を既定で読む', () => {
  const root = setup('f28c-env');
  const saved = process.env.MASK_DICT;
  try {
    process.env.MASK_DICT = writeDict(root, [[PERSON, 'person']]);
    const { masked } = readMaskedWithCheck(root, 'raw/a.txt', { mapPath: null });
    assert.ok(!masked.includes(PERSON), masked);
    assert.ok(masked.includes(SITE), '辞書に無い語は今までどおり');
    delete process.env.MASK_DICT;
    assert.ok(readMaskedWithCheck(root, 'raw/a.txt', { mapPath: null }).masked.includes(PERSON));
  } finally {
    if (saved === undefined) delete process.env.MASK_DICT; else process.env.MASK_DICT = saved;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('MASK_MAP と両方: 対応表の記号はそのまま使い、辞書の語を加える', async () => {
  const root = setup('f28c-both');
  try {
    const m = createMasker();
    m.addTerm(PERSON, 'person');
    m.mask(`甲野 次郎 ${PERSON}`);
    m.addTerm('甲野 次郎', 'person');
    m.mask('甲野 次郎');
    const mapPath = path.join(root, 'map.json');
    fs.writeFileSync(mapPath, m.exportMap());
    const token = m.mask(PERSON).masked;
    const dictPath = writeDict(root, [[SITE, 'site']]);
    const text = (await call(root, { mapPath, dictPath })).result.content[0].text;
    assert.ok(text.startsWith(token + 'の件。'), text);
    assert.ok(!text.includes(SITE) && !text.includes(PERSON), text);
    assert.match(text, /〔現場名\d+〕の進み具合/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('読めない辞書は断り、返す文にも辞書の語・ファイルの名前を出さない。置き換えずに中身を返すこともしない', async () => {
  const root = setup('f28c-bad');
  try {
    const secretDir = path.join(root, `${PERSON}の辞書`);
    fs.mkdirSync(secretDir);
    const cases = {
      無いファイル: path.join(secretDir, 'none.json'),
      フォルダ: secretDir,
    };
    const put = (name, content) => { const p = path.join(secretDir, name); fs.writeFileSync(p, content); return p; };
    // 同じ語が違う種類で重なる(core.mjs の理由の文には語が入る)
    cases.重なり = put('dup.json', JSON.stringify({ format: 'mask-dict', version: 1, terms: [{ word: PERSON, kind: 'person' }, { word: PERSON, kind: 'site' }] }));
    // 対応表のファイルを辞書として渡した
    const m = createMasker();
    m.addTerm(PERSON, 'person');
    m.mask(PERSON);
    cases.対応表 = put('map.json', m.exportMap());
    cases.JSONでない = put('broken.json', `${PERSON},person`);
    cases.知らない種類 = put('kind.json', JSON.stringify({ format: 'mask-dict', version: 1, terms: [{ word: PERSON, kind: 'secret' }] }));
    cases.大きすぎる = put('big.json', JSON.stringify({ format: 'mask-dict', version: 1, terms: [{ word: PERSON, kind: 'person' }], pad: 'x'.repeat(1024 * 1024) }));
    for (const [name, dictPath] of Object.entries(cases)) {
      const r = (await call(root, { dictPath })).result;
      assert.equal(r.isError, true, name);
      assert.equal(r.content.length, 1, name);
      const msg = r.content[0].text;
      assert.match(msg, /MASK_DICT/, name);
      assert.ok(!msg.includes(PERSON) && !msg.includes(SITE) && !msg.includes('乙川') && !msg.includes(secretDir), `${name}: ${msg}`);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// 道具の中で標準出力・標準エラー・console に書かれたものを集める(init は子のプロセスを許さないので、同じプロセスで確かめる)
async function captureOutput(fn) {
  const logged = [];
  const saved = { out: process.stdout.write, err: process.stderr.write, console: {} };
  process.stdout.write = function (chunk, ...rest) { logged.push(String(chunk)); return saved.out.call(this, chunk, ...rest); };
  process.stderr.write = function (chunk, ...rest) { logged.push(String(chunk)); return saved.err.call(this, chunk, ...rest); };
  for (const k of ['log', 'info', 'warn', 'error', 'debug']) {
    saved.console[k] = console[k];
    console[k] = (...a) => { logged.push(a.map(String).join(' ')); };
  }
  try {
    return { value: await fn(), logged: logged.join('\n') };
  } finally {
    process.stdout.write = saved.out;
    process.stderr.write = saved.err;
    for (const k of Object.keys(saved.console)) console[k] = saved.console[k];
  }
}

test('plugin/ の写し(MASK_TOOL_DIR はプラグインのフォルダ)が MASK_DICT の辞書の語を置き換える。辞書の語は標準出力・標準エラー・console に出ない', async () => {
  const root = setup('f28c-plugin');
  const saved = { tool: process.env.MASK_TOOL_DIR, dict: process.env.MASK_DICT };
  try {
    const dictPath = writeDict(root, [[PERSON, 'person'], [SITE, 'site']]);
    process.env.MASK_TOOL_DIR = PLUGIN;
    const plugin = await import(pathToFileURL(path.join(PLUGIN, 'mcp', 'masked-files.mjs')).href + '?f28c');
    const read = { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'read_masked', arguments: { path: 'raw/a.txt' } } };
    process.env.MASK_DICT = dictPath;
    const { value: res, logged } = await captureOutput(() => plugin.handleMessage(read, { root, mapPath: '' }));
    assert.equal(res.result.isError, false);
    assert.match(res.result.content[0].text, /〔人名1〕の件。〔現場名1〕の進み具合/);
    for (const w of [PERSON, SITE]) assert.ok(!logged.includes(w), `出力に ${w}`);
    // 壊れた辞書でも、語は出力に出ない
    const bad = path.join(root, 'bad.json');
    fs.writeFileSync(bad, JSON.stringify({ format: 'mask-dict', version: 1, terms: [{ word: PERSON, kind: 'person' }, { word: PERSON, kind: 'site' }] }));
    process.env.MASK_DICT = bad;
    const b = await captureOutput(() => plugin.handleMessage(read, { root, mapPath: '' }));
    assert.equal(b.value.result.isError, true);
    assert.ok(!b.logged.includes(PERSON) && !b.value.result.content[0].text.includes(PERSON));
    // 空の MASK_DICT(.mcp.json の "${MASK_DICT:-}" が空に展開されたとき)は渡していないのと同じ
    process.env.MASK_DICT = '';
    assert.ok((await plugin.handleMessage(read, { root, mapPath: '' })).result.content[0].text.includes(PERSON));
  } finally {
    for (const [k, v] of [['MASK_TOOL_DIR', saved.tool], ['MASK_DICT', saved.dict]]) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
});

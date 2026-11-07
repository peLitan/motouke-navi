// F56a の単体の試験: MCP の道具 check_articles(masked-files)と、CLI と共有する formatResults。指摘の文はすべて架空
// init の試験は子のプロセスを起こせないので、handleMessage を読み込んで確かめる。CLI の文は formatResults の決まった文で見る
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { handleMessage, TOOLS, SERVER_INFO, checkArticlesText } from '../../integration/claude-code/mcp/masked-files.mjs';
import { checkArticles, formatResults } from '../../plugin/skills/construction-check/scripts/check-articles.mjs';
import { staleCopies } from '../../scripts/sync-plugin.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PLUGIN = path.join(ROOT, 'plugin');
const SOURCES_IN_COPY = path.join('skills', 'construction-check', 'reference', 'sources');
const MIXED = [
  '- 何が: 〔会社名2〕の健康保険等の欄。担当の甲村(架空)',
  '- 根拠: 建設業法第24条の8第1項、建設業法施行規則第14条の2第1項第3号ハ',
  '- 根拠: 建設業法第99条、建設業法第24条の8第9項',
  '- 根拠: 法第3条',
].join('\n');

const call = (handler, args, opts = {}) => handler({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'check_articles', arguments: args } }, opts);

// plugin/ を tmp/ に写す(入れたときと同じ)。change で写しを変えてから、その写しの道具を読み込む
async function installed(t, change = () => {}) {
  fs.mkdirSync(path.join(ROOT, 'tmp'), { recursive: true });
  const dir = fs.mkdtempSync(path.join(ROOT, 'tmp', 'f56a-'));
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

test('tools/list: read_masked・list_masked・check_articles・check_conditions の4つ。check_articles の引数は text だけ', async () => {
  const list = await handleMessage({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, { root: ROOT });
  assert.deepEqual(list.result.tools.map((t) => t.name), ['read_masked', 'list_masked', 'check_articles', 'check_conditions']);
  const tool = TOOLS.find((t) => t.name === 'check_articles');
  assert.deepEqual(Object.keys(tool.inputSchema.properties), ['text']);
  assert.deepEqual(tool.inputSchema.required, ['text']);
  assert.equal(tool.inputSchema.additionalProperties, false);
});

test('formatResults: CLI と同じ行の形で、条番号ごとの行と数の行を返す。checkArticles の返り値でも results の配列でも同じ', () => {
  const checked = checkArticles(MIXED);
  const text = formatResults(checked);
  assert.equal(text, formatResults(checked.results));
  assert.deepEqual(text.split('\n').slice(0, 2), [
    'ある\t建設業法 第24条の8第1項\t建設業法 第24条の8（施工体制台帳及び施工体系図の作成等）',
    'ある\t建設業法施行規則 第14条の2第1項第3号ハ\t建設業法施行規則 第14条の2（施工体制台帳の記載事項等）',
  ]);
  assert.equal(text.split('\n').at(-1), '条番号 5 件: ある 2・無い 2・確かめられない 1');
  assert.equal(formatResults(checkArticles('条番号の無い文(架空)')), '条番号が見つからなかった(確かめたものは無い)\n条番号 0 件: ある 0・無い 0・確かめられない 0');
});

test('check_articles: 返事は formatResults(checkArticles(text)) と同じ文で、「無い」があっても道具の誤りにしない', async () => {
  const r = await call(handleMessage, { text: MIXED }, { root: ROOT });
  assert.equal(r.error, undefined);
  assert.equal(r.result.isError, false);
  assert.deepEqual(r.result.content, [{ type: 'text', text: formatResults(checkArticles(MIXED)) }]);
});

test('check_articles: JSON の文は CLI と同じく中の文字列を見る', async () => {
  const text = JSON.stringify({ a: '建設業法第26条第3項', b: ['入札契約適正化法第15条第1項'] });
  const r = await call(handleMessage, { text }, { root: ROOT });
  assert.equal(r.result.content[0].text, formatResults(checkArticles(text)));
  assert.match(r.result.content[0].text, /条番号 2 件: ある 2/);
});

test('check_articles: 返事に原文の全文も指摘の文も入らない(条番号の見出しと数だけ)', async () => {
  const r = await call(handleMessage, { text: MIXED }, { root: ROOT });
  const reply = r.result.content[0].text;
  const law = fs.readFileSync(path.join(PLUGIN, SOURCES_IN_COPY, 'law-kensetsu-24_8.txt'), 'utf8');
  const body = law.replace(/\s+/g, '').slice(100, 130);
  assert.equal(body.length, 30);
  assert.ok(!reply.replace(/\s+/g, '').includes(body));
  for (const w of ['〔会社名2〕', '甲村', '健康保険等']) assert.ok(!reply.includes(w), w);
});

test('check_articles: text が無い・空・文字列でないときは、投げずに道具の誤りとして返す', async () => {
  for (const args of [{}, { text: '' }, { text: ' \n' }, { text: 3 }, undefined]) {
    const r = await call(handleMessage, args, { root: ROOT });
    assert.equal(r.error, undefined);
    assert.equal(r.result.isError, true);
    assert.match(r.result.content[0].text, /text がありません/);
  }
});

test('場所(リポジトリ): MASK_TOOL_DIR 無しの既定の場所で、plugin/ の下の原文で解ける', async () => {
  assert.equal(await checkArticlesText('建設業法第24条の8第1項'), formatResults(checkArticles('建設業法第24条の8第1項')));
  assert.equal(await checkArticlesText('建設業法第24条の8第1項', { toolDir: ROOT }), formatResults(checkArticles('建設業法第24条の8第1項')));
});

test('場所(入れた後の写し): plugin/ の写しの直下の skills/ で解け、原文も写しの物を読む', async (t) => {
  const a = await installed(t);
  const r = await call(a.handleMessage, { text: MIXED }, { root: a.dir });
  assert.equal(r.result.isError, false);
  assert.equal(r.result.content[0].text, formatResults(checkArticles(MIXED)));
  // 写しの原文を1つ外すと返事が変わるので、リポジトリの原文を読んでいない
  const b = await installed(t, (dir) => fs.rmSync(path.join(dir, SOURCES_IN_COPY, 'law-kisoku-14_2.txt')));
  const reply = (await call(b.handleMessage, { text: '建設業法施行規則第14条の2第1項' }, { root: b.dir })).result.content[0].text;
  assert.match(reply, /^無い\t建設業法施行規則 第14条の2第1項\t/);
});

test('どちらの場所にも無いときは、投げずに「確かめられない」と返し、どの条も「無い」と言わない', async (t) => {
  const cases = {
    部品が無い: (dir) => fs.rmSync(path.join(dir, 'skills', 'construction-check', 'scripts'), { recursive: true }),
    原文の一覧が無い: (dir) => fs.rmSync(path.join(dir, SOURCES_IN_COPY, 'index.json')),
    原文のファイルが無い: (dir) => {
      const sources = path.join(dir, SOURCES_IN_COPY);
      for (const f of fs.readdirSync(sources)) if (f.startsWith('law-')) fs.rmSync(path.join(sources, f));
    },
  };
  for (const [name, change] of Object.entries(cases)) {
    const { dir, handleMessage: handle } = await installed(t, change);
    const r = await call(handle, { text: '建設業法第3条' }, { root: dir });
    assert.equal(r.error, undefined, name);
    assert.equal(r.result.isError, true, name);
    assert.match(r.result.content[0].text, /^確かめられない: .*どの条番号も確かめていません/, name);
    assert.doesNotMatch(r.result.content[0].text, /^無い/m, name);
  }
});

test('版と説明: plugin.json は 0.2.0 で、4つの Skill と4つの道具を挙げ、SERVER_INFO と同じ版。写しは元と同じ', () => {
  const m = JSON.parse(fs.readFileSync(path.join(PLUGIN, '.claude-plugin', 'plugin.json'), 'utf8'));
  assert.equal(m.version, '0.2.0');
  assert.equal(SERVER_INFO.version, m.version);
  const skills = fs.readdirSync(path.join(PLUGIN, 'skills'));
  assert.deepEqual(skills.sort(), ['bid-intake', 'construction-check', 'estimate', 'spec-to-rules']);
  for (const w of [...skills, ...TOOLS.map((t) => t.name)]) assert.ok(m.description.includes(w), w);
  assert.deepEqual(staleCopies(ROOT), []);
});

test('case.yaml: 評価の許す道具に check_articles がある', () => {
  const yaml = fs.readFileSync(path.join(PLUGIN, 'evals', 'E1-trace-masked', 'case.yaml'), 'utf8');
  assert.match(yaml, /allowed_tools:[\s\S]*- mcp__plugin_motouke-navi-guard_masked-files__check_articles\n/);
});

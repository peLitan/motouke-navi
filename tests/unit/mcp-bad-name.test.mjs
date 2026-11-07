// F83b4 の単体の試験: MCP の masked-files が変な入力で落ちないことと、check_conditions の入口の上限。
// init は node の権限の決まりの中で試験を動かし子のプロセスを起こせないので、main に入出力を渡して同じプロセスの中で流す。
// 本物のサーバーの標準入出力での確かめは統括が行う(verify の [統括])。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import * as server from '../../integration/claude-code/mcp/masked-files.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const { handleMessage } = server;

const BAD_NAMES = [{ toString: 1, valueOf: 1 }, { toString: null, valueOf: null }];
const call = (id, name) => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: {} } });
const ping = (id) => ({ jsonrpc: '2.0', id, method: 'ping' });

// main に行を流し、書かれた返事を順に返す。文字列はそのままの行(壊れた JSON を流すため)
async function run(lines, handle) {
  const written = [];
  await server.main({
    handle,
    input: Readable.from(lines.map((l) => (typeof l === 'string' ? l : JSON.stringify(l)) + '\n')),
    output: { write: (s) => { written.push(s); return true; } },
  });
  return written.map((s) => { assert.ok(s.endsWith('\n'), '1行に1通'); return JSON.parse(s); });
}

// 指定の形の通だけ投げ、ほかは本物の handleMessage に渡す
const throwOn = (when) => async (msg) => {
  if (when(msg)) throw new Error('CANARY-INTERNAL-DETAIL');
  return handleMessage(msg);
};

for (const name of [...BAD_NAMES, null, 1, true, [], ['read_masked']]) {
  test(`name が文字でない ${JSON.stringify(name)}: 投げずに「知らない道具です」で返す`, async () => {
    const res = await handleMessage(call(1, name));
    assert.equal(res.error.code, -32602);
    assert.match(res.error.message, /^知らない道具です/);
  });
}

test('name の2つの形を送った後の ping に返事が来る', async () => {
  const replies = await run([call(1, BAD_NAMES[0]), ping(2), call(3, BAD_NAMES[1]), ping(4)]);
  assert.deepEqual(replies.map((r) => r.id), [1, 2, 3, 4]);
  assert.match(replies[0].error.message, /^知らない道具です/);
  assert.match(replies[2].error.message, /^知らない道具です/);
  assert.deepEqual(replies[1].result, {});
  assert.deepEqual(replies[3].result, {});
});

test('文字の知らない名前は今までどおり名前を添える', async () => {
  const res = await handleMessage(call(1, 'no_such_tool'));
  assert.equal(res.error.message, '知らない道具です: no_such_tool');
});

test('handleMessage が投げると -32603 を返し、次の ping に返事が来る', async () => {
  const replies = await run([{ jsonrpc: '2.0', id: 'a', method: 'tools/list' }, ping('b')], throwOn((msg) => msg.method === 'tools/list'));
  assert.deepEqual(replies, [
    { jsonrpc: '2.0', id: 'a', error: { code: -32603, message: 'Internal error' } },
    { jsonrpc: '2.0', id: 'b', result: {} },
  ]);
});

test('例外の中身は返事に出さない', async () => {
  const replies = await run([ping(1)], throwOn(() => true));
  assert.doesNotMatch(JSON.stringify(replies), /CANARY-INTERNAL-DETAIL/);
});

for (const [label, extra] of [['id が無い', {}], ['id が null の', { id: null }]]) {
  test(`${label}壊れた通知: 投げても返事を書かず、次の ping に返事が来る`, async () => {
    const replies = await run([{ jsonrpc: '2.0', method: 'notifications/broken', ...extra }, ping(2)], throwOn((msg) => msg.method === 'notifications/broken'));
    assert.deepEqual(replies, [{ jsonrpc: '2.0', id: 2, result: {} }]);
  });
}

test('name が壊れた id の無い通知に返事が無い', async () => {
  const replies = await run([{ jsonrpc: '2.0', method: 'tools/call', params: { name: BAD_NAMES[0] } }, ping(2)]);
  assert.deepEqual(replies.map((r) => r.id), [2]);
});

test('JSON として読めない行は -32700 を返して次へ進む(今までどおり)', async () => {
  const replies = await run(['{壊れた', '', ping(2)]);
  assert.equal(replies[0].error.code, -32700);
  assert.deepEqual(replies[1], { jsonrpc: '2.0', id: 2, result: {} });
});

// ここから check_conditions の入口の上限。原文は架空の短い文
const FILE = '公告.txt';
const QUOTE_500 = '架'.repeat(500);
const VALUE_200 = '架'.repeat(200);

function work(t) {
  fs.mkdirSync(path.join(ROOT, 'tmp'), { recursive: true });
  const dir = fs.mkdtempSync(path.join(ROOT, 'tmp', 'f83b4-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, FILE), `発注者: ${QUOTE_500}\n`);
  return dir;
}

const conditions = async (root, data, files = [FILE]) => (await handleMessage({
  jsonrpc: '2.0', id: 1, method: 'tools/call',
  params: { name: 'check_conditions', arguments: { data: JSON.stringify(data), files } },
}, { root })).result;
const text = (res) => res.content.map((c) => c.text).join('\n');
const picked = (res) => JSON.parse(res.content[1].text);
const absent = (n) => Array.from({ length: n }, () => ({ key: 'region', absent: true }));
const cond = (over) => ({ key: 'orderer-name', value: '架', quote: '架'.repeat(10), ...over });

test('上限: 条件が 51件で断り、理由と上限の文を返す', async (t) => {
  const res = await conditions(work(t), { conditions: absent(51) });
  assert.equal(res.isError, true);
  assert.match(text(res), /条件が多すぎます.*50件まで/);
  assert.match(text(res), /51件/);
});

test('上限: 条件が 50件ちょうどで通る', async (t) => {
  const res = await conditions(work(t), { conditions: absent(50) });
  assert.equal(res.isError, false, text(res));
});

test('上限: value が 201字で断り、値そのものは返さない', async (t) => {
  const res = await conditions(work(t), { conditions: [cond({ value: 'あ'.repeat(200) + 'い', quote: QUOTE_500 })] });
  assert.equal(res.isError, true);
  assert.match(text(res), /value が長すぎます.*200字まで/);
  assert.doesNotMatch(text(res), /あああ/);
});

test('上限: value が 200字ちょうどで通り、照らされる', async (t) => {
  const res = await conditions(work(t), { conditions: [cond({ value: VALUE_200, quote: QUOTE_500 })] });
  assert.equal(res.isError, false, text(res));
  assert.equal(picked(res).rows.find((r) => r.key === 'orderer-name').value, VALUE_200);
});

test('上限: quote が 501字で断る', async (t) => {
  const res = await conditions(work(t), { conditions: [cond({ quote: QUOTE_500 + '架' })] });
  assert.equal(res.isError, true);
  assert.match(text(res), /quote が長すぎます.*500字まで/);
});

test('上限: quote が 500字ちょうどで通り、原文に見つかる', async (t) => {
  const res = await conditions(work(t), { conditions: [cond({ quote: QUOTE_500 })] });
  assert.equal(res.isError, false, text(res));
  assert.equal(picked(res).rows.find((r) => r.key === 'orderer-name').quote, QUOTE_500);
});

test('上限: 文字でない value・quote でも長さを見る(配列に包んで上限を抜けない)', async (t) => {
  const root = work(t);
  const v = await conditions(root, { conditions: [cond({ value: ['架'.repeat(300)] })] });
  assert.equal(v.isError, true);
  assert.match(text(v), /value が長すぎます/);
  const q = await conditions(root, { conditions: [cond({ quote: ['架'.repeat(600)] })] });
  assert.equal(q.isError, true);
  assert.match(text(q), /quote が長すぎます/);
});

test('上限: 数の value は今までどおり通る', async (t) => {
  const res = await conditions(work(t), { conditions: [cond({ value: 12345 })] });
  assert.equal(res.isError, false, text(res));
});

test('上限: ファイルを開く前に断る(無いファイルでも上限の文になる)', async (t) => {
  const res = await conditions(work(t), { conditions: absent(51) }, ['無い.txt']);
  assert.equal(res.isError, true);
  assert.match(text(res), /条件が多すぎます/);
});

test('上限: notes も同じ上限で断る(notes で上限を抜けない)', async (t) => {
  const root = work(t);
  const notes = (n, quote = '架') => ({ conditions: absent(1), notes: Array.from({ length: n }, () => ({ text: '気づき', quote })) });
  const many = await conditions(root, notes(51));
  assert.equal(many.isError, true);
  assert.match(text(many), /notes の項目が多すぎます.*50件まで/);
  assert.equal((await conditions(root, notes(50))).isError, false);
  const long = await conditions(root, notes(1, '架'.repeat(501)));
  assert.equal(long.isError, true);
  assert.match(text(long), /quote が長すぎます.*500字まで/);
  assert.equal((await conditions(root, notes(1, QUOTE_500))).isError, false);
});

test('上限: 配列でない notes は今までどおり形の文で断る', async (t) => {
  const res = await conditions(work(t), { conditions: absent(1), notes: 'x' });
  assert.equal(res.isError, true);
  assert.match(text(res), /拾った条件を照らせませんでした/);
});

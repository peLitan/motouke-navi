// F12a: 置き換えた後の文だけを Claude の API に送る手元の node のプログラム(条件 F12-1〜F12-6)
// 作るループの中では API を呼ばない。送る関数は模したものに差し替える。
import test from 'node:test';
import assert from 'node:assert/strict';
import { load, readText, indexHtml, scriptsOf, withoutScripts, hasId } from './_helpers.mjs';

const MASKED = [{ name: 'ledger.masked.txt', text: '架空の台帳。会社A の 担当者1 が 現場X を受け持つ。下請け 会社B の主任技術者の欄が空。' }];
const MAP = [{ token: '会社A', original: '甲山建設株式会社', kind: 'company' }, { token: '担当者1', original: '甲野 一郎', kind: 'person' }];
const KEY = 'xxxx-test-key-not-real';
const REPLY = { content: [{ type: 'text', text: JSON.stringify({ candidates: [{ message: '会社B の主任技術者の欄が空', basis: '建設業法 第26条' }] }) }] };

async function mod() { return load('tools/claude-check.mjs'); }

test('置き換え漏れが残っていれば、見せる前・送る前に止める', async () => {
  const { runCheck } = await mod();
  for (const files of [
    [{ name: 'a.txt', text: '架空の台帳。連絡は kono@example.com へ。' }],
    [{ name: 'b.txt', text: '架空の台帳。電話 03-0000-0000。' }],
    [{ name: 'c.txt', text: '架空の台帳。甲山建設株式会社の件。' }],
  ]) {
    let confirmed = 0; let sent = 0;
    const r = await runCheck({ files, map: MAP, env: { ANTHROPIC_API_KEY: KEY }, confirm: async () => { confirmed++; return true; }, send: async () => { sent++; return REPLY; }, log: () => {} });
    assert.equal(r.status, 'blocked', files[0].name);
    assert.ok(Array.isArray(r.leaks) && r.leaks.length > 0);
    assert.equal(confirmed, 0); assert.equal(sent, 0);
  }
});

test('送る中身を全部見せ、人が「送る」を選ばなければ送らない', async () => {
  const { runCheck } = await mod();
  let shown = null; let sent = 0;
  const r = await runCheck({ files: MASKED, map: MAP, env: { ANTHROPIC_API_KEY: KEY }, confirm: async (payload) => { shown = payload; return false; }, send: async () => { sent++; return REPLY; }, log: () => {} });
  assert.equal(r.status, 'cancelled');
  assert.equal(sent, 0);
  assert.ok(JSON.stringify(shown).includes(MASKED[0].text), '送る中身が全部見えていない');
});

test('「送る」を選ぶと1回だけ送り、返事を「AI の候補」として根拠つきで返す。記録に鍵・原文・対応表を残さない', async () => {
  const { runCheck } = await mod();
  const logs = []; const sentPayloads = [];
  const r = await runCheck({ files: MASKED, map: MAP, env: { ANTHROPIC_API_KEY: KEY }, confirm: async () => true, send: async (payload) => { sentPayloads.push(payload); return REPLY; }, log: (...a) => logs.push(a.map(String).join(' ')) });
  assert.equal(r.status, 'done');
  assert.equal(sentPayloads.length, 1);
  const body = JSON.stringify(sentPayloads[0]);
  assert.ok(body.includes(MASKED[0].text));
  for (const e of MAP) assert.ok(!body.includes(e.original), '送る中身に元の語: ' + e.original);
  assert.ok(!body.includes(KEY), '送る中身に鍵');
  assert.equal(r.aiCandidates.length, 1);
  assert.equal(r.aiCandidates[0].label, 'AI の候補');
  assert.ok(r.aiCandidates[0].message && r.aiCandidates[0].basis);
  const all = logs.join('\n');
  assert.ok(!all.includes(KEY));
  for (const e of MAP) assert.ok(!all.includes(e.original), '記録に元の語');
});

test('鍵は環境変数から読む。無ければ分かる言葉で止まる。コードに鍵を書いていない', async () => {
  const { getApiKey } = await mod();
  assert.equal(getApiKey({ ANTHROPIC_API_KEY: KEY }), KEY);
  assert.throws(() => getApiKey({}), Error);
  assert.ok(!/sk-ant-/.test(readText('tools/claude-check.mjs')));
});

test('sendToClaude: Messages API に、鍵を見出しに入れて送る(通信は模す)', async () => {
  const { sendToClaude } = await mod();
  let req = null;
  const fetchImpl = async (url, init) => { req = { url, init }; return { ok: true, status: 200, json: async () => REPLY }; };
  const payload = { model: 'claude-opus-5-5', max_tokens: 2000, messages: [{ role: 'user', content: MASKED[0].text }] };
  const res = await sendToClaude(payload, { apiKey: KEY, fetchImpl });
  assert.deepEqual(res, REPLY);
  assert.equal(req.url, 'https://api.anthropic.com/v1/messages');
  const h = Object.fromEntries(Object.entries(req.init.headers).map(([k, v]) => [k.toLowerCase(), v]));
  assert.equal(h['x-api-key'], KEY);
  assert.ok(h['anthropic-version']);
  assert.deepEqual(JSON.parse(req.init.body), payload);
});

test('画面: AI の候補は、法令の決まりで判定した結果と別の欄に「AI の候補」と付けて出す。画面は通信しないまま', async () => {
  const html = indexHtml();
  assert.ok(hasId(html, 'ai-result') && hasId(html, 'ai-load'));
  assert.ok(hasId(html, 'check-result'));
  assert.ok(withoutScripts(html).includes('AI の候補'));
  const { renderAiCandidates } = await load('src/ui/view.mjs');
  const h = renderAiCandidates([{ label: 'AI の候補', message: '<b>架空</b>の指摘', basis: '建設業法 第26条' }]);
  assert.ok(h.includes('AI の候補') && h.includes('建設業法 第26条') && !h.includes('<b>架空</b>'));
  const code = scriptsOf(html).map((s) => s.code).join('\n');
  assert.ok(!/api\.anthropic\.com/.test(code), '画面に API の送り先がある');
});

test('README に、API に送った内容の扱いを Anthropic の公式ページの URL つきで書いている', () => {
  const md = readText('README.md');
  assert.ok(/https:\/\/[\w.-]*anthropic\.com\/\S+/.test(md), 'Anthropic の公式ページの URL が無い');
  assert.ok(/30日/.test(md) && /学習/.test(md));
});

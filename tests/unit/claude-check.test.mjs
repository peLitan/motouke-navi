// tools/claude-check.mjs と src/ui/ai-app.mjs の単体の試験(値はすべて架空)
import test from 'node:test';
import assert from 'node:assert/strict';
import { findLeaks, parseReply, buildPayload, runCheck, toResultFile } from '../../tools/claude-check.mjs';
import { parseAiResult } from '../../src/ui/ai-app.mjs';

const MAP = [{ token: '〔人名1〕', original: '甲野 一郎', kind: 'person', variants: ['甲野 一郎', '甲野一郎'] }];

test('findLeaks: 空白の違う元の語・許可番号の形も漏れにし、漏れた語そのものは返さない', () => {
  const leaks = findLeaks([{ name: 'x.txt', text: '一行目\n担当は甲野　一郎。\n許可 架空県知事 許可(般-06)第1234号' }], MAP);
  assert.ok(leaks.some((l) => l.kind === 'person' && l.line === 2));
  assert.ok(leaks.some((l) => l.kind === 'license' && l.line === 3));
  assert.ok(!JSON.stringify(leaks).includes('甲野'));
  assert.ok(!JSON.stringify(leaks).includes('1234'));
});

test('findLeaks: 記号だけの文は漏れにしない', () => {
  assert.deepEqual(findLeaks([{ name: 'y.txt', text: '〔会社名1〕の〔人名1〕が〔現場名1〕を受け持つ。' }], MAP), []);
});

test('buildPayload: 対応表を入れず、ファイルの文だけを入れる', () => {
  const p = buildPayload([{ name: 'a.txt', text: '会社A の件' }]);
  assert.equal(p.model, 'claude-opus-5-5');
  assert.ok(!('temperature' in p));
  assert.ok(p.messages[0].content.includes('会社A の件'));
});

test('parseReply: 根拠の無い候補は除き、断り・形違いは Error', () => {
  const r = parseReply({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ candidates: [{ file: 'a', message: 'm1', basis: '建設業法 第26条' }, { file: 'a', message: 'm2', basis: '' }] }) }] });
  assert.equal(r.aiCandidates.length, 1);
  assert.equal(r.aiCandidates[0].label, 'AI の候補');
  assert.equal(r.warnings.length, 1);
  assert.throws(() => parseReply({ stop_reason: 'refusal', content: [] }), Error);
  assert.throws(() => parseReply({ content: [{ type: 'text', text: 'こんにちは' }] }), Error);
});

test('runCheck: 鍵が無ければ、見せる前に止まる', async () => {
  let shown = 0;
  await assert.rejects(runCheck({ files: [{ name: 'a', text: '会社A' }], env: {}, confirm: async () => { shown++; return true; }, send: async () => ({}), log: () => {} }));
  assert.equal(shown, 0);
});

test('toResultFile と parseAiResult: 書き出した結果を画面で読める。別の形式は断る', () => {
  const text = toResultFile({ model: 'claude-opus-5-5', aiCandidates: [{ label: 'AI の候補', file: 'a', message: 'm', basis: 'b' }], warnings: [] }, { files: [{ name: 'a' }], date: new Date('2026-11-02T00:00:00Z') });
  const r = parseAiResult(text);
  assert.equal(r.candidates.length, 1);
  assert.equal(r.candidates[0].label, 'AI の候補');
  assert.throws(() => parseAiResult('{"format":"mask-map","candidates":[]}'), Error);
  assert.throws(() => parseAiResult('壊れた'), Error);
});

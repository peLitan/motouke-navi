// F50a: 労務費と処遇の確認。規則表の行が抜き書きを通り、元請け・下請けで出し分けられ、言い切らないことを確かめる
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { bidCheck } from '../../src/bid-check.mjs';
import { judgeTaicho } from '../../src/taicho.mjs';
import { laborDuties } from '../../src/labor-duty.mjs';
import { bidDutyRows, stage1Rows } from '../../src/export.mjs';
import { renderBidResult } from '../../src/ui/view.mjs';
import { filterVerifiedRules } from '../../src/quote-check.mjs';

const read = (rel) => fs.readFileSync(new URL('../../' + rel, import.meta.url), 'utf8');
const json = (rel) => JSON.parse(read(rel));
const ids = (input) => laborDuties(input).map((d) => d.ruleId);
const base = { orderer: 'public', workType: 'other', contractAmount: 30_000_000, subcontractTotal: 5_000_000, license: 'ippan', engineerQualification: 'shunin' };

test('規則表の行: すべて根拠の抜き書きが原文と一致する', () => {
  const { laborDuties: rows } = json('data/rules.json');
  const { sources } = json('data/sources/index.json');
  const texts = Object.fromEntries(sources.filter((s) => s.file && /\.txt$/.test(s.file)).map((s) => [s.id, read('data/sources/' + s.file)]));
  const { kept, problems } = filterVerifiedRules(rows, json('data/quotes.json').quotes, texts);
  assert.deepEqual(problems, []);
  assert.equal(kept.length, rows.length);
  assert.ok(rows.length >= 4);
});

test('根拠の条: 第20条第6項・第25条の27第2項が e-Gov の原文の行から取れている', () => {
  const byId = (id) => json('data/sources/index.json').sources.find((s) => s.id === id);
  for (const id of ['kensetsu-2', 'kensetsu-20', 'kensetsu-25_27']) {
    assert.equal(byId(id).kind, 'law', id);
    assert.equal(byId(id).lawId, '324AC0000000100', id);
    assert.equal(byId(id).fetchedAt, '2026-11-06', id);
  }
  const [estimate, treatment] = laborDuties({ direct: true, hasSubcontract: true });
  assert.ok(estimate.basis.some((b) => b.article === '20' && b.paragraph === 6 && b.quoteId === 'q-kensetsu-20-6'));
  assert.ok(estimate.basis.every((b) => b.quote && b.fetchedAt === '2026-11-06'));
  assert.equal(treatment.basis[0].quoteId, 'q-kensetsu-25_27-2');
  assert.match(treatment.basis[0].quote, /その労働者/);
});

test('元請けで下請けに出す: 見積りの変更と処遇の両方を、確認が要る候補で出す', () => {
  assert.deepEqual(ids({ direct: true, hasSubcontract: true }), ['labor-estimate-prime', 'labor-treatment']);
  for (const d of laborDuties({ direct: true, hasSubcontract: true })) assert.equal(d.status, 'needs_check');
});

test('元請けで下請けの有無が未入力: 見積りの変更も出す(未入力から「要らない」と決めない)', () => {
  assert.deepEqual(ids({ direct: true }), ['labor-estimate-prime', 'labor-treatment']);
  assert.deepEqual(ids({ direct: true, hasSubcontract: null }), ['labor-estimate-prime', 'labor-treatment']);
});

test('元請けで下請けに出さない: 第20条第6項は注文者の定めなので出さず、処遇だけ出す', () => {
  assert.deepEqual(ids({ direct: true, hasSubcontract: false }), ['labor-treatment']);
});

test('下請けのとき: さらに下請けに出す場合の文で出し、出さないなら処遇だけ出す', () => {
  assert.deepEqual(ids({ direct: false, hasSubcontract: true }), ['labor-estimate-sub', 'labor-treatment']);
  const [estimate] = laborDuties({ direct: false, hasSubcontract: true });
  assert.match(estimate.note, /下請けの立場でも、さらに下請けに出す場合/);
  assert.ok(!/元請けは注文者/.test(estimate.note));
  assert.deepEqual(ids({ direct: false, hasSubcontract: false }), ['labor-treatment']);
});

test('元請けか下請けかが未入力: 別の文で出し、どちらかに決めない', () => {
  assert.deepEqual(ids({ hasSubcontract: true }), ['labor-estimate-undecided', 'labor-treatment']);
  assert.deepEqual(ids({}), ['labor-estimate-undecided', 'labor-treatment']);
  assert.deepEqual(ids({ hasSubcontract: false }), ['labor-treatment']);
});

test('処遇の行は第2項の文のとおり自社の労働者の話で、下請けの賃金の義務にしない', () => {
  const treatment = laborDuties({ direct: true, hasSubcontract: true })[1];
  assert.match(treatment.note, /自社の労働者/);
  assert.match(treatment.note, /元請け・下請けを問わず/);
});

test('言い切らない: どの文にも「違反」「参加できない」「問題ありません」が無く、判定しないと書いてある', () => {
  const texts = [];
  for (const input of [{ direct: true, hasSubcontract: true }, { direct: false, hasSubcontract: true }, {}]) {
    for (const d of laborDuties(input)) texts.push(d.note, d.label, ...d.exceptions);
  }
  for (const t of texts) assert.ok(!/違反|参加できない|問題ありません|安全です/.test(t), t);
  assert.ok(texts.some((t) => /判定しない|判定せず/.test(t)));
});

test('結果の画面: 節が出て、抜き書きと断り書きが常に出る。確認が要る点の件数は変わらない', () => {
  const input = { ...base, direct: true, hasSubcontract: true };
  const bid = bidCheck(input);
  const html = renderBidResult(bid);
  assert.ok(html.includes('労務費と処遇の候補(確認が要る点の数に入れません)'));
  assert.ok(html.includes('著しく下回ることとなるような変更を求めてはならない。'));
  assert.ok(html.includes('その他の労働者の適切な処遇を確保するための措置'));
  assert.ok(html.includes('当たる・当たらないを判定しません'));
  assert.ok(html.includes(bid.disclaimer));
  assert.ok(bid.disclaimer.length > 0);
  assert.equal(bid.checks.filter((c) => /labor/.test(c.key)).length, 0);
  assert.equal(bid.items.filter((c) => /labor/.test(c.key)).length, 0);
});

test('書き出し: 候補が根拠の原文つきの行で入る', () => {
  const input = { ...base, direct: true, hasSubcontract: true };
  const bid = bidCheck(input);
  const rows = bidDutyRows(bid);
  assert.equal(rows.length, bid.duties.length);
  assert.equal(rows[0][0], '労務費と処遇の確認');
  assert.ok(rows[0].join(' ').includes('著しく下回ることとなるような変更'));
  const all = stage1Rows(bid, judgeTaicho(input), '注意の文');
  assert.equal(all.filter((r) => r[0] === '労務費と処遇の確認').length, bid.duties.length);
});

test('通信しない: 判定のファイルに通信の語が無い', () => {
  assert.ok(!/fetch\(|XMLHttpRequest|WebSocket|https?:\/\//.test(read('src/labor-duty.mjs')));
});

test('説明の語: README・docs に使わない語が無い', () => {
  const files = ['README.md', ...fs.readdirSync(new URL('../../docs/', import.meta.url)).filter((f) => f.endsWith('.md')).map((f) => 'docs/' + f)];
  for (const f of files) assert.ok(!/中抜き|ペーパーカンパニー|会社の数を(減らす|増やす)|受注できる/.test(read(f)), f);
});

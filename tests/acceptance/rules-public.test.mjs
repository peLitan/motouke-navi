// F03a: 規則表(公共工事の施工体制台帳)(条件 F03-1・F03-3・F03-6)
import test from 'node:test';
import assert from 'node:assert/strict';
import { readJson, load, loadSources, basisVerified, LAW } from './_helpers.mjs';

const base = { orderer: 'public', direct: true, hasSubcontract: true, subcontractTotal: 10_000_000, workType: 'other', license: 'ippan', ictMeasure: false };

async function setup() {
  const { judgeTaicho } = await load('src/taicho.mjs');
  return { judgeTaicho, src: loadSources() };
}
function assertReasons(out, src) {
  assert.ok(Array.isArray(out.reasons) && out.reasons.length > 0, '根拠の無い結果');
  for (const r of out.reasons) {
    assert.ok(Array.isArray(r.basis) && r.basis.length > 0, '根拠の無い理由: ' + JSON.stringify(r));
    for (const b of r.basis) assert.ok(basisVerified(src, b), '原文に無い根拠: ' + JSON.stringify(b));
  }
}
const hasArticle = (out, law, article) => out.reasons.some((r) => r.basis.some((b) => b.law === law && String(b.article) === article));

test('規則表の公共の行: 根拠の抜き書きがすべて原文と一致し、例外・参照の欄の空きの警告が無い', async () => {
  const { rules } = readJson('data/rules.json');
  const { quotes } = readJson('data/quotes.json');
  const src = loadSources();
  const pub = rules.filter((r) => r.scope === 'public');
  assert.ok(pub.length >= 2, '公共の行が少ない');
  for (const r of pub) {
    assert.ok(r.id && r.action && Array.isArray(r.basis) && r.basis.length > 0, '欄が足りない行: ' + r.id);
    assert.ok(r.condition && typeof r.condition === 'object', '条件の無い行: ' + r.id);
  }
  const { filterVerifiedRules } = await load('src/quote-check.mjs');
  const { dropped } = filterVerifiedRules(pub, quotes, src.texts);
  assert.deepEqual(dropped.map((r) => r.id), [], '原文と一致しない根拠の行がある');
  const { findExceptionWarnings } = await load('src/exception-scan.mjs');
  assert.deepEqual(findExceptionWarnings(pub, quotes, src.texts), [], '例外・参照の欄が空の行がある');
});

test('公共・元請・下請契約あり: 台帳を作り、写しを発注者に出す(入契法 第15条)', async () => {
  const { judgeTaicho, src } = await setup();
  for (const total of [1, 10_000_000, 49_990_000, 300_000_000]) {
    const out = judgeTaicho({ ...base, subcontractTotal: total });
    assert.equal(out.status, 'required', '総額 ' + total);
    assert.equal(out.copyToOrderer, 'required', '総額 ' + total);
    assertReasons(out, src);
    assert.ok(hasArticle(out, LAW.nyukei, '15'), '入契法 第15条の根拠が無い');
  }
});

test('公共・措置を講じている: 台帳は作るが、写しの提出は要らない(根拠つき)', async () => {
  const { judgeTaicho, src } = await setup();
  const out = judgeTaicho({ ...base, ictMeasure: true });
  assert.equal(out.status, 'required');
  assert.equal(out.copyToOrderer, 'not_required');
  assertReasons(out, src);
  assert.ok(hasArticle(out, LAW.nyukei, '15'));
});

test('公共・下請契約なし: 台帳は要らない', async () => {
  const { judgeTaicho, src } = await setup();
  const out = judgeTaicho({ ...base, hasSubcontract: false, subcontractTotal: 0 });
  assert.equal(out.status, 'not_required');
  assert.notEqual(out.copyToOrderer, 'required');
  assertReasons(out, src);
});

test('公共・発注者から直接でない: 元請けとしての作成の対象にしない', async () => {
  const { judgeTaicho, src } = await setup();
  const out = judgeTaicho({ ...base, direct: false });
  assert.equal(out.status, 'not_required');
  assert.notEqual(out.copyToOrderer, 'required');
  assertReasons(out, src);
});

// F03b: 規則表(民間工事の施工体制台帳)(条件 F03-2〜F03-6)
import test from 'node:test';
import assert from 'node:assert/strict';
import { readJson, load, loadSources, basisVerified, quoteInText, yenToKanji, LAW } from './_helpers.mjs';

const base = { orderer: 'private', direct: true, hasSubcontract: true, subcontractTotal: 60_000_000, workType: 'other', license: 'tokutei', ictMeasure: false };

async function setup() {
  const { judgeTaicho } = await load('src/taicho.mjs');
  return { judgeTaicho, src: loadSources() };
}
function assertReasons(out, src) {
  assert.ok(Array.isArray(out.reasons) && out.reasons.length > 0, '根拠の無い結果');
  for (const r of out.reasons) {
    assert.ok(Array.isArray(r.basis) && r.basis.length > 0, '根拠の無い理由');
    for (const b of r.basis) assert.ok(basisVerified(src, b), '原文に無い根拠: ' + JSON.stringify(b));
  }
}
const allBasis = (out) => out.reasons.flatMap((r) => r.basis);

test('規則表の民間の行: 根拠の抜き書きがすべて原文と一致し、例外・参照の欄の空きの警告が無い', async () => {
  const { rules } = readJson('data/rules.json');
  const { quotes } = readJson('data/quotes.json');
  const src = loadSources();
  const priv = rules.filter((r) => r.scope === 'private');
  assert.ok(priv.length >= 2, '民間の行が少ない');
  const { filterVerifiedRules } = await load('src/quote-check.mjs');
  assert.deepEqual(filterVerifiedRules(priv, quotes, src.texts).dropped.map((r) => r.id), []);
  const { findExceptionWarnings } = await load('src/exception-scan.mjs');
  assert.deepEqual(findExceptionWarnings(priv, quotes, src.texts), []);
});

test('金額の税込み・税抜きの扱いが、国交省の資料の原文を根拠に規則表に書いてある', () => {
  const { amountBasis } = readJson('data/rules.json');
  const { quotes } = readJson('data/quotes.json');
  const src = loadSources();
  assert.ok(amountBasis, 'amountBasis が無い');
  assert.equal(amountBasis.tax, 'included');
  assert.ok(Array.isArray(amountBasis.basis) && amountBasis.basis.length > 0);
  for (const b of amountBasis.basis) {
    const q = quotes.find((x) => x.id === b.quoteId);
    assert.ok(q, '抜き書きが無い: ' + b.quoteId);
    const s = src.byId[q.sourceId];
    assert.ok(s && s.kind === 'document' && /ガイドライン/.test(s.title) && new URL(s.url).hostname.endsWith('mlit.go.jp'), '国交省のガイドラインが出典でない');
    assert.ok(src.texts[s.id], 'ガイドラインの原文のファイルが無い');
    assert.ok(quoteInText(q.text, src.texts[s.id]), '原文に無い抜き書き');
    assert.match(q.text, /消費税/);
  }
});

test('民間・特定・元請: 下請けの総額 4,999万円は不要、5,000万円は要る(建築一式以外)', async () => {
  const { judgeTaicho, src } = await setup();
  const below = judgeTaicho({ ...base, subcontractTotal: 49_990_000 });
  const at = judgeTaicho({ ...base, subcontractTotal: 50_000_000 });
  assert.equal(below.status, 'not_required');
  assert.equal(at.status, 'required');
  assertReasons(below, src); assertReasons(at, src);
  const q = allBasis(at).find((b) => b.law === LAW.rei && String(b.article) === '7の4');
  assert.ok(q, '施行令 第7条の4 の根拠が無い');
  assert.ok(q.quote.includes(yenToKanji(50_000_000)), '根拠の抜き書きに金額が無い');
  assert.ok(allBasis(at).some((b) => b.law === LAW.kensetsu && String(b.article) === '24の8'));
});

test('民間・特定・元請・建築一式: 7,999万円は不要、8,000万円は要る', async () => {
  const { judgeTaicho, src } = await setup();
  const k = { ...base, workType: 'kenchiku-ikkatsu' };
  const below = judgeTaicho({ ...k, subcontractTotal: 79_990_000 });
  const at = judgeTaicho({ ...k, subcontractTotal: 80_000_000 });
  assert.equal(below.status, 'not_required');
  assert.equal(at.status, 'required');
  assertReasons(below, src); assertReasons(at, src);
  const q = allBasis(at).find((b) => b.law === LAW.rei && String(b.article) === '7の4');
  assert.ok(q && q.quote.includes(yenToKanji(80_000_000)), '建築一式の金額の根拠が無い');
});

test('民間・発注者から直接でない: 元請けとしての作成の対象にしない', async () => {
  const { judgeTaicho, src } = await setup();
  const out = judgeTaicho({ ...base, direct: false, subcontractTotal: 300_000_000 });
  assert.equal(out.status, 'not_required');
  assertReasons(out, src);
});

test('民間・一般建設業者で境目以上: 「要らない」と出さず、許可の種類の確認が要ると根拠つきで出す', async () => {
  const { judgeTaicho, src } = await setup();
  for (const [workType, total] of [['other', 50_000_000], ['other', 120_000_000], ['kenchiku-ikkatsu', 80_000_000]]) {
    const out = judgeTaicho({ ...base, license: 'ippan', workType, subcontractTotal: total });
    assert.equal(out.status, 'needs_check', workType + ' ' + total);
    assertReasons(out, src);
    assert.ok(allBasis(out).some((b) => (b.law === LAW.kensetsu && String(b.article) === '3') || (b.law === LAW.rei && String(b.article) === '2')), '許可の種類の根拠(法 第3条か施行令 第2条)が無い');
  }
  const under = judgeTaicho({ ...base, license: 'ippan', subcontractTotal: 49_990_000 });
  assert.equal(under.status, 'not_required');
});

test('民間・下請契約なし: 台帳は要らない', async () => {
  const { judgeTaicho, src } = await setup();
  const out = judgeTaicho({ ...base, hasSubcontract: false, subcontractTotal: 0 });
  assert.equal(out.status, 'not_required');
  assertReasons(out, src);
});

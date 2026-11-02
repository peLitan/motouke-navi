// F10: 入札前の確認(条件 F10-1〜F10-4)
import test from 'node:test';
import assert from 'node:assert/strict';
import { load, loadSources, basisVerified, findLawSource, quoteInText, yenToKanji, LAW, EXCEPTION_RE } from './_helpers.mjs';

const KEYS = ['tokutei-license', 'taicho', 'taicho-copy', 'engineer', 'taikeizu', 'dedicated'];
const base = { orderer: 'private', direct: true, workType: 'other', contractAmount: 200_000_000, hasSubcontract: true, subcontractTotal: 60_000_000, license: 'tokutei', engineerQualification: 'kanri', ictMeasure: false };

async function setup() {
  const m = await load('src/bid-check.mjs');
  return { ...m, src: loadSources() };
}
const item = (out, key) => out.items.find((i) => i.key === key);
const has = (it, law, article) => it.basis.some((b) => b.law === law && String(b.article) === article);

function assertShape(out, src) {
  for (const k of KEYS) {
    const it = item(out, k);
    assert.ok(it, '項目が無い: ' + k);
    assert.ok(['required', 'not_required', 'needs_check'].includes(it.status), k + ' の status: ' + it.status);
    assert.ok(typeof it.label === 'string' && it.label.length > 0);
    assert.ok(Array.isArray(it.basis) && it.basis.length > 0, k + ' に根拠が無い');
    for (const b of it.basis) assert.ok(basisVerified(src, b), '原文に無い根拠: ' + JSON.stringify(b));
  }
  const all = JSON.stringify(out);
  assert.ok(!/入札すべき|参加できる|入札できる|参加すべき/.test(all), '入札・参加の可否を出している');
  assert.ok(typeof out.disclaimer === 'string' && /判断/.test(out.disclaimer) && /人/.test(out.disclaimer), '最後の判断は人がする旨が無い');
  assert.ok(Array.isArray(out.checks), '確認が要る点の一覧が無い');
}

test('一覧の形: 6つの項目すべてに状態と、原文と一致する根拠の条がある', async () => {
  const { bidCheck, src } = await setup();
  for (const orderer of ['public', 'private']) assertShape(bidCheck({ ...base, orderer }), src);
});

test('根拠の条の原文に例外・参照の語があれば、その項目の例外の欄(exceptions)が空でない', async () => {
  const { bidCheck, src } = await setup();
  for (const input of [{ ...base, orderer: 'public' }, base, { ...base, contractAmount: 500_000_000 }]) {
    for (const it of bidCheck(input).items) {
      const words = it.basis.some((b) => { const s = findLawSource(src, b.law, b.article); return s && EXCEPTION_RE.test(src.texts[s.id]); });
      if (words) assert.ok(Array.isArray(it.exceptions) && it.exceptions.length > 0, it.key + ' の例外の欄が空');
    }
  }
});

test('特定建設業の許可と監理技術者: 4,999万円・5,000万円で分かれる(建築一式以外)', async () => {
  const { bidCheck, src } = await setup();
  const below = bidCheck({ ...base, subcontractTotal: 49_990_000 });
  const at = bidCheck({ ...base, subcontractTotal: 50_000_000 });
  assertShape(below, src); assertShape(at, src);
  assert.equal(item(below, 'tokutei-license').status, 'not_required');
  assert.equal(item(at, 'tokutei-license').status, 'required');
  assert.ok(has(item(at, 'tokutei-license'), LAW.kensetsu, '3'));
  assert.equal(item(below, 'engineer').value, 'shunin');
  assert.equal(item(at, 'engineer').value, 'kanri');
  assert.ok(has(item(at, 'engineer'), LAW.kensetsu, '26'));
});

test('建築一式: 7,999万円・8,000万円で分かれる', async () => {
  const { bidCheck } = await setup();
  const k = { ...base, workType: 'kenchiku-ikkatsu' };
  const below = bidCheck({ ...k, subcontractTotal: 79_990_000 });
  const at = bidCheck({ ...k, subcontractTotal: 80_000_000 });
  assert.equal(item(below, 'tokutei-license').status, 'not_required');
  assert.equal(item(at, 'tokutei-license').status, 'required');
  assert.equal(item(below, 'engineer').value, 'shunin');
  assert.equal(item(at, 'engineer').value, 'kanri');
  assert.equal(item(below, 'taicho').status, 'not_required');
  assert.equal(item(at, 'taicho').status, 'required');
});

test('入力が要るものを満たさないときは、確認が要る点に並べる(一般建設業・主任技術者のみ)', async () => {
  const { bidCheck } = await setup();
  const out = bidCheck({ ...base, license: 'ippan', engineerQualification: 'shunin', subcontractTotal: 60_000_000 });
  assert.ok(out.checks.some((c) => c.key === 'tokutei-license'), '許可の確認が無い');
  assert.ok(out.checks.some((c) => c.key === 'engineer'), '技術者の確認が無い');
  const ok = bidCheck({ ...base, subcontractTotal: 60_000_000 });
  assert.ok(!ok.checks.some((c) => c.key === 'tokutei-license' || c.key === 'engineer'));
});

test('公共: 下請けがあれば台帳と写し(措置があれば写しは不要)、施工体系図は台帳と同じ扱い', async () => {
  const { bidCheck, src } = await setup();
  const out = bidCheck({ ...base, orderer: 'public', subcontractTotal: 1_000_000, license: 'ippan', engineerQualification: 'shunin' });
  assertShape(out, src);
  assert.equal(item(out, 'taicho').status, 'required');
  assert.ok(has(item(out, 'taicho'), LAW.nyukei, '15'));
  assert.equal(item(out, 'taicho-copy').status, 'required');
  assert.equal(item(out, 'taikeizu').status, item(out, 'taicho').status);
  const ict = bidCheck({ ...base, orderer: 'public', ictMeasure: true });
  assert.equal(item(ict, 'taicho-copy').status, 'not_required');
  const none = bidCheck({ ...base, orderer: 'public', hasSubcontract: false, subcontractTotal: 0 });
  assert.equal(item(none, 'taicho').status, 'not_required');
  assert.equal(item(none, 'taikeizu').status, 'not_required');
});

test('専任: 金額は取得した施行令 第27条の原文から取り、その境目で分かれる', async () => {
  const { bidCheck, dedicatedThreshold, src } = await setup();
  const t = dedicatedThreshold();
  assert.ok(Number.isInteger(t.other) && t.other > 0 && Number.isInteger(t.kenchiku) && t.kenchiku > t.other);
  assert.equal(t.basis.law, LAW.rei);
  assert.equal(String(t.basis.article), '27');
  const s = findLawSource(src, LAW.rei, '27');
  assert.ok(quoteInText(t.basis.quote, src.texts[s.id]), '抜き書きが施行令 第27条の原文に無い');
  assert.ok(t.basis.quote.includes(yenToKanji(t.other)), '抜き書きに ' + yenToKanji(t.other) + ' が無い');
  assert.ok(t.basis.quote.includes(yenToKanji(t.kenchiku)), '抜き書きに ' + yenToKanji(t.kenchiku) + ' が無い');
  const pub = { ...base, orderer: 'public' };
  assert.equal(item(bidCheck({ ...pub, contractAmount: t.other - 1 }), 'dedicated').status, 'not_required');
  assert.equal(item(bidCheck({ ...pub, contractAmount: t.other }), 'dedicated').status, 'required');
  assert.equal(item(bidCheck({ ...pub, workType: 'kenchiku-ikkatsu', contractAmount: t.kenchiku - 1 }), 'dedicated').status, 'not_required');
  assert.equal(item(bidCheck({ ...pub, workType: 'kenchiku-ikkatsu', contractAmount: t.kenchiku }), 'dedicated').status, 'required');
  const d = item(bidCheck({ ...pub, contractAmount: t.other }), 'dedicated');
  assert.ok(has(d, LAW.rei, '27'));
  // 民間で境目以上は、工作物の種類によるので「要らない」と言い切らない
  assert.notEqual(item(bidCheck({ ...base, contractAmount: t.other }), 'dedicated').status, 'not_required');
});

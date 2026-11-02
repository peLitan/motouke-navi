// F04a: 施工体制台帳の点検(条件 F04-1・F04-2・F04-3)
// 台帳の形(構造化した入力):
// { project: { name, orderer, ordererType: 'public'|'private', workType: 'other'|'kenchiku-ikkatsu', contractAmount, periodFrom, periodTo },
//   prime: { name, licenseType: 'tokutei'|'ippan', licenseNumber, engineer: { role: 'kanri'|'shunin', name, qualification } },
//   subcontractors: [ { name, licenseNumber, work, periodFrom, periodTo, amount, engineer: { role: 'shunin', name, qualification } } ] }
import test from 'node:test';
import assert from 'node:assert/strict';
import { load, loadSources, basisVerified, LAW } from './_helpers.mjs';

const clone = (x) => JSON.parse(JSON.stringify(x));
const CLEAN = {
  project: { name: '架空川 護岸改修工事', orderer: '架空県', ordererType: 'public', workType: 'other', contractAmount: 250_000_000, periodFrom: '2026-10-01', periodTo: '2027-03-15' },
  prime: { name: '架空一建設株式会社', licenseType: 'tokutei', licenseNumber: '架空県知事 許可(特-06)第99001号', engineer: { role: 'kanri', name: '架空 太郎', qualification: '1級土木施工管理技士' } },
  subcontractors: [
    { name: '架空二土木株式会社', licenseNumber: '架空県知事 許可(般-06)第99002号', work: '掘削、盛土', periodFrom: '2026-10-10', periodTo: '2026-12-20', amount: 35_000_000, engineer: { role: 'shunin', name: '架空 次郎', qualification: '2級土木施工管理技士' } },
    { name: '架空三工業株式会社', licenseNumber: '架空県知事 許可(般-06)第99003号', work: '護岸ブロック据付', periodFrom: '2026-12-01', periodTo: '2027-02-28', amount: 25_000_000, engineer: { role: 'shunin', name: '架空 三郎', qualification: '実務経験' } },
  ],
};

async function setup() {
  const { checkTaicho } = await load('src/check-taicho.mjs');
  return { checkTaicho, src: loadSources() };
}
function assertCandidates(out, src) {
  assert.ok(Array.isArray(out.candidates) && Array.isArray(out.undecidable));
  for (const c of out.candidates) {
    assert.ok(c.target && c.message, '対象か内容の無い候補');
    assert.ok(Array.isArray(c.basis) && c.basis.length > 0, '根拠の無い候補: ' + c.message);
    for (const b of c.basis) assert.ok(basisVerified(src, b), '原文に無い根拠: ' + JSON.stringify(b));
  }
}
const hits = (out, name, law, article) => out.candidates.filter((c) => String(c.target).includes(name) && c.basis.some((b) => b.law === law && String(b.article) === article));

test('抜けも食い違いも無い台帳には、候補も「判断できない」も出さない', async () => {
  const { checkTaicho, src } = await setup();
  const out = checkTaicho(clone(CLEAN));
  assertCandidates(out, src);
  assert.deepEqual(out.candidates, []);
  assert.deepEqual(out.undecidable, []);
  const priv = clone(CLEAN); priv.project.ordererType = 'private';
  assert.deepEqual(checkTaicho(priv).candidates, []);
});

test('下請けの工事の内容・工期の抜けは、その下請けを対象に、法 第24条の8 を根拠に出す', async () => {
  const { checkTaicho, src } = await setup();
  const a = clone(CLEAN); a.subcontractors[1].work = '';
  const outA = checkTaicho(a);
  assertCandidates(outA, src);
  assert.ok(hits(outA, '架空三工業株式会社', LAW.kensetsu, '24の8').length >= 1, '工事の内容の抜けが出ない');
  assert.equal(outA.candidates.length, 1, '言い過ぎ: ' + JSON.stringify(outA.candidates));
  const b = clone(CLEAN); b.subcontractors[0].periodFrom = ''; b.subcontractors[0].periodTo = '';
  const outB = checkTaicho(b);
  assertCandidates(outB, src);
  assert.ok(hits(outB, '架空二土木株式会社', LAW.kensetsu, '24の8').length >= 1, '工期の抜けが出ない');
});

test('下請けの主任技術者の抜けは、法 第26条 を根拠に出す', async () => {
  const { checkTaicho, src } = await setup();
  const a = clone(CLEAN); a.subcontractors[0].engineer = { role: 'shunin', name: '', qualification: '' };
  const out = checkTaicho(a);
  assertCandidates(out, src);
  assert.ok(hits(out, '架空二土木株式会社', LAW.kensetsu, '26').length >= 1);
});

test('下請けの総額が境目以上なのに、元請けが主任技術者・一般建設業なら、食い違いとして出す', async () => {
  const { checkTaicho, src } = await setup();
  const a = clone(CLEAN); a.prime.engineer.role = 'shunin';
  const outA = checkTaicho(a);
  assertCandidates(outA, src);
  assert.ok(hits(outA, '架空一建設株式会社', LAW.kensetsu, '26').length >= 1, '監理技術者の食い違いが出ない');
  const b = clone(CLEAN); b.prime.licenseType = 'ippan';
  const outB = checkTaicho(b);
  assertCandidates(outB, src);
  assert.ok(outB.candidates.some((c) => String(c.target).includes('架空一建設株式会社') && c.basis.some((x) => (x.law === LAW.kensetsu && String(x.article) === '3') || (x.law === LAW.rei && String(x.article) === '2'))), '許可の種類の食い違いが出ない');
  // 境目未満なら、主任技術者・一般建設業でも候補にしない
  const c = clone(CLEAN); c.prime.engineer.role = 'shunin'; c.prime.licenseType = 'ippan'; c.subcontractors[1].amount = 10_000_000;
  assert.deepEqual(checkTaicho(c).candidates, []);
});

test('下請けの金額が分からず総額を決められないときは「判断できない」とし、推測で候補にしない', async () => {
  const { checkTaicho, src } = await setup();
  const a = clone(CLEAN); a.prime.engineer.role = 'shunin'; a.subcontractors[1].amount = null;
  const out = checkTaicho(a);
  assertCandidates(out, src);
  assert.ok(out.undecidable.length >= 1, '判断できないが出ない');
  assert.ok(out.undecidable.every((u) => u.target && u.message));
  assert.ok(!out.candidates.some((c) => c.basis.some((b) => String(b.article) === '26') && String(c.target).includes('架空一建設株式会社')), '推測で監理技術者の候補を出した');
});

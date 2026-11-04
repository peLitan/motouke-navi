// F04a の受け入れテストに無い分岐(値はすべて架空)
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkTaicho } from '../../src/check-taicho.mjs';

const base = () => ({
  project: { name: '架空工事', orderer: '架空市', ordererType: 'public', workType: 'other', contractAmount: 100_000_000, periodFrom: '2026-10-01', periodTo: '2027-03-01' },
  prime: { name: '架空甲建設', licenseType: 'ippan', licenseNumber: 'xxxx', engineer: { role: 'shunin', name: '架空 一', qualification: '1級土木施工管理技士' } },
  subcontractors: [
    { name: '架空乙', licenseNumber: 'xxxx', work: '舗装', periodFrom: '2026-10-10', periodTo: '2026-12-01', amount: 30_000_000, engineer: { role: 'shunin', name: '架空 二', qualification: '実務経験' } },
    { name: '架空丙', licenseNumber: 'xxxx', work: '区画線', periodFrom: '2026-12-01', periodTo: '2027-01-31', amount: 10_000_000, engineer: { role: 'shunin', name: '架空 三', qualification: '実務経験' } },
  ],
});

test('分かっている額だけで境目以上なら、分からない額があっても食い違いの候補にする', () => {
  const a = base(); a.subcontractors[0].amount = 50_000_000; a.subcontractors[1].amount = null;
  const out = checkTaicho(a);
  assert.deepEqual(out.undecidable, []);
  assert.deepEqual(out.candidates.map((c) => c.field).sort(), ['prime.engineer.role', 'prime.licenseType']);
  assert.ok(out.candidates.every((c) => c.message.includes('分かっている額だけで')));
});

test('建築一式なら境目は八千万円(施行令 第2条のただし書から読む)', () => {
  const a = base(); a.project.workType = 'kenchiku-ikkatsu'; a.subcontractors[0].amount = 60_000_000;
  assert.deepEqual(checkTaicho(a).candidates, []);
  a.subcontractors[0].amount = 70_000_000;
  assert.equal(checkTaicho(a).candidates.length, 2);
});

test('工事の種類が分からず境目を決められないときは「判断できない」', () => {
  const a = base(); a.project.workType = undefined;
  const out = checkTaicho(a);
  assert.deepEqual(out.candidates, []);
  assert.equal(out.undecidable.length, 1);
  assert.equal(out.undecidable[0].field, 'project.workType');
});

test('名称が空の下請けは何件目かで指し、技術者の資格の空も候補にする', () => {
  const a = base(); a.prime.licenseType = 'tokutei'; a.prime.engineer.role = 'kanri';
  a.subcontractors[1].name = ''; a.subcontractors[0].engineer.qualification = '';
  a.subcontractors[0].licenseNumber = '架空県知事 許可(般-05)第00002号'; // 許可番号の形のときだけ建設業者として技術者の抜けの候補にする(F31e)
  const out = checkTaicho(a);
  assert.ok(out.candidates.some((c) => c.target === '下請け 2件目(名称が空)' && c.field === 'name'));
  assert.ok(out.candidates.some((c) => c.target === '架空乙' && c.field === 'engineer.qualification'));
  assert.equal(out.candidates.length, 2);
});

test('下請けが無ければ、総額の食い違いも「判断できない」も出さない', () => {
  const a = base(); a.subcontractors = [];
  const out = checkTaicho(a);
  assert.deepEqual(out.candidates, []);
  assert.deepEqual(out.undecidable, []);
});

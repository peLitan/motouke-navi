// F15d: 判定の直し3(反証の指摘6・7・8・9)。値はすべて架空
import test from 'node:test';
import assert from 'node:assert/strict';
import { judgeTaicho } from '../../src/taicho.mjs';
import { checkTaicho } from '../../src/check-taicho.mjs';
import rulesData from '../../data/rules.json' with { type: 'json' };

const rule = (id) => rulesData.rules.find((r) => r.id === id);

// 指摘6: 下請けなしの行が direct を見ない → 下請けの立場でも「下請契約を結んだら作る」の行が付く
test('指摘6: 下請けなしの行は元請けの行(direct: true)。下請けで下請けなしなら、元請けの作成の行が付かない', () => {
  for (const id of ['pub-no-subcontract', 'prv-no-subcontract']) assert.equal(rule(id).condition.direct, true, id);
  for (const orderer of ['public', 'private']) {
    const out = judgeTaicho({ orderer, direct: false, hasSubcontract: false, subcontractTotal: 0, workType: 'other', license: 'ippan' });
    assert.equal(out.status, 'not_required', orderer);
    assert.ok(!out.reasons.some((r) => /no-subcontract/.test(r.ruleId)), orderer + ': 下請けなしの行(下請契約を結んだら作る)が下請けに付いた');
    assert.ok(out.reasons.some((r) => /not-direct/.test(r.ruleId)), orderer);
  }
  // 元請けで下請けなしは、従来どおり要らない
  const prime = judgeTaicho({ orderer: 'public', direct: true, hasSubcontract: false, subcontractTotal: 0 });
  assert.equal(prime.status, 'not_required');
  assert.ok(prime.reasons.some((r) => r.ruleId === 'pub-no-subcontract'));
});

test('元請けか未選択なら、足りない欄は「元請けか下請けか」だけを出す(公共で民間の欄を挙げない)', () => {
  const out = judgeTaicho({ orderer: 'public', direct: null, hasSubcontract: false, subcontractTotal: 0 });
  assert.equal(out.status, 'unknown');
  assert.deepEqual(out.missing, ['direct']);
});

// 指摘8: 民間の台帳の行の根拠に入契法 第15条第2項(公共工事の写しの決まり)が入っている
test('指摘8: 民間の行の根拠に入契法 第15条第2項を入れない(当たらないことの説明は exceptions に残す)', () => {
  for (const r of rulesData.rules.filter((x) => x.scope === 'private')) {
    assert.ok(!r.basis.some((b) => b.quoteId === 'q-nyukei-15-2'), r.id);
  }
  for (const id of ['prv-taicho-create', 'prv-taicho-create-kenchiku']) {
    assert.ok(rule(id).exceptions.some((e) => e.includes('第15条第2項') && e.includes('公共工事の受注者')), id);
  }
  const out = judgeTaicho({ orderer: 'private', direct: true, hasSubcontract: true, subcontractTotal: 60_000_000, workType: 'other', license: 'tokutei' });
  assert.equal(out.status, 'required');
  assert.equal(out.copyToOrderer, 'not_required');
  assert.ok(!out.reasons.some((r) => r.basis.some((b) => b.quoteId === 'q-nyukei-15-2')));
});

const ledger = () => ({
  project: { name: '架空工事', orderer: '架空県', ordererType: 'public', workType: 'kenchiku-ikkatsu', contractAmount: 150_000_000, periodFrom: '2026-10-01', periodTo: '2027-09-30' },
  prime: { name: '架空甲工務店', licenseType: 'tokutei', licenseNumber: 'xxxx', engineer: { role: 'shunin', name: '架空 一', qualification: '1級建築施工管理技士', dedicated: true } },
  subcontractors: [
    { name: '架空乙躯体', licenseNumber: 'xxxx', work: '鉄筋・型枠', periodFrom: '2026-11-01', periodTo: '2027-03-31', amount: 46_000_000, engineer: { role: 'shunin', name: '架空 二', qualification: '実務経験', dedicated: true } },
    { name: '架空丙設備', licenseNumber: 'xxxx', work: '給排水', periodFrom: '2027-01-01', periodTo: '2027-06-30', amount: null, engineer: { role: 'shunin', name: '架空 三', qualification: '実務経験', dedicated: true } },
  ],
});

// 指摘7: 見本 B の形(許可は特定と読めている)で「許可の種類(特定か)が合っているか判断できません」と書く
test('指摘7: 許可が特定と読めているなら、判断できないの文は技術者の役割だけを書く', () => {
  const out = checkTaicho(ledger());
  const u = out.undecidable.find((x) => x.field === 'subcontractors.amount');
  assert.ok(u, '額の分からない下請けで判断できないが出ない');
  assert.match(u.message, /監理技術者か/);
  assert.ok(!/許可の種類|特定か/.test(u.message), '読めている許可の種類を「判断できない」に書いた: ' + u.message);
  assert.ok(!u.basis.some((b) => b.quoteId === 'q-kensetsu-3-1-2'));
  // 逆に、監理技術者で許可が一般なら、許可の種類だけを書く
  const b = ledger(); b.prime.engineer.role = 'kanri'; b.prime.licenseType = 'ippan';
  const ub = checkTaicho(b).undecidable.find((x) => x.field === 'subcontractors.amount');
  assert.match(ub.message, /許可の種類\(特定か\)/);
  assert.ok(!/監理技術者か/.test(ub.message));
  // 工事の種類が分からないときの文も同じ
  const c = ledger(); c.project.workType = null;
  const uc = checkTaicho(c).undecidable.find((x) => x.field === 'project.workType');
  assert.ok(uc && !/許可の種類/.test(uc.message), uc?.message);
});

// 指摘9: 元請けの技術者の節が無い台帳で、「氏名が空」と「監理技術者になっていません」を二重に出す
test('指摘9: 元請けの技術者が無い台帳では、技術者の候補を1件にまとめ、監理技術者が要ることを書き足す', () => {
  const a = ledger();
  a.project.workType = 'other';
  a.subcontractors[1].amount = 30_000_000; // 総額 7,600万円 ≥ 5,000万円
  a.prime.engineer = { role: null, name: '', qualification: '', dedicated: null };
  const out = checkTaicho(a);
  const forPrime = out.candidates.filter((c) => c.target === '架空甲工務店' && /engineer/.test(c.field));
  assert.equal(forPrime.length, 1, '元請けの技術者の候補が二重: ' + forPrime.map((c) => c.field).join(','));
  assert.equal(forPrime[0].field, 'engineer');
  assert.match(forPrime[0].message, /監理技術者を置く/);
  assert.ok(forPrime[0].basis.some((b) => b.quoteId === 'q-kensetsu-26-2'));
  // engineer そのものが無くても同じ
  const b = ledger(); b.project.workType = 'other'; b.subcontractors[1].amount = 30_000_000; delete b.prime.engineer;
  assert.equal(checkTaicho(b).candidates.filter((c) => c.target === '架空甲工務店' && /engineer/.test(c.field)).length, 1);
  // 技術者の氏名があって主任技術者なら、従来どおり食い違いの候補
  const c = ledger(); c.project.workType = 'other'; c.subcontractors[1].amount = 30_000_000;
  assert.ok(checkTaicho(c).candidates.some((x) => x.field === 'prime.engineer.role'));
});

test('技術者の氏名はあるが役割が読めないときは、監理技術者でないと決めずに判断できないにする', () => {
  const a = ledger(); a.project.workType = 'other'; a.subcontractors[1].amount = 30_000_000; a.prime.engineer.role = null;
  const out = checkTaicho(a);
  assert.ok(!out.candidates.some((x) => x.field === 'prime.engineer.role'));
  assert.ok(out.undecidable.some((x) => x.field === 'prime.engineer.role'));
});

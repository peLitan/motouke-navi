// F15b: 入力が未選択(null)のとき条件に当てはめない(反証の指摘2・4 の再現)。値はすべて架空
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { judgeTaicho, matchesValue, matchesCondition } from '../../src/taicho.mjs';
import { bidCheck } from '../../src/bid-check.mjs';
import { readBidForm, readDirect, BID_FORM_IDS } from '../../src/ui/form.mjs';
import { renderSummary } from '../../src/ui/view.mjs';
import { SAMPLE } from '../../src/sample.mjs';
import { runPage } from '../acceptance/_helpers.mjs';

const NOT_SAYING = ['not_required'];

test('反証の指摘2の再現: 民間・特定・元請け・下請総額6,000万円・工事の種類 未選択(null) → 台帳は「作る」と言い切らず判断できない', () => {
  const out = judgeTaicho({ orderer: 'private', license: 'tokutei', direct: true, hasSubcontract: true, subcontractTotal: 60_000_000, workType: null, ictMeasure: false });
  assert.equal(out.status, 'unknown');
  assert.ok(out.missing.includes('workType'));
  assert.match(out.message, /工事の種類/);
  // 画面から同じ入力(工事の種類 未選択)を入れたときも同じ
  const fromForm = readBidForm({ orderer: 'private', direct: true, 'work-type': '', 'subcontract-total': '60,000,000', license: 'tokutei', 'ict-measure': false });
  assert.equal(fromForm.workType, null);
  assert.equal(judgeTaicho(fromForm).status, 'unknown');
  const taicho = bidCheck(fromForm).items.find((i) => i.key === 'taicho');
  assert.equal(taicho.status, 'needs_check');
});

test('notIn と matchesCondition: null・undefined は「どれでもない」に数えない', () => {
  assert.equal(matchesValue({ notIn: ['kenchiku-ikkatsu'] }, null), false);
  assert.equal(matchesValue({ notIn: ['kenchiku-ikkatsu'] }, undefined), false);
  assert.equal(matchesValue({ notIn: ['kenchiku-ikkatsu'] }, 'other'), true);
  assert.equal(matchesCondition({ direct: false }, { direct: null }), false);
  assert.equal(matchesCondition({ direct: false }, { direct: false }), true);
});

test('反証の指摘2: 民間で工事の種類が未選択なら、下請けの額が小さくても「作らなくてよい」と言い切らない', () => {
  const out = judgeTaicho({ orderer: 'private', license: 'ippan', direct: true, hasSubcontract: true, subcontractTotal: 10_000_000, workType: null });
  assert.equal(out.status, 'unknown');
  assert.notEqual(out.copyToOrderer, 'not_applicable');
});

test('反証の指摘4の再現: 元請けかどうか未選択なら、台帳・特定の許可を「要らない」と言い切らない', () => {
  // 画面の初期の状態(元請け・下請けのどちらにも印が無い)
  const v = readBidForm({ orderer: 'public', 'direct-unset': true, direct: false, 'direct-sub': false, 'work-type': 'other', 'contract-amount': '300,000,000', 'subcontract-total': '60,000,000', license: 'tokutei', 'engineer-qualification': 'kanri', 'ict-measure': false });
  assert.equal(v.direct, null);
  for (const orderer of ['public', 'private']) {
    const input = { ...v, orderer };
    const j = judgeTaicho(input);
    assert.equal(j.status, 'unknown', orderer);
    assert.ok(j.missing.includes('direct'), orderer);
    assert.match(j.message, /元請けか下請けか/);
    const bid = bidCheck(input);
    for (const key of ['taicho', 'taicho-copy', 'taikeizu', 'tokutei-license']) {
      const it = bid.items.find((i) => i.key === key);
      assert.ok(!NOT_SAYING.includes(it.status), orderer + ' ' + key + ' が ' + it.status);
    }
  }
});

test('元請け・下請けを選べば、これまでどおり判定する(下請けを選んだときだけ「直接でない」)', () => {
  assert.equal(readDirect({ direct: true }), true);
  assert.equal(readDirect({ 'direct-sub': true }), false);
  assert.equal(readDirect({ direct: false }), null);
  assert.equal(readDirect({}), null);
  const base = { orderer: 'public', hasSubcontract: true, subcontractTotal: 60_000_000, workType: 'other', license: 'tokutei', ictMeasure: false };
  assert.equal(judgeTaicho({ ...base, direct: true }).status, 'required');
  assert.equal(judgeTaicho({ ...base, direct: false }).status, 'not_required');
});

test('下請けが無い(総額 0)でも、元請けか未選択なら「作る」と言い切らず、足りない欄に元請けか下請けかを出す(F15d: 下請けなしの行は元請けの行)', () => {
  const out = judgeTaicho({ orderer: 'public', direct: null, hasSubcontract: false, subcontractTotal: 0 });
  assert.notEqual(out.status, 'required');
  assert.ok(!out.reasons.some((r) => /no-subcontract/.test(r.ruleId)));
});

test('画面: 元請けか下請けかは 選んでください/元請け/下請け の3択で、最初は「選んでください」', () => {
  const html = fs.readFileSync(new URL('../../src/ui/shell.html', import.meta.url), 'utf8');
  for (const id of ['direct-unset', 'direct', 'direct-sub']) {
    assert.match(html, new RegExp('<input type="radio" id="' + id + '" name="role"'), id);
    assert.ok(BID_FORM_IDS.includes(id), id);
  }
  assert.match(html, /id="direct-unset" name="role" value="" checked/);
  assert.ok(!/type="checkbox" id="direct"/.test(html));
  const index = fs.readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  assert.ok(index.includes('id="direct-sub"'), 'index.html を作り直していない');
  // 見本は元請けを選ぶ
  assert.equal(readBidForm(SAMPLE.form).direct, true);
});

test('画面を動かす: 何も選ばずに確認すると、台帳は判断できないと出て、まとめの条件は「選んでいません」', async () => {
  const page = runPage();
  await page.set('orderer', 'private'); await page.set('work-type', 'other');
  await page.set('subcontract-total', '60,000,000'); await page.set('license', 'tokutei');
  await page.click('bid-run');
  const t = page.text('taicho-result');
  assert.match(t, /判断でき/);
  assert.match(t, /元請けか下請けか/);
  const s = renderSummary({ values: { 'direct-unset': true, direct: false, 'direct-sub': false } }).replace(/<[^>]+>/g, '');
  assert.match(s, /元請けか下請けか選んでいません/);
});

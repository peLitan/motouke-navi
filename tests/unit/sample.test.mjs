// 見本(F05f)の単体テスト。値はすべて架空
import test from 'node:test';
import assert from 'node:assert/strict';
import { SAMPLE } from '../../src/sample.mjs';
import { readBidForm, formErrors, BID_FORM_IDS } from '../../src/ui/form.mjs';

test('見本の条件は画面の欄を全部埋め、金額の欄が読める', () => {
  assert.deepEqual(Object.keys(SAMPLE.form).sort(), [...BID_FORM_IDS].sort());
  assert.deepEqual(formErrors(SAMPLE.form), []);
  const input = readBidForm(SAMPLE.form);
  for (const [k, v] of Object.entries(input)) assert.notEqual(v, null, k + ' が読めない');
});

test('見本の下請けの総額は、見本の台帳の下請けの請負代金額の合計と同じ', () => {
  const amounts = [...SAMPLE.documents.ledger.split('## 4.')[1].matchAll(/請負代金額 \| 金 ([\d,]+)円/g)].map((m) => Number(m[1].replace(/,/g, '')));
  assert.ok(amounts.length >= 2);
  assert.equal(amounts.reduce((a, b) => a + b, 0), readBidForm(SAMPLE.form).subcontractTotal);
});

test('見本の文字は script の要素に埋め込める(「</script」「<!--」が無い)', () => {
  assert.ok(!/<\/script|<!--/i.test(JSON.stringify(SAMPLE)));
});

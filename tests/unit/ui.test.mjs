// 画面の部品(src/ui/form.mjs・src/ui/view.mjs)と build.mjs のまとめ役の単体テスト(値はすべて架空)
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseYen, readBidForm, formErrors } from '../../src/ui/form.mjs';
import { esc, basisLabel, renderTaichoResult, renderBidResult } from '../../src/ui/view.mjs';
import { bundle, buildHtml } from '../../build.mjs';
import { judgeTaicho } from '../../src/taicho.mjs';
import { bidCheck } from '../../src/bid-check.mjs';

test('parseYen: 桁区切り・全角・円・空白を許し、小数・負・単位は読めないとする', () => {
  assert.deepEqual(parseYen('1,234円'), { value: 1234, error: null });
  assert.deepEqual(parseYen('１２　３４５'), { value: 12345, error: null });
  assert.deepEqual(parseYen(''), { value: null, error: null });
  assert.deepEqual(parseYen(undefined), { value: null, error: null });
  for (const bad of ['1.5', '-100', '5千万', 'abc']) {
    const r = parseYen(bad);
    assert.equal(r.value, null, bad);
    assert.ok(r.error, bad);
  }
});

test('readBidForm: 未選択の欄は null、下請けの総額が空なら有無も null', () => {
  const v = readBidForm({ orderer: '', direct: false, 'work-type': 'x', 'contract-amount': '1', 'subcontract-total': '', license: '', 'engineer-qualification': '', 'ict-measure': false });
  assert.equal(v.orderer, null);
  assert.equal(v.workType, null);
  assert.equal(v.hasSubcontract, null);
  assert.equal(v.subcontractTotal, null);
  assert.equal(v.contractAmount, 1);
});

test('formErrors: 読めない金額の欄を名前つきで返す', () => {
  const e = formErrors({ 'contract-amount': '1億', 'subcontract-total': '100' });
  assert.equal(e.length, 1);
  assert.match(e[0], /請負代金の見込み/);
});

test('basisLabel: 条・項・号の書き方', () => {
  assert.equal(basisLabel({ law: '建設業法', article: '24の8', paragraph: 1, item: 2 }), '建設業法 第24条の8第1項第2号');
  assert.equal(basisLabel({ law: '建設業法施行令', article: '2', paragraph: 1, item: null }), '建設業法施行令 第2条第1項');
});

test('結果の文字はエスケープされる(規則表の action に HTML が入っても要素にならない)', () => {
  assert.equal(esc('<a href="x">&\''), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;');
  const t = judgeTaicho({ orderer: 'public', direct: true, hasSubcontract: true, ictMeasure: false });
  const html = renderTaichoResult({ ...t, reasons: [{ ...t.reasons[0], action: '<script>x</script>' }] });
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;'));
});

test('入力が足りなければ、台帳は「判断できない」、入札前の確認は「確認が要る」と出る', () => {
  const input = readBidForm({});
  assert.match(renderTaichoResult(judgeTaicho(input)), /判断できない/);
  assert.match(renderBidResult(bidCheck(input)), /確認が要る/);
});

test('まとめたスクリプトは import・export を含まず、「</script」も含まない', () => {
  const js = bundle();
  assert.ok(!/^\s*(import|export)\b/m.test(js));
  assert.ok(!/<\/script/i.test(js));
  assert.ok(js.includes('startApp(document)'));
  new Function(js); // 構文として読める
  assert.ok(!buildHtml().includes('{{'));
});

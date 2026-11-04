// F37g: 「要る」の印に×を使わない。「確認が要る」の項目の数と「確認が要る点」の数が食い違って見えないよう、数え方と呼び名をそろえる。
// この環境にはブラウザが無いので、見た目は測れない。描いた HTML と、本物の判定の結果で確かめる
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildHtml } from '../../build.mjs';
import { bidCheck } from '../../src/bid-check.mjs';
import { SAMPLE } from '../../src/sample.mjs';
import { displayStatus, needsCheckPoints, openItems } from '../../src/ui/answers.mjs';
import { readBidForm } from '../../src/ui/form.mjs';
import { renderBidResult, renderOpenItems, renderSummary, statusBadge, STATUS_MARK } from '../../src/ui/view.mjs';
import { runPage } from '../acceptance/_helpers.mjs';

const html = buildHtml();
const plain = (s) => s.replace(/<[^>]+>/g, '');
const form = (over) => ({ ...SAMPLE.form, ...over });
const shown = (bid, values) => ({
  summary: plain(renderSummary({ values, bid })).match(/確認が要る点 (\d+)件/)?.[1] ?? '0',
  bid: plain(renderBidResult(bid, values)).match(/確認が要る点\((\d+)件\)/)?.[1] ?? '0',
  open: plain(renderOpenItems(bid, values)).match(/確認が要る点\((\d+)件\)/)?.[1],
});

test('印: 要るは ×の仲間を使わず ●。4つの状態の印はどれも違い、言葉を必ず添える', () => {
  assert.deepEqual(STATUS_MARK, { required: '●', needs_check: '!', not_required: '✓', unanswered: '?' });
  assert.equal(new Set(Object.values(STATUS_MARK)).size, 4);
  assert.ok(!/[×✕✖✗xX]/.test(Object.values(STATUS_MARK).join('')));
  assert.equal(plain(statusBadge('required')), '● 要る');
  assert.ok(statusBadge('required').includes('aria-hidden="true"'), '印を読み上げに渡している');
});

test('見本: 画面の結果に ✕ が出ず、印は ●。「確認が要る」0項目と確認が要る点 1件の違いを文で示す', () => {
  const values = SAMPLE.form;
  const bid = bidCheck(readBidForm(values));
  const sum = plain(renderSummary({ values, bid }));
  assert.match(sum, /● 要る 6項目/);
  assert.match(sum, /! 確認が要る 0項目/);
  assert.match(sum, /確認が要る点 1件を入札前の確認の欄に出しています。うち 1件は、結論の出た項目について確かめる点です/);
  const out = renderBidResult(bid, values);
  assert.ok(!(out + renderSummary({ values, bid })).includes('✕'));
  assert.match(out, /<h3>確認が要る点\(1件\)<\/h3><p class="points-note">うち 1件は、結論の出た項目/);
});

test('数え方: まとめ・入札前の確認・最後の一覧の「確認が要る点」は、どの条件でも同じ数', () => {
  const cases = [
    SAMPLE.form,
    form({ license: 'ippan', 'engineer-qualification': 'shunin' }), // 結論の出た項目についての確認が増える
    form({ 'work-type': 'unknown' }), // 「分からない」: 項目が「確認が要る」になる
    form({ license: '' }), // 未回答の質問が残る
    form({ orderer: '', 'work-type': '', 'contract-amount': '', license: '' }), // 未回答が多い
    form({ license: 'ippan', 'contract-amount': '' }), // 未回答の項目と、残る点が同時にある
    {},
  ];
  let unansweredSeen = 0;
  let differs = 0;
  for (const values of cases) {
    const bid = bidCheck(readBidForm(values));
    const points = needsCheckPoints(bid, values);
    const n = String(points.length);
    assert.deepEqual(shown(bid, values), { summary: n, bid: n, open: n });
    assert.deepEqual(openItems(bid, values).needsCheck, points);
    // 「確認が要る」の項目はすべて点に入り、差は結論の出た項目についての点だけ
    const items = bid.items.filter((it) => displayStatus(it, values) === 'needs_check').length;
    assert.equal(points.filter((p) => p.status === 'needs_check').length, items);
    assert.ok(points.every((p) => p.status !== 'unanswered'));
    if (points.length > 0 && bid.checks.length !== points.length) unansweredSeen += 1;
    if (points.length !== items) differs += 1;
  }
  assert.ok(unansweredSeen > 0, '未回答の項目を除きつつ点が残る場合を試せていない');
  assert.ok(differs > 0, '数が違う場合を試せていない');
});

test('説明の文: 数が同じときは出さず、未回答の項目は入札前の確認の一覧にも出さない', () => {
  const items = [{ key: 'a', label: '項目A', status: 'needs_check' }, { key: 'b', label: '項目B', status: 'required' }];
  const onlyItem = { items, checks: [{ key: 'a', label: '項目A', message: 'x' }], disclaimer: 'd' };
  assert.ok(!renderBidResult(onlyItem).includes('結論の出た項目'));
  assert.ok(!renderSummary({ bid: onlyItem }).includes('結論の出た項目'));
  const mixed = { ...onlyItem, checks: [...onlyItem.checks, { key: 'b', label: '項目B', message: 'y' }] };
  assert.match(plain(renderBidResult(mixed)), /確認が要る点\(2件\)うち 1件は/);
  // 欄の値を渡さないときは、判定の状態のまま全部数える
  assert.equal(needsCheckPoints(mixed).length, 2);
  // 項目に当たらない確認は「確認が要る」と数え、落とさない
  assert.deepEqual(needsCheckPoints({ items: [], checks: [{ key: 'z', label: 'Z', message: 'm' }] }, {}), [{ label: 'Z', message: 'm', status: 'needs_check' }]);

  const values = form({ 'work-type': '' });
  const bid = bidCheck(readBidForm(values));
  const hidden = bid.checks.filter((c) => !needsCheckPoints(bid, values).some((p) => p.label === c.label));
  assert.ok(hidden.length > 0);
  const list = renderBidResult(bid, values).match(/<ul class="checks">[\s\S]*?<\/ul>/)?.[0] ?? '';
  for (const c of hidden) assert.ok(!list.includes(c.label), '未回答の項目が確認が要る点に出ている: ' + c.label);
});

test('呼び名と画面の流れ: 「確認が要る項目」が残らず、見本を押して確認すると3か所の数がそろう', async () => {
  assert.ok(!html.includes('確認が要る項目'));
  assert.ok(html.includes('<h3 id="open-items-title">確認が要る点と未回答の質問</h3>'));
  const page = runPage(html);
  await page.click('sample-load');
  await page.click('bid-run');
  const sum = page.text('summary');
  assert.match(sum, /● 要る/);
  assert.match(sum, /確認が要る点 1件/);
  assert.match(page.text('bid-result'), /確認が要る点\(1件\)/);
  assert.match(page.text('open-items'), /確認が要る点\(1件\)/);
  assert.ok(!page.text('open-items').includes('確認が要る項目'));
});

test('07 の決まり: 外部の読み込みが無く、保存の API を足さず、断り書きと PDL が残り、index.html が build と一致する', () => {
  assert.equal(fs.readFileSync(new URL('../../index.html', import.meta.url), 'utf8'), html);
  assert.ok(!/<(script|link|img|iframe)\b[^>]*\b(src|href)=["']https?:/i.test(html));
  assert.match(html, /<meta http-equiv="Content-Security-Policy" content="default-src 'none'/);
  assert.ok(html.includes('id="disclaimer"') && html.includes('PDL1.0'));
  const src = ['src/ui/answers.mjs', 'src/ui/view.mjs'].map((f) => fs.readFileSync(new URL('../../' + f, import.meta.url), 'utf8')).join('\n');
  assert.ok(!/localStorage|sessionStorage|indexedDB|document\.cookie|fetch\(|XMLHttpRequest/.test(src));
});

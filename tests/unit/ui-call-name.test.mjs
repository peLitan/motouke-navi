// F83a1: 確かめる点(bid.checks)の数を指す所の呼び方を「確認が要る点」にそろえる。項目の札「確認が要る」は状態の名前なので残す
// この環境にはブラウザが無いので、見た目は測れない。組み立てた画面の文と、本物の判定の結果で確かめる
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildHtml } from '../../build.mjs';
import { bidCheck } from '../../src/bid-check.mjs';
import { SAMPLE } from '../../src/sample.mjs';
import { readBidForm } from '../../src/ui/form.mjs';
import { BID_STATUS, renderBidResult, renderResultTop, renderSummary } from '../../src/ui/view.mjs';
import { runPage } from '../acceptance/_helpers.mjs';

const NOTE_MARK = '項目の札「確認が要る」は、その項目の結論が確かめの答えで決まることを表します。';
const flat = (s) => s.replace(/\s+/g, ' ').trim();
const plain = (s) => flat(s.replace(/<[^>]+>/g, ' '));

async function sampleResult() {
  const page = runPage(buildHtml());
  await page.click('sample-load');
  await page.click('confirm-go');
  return {
    top: plain(page.el('result-top').innerHTML),
    summary: plain(page.el('summary').innerHTML),
    bid: plain(page.el('bid-result').innerHTML),
    open: plain(page.el('open-items').innerHTML),
    html: page.el('result-top').innerHTML + page.el('summary').innerHTML + page.el('bid-result').innerHTML + page.el('open-items').innerHTML,
  };
}

test('見本の結果: 数のカード・節・まとめの文・次にすることが「確認が要る点」で、カードの数と節の件数が同じ', async () => {
  const r = await sampleResult();
  const card = r.top.match(/! (\d+) (\S+) 自分で確かめる点\(件\)/);
  assert.ok(card, r.top);
  assert.equal(card[2], '確認が要る点');
  assert.equal(r.bid.match(/確認が要る点\((\d+)件\)/)?.[1], card[1]);
  assert.equal(r.open.match(/確認が要る点\((\d+)件\)/)?.[1], card[1]);
  assert.equal(r.summary.match(/確認が要る点 (\d+)件 ?を「確認が要る点と未回答の質問」に出しています/)?.[1], card[1]);
  assert.ok(r.top.includes('確認が要る点 ' + card[1] + '件を確かめる'), r.top);
  assert.ok(Number(card[1]) > 0, '見本で点が出ない形では呼び方を見られない');
});

test('見本の結果: 前の呼び方が画面に無い', async () => {
  const r = await sampleResult();
  const all = [r.top, r.summary, r.bid, r.open].join(' ');
  for (const old of ['確認が要る候補', '「確認が要る」の項目の数には入りません', '「確認が要る」の 2件', '労務費と処遇の確認(']) {
    assert.ok(!all.includes(old), '残っている: ' + old);
  }
  assert.ok(!r.bid.includes('うち 2件は、結論の出た項目について'), r.bid);
});

test('労務費と処遇の節の名前が、点の数に入れないことを言う', () => {
  const bid = bidCheck({ ...readBidForm(SAMPLE.form), direct: true, hasSubcontract: true });
  assert.ok(bid.duties.length > 0, 'この入力では労務費の候補が出るはず');
  assert.ok(renderBidResult(bid).includes('<h3 id="labor-duties">労務費と処遇の候補(確認が要る点の数に入れません)</h3>'));
});

test('札と点の関係の文は、点がある節に1回だけ出る。点が無ければ出さない', () => {
  const bid = bidCheck(readBidForm(SAMPLE.form));
  const count = (s) => s.split(NOTE_MARK).length - 1;
  const out = renderBidResult(bid, SAMPLE.form);
  assert.equal(count(out), 1);
  const section = out.slice(out.indexOf('<h3>確認が要る点('), out.indexOf('<ul class="checks">'));
  assert.ok(section.includes(NOTE_MARK), '節の見出しと一覧の間に無い: ' + section);
  assert.equal(count(renderSummary({ values: SAMPLE.form, bid })), 0);
  assert.equal(count(renderResultTop({ bid, values: SAMPLE.form })), 0);
  const none = renderBidResult({ ...bid, items: bid.items.map((it) => ({ ...it, status: 'required' })), checks: [] });
  assert.equal(count(none), 0);
});

test('まとめの注は「このうち n件は」の1文で、見出しの点を指すよう見出しのすぐ後に置く', () => {
  const items = [{ key: 'a', label: '項目A', status: 'needs_check' }, { key: 'b', label: '項目B', status: 'required' }];
  const mixed = { items, checks: [{ key: 'a', label: '項目A', message: 'x' }, { key: 'b', label: '項目B', message: 'y' }], disclaimer: 'd' };
  const out = renderBidResult(mixed);
  assert.ok(out.includes('<h3>確認が要る点(2件)</h3><p class="points-note">このうち 1件は、結論の出た項目の中で確かめる点です。</p>'), out);
  assert.ok(renderSummary({ bid: mixed }).includes('このうち 1件は、結論の出た項目の中で確かめる点です。'));
  const onlyItem = { ...mixed, checks: mixed.checks.slice(0, 1) };
  assert.ok(!renderBidResult(onlyItem).includes('このうち'));
});

test('項目の札とカード「要るものの候補」は変えない', async () => {
  assert.equal(BID_STATUS.needs_check, '確認が要る');
  const r = await sampleResult();
  assert.ok(r.top.includes('要るものの候補'));
  assert.ok(!r.summary.includes('! 確認が要る'), r.summary);
  assert.ok(renderSummary({ bid: { items: [{ key: 'a', label: '項目A', status: 'needs_check' }], checks: [] } }).includes('確認が要る'));
});

test('文書の節の名前も新しい呼び方で、前の呼び方が残らない', () => {
  for (const f of ['README.md', 'docs/manual.md']) {
    const s = fs.readFileSync(new URL('../../' + f, import.meta.url), 'utf8');
    assert.ok(s.includes('労務費と処遇の候補(確認が要る点の数に入れません)'), f);
    assert.ok(!s.includes('確認が要る候補'), f);
  }
});

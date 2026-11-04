// F14b: 結果の一番上の「まとめ」の枠(結論の件数と一覧・台帳の候補の数・目次の抜けの数・入れた条件)と、結論の印(色+記号+言葉)を確かめる
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildHtml } from '../../build.mjs';
import { runPage } from '../acceptance/_helpers.mjs';
import { renderSummary, renderBidResult, statusBadge, STATUS_MARK, bidItemId } from '../../src/ui/view.mjs';
import { SAMPLE } from '../../src/sample.mjs';
import { readBidForm } from '../../src/ui/form.mjs';
import { bidCheck } from '../../src/bid-check.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const html = buildHtml();
const body = html.slice(html.indexOf('<body>'));

test('まとめの枠は 1. の入力欄のすぐ後・入札前の確認の結果より前にあり、最初は隠してある', () => {
  const m = body.match(/<div id="summary" class="summary"[^>]*>/);
  assert.ok(m, 'まとめの枠が無い');
  assert.ok(/\shidden[\s>]/.test(m[0]), '結果を出す前から枠が見えている');
  const form = body.indexOf('</form>');
  const sum = body.indexOf('id="summary"');
  const bid = body.indexOf('id="bid-result"');
  assert.ok(form < sum && sum < bid, 'まとめの枠が結果の一番上に無い');
  assert.ok(sum < body.indexOf('id="check-result"') && sum < body.indexOf('id="plan-result"'));
});

test('結論の印は 要る=●・確認が要る=!・要らない=✓・未回答=?(F14f) で、言葉を必ず添える(色だけで区別しない)', () => {
  assert.deepEqual(STATUS_MARK, { required: '●', needs_check: '!', not_required: '✓', unanswered: '?' });
  for (const [st, word] of [['required', '要る'], ['needs_check', '確認が要る'], ['not_required', '要らない'], ['unanswered', '未回答']]) {
    const b = statusBadge(st);
    assert.ok(b.includes('class="badge badge-' + st + '"'));
    assert.ok(b.includes('>' + STATUS_MARK[st] + '</span>'), '記号が無い: ' + st);
    assert.ok(b.replace(/<[^>]+>/g, '').includes(word), '言葉が無い: ' + st);
  }
});

// 相対輝度とコントラスト比(WCAG 2.x の式)
const lum = (hex) => {
  const c = hex.replace('#', '').match(/../g).map((x) => parseInt(x, 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

test('印の色は 赤系・黄系・緑系で、文字と地のコントラストが 4.5:1 以上', () => {
  const hue = { required: 'r', needs_check: 'y', not_required: 'g' };
  for (const st of Object.keys(hue)) {
    const rule = html.match(new RegExp('\\.badge-' + st + ' \\{ color: (#[0-9a-f]{6}); background: (#[0-9a-f]{6}); border-color: (#[0-9a-f]{6}); \\}'));
    assert.ok(rule, '印の色の決まりが無い: ' + st);
    const [, fg, bg] = rule;
    assert.ok(ratio(fg, bg) >= 4.5, st + ' のコントラストが足りない: ' + ratio(fg, bg).toFixed(2));
    const [r, g, b] = fg.slice(1).match(/../g).map((x) => parseInt(x, 16));
    if (hue[st] === 'r') assert.ok(r > g && r > b, '要るの色が赤系でない');
    if (hue[st] === 'y') assert.ok(r > b && g > b, '確認が要るの色が黄系でない');
    if (hue[st] === 'g') assert.ok(g > r && g > b, '要らないの色が緑系でない');
  }
});

test('入札前の確認の各項目に、まとめから移るための id と印が付く', () => {
  const bid = bidCheck(readBidForm(SAMPLE.form));
  const out = renderBidResult(bid);
  for (const it of bid.items) {
    assert.ok(out.includes('id="' + bidItemId(it.key) + '"'), '項目の id が無い: ' + it.key);
  }
  assert.ok(out.includes('badge-required'));
});

test('renderSummary: 件数・一覧・台帳の候補・目次の抜け・入れた条件を出し、各結果へのページの中のリンクがある', () => {
  const bid = { items: [
    { key: 'a', label: '項目A', status: 'required' },
    { key: 'b', label: '項目B', status: 'needs_check' },
    { key: 'c', label: '項目C', status: 'not_required' },
    { key: 'd', label: '項目D', status: 'required' },
  ], checks: [{ key: 'b', label: '項目B', message: 'x' }] };
  const out = renderSummary({
    values: { orderer: 'private', direct: false, 'direct-sub': true, 'work-type': '', 'contract-amount': '1,000', 'subcontract-total': '', license: 'ippan', 'engineer-qualification': 'shunin', 'ict-measure': false },
    bid, taicho: { status: 'not_required' }, scheduleCount: 3,
    check: { candidates: [{}, {}, {}], undecidable: [{}] }, plan: { candidates: [{}, {}], undecidable: [] },
  });
  const text = out.replace(/<[^>]+>/g, '');
  assert.ok(out.startsWith('<h3 id="summary-title">まとめ</h3>'));
  assert.ok(/● 要る 2項目/.test(text) && /! 確認が要る 1項目/.test(text) && /✓ 要らない 1項目/.test(text), '件数が無い: ' + text);
  // 一覧は 要る → 確認が要る → 要らない の順
  const order = ['項目A', '項目D', '項目B', '項目C'].map((l) => out.indexOf('>' + l + '</a>'));
  assert.ok(order.every((v, i) => v > 0 && (i === 0 || v > order[i - 1])), '一覧の順が違う');
  for (const k of ['a', 'b', 'c', 'd']) assert.ok(out.includes('href="#bid-item-' + k + '"'));
  for (const id of ['bid-result', 'taicho-result', 'schedule-result', 'check-result', 'plan-result']) assert.ok(out.includes('href="#' + id + '"'), 'リンクが無い: ' + id);
  assert.ok(/抜け・食い違いの候補 3件、判断できない 1件/.test(text));
  assert.ok(/記載項目の抜けの候補 2件/.test(text));
  assert.ok(text.includes('作らなくてよい') && text.includes('3件'));
  // 入れた条件は 項目名と値の一覧(dl)
  const dl = out.match(/<dl class="summary-list">([\s\S]*?)<\/dl>/);
  assert.ok(dl, '入れた条件の一覧が無い');
  const pairs = [...dl[1].matchAll(/<dt>([^<]*)<\/dt><dd>([^<]*)<\/dd>/g)].map((m) => [m[1], m[2]]);
  assert.equal(pairs.length, 8);
  assert.deepEqual(pairs[0], ['発注者', '民間']);
  assert.deepEqual(pairs[1], ['元請けか下請けか', '下請け']);
  assert.deepEqual(pairs[2], ['工事の種類', '選んでいません']);
  assert.deepEqual(pairs[3], ['請負代金の見込み(税込み)', '1,000 円']);
  assert.deepEqual(pairs[4], ['下請けの総額(税込み)', '入れていません']);
});

test('renderSummary: まだ出していない結果は「まだ出していません」、入力の誤り・条件の変更はそう出す', () => {
  const empty = renderSummary({ values: {} }).replace(/<[^>]+>/g, '');
  assert.equal((empty.match(/まだ出していません/g) || []).length, 3);
  assert.ok(renderSummary({ values: {}, errors: ['x'] }).includes('入力を読めませんでした'));
  assert.ok(renderSummary({ values: {}, stale: true }).includes('条件が変わりました'));
  // 入れた文字はエスケープする
  assert.ok(!renderSummary({ values: { 'contract-amount': '<b>' } }).includes('<b>'));
});

test('画面を動かす: 見本を押すとまとめの枠が出て、台帳の候補・目次の抜けの数とリンク先の id が画面にある', async () => {
  const page = runPage(html);
  assert.equal(page.el('summary').hidden, true);
  await page.click('sample-load');
  const sum = page.el('summary');
  assert.equal(sum.hidden, false, '見本のあとにまとめが出ない');
  const t = page.text('summary');
  assert.ok(t.includes('まとめ') && /抜け・食い違いの候補\s*\d+\s*件/.test(t) && /記載項目の抜けの候補\s*\d+\s*件/.test(t), t);
  for (const m of sum.innerHTML.matchAll(/href="#([\w-]+)"/g)) {
    const id = m[1];
    const inPage = body.includes('id="' + id + '"') || page.el('bid-result').innerHTML.includes('id="' + id + '"');
    assert.ok(inPage, 'リンク先が画面に無い: ' + id);
  }
  // 入れた条件に見本の値が出る
  assert.ok(t.includes('公共') && t.includes(SAMPLE.form['contract-amount']));
  // 条件を変えるとまとめに「条件が変わりました」が出て、確認し直すと消える
  await page.set('contract-amount', '1000');
  assert.ok(page.text('summary').includes('条件が変わりました'));
  await page.click('bid-run');
  assert.ok(!page.text('summary').includes('条件が変わりました'));
  assert.ok(page.text('summary').includes('1000 円'));
});

test('07 の決まりは崩さない: 断り書き・PDL の表示・CSP で通信先無し・外部の読み込み無し・保存しない・index.html 1つ', () => {
  assert.ok(body.includes('id="disclaimer"'));
  assert.ok(body.includes('PDL1.0'));
  assert.match(html, /Content-Security-Policy" content="[^"]*default-src 'none'/);
  assert.match(html, /connect-src 'none'/);
  assert.ok(!/<(script|link|img)[^>]*\s(src|href)="https?:/i.test(html), '外部の読み込みがある');
  assert.ok(!/localStorage|sessionStorage|indexedDB|document\.cookie/.test(html), '入れた内容を保存するコードがある');
  assert.ok(!/<script[^>]*\ssrc=/i.test(html), '別ファイルのスクリプトを読んでいる');
  assert.equal(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'), html, 'index.html が作り直されていない');
});

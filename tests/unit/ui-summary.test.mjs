// F14b: 結果の一番上の「まとめ」の枠(結論の件数と一覧・台帳の候補の数・目次の抜けの数・入れた条件)と、結論の印(色+記号+言葉)を確かめる
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildHtml } from '../../build.mjs';
import { runPage } from '../acceptance/_helpers.mjs';
import { renderSummary, renderResultTop, renderBidResult, statusBadge, STATUS_MARK, SAFETY_MARK, bidItemId } from '../../src/ui/view.mjs';
import { SAMPLE } from '../../src/sample.mjs';
import { readBidForm } from '../../src/ui/form.mjs';
import { bidCheck } from '../../src/bid-check.mjs';
import { openPanelForLink } from '../../src/ui/app.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const html = buildHtml();
const body = html.slice(html.indexOf('<body>'));

test('結果の先頭は数字と次にすることのカード(#result-top)で、まとめの枠は安全の法令の候補の後。どちらも最初は隠してある', () => {
  const m = body.match(/<div id="summary" class="summary"[^>]*>/);
  assert.ok(m, 'まとめの枠が無い');
  assert.ok(/\shidden[\s>]/.test(m[0]), '結果を出す前から枠が見えている');
  assert.match(body, /<div id="result-top" hidden><\/div>/);
  const at = (id) => body.indexOf('id="' + id + '"');
  const order = ['bid-status', 'sample-banner', 'result-top', 'bid-fold', 'bid-result', 'schedule-result', 'safety-fold', 'open-items', 'summary', 'print-btn', 'next-step-3'];
  for (let i = 1; i < order.length; i++) assert.ok(at(order[i - 1]) >= 0 && at(order[i - 1]) < at(order[i]), order[i - 1] + ' → ' + order[i]);
  assert.ok(at('summary') < at('check-result') && at('summary') < at('plan-result'));
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
    // 色は :root の変数(F38a)。値に戻して比べる
    const rule = html.match(new RegExp('\\.badge-' + st + ' \\{ color: var\\((--[\\w-]+)\\); background: var\\((--[\\w-]+)\\); border-color: var\\((--[\\w-]+)\\); \\}'));
    assert.ok(rule, '印の色の決まりが無い: ' + st);
    const hexOfVar = (name) => { const v = html.match(new RegExp(name + ': (#[0-9a-f]{3,6});'))[1]; return v.length === 4 ? '#' + [...v.slice(1)].map((c) => c + c).join('') : v; };
    const fg = hexOfVar(rule[1]);
    const bg = hexOfVar(rule[2]);
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
  for (const id of ['open-items', 'taicho-result', 'schedule-result', 'check-result', 'plan-result']) assert.ok(out.includes('href="#' + id + '"'), 'リンクが無い: ' + id);
  assert.ok(/抜け・食い違いの候補 3件、判断できない 1件/.test(text));
  assert.ok(/記載項目の抜けの候補 2件/.test(text));
  assert.ok(text.includes('作らなくてよい') && text.includes('3件'));
  // 入れた条件は 項目名と値の一覧(dl)
  const dl = out.match(/<dl class="summary-list">([\s\S]*?)<\/dl>/);
  assert.ok(dl, '入れた条件の一覧が無い');
  const pairs = [...dl[1].matchAll(/<dt>([^<]*)<\/dt><dd>([^<]*)<\/dd>/g)].map((m) => [m[1], m[2]]);
  assert.equal(pairs.length, 9);
  assert.deepEqual(pairs[0], ['発注者', '民間']);
  assert.deepEqual(pairs[1], ['元請けか下請けか', '下請け']);
  assert.deepEqual(pairs[2], ['工事の種類', '選んでいません']);
  assert.deepEqual(pairs[3][0], '工種');
  assert.deepEqual(pairs[4], ['請負代金の見込み(税込み)', '1,000 円']);
  assert.deepEqual(pairs[5], ['下請けの総額(税込み)', '入れていません']);
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

const TOP_BID = { items: [
  { key: 'a', label: '項目A', status: 'required' },
  { key: 'b', label: '項目B', status: 'required' },
  { key: 'c', label: '項目C', status: 'not_required' },
], checks: [{ key: 'a', label: '項目A', message: '<確かめる>' }] };
const topText = (o) => o.replace(/<[^>]+>/g, '');

const statCards = (o) => [...o.matchAll(/<div class="stat stat-(\w+)"><span class="stat-num">([^<]*)<\/span><span class="stat-lab">([^<]*)<\/span><span class="stat-sub">([^<]*)<\/span>/g)].map((m) => m.slice(1));

test('数字のカード: 要るものの候補・確認が要る点・安全の法令の候補の3つで、押せない。安全は要るものに混ぜない', () => {
  const out = renderResultTop({ bid: TOP_BID, safety: { count: 3 } });
  const cards = statCards(out);
  assert.deepEqual(cards.map((c) => c.slice(0, 3)), [
    ['required', '● 2', '要るものの候補'],
    ['check', '! 1', '確認が要る点'],
    ['safety', SAFETY_MARK + ' 3', '安全の法令の候補'],
  ]);
  assert.ok(cards[0][3].includes('候補') && cards[2][3].includes('候補'), '件数の説明に「候補」が無い');
  assert.ok(!out.slice(0, out.indexOf('</ul>')).includes('href='), 'カードにリンクがある');
  // 問いに答える前の安全は 0件と言わない
  const none = topText(renderResultTop({ bid: TOP_BID, safety: { count: null } }));
  assert.ok(none.includes(SAFETY_MARK + ' −') && none.includes('問いに答えると出ます'));
});

test('数字のカード: 未回答が残り要る項目が無いときは「● 0」にせず「−」。要る項目があるか、全問に答えたら数を出す', () => {
  const NONE = { items: [{ key: 'c', label: '項目C', status: 'not_required' }], checks: TOP_BID.checks };
  const ALL_ANSWERED = { orderer: 'unknown', 'work-type': 'unknown', license: 'unknown', 'engineer-qualification': 'unknown', 'contract-amount-unknown': true, 'subcontract-total-unknown': true, 'direct-unknown': true };
  const first = (state) => statCards(renderResultTop(state))[0];
  assert.deepEqual(first({ bid: NONE, values: {} }), ['required', '−', '要るものの候補', '質問に答えると出ます']);
  assert.deepEqual(first({ bid: TOP_BID, values: {} }), ['required', '● 2', '要るものの候補', '受注したら要るものの候補(項目)。仮の一覧']);
  assert.deepEqual(first({ bid: NONE, values: ALL_ANSWERED }), ['required', '● 0', '要るものの候補', '受注したら要るものの候補(項目)']);
  assert.equal(first({ bid: NONE })[1], '● 0', '欄の値が無い形は未回答を数えていない');
  // ほかの2枚は変えない
  const rest = statCards(renderResultTop({ bid: NONE, values: {}, safety: { count: 3 } })).slice(1).map((c) => c.slice(0, 2));
  assert.deepEqual(rest, [['check', '! 1'], ['safety', SAFETY_MARK + ' 3']]);
});

test('スマホだけの4つ目の行(受注後の段取りの例)を外した: どの幅でも3つで、段取りの状態で数が増えない', () => {
  const noCount = renderResultTop({ bid: TOP_BID });
  assert.ok(noCount.includes('<ul class="stats" aria-label="結果の件数(候補)">'));
  assert.ok(!noCount.includes('phone-only'));
  assert.deepEqual([...noCount.matchAll(/<li><div class="stat stat-(\w+)"/g)].map((m) => m[1]), ['required', 'check', 'safety']);
  for (const state of [{ scheduleCount: 21 }, { scheduleCount: 0 }, { scheduleCount: null, scheduleNotRead: true }]) {
    assert.equal(statCards(renderResultTop({ bid: TOP_BID, ...state })).length, 3);
  }
  assert.ok(!noCount.includes('受注後の段取りの例'));
});

test('段取りの件数は段取りのページの頭の文にあり、表の件数と同じ', async () => {
  const page = runPage(html);
  await page.click('sample-load');
  const out = page.el('schedule-result').innerHTML;
  const shown = out.match(/<p class="schedule-lead"><strong>受注後の段取りは (\d+)件です<\/strong>/);
  assert.ok(shown, out.slice(0, 300));
  const table = out.match(/<summary>受注後の段取り\((\d+)件\)<\/summary>/);
  assert.ok(table, '段取りの表の見出しが無い');
  assert.equal(shown[1], table[1]);
  assert.ok(body.includes('id="pg-2-schedule"') && body.indexOf('id="schedule-result"') > body.indexOf('id="pg-2-schedule"'));
});

test('#schedule-result へ飛ぶと閉じた表も開く。querySelector の無い要素や表の無いときでも落ちない', () => {
  const table = { open: false };
  const asked = [];
  const target = { querySelector: (s) => { asked.push(s); return table; } };
  // F86d: 飛ぶとページも替わるので、段の要素は無い形にして飛び先の要素だけを渡す
  const only = (id, el) => ({ getElementById: (x) => (x === id ? el : null) });
  openPanelForLink(only('schedule-result', target), '#schedule-result');
  assert.equal(table.open, true);
  assert.deepEqual(asked, ['details.schedule-table']);
  // ほかの飛び先では開かない
  const other = { open: false };
  openPanelForLink(only('safety-fold', { querySelector: () => other }), '#safety-fold');
  assert.equal(other.open, false);
  openPanelForLink(only('schedule-result', {}), '#schedule-result');
  openPanelForLink(only('schedule-result', { querySelector: () => null }), '#schedule-result');
  openPanelForLink({ getElementById: () => null }, '#schedule-result');
});

test('次にすること: 誤り・条件の変更・元請けの実績・未回答・確認が要る点・無し の順に1つだけ出す。入れた文字はエスケープする', () => {
  const go = (o) => [topText(o.match(/<p class="next-title">([\s\S]*?)<\/p>/)[1]), o.match(/class="next-go" href="#([\w-]+)"/)[1]];
  assert.equal(renderResultTop({}), '');
  const err = renderResultTop({ errors: ['x'] });
  assert.deepEqual(go(err), ['次にすること: 金額の欄を直す', 'bid-form']);
  assert.ok(!err.includes('class="stats"'), '読めないときに数を出している');
  assert.deepEqual(go(renderResultTop({ bid: TOP_BID, stale: true })), ['次にすること: もう一度「確認する」を押す', 'bid-run']);
  // 元請けの実績の知らせ: 誤りと条件の変更より後、未回答と確認が要る点より先。checks の順にはよらない
  const PRIME_BID = { ...TOP_BID, checks: [...TOP_BID.checks, { key: 'prime-experience', label: '元請けの施工実績', message: '<知らせ>' }] };
  const PRIME_NEXT = ['次にすること: 元請けとしての施工実績が参加の条件です', 'open-items'];
  assert.deepEqual(go(renderResultTop({ errors: ['x'], bid: PRIME_BID })), ['次にすること: 金額の欄を直す', 'bid-form']);
  assert.deepEqual(go(renderResultTop({ bid: PRIME_BID, stale: true })), ['次にすること: もう一度「確認する」を押す', 'bid-run']);
  assert.deepEqual(go(renderResultTop({ bid: PRIME_BID, values: {} })), PRIME_NEXT);
  assert.deepEqual(go(renderResultTop({ bid: PRIME_BID })), PRIME_NEXT);
  assert.deepEqual(go(renderResultTop({ bid: TOP_BID, values: {} })).slice(1), ['bid-form']);
  assert.match(go(renderResultTop({ bid: TOP_BID, values: {} }))[0], /^次にすること: 未回答の質問 \d+つに答える$/);
  const check = renderResultTop({ bid: { ...TOP_BID, checks: [{ key: 'a', label: '<確かめる>', message: '文' }] } });
  assert.deepEqual(go(check), ['次にすること: 確認が要る点 1件を確かめる', 'open-items']);
  assert.ok(check.includes('&lt;確かめる&gt;') && !check.includes('<確かめる>'));
  assert.deepEqual(go(renderResultTop({ bid: { ...TOP_BID, checks: [] } })), ['次にすること: 書類を確かめる', 'panel-3']);
  assert.ok(body.includes('id="bid-run"') && body.includes('id="bid-form"') && body.includes('id="panel-3"'));
});

test('要る項目のカード: 結論は閉じず、理由と根拠は「根拠を見る」の中。結論の順に並ぶ', () => {
  const out = renderBidResult(bidCheck(readBidForm(SAMPLE.form)), SAMPLE.form);
  const items = [...out.matchAll(/<li class="item status-[\s\S]*?<\/details><\/li>/g)].map((m) => m[0]);
  assert.equal(items.length, 6);
  for (const h of items) {
    const head = h.slice(0, h.indexOf('<details'));
    assert.ok(head.includes('class="badge') && !head.includes('理由:'), '結論の外に理由がある');
    assert.match(h, /<details class="basis"><summary>根拠を見る: /);
  }
  const mixed = renderBidResult({ items: [{ key: 'n', label: 'いらない', status: 'not_required', basis: [] }, { key: 'r', label: 'いる', status: 'required', basis: [] }], checks: [] });
  assert.ok(mixed.indexOf('いる') < mixed.indexOf('いらない'), '要るが先に来ない');
  assert.ok(mixed.includes('<summary>理由を見る</summary>') && mixed.includes('根拠: 無し'));
});

test('確認が要る点に左右される「要る」はそう書く。左右されない確認は言い切らない', () => {
  const item = (key) => ({ key, label: key, status: 'required', basis: [] });
  const out = renderBidResult({ items: [item('a'), item('b'), item('c')], checks: [{ key: 'a', label: 'a', message: 'x', changes: true }, { key: 'b', label: 'b', message: 'y' }] });
  const parts = out.split('<li class="item').slice(1);
  assert.ok(parts[0].includes('この「要る」は') && parts[0].includes('答えで変わることがあります') && parts[0].includes('href="#open-items"'));
  assert.ok(parts[1].includes('この項目には') && !parts[1].includes('変わることがあります'));
  assert.ok(!parts[2].includes('item-depends'));
  // 見本は 専任の項目だけが左右される。判定の側が印を付ける
  const bid = bidCheck(readBidForm(SAMPLE.form));
  assert.deepEqual(bid.checks.filter((c) => c.changes).map((c) => c.key), ['dedicated']);
  assert.equal((renderBidResult(bid, SAMPLE.form).match(/item-depends/g) ?? []).length, 1);
  // 確認が要るの項目そのものには書かない(札がそう言っている)
  assert.ok(!renderBidResult({ items: [{ key: 'a', label: 'a', status: 'needs_check', basis: [] }], checks: [{ key: 'a', label: 'a', message: 'x' }] }).includes('item-depends'));
});

test('まとめの開くカード: 台帳と目次は候補の件数つき、入れた条件も開くカード。項目の一覧は紙にだけ出す', () => {
  const closed = renderSummary({ values: {} });
  assert.match(closed, /<details class="open-card" id="summary-docs"><summary><span>台帳と目次の点検の候補<\/span> <span class="open-count">まだ<\/span>/);
  const out = renderSummary({ values: {}, check: { candidates: [{}, {}], undecidable: [] }, plan: { candidates: [{}, {}, {}], undecidable: [] } });
  assert.ok(out.includes('<span class="open-count">5件</span>'));
  assert.match(out, /<details class="open-card" id="summary-conditions"><summary><span>入れた条件<\/span>/);
  const withBid = renderSummary({ values: {}, bid: TOP_BID });
  assert.ok(withBid.includes('<ul class="summary-items print-only">'));
});

test('画面を動かす: 見本のあとに先頭のカードが出て、飛ぶ先が閉じた折りたたみなら開き、見本を消すと隠れる', async () => {
  const page = runPage(html);
  assert.equal(page.el('result-top').hidden, true);
  await page.click('sample-load');
  assert.equal(page.el('result-top').hidden, false);
  const t = page.text('result-top');
  assert.ok(t.includes('● 6') && t.includes('! 2') && t.includes('次にすること'), t);
  await page.set('contract-amount', '1000');
  assert.ok(page.text('result-top').includes('もう一度「確認する」を押す'));
  await page.click('sample-reenter');
  assert.equal(page.el('result-top').hidden, true);
  assert.equal(page.el('result-top').innerHTML, '');

  const outer = { open: false };
  const inner = { open: false, parentElement: { closest: () => outer } };
  const target = { closest: (s) => (s === 'details' ? inner : null) };
  openPanelForLink({ getElementById: () => target }, '#x');
  assert.ok(inner.open && outer.open, '閉じた折りたたみが開かない');
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

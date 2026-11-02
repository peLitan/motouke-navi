// F14f: 聞き方と結果の順。質問に「分からない」を置き、選んだ質問を使う項目は「確認が要る」にする。状態は 要る/要らない/確認が要る/未回答。
// 未回答が残るうちは「仮の一覧」。各項目は 結論 → 理由(入れた条件)→ 根拠の条 → 確かめ先 の順。確かめ先は根拠の原文に書かれた相手だけ。
// 冒頭に見ている法令・見ていない法令と資料。結果の最後に「確認が要る項目」と「未回答」。印刷の最後に「確認した人・日付」の空欄
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildHtml } from '../../build.mjs';
import { runPage } from '../acceptance/_helpers.mjs';
import { readBidForm, formErrors } from '../../src/ui/form.mjs';
import { bidCheck } from '../../src/bid-check.mjs';
import { renderBidResult, renderOpenItems, renderSummary, BID_STATUS } from '../../src/ui/view.mjs';
import { answerState, displayStatus, QUESTIONS, CONTACTS, ITEM_DEPS, openItems } from '../../src/ui/answers.mjs';
import quotesData from '../../data/quotes.json' with { type: 'json' };
import sourcesData from '../../data/sources/index.json' with { type: 'json' };

const shell = fs.readFileSync(new URL('../../src/ui/shell.html', import.meta.url), 'utf8');
const css = shell.match(/<style>([\s\S]*?)<\/style>/)[1].replace(/\/\*[\s\S]*?\*\//g, '');
const printCss = css.match(/@media print \{([\s\S]*)\n {2}\}/)[1];
const screenCss = css.replace(/@media print \{[\s\S]*\n {2}\}/, '');
const html = buildHtml();
const body = html.split('<body>')[1].replace(/<script\b[\s\S]*?<\/script>/g, '');
const text = (h) => h.replace(/<[^>]+>/g, '');
const quote = (id) => quotesData.quotes.find((q) => q.id === id).text;
// 結果の中の1つの項目(中に根拠の li があるので、次の項目か一覧の終わりまでを取る)
const itemHtml = (out, key) => out.match(new RegExp('id="bid-item-' + key + '"[\\s\\S]*?(?=<li class="item|</ul><h3>)'))[0];

// 全部に答えた条件(架空)
const FULL = { orderer: 'public', direct: true, 'work-type': 'other', 'contract-amount': '300,000,000', 'subcontract-total': '60,000,000', license: 'tokutei', 'engineer-qualification': 'kanri', 'ict-measure': false };

test('質問に「分からない」がある。選ぶと判定には null を渡し、入力の誤りにしない', () => {
  const form = body.match(/<form id="bid-form"[\s\S]*?<\/form>/)[0];
  for (const id of ['orderer', 'work-type', 'license', 'engineer-qualification']) {
    const sel = form.match(new RegExp('<select id="' + id + '"[\\s\\S]*?</select>'))[0];
    assert.match(sel, /<option value="unknown">分からない<\/option>/, id + ' に「分からない」が無い');
  }
  assert.match(form, /<input type="radio" id="direct-unknown" name="role" value="unknown"><label for="direct-unknown">分からない<\/label>/);
  for (const id of ['contract-amount', 'subcontract-total']) assert.match(form, new RegExp('<input type="checkbox" id="' + id + '-unknown"[^>]*><label for="' + id + '-unknown">分からない</label>'));
  const v = { ...FULL, orderer: 'unknown', direct: false, 'direct-unknown': true, 'contract-amount': 'あいう', 'contract-amount-unknown': true, 'subcontract-total-unknown': true };
  const input = readBidForm(v);
  assert.equal(input.orderer, null);
  assert.equal(input.direct, null);
  assert.equal(input.contractAmount, null);
  assert.equal(input.subcontractTotal, null);
  assert.equal(input.hasSubcontract, null);
  assert.deepEqual(formErrors(v), [], '「分からない」の金額の欄の文字を誤りにしている');
});

test('答えの状態: 答えた / 分からない / 未回答 を分ける', () => {
  assert.equal(answerState({}, 'orderer'), 'unanswered');
  assert.equal(answerState({ orderer: 'unknown' }, 'orderer'), 'unknown');
  assert.equal(answerState({ orderer: 'private' }, 'orderer'), 'answered');
  assert.equal(answerState({ 'direct-unset': true }, 'direct'), 'unanswered');
  assert.equal(answerState({ 'direct-sub': true }, 'direct'), 'answered');
  assert.equal(answerState({ 'direct-unknown': true }, 'direct'), 'unknown');
  assert.equal(answerState({ 'subcontract-total': '0' }, 'subcontract-total'), 'answered');
  assert.equal(answerState({ 'subcontract-total': '' }, 'subcontract-total'), 'unanswered');
  assert.equal(answerState({ 'subcontract-total': '5', 'subcontract-total-unknown': true }, 'subcontract-total'), 'unknown');
  // 項目が使う質問は、判定が読む入力と同じ名前の欄(知らない欄の名前が混ざっていない)
  for (const deps of Object.values(ITEM_DEPS)) for (const id of deps) assert.ok(QUESTIONS.some((q) => q.id === id), id);
});

test('「分からない」を選んだ質問を使う項目は「確認が要る」、未回答の質問を使う項目は「未回答」。決められた項目はそのまま', () => {
  // 工事の種類だけ「分からない」: 金額の境目が決まらない項目は 確認が要る(未回答にしない)
  const vu = { ...FULL, 'work-type': 'unknown' };
  const bu = bidCheck(readBidForm(vu));
  const st = Object.fromEntries(bu.items.map((it) => [it.key, displayStatus(it, vu)]));
  assert.equal(st['tokutei-license'], 'needs_check');
  assert.equal(st.dedicated, 'needs_check');
  assert.ok(!Object.values(st).includes('unanswered'));
  const ru = renderBidResult(bu, vu);
  assert.ok(!text(ru).includes('仮の一覧'), '未回答が無いのに仮の一覧と出している');
  // 工事の種類が未回答: 同じ項目が 未回答 になり、結果は「仮の一覧」
  const vn = { ...FULL, 'work-type': '' };
  const bn = bidCheck(readBidForm(vn));
  const stn = Object.fromEntries(bn.items.map((it) => [it.key, displayStatus(it, vn)]));
  assert.equal(stn['tokutei-license'], 'unanswered');
  assert.equal(stn.dedicated, 'unanswered');
  const rn = text(renderBidResult(bn, vn));
  assert.match(rn, /仮の一覧です。未回答の質問が 1つあります\(工事の種類\)/);
  assert.match(rn, /未回答の質問\(工事の種類\)に答えると、決まることがあります/);
  // 決められた項目(発注者から直接・下請け 0 → 特定の許可は要らない)は、ほかの質問が未回答でもそのまま
  const vd = { direct: true, 'subcontract-total': '0' };
  const bd = bidCheck(readBidForm(vd));
  assert.equal(displayStatus(bd.items.find((it) => it.key === 'tokutei-license'), vd), 'not_required');
  // 状態の言葉は4つ
  assert.deepEqual(Object.values(BID_STATUS), ['要る', '要らない', '確認が要る', '未回答']);
});

test('各項目は 結論 → 理由(入れた条件)→ 根拠の条 → 確かめ先 の順', () => {
  const bid = bidCheck(readBidForm(FULL));
  const out = renderBidResult(bid, FULL);
  const items = [...out.matchAll(/<li class="item[\s\S]*?(?=<li class="item|<\/ul><h3>)/g)].map((m) => m[0]);
  assert.equal(items.length, bid.items.length);
  for (const h of items) {
    const at = (re) => h.search(re);
    const pos = [at(/class="badge/), at(/>理由:</), at(/>入れた条件:</), at(/<details class="basis"|class="basis-none"/), at(/>確かめ先:</)];
    const label = text(h).slice(0, 20);
    if (h.includes('badge-not_required')) pos.pop(); // 要らない項目には確かめ先を出さない
    for (const p of pos) assert.ok(p >= 0, '欠けている: ' + label + ' ' + pos);
    for (let i = 1; i < pos.length; i++) assert.ok(pos[i - 1] < pos[i], '順が違う: ' + label + ' ' + pos);
  }
  // 入れた条件には、その項目が使う質問の答えが出る
  const ded = items.find((h) => h.includes('id="bid-item-dedicated"'));
  assert.match(text(ded), /入れた条件: 発注者 公共、請負代金の見込み 300,000,000円\(税込み\)、工事の種類 それ以外の工事/);
});

test('確かめ先は根拠の原文に書かれた相手だけ。原文に相手が無い項目は「出していません」', () => {
  // 表の相手の言葉が、挙げた抜き書きの原文にある
  for (const [key, f] of Object.entries(CONTACTS)) {
    for (const o of ['public', 'private', null]) {
      for (const c of f(o)) {
        const q = quote(c.quoteId);
        if (/国土交通大臣/.test(c.to)) assert.ok(q.includes('国土交通大臣') && q.includes('都道府県知事'), key);
        if (c.to === '発注者') assert.ok(q.includes('発注者に提出') || q.includes('発注者の閲覧'), key + ' ' + c.quoteId);
      }
    }
  }
  const pub = bidCheck(readBidForm(FULL));
  const t = text(renderBidResult(pub, FULL));
  assert.match(t, /確かめ先: 許可をした行政庁\(営業所が二以上の都道府県にあれば国土交通大臣/);
  assert.match(t, /確かめ先: 発注者 — 台帳の写しを出すか[^(]*\([^)]*\)にするか\(入契法 第15条第2項の原文による\)/);
  assert.match(t, /確かめ先: 根拠の原文に相手の定めが無いので、出していません。/);
  // 民間の台帳は 第24条の8第3項(発注者の閲覧)。写しを出す項目には相手を出さない(民間には写しの定めが無い)
  const pv = { ...FULL, orderer: 'private', license: 'tokutei', 'subcontract-total': '60,000,000' };
  const pvOut = renderBidResult(bidCheck(readBidForm(pv)), pv);
  const taicho = itemHtml(pvOut, 'taicho');
  assert.match(text(taicho), /確かめ先: 発注者 — 発注者から請求があったときに台帳を見せる.*建設業法 第24条の8第3項の原文による/);
  // 発注者が未回答なら、台帳の確かめ先は決めない
  const nv = { ...FULL, orderer: '' };
  const nvOut = renderBidResult(bidCheck(readBidForm(nv)), nv);
  assert.match(text(itemHtml(nvOut, 'taicho')), /確かめ先: 発注者が公共か民間かで根拠の条が変わるので、「発注者」に答えると出します/);
});

test('結果の最後に「確認が要る項目」と「未回答」の一覧。まとめの枠も未回答を数える', () => {
  const v = { ...FULL, license: '', 'engineer-qualification': '', 'contract-amount-unknown': true };
  const bid = bidCheck(readBidForm(v));
  const o = openItems(bid, v);
  assert.deepEqual(o.unanswered.map((q) => q.name), ['元請けの許可の種類', '置ける技術者の資格']);
  assert.deepEqual(o.unknown.map((q) => q.name), ['請負代金の見込み']);
  const t = text(renderOpenItems(bid, v));
  assert.match(t, /確認が要る項目\(\d+件\)/);
  assert.match(t, /技術者を専任で置く必要があるか: 請負代金の見込み/);
  assert.match(t, /「分からない」を選んだ質問: 請負代金の見込み\(使う項目: 技術者を専任で置く必要があるか\)/);
  assert.match(t, /未回答\(2問\)元請けの許可の種類/);
  const s = text(renderSummary({ values: v, bid }));
  assert.match(s, /仮の一覧です\(未回答の質問 2つ\)/);
  assert.match(s, /請負代金の見込み\(税込み\)分からない/);
  // 全部に答えれば「仮の一覧」は出ない
  assert.ok(!text(renderSummary({ values: FULL, bid: bidCheck(readBidForm(FULL)) })).includes('仮の一覧'));
});

test('画面を動かす: 未回答と「分からない」を残して確認すると、仮の一覧と最後の一覧が出る。全部に答えると消える', async () => {
  const page = runPage();
  for (const [k, v] of Object.entries({ orderer: 'public', 'work-type': 'unknown', 'contract-amount': '300,000,000', 'subcontract-total': '60,000,000', 'engineer-qualification': 'kanri' })) await page.set(k, v);
  await page.set('direct', true);
  await page.click('bid-run');
  assert.match(page.text('bid-result'), /仮の一覧/);
  const open = page.text('open-items');
  assert.match(open, /元請けの許可の種類/);
  assert.match(open, /「分からない」を選んだ質問: 工事の種類/);
  assert.match(page.text('summary'), /仮の一覧/);
  await page.set('license', 'tokutei');
  await page.click('bid-run');
  assert.ok(!/仮の一覧/.test(page.text('bid-result')));
  assert.match(page.text('open-items'), /未回答\(0問\)/);
});

test('冒頭に「このツールが見ている法令・資料」と「見ていない法令・資料」', () => {
  const head = body.split('<main')[0];
  const seen = head.match(/<ul id="scope-seen">([\s\S]*?)<\/ul>/)[1];
  for (const s of sourcesData.sources) assert.ok(seen.includes(s.title.replace(/&/g, '&amp;')), '見ている法令に無い: ' + s.id);
  const not = text(head.match(/<ul id="scope-not">([\s\S]*?)<\/ul>/)[1]);
  for (const w of ['条例', '契約書', '特記仕様書', '国土交通省令']) assert.ok(not.includes(w), '見ていない資料に無い: ' + w);
});

test('印刷の版の最後に「確認した人・日付」の空欄(画面には出さない)', () => {
  const after = body.split('</footer>')[1];
  assert.match(after, /<div id="sign-off" class="print-only sign-off"/);
  assert.match(text(after), /確認した人\s*日付/);
  assert.match(after, /<th scope="row">確認した人<\/th><td><\/td>/);
  assert.match(screenCss, /\.print-only \{ display: none; \}/);
  assert.match(printCss, /\.print-only \{ display: block; \}/);
});

test('07 の決まり: 外部の読み込み・通信・保存が無く、断り書きと PDL の表示を常に出す。index.html 1つ', () => {
  assert.ok(!/<(script|link|img|iframe)\b[^>]*\b(src|href)=["']https?:/i.test(html), '外部の読み込みがある');
  assert.ok(!/@import|url\(/.test(css), 'CSS で外部を読んでいる');
  assert.ok(!/\bfetch\(|XMLHttpRequest|WebSocket|localStorage|sessionStorage|indexedDB/.test(html), '通信か保存の処理がある');
  assert.match(html, /connect-src 'none'/);
  assert.ok(body.includes('id="disclaimer"'));
  assert.ok(body.includes('PDL1.0'));
  assert.equal(fs.readFileSync(new URL('../../index.html', import.meta.url), 'utf8'), html, 'index.html を作り直していない');
});

// F86e: 結果の最初のページを要点にする。工事の名前・押せない数のカード3つ・次にすること1つ・1行の知らせ。
// ブラウザが無いので、1画面に収まるかは測らない(Edge の確かめは統括)。ここでは組み立てた画面の HTML・CSS と、押したときの hidden を見る
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHtml } from '../../build.mjs';
import { runPage } from '../acceptance/_helpers.mjs';
import { BID_FORM_IDS } from '../../src/ui/form.mjs';
import { SAMPLE } from '../../src/sample.mjs';

const html = buildHtml();
const body = html.slice(html.indexOf('<body>')).replace(/<script\b[\s\S]*?<\/script>/g, '');
const css = html.match(/<style>([\s\S]*?)<\/style>/)[1].replace(/\/\*[\s\S]*?\*\//g, '');
const screenCss = css.slice(0, css.indexOf('@media print'));
const topPage = body.slice(body.indexOf('id="pg-2-top"'), body.indexOf('id="pg-2-need"'));
const PRIME = '（４）平成２２年度以降に元請けとして完成・引き渡しが完了した以下の要件を満たす同種工事の施工実績を有すること。';
// 判定が確認の要る点を1つも出さない架空の条件(無しの枝)
const NO_POINTS = { orderer: 'public', direct: true, 'work-type': 'other', license: 'tokutei', 'engineer-qualification': 'kanri', 'contract-amount': '10,000,000', 'subcontract-total': '0' };

const go = async (page) => { await page.click('bid-run'); await page.click('confirm-go'); };
async function fill(fields) {
  const page = runPage(html);
  await page.click('entry-bid');
  for (const [id, v] of Object.entries(fields)) await page.set(id, v);
  await go(page);
  return page;
}
async function samplePage() {
  const page = runPage(html);
  await page.click('sample-load');
  await page.click('confirm-go');
  return page;
}
const topHtml = (page) => page.el('result-top').innerHTML;
const nextHref = (page) => topHtml(page).match(/class="next-go" href="#([\w-]+)"/)[1];
const nextTitle = (page) => topHtml(page).match(/<p class="next-title">([\s\S]*?)<\/p>/)[1];
// #main の中のリンクを押す。受けるのは #main なので、押された要素の形だけ渡す
const clickLink = async (page, id) => {
  page.el('main').dispatchEvent({ type: 'click', bubbles: true, target: { closest: () => ({ getAttribute: () => '#' + id }) }, preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {} });
  await new Promise((r) => setTimeout(r));
};
const pressNext = (page) => clickLink(page, nextHref(page));
const shown = (page, panel, pg) => {
  assert.equal(page.el(panel).hidden, false, panel + ' が隠れている');
  assert.equal(page.el(pg).hidden, false, pg + ' が隠れている');
};
const atTop = (page) => { shown(page, 'panel-2', 'pg-2-top'); assert.equal(page.el('entry').hidden, true); };

// nextStep の6つの枝(07 の F86e)。title は枝の取り違えを防ぐ印
const BRANCHES = [
  ['誤り', () => fill({ 'contract-amount': 'abc' }), /金額の欄を直す/, 'bid-form', 'panel-1', 'pg-1-amount'], // F86g: 欄のページへ着く
  ['条件の変更', async () => { const p = await samplePage(); await p.set('contract-amount', '40,000,000'); return p; }, /もう一度「確認する」を押す/, 'bid-run', 'panel-1', 'pg-1-notice'], // F86g: 「確認する」は条件の最後のページの席
  ['元請けの実績', () => fill({ 'participation-conditions': PRIME }), /元請けとしての施工実績/, 'open-items', 'panel-2', 'pg-2-open'],
  ['未回答', () => fill({}), /未回答の質問 \d+つに答える/, 'bid-form', 'panel-1', 'pg-1'],
  ['確認が要る点', samplePage, /確認が要る点 \d+件を確かめる/, 'open-items', 'panel-2', 'pg-2-open'],
  ['無し', () => fill(NO_POINTS), /書類を確かめる/, 'panel-3', 'panel-3', 'pg-3'],
];

test('要点のページの並び: 見出し・全文の知らせ(隠すときは画面の外)・工事の名前・1行の知らせ・カードと次にすること', () => {
  const at = ['id="result-title"', 'id="bid-status"', 'id="result-name"', 'id="result-flag"', 'id="result-top"'].map((s) => topPage.indexOf(s));
  assert.ok(at.every((x) => x >= 0), JSON.stringify(at));
  assert.deepEqual(at, [...at].sort((a, b) => a - b));
  // 紙の中身を変えないので、足した2つは紙に出さない。読み上げは #bid-status の全文だけにする
  assert.match(topPage, /<p id="result-name" class="no-print" hidden>/);
  assert.match(topPage, /<p id="result-flag" class="no-print" aria-hidden="true" hidden>/);
});

test('工事の名前の欄を足していない', () => {
  assert.ok(!BID_FORM_IDS.some((id) => /name|title|project/.test(id)), BID_FORM_IDS.join(' '));
  const form = body.slice(body.indexOf('id="bid-form"'), body.indexOf('</form>'));
  assert.ok(!/工事の名前|工事名/.test(form));
});

test('カード: 3つで、押せない。スマホだけの4つ目は無い', async () => {
  for (const page of [await samplePage(), await fill({})]) {
    const top = topHtml(page);
    const stats = top.slice(top.indexOf('<ul class="stats"'), top.indexOf('</ul>'));
    assert.equal((stats.match(/class="stat stat-/g) ?? []).length, 3, stats);
    assert.ok(!/href=|<a\b|<button/.test(stats), stats);
    assert.ok(!stats.includes('phone-only') && !stats.includes('stat-schedule'), stats);
    assert.deepEqual([...stats.matchAll(/class="stat stat-(\w+)"/g)].map((m) => m[1]), ['required', 'check', 'safety']);
  }
});

test('カードは押せる見た目にしない: 下線も hover の色も無い。段取りの4つ目の決まりも残さない', () => {
  assert.ok(!/\.stat-lab\s*\{[^}]*underline/.test(screenCss));
  assert.ok(!/\.stat:hover/.test(css));
  assert.ok(!css.includes('stat-schedule'));
});

test('次にすることのボタンは1つで、カードの中の押せる物はそれだけ。6つの枝のどれでも同じ', async () => {
  for (const [name, make] of BRANCHES) {
    const page = await make();
    const top = topHtml(page);
    assert.equal((top.match(/class="next-go"/g) ?? []).length, 1, name);
    assert.equal((top.match(/<a\b|<button\b/g) ?? []).length, 1, name);
    assert.equal((top.match(/class="next-title"/g) ?? []).length, 1, name);
  }
});

test('塗りのボタンは1つ: 要点のページだけ右の席が白地で、ほかのページは塗りのまま', async () => {
  const page = await samplePage();
  const plain = () => page.el('pager').classList.contains('seat-plain');
  assert.equal(page.el('pg-next').hidden, false);
  assert.equal(plain(), true, '要点で白地でない');
  await page.click('pg-next');
  assert.equal(plain(), false, '要るもので白地のまま');
  await page.click('pg-back');
  assert.equal(plain(), true);
  await page.click('pg-back');
  assert.equal(plain(), false, '確かめで白地のまま');
  const rule = screenCss.match(/#pager\.seat-plain #pg-next \{([^}]*)\}/);
  assert.ok(rule, '白地の決まりが無い');
  assert.match(rule[1], /background: var\(--paper\)/);
  assert.match(rule[1], /color: var\(--primary\)/);
  assert.match(screenCss, /#pager\.seat-plain #pg-next:hover[^{]*\{[^}]*background: var\(--primary-bg\)/);
});

for (const [name, make, title, href, panel, pg] of BRANCHES) {
  test('次にすること(' + name + '): 飛ぶと着いたページが見え、「戻る」は要点へ帰る', async () => {
    const page = await make();
    atTop(page);
    assert.match(nextTitle(page), title);
    assert.equal(nextHref(page), href);
    await pressNext(page);
    shown(page, panel, pg);
    if (panel !== 'panel-2') assert.equal(page.el('panel-2').hidden, true);
    assert.equal(page.el('pager').hidden, false);
    await page.click('pg-back');
    atTop(page);
  });
}

test('条件の変更で飛んだ先の右の席は「確認する」', async () => {
  const page = await samplePage();
  await page.set('contract-amount', '40,000,000');
  await pressNext(page);
  assert.equal(page.el('bid-run').hidden, false);
  assert.equal(page.el('pg-next').hidden, true);
});

test('戻るの要点は飛んだ直後だけ: 次へで進むと前のページへ戻り、2回目の戻るは順のとおり', async () => {
  const page = await samplePage();
  await pressNext(page); // 確認が要る点(3/7)
  await page.click('pg-next'); // 受注後の段取り(4/7)
  await page.click('pg-back');
  shown(page, 'panel-2', 'pg-2-open');
  await page.click('pg-back');
  shown(page, 'panel-2', 'pg-2-need');
});

test('要点へ帰った後の戻るは確かめへ。飛んだことを覚えたままにしない', async () => {
  const page = await samplePage();
  await pressNext(page);
  await page.click('pg-back');
  atTop(page);
  await page.click('pg-back');
  assert.equal(page.el('pg-confirm').hidden, false);
  assert.equal(page.el('panel-confirm').hidden, false);
});

test('使った資料を挟んでも、飛んだ先の戻るは要点へ帰る', async () => {
  const page = await samplePage();
  await pressNext(page);
  await page.click('ref-open');
  assert.equal(page.el('pg-ref').hidden, false);
  await page.click('pg-back');
  shown(page, 'panel-2', 'pg-2-open');
  await page.click('pg-back');
  atTop(page);
});

test('入口へ戻ると飛んだことを忘れる', async () => {
  const page = await fill({ 'contract-amount': 'abc' });
  await pressNext(page); // 条件(1 ページ目)
  await page.click('sample-load'); // 別の流れへ入る
  await page.click('confirm-go');
  atTop(page);
  await page.click('pg-back');
  assert.equal(page.el('pg-confirm').hidden, false, '飛ぶ前の要点へ戻っている');
});

test('焦点: 読めない欄か最初の未回答の欄へ移す', async () => {
  const watch = (page, ids) => { const hit = []; for (const id of ids) page.el(id).focus = () => hit.push(id); return hit; };
  const bad = await fill({ 'contract-amount': 'abc' });
  const hit1 = watch(bad, ['contract-amount', 'subcontract-total', 'orderer']);
  await pressNext(bad);
  assert.deepEqual(hit1, ['contract-amount']);
  const none = await fill({});
  const hit2 = watch(none, ['orderer', 'contract-amount']);
  await pressNext(none);
  assert.deepEqual(hit2, ['orderer'], '発注者が最初の未回答');
  const later = await fill({ orderer: 'public', direct: true, 'work-type': 'other' });
  const hit3 = watch(later, ['orderer', 'contract-amount']);
  await pressNext(later);
  assert.deepEqual(hit3, ['contract-amount'], '請負代金が最初の未回答');
});

test('知らせ(結果が出た): 1行だけを見せ、全文は読み上げのために画面の外に残す', async () => {
  const page = await fill({ orderer: 'public', direct: true, 'work-type': 'other', license: 'tokutei', 'engineer-qualification': 'kanri', 'contract-amount': '100,000,000', 'subcontract-total': '50,000,000' });
  const st = page.el('bid-status');
  assert.match(st.textContent, /^✓ 結果が出ました。要る \d+項目。「次にすること」から読んでください。$/);
  assert.equal(st.hidden, false);
  assert.equal(st.classList.contains('sr-only'), true);
  assert.equal(page.el('result-flag').hidden, false);
  assert.equal(page.el('result-flag').textContent, '✓ 結果が出ました');
});

test('知らせ(見本): 「✓ 見本の結果です」の1行', async () => {
  const page = await samplePage();
  assert.equal(page.el('result-flag').textContent, '✓ 見本の結果です');
  assert.equal(page.el('bid-status').classList.contains('sr-only'), true);
  assert.match(page.el('bid-status').textContent, /^✓ 見本を読み込みました。/);
});

test('知らせ(見本を変えた): 結果が出た1行に前の結果からの差を添える。差は画面から消さない', async () => {
  const page = await samplePage();
  await page.click('pg-back');
  await page.click('confirm-back');
  await page.set('contract-amount', '40,000,000');
  await go(page);
  const flag = page.el('result-flag').textContent;
  assert.match(flag, /^✓ 結果が出ました /);
  assert.ok(flag.includes('前の結果から: 要る 6→5'), flag);
  assert.ok(page.el('bid-status').textContent.includes('前の結果から: 要る 6→5'));
});

test('知らせ(失敗): 全文を見せ、1行にしない', async () => {
  const page = await fill({ 'contract-amount': 'abc' });
  const st = page.el('bid-status');
  assert.equal(st.textContent, '金額の欄を読めませんでした。「条件を入れる」に戻って直し、もう一度「確認する」を押してください。');
  assert.equal(st.getAttribute('data-kind'), 'error');
  assert.equal(st.classList.contains('sr-only'), false);
  assert.equal(page.el('result-flag').hidden, true);
  assert.equal(page.el('result-flag').textContent, '');
});

test('知らせ(条件が変わった): 全文を見せ、1行の知らせを残さない', async () => {
  const page = await samplePage();
  assert.equal(page.el('result-flag').hidden, false);
  await page.set('contract-amount', '40,000,000');
  const st = page.el('bid-status');
  assert.match(st.textContent, /^＊ 条件が変わりました。/);
  assert.equal(st.classList.contains('sr-only'), false);
  assert.equal(page.el('result-flag').hidden, true);
});

test('知らせ(仮の結果): 全文を見せる', async () => {
  const page = await fill({});
  const st = page.el('bid-status');
  assert.match(st.textContent, /^＊ 仮の結果が出ました\(未回答 \d+問\)。「次にすること」から読んでください。$/);
  assert.equal(st.classList.contains('sr-only'), false);
  assert.equal(page.el('result-flag').hidden, true);
});

test('知らせ(段取りの全部の行): 結果ではないので1行にせず全文を見せ、席の語を文に書かない', async () => {
  const page = runPage(html);
  await page.click('entry-awarded');
  const st = page.el('bid-status');
  assert.equal(st.textContent, '✓ 段取りの全部の行を出しました。工事の条件が分かるなら、「条件を入れる」を押します。');
  assert.equal(st.classList.contains('sr-only'), false);
  assert.equal(page.el('result-flag').hidden, true);
});

test('知らせ(入れた条件の段取り): 結果があるので1行', async () => {
  const page = await samplePage();
  await page.click('pg-back');
  await page.click('confirm-back');
  await page.click('pg-back'); // 入口
  await page.click('entry-awarded');
  const st = page.el('bid-status');
  assert.equal(st.textContent, '✓ 入れた条件の段取りを出しています。「受注後の段取り」から読んでください。');
  assert.equal(st.classList.contains('sr-only'), true);
  assert.equal(page.el('result-flag').textContent, '✓ 結果が出ました');
});

test('全文の知らせは画面の外に置くだけで、display: none にしない。#bid-status の読み上げの印は残す', () => {
  const rule = screenCss.match(/p#bid-status\.sr-only \{([^}]*)\}/);
  assert.ok(rule, '画面の外に置く決まりが無い');
  assert.ok(!/display:\s*none|visibility:\s*hidden/.test(rule[1]), rule[1]);
  assert.match(rule[1], /position: absolute/);
  assert.match(rule[1], /overflow: hidden/);
  assert.match(rule[1], /clip-path: inset\(50%\)/);
  assert.match(topPage, /<p id="bid-status" class="no-print" aria-live="polite">/);
});

test('工事の名前: 見本は見本の題。変えると入れた条件の1行になる', async () => {
  const page = await samplePage();
  assert.equal(page.el('result-name').hidden, false);
  assert.equal(page.el('result-name').textContent, SAMPLE.title);
  await page.click('pg-back');
  await page.click('confirm-back');
  await page.set('contract-amount', '40,000,000');
  await go(page);
  assert.equal(page.el('result-name').textContent, '発注者 公共・工事の種類 それ以外の工事・請負代金の見込み 40,000,000円(税込み)');
});

test('工事の名前: 手で入れたときは入れた条件の1行。入れていない欄はそう書き、読めない値も隠さない', async () => {
  const page = await fill({ orderer: 'private', 'work-type': 'kenchiku-ikkatsu', 'contract-amount': '12,000,000' });
  assert.equal(page.el('result-name').textContent, '発注者 民間・工事の種類 建築一式工事・請負代金の見込み 12,000,000円(税込み)');
  assert.equal((await fill({})).el('result-name').textContent, '発注者 まだ選んでいません・工事の種類 まだ選んでいません・請負代金の見込み まだ入れていません');
  assert.ok((await fill({ 'contract-amount': '<abc>' })).el('result-name').textContent.endsWith('請負代金の見込み <abc>'));
});

test('工事の名前: 条件が変わった間は、数を出した時の条件のまま', async () => {
  const page = await samplePage();
  await page.set('contract-amount', '40,000,000');
  assert.equal(page.el('result-name').textContent, SAMPLE.title);
});

test('工事の名前と1行の知らせは「自分の工事で入れ直す」で消える', async () => {
  const page = await samplePage();
  await page.click('sample-reenter');
  assert.equal(page.el('result-name').hidden, true);
  assert.equal(page.el('result-name').textContent, '');
  assert.equal(page.el('result-flag').hidden, true);
  assert.equal(page.el('bid-status').classList.contains('sr-only'), false);
});

test('文に古い場所の語が無い', () => {
  assert.ok(!html.includes('下の「次にすること」'));
  assert.ok(!html.includes('下の「条件を入れる」'));
  assert.ok(!html.includes('✓ 入れた条件の段取りを出しています。下の'));
  assert.ok(!html.includes('終わったら「次へ: 書類を確かめる」を押します'));
});

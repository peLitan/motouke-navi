// F37c: 「もう受注した」で、条件を入れる前に段取りの全部の行を「確かめる」で見られる。
// この環境にはブラウザが無いので、見た目は測れない。描いた HTML と作り物の DOM での動きを確かめる
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildHtml } from '../../build.mjs';
import scheduleData from '../../data/schedule.json' with { type: 'json' };
import { parseRulesFile } from '../../src/rules-load.mjs';
import { buildScheduleDetail, buildSchedule } from '../../src/schedule.mjs';
import { awardedNotice } from '../../src/ui/app.mjs';
import { runPage } from '../acceptance/_helpers.mjs';

const FILE = fs.readFileSync(new URL('../../data/specs/wakayama_r0711_rows.json', import.meta.url), 'utf8');
const html = buildHtml();
const body = html.slice(html.indexOf('<body'));
const NATIONAL = '条件を入れていないので、国の直轄の例の全部の行を出しています。工事の条件を入れて『確認する』を押すと、要る・要らないが分かれます。';
const COUNT = scheduleData.rules.length;
const REAL = { direct: true, orderer: 'public', subcontractTotal: 0, contractAmount: 1000000, hasSubcontract: false };

test('all: 全部の行が出て、状態はどれも確かめる。入力は見ない', () => {
  for (const input of [{}, REAL, { direct: false }, { orderer: 'private' }]) {
    const d = buildScheduleDetail(input, null, { all: true });
    assert.equal(d.rows.length, COUNT);
    assert.deepEqual(d.skipped, []);
    assert.equal(d.all, true);
    assert.ok(d.rows.every((r) => r.status === 'needs_check'));
    assert.deepEqual(new Set(d.rows.map((r) => r.id)), new Set(scheduleData.rules.map((r) => r.id)));
  }
});

test('all を付けない呼び方は今までと同じ(条件で行を絞り、行うが残る)', () => {
  for (const input of [{}, REAL, { direct: false }]) {
    const plain = buildScheduleDetail(input);
    assert.deepEqual(plain, buildScheduleDetail(input, null, { all: false }));
    assert.equal('all' in plain, false);
  }
  const plain = buildScheduleDetail(REAL);
  assert.ok(plain.rows.some((r) => r.status === 'applies'));
  assert.ok(plain.rows.length < COUNT);
  assert.deepEqual(buildSchedule(REAL), plain.rows);
});

test('all は読み込んだ表でも全部の行を出す(下請けの入力でも空にしない)', () => {
  const table = parseRulesFile(FILE);
  const d = buildScheduleDetail({ direct: false }, table, { all: true });
  assert.equal(d.rows.length, table.schedule.length);
  assert.ok(d.rows.every((r) => r.status === 'needs_check'));
});

test('「もう受注した」: 段2 に全部の行と注意とボタンが出て、段取りは開き、入札前の確認は閉じる', async () => {
  const page = runPage();
  assert.equal(page.el('awarded-notice').hidden, true);
  assert.equal(page.el('bid-fold').open, true);
  await page.click('entry-awarded');
  assert.equal(page.el('panel-2').hidden, false);
  assert.equal(page.el('awarded-notice').hidden, false);
  assert.equal(page.el('awarded-notice-text').textContent, NATIONAL);
  const out = page.el('schedule-result').innerHTML;
  assert.ok(out.includes('受注後の段取りは ' + COUNT + '件です'), out.slice(0, 200));
  assert.ok(out.includes('<details class="schedule-table" open>'));
  assert.ok(!out.includes('表は下の「受注後の段取り」にあります'));
  assert.ok(out.includes('確かめる'));
  assert.ok(!/data-label="状態">行う</.test(out), '「行う」と言い切る行がある');
  assert.equal(page.el('bid-fold').open, false);
  assert.equal(page.el('bid-fold-hint').hidden, false);
  await page.click('awarded-conditions');
  assert.equal(page.el('panel-1').hidden, false);
  assert.equal(page.el('panel-2').hidden, true);
});

test('全部の行は CSV に書き出せる。条件の欄を変えても止めず、まとめの件数にも入れない', async () => {
  const page = runPage();
  await page.click('entry-awarded');
  const amount = page.el('contract-amount');
  amount.value = '1000000';
  amount.dispatchEvent({ type: 'input' });
  await page.click('schedule-csv-btn');
  assert.equal(page.blobs.length, 1, page.el('schedule-status').textContent);
  const csv = await page.blobs[0].text();
  assert.equal(csv.trim().split('\r\n').length, COUNT + 3); // 見出し + 全部の行 + 工種の行(F44a)+ 注意の行(F61a)
  assert.ok(csv.includes('確かめる'));
  await page.click('next-step-3');
  page.el('ledger-input').value = '工事名: 架空の工事';
  await page.click('ledger-run');
  assert.ok(!page.text('summary').includes('受注後の段取り'));
});

test('「確認する」で通常に戻る: 注意が消え、条件で絞った行になり、折りたたみが開く', async () => {
  const page = runPage();
  await page.click('entry-awarded');
  await page.click('awarded-conditions');
  page.el('direct-sub').checked = true;
  page.el('direct-unset').checked = false;
  await page.click('bid-run');
  assert.equal(page.el('awarded-notice').hidden, true);
  assert.equal(page.el('bid-fold').open, true);
  assert.equal(page.el('bid-fold-hint').hidden, true);
  assert.ok(!page.text('schedule-result').includes('受注後の段取りは ' + COUNT + '件です'));
  assert.ok(page.text('summary').includes('受注後の段取り'));
});

test('入力の誤りでも通常に戻る。誤りが残る間は全部の行で上書きしない', async () => {
  const page = runPage();
  await page.click('entry-awarded');
  await page.click('awarded-conditions');
  page.el('contract-amount').value = 'あ';
  await page.click('bid-run');
  assert.equal(page.el('awarded-notice').hidden, true);
  const errors = page.text('schedule-result');
  await page.click('entry-back');
  await page.click('entry-awarded');
  assert.equal(page.el('awarded-notice').hidden, true);
  assert.equal(page.text('schedule-result'), errors);
});

test('条件から出した結果があるときは、入口から入り直しても全部の行にしない', async () => {
  const page = runPage();
  await page.click('sample-load');
  const shown = page.text('schedule-result');
  await page.click('entry-back');
  await page.click('entry-awarded');
  assert.equal(page.el('awarded-notice').hidden, true);
  assert.equal(page.el('bid-fold').open, true);
  assert.equal(page.text('schedule-result'), shown);
  await page.click('sample-reenter');
  await page.click('entry-back');
  await page.click('entry-awarded');
  assert.equal(page.el('awarded-notice').hidden, false);
});

test('例を切り替えると一覧と注意が変わる。和歌山県の例では「要る・要らないが分かれます」と言わない', async () => {
  const page = runPage();
  const wakayama = parseRulesFile(FILE).schedule.length;
  await page.click('entry-awarded');
  await page.click('rules-wakayama');
  const t = page.el('awarded-notice-text').textContent;
  assert.ok(t.startsWith('条件を入れていないので、和歌山県の例の全部の行を出しています。'), t);
  assert.ok(!t.includes('要る・要らないが分かれます'), t);
  assert.ok(page.text('schedule-result').includes('受注後の段取りは ' + wakayama + '件です'));
  await page.click('rules-national');
  assert.equal(page.el('awarded-notice-text').textContent, NATIONAL);
  assert.ok(page.text('schedule-result').includes('受注後の段取りは ' + COUNT + '件です'));
});

test('注意の文: 段取りの行が無い表や空の表では国の例の文のまま', () => {
  assert.equal(awardedNotice(null), NATIONAL);
  assert.equal(awardedNotice({ schedule: [], planItems: [{}] }), NATIONAL);
  assert.ok(awardedNotice({ schedule: [{}], planItems: [] }).includes('読み込んだ表の全部の行'));
});

test('静的な HTML: 注意は一覧の上で隠してあり、ボタンは印刷に出ず、結果の id は折りたたみの中にある', () => {
  const at = (s) => { const i = body.indexOf(s); assert.ok(i >= 0, s); return i; };
  assert.ok(at('id="bid-fold"') < at('id="bid-result"'));
  assert.ok(at('id="taicho-result"') < at('</details>\n<h3 id="schedule-heading">'));
  assert.ok(at('id="schedule-heading"') < at('id="awarded-notice"'));
  assert.ok(at('id="awarded-notice"') < at('id="schedule-result"'));
  assert.match(body, /<div id="awarded-notice" class="note" hidden>/);
  assert.ok(body.includes(NATIONAL));
  assert.match(html, /button, \.export, \.no-print \{ display: none !important; \}/);
});

test('07 の決まり: 外部の読み込みが無く、保存の API を足さず、断り書きと PDL が残り、index.html が build と一致する', () => {
  assert.equal(fs.readFileSync(new URL('../../index.html', import.meta.url), 'utf8'), html);
  assert.ok(!/<(script|link|img|iframe)\b[^>]*\b(src|href)=["']https?:/i.test(html));
  assert.match(html, /<meta http-equiv="Content-Security-Policy" content="default-src 'none'/);
  assert.ok(html.includes('id="disclaimer"') && html.includes('PDL1.0'));
  const src = ['src/ui/app.mjs', 'src/schedule.mjs'].map((f) => fs.readFileSync(new URL('../../' + f, import.meta.url), 'utf8')).join('\n');
  assert.ok(!/localStorage|sessionStorage|indexedDB|document\.cookie|fetch\(|XMLHttpRequest/.test(src));
});

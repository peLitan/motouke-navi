// F83a2: 画面と CSV にプログラムの語(規則の id・欄の名前・状態の値・「(zip)」)を出さない。段3 が空のときは「入力を読めませんでした」を出さない
// この環境にはブラウザが無いので、見た目は測れない。組み立てた画面の文と、書き出した CSV の文で確かめる。値はすべて架空
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildHtml } from '../../build.mjs';
import { bidCheck } from '../../src/bid-check.mjs';
import { stage1Rows, toCsv } from '../../src/export.mjs';
import { pdfIntakeNotice } from '../../src/intake-load.mjs';
import { extractText, listZip } from '../../src/mask/extract.mjs';
import { judgeTaicho } from '../../src/taicho.mjs';
import { renderBidResult, renderErrors, renderTaichoResult } from '../../src/ui/view.mjs';
import { makeZip, runPage } from '../acceptance/_helpers.mjs';

const rulesData = JSON.parse(fs.readFileSync(new URL('../../data/rules.json', import.meta.url), 'utf8'));

// 英字の小文字で始まり、ハイフン・下線でつないだ語か、途中に大文字が入る語。画面の英字の語(CSV・PDF・Skill など)は当たらない
const PROGRAM = /(?<![A-Za-z0-9.])[a-z]+(?:-[a-z0-9-]+|_[a-z_]+|[A-Z][A-Za-z]*)/;
const NOT_OFFICE = '.docx・.xlsx として読めません(壊れているか、別の形のファイルです)。保存し直すか、元のファイルをもらってください。';
const plain = (s) => String(s).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const assertNoWords = (text, where) => {
  const m = String(text).match(PROGRAM);
  assert.equal(m?.[0], undefined, where + ' に残っている: ' + (m ? String(text).slice(Math.max(0, m.index - 20), m.index + 30) : ''));
  for (const w of ['(zip)', 'amountBasis']) assert.ok(!String(text).includes(w), where + ' に残っている: ' + w);
};
const blobText = (b) => b.parts.join('');

const PRIVATE = {
  orderer: 'private', direct: true, hasSubcontract: true, subcontractTotal: 85_000_000,
  contractAmount: 90_000_000, workType: 'kenchiku-ikkatsu', license: 'tokutei',
};

async function sampleOutputs() {
  const page = runPage(buildHtml());
  await page.click('sample-load');
  await page.click('confirm-go');
  await page.click('ledger-run');
  await page.click('plan-run');
  const screens = {};
  for (const id of ['result-top', 'summary', 'bid-result', 'taicho-result', 'schedule-result', 'open-items', 'check-result', 'checklist-result', 'plan-result']) {
    screens[id] = plain(page.el(id).innerHTML);
  }
  for (const id of ['csv-btn', 'schedule-csv-btn', 'check-csv-btn', 'checklist-csv-btn', 'plan-csv-btn']) await page.click(id);
  return { screens, csvs: page.blobs.map(blobText) };
}

test('見本の結果: どの欄の文にもプログラムの語が無い。金額の比べ方の参照は画面の見出しの語', async () => {
  const { screens } = await sampleOutputs();
  for (const [id, text] of Object.entries(screens)) {
    assert.ok(text.length > 0, id + ' が空のままでは確かめにならない');
    assertNoWords(text, id);
  }
  assert.ok(screens['bid-result'].includes('結果の『金額の比べ方』に抜き書き'), screens['bid-result']);
});

test('見本の CSV: 5つの書き出しのどれにも規則の id の形が無い', async () => {
  const { csvs } = await sampleOutputs();
  assert.equal(csvs.length, 5);
  for (const csv of csvs) {
    assert.ok(csv.length > 0);
    assertNoWords(csv, 'CSV');
  }
});

test('CSV の当てはめた規則の行: 項目の欄は番号で、説明の欄に画面と同じ文が入る', () => {
  const t = judgeTaicho(PRIVATE);
  const rows = stage1Rows(bidCheck(PRIVATE), t, '指摘の候補です').filter((r) => r[0] === '施工体制台帳(当てはめた規則)');
  assert.ok(t.reasons.length > 0, 'この入力では規則が当てはまるはず');
  assert.deepEqual(rows.map((r) => r[1]), t.reasons.map((_, i) => '当てはめた規則 ' + (i + 1)));
  assert.deepEqual(rows.map((r) => r[3]), t.reasons.map((r) => r.action));
});

test('規則表のすべての行: 画面に出る文(action・exceptions)にプログラムの語が無い', () => {
  for (const r of [...rulesData.rules, ...rulesData.laborDuties]) {
    for (const text of [r.action, ...(r.exceptions ?? [])].filter(Boolean)) assertNoWords(text, r.id);
  }
});

test('金額を使う規則が当たると、参照の先の見出し「金額の比べ方」が結果に出る', () => {
  assert.ok(plain(renderBidResult(bidCheck(PRIVATE))).includes('金額の比べ方: 税込み'));
  assert.ok(plain(renderTaichoResult(judgeTaicho(PRIVATE))).includes('金額の比べ方: 税込み'));
});

test('民間の工事の結果と CSV にもプログラムの語が無い(見本は公共の工事なので別に見る)', () => {
  const inputs = [
    PRIVATE,
    { ...PRIVATE, license: 'ippan' },
    { ...PRIVATE, workType: 'other', subcontractTotal: 1_000_000 },
    { ...PRIVATE, direct: false },
  ];
  for (const input of inputs) {
    const bid = bidCheck(input);
    const t = judgeTaicho(input);
    assertNoWords(plain(renderBidResult(bid)), '入札前の確認');
    assertNoWords(plain(renderTaichoResult(t)), '施工体制台帳');
    assertNoWords(toCsv(stage1Rows(bid, t, '指摘の候補です')), 'CSV');
  }
});

test('規則の id を替えた文: 指す先の行の action の文で、行は実在する', () => {
  // 民間の行と公共の行には同じ文で始まる物があるので、同じ scope の行だけを探す
  const cited = rulesData.rules.flatMap((r) => r.exceptions.flatMap((e) => [...e.matchAll(/「([^「」]+)」の行/g)]
    .map((m) => rulesData.rules.find((x) => x.scope === r.scope && x.action.startsWith(m[1]))?.id)));
  assert.deepEqual(cited.sort(), ['prv-not-direct', 'pub-copy-exempt', 'pub-taicho-create', 'pub-taicho-create']);
});

test('段3 が空: 台帳も目次も「入力を読めませんでした」を出さず、空の知らせと次の手を出す', async () => {
  const page = runPage(buildHtml());
  await page.set('ledger-input', '');
  await page.click('ledger-run');
  const check = plain(page.el('check-result').innerHTML);
  assert.equal(check, '台帳の文が空です。台帳を貼るか、入口の「まず見本で試す」を押してください。');
  assert.equal(page.el('check-status').textContent, '＊ 台帳の文が空です。');
  await page.set('plan-input', '');
  await page.click('plan-run');
  const plan = plain(page.el('plan-result').innerHTML);
  assert.equal(plan, '目次が空です。施工計画書の目次を貼るか、入口の「まず見本で試す」を押してください。');
  assert.equal(page.el('plan-status').textContent, '＊ 目次が空です。');
  assertNoWords(check + plan + plain(page.el('checklist-result').innerHTML), '段3 の空の画面');
});

test('段3 が空でないときの誤りは「入力を読めませんでした」の形のまま(空の知らせだけ変える)', () => {
  assert.ok(renderErrors(['架空の誤り']).includes('入力を読めませんでした'));
});

test('読めないファイル: zip の語を出さず、理由と次の手の文で止まる', async () => {
  assert.throws(() => listZip(new TextEncoder().encode('ただの文')), { message: NOT_OFFICE });
  await assert.rejects(() => extractText('架空.docx', new TextEncoder().encode('ただの文')), { message: NOT_OFFICE });
  await assert.rejects(() => extractText('架空.xlsx', new TextEncoder().encode('ただの文')), { message: NOT_OFFICE });
});

test('読めないファイル: zip の目次や中身が壊れていても同じ文で止まる', async () => {
  // 終わりの印だけある物: 目次の先頭が 0 番地を指し、そこに目次の印が無い
  const tail = new Uint8Array(22);
  new DataView(tail.buffer).setUint32(0, 0x06054b50, true);
  new DataView(tail.buffer).setUint16(10, 1, true);
  assert.throws(() => listZip(tail), { message: NOT_OFFICE });
  // 目次は読めるが、中身の先頭の印が壊れている物
  const broken = makeZip([{ name: 'word/document.xml', data: '<w:t>架空</w:t>' }]);
  broken[0] = 0;
  await assert.rejects(() => extractText('架空.docx', broken), { message: NOT_OFFICE });
});

test('公告の PDF の知らせ: bid-intake は利用者の言葉の名前で書く', () => {
  const line = pdfIntakeNotice('架空.pdf', 1, '架空の公告の文');
  assert.ok(line.includes('パソコンの Claude Code の「公告を読む」手順'), line);
  assert.ok(!line.includes('Skill bid-intake'), line);
});

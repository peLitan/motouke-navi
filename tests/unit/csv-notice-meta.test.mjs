// F83a8: 入札前の確認の CSV の「注意」の行に、道具の版・書き出した日時・入れた条件・出典の URL を足す。行の数と列は変えない
// この環境にはブラウザが無いので、組み立てた画面で見本を読み込んで書き出した CSV の文で確かめる。値はすべて架空
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildHtml } from '../../build.mjs';
import { stage1Rows, COLUMNS, conditionSummary, isoLocal } from '../../src/export.mjs';
import { bidCheck } from '../../src/bid-check.mjs';
import { judgeTaicho } from '../../src/taicho.mjs';
import { readBidForm } from '../../src/ui/form.mjs';
import { SAMPLE } from '../../src/sample.mjs';
import { runPage } from '../acceptance/_helpers.mjs';

const manifest = JSON.parse(fs.readFileSync(new URL('../../plugin/.claude-plugin/plugin.json', import.meta.url), 'utf8'));
const ISO = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}/;

// CSV を行と欄に分ける(引用符の中の改行・カンマ・二重の引用符を読む)
function parseCsv(text) {
  const s = text.replace(/^﻿/, '');
  const rows = [];
  let row = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"' && s[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; } else if (c === '\r' && s[i + 1] === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i++; } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

async function sampleCsv(extra) {
  const page = runPage(buildHtml());
  await page.click('sample-load');
  if (extra) await extra(page);
  await page.click('confirm-go');
  await page.click('csv-btn');
  assert.equal(page.blobs.length, 1);
  return parseCsv(page.blobs[0].parts.join(''));
}

test('見本の CSV: 注意の行に版の番号・日時の形・請負代金の値・https:// がある', async () => {
  const rows = await sampleCsv();
  const notes = rows.filter((r) => r[0] === '注意');
  assert.equal(notes.length, 1);
  const text = notes[0][COLUMNS.indexOf('説明')];
  assert.ok(text.includes('道具の版: ' + manifest.version), text);
  assert.match(text, new RegExp('書き出した日時: ' + ISO.source));
  assert.ok(text.includes('286,000,000円'), '請負代金の値: ' + text);
  assert.ok(text.includes('77,000,000円'), '下請けの総額の値');
  assert.match(text, /出典の URL:\nhttps:\/\//);
  // 出典の URL は重なりを除く
  const urls = text.split('\n').filter((l) => l.startsWith('https://'));
  assert.ok(urls.length > 0);
  assert.equal(new Set(urls).size, urls.length);
  // 日時は取得日の列にも版の列にも入れない
  for (const r of rows.slice(1)) {
    assert.doesNotMatch(r[COLUMNS.indexOf('取得日')] ?? '', ISO);
    assert.doesNotMatch(r[COLUMNS.indexOf('取得日') + 1] ?? '', ISO);
  }
  // 列の数は見出しと同じ
  for (const r of rows) assert.equal(r.length, COLUMNS.length, r.join('|').slice(0, 60));
});

test('見本の CSV: 行の数は足す前と同じ(注意の行までの行の数が、情報を渡さないときの stage1Rows と同じ)', async () => {
  const rows = await sampleCsv();
  const input = readBidForm(SAMPLE.form);
  const bid = bidCheck(input);
  const t = judgeTaicho(input);
  const before = stage1Rows(bid, t, '注意');
  const after = stage1Rows(bid, t, '注意', { version: manifest.version, exportedAt: new Date(), input });
  assert.equal(after.length, before.length);
  for (let i = 0; i < before.length - 1; i++) assert.deepEqual(after[i], before[i], '注意の行より前は同じ');
  assert.deepEqual(after.at(-1).filter((_, i) => i !== 3), before.at(-1).filter((_, i) => i !== 3), '注意の行も説明の列だけが変わる');
  const stage1 = rows.findIndex((r) => r[0] === '注意');
  assert.equal(stage1 + 1, before.length, '画面の CSV で注意の行までの行の数');
});

test('参加の条件の本文は写さない(F82c)', async () => {
  const body = '架空の参加の条件 元請けとして同種工事の施工実績を有すること';
  const rows = await sampleCsv(async (page) => { await page.set('participation-conditions', body); });
  const text = rows.find((r) => r[0] === '注意')[3];
  assert.ok(!text.includes('同種工事の施工実績'), text);
  assert.ok(!conditionSummary({ participationConditions: body }).includes('施工実績'));
});

test('入れた条件の要約: 入っている物だけを並べる。分からない(null)の欄は出さない', () => {
  assert.equal(conditionSummary({ orderer: 'private', direct: false, contractAmount: 90_000_000, subcontractTotal: null, workType: 'kenchiku-ikkatsu' }),
    '発注者 民間・元請けか下請けか 下請け・請負代金の見込み(税込み) 90,000,000円・工事の種類 建築一式工事');
  assert.equal(conditionSummary({ orderer: null, direct: null, contractAmount: null, subcontractTotal: 0, workType: null }), '下請けの総額(税込み) 0円');
  assert.equal(conditionSummary({}), '');
  const input = { orderer: null, direct: null, contractAmount: null, subcontractTotal: null, workType: null };
  const row = stage1Rows(bidCheck(input), judgeTaicho(input), '注意', { version: '0.0.0', exportedAt: new Date(), input }).at(-1);
  assert.match(row[3], /入れた条件: 入っていません/);
});

test('日時の形: 端末の時刻で、時差を付ける', () => {
  const d = new Date(2026, 10, 7, 8, 5, 9);
  const s = isoLocal(d);
  assert.match(s, /^2026-11-07T08:05:09[+-]\d{2}:\d{2}$/);
  assert.equal(new Date(s).getTime(), d.getTime());
});

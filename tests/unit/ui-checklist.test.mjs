// F16c: 台帳の記載事項の表(画面)。欄・断りの文・CSV の列・「確認した」をメモリだけに持つこと・国交省のチェックリストは題名・URL・取得日だけ
// 値はすべて架空(見本の台帳は src/sample.mjs の架空の台帳)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildHtml } from '../../build.mjs';
import { checkChecklistText, CHECKLIST_REFERENCE, CHECKLIST_LAW } from '../../src/checklist.mjs';
import { renderChecklist, CHECKLIST_NOTICE, checklistBoxId } from '../../src/ui/view.mjs';
import { checklistRows, CHECKLIST_COLUMNS, toCsv } from '../../src/export.mjs';
import { runLedgerCheck, setChecklistChecked, checklistState, exportChecklistCsv } from '../../src/ui/app.mjs';
import { SAMPLE } from '../../src/sample.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const NOTICE_TEXT = 'チェックはこのツールの判定ではありません。確認した人と日付は印刷の版に書いてください';

// 架空の台帳(空の欄・下請けを含む)
const LEDGER = [
  '# 施工体制台帳(架空)',
  '## 作成建設業者',
  '| 項目 | 内容 |', '|---|---|',
  '| 工事名称 | 架空川 護岸工事(架空) |',
  '| 工期 | 2027年4月1日 から 2027年12月1日 まで |',
  '| 発注者 | 架空県 |',
  '| 監理技術者 氏名 | 架空 太郎 |',
  '| 資格 | |',
  '## 下請負人(一次)',
  '### 架空土工株式会社(架空)',
  '| 項目 | 内容 |', '|---|---|',
  '| 許可番号 | 架空県知事 許可(般-07)第00009号 |',
  '| 工事内容 | 掘削 |',
].join('\n');

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

test('表の冒頭に断りの文が出て、各行に「確認した」の欄・事項名・状態・値・根拠の場所がある', () => {
  assert.equal(CHECKLIST_NOTICE, NOTICE_TEXT);
  const out = checkChecklistText(LEDGER);
  const html = renderChecklist(out, new Set());
  const iNotice = html.indexOf(esc(NOTICE_TEXT));
  assert.ok(iNotice >= 0, '断りの文が無い');
  assert.ok(iNotice < html.indexOf('<table'), '断りの文が表の前に無い');
  const ths = [...html.matchAll(/<th scope="col">([^<]*)<\/th>/g)].map((m) => m[1]);
  assert.deepEqual(ths, ['確認した', '相手', '記載事項', '状態', '台帳の値(書いてあるまま)', '理由', '根拠の場所']);
  const trs = [...html.matchAll(/<tr class="cl-(value|empty|unknown)" data-row-id="([^"]+)">([\s\S]*?)<\/tr>/g)];
  assert.equal(trs.length, out.rows.length, '行の数が結果と合わない');
  for (const [, , id, tr] of trs) {
    const r = out.rows.find((x) => esc(x.id) === id);
    assert.ok(r, '結果に無い行: ' + id);
    assert.ok(tr.includes('<input type="checkbox" class="checklist-check" id="' + esc(checklistBoxId(r.id)) + '"'), '確認した の欄が無い: ' + id);
    assert.ok(!/ checked/.test(tr), '最初からチェックが入っている: ' + id);
    assert.ok(tr.includes(esc(r.label)) && tr.includes('>' + esc(r.statusLabel) + '<') && tr.includes(esc(r.basis.where)), '事項名・状態・根拠の場所のどれかが無い: ' + id);
  }
  // 値 / 空 / 判断できない がそれぞれ出る(架空の台帳: 工事名・工期は値、資格は空、営業所などは判断できない)
  const st = new Set(out.rows.map((r) => r.status));
  assert.ok(st.has('empty') && st.has('unknown'), JSON.stringify(out.counts));
  // 根拠の原文は表の外の折りたたみに、事項ごとに出る(表の中に折りたたみを入れない)
  const table = html.match(/<table[\s\S]*?<\/table>/)[0];
  assert.ok(!/<details|<blockquote/.test(table));
  assert.ok(html.includes('根拠: 建設業法施行規則 第14条の2 第1項の原文('));
  for (const r of out.rows) assert.ok(html.includes(esc(r.basis.quote)), '原文が無い: ' + r.id);
  // 「台帳が不適法」「違法」とは出さない
  assert.ok(!/不適法|違法/.test(html.replace(/適法か\)は判定しません/, '')));
});

test('CSV の列: 最初の列が「確認した」で、チェックの有無が入る。最後の行に断りの文', () => {
  const out = checkChecklistText(LEDGER);
  const checked = new Set([out.rows[0].id, out.rows[3].id]);
  const rows = checklistRows(out, checked, '指摘の候補です');
  assert.deepEqual(rows[0], CHECKLIST_COLUMNS);
  assert.deepEqual(CHECKLIST_COLUMNS, ['確認した', '相手', '記載事項', '状態', '台帳の値(書いてあるまま)', '理由', '根拠の場所', '根拠の原文(抜き書き)', '取得日', '版']);
  const body = rows.slice(1, -1);
  assert.equal(body.length, out.rows.length);
  body.forEach((r, i) => {
    assert.equal(r.length, CHECKLIST_COLUMNS.length);
    assert.equal(r[0], checked.has(out.rows[i].id) ? '確認した' : '', '確認した の列が合わない: ' + out.rows[i].id);
    assert.equal(r[3], out.rows[i].statusLabel);
    assert.equal(r[7], out.rows[i].basis.quote);
    assert.equal(r[8], CHECKLIST_LAW.fetchedAt);
  });
  const last = rows[rows.length - 1];
  assert.equal(last[0], '注意');
  assert.ok(last.join('\n').includes(NOTICE_TEXT));
  assert.ok(last.join('\n').includes(CHECKLIST_REFERENCE.url));
  assert.match(toCsv(rows), /^﻿確認した,相手,記載事項,状態,/);
});

test('根拠の原文の取得日と版は data/sources/index.json の施行規則の行と同じ', () => {
  const { sources } = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'sources', 'index.json'), 'utf8'));
  const s = sources.find((x) => x.id === CHECKLIST_LAW.sourceId);
  assert.ok(s);
  assert.equal(s.fetchedAt, CHECKLIST_LAW.fetchedAt);
  assert.equal(s.revisionId, CHECKLIST_LAW.revisionId);
});

test('国交省のチェックリストは題名・URL・取得日だけを出す(文は写さない)', () => {
  assert.equal(CHECKLIST_REFERENCE.title, '施工体制台帳等のチェックリスト');
  assert.match(CHECKLIST_REFERENCE.url, /^https:\/\/www\.mlit\.go\.jp\//);
  assert.match(CHECKLIST_REFERENCE.fetchedAt, /^\d{4}-\d{2}-\d{2}$/);
  assert.deepEqual(Object.keys(CHECKLIST_REFERENCE).sort(), ['fetchedAt', 'note', 'page', 'pageTitle', 'publisher', 'title', 'url'].sort(), '題名・URL・取得日のほかの中身を持っている');
  const html = buildHtml();
  const ref = html.match(/<p class="note" id="checklist-reference">([^<]*)<\/p>/);
  assert.ok(ref, '画面に参考の行が無い');
  for (const k of ['title', 'url', 'fetchedAt']) assert.ok(ref[1].includes(esc(CHECKLIST_REFERENCE[k])), '参考の行に ' + k + ' が無い');
  // リンク(a 要素)にしない(画面は外へつながない)
  assert.ok(!html.includes('href="' + CHECKLIST_REFERENCE.url));
});

test('画面: 冒頭の説明・CSV のボタン・表の枠があり、チェックを保存する仕組み(localStorage など)を使わない', () => {
  const html = buildHtml();
  for (const id of ['checklist-section', 'checklist-csv-btn', 'checklist-status', 'checklist-result']) assert.ok(html.includes('id="' + id + '"'), id + ' が無い');
  assert.ok(html.includes('ブラウザに保存しません'));
  for (const f of ['src/ui/app.mjs', 'src/ui/view.mjs', 'src/export.mjs', 'src/checklist.mjs']) {
    const t = fs.readFileSync(path.join(ROOT, f), 'utf8');
    assert.ok(!/localStorage|sessionStorage|indexedDB|document\.cookie/.test(t), f + ' が保存の仕組みを使っている');
  }
  // 印刷の版の最後に「確認した人・日付」の空欄がある
  assert.ok(/id="sign-off"[\s\S]*確認した人[\s\S]*日付/.test(html));
});

// 画面の動き(小さな作り物の DOM で確かめる)
function fakeDoc() {
  const els = {};
  const el = (id, extra = {}) => (els[id] = { id, value: '', innerHTML: '', textContent: '', ...extra });
  el('ledger-input', { value: SAMPLE.documents.ledger });
  el('check-result'); el('check-status'); el('checklist-result'); el('checklist-status');
  for (const id of ['orderer', 'work-type', 'license']) el(id);
  const downloads = [];
  const doc = {
    getElementById: (id) => els[id] || null,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => ({ click() { downloads.push(this); }, remove() {} }),
    body: { appendChild() {} },
  };
  return { doc, els, downloads };
}

test('画面の動き: 「台帳を点検する」で表が出て、チェックはメモリに持ち、書き出しに出る。台帳の文が変わるとチェックは消える', async () => {
  const { doc, els } = fakeDoc();
  runLedgerCheck(doc);
  assert.ok(els['checklist-result'].innerHTML.includes(esc(NOTICE_TEXT)));
  const { out } = checklistState();
  assert.ok(out && out.rows.length > 0);
  const id = out.rows.find((r) => r.status === 'empty').id;
  setChecklistChecked(doc, id, true);
  assert.deepEqual([...checklistState().checked], [id]);
  assert.ok(els['checklist-result'].innerHTML.includes('id="' + esc(checklistBoxId(id)) + '" data-row-id="' + esc(id) + '" checked'), '描き直した表にチェックが無い');
  // 書き出し: Blob の中身を読む
  const blobs = [];
  const origCreate = URL.createObjectURL;
  URL.createObjectURL = (b) => { blobs.push(b); return 'blob:x'; };
  const origRevoke = URL.revokeObjectURL;
  URL.revokeObjectURL = () => {};
  try {
    exportChecklistCsv(doc);
  } finally { URL.createObjectURL = origCreate; URL.revokeObjectURL = origRevoke; }
  assert.equal(blobs.length, 1);
  const csv = await blobs[0].text();
  const line = csv.split('\r\n').find((l) => l.startsWith('確認した,') && !l.startsWith('確認した,相手'));
  assert.ok(line, 'チェックした行が CSV に「確認した」で出ていない');
  assert.match(els['checklist-status'].textContent, /確認した/);
  // 同じ文で出し直すとチェックは残る
  runLedgerCheck(doc);
  assert.deepEqual([...checklistState().checked], [id]);
  // 文が変わると消える(別の下請けの行に印が移らないように)
  els['ledger-input'].value = SAMPLE.documents.ledger + '\n';
  runLedgerCheck(doc);
  assert.deepEqual([...checklistState().checked], []);
  // 結果に無い行の id はチェックにしない
  setChecklistChecked(doc, 'no-such-row', true);
  assert.deepEqual([...checklistState().checked], []);
});

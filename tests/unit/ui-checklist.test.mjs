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
import { runPage } from '../acceptance/_helpers.mjs';
import { checklistRows, CHECKLIST_COLUMNS, toCsv } from '../../src/export.mjs';
import { runLedgerCheck, setChecklistChecked, checklistState, exportChecklistCsv, openDetailsForPrint, restoreDetailsAfterPrint } from '../../src/ui/app.mjs';
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

// F79a: 「空」の行の一覧・閉じた表・描き直しても残る開閉・カードの項目名
const COLS = ['確認した', '相手', '記載事項', '状態', '台帳の値(書いてあるまま)', '理由', '根拠の場所'];
const FOLD_OPEN_TAG = '<details class="fold checklist-fold" id="checklist-fold">';
const sampleOut = () => checkChecklistText(SAMPLE.documents.ledger);

test('F79a 見本の台帳: 件数の行の下に「空」の行の ul があり、表は閉じた details の中にある', () => {
  const out = sampleOut();
  const html = renderChecklist(out, new Set());
  assert.ok(html.includes('記載事項 50行: 値 0・空 1・判断できない 49(確認した 0行)'), '件数の行が変わった');
  const at = ['class="checklist-counts"', '<ul class="checklist-empty">', FOLD_OPEN_TAG, '<table class="checklist-table">', '</table>'].map((s) => html.indexOf(s));
  assert.ok(at.every((n) => n >= 0), at.join(','));
  assert.deepEqual([...at].sort((a, b) => a - b), at, '順が違う');
  const closeAt = html.indexOf('</details>', at[4]);
  assert.equal(html.slice(at[4] + '</table>'.length, closeAt).replace(/<\/div>/g, ''), '', '表と details の閉じの間に別の物がある');
  assert.ok(html.indexOf('根拠: 建設業法施行規則') > closeAt, '根拠の原文が表の折りたたみの中にある');
  // 表の中に details は無い(F14c)
  assert.ok(!/<details|<blockquote/.test(html.match(/<table[\s\S]*?<\/table>/)[0]));
  // 見出しに行の数。最初は閉じている
  assert.ok(html.includes(FOLD_OPEN_TAG + '<summary>記載事項の表を開く(' + out.rows.length + '行)</summary>'));
  // 一覧は「空」の行だけで、相手 — 記載事項 の形
  const list = html.match(/<ul class="checklist-empty">([\s\S]*?)<\/ul>/)[1];
  const items = [...list.matchAll(/<li>([^<]*)<\/li>/g)].map((m) => m[1]);
  assert.deepEqual(items, out.rows.filter((r) => r.status === 'empty').map((r) => esc(r.entity) + ' — ' + esc(r.label)));
  assert.equal(items.length, out.counts.empty);
  assert.ok(items.length > 0);
});

test('F79a 表の列・行・文は変えず、各 td に見出しと同じ data-label が付く。状態の列は class が先', () => {
  const out = sampleOut();
  const html = renderChecklist(out, new Set());
  const ths = [...html.matchAll(/<th scope="col">([^<]*)<\/th>/g)].map((m) => m[1]);
  assert.deepEqual(ths, COLS);
  const trs = [...html.matchAll(/<tr class="cl-(?:value|empty|unknown)" data-row-id="[^"]+">([\s\S]*?)<\/tr>/g)].map((m) => m[1]);
  assert.equal(trs.length, out.rows.length);
  trs.forEach((tr, i) => {
    const r = out.rows[i];
    const tds = [...tr.matchAll(/<td\b([^>]*)>([\s\S]*?)<\/td>/g)];
    assert.deepEqual(tds.map((m) => m[1].match(/ data-label="([^"]*)"/)?.[1]), COLS);
    assert.deepEqual(tds.slice(1).map((m) => m[2]), [r.entity, r.label, r.statusLabel, r.value, r.reason, r.basis.where].map(esc));
  });
  assert.equal((html.match(/<td class="cl-status" data-label="状態">/g) ?? []).length, out.rows.length);
  assert.equal((html.match(/<td class="cl-check" data-label="確認した">/g) ?? []).length, out.rows.length);
  // CSV の行は表の行と同じ数のまま
  assert.equal(checklistRows(out, new Set(), '候補です').slice(1, -1).length, out.rows.length);
});

test('F79a 「空」の行が無ければ一覧は出さず、行が無ければ折りたたみも出さない。名前は書いてあるままエスケープする', () => {
  const out = sampleOut();
  const noEmpty = renderChecklist({ ...out, rows: out.rows.filter((r) => r.status !== 'empty'), counts: { ...out.counts, empty: 0 } });
  assert.ok(!noEmpty.includes('checklist-empty'));
  assert.ok(noEmpty.includes(FOLD_OPEN_TAG));
  const none = renderChecklist({ rows: [], counts: { value: 0, empty: 0, unknown: 0 } });
  assert.ok(!none.includes('<details'));
  assert.ok(none.includes('表にする事項がありません'));
  const bad = out.rows.find((r) => r.status === 'empty');
  const h = renderChecklist({ ...out, rows: [{ ...bad, entity: '<img src=x>', label: '"x"' }] });
  assert.ok(h.includes('<li>&lt;img src=x&gt; — &quot;x&quot;</li>'), h.match(/<ul class="checklist-empty">[\s\S]*?<\/ul>/)?.[0]);
});

// 本物の DOM と同じく、innerHTML を入れ替えると中の details は描いた印のとおりの新しい要素になる
function foldDoc() {
  const { doc, els } = fakeDoc();
  let current = '';
  Object.defineProperty(els['checklist-result'], 'innerHTML', {
    get: () => current,
    set: (v) => {
      current = v;
      const m = v.match(/<details class="fold checklist-fold" id="checklist-fold"( open)?>/);
      if (m) els['checklist-fold'] = { open: m[1] === ' open' };
      else delete els['checklist-fold'];
    },
  });
  return { doc, els };
}

test('F79a 「確認した」を押して描き直しても、開いた表は開いたまま、閉じた表は閉じたまま。チェックとフォーカスも残る', () => {
  const { doc, els } = foldDoc();
  els['ledger-input'].value = SAMPLE.documents.ledger + '\n\n'; // 前の試験のチェックを持ち越さない
  runLedgerCheck(doc);
  assert.equal(els['checklist-fold'].open, false, '最初は閉じている');
  const [a, b] = checklistState().out.rows;
  setChecklistChecked(doc, a.id, true);
  assert.equal(els['checklist-fold'].open, false, '閉じていたのに開いた');
  const before = els['checklist-fold'];
  before.open = true;
  let openAtFocus = null;
  doc.querySelector = () => ({ focus() { openAtFocus = els['checklist-fold'].open; } });
  setChecklistChecked(doc, b.id, true);
  assert.notEqual(els['checklist-fold'], before, '描き直していない(試験が何も見ていない)');
  assert.equal(els['checklist-fold'].open, true, '描き直すと閉じた');
  assert.equal(openAtFocus, true, 'フォーカスを当てるときに閉じている');
  assert.deepEqual([...checklistState().checked].sort(), [a.id, b.id].sort());
  assert.ok(els['checklist-result'].innerHTML.includes('(確認した 2行)'));
  // 同じ台帳で点検し直しても残る。人が閉じたら閉じたまま
  runLedgerCheck(doc);
  assert.equal(els['checklist-fold'].open, true);
  els['checklist-fold'].open = false;
  setChecklistChecked(doc, a.id, false);
  assert.equal(els['checklist-fold'].open, false);
  // 台帳の文を消すと表ごと無くなる
  els['ledger-input'].value = '';
  runLedgerCheck(doc);
  assert.equal(els['checklist-fold'], undefined);
});

test('F79a 印刷: 閉じた表は openDetailsForPrint で開き、終わると閉じる。人が開いていたら開いたまま。「開く」の見出しは紙に出ない', () => {
  const { doc, els } = foldDoc();
  els['ledger-input'].value = SAMPLE.documents.ledger + '\n\n\n';
  runLedgerCheck(doc);
  doc.querySelectorAll = (sel) => (sel === 'details' ? [els['checklist-fold']] : []);
  openDetailsForPrint(doc);
  assert.equal(els['checklist-fold'].open, true, '閉じたままだと表が紙に出ない');
  restoreDetailsAfterPrint();
  assert.equal(els['checklist-fold'].open, false);
  els['checklist-fold'].open = true;
  openDetailsForPrint(doc);
  restoreDetailsAfterPrint();
  assert.equal(els['checklist-fold'].open, true);
  // class の fold で、紙では見出しを隠す決まりに乗る(表には caption が残る)
  const print = buildHtml().match(/@media print \{([\s\S]*)\n {2}\}/)[1];
  assert.match(print, /details\.fold > summary \{ display: none; \}/);
  assert.ok(renderChecklist(sampleOut()).includes('<caption>施工体制台帳の記載事項'));
  assert.ok(!/#checklist-fold|checklist-fold[^{]*\{[^}]*display: none/.test(print), '表を紙から消している');
});

test('F79a 見本の画面の道でも、「台帳を点検する」で閉じた表と「空」の一覧が出る', async () => {
  const page = runPage(buildHtml());
  await page.click('sample-load');
  await page.click('ledger-run');
  const h = page.el('checklist-result').innerHTML;
  assert.ok(h.includes('<ul class="checklist-empty">'), h.slice(0, 200));
  assert.ok(h.includes(FOLD_OPEN_TAG));
  assert.ok(h.includes('<table class="checklist-table">'));
});

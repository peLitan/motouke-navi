// ファイルをドラッグして置いて読み込む(F54c・F54d)の試験。runPage は使わず、偽物の要素で組む。値はすべて架空
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildHtml } from '../../build.mjs';
import { makeXlsx } from '../acceptance/_helpers.mjs';
import { koukokuPdf, pdfFile, PRIME_LINES, NO_PRIME_LINES, PRIME_SENTENCE } from './_koukoku-pdf.mjs';
import { findDropTarget, handleFileDrop, handleDragMove, dropPortName, fileTypeMessage, startDrop, startApp } from '../../src/ui/app.mjs';

const JSON_ACCEPT = '.json,application/json';
const XLSX_ACCEPT = '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const INTAKE = JSON.stringify({ kind: 'bid-intake', source: { title: '架空の公告' }, rows: [{ key: 'budget', status: '拾えた' }], form: { 'contract-amount': '100' } });
const RULES = fs.readFileSync(new URL('../../data/specs/wakayama_r0711_rows.json', import.meta.url), 'utf8');

function el(id, attrs = {}, parentNode = null) {
  const set = new Set();
  const listeners = {};
  return {
    id, parentNode, value: '', textContent: '', innerHTML: '', hidden: false, checked: false, files: [],
    open: false,
    setAttribute() {}, removeAttribute() {},
    getAttribute: (k) => attrs[k] ?? null,
    classList: { add: (c) => set.add(c), remove: (c) => set.delete(c), has: (c) => set.has(c) },
    listeners,
    addEventListener(t, f) { (listeners[t] ||= []).push(f); },
  };
}
// 枠・input・知らせの欄をそろえた文書。ほかの id は呼ばれたときに作る
function fakeDoc() {
  const els = new Map();
  const docListeners = {};
  const doc = {
    els, readyState: 'complete',
    getElementById(id) { if (!els.has(id)) els.set(id, el(id)); return els.get(id); },
    addEventListener(t, f) { (docListeners[t] ||= []).push(f); },
    docListeners,
  };
  doc.getElementById('sample-banner').hidden = true;
  doc.getElementById('other-tools');
  for (const [id, label] of [['intake-more', '公告から拾った条件を読み込む'], ['rules-more', '直轄とは・例の違い・自分の表を読み込む']]) {
    doc.getElementById(id).querySelector = (sel) => (sel === 'summary' ? { textContent: label } : null);
  }
  const port = (id, accept, label) => {
    const frame = el('', { 'data-drop': id });
    const hint = el(''); const lab = el(''); lab.textContent = label;
    frame.querySelector = (sel) => (sel === '.drop-hint' ? hint : sel === 'label' ? lab : null);
    frame.hint = hint;
    els.set(id, el(id, { accept }, frame));
    return frame;
  };
  doc.frames = {
    'intake-load': port('intake-load', JSON_ACCEPT, '拾った条件のファイル(.json)'),
    'rules-load': port('rules-load', JSON_ACCEPT, '自分の発注者の表を読み込む(発注者の仕様書から作った行のファイル .json)'),
    'ledger-file': port('ledger-file', XLSX_ACCEPT, '台帳の Excel を読む(国交省の「施工体制台帳(作成例)」の様式、.xlsx)'),
    'dict-import': port('dict-import', JSON_ACCEPT, '辞書を読み込む'),
    'mask-file': port('mask-file', '.txt,.docx,.xlsx,text/plain', 'ファイルから読む(.txt・.docx・.xlsx)'),
    'map-import': port('map-import', JSON_ACCEPT, '対応表を読み込む'),
    'ai-load': port('ai-load', JSON_ACCEPT, 'AI の候補を読み込む'),
  };
  doc.tile = el('entry-intake', { 'data-drop': 'intake-load' });
  showStep(doc, 'entry');
  return doc;
}
// 今見えている画面だけ hidden を外す
function showStep(doc, shown) {
  for (const id of ['entry', 'panel-confirm', 'panel-1', 'panel-2', 'panel-3']) doc.getElementById(id).hidden = id !== shown;
}
const text = (name, body) => ({ name, size: body.length, text: async () => body });
const bytesFile = (name, bytes) => ({ name, size: bytes.length, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });
function dropEv(target, files, types = ['Files']) {
  const ev = { target, prevented: 0, preventDefault() { ev.prevented += 1; }, dataTransfer: { types, files } };
  return ev;
}
const status = (doc, id) => doc.getElementById(id).textContent;
const LEDGER_ROWS = [['施工体制台帳'], ['商号', '架空一建設株式会社'], ['工事名称', '架空川 護岸改修工事']];

const html = buildHtml();
const shell = fs.readFileSync(new URL('../../src/ui/shell.html', import.meta.url), 'utf8');
const IDS = ['intake-load', 'rules-load', 'ledger-file', 'plan-file', 'dict-import', 'mask-file', 'map-import', 'ai-load'];

test('(1) 8つの input はどれも data-drop の枠の中で見えたままで、案内の文がある', () => {
  const inputs = [...html.matchAll(/<input type="file" id="([\w-]+)"/g)].map((m) => m[1]);
  assert.deepEqual(inputs.sort(), [...IDS].sort());
  for (const id of IDS) {
    const m = html.match(new RegExp('<div class="row drop" data-drop="' + id + '">(?:(?!</div>)[\\s\\S])*?<input type="file" id="' + id + '"[^>]*><span class="drop-hint">この枠にファイルをドラッグして置いても読み込めます</span></div>'));
    assert.ok(m, id + ' が枠の中に無い');
  }
  assert.ok(!/input\[type="file"\][^{]*\{[^}]*display:\s*none/.test(shell));
  assert.ok(!/input\.files\s*=[^=]/.test(html), 'input.files に代入しない');
});

test('(2) 1つ置くと、ボタンと同じ関数で読み、知らせの頭にファイル名が入る(3つの口)', async () => {
  const doc = fakeDoc();
  await handleFileDrop(doc, dropEv(doc.getElementById('intake-load'), [text('拾った条件.json', INTAKE)]));
  assert.equal(doc.getElementById('contract-amount').value, '100');
  assert.ok(status(doc, 'intake-status').startsWith('拾った条件.json を読みました。「架空の公告」から 1 欄を入れました。'), status(doc, 'intake-status'));

  await handleFileDrop(doc, dropEv(doc.frames['rules-load'], [text('県の表.json', RULES)]));
  assert.match(status(doc, 'rules-status'), /^県の表\.json を読みました\(段取り \d+行・記載項目 \d+行\)。/);

  await handleFileDrop(doc, dropEv(doc.frames['ledger-file'], [bytesFile('見本_台帳.xlsx', makeXlsx(LEDGER_ROWS))]));
  assert.match(status(doc, 'ledger-file-status'), /^見本_台帳\.xlsx を読みました\(読めない欄 \d+ 件\)。/);
  assert.match(doc.getElementById('ledger-input').value, /架空川 護岸改修工事/);
});

test('(3) 2つ置くと、どれも読まず、1つにするよう知らせる', async () => {
  const doc = fakeDoc();
  await handleFileDrop(doc, dropEv(doc.frames['intake-load'], [text('a.json', INTAKE), text('b.json', INTAKE)]));
  assert.equal(status(doc, 'intake-status'), '一度に読めるファイルは1つです。どれも読み込んでいません。');
  assert.equal(doc.getElementById('contract-amount').value, '');
});

test('(3b) ファイルの種類の印があるのに中身が来ないときは、理由を出す', async () => {
  const doc = fakeDoc();
  await handleFileDrop(doc, dropEv(doc.frames['rules-load'], []));
  assert.match(status(doc, 'rules-status'), /ファイルを受け取れませんでした/);
});

test('(4) 違う種類は読まず、受け付ける拡張子と今のファイルの名前を出す', async () => {
  const doc = fakeDoc();
  const body = doc.getElementById('ledger-input');
  body.value = '元の文';
  await handleFileDrop(doc, dropEv(doc.frames['ledger-file'], [text('見本.json', INTAKE)]));
  assert.equal(status(doc, 'ledger-file-status'), '選んだファイルは .xlsx にしてください(今のファイル: 見本.json)。');
  assert.equal(body.value, '元の文');
  await handleFileDrop(doc, dropEv(doc.frames['ledger-file'], [text('古い台帳.xls', 'x')]));
  assert.match(status(doc, 'ledger-file-status'), /今のファイル: 古い台帳\.xls\)。Excel で \.xlsx に保存し直してください。$/);
  // 大文字の拡張子は同じ種類
  assert.equal(fileTypeMessage(doc, 'intake-load', { name: 'A.JSON' }), null);
});

test('(4b) 画面の文に語幹「落と」が無い(コメントと、法令の抜き書きのデータは見ない)', () => {
  const dataModule = /^__m\["data\/.*$/;
  const lines = html.split('\n').filter((l) => !dataModule.test(l) && !/^\s*\/\//.test(l));
  const hits = lines.filter((l) => l.includes('落と'));
  assert.deepEqual(hits, []);
});

test('(5) ファイルでないドラッグは止めない。枠の中でも読まない', async () => {
  const doc = fakeDoc();
  const ev = dropEv(doc.frames['rules-load'], [], ['text/plain']);
  assert.equal(await handleFileDrop(doc, ev), false);
  handleDragMove(doc, ev);
  assert.equal(ev.prevented, 0);
  assert.equal(status(doc, 'rules-status'), '');
});

test('(5b) 枠の外に置いても、ブラウザがファイルを開かないよう止める', async () => {
  const doc = fakeDoc();
  const ev = dropEv(el(''), [text('a.json', INTAKE)]);
  await handleFileDrop(doc, ev);
  assert.equal(ev.prevented, 1);
});

test('(6) dataTransfer が無い・parentNode や getAttribute が無い要素でも落ちない', async () => {
  const doc = fakeDoc();
  assert.equal(findDropTarget(null), null);
  assert.equal(findDropTarget({}), null);
  assert.equal(await handleFileDrop(doc, {}), false);
  assert.equal(await handleFileDrop(doc, { target: {}, dataTransfer: {} }), false);
  assert.doesNotThrow(() => handleDragMove(doc, {}));
  // 文字のノードから枠へ親をたどる
  const frame = doc.frames['rules-load'];
  assert.equal(findDropTarget({ parentNode: { parentNode: frame } }), frame);
  await handleFileDrop(doc, dropEv({ parentNode: frame }, [text('a.json', '{')]));
  assert.match(status(doc, 'rules-status'), /^読み込めませんでした/);
});

test('(6a) ドラッグの間だけ、全部の枠が変わり、上の枠は口の名前を言う。置くと元に戻る', async () => {
  const doc = fakeDoc();
  const ledger = doc.frames['ledger-file'];
  const rules = doc.frames['rules-load'];
  const ev = dropEv(doc.getElementById('ledger-file'), []);
  handleDragMove(doc, ev);
  assert.equal(ev.prevented, 1);
  assert.equal(ev.dataTransfer.dropEffect, 'copy');
  assert.ok(ledger.classList.has('drop-ready') && rules.classList.has('drop-ready'));
  assert.ok(ledger.classList.has('drop-over') && !rules.classList.has('drop-over'));
  assert.equal(ledger.hint.textContent, 'ここで離すと「台帳の Excel」を読み込みます');
  handleDragMove(doc, dropEv(rules, []));
  assert.ok(!ledger.classList.has('drop-over'));
  assert.equal(ledger.hint.textContent, 'この枠にファイルをドラッグして置いても読み込めます');
  assert.equal(rules.hint.textContent, 'ここで離すと「自分の発注者の表」を読み込みます');
  await handleFileDrop(doc, dropEv(rules, [text('a.json', '{')]));
  assert.ok(!rules.classList.has('drop-over') && !rules.classList.has('drop-ready') && !ledger.classList.has('drop-ready'));
});

test('(6c) 枠の外では dropEffect を決めない(none にすると drop が届かず知らせを出せない)', () => {
  const doc = fakeDoc();
  const ev = dropEv(el(''), []);
  handleDragMove(doc, ev);
  assert.equal(ev.prevented, 1);
  assert.equal(ev.dataTransfer.dropEffect, undefined);
  handleDragMove(doc, { ...dropEv(doc.frames['rules-load'], []), preventDefault() {} });
  startDrop(doc);
  doc.docListeners.dragleave[0]({ relatedTarget: null });
  assert.ok(!doc.frames['rules-load'].classList.has('drop-ready'));
});

test('dropPortName: 括弧の前を取り、読む動きの語を外す', () => {
  assert.equal(dropPortName('拾った条件のファイル(.json)'), '拾った条件のファイル');
  assert.equal(dropPortName('ファイルから読む(.txt・.docx・.xlsx)'), 'ファイル');
  assert.equal(dropPortName('AI の候補を読み込む'), 'AI の候補');
  assert.equal(dropPortName(undefined), '');
});

const DICT = JSON.stringify({ format: 'mask-dict', version: 1, terms: [{ word: '架空一郎', kind: 'person' }] });
const MAP = JSON.stringify({ format: 'mask-map', version: 1, entries: [{ token: '〔人名1〕', original: '架空二郎', kind: 'person' }], terms: [] });
const AI = JSON.stringify({ format: 'ai-candidates', candidates: [{ message: '架空の指摘', basis: '架空の根拠' }] });

test('(F54d-1) 残り4つの口も、置くと読み、知らせにファイル名が入る', async () => {
  const doc = fakeDoc();
  const on = async (id, file) => { await handleFileDrop(doc, dropEv(doc.frames[id], [file])); };
  await on('dict-import', text('置換の辞書.json', DICT));
  assert.match(status(doc, 'dict-file-status'), /^置換の辞書\.json を読みました\(読んだ語 1・/);
  await on('map-import', text('置換の対応表.json', MAP));
  assert.match(status(doc, 'map-status'), /^置換の対応表\.json を読みました\(対応表 1 行・/);
  await on('ai-load', text('候補.json', AI));
  assert.match(status(doc, 'ai-status'), /^候補\.json を読みました\(AI の候補 1 件\)。/);
  await on('mask-file', bytesFile('現場の文.txt', new TextEncoder().encode('架空の文')));
  assert.match(status(doc, 'mask-file-status'), /^「現場の文\.txt」から文字を取り出しました/);
  assert.equal(doc.getElementById('mask-input').value, '架空の文');
});

test('(F54d-1b) ボタンで選んでも、同じ知らせになる。違う種類の文も同じで、選び直せるよう value を空にする', async () => {
  const doc = startedDoc();
  const dict = await change(doc, 'dict-import', text('置換の辞書.json', DICT));
  assert.match(status(doc, 'dict-file-status'), /^置換の辞書\.json を読みました\(/);
  assert.equal(dict.value, '');
  await change(doc, 'map-import', text('置換の対応表.json', MAP));
  assert.match(status(doc, 'map-status'), /^置換の対応表\.json を読みました\(/);
  await change(doc, 'ai-load', text('候補.json', AI));
  assert.match(status(doc, 'ai-status'), /^候補\.json を読みました\(/);
  await change(doc, 'mask-file', bytesFile('現場の文.txt', new TextEncoder().encode('架空の文')));
  assert.match(status(doc, 'mask-file-status'), /現場の文\.txt/);
  await change(doc, 'mask-file', text('写真.png', 'x'));
  assert.equal(status(doc, 'mask-file-status'), '選んだファイルは .txt・.docx・.xlsx にしてください(今のファイル: 写真.png)。');
});

test('(F54d-1c) 名前の無い File は、今までの知らせのまま読み、読めないファイルは理由を出す', async () => {
  const doc = startedDoc();
  await change(doc, 'dict-import', { size: DICT.length, text: async () => DICT });
  assert.match(status(doc, 'dict-file-status'), /^辞書を読み込みました\(/);
  await change(doc, 'map-import', { size: MAP.length, text: async () => MAP });
  assert.match(status(doc, 'map-status'), /^対応表を読み込みました\(/);
  await change(doc, 'ai-load', { size: AI.length, text: async () => AI });
  assert.match(status(doc, 'ai-status'), /^AI の候補を 1 件読み込みました。/);
  const broken = { name: 'a.json', size: 1, text: async () => { throw new Error('x'); } };
  for (const [id, st] of [['dict-import', 'dict-file-status'], ['map-import', 'map-status'], ['ai-load', 'ai-status']]) {
    await handleFileDrop(doc, dropEv(doc.frames[id], [broken]));
    assert.match(status(doc, st), /^読み込めませんでした: ファイルを読めません。/);
  }
  await handleFileDrop(doc, dropEv(doc.frames['dict-import'], [{ name: 'a.json', size: 2 * 1024 * 1024, text: async () => DICT }]));
  assert.match(status(doc, 'dict-file-status'), /大きすぎます\(1MB まで\)/);
});

test('(F54d-2) タイルに .json を置くと、段1へ移って折りたたみを開き、読む', async () => {
  const doc = fakeDoc();
  await handleFileDrop(doc, dropEv(doc.tile, [text('拾った条件.json', INTAKE)]));
  assert.equal(doc.getElementById('entry').hidden, true);
  assert.equal(doc.getElementById('panel-1').hidden, false);
  assert.equal(doc.getElementById('intake-more').open, true);
  assert.ok(status(doc, 'intake-status').startsWith('拾った条件.json を読みました。'));
  assert.equal(doc.getElementById('contract-amount').value, '100');
  assert.equal(status(doc, 'drop-status'), '');
});

test('(F54d-2b) タイルに違う種類を置くと入口に留まる。ほかの口の PDF は違う種類の文のまま', async () => {
  const doc = fakeDoc();
  await handleFileDrop(doc, dropEv(doc.tile, [text('台帳.xlsx', 'x')]));
  assert.equal(status(doc, 'drop-status'), '選んだファイルは .json にしてください(今のファイル: 台帳.xlsx)。');
  assert.equal(doc.getElementById('entry').hidden, false);
  assert.equal(doc.getElementById('intake-more').open, false);
  await handleFileDrop(doc, dropEv(doc.tile, [text('a.json', INTAKE), text('b.json', INTAKE)]));
  assert.equal(status(doc, 'drop-status'), '一度に読めるファイルは1つです。どれも読み込んでいません。');
  assert.equal(doc.getElementById('entry').hidden, false);
  await handleFileDrop(doc, dropEv(doc.frames['rules-load'], [text('公告.pdf', 'x')]));
  assert.equal(status(doc, 'rules-status'), '選んだファイルは .json にしてください(今のファイル: 公告.pdf)。');
});

// 公告の PDF を受ける段1 の枠。accept は画面の物を使う(F82c)
function pdfDoc() {
  const doc = fakeDoc();
  const accept = shell.match(/<input\b[^>]*\bid="intake-load"[^>]*\baccept="([^"]*)"/)[1];
  doc.els.set('intake-load', el('intake-load', { accept }, doc.frames['intake-load']));
  return doc;
}
const NOT_PICKED = '金額・工事の種類・等級・地域などの条件は拾っていません。';
const PRIME_FOUND = '元請けとしての実績を求める文がありました。結果の「確認が要る点」に出します。';
const PRIME_MISSED = '元請けとしての実績を求める文は見つかりませんでした。公告の本文で確かめてください。';

test('(F82c) タイルに公告の PDF を置くと、段1 を開いて欄に入れ、見た物と見ていない物を知らせる', async () => {
  const doc = pdfDoc();
  doc.getElementById('contract-amount').value = '100';
  assert.equal(await handleFileDrop(doc, dropEv(doc.tile, [pdfFile('公告.pdf', koukokuPdf([PRIME_LINES, NO_PRIME_LINES]))])), true);
  assert.equal(doc.getElementById('entry').hidden, true);
  assert.equal(doc.getElementById('panel-1').hidden, false);
  assert.equal(doc.getElementById('intake-more').open, true);
  assert.ok(doc.getElementById('participation-conditions').value.includes(PRIME_SENTENCE));
  const line = status(doc, 'intake-status');
  assert.ok(line.startsWith('「公告.pdf」の文字を読みました(2頁)。「公告の参加の条件」の欄に入れました。'), line);
  for (const part of [NOT_PICKED, '『公告を読む Skill(bid-intake)』', '文のファイル', PRIME_FOUND]) assert.ok(line.includes(part), part);
  assert.equal(status(doc, 'drop-status'), '');
  assert.equal(doc.getElementById('contract-amount').value, '100', 'ほかの欄は変えない');
});

test('(F82c) 段1 の枠に置いても同じ。実績の文が無ければ、見つからなかったと言う', async () => {
  const doc = pdfDoc();
  await handleFileDrop(doc, dropEv(doc.frames['intake-load'], [pdfFile('公告.pdf', koukokuPdf([NO_PRIME_LINES]))]));
  assert.ok(status(doc, 'intake-status').endsWith(PRIME_MISSED), status(doc, 'intake-status'));
  assert.ok(status(doc, 'intake-status').includes(NOT_PICKED));
  assert.ok(!status(doc, 'intake-status').includes(PRIME_FOUND));
});

test('(F82c) 欄に文があるときは欄を変えない', async () => {
  const doc = pdfDoc();
  doc.getElementById('participation-conditions').value = '手で貼った文';
  assert.equal(await handleFileDrop(doc, dropEv(doc.tile, [pdfFile('公告.pdf', koukokuPdf([PRIME_LINES]))])), false);
  assert.equal(doc.getElementById('participation-conditions').value, '手で貼った文');
  assert.equal(status(doc, 'intake-status'), '「公告の参加の条件」の欄に文があるので入れていません。欄を空にしてから置き直してください。');
});

test('(F82c) 読めない PDF は F82b の文で、欄を変えない', async () => {
  const doc = pdfDoc();
  assert.equal(await handleFileDrop(doc, dropEv(doc.tile, [pdfFile('写し.pdf', koukokuPdf([[]]))])), false);
  assert.equal(doc.getElementById('participation-conditions').value, '');
  assert.equal(status(doc, 'intake-status'), '「写し.pdf」を読めませんでした: 文字の入っていない PDF です(紙を写した画像だけ)。この画面は画像の文字を読みません。元の Excel・Word をもらうか、紙を見て入れてください。手で入れるときは、段1「条件を入れる」の欄に入れます。');
  await handleFileDrop(doc, dropEv(doc.frames['intake-load'], [text('公告.pdf', 'x')]));
  assert.match(status(doc, 'intake-status'), /^「公告\.pdf」を読めませんでした: /);
});

test('(F82c) 段1 の枠の外に置いたときの知らせは、枠の label の文のまま言う', async () => {
  const doc = pdfDoc();
  showStep(doc, 'panel-1');
  doc.frames['intake-load'].querySelector('label').textContent = shell.match(/<label for="intake-load">([^<]*)</)[1];
  await handleFileDrop(doc, dropEv(el(''), [text('公告.pdf', 'x')]));
  assert.ok(status(doc, 'intake-status').includes('この段の枠: 公告の PDF・拾った条件のファイル(.pdf・.json)。'), status(doc, 'intake-status'));
});

test('(F54d-3) 枠の外に置くと、今見えている段の欄に書き、見える所に出す', async () => {
  const outside = (doc) => handleFileDrop(doc, dropEv(el(''), [text('a.json', INTAKE)]));
  // 段3
  let doc = fakeDoc();
  showStep(doc, 'panel-3');
  const body = doc.getElementById('ledger-input');
  body.value = '元の文';
  let moved = null;
  doc.getElementById('ledger-file-status').scrollIntoView = (o) => { moved = o; };
  await outside(doc);
  assert.equal(status(doc, 'ledger-file-status'), '読み込んでいません。ファイルは点線の枠にドラッグしてください。この段の枠: 台帳の Excel。');
  assert.deepEqual(moved, { block: 'nearest' });
  assert.equal(status(doc, 'drop-status'), '');
  assert.equal(body.value, '元の文');
  // 入口
  doc = fakeDoc();
  await outside(doc);
  assert.match(status(doc, 'drop-status'), /^読み込んでいません。条件のファイル\(\.json\)は「公告を読み込む」のタイルに/);
  // 段1: scrollIntoView の無い要素でも落ちない
  doc = fakeDoc();
  showStep(doc, 'panel-1');
  await outside(doc);
  assert.equal(doc.getElementById('intake-more').open, true);
  assert.equal(status(doc, 'intake-status'), '読み込んでいません。ファイルは点線の枠にドラッグしてください。この段の枠: 拾った条件のファイル(.json)。「公告から拾った条件を読み込む」を開きました。');
  assert.equal(status(doc, 'drop-status'), '');
  // 段2。もう開いている折りたたみは「開きました」と言わない
  doc = fakeDoc();
  showStep(doc, 'panel-2');
  await outside(doc);
  assert.equal(doc.getElementById('rules-more').open, true);
  assert.equal(status(doc, 'rules-status'), '読み込んでいません。ファイルは点線の枠にドラッグしてください。この段の枠: 自分の発注者の表(「直轄とは・例の違い・自分の表を読み込む」を開きました)。');
  await outside(doc);
  assert.equal(status(doc, 'rules-status'), '読み込んでいません。ファイルは点線の枠にドラッグしてください。この段の枠: 自分の発注者の表。');
  // 別の道具が開いているとき
  doc = fakeDoc();
  showStep(doc, 'panel-3');
  doc.getElementById('other-tools').open = true;
  await outside(doc);
  assert.equal(status(doc, 'dict-file-status'), '読み込んでいません。ファイルは点線の枠にドラッグしてください。この道具の枠: 辞書・ファイル・対応表・AI の候補。');
  assert.equal(status(doc, 'ledger-file-status'), '');
  // 入力の確かめの画面には枠が無い
  doc = fakeDoc();
  showStep(doc, 'panel-confirm');
  await outside(doc);
  assert.match(status(doc, 'drop-status'), /^読み込んでいません。この画面にはファイルの枠がありません。/);
});

test('(F54d-3b) 次に置いたとき、入口の欄の古い知らせを残さない', async () => {
  const doc = fakeDoc();
  await handleFileDrop(doc, dropEv(el(''), [text('a.json', INTAKE)]));
  assert.notEqual(status(doc, 'drop-status'), '');
  await handleFileDrop(doc, dropEv(doc.tile, [text('拾った条件.json', INTAKE)]));
  assert.equal(status(doc, 'drop-status'), '');
});

test('(F54d-4) 違う口の .json は読まず、行き先の段と折りたたみの名前を言う', async () => {
  const doc = fakeDoc();
  const put = (id, file) => handleFileDrop(doc, dropEv(doc.frames[id], [file]));
  await put('rules-load', text('拾った条件.json', INTAKE));
  assert.equal(status(doc, 'rules-status'), 'これは公告から拾った条件のファイルです。段1「条件を入れる」の「公告から拾った条件を読み込む」を開き、その枠にドラッグしてください。');
  await put('intake-load', text('県の表.json', RULES));
  assert.match(status(doc, 'intake-status'), /^これは発注者の表のファイルです。段2「結果を見る」の「直轄とは・例の違い・自分の表を読み込む」を開き/);
  assert.equal(doc.getElementById('contract-amount').value, '');
  await put('dict-import', text('置換の対応表.json', MAP));
  assert.match(status(doc, 'dict-file-status'), /^これは対応表のファイルです。「ここからは別の道具」を開き、「対応表を読み込む」の枠に/);
  await put('map-import', text('置換の辞書.json', '\uFEFF' + DICT));
  assert.match(status(doc, 'map-status'), /^これは辞書のファイルです。/);
  await put('intake-load', text('候補.json', AI));
  assert.match(status(doc, 'intake-status'), /^これは AI の候補のファイルです。/);
  // 中身で分からないものは、今の誤りの文のまま
  await put('ai-load', text('別物.json', '{}'));
  assert.equal(status(doc, 'ai-status'), '読み込めませんでした: このファイルは AI の候補の形ではありません。');
});

test('(F54d-5) 画面の文に作る側の語を出さない。固定の文は仕様のとおり', async () => {
  assert.ok(!html.includes('(source.'));
  assert.ok(!html.includes('format が違います'));
  const doc = fakeDoc();
  await handleFileDrop(doc, dropEv(doc.frames['rules-load'], [text('表.json', JSON.stringify({ source: { publisher: '架空県', title: '架空の仕様書' }, rows: [{ kind: 'schedule' }] }))]));
  assert.equal(status(doc, 'rules-status'), '読み込めませんでした: 表のファイルに出典の版がありません(発注者・題名・版が要ります)。今の表はそのままです。');
});

test('(F54d-6) タイルは枠の印を持ち、破線を当てず、案内の1行は DOM の文にしない', () => {
  assert.ok(html.includes('<button type="button" id="entry-intake" class="entry-button drop-tile" data-drop="intake-load">'));
  const tile = html.slice(html.indexOf('id="entry-intake"'), html.indexOf('</button>', html.indexOf('id="entry-intake"')));
  assert.ok(!tile.includes('ドラッグ'));
  const fine = shell.slice(shell.indexOf('@media (any-pointer: fine)'), shell.indexOf('@media print'));
  assert.ok(fine.includes('.entry-button.drop-tile::after { content: "条件のファイル(.json)をここにドラッグして置いても読み込めます"; content: "条件のファイル(.json)をここにドラッグして置いても読み込めます" / "";'));
  assert.ok(fine.includes('.entry-button.drop-over { background: var(--primary-bg); }'));
  assert.ok(shell.slice(shell.indexOf('@media print')).includes('.entry-button.drop-tile::after { content: none; }'));
  assert.ok(!html.includes('PENDING_PORTS'));
});

test('(F54d-6b) タイルの上のドラッグは地だけ変え、ほかの枠の .drop-ready は付けない', async () => {
  const doc = fakeDoc();
  handleDragMove(doc, dropEv(doc.tile, []));
  assert.ok(doc.tile.classList.has('drop-over') && !doc.tile.classList.has('drop-ready'));
  handleDragMove(doc, dropEv(el(''), []));
  assert.ok(!doc.tile.classList.has('drop-over'));
  await handleFileDrop(doc, dropEv(doc.frames['rules-load'], []));
});

// ボタンで選ぶ道: startApp が input に付けた change を動かす
async function change(doc, id, file) {
  const input = doc.getElementById(id);
  input.files = [file];
  input.value = 'C:\\fakepath\\x';
  for (const f of input.listeners.change) await f({ target: input });
  await new Promise((r) => setImmediate(r));
  return input;
}
function startedDoc() {
  const doc = fakeDoc();
  startApp(doc, null);
  return doc;
}

test('document に drag の処理を1組だけ登録する', () => {
  const doc = startedDoc();
  for (const t of ['dragenter', 'dragover', 'dragleave', 'drop']) assert.equal(doc.docListeners[t].length, 1, t);
  const sources = ['app', 'mask-app', 'ai-app'].map((n) => fs.readFileSync(new URL('../../src/ui/' + n + '.mjs', import.meta.url), 'utf8')).join('\n');
  assert.equal(sources.match(/addEventListener\?*\.?\(?'drop'/g).length, 1);
});

test('(6b) name の無い File は、ボタンの道で拡張子の文を出さず、知らせも今のまま', async () => {
  const doc = startedDoc();
  const input = await change(doc, 'intake-load', { size: INTAKE.length, text: async () => INTAKE });
  assert.ok(status(doc, 'intake-status').startsWith('「架空の公告」から 1 欄を入れました。'), status(doc, 'intake-status'));
  assert.equal(input.value, '');
  const rules = await change(doc, 'rules-load', { size: RULES.length, text: async () => RULES });
  assert.match(status(doc, 'rules-status'), /^読み込みました\(段取り /);
  assert.equal(rules.value, '');
});

test('(2b) ボタンで選んでも、同じ知らせになる。違う種類の文も同じ', async () => {
  const doc = startedDoc();
  await change(doc, 'rules-load', text('県の表.json', RULES));
  assert.match(status(doc, 'rules-status'), /^県の表\.json を読みました\(/);
  await change(doc, 'intake-load', text('台帳.xlsx', 'x'));
  assert.equal(status(doc, 'intake-status'), '選んだファイルは .json にしてください(今のファイル: 台帳.xlsx)。');
  await change(doc, 'ledger-file', text('見本.json', '{}'));
  assert.equal(status(doc, 'ledger-file-status'), '選んだファイルは .xlsx にしてください(今のファイル: 見本.json)。');
});

test('大きすぎるファイルは、置いても今までと同じ文で断る', async () => {
  const doc = fakeDoc();
  await handleFileDrop(doc, dropEv(doc.frames['rules-load'], [{ name: 'a.json', size: 2 * 1024 * 1024, text: async () => '{}' }]));
  assert.match(status(doc, 'rules-status'), /大きすぎます\(1MB まで\)/);
  await handleFileDrop(doc, dropEv(doc.frames['intake-load'], [{ name: 'a.json', size: 2 * 1024 * 1024, text: async () => '{}' }]));
  assert.match(status(doc, 'intake-status'), /大きすぎます\(1MB まで\)/);
});

test('(7) 置く処理で closest・matches を使わない', () => {
  const app = fs.readFileSync(new URL('../../src/ui/app.mjs', import.meta.url), 'utf8');
  const part = app.slice(app.indexOf('// ファイルの読み込み口(F54c)'), app.indexOf('// 「自分の工事で入れ直す」(F37a)'));
  assert.ok(part.length > 500);
  const code = part.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  assert.ok(!/closest\(|matches\(/.test(code));
});

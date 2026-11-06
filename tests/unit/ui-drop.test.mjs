// ファイルをドラッグして置いて読み込む(F54c)の試験。runPage は使わず、偽物の要素で組む。値はすべて架空
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildHtml } from '../../build.mjs';
import { makeXlsx } from '../acceptance/_helpers.mjs';
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
  };
  return doc;
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
const IDS = ['intake-load', 'rules-load', 'ledger-file', 'dict-import', 'mask-file', 'map-import', 'ai-load'];

test('(1) 7つの input はどれも data-drop の枠の中で見えたままで、案内の文がある', () => {
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

test('まだつないでいない枠に置くと、読まないことを知らせる', async () => {
  const doc = fakeDoc();
  await handleFileDrop(doc, dropEv(doc.frames['dict-import'], [text('辞書.json', '{}')]));
  assert.match(status(doc, 'dict-file-status'), /^読み込んでいません。/);
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

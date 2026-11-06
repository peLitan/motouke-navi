// 読み込み中の知らせとファイルの口の見た目(F83a9)の試験。偽物の要素で組む。会社名・値はすべて架空
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { handleFileDrop, readingNotice } from '../../src/ui/app.mjs';
import { runMask, resetMask, decideCandidate, MASK_DEFER_CHARS, MASK_RUNNING } from '../../src/ui/mask-app.mjs';

const XLSX_ACCEPT = '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const JSON_ACCEPT = '.json,application/json';

function el(id, accept = null, parentNode = null) {
  const attrs = { accept };
  return {
    id, parentNode, value: '', hidden: false, open: false, files: [], _text: '', _html: '',
    get textContent() { return this._text; }, set textContent(v) { this._text = String(v ?? ''); this._html = this._text; },
    get innerHTML() { return this._html; }, set innerHTML(v) { this._html = String(v); this._text = this._html.replace(/<[^>]+>/g, ''); },
    attrs,
    setAttribute(k, v) { attrs[k] = String(v); },
    removeAttribute(k) { delete attrs[k]; },
    getAttribute: (k) => attrs[k] ?? null,
    classList: { add() {}, remove() {} },
    addEventListener() {},
  };
}
// 枠の中に input を置いた文書。ほかの id は呼ばれたときに作る
function fakeDoc() {
  const els = new Map();
  const doc = { els, getElementById(id) { if (!els.has(id)) els.set(id, el(id)); return els.get(id); } };
  doc.getElementById('sample-banner').hidden = true;
  doc.frame = (id, accept) => {
    const frame = el('');
    frame.attrs['data-drop'] = id;
    frame.querySelector = () => null;
    els.set(id, el(id, accept, frame));
    return frame;
  };
  return doc;
}
const drop = (doc, frame, file) => handleFileDrop(doc, { target: frame, preventDefault() {}, dataTransfer: { types: ['Files'], files: [file] } });
// 読み終わりを試験の側で決められるファイル
function slowFile(name, bytes = new Uint8Array(0)) {
  let release;
  const gate = new Promise((ok, ng) => { release = { ok: () => ok(bytes.buffer), ng: (e) => ng(e) }; });
  return { file: { name, size: bytes.length, arrayBuffer: () => gate, text: () => gate.then(() => '') }, release };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

test('読む間: 口の欄に「「名前」を読んでいます…」と aria-busy があり、読み終わると無い(失敗でも外れる)', async () => {
  const doc = fakeDoc();
  const frame = doc.frame('ledger-file', XLSX_ACCEPT);
  const status = doc.getElementById('ledger-file-status');
  const { file, release } = slowFile('架空の台帳.xlsx');
  const done = drop(doc, frame, file);
  await tick();
  assert.equal(status.textContent, '「架空の台帳.xlsx」を読んでいます…');
  assert.equal(status.textContent, readingNotice(file));
  assert.equal(status.getAttribute('aria-busy'), 'true');
  // 読めない中身(空のファイル)で失敗させる
  release.ok();
  assert.equal(await done, false);
  assert.equal(status.getAttribute('aria-busy'), null);
  assert.ok(!status.textContent.includes('読んでいます'), status.textContent);
  assert.ok(status.textContent.length > 0);
  assert.equal(status.getAttribute('data-kind'), 'error');
});

test('読む間: ファイルを読めずに例外になっても aria-busy が外れ、読んでいますが残らない', async () => {
  const doc = fakeDoc();
  const frame = doc.frame('mask-file', '.txt,.docx,.xlsx,.pdf,text/plain');
  const status = doc.getElementById('mask-file-status');
  const { file, release } = slowFile('架空の書類.docx');
  const done = drop(doc, frame, file);
  await tick();
  assert.ok(status.textContent.includes('「架空の書類.docx」を読んでいます'), status.textContent);
  assert.equal(status.getAttribute('aria-busy'), 'true');
  release.ng(new Error('架空の読み込みの失敗'));
  assert.equal(await done, false);
  assert.equal(status.getAttribute('aria-busy'), null);
  assert.ok(!status.textContent.includes('読んでいます'), status.textContent);
  assert.ok(status.textContent.includes('架空の書類.docx'), '失敗の知らせにもファイルの名前: ' + status.textContent);
});

test('読み終わり: 成功の知らせにファイルの名前があり、aria-busy が無い', async () => {
  const doc = fakeDoc();
  const frame = doc.frame('mask-file', '.txt,.docx,.xlsx,.pdf,text/plain');
  const status = doc.getElementById('mask-file-status');
  const bytes = new TextEncoder().encode('架空の本文です。\n二行目です。\n');
  const { file, release } = slowFile('架空のメモ.txt', bytes);
  const done = drop(doc, frame, file);
  await tick();
  assert.equal(status.getAttribute('aria-busy'), 'true');
  release.ok();
  assert.equal(await done, true);
  assert.equal(status.getAttribute('aria-busy'), null);
  assert.ok(status.textContent.includes('架空のメモ.txt'), status.textContent);
  assert.ok(!status.textContent.includes('読んでいます'));
});

test('重ねて読む: 段1 の口は順番に読み、最後の1つが終わるまで aria-busy を外さない', async () => {
  const doc = fakeDoc();
  const frame = doc.frame('intake-load', JSON_ACCEPT);
  const status = doc.getElementById('intake-status');
  const intake = JSON.stringify({ kind: 'bid-intake', source: { title: '架空の公告' }, rows: [], form: {} });
  const a = slowFile('架空の条件A.json');
  const b = slowFile('架空の条件B.json');
  a.file.text = () => a.file.arrayBuffer().then(() => intake);
  b.file.text = () => b.file.arrayBuffer().then(() => intake);
  const first = drop(doc, frame, a.file);
  const second = drop(doc, frame, b.file);
  await tick();
  assert.equal(status.textContent, '「架空の条件B.json」を読んでいます…');
  assert.equal(status.getAttribute('aria-busy'), 'true');
  a.release.ok();
  await first;
  assert.equal(status.getAttribute('aria-busy'), 'true', '2つ目を読んでいる間は外さない');
  b.release.ok();
  await second;
  assert.equal(status.getAttribute('aria-busy'), null);
  assert.ok(status.textContent.includes('架空の条件B.json'), status.textContent);
});

test('種類の違うファイルは読まないので、読んでいますも aria-busy も出さない', async () => {
  const doc = fakeDoc();
  const frame = doc.frame('ledger-file', XLSX_ACCEPT);
  const status = doc.getElementById('ledger-file-status');
  assert.equal(await drop(doc, frame, { name: '架空の台帳.xls', size: 1, arrayBuffer: async () => new ArrayBuffer(1) }), false);
  assert.ok(!status.textContent.includes('読んでいます'));
  assert.equal(status.getAttribute('aria-busy'), null);
});

function maskDoc() {
  const doc = fakeDoc();
  for (const id of ['mask-amounts', 'mask-thresholds']) doc.getElementById(id);
  return doc;
}
test('置き換え: 20,000字を超える文は「置き換えています…」を出し、画面に手を返してから走らせる', async () => {
  const doc = maskDoc();
  resetMask(doc);
  const status = doc.getElementById('mask-status');
  const line = '| 商号 | みほんリペア |\n元請は架空土木株式会社です。\n';
  doc.getElementById('mask-input').value = line.repeat(Math.ceil((MASK_DEFER_CHARS + 1) / line.length));
  assert.ok(doc.getElementById('mask-input').value.length > MASK_DEFER_CHARS);
  const later = runMask(doc);
  assert.ok(later instanceof Promise);
  // まだ走っていない(後の欄は空)
  assert.equal(status.textContent, MASK_RUNNING);
  assert.equal(status.getAttribute('aria-busy'), 'true');
  assert.equal(doc.getElementById('mask-after').textContent, '');
  await later;
  assert.equal(status.getAttribute('aria-busy'), null);
  assert.notEqual(status.textContent, MASK_RUNNING);
  assert.ok(doc.getElementById('mask-after').textContent.includes('〔会社名1〕'));
  assert.ok(!doc.getElementById('mask-after').textContent.includes('架空土木株式会社'));
  // 候補を足して置き換え直したときの知らせは、置き換えの後に残る
  assert.equal(decideCandidate(doc, 'みほんリペア', 'add'), true);
  assert.equal(doc.getElementById('mask-candidate-status').textContent, '');
  await tick();
  await tick();
  assert.ok(doc.getElementById('mask-candidate-status').textContent.includes('「みほんリペア」を'), doc.getElementById('mask-candidate-status').textContent);
});

test('置き換え: 20,000字以下の文は今までどおりその場で走る', () => {
  const doc = maskDoc();
  resetMask(doc);
  doc.getElementById('mask-input').value = 'あ'.repeat(MASK_DEFER_CHARS - 30) + '元請は架空土木株式会社です。';
  assert.equal(runMask(doc), null);
  assert.notEqual(doc.getElementById('mask-status').textContent, MASK_RUNNING);
  assert.equal(doc.getElementById('mask-status').getAttribute('aria-busy'), null);
  assert.ok(doc.getElementById('mask-after').textContent.includes('〔会社名1〕'));
});

test('ファイルの口: ::file-selector-button がほかのボタンと同じ枠・色・角丸・高さで、焦点の決まりを足していない', () => {
  const html = fs.readFileSync(new URL('../../src/ui/shell.html', import.meta.url), 'utf8');
  const css = html.slice(html.indexOf('<style>'), html.indexOf('</style>')).replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [...css.replace(/@media [^{]*\{/g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2] }));
  const ruleOf = (sel) => rules.find((r) => r.sel === sel)?.body;
  const prop = (body, name) => body?.match(new RegExp('(?:^|;)\\s*' + name + '\\s*:\\s*([^;]+)'))?.[1].trim();
  const button = ruleOf('button');
  const file = ruleOf('input[type="file"]::file-selector-button');
  assert.ok(file, '::file-selector-button の決まりが無い');
  for (const name of ['min-height', 'color', 'background', 'border', 'border-radius', 'cursor']) {
    assert.equal(prop(file, name), prop(button, name), name + ' がボタンと違う');
  }
  assert.equal(prop(ruleOf('input[type="file"]::file-selector-button:hover'), 'background'), prop(ruleOf('button:hover'), 'background'));
  // 焦点は input の決まり(ボタンと同じ本体)で欄の全体に付く。部品ごとの焦点の決まりは足さない
  assert.ok(!rules.some((r) => r.sel.includes('file-selector-button') && r.sel.includes('focus')));
  assert.ok(!/file-selector-button[^{]*\{[^}]*outline/.test(css));
  // 指の端末では、ほかの押す所と同じ 48px
  const coarse = css.slice(css.indexOf('@media (pointer: coarse)'));
  assert.match(coarse.slice(0, coarse.indexOf('}\n  }') + 1), /input\[type="file"\]::file-selector-button \{ min-height: 3rem; \}/);
});

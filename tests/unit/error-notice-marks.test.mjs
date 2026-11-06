// F58a: 失敗の知らせに data-kind="error" を付け、成功・空の文では外す。文は変えない。値はすべて架空
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildHtml } from '../../build.mjs';
import { makeXlsx, runPage } from '../acceptance/_helpers.mjs';
import { handleFileDrop } from '../../src/ui/app.mjs';

const html = buildHtml();
const shell = fs.readFileSync(new URL('../../src/ui/shell.html', import.meta.url), 'utf8');
const css = shell.match(/<style>([\s\S]*?)<\/style>/)[1].replace(/\/\*[\s\S]*?\*\//g, '');
const screenCss = css.replace(/@media print \{[\s\S]*\n {2}\}/, '');
const rules = [...screenCss.replace(/@media [^{]*\{/g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2] }));
const ruleOf = (sel) => rules.find((r) => r.sel === sel)?.body;
const prop = (body, name) => body?.match(new RegExp('(?:^|;)\\s*' + name + '\\s*:\\s*([^;]+)'))?.[1].trim();

const text = (name, body) => ({ name, size: body.length, text: async () => body });
const bytesFile = (name, bytes) => ({ name, size: bytes.length, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });
const unreadable = (name) => ({ name, size: 1, text: async () => { throw new Error('架空の読み取りの失敗'); } });
const tooBig = (name) => ({ name, size: 2 * 1024 * 1024, text: async () => '{}' });

const INTAKE = JSON.stringify({ kind: 'bid-intake', source: { title: '架空の公告' }, rows: [{ key: 'budget', status: '拾えた' }], form: { 'contract-amount': '100' } });
const RULES = fs.readFileSync(new URL('../../data/specs/wakayama_r0711_rows.json', import.meta.url), 'utf8');
const DICT = JSON.stringify({ format: 'mask-dict', version: 1, terms: [{ word: '架空一郎', kind: 'person' }] });
const MAP = JSON.stringify({ format: 'mask-map', version: 1, entries: [{ token: '〔人名1〕', original: '架空二郎', kind: 'person' }], terms: [] });
const AI = JSON.stringify({ format: 'ai-candidates', candidates: [{ message: '架空の指摘', basis: '架空の根拠' }] });

// id: 口の input、status: 知らせの欄、good: 読めるファイルの中身、big: 大きさの上限がある口
const JSON_PORTS = [
  { id: 'intake-load', status: 'intake-status', good: INTAKE, big: true },
  { id: 'rules-load', status: 'rules-status', good: RULES, big: true },
  { id: 'dict-import', status: 'dict-file-status', good: DICT, big: true },
  { id: 'map-import', status: 'map-status', good: MAP },
  { id: 'ai-load', status: 'ai-status', good: AI },
];

const kind = (page, id) => page.el(id).getAttribute('data-kind');
const line = (page, id) => page.el(id).textContent;
async function readIn(page, id, file) {
  page.el(id).files = [file];
  await page.set(id, '');
}

for (const port of JSON_PORTS) {
  test(port.id + ': 読めないと印が付き、読めると外れる。文の頭は変わらない', async () => {
    const page = runPage(html);
    assert.equal(kind(page, port.status), null, '最初は印が無い');

    await readIn(page, port.id, text('壊れた.json', '{'));
    assert.match(line(page, port.status), /^読み込めませんでした: /);
    assert.equal(kind(page, port.status), 'error');

    await readIn(page, port.id, text('架空.json', port.good));
    assert.match(line(page, port.status), /^架空\.json を読みました/);
    assert.equal(kind(page, port.status), null, '成功の文に前の印が残っている');

    await readIn(page, port.id, unreadable('読めない.json'));
    assert.match(line(page, port.status), /^読み込めませんでした: ファイルを読めません。/);
    assert.equal(kind(page, port.status), 'error');

    await readIn(page, port.id, text('架空.json', port.good));
    assert.equal(kind(page, port.status), null);

    await readIn(page, port.id, text('写真.png', 'x'));
    assert.equal(line(page, port.status), '選んだファイルは .json にしてください(今のファイル: 写真.png)。');
    assert.equal(kind(page, port.status), 'error');

    if (port.big) {
      await readIn(page, port.id, text('架空.json', port.good));
      await readIn(page, port.id, tooBig('大きい.json'));
      assert.match(line(page, port.status), /^読み込めませんでした: .*大きすぎます/);
      assert.equal(kind(page, port.status), 'error');
    }
  });
}

test('違う口のファイルは読まず、失敗の印が付く', async () => {
  const page = runPage(html);
  await readIn(page, 'rules-load', text('条件.json', INTAKE));
  assert.ok(line(page, 'rules-status').startsWith('これは公告から拾った条件のファイルです。'), line(page, 'rules-status'));
  assert.equal(kind(page, 'rules-status'), 'error');
});

test('失敗の語で始まる名前のファイルでも、読めたら印を付けない(文では判定しない)', async () => {
  const page = runPage(html);
  await readIn(page, 'dict-import', text('読み込めませんでした.json', DICT));
  assert.ok(line(page, 'dict-file-status').startsWith('読み込めませんでした.json を読みました'));
  assert.equal(kind(page, 'dict-file-status'), null);
});

test('読み込み以外の文で書き直しても、前の失敗の印を残さない', async () => {
  const page = runPage(html);
  await readIn(page, 'rules-load', text('壊れた.json', '{'));
  await page.click('rules-national');
  assert.equal(line(page, 'rules-status'), '国の直轄の例に戻しました。');
  assert.equal(kind(page, 'rules-status'), null);

  await readIn(page, 'dict-import', text('壊れた.json', '{'));
  await readIn(page, 'map-import', text('壊れた.json', '{'));
  assert.equal(kind(page, 'dict-file-status'), 'error');
  await page.click('mask-reset');
  for (const id of ['dict-file-status', 'map-status']) {
    assert.equal(line(page, id), '');
    assert.equal(kind(page, id), null, id + ' の空の文に印が残っている');
  }
});

test('公告の読み込みの順番の中でも、最後に読んだファイルの結果の印になる', async () => {
  const twoReads = async (first, second) => {
    const page = runPage(html);
    page.el('intake-load').files = [first];
    page.el('intake-load').dispatchEvent({ type: 'change', bubbles: false });
    await readIn(page, 'intake-load', second);
    return page;
  };
  const failThenRead = await twoReads(text('壊れた.json', '{'), text('架空.json', INTAKE));
  assert.ok(line(failThenRead, 'intake-status').startsWith('架空.json を読みました。'));
  assert.equal(kind(failThenRead, 'intake-status'), null);
  const readThenFail = await twoReads(text('架空.json', INTAKE), text('壊れた.json', '{'));
  assert.match(line(readThenFail, 'intake-status'), /^読み込めませんでした: /);
  assert.equal(kind(readThenFail, 'intake-status'), 'error');
});

// ドラッグの口は枠をたどるので、属性を覚える偽の要素で組む
function el(id, attrs = {}, parentNode = null) {
  const a = { ...attrs };
  return {
    id, parentNode, value: '', textContent: '', innerHTML: '', hidden: false, checked: false, files: [], open: false,
    setAttribute: (k, v) => { a[k] = String(v); },
    removeAttribute: (k) => { delete a[k]; },
    getAttribute: (k) => a[k] ?? null,
    classList: { add() {}, remove() {} },
    addEventListener() {},
  };
}
function fakeDoc(shown = 'entry') {
  const els = new Map();
  const doc = { getElementById(id) { if (!els.has(id)) els.set(id, el(id)); return els.get(id); } };
  doc.getElementById('sample-banner').hidden = true;
  for (const [id, label] of [['intake-more', '公告から拾った条件を読み込む'], ['rules-more', '自分の表を読み込む']]) {
    doc.getElementById(id).querySelector = (sel) => (sel === 'summary' ? { textContent: label } : null);
  }
  const port = (id, accept, label) => {
    const frame = el('', { 'data-drop': id });
    const lab = el(''); lab.textContent = label;
    const hint = el('');
    frame.querySelector = (sel) => (sel === '.drop-hint' ? hint : sel === 'label' ? lab : null);
    els.set(id, el(id, { accept }, frame));
    return frame;
  };
  const JSON_ACCEPT = '.json,application/json';
  doc.frames = {
    'intake-load': port('intake-load', JSON_ACCEPT, '拾った条件のファイル(.json)'),
    'rules-load': port('rules-load', JSON_ACCEPT, '自分の発注者の表を読み込む(.json)'),
    'ledger-file': port('ledger-file', '.xlsx', '台帳の Excel を読む(.xlsx)'),
    'dict-import': port('dict-import', JSON_ACCEPT, '辞書を読み込む'),
    'mask-file': port('mask-file', '.txt,.docx,.xlsx', 'ファイルから読む(.txt・.docx・.xlsx)'),
    'map-import': port('map-import', JSON_ACCEPT, '対応表を読み込む'),
    'ai-load': port('ai-load', JSON_ACCEPT, 'AI の候補を読み込む'),
  };
  doc.tile = el('entry-intake', { 'data-drop': 'intake-load' });
  for (const id of ['entry', 'panel-confirm', 'panel-1', 'panel-2', 'panel-3']) doc.getElementById(id).hidden = id !== shown;
  return doc;
}
const drop = (doc, target, files) => handleFileDrop(doc, { target, preventDefault() {}, dataTransfer: { types: ['Files'], files } });
const fakeLine = (doc, id) => doc.getElementById(id).textContent;
const fakeKind = (doc, id) => doc.getElementById(id).getAttribute('data-kind');

test('台帳の Excel: 読めないと印が付き、読めると外れる', async () => {
  const doc = fakeDoc('panel-3');
  await drop(doc, doc.frames['ledger-file'], [bytesFile('壊れた台帳.xlsx', new TextEncoder().encode('架空の壊れた中身'))]);
  assert.ok(fakeLine(doc, 'ledger-file-status').startsWith('「壊れた台帳.xlsx」を読めませんでした: '), fakeLine(doc, 'ledger-file-status'));
  assert.equal(fakeKind(doc, 'ledger-file-status'), 'error');
  await drop(doc, doc.frames['ledger-file'], [bytesFile('架空の台帳.xlsx', makeXlsx([['施工体制台帳'], ['工事名称', '架空川 護岸改修工事']]))]);
  assert.match(fakeLine(doc, 'ledger-file-status'), /^架空の台帳\.xlsx を読みました\(/);
  assert.equal(fakeKind(doc, 'ledger-file-status'), null);
});

test('置き換えるファイル: 読めないと印が付き、読めると外れる', async () => {
  const doc = fakeDoc();
  await drop(doc, doc.frames['mask-file'], [bytesFile('壊れた.docx', new TextEncoder().encode('架空の壊れた中身'))]);
  assert.ok(fakeLine(doc, 'mask-file-status').startsWith('「壊れた.docx」を読めませんでした: '), fakeLine(doc, 'mask-file-status'));
  assert.equal(fakeKind(doc, 'mask-file-status'), 'error');
  await drop(doc, doc.frames['mask-file'], [bytesFile('現場の文.txt', new TextEncoder().encode('架空の文'))]);
  assert.match(fakeLine(doc, 'mask-file-status'), /^「現場の文\.txt」から文字を取り出しました/);
  assert.equal(fakeKind(doc, 'mask-file-status'), null);
});

test('枠に2つ置く・中身が来ない: 読まなかった文に印が付き、次に読めると外れる', async () => {
  const doc = fakeDoc();
  const frame = doc.frames['rules-load'];
  await drop(doc, frame, [text('a.json', RULES), text('b.json', RULES)]);
  assert.equal(fakeLine(doc, 'rules-status'), '一度に読めるファイルは1つです。どれも読み込んでいません。');
  assert.equal(fakeKind(doc, 'rules-status'), 'error');
  await drop(doc, frame, [text('架空.json', RULES)]);
  assert.equal(fakeKind(doc, 'rules-status'), null);
  await drop(doc, frame, []);
  assert.match(fakeLine(doc, 'rules-status'), /ファイルを受け取れませんでした/);
  assert.equal(fakeKind(doc, 'rules-status'), 'error');
});

test('枠の外に置く: 読まなかった文に印が付く', async () => {
  const entry = fakeDoc();
  await drop(entry, el(''), [text('a.json', INTAKE)]);
  assert.ok(fakeLine(entry, 'drop-status').startsWith('読み込んでいません。'));
  assert.equal(fakeKind(entry, 'drop-status'), 'error');
  const step1 = fakeDoc('panel-1');
  await drop(step1, el(''), [text('a.json', INTAKE)]);
  assert.ok(fakeLine(step1, 'intake-status').startsWith('読み込んでいません。'));
  assert.equal(fakeKind(step1, 'intake-status'), 'error');
});

test('入口のタイル: 種類の違いは入口の欄に、読めない中身は段1の欄に印が付く。次に置くと入口の欄の印は外れる', async () => {
  const doc = fakeDoc();
  await drop(doc, doc.tile, [text('写真.png', 'x')]);
  assert.ok(fakeLine(doc, 'drop-status').startsWith('選んだファイルは .json にしてください'));
  assert.equal(fakeKind(doc, 'drop-status'), 'error');

  await drop(doc, doc.tile, [text('壊れた.json', '{')]);
  assert.equal(fakeLine(doc, 'drop-status'), '');
  assert.equal(fakeKind(doc, 'drop-status'), null, '空の文に印が残っている');
  assert.match(fakeLine(doc, 'intake-status'), /^読み込めませんでした: /);
  assert.equal(fakeKind(doc, 'intake-status'), 'error');

  await drop(doc, doc.tile, [text('架空.json', INTAKE)]);
  assert.ok(fakeLine(doc, 'intake-status').startsWith('架空.json を読みました。'));
  assert.equal(fakeKind(doc, 'intake-status'), null);
});

test('#bid-status: 金額を読めないと印が付き、戻る(空)・条件の変更で外れる', async () => {
  const page = runPage(html);
  await page.set('contract-amount', '約2億円');
  await page.click('bid-run');
  assert.ok(line(page, 'bid-status').startsWith('＊ 金額の欄を読めませんでした。'), line(page, 'bid-status'));
  assert.equal(kind(page, 'bid-status'), 'error');

  await page.click('entry-back');
  assert.equal(line(page, 'bid-status'), '');
  assert.equal(kind(page, 'bid-status'), null, '空の文に印が残っている');

  await page.click('entry-awarded');
  assert.ok(line(page, 'bid-status').startsWith('＊ 金額の欄を読めませんでした。'));
  assert.equal(kind(page, 'bid-status'), 'error', 'もう受注したの道でも同じ');

  await page.set('contract-amount', '1000');
  assert.ok(line(page, 'bid-status').startsWith('＊ 条件が変わりました。'), line(page, 'bid-status'));
  assert.equal(kind(page, 'bid-status'), null, '失敗の文のあとの「条件が変わりました」に印が残っている');
});

test('#bid-status: 判定の途中で止まると印が付く', async () => {
  const broken = html.replace('const bid = bidCheck(input);', "throw new Error('架空の止まり');");
  assert.notEqual(broken, html, '判定の呼び出しの文が見つからない');
  const page = runPage(broken);
  await page.click('bid-run');
  assert.ok(line(page, 'bid-status').startsWith('＊ 判定の途中で止まりました。'), line(page, 'bid-status'));
  assert.equal(kind(page, 'bid-status'), 'error');
});

test('#bid-status: 同じ「＊」でも、失敗でない文には印を付けない。✓ の文にも付けない', async () => {
  const page = runPage(html);
  await page.click('bid-run');
  assert.ok(line(page, 'bid-status').startsWith('＊ 仮の結果が出ました'), line(page, 'bid-status'));
  assert.equal(kind(page, 'bid-status'), null, '仮の結果は失敗ではない');

  await page.set('contract-amount', '1000');
  assert.ok(line(page, 'bid-status').startsWith('＊ 条件が変わりました。'), line(page, 'bid-status'));
  assert.equal(kind(page, 'bid-status'), null, '条件の変更は失敗ではない');

  const sample = runPage(html);
  await sample.click('sample-load');
  assert.ok(line(sample, 'bid-status').startsWith('✓ 見本を読み込みました。'), line(sample, 'bid-status'));
  assert.equal(kind(sample, 'bid-status'), null);
});

test('CSS: 失敗の知らせは左線と字が --need。.errors の枠も同じ線で、行の中の文には線を付けない', () => {
  const failed = ruleOf('p[aria-live][data-kind="error"]:not(:empty)');
  assert.ok(failed, '失敗の知らせの決まりが無い');
  assert.equal(prop(failed, 'border-left-color'), 'var(--need)');
  assert.equal(prop(failed, 'color'), 'var(--need)');
  // 線の太さと太字は知らせの行の決まりのまま
  const base = ruleOf('p[aria-live]:not(:empty)');
  assert.equal(prop(base, 'border-left'), '4px solid var(--primary)');
  assert.equal(prop(base, 'font-weight'), 'bold');

  assert.equal(prop(ruleOf('.errors'), 'color'), 'var(--need)');
  assert.equal(prop(ruleOf('.errors'), 'border-left'), undefined, '確かめの画面の行の中の span に線が付く');
  assert.equal(prop(ruleOf('div.errors'), 'border-left'), '4px solid var(--need)');
});

test('印を付ける欄はどれも aria-live の p で、CSS の決まりに当たる', () => {
  for (const id of ['bid-status', 'drop-status', 'intake-status', 'rules-status', 'ledger-file-status', 'dict-file-status', 'mask-file-status', 'map-status', 'ai-status']) {
    assert.match(html, new RegExp('<p id="' + id + '"[^>]*aria-live="polite"'), id);
  }
});

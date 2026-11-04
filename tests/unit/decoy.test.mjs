// 見本の語を混ぜて見落としを測る(F28a、src/mask/decoy.mjs)の試験。人名・会社名・住所はすべて架空
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMasker } from '../../src/mask/core.mjs';
import { CONSTRUCTION_DICT } from '../../src/mask/dict-construction.mjs';
import { MEDICAL_DICT } from '../../src/mask/dict-medical.mjs';
import { makeDecoys, makeHardDecoys, checkDecoys, decoyMessage, DECOY_TYPES, DECOY_HARD_TYPES, DECOY_PER_KIND, DECOY_LABELS } from '../../src/mask/decoy.mjs';
import { runMask, resetMask, setDecoyRandom, lastDecoyCheck } from '../../src/ui/mask-app.mjs';
import { handleMessage, readMasked } from '../../integration/claude-code/mcp/masked-files.mjs';
import { indexHtml, runPage, withoutScripts } from '../acceptance/_helpers.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TEXT = '工事名: みほん市道 架空3号線 道路改良工事\n現場代理人 乙山 二郎、甲山建設株式会社。乙山 二郎が確かめる。\n連絡先 03-0000-0000';

// 決まった並びの乱数(試験で型の選び方を決めるため)
function seeded(seed) {
  let x = seed >>> 0;
  return () => { x = (x * 1664525 + 1013904223) >>> 0; return x / 2 ** 32; };
}
const allWords = (decoys) => decoys.map((d) => d.word);
// 見本の語と、その空白で分けた部分(2字以上で、元の文に無いもの)
const words = (d) => [d.word, ...d.word.split(/[\s\u3000]+/).filter((w) => w.length >= 2 && !TEXT.includes(w))];

test('見本: 種類ごとに型を重ねずに選び、合わせて6語。型は乱数で変わる', () => {
  const ds = makeDecoys(seeded(1));
  assert.equal(ds.length, Object.keys(DECOY_TYPES).length * DECOY_PER_KIND);
  for (const kind of Object.keys(DECOY_TYPES)) {
    const mine = ds.filter((d) => d.kind === kind);
    assert.equal(mine.length, DECOY_PER_KIND, kind);
    assert.equal(new Set(mine.map((d) => d.type)).size, DECOY_PER_KIND, '同じ型が2つ: ' + kind);
    assert.ok(mine.every((d) => d.label === DECOY_LABELS[kind] && d.line.includes(d.word)));
  }
  const sets = new Set();
  for (let s = 0; s < 20; s++) sets.add(makeDecoys(seeded(s)).map((d) => d.type).join('|'));
  assert.ok(sets.size >= 5, '型の組が変わらない: ' + sets.size);
});

test('見本の確かめ: 建設と医療(例)の辞書で、すべての型が置き換わる(乱数を変えて 200 回)', () => {
  for (const dict of [CONSTRUCTION_DICT, MEDICAL_DICT]) {
    const m = createMasker({ dictionaries: [dict] });
    for (let s = 0; s < 200; s++) {
      const r = checkDecoys(m, TEXT, { rand: seeded(s) });
      assert.equal(r.total, 6);
      assert.deepEqual(r.missed, [], dict.name + ' ' + s);
      assert.equal(r.masked, 6);
    }
    // 型の表のすべてを1つずつ
    for (const kind of Object.keys(DECOY_TYPES)) {
      for (const t of DECOY_TYPES[kind]) {
        const rand = seeded(kind.length * 7 + t.id.length);
        const pick = (l) => l[Math.floor(rand() * l.length)];
        const num = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));
        const d = { kind, label: DECOY_LABELS[kind], type: t.id, ...t.make(pick, num) };
        assert.deepEqual(checkDecoys(m, '', { decoys: [d] }).missed, [], t.id + ' ' + d.word);
      }
    }
  }
});

test('混ぜた語は、後の欄・対応表・記号の番号・書き出した対応表に出ない', () => {
  const a = createMasker({ dictionaries: [CONSTRUCTION_DICT] });
  const b = createMasker({ dictionaries: [CONSTRUCTION_DICT] });
  const ra = a.mask(TEXT);
  const decoys = makeDecoys(seeded(3));
  const check = checkDecoys(b, TEXT, { decoys });
  const rb = b.mask(TEXT);
  assert.equal(check.masked, 6);
  // 確かめの前後で置き換えの結果は同じ(記号の番号も同じ)
  assert.deepEqual(rb, ra);
  // 確かめをはさんでも、次の置き換えの記号の番号は続きのまま
  checkDecoys(b, TEXT, { rand: seeded(4) });
  const next = b.mask('担当者: 丙川 三郎');
  assert.equal(next.masked, '担当者: 〔人名2〕');
  const outText = rb.masked + JSON.stringify(b.entries()) + b.exportMap() + next.masked;
  for (const d of decoys) for (const w of words(d)) assert.ok(!outText.includes(w), '見本の語が出た: ' + w);
  assert.ok(!b.entries().some((e) => allWords(decoys).includes(e.original)));
});

test('検査の結果: 残った語があれば、数・型・語を出す(置き換える所を探せない masker で確かめる)', () => {
  const none = { spans: () => [] };
  const decoys = makeDecoys(seeded(5));
  const r = checkDecoys(none, TEXT, { decoys });
  assert.equal(r.total, 6);
  assert.equal(r.masked, 0);
  assert.equal(r.missed.length, 6);
  const msg = decoyMessage(r);
  assert.match(msg, /見つけやすい型 0\/6・見つけにくい型 0\/6/);
  assert.match(msg, /注意: 6語が残りました/);
  for (const d of decoys) assert.ok(msg.includes(d.type) && msg.includes(d.word), d.type);
  // 一部だけ当たる語(人名の姓だけ)は、置き換えたとみなさない
  const half = { spans: (text) => { const i = text.lastIndexOf('甲野'); return i >= 0 ? [{ start: i, end: i + 2, kind: 'person' }] : []; } };
  const one = [{ kind: 'person', label: '人名', type: '欄名の後ろ(担当者: 姓 名)', line: '担当者: 甲野 一郎', word: '甲野 一郎' }];
  assert.equal(checkDecoys(half, '', { decoys: one }).masked, 0);
  // 全部置き換えたときは注意を出さない
  const okMsg = decoyMessage(checkDecoys(createMasker({ dictionaries: [CONSTRUCTION_DICT] }), TEXT, { decoys }));
  assert.match(okMsg, /^確かめのための見本: 見つけやすい型 6\/6・見つけにくい型 \d\/6\(/);
  assert.ok(!okMsg.includes('注意'));
});

// 部品を直接動かすための小さな画面
function fakeDoc(input) {
  const els = {};
  const el = (id) => (els[id] ||= {
    id, value: '', hidden: false, _html: '', _text: '', handlers: {},
    get innerHTML() { return this._html; }, set innerHTML(v) { this._html = String(v); this._text = this._html.replace(/<[^>]+>/g, ''); },
    get textContent() { return this._text; }, set textContent(v) { this._text = String(v ?? ''); this._html = this._text; },
    addEventListener(type, f) { this.handlers[type] = f; },
  });
  for (const id of ['mask-input', 'mask-amounts', 'mask-thresholds', 'mask-before', 'mask-after', 'mask-map', 'mask-review', 'mask-unchecked', 'mask-status', 'mask-decoy', 'unmask-output', 'map-status', 'dict-word', 'dict-kind', 'dict-status', 'dict-list', 'dict-file-status']) el(id);
  els['mask-input'].value = input;
  els['mask-amounts'].value = 'keep';
  return { getElementById: (id) => els[id] || null, els, defaultView: null };
}

test('画面の部品: 置き換えるたびに検査の結果を出し、見本の語は後の欄・対応表に出ない', () => {
  const doc = fakeDoc(TEXT);
  resetMask(doc);
  setDecoyRandom(seeded(7));
  try {
    runMask(doc);
    const r = lastDecoyCheck();
    assert.equal(r.total, 6);
    assert.equal(r.masked, 6);
    assert.equal(doc.els['mask-decoy'].textContent, decoyMessage(r));
    assert.match(doc.els['mask-decoy'].textContent, /見つけやすい型 6\/6・見つけにくい型 \d\/6/);
    const shown = doc.els['mask-after'].innerHTML + doc.els['mask-map'].innerHTML + doc.els['mask-before'].textContent;
    for (const d of makeDecoys(seeded(7))) for (const w of words(d)) assert.ok(!shown.includes(w), '見本の語が出た: ' + w);
    // 型は毎回変わる(次の置き換えでは別の乱数の続き)
    runMask(doc);
    assert.equal(lastDecoyCheck().total, 6);
    resetMask(doc);
    assert.equal(doc.els['mask-decoy'].textContent, '');
  } finally {
    setDecoyRandom(null);
  }
});

test('画面(index.html): 置き換えの状態の下に検査の結果の欄があり、置き換えると結果が出る', async () => {
  const html = indexHtml();
  const body = withoutScripts(html);
  const iStatus = body.indexOf('id="mask-status"');
  const iDecoy = body.indexOf('id="mask-decoy"');
  const iAfter = body.indexOf('id="mask-after"');
  assert.ok(iStatus > 0 && iStatus < iDecoy && iDecoy < iAfter, '並びが違う');
  const page = runPage();
  await page.set('mask-input', TEXT);
  await page.click('mask-run');
  assert.match(page.text('mask-decoy'), /^確かめのための見本: 見つけやすい型 6\/6・見つけにくい型 \d\/6\(置き換えた数\/混ぜた数。見本は架空の人名・会社名・住所で/);
  for (const w of ['担当者:', '氏名：', '㈱', '〒']) assert.ok(!page.text('mask-after').includes(w), '後の欄に見本の行: ' + w);
});

test('プラグインの道具: read_masked の2つ目の文に検査の結果。1つ目の中身は今までと同じで見本を含まない', async () => {
  const root = path.join(ROOT, 'tmp', 'f28a-unit');
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(path.join(root, 'raw'), { recursive: true });
  fs.writeFileSync(path.join(root, 'raw', 'a.txt'), TEXT);
  try {
    const r = await handleMessage({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'read_masked', arguments: { path: 'raw/a.txt' } } }, { root, mapPath: null });
    assert.equal(r.result.isError, false);
    assert.equal(r.result.content.length, 2);
    const masked = r.result.content[0].text;
    assert.equal(masked, readMasked(root, 'raw/a.txt', { mapPath: null }));
    assert.equal(masked, createMasker({ dictionaries: [CONSTRUCTION_DICT] }).mask(TEXT).masked);
    assert.match(r.result.content[1].text, /^確かめのための見本: 見つけやすい型 6\/6・見つけにくい型 \d\/6\(置き換えた数\/混ぜた数。見本は架空の人名・会社名・住所で/);
    for (const w of ['担当者:', '氏名：', '㈱', '〒', '御中']) assert.ok(!masked.includes(w), '中身に見本の行: ' + w);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('プラグインの写し: decoy.mjs が plugin/src/mask/ に同じ中身で入っている', () => {
  const a = fs.readFileSync(path.join(ROOT, 'src', 'mask', 'decoy.mjs'), 'utf8');
  const b = fs.readFileSync(path.join(ROOT, 'plugin', 'src', 'mask', 'decoy.mjs'), 'utf8');
  assert.equal(a, b);
});

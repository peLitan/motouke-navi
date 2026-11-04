// 見つけにくい型の見本を混ぜて分けて出す(F31d、src/mask/decoy.mjs)の試験。人名・会社名・住所はすべて架空
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMasker } from '../../src/mask/core.mjs';
import { CONSTRUCTION_DICT } from '../../src/mask/dict-construction.mjs';
import { MEDICAL_DICT } from '../../src/mask/dict-medical.mjs';
import { makeDecoys, makeHardDecoys, checkDecoys, decoyMessage, DECOY_TYPES, DECOY_HARD_TYPES, DECOY_PER_KIND, DECOY_LABELS } from '../../src/mask/decoy.mjs';
import { runPage } from '../acceptance/_helpers.mjs';

const TEXT = '工事名: みほん市道 架空3号線 道路改良工事\n現場代理人 乙山 二郎、甲山建設株式会社。\n連絡先 03-0000-0000';
function seeded(seed) {
  let x = seed >>> 0;
  return () => { x = (x * 1664525 + 1013904223) >>> 0; return x / 2 ** 32; };
}
const dicts = [CONSTRUCTION_DICT, MEDICAL_DICT];
// 型の表の1つを見本にする
function decoyOf(kind, type, seed = 1) {
  const rand = seeded(seed);
  const idx = (len) => Math.floor(rand() * len);
  const t = DECOY_HARD_TYPES[kind].find((x) => x.id === type);
  assert.ok(t, '型が無い: ' + type);
  return { kind, label: DECOY_LABELS[kind], type, ...t.make((l) => l[idx(l.length)], (lo, hi) => lo + idx(hi - lo + 1)) };
}

test('見つけにくい型: 機能の題の3つの形(番地の無い住所・文脈の無い姓名・表の中の名前)が型の表にあり、見つけやすい型と名前が重ならない', () => {
  const ids = Object.values(DECOY_HARD_TYPES).flat().map((t) => t.id);
  assert.ok(ids.some((i) => i.includes('番地の無い住所')));
  assert.ok(ids.some((i) => i.includes('文脈の無い姓名')));
  assert.ok(ids.some((i) => i.includes('表の中の名前')));
  assert.equal(new Set(ids).size, ids.length);
  const easy = new Set(Object.values(DECOY_TYPES).flat().map((t) => t.id));
  assert.ok(ids.every((i) => !easy.has(i)));
  assert.deepEqual(Object.keys(DECOY_HARD_TYPES), Object.keys(DECOY_TYPES));
  // 表の中の型の行は、本当に表の形で語が入っている
  const table = decoyOf('person', '表の中の名前(見出しの下の行)');
  assert.match(table.line, /^\| 氏名 \|.*\n\| .+ \| 土工 \|/);
  assert.ok(table.line.split('\n')[1].includes(table.word));
});

test('見本の選び方: 種類ごとに型を重ねずに2つ、合わせて6語。組の中で同じ語を使わず、型は乱数で変わる', () => {
  const seen = new Set();
  for (let s = 0; s < 100; s++) {
    const ds = makeHardDecoys(seeded(s));
    assert.equal(ds.length, Object.keys(DECOY_HARD_TYPES).length * DECOY_PER_KIND);
    for (const kind of Object.keys(DECOY_HARD_TYPES)) {
      const mine = ds.filter((d) => d.kind === kind);
      assert.equal(new Set(mine.map((d) => d.type)).size, DECOY_PER_KIND);
    }
    const parts = ds.filter((d) => d.kind === 'person').flatMap((d) => d.word.split(' '));
    assert.equal(new Set(parts).size, parts.length, parts.join('/'));
    assert.equal(new Set(ds.map((d) => d.word)).size, ds.length);
    for (const d of ds) assert.ok(d.line.includes(d.word));
    seen.add(ds.map((d) => d.type).join('|'));
  }
  assert.ok(seen.size >= 10, String(seen.size));
});

test('結果は分けて数える: 見つけにくい型が残っても、見つけやすい型の数に入らない(建設と医療の辞書)', () => {
  for (const dict of dicts) {
    const m = createMasker({ dictionaries: [dict] });
    const r = checkDecoys(m, TEXT, { rand: seeded(11) });
    assert.equal(r.total, 6);
    assert.equal(r.masked, 6);
    assert.deepEqual(r.missed, []);
    assert.equal(r.hard.total, 6);
    assert.equal(r.hard.masked + r.hard.missed.length, 6);
  }
  // 文脈の無い姓名・番地の無い住所は今の規則では取れない(実際の置き換えの部品で確かめる)
  const m = createMasker({ dictionaries: [CONSTRUCTION_DICT] });
  const hardDecoys = [decoyOf('person', '文脈の無い姓名(姓 名だけの行)'), decoyOf('address', '番地の無い住所(市と町だけ)'), decoyOf('person', '表の中の名前(見出しの下の行)', 2)];
  const r = checkDecoys(m, TEXT, { rand: seeded(1), hardDecoys });
  assert.equal(r.masked, 6);
  assert.equal(r.hard.total, 3);
  assert.equal(r.hard.masked, 0);
  assert.deepEqual(r.hard.missed.map((d) => d.type), hardDecoys.map((d) => d.type));
  // 取れる形もあり、残る形と分かれる(結果がいつも 0 と決まっていない)
  const can = decoyOf('company', '表の中の語尾のある社名');
  const both = checkDecoys(m, TEXT, { rand: seeded(1), hardDecoys: [can, ...hardDecoys] });
  assert.equal(both.hard.masked, 1);
  assert.equal(both.hard.missed.length, 3);
});

test('辞書に足すと、見つけにくい型の結果が変わる(決め打ちでなく置き換えの部品の結果)', () => {
  const m = createMasker({ dictionaries: [CONSTRUCTION_DICT] });
  const d = decoyOf('person', '文脈の無い姓名(姓 名だけの行)');
  assert.equal(checkDecoys(m, TEXT, { rand: seeded(1), hardDecoys: [d] }).hard.masked, 0);
  m.addTerm(d.word, 'person');
  assert.equal(checkDecoys(m, TEXT, { rand: seeded(1), hardDecoys: [d] }).hard.masked, 1);
});

test('組は別々に探す: 見つけやすい型の文脈で取れた語が、同じ語の見つけにくい型を取って結果を甘くしない', () => {
  const m = createMasker({ dictionaries: [CONSTRUCTION_DICT] });
  const hard = decoyOf('person', '文脈の無い姓名(姓 名だけの行)');
  const easy = { kind: 'person', label: '人名', type: '欄名の後ろ(担当者: 姓 名)', line: `担当者: ${hard.word}`, word: hard.word };
  const r = checkDecoys(m, TEXT, { decoys: [easy], hardDecoys: [hard] });
  assert.equal(r.masked, 1);
  assert.equal(r.hard.masked, 0);
});

test('混ぜた語は、後の欄・対応表・記号の番号に出ない(見つけにくい型も)', () => {
  const a = createMasker({ dictionaries: [CONSTRUCTION_DICT] });
  const b = createMasker({ dictionaries: [CONSTRUCTION_DICT] });
  const ra = a.mask(TEXT);
  const hardDecoys = makeHardDecoys(seeded(3));
  checkDecoys(b, TEXT, { rand: seeded(3), hardDecoys });
  const rb = b.mask(TEXT);
  assert.deepEqual(rb, ra);
  const out = rb.masked + JSON.stringify(b.entries()) + b.exportMap();
  for (const d of hardDecoys) assert.ok(!out.includes(d.word), d.word);
});

test('文: 「見つけやすい型 ○/○・見つけにくい型 ○/○」と分けて出し、目安で保証でないと書く', () => {
  const m = createMasker({ dictionaries: [CONSTRUCTION_DICT] });
  const hardDecoys = [decoyOf('person', '文脈の無い姓名(姓 名だけの行)'), decoyOf('company', '表の中の語尾のある社名')];
  const r = checkDecoys(m, TEXT, { rand: seeded(1), hardDecoys });
  const msg = decoyMessage(r);
  assert.match(msg, /見つけやすい型 6\/6・見つけにくい型 1\/2/);
  assert.match(msg, /見つけにくい型の結果は漏れの目安で、保証ではありません/);
  assert.match(msg, /見つけにくい型で残った形: 人名「文脈の無い姓名\(姓 名だけの行\)」/);
  assert.ok(!msg.includes('注意'), '見つけにくい型だけの残りは、見つけやすい型の注意にしない');
  // 全部取れても、保証でないことは消さない
  const all = decoyMessage({ total: 6, masked: 6, missed: [], hard: { total: 6, masked: 6, missed: [] } });
  assert.match(all, /見つけにくい型 6\/6/);
  assert.match(all, /保証ではありません/);
  assert.ok(!all.includes('残った形'));
  // 見つけやすい型が残ったときは、語を挙げた注意を今までどおり出す
  const easyMiss = decoyMessage({ total: 6, masked: 5, missed: [{ label: '人名', type: '型の例', word: '甲野 一郎' }], hard: { total: 6, masked: 6, missed: [] } });
  assert.match(easyMiss, /見つけやすい型 5\/6/);
  assert.match(easyMiss, /注意: 1語が残りました\(人名の型「型の例」の「甲野 一郎」\)/);
});

test('画面(index.html): 置き換えると、分けた結果と目安の文が出て、見本の語は後の欄に出ない', async () => {
  const page = runPage();
  await page.set('mask-input', TEXT);
  await page.click('mask-run');
  const shown = page.text('mask-decoy');
  assert.match(shown, /見つけやすい型 6\/6・見つけにくい型 \d\/6/);
  assert.match(shown, /漏れの目安で、保証ではありません/);
  for (const w of ['立ち会った', '土工', '打ち合わせた', '商会']) assert.ok(!page.text('mask-after').includes(w), w);
});

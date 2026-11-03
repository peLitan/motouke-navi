// F11b: 採点の部品とスクリプトの単体テスト。書類も正解の表も、ここで作った小さな架空の見本(本物の表は使わない)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from '../../scripts/mask-rate.mjs';
import { parseCsv, parseGold, scoreCase, scoreAll, toMarkdown } from '../../src/mask/rate.mjs';

const proj = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const DOCS = {
  // 人名は敬称・役職・欄名の隣に置かない(F17a の文脈規則で見つかると、辞書に足さない場合の漏れの見本にならないため)
  'P/台帳.md': '元請: 甲野建設株式会社(電話 03-0000-0000)\n確認: 乙山 二郎が行う\n現場: こころみ台工区\n',
};
const GOLD_CSV = [
  'file,text,kind',
  'P/台帳.md,甲野建設株式会社,会社名',
  'P/台帳.md,03-0000-0000,電話',
  'P/台帳.md,乙山 二郎,人名',
  'P/台帳.md,こころみ台工区,現場名',
].join('\r\n');

test('CSV の引用符・引用符の中のカンマと改行・BOM を読む', () => {
  assert.deepEqual(parseCsv('﻿a,b\r\n"x,y","p""q\nr"\n'), [['a', 'b'], ['x,y', 'p"q\nr']]);
});

test('正解の表の誤りは行の番号で止まり、語はエラーの文に入らない', () => {
  assert.throws(() => parseGold('file,text\nP/a.md,秘密の語'), /見出し/);
  assert.throws(() => parseGold('file,text,kind\nP/a.md,秘密の語,社名'), (e) => /2 行目/.test(e.message) && !e.message.includes('秘密の語'));
  assert.throws(() => parseGold('file,text,kind\n../a.md,秘密の語,人名'), /相対パス/);
  assert.throws(() => parseGold('file,text,kind\nP/a.md,,人名'), /空の欄/);
});

test('辞書に足さないと人名と現場名が漏れ、足すと漏れが減る。置き換えすぎは正解に無い語だけ数える', () => {
  const gold = parseGold(GOLD_CSV);
  const plain = scoreCase(DOCS, gold);
  assert.equal(plain.gold, 4);
  assert.equal(plain.leaked, 2); // 乙山 二郎・こころみ台工区(部品の形では拾えない)
  assert.equal(plain.leakRate, 0.5);
  assert.equal(plain.byKind['人名'].leaked, 1);
  assert.equal(plain.over, 0);
  const named = scoreCase(DOCS, gold, { addNames: true });
  assert.equal(named.leaked, 0);
  assert.equal(named.leakRate, 0);
  // 正解の表から会社名を抜くと、置き換えた会社名は置き換えすぎになる
  const fewer = scoreCase(DOCS, gold.filter((g) => g.kind !== '会社名'));
  assert.equal(fewer.over, 1);
  assert.equal(fewer.overRate, 1 / fewer.replaced);
});

test('表の語が書類に無ければ数に入れず件数だけ出す。表の file が無ければ止まる', () => {
  const gold = parseGold(GOLD_CSV + '\r\nP/台帳.md,丙川 三郎,人名');
  assert.equal(scoreCase(DOCS, gold).notInDoc, 1);
  assert.equal(scoreCase(DOCS, gold).gold, 4);
  assert.throws(() => scoreCase(DOCS, parseGold('file,text,kind\nQ/無い.md,丙川,人名')), /2 行目/);
});

test('Markdown には件数と率だけが出て、語は出ない', () => {
  const md = toMarkdown(scoreAll(DOCS, parseGold(GOLD_CSV)));
  assert.match(md, /漏れの率/);
  assert.match(md, /置き換えすぎの率/);
  assert.match(md, /50\.0%/);
  for (const w of ['甲野建設', '乙山', 'こころみ台', '03-0000']) assert.ok(!md.includes(w), w);
});

test('スクリプトは表のパスを引数で受け取り、リポジトリの中の表は断る', () => {
  // init の試験は tmp/ にだけ書けるので、そこに見本を作る。repo は別の場所を指して「リポジトリの外」の表として読ませる
  const dir = fs.mkdtempSync(path.join(proj, 'tmp', 'mask-rate-'));
  const call = (argv, repo) => { let out = ''; let err = ''; const code = run(argv, { repo, out: (x) => { out += x; }, err: (x) => { err += x; } }); return { code, out, err }; };
  try {
    fs.mkdirSync(path.join(dir, 'fx', 'P'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'fx', 'P', '台帳.md'), DOCS['P/台帳.md']);
    fs.writeFileSync(path.join(dir, 'gold.csv'), GOLD_CSV);
    const fx = ['--fixtures', path.join(dir, 'fx')];
    const ok = call([path.join(dir, 'gold.csv'), ...fx], path.join(dir, 'repo'));
    assert.equal(ok.code, 0, ok.err);
    assert.match(ok.out, /\| 辞書に足さない \| 1 \| 4 \| 2 \| 50\.0%/);
    assert.ok(!ok.out.includes('乙山'));
    const inside = call([path.join(dir, 'gold.csv'), ...fx], dir);
    assert.equal(inside.code, 2);
    assert.match(inside.err, /リポジトリの中/);
    assert.equal(call([], dir).code, 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

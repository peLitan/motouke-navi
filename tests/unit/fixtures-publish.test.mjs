// 見本の書類(fixtures/)を公開するときの確かめ(F23b)。
// fixtures/ には架空の書類だけを入れ、正解の表(置き換えの評価の file,text,kind の CSV)と
// 仕込み表(点検の評価の答え。answers.json)は入れない。両方ともリポジトリの外に置く決まり。
// 試験は名前と中身の形だけを見る。正解の表・仕込み表そのものは読まない・探さない。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const fixtures = path.join(root, 'fixtures');

// 正解の表・仕込み表に見える名前
const answerName = (p) => {
  const b = p.split('/').pop();
  return /^answers?(\.[\w-]+)*\.json$/i.test(b) || /仕込み表|正解の表/.test(b) || /^gold.*\.(csv|tsv|json)$/i.test(b);
};
// 正解の表の見出し(src/mask/rate.mjs の形)で始まる中身
const goldHeader = (t) => /^\s*"?file"?\s*[,\t]\s*"?text"?\s*[,\t]\s*"?kind"?/.test(t.replace(/^﻿/, ''));

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else if (e.isFile()) out.push(p);
  }
  return out;
}

test('名前と見出しの判定が正解の表・仕込み表を見分ける(作った例)', () => {
  for (const n of ['answers.json', 'seed/answers.v2.json', '仕込み表.md', '正解の表.csv', 'gold.csv']) assert.equal(answerName(n), true, n);
  for (const n of ['src/ui/answers.mjs', '施工体制台帳.md', '施工計画書_目次.md']) assert.equal(answerName(n), false, n);
  assert.equal(goldHeader('file,text,kind\nA/x.md,xxxx,人名\n'), true);
  assert.equal(goldHeader('﻿"file","text","kind"\n'), true);
  assert.equal(goldHeader('# 施工体制台帳\n| 項目 | 内容 |\n'), false);
});

test('fixtures/ は架空の書類(.md・.txt)だけで、正解の表・仕込み表が無い', () => {
  assert.ok(fs.existsSync(fixtures), 'fixtures/ がある');
  const files = walk(fixtures).map((p) => path.relative(root, p).split(path.sep).join('/'));
  assert.ok(files.length >= 3, '見本の書類が3件以上ある');
  for (const f of files) {
    assert.match(f, /\.(md|txt)$/, f + ' は書類の形(.md・.txt)');
    assert.equal(answerName(f), false, f + ' は正解の表・仕込み表の名前ではない');
    const t = fs.readFileSync(path.join(root, f), 'utf8');
    assert.equal(goldHeader(t), false, f + ' は正解の表の見出しで始まらない');
    assert.doesNotMatch(t, /仕込み表|正解の表/, f + ' に仕込み表・正解の表の語が無い');
  }
});

test('answers.json は git の対象の外(.gitignore)', () => {
  const gi = fs.readFileSync(path.join(root, '.gitignore'), 'utf8').split(/\r?\n/).map((l) => l.trim());
  assert.ok(gi.includes('answers.json'), '.gitignore に answers.json がある');
});

test('git の対象と履歴に正解の表・仕込み表が無い(git を呼べるときだけ)', (t) => {
  let r;
  try { r = spawnSync('git', ['-c', 'core.quotepath=false', 'ls-files'], { cwd: root, encoding: 'utf8' }); } catch { r = null; }
  if (!r || r.status !== 0) { t.skip('git を呼べない(init の permission model など)'); return; }
  const tracked = r.stdout.split('\n').filter(Boolean);
  const h = spawnSync('git', ['-c', 'core.quotepath=false', 'log', '--all', '--name-only', '--format='], { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  const names = [...new Set([...tracked, ...(h.stdout || '').split('\n').filter(Boolean)])];
  assert.deepEqual(names.filter(answerName), [], '名前で正解の表・仕込み表に見えるファイルが無い');
  for (const f of tracked.filter((x) => /\.(csv|tsv|json)$/i.test(x))) {
    const p = path.join(root, f);
    if (!fs.existsSync(p)) continue;
    assert.equal(goldHeader(fs.readFileSync(p, 'utf8')), false, f + ' は正解の表の見出しで始まらない');
  }
});

test('README: 仕込み表の文のすぐ後に、正解と初めて見る書類の置き場と、入れていない物の名前がある(F72a)', () => {
  const readme = fs.readFileSync(path.join(root, 'docs', 'details.md'), 'utf8');
  const keep = '仕込み表と置き換えの正解の表はリポジトリに入れていません';
  assert.equal(readme.split(keep).length - 1, 1, '元の文が1件残っている');
  const line = readme.slice(readme.indexOf(keep) + keep.length).split('\n')[0];
  assert.ok(line.startsWith('。公告の拾いの正解(架空の公告 N1〜N5)は `docs/samples/bid-intake/測り/正解/` に、初めて見る書類は `fixtures/unseen/` に入っています'), '直後の文');
  for (const w of ['`answers.json`', '`score/`', '岡山労働局の公告を文にしたファイルとその正解']) assert.ok(line.includes(w), w);
  assert.match(line, /は入れていません$/, '入れていない物の文で終わる');
});

test('README: 書いた置き場と入れていない物が git の対象の名前と合う(名前だけを見る。git を呼べるときだけ)', (t) => {
  let r;
  try { r = spawnSync('git', ['-c', 'core.quotepath=false', 'ls-files'], { cwd: root, encoding: 'utf8' }); } catch { r = null; }
  if (!r || r.status !== 0) { t.skip('git を呼べない(init の permission model など)'); return; }
  const tracked = r.stdout.split('\n').filter(Boolean);
  const dir = 'docs/samples/bid-intake/測り/正解/';
  const gold = tracked.filter((x) => x.startsWith(dir)).map((x) => x.slice(dir.length));
  assert.deepEqual(gold.sort(), ['N1.md', 'N2.md', 'N3.md', 'N4.md', 'N5.md'], '正解は N1〜N5');
  assert.ok(tracked.some((x) => x.startsWith('fixtures/unseen/')), '初めて見る書類が git の対象にある');
  assert.deepEqual(tracked.filter((x) => /(^|\/)score\//.test(x) || x.split('/').pop() === 'answers.json' || x.includes('岡山')), [], '入れていない物が無い');
});

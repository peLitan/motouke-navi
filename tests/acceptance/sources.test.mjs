// F02a: 法令の原文の取得(条件 F02-1)
import test from 'node:test';
import assert from 'node:assert/strict';
import { readJson, exists, loadSources, findLawSource, kanjiArticle, norm, LAW, LAW_ID, todayJst } from './_helpers.mjs';

const REQUIRED = [
  [LAW.kensetsu, '3'], [LAW.kensetsu, '24の8'], [LAW.kensetsu, '26'],
  [LAW.rei, '2'], [LAW.rei, '7の4'], [LAW.rei, '27'],
  [LAW.nyukei, '15'],
];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

test('data/sources/index.json があり、sources が配列', () => {
  assert.ok(exists('data/sources/index.json'));
  const idx = readJson('data/sources/index.json');
  assert.ok(Array.isArray(idx.sources) && idx.sources.length > 0);
  const ids = idx.sources.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length, 'id が重複している');
});

for (const [law, article] of REQUIRED) {
  test(`${law} ${article} の原文が、URL・取得日つきで保存されている`, () => {
    const src = loadSources();
    const s = findLawSource(src, law, article);
    assert.ok(s, `${law} ${article} の行が無い`);
    assert.ok(s.url.startsWith('https://laws.e-gov.go.jp/'), 'e-Gov の URL でない: ' + s.url);
    assert.ok(s.url.includes(LAW_ID[law]), 'URL に法令番号の ID ' + LAW_ID[law] + ' が無い');
    assert.match(s.fetchedAt, DATE_RE);
    assert.ok(s.fetchedAt >= '2026-11-02' && s.fetchedAt <= todayJst(), '取得日が期間の外: ' + s.fetchedAt);
    assert.ok(s.file && exists('data/sources/' + s.file), '原文のファイルが無い');
    const text = src.texts[s.id];
    assert.ok(norm(text).length >= 30, '原文が短すぎる');
    assert.ok(norm(text).includes(kanjiArticle(article)), '原文に条の見出し ' + kanjiArticle(article) + ' が無い');
  });
}

test('消費税の扱いの根拠(国交省 建設業許可事務ガイドライン)の URL と取得日がある', () => {
  const src = loadSources();
  const d = src.list.find((s) => s.kind === 'document' && /建設業許可事務ガイドライン/.test(s.title || ''));
  assert.ok(d, 'ガイドラインの行が無い');
  assert.ok(new URL(d.url).hostname.endsWith('mlit.go.jp'), '国交省の URL でない');
  assert.match(d.fetchedAt, DATE_RE);
  assert.ok(d.fetchedAt >= '2026-11-02' && d.fetchedAt <= todayJst());
});

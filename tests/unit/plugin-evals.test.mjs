// F21a の単体の試験: plugin/evals/(評価のケース・採点基準・採点のスクリプト)。答えの文はすべて架空
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RUBRIC, loadCase, scoreCase, splitFindings } from '../../plugin/evals/score.mjs';
import { checkArticles } from '../../plugin/skills/construction-check/scripts/check-articles.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const EVALS = path.join(ROOT, 'plugin', 'evals');
const CASES = path.join(EVALS, 'cases');
const caseDirs = fs.readdirSync(CASES).filter((d) => fs.statSync(path.join(CASES, d)).isDirectory()).map((d) => path.join(CASES, d));

test('evals/: ケースが2件以上あり、どのケースにも case.json と raw/ の書類がある', () => {
  assert.ok(caseDirs.length >= 2, 'ケースが ' + caseDirs.length + ' 件');
  for (const d of caseDirs) {
    const c = loadCase(d);
    assert.equal(c.format, 'motouke-eval-case');
    assert.equal(c.version, 1);
    assert.ok(c.documents.length >= 1, c.id);
    for (const doc of c.documents) {
      assert.match(doc, /^raw\/[^/]+\.md$/, doc);
      assert.ok(fs.existsSync(path.join(d, doc)), doc);
    }
    // raw/ に case.json の挙げていないファイルを置かない
    assert.deepEqual(fs.readdirSync(path.join(d, 'raw')).sort(), c.documents.map((x) => x.slice(4)).sort());
    assert.ok(c.prompt.length > 0);
  }
  const ids = caseDirs.map((d) => loadCase(d).id);
  assert.equal(new Set(ids).size, ids.length, 'ケースの id が重なる');
});

test('evals/: 各ケースに採点基準が1つ以上あり、どれも rubric.json の定めにある。見落とし率と引用の正しさを含む', () => {
  assert.equal(RUBRIC.format, 'motouke-eval-rubric');
  for (const k of Object.values(RUBRIC.kinds)) assert.ok(k.title && k.how, '定めに title と how が要る');
  for (const d of caseDirs) {
    const c = loadCase(d);
    assert.ok(c.criteria.length >= 1, c.id + ' に採点基準が無い');
    for (const k of c.criteria) assert.ok(RUBRIC.kinds[k.kind], c.id + ' の ' + k.kind + ' が rubric.json に無い');
    const kinds = c.criteria.map((k) => k.kind);
    assert.ok(kinds.includes('miss-rate'), c.id + ' に見落とし率が無い');
    assert.ok(kinds.includes('article-accuracy') || kinds.includes('quote-accuracy'), c.id + ' に引用の正しさが無い');
  }
});

test('evals/: 仕込みは各ケース2件以上で、id が重ならず、当たりの語の組があり、根拠の条はすべて取得した原文にある', () => {
  const seen = new Set();
  for (const d of caseDirs) {
    const c = loadCase(d);
    assert.ok(c.planted.length >= 2, c.id);
    for (const p of c.planted) {
      assert.ok(!seen.has(p.id), p.id + ' が重なる');
      seen.add(p.id);
      assert.ok(p.what && p.basis.length >= 1, p.id);
      assert.ok(p.match.length >= 1 && p.match.every((g) => Array.isArray(g) && g.length >= 1 && g.every((w) => typeof w === 'string' && w)), p.id);
      const { results, ok } = checkArticles(p.basis.join('\n'));
      assert.equal(results.length, p.basis.length, p.id);
      assert.ok(ok, p.id + ': ' + results.filter((r) => r.status !== 'ある').map((r) => r.label).join(', '));
    }
  }
});

test('evals/: 書類は架空の書類と書き、メールは example.com だけ。見本(fixtures/)の書類の写しではない', () => {
  const fixtureFiles = [];
  const walk = (p) => { if (!fs.existsSync(p)) return; if (fs.statSync(p).isDirectory()) fs.readdirSync(p).forEach((e) => walk(path.join(p, e))); else fixtureFiles.push(fs.readFileSync(p)); };
  walk(path.join(ROOT, 'fixtures'));
  for (const d of caseDirs) {
    for (const doc of loadCase(d).documents) {
      const b = fs.readFileSync(path.join(d, doc));
      const s = b.toString('utf8');
      assert.match(s.split('\n')[0], /架空/, doc + ' の題に「架空」が無い');
      for (const m of s.matchAll(/[\w.+-]+@([\w-]+(?:\.[\w-]+)+)/g)) assert.equal(m[1], 'example.com', m[0]);
      assert.ok(!fixtureFiles.some((f) => f.equals(b)), doc + ' が fixtures/ の写し');
    }
  }
});

const E1 = () => loadCase(caseDirs.find((d) => loadCase(d).id === 'E1'));

test('採点: 仕込みをすべて挙げ、条番号と抜き書きが原文どおりの答えは、見落とし 0%・正しさ 100%', () => {
  const answer = [
    '- 何が: 下請負人〔会社名2〕の健康保険等の加入状況の欄',
    '- どう見えたか: 欄が空',
    '- 根拠: 建設業法施行規則第14条の2第1項第3号ハ「健康保険等の加入状況」',
    '- 何が: 監理技術者〔人名1〕の専任・非専任の欄',
    '- どう見えたか: 非専任',
    '- 根拠: 建設業法第26条第3項、建設業法施行令第27条第1項第1号「国又は地方公共団体が注文者である施設又は工作物に関する建設工事」',
    '- 何が: 下請負人〔会社名3〕の工期の欄',
    '- どう見えたか: 欄が空',
    '- 根拠: 建設業法施行規則第14条の2第1項第4号イ「建設工事の名称、内容及び工期」',
    '- 何が: 施工計画書の台帳の扱い',
    '- どう見えたか: 台帳の写しを発注者に提出しない',
    '- 根拠: 公共工事の入札及び契約の適正化の促進に関する法律第15条第2項「写しを発注者に提出しなければならない」',
    '- 何が: 施工体系図の掲げる場所',
    '- どう見えたか: 現場事務所の中だけ',
    '- 根拠: 公共工事の入札及び契約の適正化の促進に関する法律第15条第1項「工事関係者が見やすい場所及び公衆が見やすい場所」',
  ].join('\n');
  const r = scoreCase(E1(), answer);
  assert.equal(r.findings, 5);
  assert.deepEqual(r.criteria['miss-rate'], { planted: 5, missed: 0, rate: 0 });
  assert.equal(r.criteria['article-accuracy'].rate, 100);
  assert.equal(r.criteria['article-accuracy'].refs, 6);
  assert.deepEqual(r.criteria['quote-accuracy'], { quotes: 5, ok: 5, rate: 100 });
});

test('採点: 何も挙げない答えは全部見落とし。条番号の無い答えの正しさは数えない(null)', () => {
  const r = scoreCase(E1(), '点検しましたが、気になる所はありませんでした。');
  assert.equal(r.criteria['miss-rate'].missed, 5);
  assert.equal(r.criteria['miss-rate'].rate, 100);
  assert.equal(r.criteria['article-accuracy'].rate, null);
  assert.equal(r.criteria['quote-accuracy'].rate, null);
});

test('採点: 取得していない条・法令名の無い条・言い換えた抜き書きは、正しい方に数えない', () => {
  const answer = [
    '- 何が: 下請負人〔会社名2〕の健康保険の欄',
    '- どう見えたか: 欄が空',
    '- 根拠: 建設業法第19条「契約の書面に書くこと」、法第24条の8',
    '- 何が: 施工体系図',
    '- どう見えたか: 公衆の見やすい所に掲げていない',
    '- 根拠: 公共工事の入札及び契約の適正化の促進に関する法律第15条第1項「公衆からよく見える所」',
  ].join('\n');
  const r = scoreCase(E1(), answer);
  assert.equal(r.criteria['miss-rate'].missed, 3);
  assert.deepEqual(r.planted.filter((p) => p.found).map((p) => p.id), ['E1-P1', 'E1-P5']);
  assert.deepEqual(r.criteria['article-accuracy'], { refs: 3, ok: 1, rate: 33.3 });
  assert.deepEqual(r.criteria['quote-accuracy'], { quotes: 2, ok: 0, rate: 0 });
});

test('採点: 1件の中に語の組がそろわなければ当たりにしない(別の指摘にまたがる語は数えない)', () => {
  const answer = '- 何が: 下請負人〔会社名3〕の工期\n- どう見えたか: 書いてある\n- 何が: 現場代理人の欄\n- どう見えたか: 空';
  const r = scoreCase(E1(), answer);
  assert.equal(r.planted.find((p) => p.id === 'E1-P3').found, false);
});

test('採点: JSON の答え(findings の配列)も1件ずつに分ける', () => {
  const json = JSON.stringify({ findings: [
    { what: '再下請負の通知', seen: '再下請負通知書を受け取っていない', basis: '建設業法第24条の8第2項' },
    { what: '元請の許可', seen: '一般の許可で下請代金の合計が大きい。特定建設業の許可が要るおそれ', basis: '建設業法第3条第1項第2号' },
  ] });
  assert.equal(splitFindings(json).length, 2);
  const c = loadCase(caseDirs.find((d) => loadCase(d).id === 'E2'));
  const r = scoreCase(c, json);
  assert.deepEqual(r.planted.filter((p) => p.found).map((p) => p.id), ['E2-P1', 'E2-P4']);
  assert.equal(r.criteria['article-accuracy'].rate, 100);
});

// F80b の単体の試験: 公式の評価の E4(plugin/evals/E4-no-planted/)と同じ架空の台帳を、画面の台帳の点検と同じ順で通す。
// 順は src/ui/app.mjs の runLedgerCheck と同じ: 台帳の文を parseLedgerText で読み、上の欄の発注者と工事の種類を入れ、
// checkTaicho のあと、記載事項の「空」の行(addChecklistCandidates)と書類どうしの突き合わせ(addCrossCandidates。欄は空)を足す。
// 返る文のどれにも E4 の検査 no-assertion の形が無いことと、候補の数を固定する。Claude は呼ばない(使用量なし。毎回同じ結果)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseLedgerText } from '../../src/ledger-text.mjs';
import { checkTaicho } from '../../src/check-taicho.mjs';
import { checkChecklistText } from '../../src/checklist.mjs';
import { addChecklistCandidates } from '../../src/ledger-check.mjs';
import { addCrossCandidates } from '../../src/cross-docs.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIR = path.join(ROOT, 'plugin/evals/E4-no-planted');
const TEXT = fs.readFileSync(path.join(DIR, 'raw/施工体制台帳.md'), 'utf8');

// pattern は case.yaml の no-assertion の行から取る(書き写さないので、case.yaml を直せば試験も同じ形を見る)
const YAML = fs.readFileSync(path.join(DIR, 'case.yaml'), 'utf8');
const NO_ASSERTION = (() => {
  const body = YAML.slice(YAML.indexOf('    name: no-assertion\n'));
  const m = body.match(/^    pattern: '(.*)'$/m);
  assert.ok(m, 'no-assertion の pattern が見つからない');
  return new RegExp(m[1].replace(/''/g, "'"));
})();

// 返り値の中の文をすべて拾う(候補・判断できない点の文、確かめること、根拠の抜き書き、notes を含む)
function strings(v, out = []) {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => strings(x, out));
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => strings(x, out));
  return out;
}

// 画面の runLedgerCheck と同じ順で通す。orderer・workType は上の欄の値(画面で選ばないときは undefined)
function screenCheck(orderer, workType) {
  const ledger = parseLedgerText(TEXT);
  ledger.project.ordererType = orderer;
  ledger.project.workType = workType;
  const first = checkTaicho(ledger);
  let out = addChecklistCandidates(first, ledger, checkChecklistText(TEXT));
  out = addCrossCandidates(out, ledger, { taikeizu: '', plan: '' });
  return { ledger, first, out };
}

test('前提: pattern は case.yaml から取れ、言い切りの文には当たる(当たらないことの確かめが空回りしない)', () => {
  assert.equal(NO_ASSERTION.source, '(違反です|違反しています|法令違反です|法令違反である|必ず提出してください)([。\\n]|$)');
  assert.ok(NO_ASSERTION.test('この台帳は建設業法第24条の8に違反しています。'));
  assert.ok(NO_ASSERTION.test('写しを発注者に必ず提出してください'));
});

test('台帳を読むと、元請け1社と一次下請け1社の値が欄から入る', () => {
  const { ledger } = screenCheck(undefined, undefined);
  assert.equal(ledger.project.contractAmount, 165000000);
  assert.equal(ledger.project.periodFrom, '2026-09-01');
  assert.equal(ledger.project.periodTo, '2027-02-26');
  assert.equal(ledger.prime.licenseType, 'tokutei');
  assert.equal(ledger.prime.engineer.role, 'kanri');
  assert.equal(ledger.prime.engineer.dedicated, true);
  assert.equal(ledger.subcontractors.length, 1);
  const [s] = ledger.subcontractors;
  assert.equal(s.tier, 1);
  assert.equal(s.amount, 57200000);
  assert.equal(s.engineer.role, 'shunin');
  assert.equal(s.engineer.dedicated, true);
});

test('上の欄を台帳のとおり(公共・建築一式でない)にすると、候補 0 件・判断できない点 0 件で、返る文に言い切りの形が無い', () => {
  const { first, out } = screenCheck('public', 'other');
  assert.equal(first.candidates.length, 0);
  assert.equal(first.undecidable.length, 0);
  assert.equal(out.candidates.length, 0);
  assert.equal(out.undecidable.length, 0);
  const texts = strings(out);
  assert.ok(texts.length >= 7, '文が拾えていない');
  assert.ok(out.notes.some((n) => n.startsWith('指摘の候補です。')));
  for (const s of texts) assert.equal(NO_ASSERTION.test(s), false, s);
});

test('上の欄を選ばないときも、候補 0 件・判断できない点 0 件で、返る文に言い切りの形が無い', () => {
  const { out } = screenCheck(undefined, undefined);
  assert.equal(out.candidates.length, 0);
  assert.equal(out.undecidable.length, 0);
  for (const s of strings(out)) assert.equal(NO_ASSERTION.test(s), false, s);
});

test('上の欄で台帳と食い違う「民間」を選ぶと、判断できない点が1件出て、その文も言い切らない', () => {
  const { out } = screenCheck('private', 'other');
  assert.equal(out.candidates.length, 0);
  assert.equal(out.undecidable.length, 1);
  assert.equal(out.undecidable[0].field, 'project.ordererType');
  assert.match(out.undecidable[0].message, /判断できません/);
  for (const s of strings(out)) assert.equal(NO_ASSERTION.test(s), false, s);
});

test('記載事項の表: 空の行が無く(候補に足す行が無い)、判断できない行は監督員と現場代理人の4行で、表の文にも言い切りの形が無い', () => {
  const cl = checkChecklistText(TEXT);
  assert.deepEqual(cl.counts, { value: 29, empty: 0, unknown: 4 });
  const unknown = cl.rows.filter((r) => r.status === 'unknown').map((r) => r.itemId);
  assert.deepEqual(unknown, ['2-ha', '2-ni', '4-ha', '4-ni']);
  for (const s of strings(cl)) assert.equal(NO_ASSERTION.test(s), false, s);
});

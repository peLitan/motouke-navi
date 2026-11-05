// F44f: 作業主任者の候補に安衛令 第6条の5つの号を足した。作業で選び、工種で隠さない
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildHtml } from '../../build.mjs';
import { runPage } from '../acceptance/_helpers.mjs';
import { safetyCandidates, safetyQuestions, safetyInput } from '../../src/safety.mjs';
import { renderSafetyResult, SAFETY_IDS } from '../../src/ui/safety-view.mjs';
import { basisLabel } from '../../src/ui/view.mjs';
import { checkQuote, branchOf } from '../../src/quote-check.mjs';
import { WORK_KINDS } from '../../src/work-kinds.mjs';
import { safetyRows, toCsv } from '../../src/export.mjs';
import quotes from '../../data/quotes.json' with { type: 'json' };
import safety from '../../data/safety.json' with { type: 'json' };

const ADDED = [
  ['steel-frame', 'q-anrei-6-15_2', '労働安全衛生法施行令 第6条第1項第15号の2', 'steelFrameHeightM'],
  ['wood-frame', 'q-anrei-6-15_4', '労働安全衛生法施行令 第6条第1項第15号の4', 'woodEaveHeightM'],
  ['concrete-demolition', 'q-anrei-6-15_5', '労働安全衛生法施行令 第6条第1項第15号の5', 'concreteDemolitionHeightM'],
  ['oxygen', 'q-anrei-6-21', '労働安全衛生法施行令 第6条第1項第21号', null],
  ['asbestos', 'q-anrei-6-23', '労働安全衛生法施行令 第6条第1項第23号', null],
];
const base = { direct: true, subcontract: 'no', plan: 'none' };
const source = fs.readFileSync(new URL('../../data/sources/law-anrei-6.txt', import.meta.url), 'utf8');
const texts = { 'anrei-6': source };
const quoteOf = (id) => quotes.quotes.find((q) => q.id === id);
const chiefOf = (work, extra = {}) => safetyCandidates({ ...base, works: [work], ...extra }).candidates.find((c) => c.id === 'safety-chief-' + work);

test('足した5号の抜き書きは、その号の中に一字一句ある', () => {
  for (const [, id] of ADDED) assert.deepEqual(checkQuote(quoteOf(id), texts), { ok: true }, id);
});

test('照合は枝番の号まで見る: 隣の枝番の文を当てると落ちる', () => {
  const q = quoteOf('q-anrei-6-15_2');
  assert.equal(checkQuote({ ...q, branch: 4 }, texts).ok, false);
  assert.equal(checkQuote({ ...q, branch: 9 }, texts).ok, false);
  // 十五の二 を十五の三の文で切れていないこと(枝番は次の枝番の行の前で終わる)
  const part = branchOf(source.split('\n').filter((l) => /^十五(の|　)/.test(l)).join('\n'), 15, 2);
  assert.match(part, /^十五の二　/);
  assert.doesNotMatch(part, /十五の三/);
});

test('選んだ作業ごとに、要るとして根拠の号つきで出る。「の2」を落とさない', () => {
  for (const [work, id, label] of ADDED) {
    const c = chiefOf(work);
    assert.equal(c.status, 'required', work);
    assert.equal(c.basis.at(-1).quoteId, id);
    assert.equal(basisLabel(c.basis.at(-1)), label);
    assert.match(c.note, /事業者/);
  }
});

test('境目は抜き書きから読む: 5メートルの前後。境目の下は候補に出さず「要らない」とも言わない', () => {
  for (const [work, , , field] of ADDED.filter((x) => x[3])) {
    assert.equal(chiefOf(work, { [field]: 4.9 }), undefined, work);
    assert.equal(chiefOf(work, { [field]: 5 }).status, 'required', work);
  }
  for (const [work] of ADDED) {
    const { label, measure, note } = safety.chief.works.find((w) => w.id === work);
    assert.doesNotMatch(JSON.stringify({ label, measure, note }), /[0-9０-９五]/, '規則表に数を手で書かない');
  }
});

test('どの作業でも「要らない」の札と言い切りの語を出さない', () => {
  for (const [work, , , field] of ADDED) {
    for (const extra of [{}, field ? { [field]: 1 } : {}]) {
      const out = renderSafetyResult(safetyCandidates({ ...base, works: [work], ...extra }), [['問い', '答え']]);
      assert.doesNotMatch(out, /badge-not_required|要らない|不要|安全にできる/, work);
    }
  }
  assert.doesNotMatch(JSON.stringify(ADDED.map(([w]) => safety.chief.works.find((x) => x.id === w))), /要らない|不要/);
});

test('酸素欠乏は別表第六を見ていないと添え、石綿は原文の除外を添える', () => {
  assert.match(chiefOf('oxygen').note, /別表第六.*取り込んでいません/);
  assert.match(chiefOf('wood-frame').note, /軒の高さ.*取り込んでいません/);
  assert.equal(chiefOf('asbestos').caveat, '試験研究のため取り扱う作業を除く');
  const out = renderSafetyResult(safetyCandidates({ ...base, works: ['oxygen', 'asbestos'] }), []);
  assert.match(out, /別表第六/);
  assert.match(out, /原文の除外: 試験研究のため/);
});

test('下請けの道でも足した作業の候補は出る(事業者に掛かるため)', () => {
  const r = safetyCandidates({ direct: false, works: ['asbestos', 'steel-frame'] });
  assert.ok(r.candidates.some((c) => c.id === 'safety-chief-asbestos'));
  assert.ok(r.candidates.some((c) => c.id === 'safety-chief-steel-frame'));
});

test('問いの欄と入力の読み: 新しい作業はチェックの欄から候補に届く。CSV にも載る', () => {
  const q = safetyQuestions();
  for (const [work] of ADDED) {
    assert.ok(q.works.some((w) => w.id === work));
    assert.ok(SAFETY_IDS.works.includes('safety-work-' + work));
    const input = safetyInput({ works: [work] }, { direct: true });
    assert.deepEqual(input.works, [work]);
  }
  const r = safetyCandidates({ ...base, works: ['oxygen'] });
  assert.ok(toCsv(safetyRows(r)).includes('作業主任者の選任(酸素欠乏危険場所)'));
});

test('工種で隠さない: どの工種でも足した作業を選べて、候補が出る', async () => {
  for (const kind of WORK_KINDS) {
    const page = runPage(buildHtml());
    await page.click('sample-load');
    page.el('work-kind').value = kind.id;
    page.el('work-kind').dispatchEvent({ type: 'change' });
    for (const [work] of ADDED) {
      const el = page.el('safety-work-' + work);
      assert.ok(el, kind.id + ' ' + work);
      assert.notEqual(el.hidden, true, kind.id + ' ' + work);
      el.checked = true;
      el.dispatchEvent({ type: 'change' });
    }
    await page.click('bid-run');
    const out = page.text('safety-result');
    for (const label of ['金属製の建築物の骨組み・塔', '木造建築物の構造部材の組立て等', 'コンクリート造の工作物の解体・破壊', '酸素欠乏危険場所', '石綿等の取扱い']) {
      assert.ok(out.includes('作業主任者の選任(' + label + ')'), kind.id + ' ' + label);
    }
  }
  const html = buildHtml();
  const q = html.slice(html.indexOf('id="safety-q-works"'));
  const end = q.indexOf('</fieldset>');
  assert.doesNotMatch(q.slice(0, end > 0 ? end : 4000), /data-kind|<details/, '工種で切り替える印も、畳んで隠す要素も無い');
});

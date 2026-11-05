// 建築系の施工計画書の目次の点検(F44d)。語は 1.2.2 の3つだけで、土木の16項目を流用しない
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkPlanToc, PLAN_ITEMS, KENCHIKU_UNDECIDABLE } from '../../src/plan-check.mjs';
import { checkKindPlan } from '../../src/kind-schedule-check.mjs';
import { kindSource, kindSourceText, kindTable } from '../../src/work-kind-tables.mjs';
import { renderPlanResult } from '../../src/ui/view.mjs';
import { planRows, toCsv } from '../../src/export.mjs';
import { NOT_READ } from '../../src/work-kinds.mjs';
import { runPage } from '../acceptance/_helpers.mjs';

const read = (p) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const KINDS = [
  { id: 'kenchiku', source: 'data/sources/mlit-kenchiku-spec-r7-ch1.txt', doc: '建築工事編' },
  { id: 'denki', source: 'data/sources/mlit-denki-spec-r7-ch1.txt', doc: '電気設備工事編' },
  { id: 'kan', source: 'data/sources/mlit-kikai-spec-r7-ch1.txt', doc: '機械設備工事編' },
];
const WORDS = ['総合施工計画書', '工種別施工計画書', '品質計画'];
const NO_LIST = '建築の仕様書に記載事項の列挙は無い';
// 3語の説明にも出る語は外して、土木の項目名だけが漏れていないかを見る
const CIVIL_ONLY = PLAN_ITEMS.map((x) => x.label).filter((l) => !['その他', '施工方法', '品質管理'].includes(l));

for (const k of KINDS) {
  const data = kindTable(k.id, 'plan');
  const text = read(k.source);

  test(k.id + ': 語は3つで、抜き書きが箇所の号の中にある', () => {
    assert.deepEqual(data.items.map((x) => x.label), WORDS);
    assert.deepEqual(data.items.map((x) => x.no), [1, 3, 4]);
    assert.deepEqual(checkKindPlan(data, text), []);
    assert.ok(data.doc.includes(k.doc));
  });

  test(k.id + ': 点検は壊した表を通さない', () => {
    const errs = (fn) => { const d = structuredClone(data); fn(d); return checkKindPlan(d, text).join('\n'); };
    assert.match(errs((d) => { d.items[0].quote += 'を変えた'; }), /抜き書きが箇所の中に無い/);
    assert.match(errs((d) => { d.items[0].quote = d.items[0].quote.replace('（', '('); }), /抜き書きが箇所の中に無い/, '全角と半角は許さない');
    assert.match(errs((d) => { d.items[0].section = '1.2.2(3)'; d.items[0].no = 3; }), /抜き書きが箇所の中に無い/);
    assert.match(errs((d) => { d.items[1].provisoQuote = '架空の文。'; }), /抜き書きが箇所の中に無い/);
    assert.match(errs((d) => { d.items[0].page += 1; }), /ページが違う/);
    assert.match(errs((d) => { d.items[0].label = '工事概要'; }), /語が抜き書きに無い/);
    assert.match(errs((d) => { d.items.pop(); }), /語の数が3でない/);
    assert.match(errs((d) => { d.sectionTitle = '施工図等'; }), /題名が原文の見出しと違う/);
  });

  test(k.id + ': 3語がそろうと候補は0件。土木の目次のままだと3語だけが候補に出る', () => {
    const ok = checkPlanToc('1. 総合施工計画書\n2. 工種別施工計画書\n3. 品質計画\n4. 工事概要', { workKind: k.id, workType: 'other' });
    assert.deepEqual(ok.candidates, []);
    assert.deepEqual(ok.found.map((f) => f.item), WORDS);
    assert.deepEqual(ok.extra, ['4. 工事概要'], '土木の項目名は記載項目として数えない');
    const ng = checkPlanToc(PLAN_ITEMS.map((x) => x.label).join('\n'), { workKind: k.id, workType: 'other' });
    assert.deepEqual(ng.candidates.map((c) => c.item), WORDS);
    assert.deepEqual(ng.found, []);
    assert.equal(ng.extra.length, PLAN_ITEMS.length);
  });

  test(k.id + ': 列挙が無いと書き、土木の項目と条を出さない', () => {
    const out = checkPlanToc('1. 工事概要', { workKind: k.id, workType: 'other' });
    assert.ok(out.notes.some((n) => n.includes(NO_LIST)));
    const html = renderPlanResult(out);
    assert.ok(html.includes(NO_LIST) && html.includes(data.doc));
    assert.ok(!html.includes('1-1-1-6') && !html.includes('土木工事共通仕様書') && !html.includes('記載項目'), html);
    for (const c of out.candidates) for (const w of CIVIL_ONLY) assert.ok(!c.message.includes(w), w);
    assert.ok(kindSourceText(k.id, 'plan').includes(NO_LIST));
    assert.ok(!kindSourceText(k.id, 'plan').includes(NOT_READ));
    assert.ok(kindSource(k.id, 'plan').title.includes(k.doc));
  });

  test(k.id + ': 候補は断定せず、根拠に箇所・頁・抜き書き・取得日・版を持つ', () => {
    const out = checkPlanToc('1. 工事概要', { workKind: k.id, workType: 'other' });
    for (const c of out.candidates) {
      assert.ok(c.message.includes('確かめて'), c.message);
      for (const key of ['doc', 'section', 'quote', 'url', 'fetchedAt', 'version']) assert.ok(c.basis[key], key);
      assert.ok(c.basis.page > 0);
    }
    assert.ok(out.candidates[1].message.includes('ただし、あらかじめ監督職員の承諾を受けた場合は、この限りでない。'));
    const csv = toCsv(planRows(out, k.id));
    assert.ok(csv.includes(NO_LIST) && csv.includes('1.2.2(3)'));
  });

  test(k.id + ': 語がかっこの中や題の行にあっても見つける。書き方が違えば分かるように出す', () => {
    const out = checkPlanToc('総合施工計画 目次\n第1章 施工計画書(工種別施工計画書)\n3.1 品質計画', { workKind: k.id, workType: 'other' });
    assert.deepEqual(out.candidates, []);
    assert.equal(out.found.find((f) => f.item === '総合施工計画書').byAlias, true);
    assert.ok(renderPlanResult(out).includes('書き方が違う'));
  });

  test(k.id + ': 品質管理は品質計画と別の語なので、見つけたことにしない', () => {
    const out = checkPlanToc('1. 品質管理計画\n2. 品質管理', { workKind: k.id, workType: 'other' });
    assert.ok(out.candidates.some((c) => c.item === '品質計画'));
  });

  test(k.id + ': 1.2.2(3)の挙げる中身を見ていないと書き、見た範囲を添える', () => {
    const out = checkPlanToc('1. 工事概要', { workKind: k.id, workType: 'other' });
    assert.ok(out.notes.some((n) => n.includes('1.2.2(3)') && n.includes('中身は見ていません')));
    assert.ok(out.notes.some((n) => n.includes(NO_LIST + '(見たのは')));
    assert.ok(kindSourceText(k.id, 'plan').includes(NO_LIST + '(見たのは'));
  });

  test(k.id + ': 工事の種類が建築一式でも3語で比べる', () => {
    for (const workType of ['kenchiku-ikkatsu', undefined]) {
      const out = checkPlanToc('1. 品質計画', { workKind: k.id, workType });
      assert.deepEqual(out.undecidable, []);
      assert.deepEqual(out.found.map((f) => f.item), ['品質計画']);
    }
  });

  test(k.id + ': 読み込んだ表があれば、そちらを使う', () => {
    const table = { label: '', schedule: [], planItems: [{ no: 1, label: '架空の項目', section: '1', quote: 'x', aliases: [] }], source: { title: '架空', edition: '架空', url: '', fetchedAt: '2026-01-01' } };
    const out = checkPlanToc('1. 工事概要', { workKind: k.id, table });
    assert.deepEqual(out.candidates.map((c) => c.item), ['架空の項目']);
    assert.ok(!out.wordsOnly);
  });

  test(k.id + ': 画面で目次を点検すると語で出て、注記・まとめ・CSV も切り替わる', async () => {
    const page = runPage();
    await page.click('sample-load');
    await page.click('confirm-go').catch(() => {});
    page.el('work-kind').value = k.id;
    await page.click('confirm-go').catch(() => {});
    await page.click('plan-run');
    const result = page.text('plan-result');
    assert.ok(result.includes('見当たらない語の候補') && result.includes(NO_LIST), result);
    assert.ok(!result.includes('上の欄の「工事の種類」'));
    assert.ok(!result.includes('1-1-1-6'));
    assert.ok(page.el('plan-notice').textContent.includes('官庁営繕'));
    assert.equal(page.el('plan-about').hidden, true, '土木の説明は隠す');
    assert.ok(page.el('work-kind-plan').textContent.includes(NO_LIST));
    assert.ok(page.el('summary').innerHTML.includes('見当たらない語の候補'));
    await page.click('plan-csv-btn');
    assert.ok((await page.blobs.at(-1).text()).includes(k.id === 'kan' ? '機械設備工事編' : k.doc));
  });
}

test('土木は今までどおり(16項目で比べ、建築一式は判断できない)', () => {
  assert.equal(PLAN_ITEMS.length, 16);
  const civil = checkPlanToc('1. 工事概要', { workKind: 'doboku', workType: 'other' });
  assert.equal(civil.candidates.length, 15);
  assert.ok(!civil.wordsOnly);
  assert.equal(checkPlanToc('1. 工事概要', { workKind: 'doboku', workType: 'kenchiku-ikkatsu' }).undecidable[0].message, KENCHIKU_UNDECIDABLE);
});

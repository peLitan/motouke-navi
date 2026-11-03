// F28d: 根拠の抜き書きの近くに、取得した日と版(何年何月時点の条文・資料か)を出す。
// 値は data/sources/index.json の行から取る(推測で版を作らない)。画面・印刷(画面の DOM をそのまま紙に出す)・CSV で確かめる。値は架空の入力
import test from 'node:test';
import assert from 'node:assert/strict';
import sourcesData from '../../data/sources/index.json' with { type: 'json' };
import { sourceVersion, revisionDate, versionText, NO_VERSION } from '../../src/source-version.mjs';
import { bidCheck } from '../../src/bid-check.mjs';
import { judgeTaicho } from '../../src/taicho.mjs';
import { buildSchedule } from '../../src/schedule.mjs';
import { checkPlanToc } from '../../src/plan-check.mjs';
import { checkTaicho } from '../../src/check-taicho.mjs';
import { checkChecklistText, CHECKLIST_LAW } from '../../src/checklist.mjs';
import { renderBidResult, renderTaichoResult, renderSchedule, renderPlanResult, renderChecklist, renderCheckResult, esc } from '../../src/ui/view.mjs';
import { stage1Rows, scheduleRows, planRows, checklistRows, checkRows, COLUMNS, SCHEDULE_COLUMNS, PLAN_COLUMNS, CHECKLIST_COLUMNS } from '../../src/export.mjs';
import { indexHtml } from '../acceptance/_helpers.mjs';

const SOURCES = sourcesData.sources;
const byTitle = new Map(SOURCES.map((s) => [s.title, s]));
const input = { orderer: 'public', direct: true, workType: 'other', contractAmount: 90000000, hasSubcontract: true, subcontractTotal: 60000000, license: 'tokutei', engineerQualification: 'kanri', ictMeasure: false };
// 下請けの総額で判定する入力(金額の比べ方 = 国交省のガイドラインの抜き書きが付く)
const privInput = { orderer: 'private', direct: true, workType: 'kenchiku-ikkatsu', contractAmount: 900000000, hasSubcontract: true, subcontractTotal: 85000000, license: 'ippan', engineerQualification: 'shunin', ictMeasure: false };

test('法令の版は revisionId の施行日から、資料の版は edition から作り、どちらも無ければ「版の表示なし」', () => {
  assert.deepEqual(revisionDate('324AC0000000100_20251212_506AC0000000049'), { y: 2025, m: 12, d: 12 });
  assert.equal(revisionDate('形が違う'), null);
  assert.equal(revisionDate('324AC0000000100_20251399_x'), null);
  for (const s of SOURCES) {
    const v = sourceVersion(s);
    if (s.kind === 'law') {
      const r = revisionDate(s.revisionId);
      assert.ok(r, '法令の行に revisionId の施行日が無い: ' + s.id);
      assert.ok(v.startsWith(r.y + '年' + r.m + '月' + r.d + '日施行の改正までの条文'), v);
      assert.ok(v.includes(s.revisionId));
    } else if (s.edition) {
      assert.ok(s.title.includes(s.edition), '版の表示が題名に無い(題名から写す): ' + s.id);
      assert.equal(v, s.edition + ' の版');
    } else {
      assert.equal(v, NO_VERSION);
    }
  }
  assert.equal(sourceVersion({ fetchedAt: '2026-01-01' }), NO_VERSION);
  assert.equal(versionText({ fetchedAt: '2026-01-01' }), '取得日 2026-01-01・版 ' + NO_VERSION);
  // 根拠に使う資料(ガイドラインと共通仕様書)には版がある
  assert.equal(sourceVersion(SOURCES.find((s) => s.id === 'mlit-doboku-spec-r8')), '令和8年3月 の版');
  assert.equal(sourceVersion(SOURCES.find((s) => s.id === 'mlit-kyoka-guideline')), '令和7年2月1日から適用 の版');
});

// 判定の結果の根拠(basis)ぜんぶに、出典の行と同じ取得日と版が付く
function allBasis() {
  const bid = bidCheck(input);
  const t = judgeTaicho(input);
  const bid2 = bidCheck(privInput);
  assert.ok(bid2.amountBasis?.basis?.length > 0, '金額の比べ方の根拠が出ない');
  const sched = buildSchedule(input);
  const plan = checkPlanToc('1. 工事概要');
  const chk = checkTaicho({ prime: { name: '架空甲建設', licenseType: 'ippan', licenseNumber: 'xxxx', engineer: { role: 'shunin', name: '架空 一', qualification: '実務経験' } }, subcontractors: [{ name: '', licenseNumber: '', work: '舗装', amount: 50_000_000, engineer: { role: 'shunin', name: '', qualification: '' } }] });
  return {
    bid, t, sched, plan, chk, bid2,
    list: [
      ...bid.items.flatMap((i) => i.basis), ...(bid.amountBasis?.basis ?? []), ...bid2.amountBasis.basis,
      ...t.reasons.flatMap((r) => r.basis), ...(t.amountBasis?.basis ?? []),
      ...sched.map((r) => r.basis), ...plan.candidates.map((c) => c.basis),
      ...chk.candidates.flatMap((c) => c.basis ?? []), ...chk.undecidable.flatMap((c) => c.basis ?? []),
    ],
  };
}

test('根拠のすべてに取得日と版が付き、data/sources/index.json の行の値と同じ', () => {
  const { list, plan, chk } = allBasis();
  assert.ok(plan.candidates.length > 0 && chk.candidates.length + chk.undecidable.length > 0);
  assert.ok(list.length > 20);
  const kinds = new Set();
  for (const b of list) {
    const s = SOURCES.find((x) => x.id === b.sourceId) ?? byTitle.get(b.title) ?? SOURCES.find((x) => x.title.startsWith(b.doc ?? '\u0000'));
    assert.ok(s, '出典の行が見つからない: ' + JSON.stringify(b).slice(0, 80));
    assert.equal(b.fetchedAt, s.fetchedAt);
    assert.equal(b.version, sourceVersion(s));
    assert.notEqual(b.version, NO_VERSION, '根拠に使う出典に版が無い: ' + s.id);
    kinds.add(s.kind);
  }
  assert.deepEqual([...kinds].sort(), ['document', 'law']);
});

test('画面: 抜き書きの近く(同じ項目の中)に取得日と版が出る。印刷は画面の折りたたみを開いて出すので同じ文が紙に出る', () => {
  const { bid, t, sched, plan, chk, bid2 } = allBasis();
  const htmls = [
    [renderBidResult(bid2), bid2.amountBasis.basis],
    [renderBidResult(bid), bid.items.flatMap((i) => i.basis)],
    [renderTaichoResult(t), t.reasons.flatMap((r) => r.basis)],
    [renderSchedule(sched), sched.map((r) => r.basis)],
    [renderPlanResult(plan), plan.candidates.map((c) => c.basis)],
    [renderCheckResult(chk), chk.candidates.flatMap((c) => c.basis ?? [])],
  ];
  for (const [html, list] of htmls) {
    assert.ok(list.length > 0);
    for (const b of list) {
      const q = esc(b.quote);
      const at = html.indexOf(q);
      assert.ok(at > 0, '抜き書きが画面に無い');
      // 抜き書きの直前(同じ li・details の中)に「取得日 …・版 …」がある
      const before = html.slice(Math.max(0, at - 400), at);
      assert.ok(before.includes(esc(versionText(b))), '抜き書きの近くに取得日と版が無い: ' + b.quote.slice(0, 20));
    }
  }
  const out = checkChecklistText('# 施工体制台帳(架空)\n| 会社名 | 架空建設 |');
  assert.ok(out.rows.length > 0);
  const h = renderChecklist(out);
  assert.ok(h.includes(esc(versionText({ fetchedAt: CHECKLIST_LAW.fetchedAt, version: sourceVersion(CHECKLIST_LAW) }))));
  assert.ok(h.includes('2026年10月1日施行の改正までの条文'));
});

test('CSV: どの書き出しにも「版」の列があり、取得日の隣に版が入る', () => {
  const { bid, t, sched, plan, chk, bid2 } = allBasis();
  const check = (rows, cols, hasBasis) => {
    assert.deepEqual(rows[0], cols);
    const fi = cols.indexOf('取得日');
    const vi = cols.findIndex((c) => c.startsWith('版'));
    assert.equal(vi, fi + 1, '版の列が取得日の隣に無い');
    for (const r of rows.slice(1)) assert.equal(r.length, cols.length);
    const withDate = rows.slice(1).filter((r) => r[fi]);
    assert.ok(withDate.length > 0);
    for (const r of withDate) {
      assert.ok(r[vi] && !r[vi].includes(NO_VERSION), '取得日はあるのに版が無い: ' + r.join('|').slice(0, 60));
      assert.ok(hasBasis(r[vi]), r[vi]);
    }
  };
  check(stage1Rows(bid, t, '候補です'), COLUMNS, (v) => /日施行の改正までの条文|の版/.test(v));
  check(scheduleRows(sched), SCHEDULE_COLUMNS, (v) => v === '令和8年3月 の版');
  check(planRows(plan), PLAN_COLUMNS, (v) => v === '令和8年3月 の版');
  check(checkRows(chk, '候補です'), COLUMNS, (v) => /日施行の改正までの条文/.test(v));
  const cl = checkChecklistText('# 施工体制台帳(架空)\n| 会社名 | 架空建設 |');
  assert.ok(cl.rows.length > 0);
  check(checklistRows(cl, new Set(), '候補です'), CHECKLIST_COLUMNS, (v) => v === sourceVersion(CHECKLIST_LAW));
  // 法令と資料の両方の版が入る(入札前の確認には金額の比べ方のガイドラインの行がある)
  check(stage1Rows(bid2, judgeTaicho(privInput), '候補です'), COLUMNS, (v) => /日施行の改正までの条文|の版/.test(v));
  const versions = stage1Rows(bid2, judgeTaicho(privInput), '候補です').map((r) => r[COLUMNS.indexOf('取得日') + 1]).join('\n');
  assert.ok(versions.includes('令和7年2月1日から適用 の版') && versions.includes('施行の改正までの条文'));
});

test('index.html: 使った法令と資料の一覧に版が出る。07 の決まり(通信しない・外部の読み込み無し・断り書きと PDL の表示)を崩さない', () => {
  const html = indexHtml();
  for (const s of SOURCES) {
    const v = sourceVersion(s);
    if (v !== NO_VERSION) assert.ok(html.includes(esc(v)), '一覧に版が無い: ' + s.id);
  }
  assert.ok(html.includes('src/source-version.mjs'), 'bundle に版の部品が入っていない');
  assert.ok(!/<script[^>]+src=/i.test(html) && !/<link[^>]+href=["']?https?:/i.test(html), '外部の読み込みがある');
  assert.match(html, /connect-src 'none'/);
  assert.ok(!/\bfetch\(|XMLHttpRequest|WebSocket|localStorage|indexedDB/.test(html.replace(/<p[^>]*>[\s\S]*?<\/p>/g, '')), '通信・保存の呼び出しがある');
  assert.ok(html.includes('公共データ利用規約'));
});

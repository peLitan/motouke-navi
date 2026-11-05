// F44c: 電気工事・管工事の段取り。行は標準仕様書の第1編 第1章の原文で照らせ、期日は抜き書きから読み、ほかの工種の文が混ざらない
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { checkKindSchedule } from '../../src/kind-schedule-check.mjs';
import { buildScheduleDetail, deadlineText } from '../../src/schedule.mjs';
import { renderSchedule } from '../../src/ui/view.mjs';
import { scheduleRows, toCsv } from '../../src/export.mjs';
import { kindSource, kindSourceText } from '../../src/work-kind-tables.mjs';
import { NOT_READ } from '../../src/work-kinds.mjs';
import { readBidForm } from '../../src/ui/form.mjs';
import { SAMPLE } from '../../src/sample.mjs';
import { SPECS, chapterLines, chapterText } from '../../scripts/fetch-setsubi-spec.mjs';
import { runPage } from '../acceptance/_helpers.mjs';

const read = (p) => fs.readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const KINDS = [
  { id: 'denki', label: '電気工事', file: 'data/schedule-denki.json', source: 'data/sources/mlit-denki-spec-r7-ch1.txt', url: 'https://www.mlit.go.jp/gobuild/content/001888825.pdf', edition: '令和7年5月12日 最終改定 の版', word: '電気設備工事編', other: '機械設備工事編', prefix: 'dn-' },
  { id: 'kan', label: '管工事', file: 'data/schedule-kan.json', source: 'data/sources/mlit-kikai-spec-r7-ch1.txt', url: 'https://www.mlit.go.jp/gobuild/content/001967513.pdf', edition: '令和7年11月5日 修補版 の版', word: '機械設備工事編', other: '電気設備工事編', prefix: 'kk-' },
].map((k) => ({ ...k, data: JSON.parse(read(k.file)), text: read(k.source) }));
const rule = (d, id) => d.rules.find((r) => r.id === id);

for (const k of KINDS) {
  test(k.label + ': 全行が原文の箇所の号の中で照らせる', () => {
    assert.deepEqual(checkKindSchedule(k.data, k.text), []);
    assert.ok(k.data.rules.every((r) => r.id.startsWith(k.prefix)));
  });

  test(k.label + ': 点検は外れた行を見つける', () => {
    const has = (d, id, word) => checkKindSchedule(d, k.text).some((e) => e.startsWith(id + ':') && e.includes(word));
    const plan = k.prefix + 'start-plan';
    let d = structuredClone(k.data); rule(d, plan).quote += 'を変えた';
    assert.ok(has(d, plan, '抜き書きが箇所の中に無い'));
    d = structuredClone(k.data); rule(d, plan).section = '1.2.2(3)';
    assert.ok(has(d, plan, '抜き書きが箇所の中に無い'));
    d = structuredClone(k.data); rule(d, plan).section = '1.2.2(9)';
    assert.ok(has(d, plan, '号が原文に無い'));
    d = structuredClone(k.data); rule(d, plan).when = '着手の14日前まで';
    assert.ok(has(d, plan, '手で書いた期間'));
  });

  test(k.label + ': 期日は抜き書きから読み、数字を手で書かない', () => {
    const dated = k.data.rules.filter((r) => r.deadline);
    assert.deepEqual(dated.map((r) => deadlineText(r)), ['契約締結後10日以内', '配置技術者の変更又は変更契約締結後10日以内', '工事完成後10日以内']);
    const d = structuredClone(dated[0]);
    d.deadline.quote = d.deadline.quote.replace('10', '20');
    assert.equal(deadlineText(d), '契約締結後20日以内');
    assert.ok(buildScheduleDetail({ workKind: k.id }).rows.every((r) => !r.when.includes('{')));
  });

  test(k.label + ': 行はこの工種の根拠で出て、ほかの工種の文が混ざらない', () => {
    const form = { ...readBidForm(SAMPLE.form), workKind: k.id };
    const detail = buildScheduleDetail(form);
    const html = renderSchedule(detail.rows, detail);
    const csv = toCsv(scheduleRows(detail.rows, new Map(), k.id));
    assert.deepEqual([...new Set(detail.rows.map((r) => r.phase))], ['start', 'work', 'completion']);
    for (const r of detail.rows) {
      assert.equal(r.basis.url, k.url);
      assert.equal(r.basis.fetchedAt, '2026-11-06');
      assert.equal(r.basis.version, k.edition);
    }
    for (const w of ['共通仕様書', '1-1-1', '国の直轄', 'CORINS', '建築工事編', k.other]) {
      assert.ok(!html.includes(w), w);
      assert.ok(!csv.includes(w), w);
    }
    assert.ok(html.includes('国の官庁営繕の例です') && csv.includes(k.word));
    assert.ok(detail.notes.some((n) => n.includes('改修工事の仕様書') && n.includes('第2編以降')));
    assert.ok(detail.notes.some((n) => n.includes('工種の「' + k.label + '」') && n.includes(k.word)));
  });

  test(k.label + ': 特記の条件は「確かめる」にし、下請が無ければ下請の行を出さない', () => {
    const rows = buildScheduleDetail({ workKind: k.id, hasSubcontract: true }).rows;
    for (const id of ['start-corins', 'start-gaisei', 'start-engineer', 'done-docs']) {
      const r = rows.find((x) => x.id === k.prefix + id);
      assert.equal(r.status, 'needs_check', id);
      assert.ok(r.checks.some((c) => c.includes('確かめて')), id);
    }
    assert.equal(rows.find((r) => r.id === k.prefix + 'start-plan').status, 'applies');
    const no = buildScheduleDetail({ workKind: k.id, hasSubcontract: false });
    assert.deepEqual(no.skipped.map((s) => s.id).sort(), [k.prefix + 'start-taicho', k.prefix + 'work-sub-inform']);
    const sub = buildScheduleDetail({ workKind: k.id, direct: false });
    assert.deepEqual(sub.rows, []);
    assert.equal(sub.skipped.length, k.data.rules.length);
    assert.ok(buildScheduleDetail({ workKind: k.id, orderer: 'private' }).notes[0].includes('国の官庁営繕の例'));
  });

  test(k.label + ': 出典の表示。段取りだけ切り替わり、目次と積算はまだ「見ていない」', () => {
    assert.ok(kindSource(k.id, 'schedule').title.includes(k.word));
    const line = kindSourceText(k.id, 'schedule');
    assert.ok(line.includes(k.word) && line.includes('取得日 2026-11-06') && !line.includes(NOT_READ), line);
    assert.ok(kindSourceText(k.id, 'plan').includes(NOT_READ));
    assert.ok(kindSourceText(k.id, 'estimate').includes(NOT_READ));
  });

  test(k.label + ': 画面で選ぶと段取りと出典・注記が切り替わり、CSV も通る', async () => {
    const page = runPage();
    await page.click('sample-load');
    await page.click('confirm-go').catch(() => {});
    page.el('work-kind').value = k.id;
    await page.click('bid-run');
    const result = page.text('schedule-result');
    assert.ok(result.includes('実施工程表') && result.includes('総合試運転') && !result.includes(NOT_READ));
    assert.ok(page.el('work-kind-schedule').textContent.includes(k.word));
    assert.ok(page.el('schedule-notice').textContent.includes('国の官庁営繕の例'));
    assert.equal(page.el('schedule-about').hidden, true, '土木の説明の文を出さない');
    await page.click('schedule-csv-btn');
    const csv = await page.blobs.at(-1).text();
    assert.ok(csv.includes(k.label) && csv.includes(k.word));
    await page.click('plan-run');
    assert.ok(page.text('plan-result').includes(NOT_READ), '目次はまだ見ていない');
  });

  test(k.label + ': 置いた原文は第1編 第1章だけで、毎ページの見出しが混ざらない', () => {
    assert.ok(k.text.includes('1.7.3 保全に関する資料'));
    assert.ok(!/^第[2２]編/m.test(k.text) && !/^第[2２]章/m.test(k.text) && !/^2\.1\.1/m.test(k.text)); // 第3編の語は 1.4.2 の表の行にある
    assert.ok(!k.text.includes('令和７年版') && !k.text.includes('国土交通省大臣官房官庁営繕部'));
  });
}

test('機械設備工事編: 表の行は見出しにならず、4段の番号の見出しで切り分ける', () => {
  const k = KINDS[1];
  assert.ok(/^1\.1\.6 ボイラー /m.test(k.text), '表の行は原文に残っている');
  const d = structuredClone(k.data);
  const r = rule(d, 'kk-work-trial-plan');
  assert.equal(r.section, '1.5.6.1(1)');
  assert.deepEqual(checkKindSchedule(d, k.text), []);
  r.section = '1.5.6.2(1)'; // 同じ節の別の見出しの文
  r.title = '各機器の個別運転調整';
  assert.ok(checkKindSchedule(d, k.text).some((e) => e.includes('抜き書きが箇所の中に無い')));
  const t = structuredClone(k.data);
  rule(t, 'kk-start-notify').title = 'ボイラー';
  assert.ok(checkKindSchedule(t, k.text).some((e) => e.includes('題名が原文の見出しと違う')));
});

const item = (x, y, t) => ({ x, y, text: t });
const page = (no, step, ...lines) => ({ page: no, items: lines.map((l, i) => item(10, 500 + i * step, l)) });

test('取得: y の向きが逆の PDF でも上から読み、第2章の手前で切り、毎ページの見出しを除く', () => {
  const spec = SPECS.denki;
  const head = '公共建築工事標準仕様書（電気設備工事編）令和７年版';
  const pages = [
    page(1, 20, '表紙'),
    page(2, 20, head, '第1章 一般事項', '1.1.1 適用', '(1) 文の頭', '1 国土交通省大臣官房官庁営繕部'),
    page(3, 20, head, '文の続き。', '第2章 共通工事', '2.1.1 一般事項'),
    page(4, 20, head, '別の文'),
  ];
  const out = chapterText(pages, spec);
  assert.equal(out, '--- PDF の 2 ページ ---\n1.1.1 適用\n(1) 文の頭\n--- PDF の 3 ページ ---\n文の続き。\n');
  const up = pages.map((p) => ({ ...p, items: p.items.map((i) => ({ ...i, y: -i.y })) }));
  assert.notEqual(chapterText(up, spec), out, '向きを誤ると同じ文にならない');
  assert.throws(() => chapterLines([page(1, 20, '別の文書')], spec), /範囲/);
  assert.throws(() => chapterLines([page(1, 20, '1.1.1 適用')], spec), /範囲/);
});

test('取得: 機械設備工事編は第2編の見出しの手前で切る。本文のページが無くなれば頁の印も出さない', () => {
  const spec = SPECS.kan;
  const head = '公共建築工事標準仕様書（機械設備工事編）令和７年版（修補版）';
  const up = (no, ...lines) => ({ page: no, items: lines.map((l, i) => item(10, 700 - i * 20, l)) });
  const out = chapterText([up(2, head, '1.1.1 適用', '文。'), up(3, head, '第２編 共通工事', '第１章 一般事項')], spec);
  assert.equal(out, '--- PDF の 2 ページ ---\n1.1.1 適用\n文。\n');
});

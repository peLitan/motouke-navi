// F44b: 建築の段取り。行は標準仕様書の1章の原文で照らせ、期日は抜き書きから読み、土木の文が混ざらない
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
import { pageLines, chapter1, chapterText } from '../../scripts/fetch-kenchiku-spec.mjs';
import { runPage } from '../acceptance/_helpers.mjs';

const read = (p) => fs.readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const data = JSON.parse(read('data/schedule-kenchiku.json'));
const text = read('data/sources/mlit-kenchiku-spec-r7-ch1.txt');
const copy = () => structuredClone(data);
const rule = (d, id) => d.rules.find((r) => r.id === id);
const hasError = (d, id, word) => checkKindSchedule(d, text).some((e) => e.startsWith(id + ':') && e.includes(word));

test('全行が原文の箇所の号の中で照らせる', () => {
  assert.deepEqual(checkKindSchedule(data, text), []);
  assert.deepEqual(checkKindSchedule(data, ''), ['原文が無い: mlit-kenchiku-spec-r7']);
});

test('点検は外れた行を見つける(字の違い・別の号・見出しの違い・2文・手で書いた期日)', () => {
  let d = copy(); rule(d, 'kj-start-schedule').quote += 'を変えた';
  assert.ok(hasError(d, 'kj-start-schedule', '抜き書きが箇所の中に無い'));
  d = copy(); rule(d, 'kj-start-plan').section = '1.2.2(3)'; // 原文にはあるが別の号の文
  assert.ok(hasError(d, 'kj-start-plan', '抜き書きが箇所の中に無い'));
  d = copy(); rule(d, 'kj-start-plan').section = '1.2.2(9)';
  assert.ok(hasError(d, 'kj-start-plan', '号が原文に無い'));
  d = copy(); rule(d, 'kj-start-plan').title = '施工計画';
  assert.ok(hasError(d, 'kj-start-plan', '題名が原文の見出しと違う'));
  d = copy(); rule(d, 'kj-start-plan').quote = '(1) 工事の着手に先立ち。工事の着手に先立ち。';
  assert.ok(hasError(d, 'kj-start-plan', '1文を超える'));
  d = copy(); rule(d, 'kj-start-corins').when = '契約締結後10日以内';
  assert.ok(hasError(d, 'kj-start-corins', '{期日}'));
  d = copy(); rule(d, 'kj-start-plan').when = '着手の14日前まで';
  assert.ok(hasError(d, 'kj-start-plan', '手で書いた期間'));
  d = copy(); rule(d, 'kj-start-plan').when = '直ちに';
  assert.ok(hasError(d, 'kj-start-plan', '抜き書きに無い'));
});

test('ページをまたぐ文も照らせる(頁の印は原文として扱わない)', () => {
  assert.ok(rule(data, 'kj-done-notice').quote.includes('場合に、監督職員に提出'));
  assert.ok(text.includes('--- PDF の 16 ページ ---'));
  assert.equal(hasError(data, 'kj-done-notice', '無い'), false);
});

test('期日は抜き書きから読む。抜き書きの数字が変われば出る期日も変わる', () => {
  const dated = data.rules.filter((r) => r.deadline);
  assert.deepEqual(dated.map((r) => deadlineText(r)), ['契約締結後10日以内', '配置技術者の変更又は変更契約締結後10日以内', '工事完成後10日以内']);
  const d = structuredClone(dated[0]);
  d.deadline.quote = d.deadline.quote.replace('10', '20');
  assert.equal(deadlineText(d), '契約締結後20日以内');
  d.deadline.quote = '期日の無い文';
  assert.throws(() => deadlineText(d), /読めない/);
  const rows = buildScheduleDetail({ workKind: 'kenchiku' }).rows;
  assert.equal(rows.find((r) => r.id === 'kj-start-corins').when, '契約締結後10日以内');
  assert.ok(rows.every((r) => !r.when.includes('{')));
});

test('行は標準仕様書の根拠で、3つの段に分かれ、土木の文が混ざらない', () => {
  const form = { ...readBidForm(SAMPLE.form), workKind: 'kenchiku' };
  const detail = buildScheduleDetail(form);
  const html = renderSchedule(detail.rows, detail);
  const csv = toCsv(scheduleRows(detail.rows, new Map(), 'kenchiku'));
  assert.deepEqual([...new Set(detail.rows.map((r) => r.phase))], ['start', 'work', 'completion']);
  for (const r of detail.rows) {
    assert.equal(r.basis.url, 'https://www.mlit.go.jp/gobuild/content/001888816.pdf');
    assert.equal(r.basis.fetchedAt, '2026-11-05');
    assert.equal(r.basis.version, '令和7年5月12日 最終改定 の版');
  }
  for (const w of ['共通仕様書', '1-1-1', '国の直轄', 'CORINS']) {
    assert.ok(!html.includes(w), w);
    assert.ok(!csv.includes(w), w);
  }
  assert.ok(html.includes('標準仕様書') && html.includes('国の官庁営繕の例です'));
  assert.ok(detail.notes.some((n) => n.includes('改修の仕様書の本文') && n.includes('2章以降')));
  assert.ok(csv.includes('工種') && csv.includes('公共建築工事標準仕様書'));
});

test('条件: 下請が無ければ下請の行を出さず、分からなければ確かめる。特記の条件は「確かめる」', () => {
  const ids = (d) => d.rows.map((r) => r.id);
  const no = buildScheduleDetail({ workKind: 'kenchiku', hasSubcontract: false });
  assert.ok(!ids(no).includes('kj-start-taicho') && !ids(no).includes('kj-work-sub-inform'));
  assert.deepEqual(no.skipped.map((s) => s.id).sort(), ['kj-start-taicho', 'kj-work-sub-inform']);
  const unknown = buildScheduleDetail({ workKind: 'kenchiku' });
  assert.equal(unknown.rows.find((r) => r.id === 'kj-start-taicho').status, 'needs_check');
  for (const r of buildScheduleDetail({ workKind: 'kenchiku', hasSubcontract: true }).rows.filter((x) => x.id.includes('corins'))) {
    assert.equal(r.status, 'needs_check', r.id);
    assert.ok(r.checks.some((c) => c.includes('特記')));
  }
  assert.equal(buildScheduleDetail({ workKind: 'kenchiku', hasSubcontract: true }).rows.find((r) => r.id === 'kj-start-plan').status, 'applies');
  const sub = buildScheduleDetail({ workKind: 'kenchiku', direct: false });
  assert.deepEqual(sub.rows, []);
  assert.equal(sub.skipped.length, data.rules.length);
  assert.ok(buildScheduleDetail({ workKind: 'kenchiku', orderer: 'private' }).notes[0].includes('国の官庁営繕の例'));
});

test('出典の表示。段取りと目次の語と積算の表が切り替わる', () => {
  assert.equal(kindSource('kenchiku', 'schedule').title, '公共建築工事標準仕様書(建築工事編)令和7年版');
  const line = kindSourceText('kenchiku', 'schedule');
  assert.ok(line.includes('公共建築工事標準仕様書') && line.includes('取得日 2026-11-05') && line.includes('令和7年5月12日'));
  assert.ok(!line.includes(NOT_READ));
  assert.ok(!kindSourceText('kenchiku', 'plan').includes(NOT_READ));
  assert.ok(kindSourceText('kenchiku', 'estimate').includes('公共建築工事共通費積算基準'));
});

test('画面: 建築に変えて確認すると、段取りと出典・注記が建築に切り替わり、まとめと CSV も通る', async () => {
  const page = runPage();
  await page.click('sample-load');
  await page.click('confirm-go').catch(() => {});
  page.el('work-kind').value = 'kenchiku';
  await page.click('bid-run');
  const result = page.text('schedule-result');
  assert.ok(result.includes('実施工程表') && result.includes('総合施工計画書') && !result.includes(NOT_READ));
  assert.ok(page.el('work-kind-schedule').textContent.includes('公共建築工事標準仕様書'));
  assert.ok(page.el('schedule-notice').textContent.includes('国の官庁営繕の例') && page.el('schedule-notice').textContent.includes('改修の本文は見ていません'));
  assert.equal(page.el('schedule-about').hidden, true, '土木の説明の文を出さない');
  assert.equal(page.el('rules-wakayama').hidden, true);
  assert.ok(page.el('summary').innerHTML.includes('受注後の段取り'));
  await page.click('schedule-csv-btn');
  const csv = await page.blobs.at(-1).text();
  assert.ok(csv.includes('建築') && csv.includes('公共建築工事標準仕様書') && !csv.includes('共通仕様書 '));
  await page.click('plan-run');
  assert.ok(!page.text('plan-result').includes(NOT_READ), '目次は 1.2.2 の語で見る');
});

test('画面: もう受注した人の知らせも建築の例の名前になる', async () => {
  const page = runPage();
  page.el('work-kind').value = 'kenchiku';
  await page.click('entry-awarded');
  assert.ok(page.el('awarded-notice-text').textContent.includes('国の官庁営繕の例'));
  assert.ok(!page.el('awarded-notice-text').textContent.includes('国の直轄の例'));
  assert.ok(page.text('schedule-result').includes('実施工程表'));
});

test('取得: 行は位置でそろえ、1章の範囲だけを取り、ページの番号の行を除く', () => {
  const item = (x, y, t) => ({ x, y, text: t });
  assert.deepEqual(pageLines([item(50, 700, 'いい'), item(10, 701, 'ああ'), item(10, 680, ' うう ')]), ['ああいい', 'うう']);
  const page = (no, ...lines) => ({ page: no, items: lines.map((l, i) => item(10, 700 - i * 20, l)) });
  const pages = [
    page(1, '目次', '１章 各章共通事項', '１節 共通事項'),
    page(2, '１章 各章共通事項', '１節 共通事項', '1.1.1 一般事項', '-  1  -'),
    page(3, '1.1.2 用語の定義', '2'),
    page(4, '２章 仮設工事', '2.1.1 一般事項'),
  ];
  assert.deepEqual(chapter1(pages).map((p) => p.page), [2, 3]);
  const out = chapterText(pages);
  assert.ok(out.includes('1.1.2 用語の定義') && !out.includes('仮設工事') && !out.includes('目次'));
  assert.ok(!/^-?\s*\d+\s*-?$/m.test(out));
  assert.throws(() => chapter1([page(1, '別の文書')]), /範囲/);
});

test('置いた原文は1章だけ', () => {
  assert.ok(text.includes('1.7.3 保全に関する資料'));
  assert.ok(!/^２章/m.test(text) && !/^2\.1\.1/m.test(text));
});

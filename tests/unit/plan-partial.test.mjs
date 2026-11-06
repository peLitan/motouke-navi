// 目次の点検で、見出しの一部にだけ当たる項目を候補に回す(F77b)の単体テスト。目次の値はすべて架空
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { checkPlanToc } from '../../src/plan-check.mjs';

const PARTIAL = '見出しの一部にだけ当たる項目は、見つけたに数えず候補に回しました';
const items = JSON.parse(fs.readFileSync(new URL('../../data/plan-items.json', import.meta.url), 'utf8')).items;
const foundOf = (out, item) => out.found.find((f) => f.item === item);
const candOf = (out, item) => out.candidates.find((c) => c.item === item);

test('「9. 交通安全管理」だけの目次では、安全管理を見つけたに数えず、理由つきで候補に回す', () => {
  const out = checkPlanToc('9. 交通安全管理');
  assert.equal(foundOf(out, '安全管理'), undefined);
  const c = candOf(out, '安全管理');
  assert.ok(c.message.includes('見出し『交通安全管理』の一部にだけ当たります。その見出しがこの記載事項に当たるか確かめてください'), c.message);
  assert.ok(c.message.startsWith('国の直轄の土木の共通仕様書 1-1-1-6 では(9)「安全管理」が記載事項です。'), c.message);
  assert.equal(c.partial, true);
  assert.ok(!c.message.includes('見当たりません'), c.message);
  assert.equal(c.basis.section, '1-1-1-6');
  assert.ok(c.basis.page > 0 && c.basis.quote.includes('安全管理'));
  assert.ok(out.notes.includes(PARTIAL));
});

test('見出しの一部にだけ当たった行は、記載項目に当たらなかった行にも残る', () => {
  assert.deepEqual(checkPlanToc('9. 交通安全管理').extra, ['9. 交通安全管理']);
});

test('「安全管理」の見出しもあれば、同じ見出しで見つけて候補に回さず、交通安全管理の行は当たらなかった行に出す', () => {
  const out = checkPlanToc('8. 交通安全管理\n9. 安全管理');
  assert.equal(foundOf(out, '安全管理').line, '9. 安全管理');
  assert.equal(candOf(out, '安全管理'), undefined);
  assert.ok(out.extra.includes('8. 交通安全管理'));
  assert.ok(!out.notes.includes(PARTIAL));
});

test('「指定機械・主要機械」は指定機械の候補(一部)になり、主要船舶・機械の候補は今の文のまま', () => {
  const out = checkPlanToc('5. 指定機械・主要機械');
  assert.equal(foundOf(out, '指定機械'), undefined);
  assert.ok(candOf(out, '指定機械').message.includes('見出し『指定機械・主要機械』の一部にだけ当たります'));
  const ship = candOf(out, '主要船舶・機械');
  assert.ok(ship.message.includes('目次にその見出しが見当たりません'));
  assert.equal(ship.partial, undefined);
});

test('「現場組織」「主要船舶・機械」の動きは今のまま', () => {
  const short = checkPlanToc('3. 現場組織');
  assert.ok(candOf(short, '現場組織表').message.includes('目次にその見出しが見当たりません'));
  assert.equal(candOf(short, '現場組織表').partial, undefined);
  assert.ok(short.extra.includes('3. 現場組織'));
  const out = checkPlanToc('5. 主要船舶・機械');
  assert.equal(foundOf(out, '主要船舶・機械').byAlias, false);
  assert.equal(candOf(out, '主要船舶・機械'), undefined);
});

test('言い換えの語と同じ見出しは今までどおり「書き方が違う」で見つける', () => {
  const out = checkPlanToc('2. 工程表\n3. 組織表\n14. 建設副産物');
  for (const item of ['計画工程表', '現場組織表', '再生資源の利用の促進と建設副産物の適正処理方法']) {
    assert.equal(foundOf(out, item).byAlias, true, item);
  }
  assert.ok(!out.notes.includes(PARTIAL));
});

test('言い換えの語を含むだけの見出しは今までどおり見つけたに数える(回答 A)', () => {
  const out = checkPlanToc('10. 緊急時の体制と対応\n15. 週休２日の取組み');
  assert.equal(foundOf(out, '緊急時の体制及び対応').byAlias, true);
  assert.equal(foundOf(out, '法定休日・所定休日').byAlias, true);
  assert.equal(candOf(out, '緊急時の体制及び対応'), undefined);
});

test('項目名と言い換えの語の両方を含む見出しは今までどおり見つけ、「書き方が違う」にしない', () => {
  const out = checkPlanToc('10. 緊急時の体制及び対応について\n2. 計画工程表の概要\n13. 現場作業環境の整備状況');
  for (const item of ['緊急時の体制及び対応', '計画工程表', '現場作業環境の整備']) {
    assert.equal(foundOf(out, item).byAlias, false, item);
    assert.equal(candOf(out, item), undefined, item);
  }
  assert.ok(!out.notes.includes(PARTIAL));
});

test('同じ見出しを、前にある含むだけの見出しより先に見つける', () => {
  const out = checkPlanToc('1. 工程表の見方\n2. 工程表');
  assert.equal(foundOf(out, '計画工程表').line, '2. 工程表');
  assert.deepEqual(out.extra, ['1. 工程表の見方']);
});

test('項目名と両方の語を含む見出しを、前にある言い換えの語だけの見出しより先に見つける', () => {
  const out = checkPlanToc('1. 工程表の見方\n2. 計画工程表の概要');
  assert.equal(foundOf(out, '計画工程表').line, '2. 計画工程表の概要');
  assert.equal(foundOf(out, '計画工程表').byAlias, false);
});

test('項目名どおりの16項目の目次は候補が空で、どれも原文の項目名で見つける', () => {
  const out = checkPlanToc(items.map((it, i) => (i + 1) + '. ' + it.label).join('\n'));
  assert.deepEqual(out.candidates, []);
  assert.equal(out.found.length, items.length);
  assert.ok(out.found.every((f) => f.byAlias === false));
  assert.ok(!out.notes.includes(PARTIAL));
});

test('番号・印・ページ番号の付いた項目名どおりの見出しは、一部にだけ当たるに回らない', () => {
  const forms = ['9. 安全管理 12', '安全管理\t12', '安全管理12', '第9章 安全管理 ……… 12', '９章 安全管理', '第9 安全管理', '第9部 安全管理', '・安全管理', '■ 安全管理', '- 安全管理', 'IX. 安全管理', 'Ⅸ 安全管理', '九 安全管理', '九、安全管理', '九)安全管理', 'ア 安全管理', 'あ 安全管理', '・九 安全管理', '■ ア 安全管理', '1. ア 安全管理',
    '9. 安全管理 ……… 1-7', '9. 安全管理 1-7', '9. 安全管理 p.7', '9. 安全管理 ……P.7', '9. 安全管理 7頁', '9. 安全管理 7ページ', '安全管理 : 7', '安全管理 ─── 7', '【9】安全管理', '[9] 安全管理', '## 9. 安全管理', '- **安全管理**', '| 9 | 安全管理 |', 'No.9 安全管理', '9: 安全管理', '§9 安全管理', '※ 安全管理', '★ 安全管理', 'A 安全管理'];
  for (const line of forms) {
    const out = checkPlanToc(line);
    assert.ok(foundOf(out, '安全管理'), line);
    assert.equal(foundOf(out, '安全管理').byAlias, false, line);
  }
});

test('16項目がそろった目次は、ページ番号の書き方によらず候補が出ない', () => {
  for (const tail of [' ……… 1-7', ' 1-7', ' p.7', ' 7頁', ' 7']) {
    assert.deepEqual(checkPlanToc(items.map((it, i) => (i + 1) + '. ' + it.label + tail).join('\n')).candidates, [], tail);
  }
});

test('言い換えの語にページ番号が付いた見出しも、語と同じ見出しとして前の見出しより先に見つける', () => {
  const out = checkPlanToc('1. 工程表の見方\n2. 工程表 1-3');
  assert.equal(foundOf(out, '計画工程表').line, '2. 工程表 1-3');
  assert.equal(foundOf(out, '計画工程表').byAlias, true);
});

test('語のほかに漢字・かなの語が残る見出しは同じ見出しとせず、一部に回す', () => {
  const lines = ['第三者交通安全管理', '第2工区 安全管理', '3項目の安全管理', '二次安全管理', '現場の安全管理', '国道12号線の安全管理', '安全管理について', '安全管理計画', 'ヒヤリハット安全管理'];
  for (const line of lines) {
    const out = checkPlanToc(line);
    assert.equal(foundOf(out, '安全管理'), undefined, line);
    assert.equal(candOf(out, '安全管理').partial, true, line);
  }
});

test('候補の文の見出しは、語の頭を削らない', () => {
  assert.ok(candOf(checkPlanToc('第三者交通管理'), '交通管理').message.includes('見出し『第三者交通管理』'));
  assert.ok(candOf(checkPlanToc('第2工区 施工方法'), '施工方法').message.includes('見出し『第2工区施工方法』'));
});

test('読み込んだ表の項目名と同じ見出しは、語の頭や末尾の数字を番号として削らずに見つける', () => {
  for (const [line, label] of [['第三者対策', '第三者対策'], ['第二種地盤の施工方法', '第二種地盤の施工方法'], ['一 般 事 項', '一般事項'], ['ア ス ベ ス ト 対 策', 'アスベスト対策'], ['様式 1', '様式1']]) {
    const table = { planItems: [{ id: 'x', no: 1, label, section: '第9条', quote: '架空の抜き書き ' + label }], source: { url: 'https://example.com/spec', fetchedAt: '2026-01-01', edition: '令和1年版' } };
    const out = checkPlanToc(line, { table });
    assert.deepEqual(out.candidates, [], line);
    assert.equal(out.found[0].byAlias, false, line);
  }
});

test('読み込んだ表の行でも、一部にだけ当たる見出しは表の名前の文で候補に回す', async () => {
  const { tableName } = await import('../../src/rules-load.mjs');
  const table = {
    planItems: [{ id: 'x', no: 1, label: '安全管理', section: '第9条', quote: '架空の抜き書き 安全管理' }],
    source: { url: 'https://example.com/spec', fetchedAt: '2026-01-01', edition: '令和1年版' },
  };
  const out = checkPlanToc('1. 交通安全管理', { table });
  assert.deepEqual(out.found, []);
  const c = candOf(out, '安全管理');
  assert.ok(c.message.startsWith(tableName(table) + ' 第9条 では(1)「安全管理」が記載事項です。'), c.message);
  assert.ok(c.message.includes('一部にだけ当たります'));
  assert.ok(out.notes.includes(PARTIAL));
});

test('読み込んだ表の言い換えの語が空なら、語として見ない', () => {
  const table = {
    planItems: [{ id: 'x', no: 1, label: '安全管理', aliases: [''], section: '第9条', quote: '架空の抜き書き 安全管理' }],
    source: { url: 'https://example.com/spec', fetchedAt: '2026-01-01', edition: '令和1年版' },
  };
  const out = checkPlanToc('1. 写真管理', { table });
  assert.deepEqual(out.found, []);
  assert.ok(candOf(out, '安全管理').message.includes('見当たりません'));
});

test('一部にだけ当たる候補の理由は画面と CSV に出る', async () => {
  const { renderPlanResult } = await import('../../src/ui/view.mjs');
  const { planRows } = await import('../../src/export.mjs');
  const out = checkPlanToc('9. 交通安全管理');
  assert.ok(renderPlanResult(out).includes('一部にだけ当たります'));
  assert.ok(planRows(out).some((r) => r[0] === '安全管理' && r[2].includes('一部にだけ当たります')));
});

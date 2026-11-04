// F32a: 台帳と施工体系図・施工計画書の目次の突き合わせ。値はすべて架空
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLedgerText } from '../../src/ledger-text.mjs';
import { checkTaicho } from '../../src/check-taicho.mjs';
import { addCrossCandidates, parseTaikeizu, readOrderer } from '../../src/cross-docs.mjs';
import { runLedgerCheck } from '../../src/ui/app.mjs';
import { checkRows } from '../../src/export.mjs';
import fs from 'node:fs';

const LICENSE = '架空県知事 許可(般-05)第00002号';
const HEAD = ['| 項目 | 内容 |', '|---|---|'];
const ledgerText = (subs, orderer = '架空県ためし市(ためし市長)') => [
  '工事名: 架空ためし改良工事', '',
  '## 1. 作成建設業者(元請)', '', ...HEAD, '| 商号 | 架空建設株式会社 |', '',
  '## 2. 発注者との契約', '', ...HEAD, `| 発注者 | ${orderer} |`, '',
  '## 3. 元請の技術者等', '', ...HEAD, '| 監理技術者 氏名 | 甲野 一郎 |', '',
  '## 4. 下請負人(一次)', '',
  ...subs.flatMap(([name, eng], i) => [`### 4-${i + 1}. ${name}`, '', ...HEAD, `| 許可番号 | ${LICENSE} |`, `| 主任技術者 氏名 | ${eng} |`, '']),
].join('\n');
const DIAGRAM = [
  '# 施工体系図', '発注者: 株式会社ためし不動産', '```',
  '[元請] 架空建設株式会社', '  監理技術者: 甲野 一郎 / 現場代理人: 甲野 二郎', '  |',
  '  +-- [一次] 乙川土工株式会社', '  |     主任技術者: 乙川 三郎(専任)', '  |     工期: 2026/09/10 - 2026/12/25', '  |',
  '  +-- [一次] 丙野舗装(株)', '  |     主任技術者: 別人 五郎', '  |',
  '  +-- [一次] 戊田設備株式会社', '        主任技術者: 戊田 四郎', '        |',
  '        +-- [二次] 己島電設有限会社', '              主任技術者: 己島 六郎', '```',
].join('\n');
const run = (text, docs) => {
  const ledger = parseLedgerText(text);
  ledger.project.workType = 'other';
  ledger.project.ordererType = 'public';
  const base = checkTaicho(ledger);
  return { base, out: addCrossCandidates(base, ledger, docs) };
};
const by = (list, field) => list.filter((x) => x.field === field);
const LEDGER = ledgerText([['乙川土工株式会社', '乙川三郎'], ['丙野舗装株式会社', '丙野 五郎'], ['庚原塗装株式会社', '庚原 七郎']]);

test('体系図を読む: 元請けの技術者を下請けに入れず、次数と技術者を読む', () => {
  const d = parseTaikeizu(DIAGRAM);
  assert.equal(d.orderer, '株式会社ためし不動産');
  assert.deepEqual(d.subs.map((s) => [s.name, s.tier, s.engineers]), [
    ['乙川土工株式会社', '一次', ['乙川 三郎']], ['丙野舗装(株)', '一次', ['別人 五郎']],
    ['戊田設備株式会社', '一次', ['戊田 四郎']], ['己島電設有限会社', '二次', ['己島 六郎']],
  ]);
});

test('3つの食い違いが出る: 片方だけの下請負人・技術者の氏名・発注者(判断できない)', () => {
  const { out } = run(LEDGER, { taikeizu: DIAGRAM });
  const subs = by(out.candidates, 'cross.subs').map((c) => c.target).sort();
  assert.deepEqual(subs, ['庚原塗装株式会社', '己島電設有限会社', '戊田設備株式会社'].sort());
  const eng = by(out.candidates, 'cross.engineer');
  assert.equal(eng.length, 1);
  assert.equal(eng[0].target, '丙野舗装株式会社'); // (株)と株式会社は同じ会社に読む。乙川は空白の違いだけ
  assert.match(eng[0].message, /丙野 五郎.*別人 五郎/);
  const ord = by(out.undecidable, 'cross.orderer');
  assert.equal(ord.length, 1);
  assert.match(ord[0].message, /架空県ためし市.*株式会社ためし不動産/);
  assert.deepEqual(by(out.candidates, 'cross.orderer'), [], '発注者は候補に言い切らない');
  for (const x of [...by(out.candidates, 'cross.subs'), ...eng, ...ord]) {
    assert.ok(x.basis.length > 0);
    for (const b of x.basis) assert.match(b.quoteId, /^q-(kensetsu-24_8|kisoku-14_2)/);
  }
});

test('台帳だけのとき結果は変わらない。空白だけの欄も同じ', () => {
  const { base, out } = run(LEDGER, {});
  assert.equal(out, base);
  const blank = run(LEDGER, { taikeizu: ' \n', plan: '' });
  assert.equal(blank.out, blank.base);
  const noOrderer = run(LEDGER, { plan: '1. 工事概要\n2. 計画工程表' });
  assert.equal(noOrderer.out, noOrderer.base, '発注者の行の無い目次は結果を変えない');
  assert.ok(base.notes.some((n) => /突き合わせはしていません/.test(n)));
  assert.equal(addCrossCandidates(base, parseLedgerText(LEDGER)), base);
});

test('元の結果を変えない。台帳の空は二重に出さず体系図の氏名を書き足す。注意の文を替える', () => {
  const { base, out } = run(ledgerText([['丙野舗装株式会社', '']]), { taikeizu: DIAGRAM });
  assert.doesNotMatch(base.candidates.find((c) => c.field === 'engineer').message, /施工体系図/);
  assert.match(out.candidates.find((c) => c.field === 'engineer').message, /施工体系図には「別人 五郎」/);
  assert.deepEqual(by(out.candidates, 'cross.engineer'), []);
  assert.ok(out.notes.some((n) => /下請負人の一覧・下請けの技術者の氏名・発注者の名前/.test(n)));
  assert.ok(!out.notes.some((n) => /突き合わせはしていません/.test(n)));
});

test('合っている書類には何も足さない。かっこの書き添えは発注者の違いにしない', () => {
  const diagram = ['発注者: 架空県ためし市', '[元請] 架空建設株式会社', '[一次] 乙川土工株式会社', '主任技術者: 乙川 三郎'].join('\n');
  const { base, out } = run(ledgerText([['乙川土工株式会社', '乙川 三郎']]), { taikeizu: diagram, plan: '発注者: 架空県 ためし市\n1. 工事概要' });
  assert.deepEqual(out.candidates, base.candidates);
  assert.deepEqual(out.undecidable, base.undecidable);
  assert.deepEqual(out.crossWarnings, []);
});

test('目次だけのとき: 発注者の名前だけを比べ、下請負人は見ない', () => {
  const { base, out } = run(LEDGER, { plan: '# 施工計画書 目次\n発注者: 架空県 住宅供給課\n受注者: 架空建設株式会社\n1. 工事概要' });
  assert.match(by(out.undecidable, 'cross.orderer')[0].message, /施工計画書の目次: 架空県 住宅供給課/);
  assert.deepEqual(out.candidates, base.candidates);
  assert.ok(out.notes.some((n) => /台帳と施工計画書の目次は、発注者の名前だけ/.test(n)));
});

test('読めないときは片方に無いと言わず判断できないにする', () => {
  const { out } = run(LEDGER, { taikeizu: '施工体系図は別紙のとおり' });
  assert.deepEqual(by(out.candidates, 'cross.subs'), []);
  assert.match(by(out.undecidable, 'cross.subs')[0].message, /施工体系図から下請負人を読めなかった/);
  assert.ok(out.crossWarnings.some((w) => /発注者: …/.test(w)));
  const none = run('工事名: 架空工事\n', { taikeizu: DIAGRAM }).out;
  assert.deepEqual(by(none.candidates, 'cross.subs'), []);
  assert.match(by(none.undecidable, 'cross.subs')[0].message, /施工体制台帳から下請負人を読めなかった/);
});

test('法人の種類だけ違う名前は同じ会社と言い切らない。体系図の技術者が読めなければ判断できない', () => {
  const diagram = ['[一次] 乙川土工有限会社', '[一次] 丙野舗装株式会社', '主任技術者: 丙野 五郎'].join('\n');
  const { out } = run(ledgerText([['乙川土工株式会社', '乙川 三郎'], ['丙野舗装株式会社', '丙野 五郎']]), { taikeizu: diagram });
  assert.deepEqual(by(out.candidates, 'cross.subs'), []);
  const u = by(out.undecidable, 'cross.subs');
  assert.equal(u.length, 1);
  assert.match(u[0].message, /乙川土工有限会社/);
  assert.match(by(out.undecidable, 'cross.engineer')[0].message, /比べられず/);
});

test('台帳に同じ会社が2行あっても、2行目を体系図に無いと言わない', () => {
  const { out } = run(ledgerText([['乙川土工株式会社', '乙川 三郎'], ['乙川土工株式会社', '乙川 三郎']]), { taikeizu: '[一次] 乙川土工株式会社\n主任技術者: 乙川 三郎' });
  assert.deepEqual(by(out.candidates, 'cross.subs'), []);
});

test('体系図の別の書き方を読む: 枝の線・見出しの語・表。補佐は読まない', () => {
  const d = parseTaikeizu([
    '| 発注者 | 架空県 |', '├─ 乙川土工株式会社', '│  主任技術者: 乙川 三郎', '│  監理技術者補佐: 読まない 名前',
    '一次下請: 丙野舗装株式会社', '| 主任技術者 | 丙野 五郎 |', '【二次】戊田設備株式会社 主任技術者: 戊田 四郎', '下請負人: なし', '参考 癸山設備株式会社',
  ].join('\n'));
  assert.equal(d.orderer, '架空県');
  assert.deepEqual(d.subs.map((s) => [s.name, s.engineers]), [['乙川土工株式会社', ['乙川 三郎']], ['丙野舗装株式会社', ['丙野 五郎']], ['戊田設備株式会社', ['戊田 四郎']]]);
  assert.equal(d.warnings.length, 1);
  assert.equal(readOrderer('発注者との協議: 別紙\n発注者: 架空市'), '架空市');
});

test('画面: 体系図の欄に貼ると結果と CSV の元に出て、空なら台帳だけの結果と同じ。index.html に欄がある', () => {
  const els = {
    'ledger-input': { value: LEDGER }, 'taikeizu-input': { value: '' }, 'plan-input': { value: '' },
    'check-result': { innerHTML: '' }, 'check-status': { textContent: '' },
  };
  const doc = { getElementById: (id) => els[id] ?? null, querySelectorAll: () => [] };
  runLedgerCheck(doc);
  const ledgerOnly = els['check-result'].innerHTML;
  assert.doesNotMatch(ledgerOnly, /書類どうし/);
  els['taikeizu-input'].value = DIAGRAM;
  runLedgerCheck(doc);
  const html = els['check-result'].innerHTML;
  assert.match(html, /書類どうしの下請負人の一覧/);
  assert.match(html, /書類どうしの技術者の氏名/);
  assert.match(html, /書類どうしの発注者の名前/);
  const rows = checkRows(run(LEDGER, { taikeizu: DIAGRAM }).out, '').flat().join('\n');
  assert.match(rows, /書類どうしの発注者の名前/);
  els['taikeizu-input'].value = '';
  runLedgerCheck(doc);
  assert.equal(els['check-result'].innerHTML, ledgerOnly);
  const page = fs.readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  assert.match(page, /id="taikeizu-input"/);
});

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

// F34a: 反証の再現の入力。同じ会社を片方にしか無いと言い切らない
const OTOKAWA = ledgerText([['乙川土工株式会社', '乙川 三郎']]);
const OTO_HEI = ledgerText([['乙川土工株式会社', '乙川 三郎'], ['丙野舗装株式会社', '丙野 五郎']]);
const subsOf = (out) => ({ cand: by(out.candidates, 'cross.subs'), und: by(out.undecidable, 'cross.subs') });

for (const line of ['[一次] 乙川土工株式会社 土工事', '[一次] 乙川土工株式会社(土木)', '├─ 乙川土工株式会社(土工事)']) {
  test('A-1 会社名の後ろの工種は別の会社にせず、判断できないに回す: ' + line, () => {
    const { cand, und } = subsOf(run(OTOKAWA, { taikeizu: line }).out);
    assert.deepEqual(cand, []);
    assert.equal(und.length, 1);
    assert.match(und[0].message, /名前の一部が合います/);
    assert.match(und[0].message, /技術者の氏名は比べていません/);
    assert.equal(und[0].target, '乙川土工株式会社');
  });
}

test('A-1 「 / 」で区切った工種は今までどおり読む', () => {
  const { base, out } = run(OTOKAWA, { taikeizu: '[一次] 乙川土工株式会社 / 工事内容: 土工事\n主任技術者: 乙川 三郎' });
  assert.deepEqual(out.candidates, base.candidates);
  assert.deepEqual(out.undecidable, base.undecidable);
});

test('A-2 台帳の見出しの(架空)の添え書きで別の会社にしない', () => {
  const { cand, und } = subsOf(run(ledgerText([['乙川土工株式会社(架空)', '乙川 三郎']]), { taikeizu: '[一次] 乙川土工株式会社' }).out);
  assert.deepEqual(cand, []);
  assert.equal(und.length, 1);
  assert.match(und[0].message, /乙川土工株式会社\(架空\)/);
});

test('A-3 表の形は読まず、注意を出して判断できないに回す', () => {
  const table = ['発注者: 架空県ためし市', '| 次数 | 会社名 | 主任技術者 |', '|---|---|---|', '| 一次 | 乙川土工株式会社 | 乙川 三郎 |'].join('\n');
  const d = parseTaikeizu(table);
  assert.deepEqual(d.subs, []);
  assert.equal(d.orderer, '架空県ためし市');
  assert.equal(d.tableLine, 2);
  const { out } = run(OTOKAWA, { taikeizu: table });
  const { cand, und } = subsOf(out);
  assert.deepEqual(cand, []);
  assert.equal(und.length, 1);
  assert.match(und[0].message, /一覧表の形で読まなかった/);
  assert.ok(out.crossWarnings.some((w) => /2行目: 列の見出しのある一覧表の形は読みません/.test(w)));
  assert.deepEqual(by(out.candidates, 'cross.engineer'), []);
});

test('A-3 2列の表: 会社名の列の見出しなら読まず、項目と内容の表と発注者の行は今までどおり読む', () => {
  const two = parseTaikeizu('| 会社名 | 次数 |\n|---|---|\n| 乙川土工株式会社 | 一次 |');
  assert.equal(two.tableLine, 1);
  const { cand } = subsOf(run(OTOKAWA, { taikeizu: '| 会社名 | 次数 |\n|---|---|\n| 乙川土工株式会社 | 一次 |' }).out);
  assert.deepEqual(cand, []);
  const kv = parseTaikeizu('| 項目 | 内容 |\n|---|---|\n| 発注者 | 架空県 | 備考 |\n| 一次下請 | 乙川土工株式会社 |');
  assert.equal(kv.tableLine, 0);
  assert.match(kv.orderer, /^架空県/);
  assert.deepEqual(kv.subs.map((s) => s.name), ['乙川土工株式会社']);
});

test('表の一部だけ読めても、片方に無いとは言わない', () => {
  const mixed = ['[一次] 丙野舗装株式会社', '| 次数 | 会社名 | 主任技術者 |', '|---|---|---|', '| 一次 | 乙川土工株式会社 | 乙川 三郎 |'].join('\n');
  const { cand, und } = subsOf(run(OTO_HEI, { taikeizu: mixed }).out);
  assert.deepEqual(cand, []);
  assert.equal(und.length, 1);
});

for (const line of ['下請負人: 乙川土工株式会社、丙野舗装株式会社', '一次下請: 乙川土工(株)(土工)、丙野舗装(株)(舗装)']) {
  test('A-4 1行に複数社は言い切らず、それぞれ判断できないに回す: ' + line, () => {
    const { cand, und } = subsOf(run(OTO_HEI, { taikeizu: line }).out);
    assert.deepEqual(cand, []);
    assert.deepEqual(und.map((u) => u.target).sort(), ['丙野舗装株式会社', '乙川土工株式会社'].sort());
  });
}

test('A-5 未知の役割のラベルは会社名に入れない。台帳に無い会社も下請負人と言い切らない', () => {
  const tree = ['  +-- [協力会社] 乙川土工株式会社', '  |     主任技術者: 乙川 三郎', '  |     +-- [再下請] 己島電設有限会社'].join('\n');
  assert.deepEqual(parseTaikeizu(tree).subs.map((s) => [s.name, s.label, s.engineers]), [['乙川土工株式会社', '協力会社', ['乙川 三郎']], ['己島電設有限会社', '再下請', []]]);
  const { out } = run(OTOKAWA, { taikeizu: tree });
  const { cand, und } = subsOf(out);
  assert.deepEqual(cand, []);
  assert.equal(und.length, 1);
  assert.match(und[0].message, /\[再下請\] 己島電設有限会社/);
  assert.deepEqual(by(out.candidates, 'cross.engineer'), []);
});

test('A-5 枝の線の無い行の未知のラベルも同じに読む', () => {
  assert.deepEqual(subsOf(run(OTOKAWA, { taikeizu: '[協力会社] 乙川土工株式会社 主任技術者: 乙川 三郎' }).out).cand, []);
});

test('A-6 元請けの行を下請負人にしない。元請けの技術者を下請けに付けない', () => {
  const tree = ['+-- 架空建設株式会社(元請)', '|   監理技術者: 甲野 一郎', '|   +-- 乙川土工株式会社', '|       主任技術者: 乙川 三郎'].join('\n');
  const d = parseTaikeizu(tree);
  assert.deepEqual(d.subs.map((s) => [s.name, s.engineers]), [['乙川土工株式会社', ['乙川 三郎']]]);
  const { base, out } = run(OTOKAWA, { taikeizu: tree });
  assert.deepEqual(out.candidates, base.candidates);
  assert.deepEqual(out.undecidable, base.undecidable);
});

test('A-6 印の無い元請けの枝: 同じ名前は数えず、一部が合うだけなら判断できない', () => {
  const same = subsOf(run(OTOKAWA, { taikeizu: '+-- 架空建設株式会社\n+-- 乙川土工株式会社' }).out);
  assert.deepEqual([same.cand, same.und], [[], []]);
  const part = subsOf(run(OTOKAWA, { taikeizu: '+-- 架空建設株式会社 本店\n+-- 乙川土工株式会社' }).out);
  assert.deepEqual(part.cand, []);
  assert.match(part.und[0].message, /元請けの行か下請負人か/);
});

test('A-9 中黒の有無は別の会社と言い切らない', () => {
  const { cand, und } = subsOf(run(ledgerText([['ハイパー・テック株式会社', '甲野 三郎']]), { taikeizu: '[一次] ハイパーテック株式会社' }).out);
  assert.deepEqual(cand, []);
  assert.equal(und.length, 1);
});

test('読まなかった行に名前があれば、体系図に見当たらないと言い切らない', () => {
  const { out } = run(OTO_HEI, { taikeizu: '[一次] 丙野舗装株式会社\n参考 乙川土工株式会社' });
  const { cand, und } = subsOf(out);
  assert.deepEqual(cand, []);
  assert.match(und[0].message, /読めなかった行「参考 乙川土工株式会社」/);
});

test('別の会社は今までどおり候補に出す。一部が合う名前でも、ほかの台帳の行と同じなら横取りしない', () => {
  const other = subsOf(run(OTOKAWA, { taikeizu: '[一次] 丙野舗装株式会社' }).out);
  assert.equal(other.cand.length, 2);
  assert.deepEqual(other.und, []);
  const ledger = ledgerText([['乙川土工株式会社', '乙川 三郎'], ['乙川土工建設株式会社', '乙川 四郎']]);
  const { cand, und } = subsOf(run(ledger, { taikeizu: '[一次] 乙川土工建設株式会社\n主任技術者: 乙川 四郎' }).out);
  assert.deepEqual(cand.map((c) => c.target), ['乙川土工株式会社']);
  assert.deepEqual(und, []);
  assert.match(cand[0].message, /施工体系図に見当たりません/);
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

// F34b: 技術者の氏名の比べ方と、注意の文
const engineerOf = ({ out }) => ({ cand: by(out.candidates, 'cross.engineer'), und: by(out.undecidable, 'cross.engineer') });

test('A-7: 台帳の氏名の末尾のかっこも外して比べる', () => {
  const r = run(ledgerText([['乙川土工株式会社', '乙川 三郎(専任)']]), { taikeizu: '[一次] 乙川土工株式会社\n主任技術者: 乙川 三郎(専任)' });
  assert.deepEqual(engineerOf(r), { cand: [], und: [] });
  // かっこだけが同じで氏名が違えば、今までどおり出す(日付や書き添えで合うことにしない)
  const other = engineerOf(run(ledgerText([['乙川土工株式会社', '乙川 三郎(専任)']]), { taikeizu: '[一次] 乙川土工株式会社\n主任技術者: 乙川 四郎(専任)' }));
  assert.equal(other.cand.length, 1);
  assert.match(other.cand[0].message, /施工体制台帳は「乙川 三郎」、施工体系図は「乙川 四郎」/);
});

test('A-8: 1つの欄の複数の氏名は、日付の「/」で割らずに分けて集合で比べる', () => {
  const ledger = ledgerText([['乙川土工株式会社', '乙川 三郎(〜2026/10/31)、乙川 四郎(2026/11/1〜)']]);
  const both = '[一次] 乙川土工株式会社\n主任技術者: 乙川 三郎(〜2026/10/31)\n主任技術者: 乙川 四郎(2026/11/1〜)';
  assert.deepEqual(engineerOf(run(ledger, { taikeizu: both })), { cand: [], und: [] });
  assert.deepEqual(parseTaikeizu('[一次] 乙川土工株式会社\n主任技術者: 乙川 三郎、乙川 四郎(2026/11/1〜)').subs[0].engineers, ['乙川 三郎', '乙川 四郎']);
  for (const sep of [',', ';', '→', ' / ']) {
    const r = run(ledgerText([['乙川土工株式会社', `乙川 三郎${sep}乙川 四郎`]]), { taikeizu: '[一次] 乙川土工株式会社\n主任技術者: 乙川 四郎' });
    assert.deepEqual(engineerOf(r), { cand: [], und: [] }, sep);
  }
  assert.deepEqual(engineerOf(run(ledgerText([['乙川土工株式会社', '乙川 三郎(前任)・乙川 四郎(後任)']]), { taikeizu: both })), { cand: [], und: [] });
  // 「・」でつないだ1人の名前は割らない
  const foreign = engineerOf(run(ledgerText([['乙川土工株式会社', 'ジョン・スミス']]), { taikeizu: '[一次] 乙川土工株式会社\n主任技術者: スミス' }));
  assert.match(foreign.cand[0].message, /「ジョン・スミス」、施工体系図は「スミス」/);
});

test('A-8: 同じ会社の節が旧・新の2つでも、まとめて比べて1社として扱う', () => {
  const ledger = ledgerText([['乙川土工株式会社', '乙川 三郎'], ['乙川土工(株)', '乙川 四郎']]);
  const newOnly = run(ledger, { taikeizu: '[一次] 乙川土工株式会社\n主任技術者: 乙川 四郎' });
  assert.deepEqual(engineerOf(newOnly), { cand: [], und: [] });
  assert.deepEqual(by(newOnly.out.candidates, 'cross.subs'), []);
  // どちらの節の氏名とも違えば1件だけ出し、両方の氏名を見せる
  const none = engineerOf(run(ledger, { taikeizu: '[一次] 乙川土工株式会社\n主任技術者: 別人 五郎' }));
  assert.equal(none.cand.length, 1);
  assert.match(none.cand[0].message, /「乙川 三郎」「乙川 四郎」、施工体系図は「別人 五郎」/);
  // 体系図に無い会社の節が2つでも、見当たらないの候補は1件
  const missing = run(ledger, { taikeizu: '[一次] 丙野舗装株式会社\n主任技術者: 丙野 五郎' }).out;
  assert.deepEqual(by(missing.candidates, 'cross.subs').filter((c) => /台帳に下請負人/.test(c.message)).map((c) => c.target), ['乙川土工株式会社']);
  // 片方の節だけ氏名が空でも、もう片方の氏名で比べる
  const half = engineerOf(run(ledgerText([['乙川土工株式会社', ''], ['乙川土工(株)', '乙川 四郎']]), { taikeizu: '[一次] 乙川土工株式会社\n主任技術者: 乙川 四郎' }));
  assert.deepEqual(half, { cand: [], und: [] });
});

test('A-8: 集合の比べ: 含まれるなら合い、両方に相手に無い氏名があれば候補。確かめることに交代を書く', () => {
  const ledger = ledgerText([['乙川土工株式会社', '乙川 三郎、乙川 四郎']]);
  const { cand, und } = engineerOf(run(ledger, { taikeizu: '[一次] 乙川土工株式会社\n主任技術者: 乙川 三郎\n主任技術者: 別人 五郎' }));
  assert.equal(cand.length, 1);
  assert.deepEqual(und, []);
  assert.match(cand[0].confirm.join(''), /技術者の交代\(前任・後任\)/);
  const single = engineerOf(run(ledgerText([['乙川土工株式会社', '乙川 三郎']]), { taikeizu: '[一次] 乙川土工株式会社\n主任技術者: 乙川 三郎\n監理技術者: 別人 五郎' }));
  assert.deepEqual(single, { cand: [], und: [] });
});

test('空の扱い: かっこを外すと空の氏名は空として読み、同じ会社の空の節の両方に体系図の氏名を足す', () => {
  const r = run(ledgerText([['乙川土工株式会社', '未定(調整中)']]), { taikeizu: '[一次] 乙川土工株式会社\n主任技術者: 乙川 三郎' });
  assert.deepEqual(by(r.out.candidates, 'cross.engineer'), []);
  const two = run(ledgerText([['乙川土工株式会社', ''], ['乙川土工(株)', '']]), { taikeizu: '[一次] 乙川土工株式会社\n主任技術者: 乙川 三郎' }).out;
  const rows = [...two.candidates, ...two.undecidable].filter((x) => x.field === 'engineer');
  assert.equal(rows.length, 2);
  for (const row of rows) assert.equal(row.message.match(/施工体系図には「乙川 三郎」とあります/g).length, 1);
});

test('A-10: 発注者の名前を比べていないときは、注意の文に書かない', () => {
  const crossNote = (out) => out.notes.find((n) => /突き合わせて/.test(n));
  const noOrderer = run(ledgerText([['乙川土工株式会社', '乙川 三郎']]), { taikeizu: '[一次] 乙川土工株式会社\n主任技術者: 乙川 三郎' }).out;
  assert.match(crossNote(noOrderer), /下請負人の一覧・下請けの技術者の氏名だけを突き合わせています/);
  assert.doesNotMatch(crossNote(noOrderer), /発注者/);
  assert.ok(noOrderer.crossWarnings.some((w) => /「発注者: …」の行が見つからない/.test(w)));
  // 体系図に行が無くても、目次と台帳で比べたなら書く
  const withPlan = run(ledgerText([['乙川土工株式会社', '乙川 三郎']]), { taikeizu: '[一次] 乙川土工株式会社', plan: '発注者: 架空県ためし市' }).out;
  assert.match(crossNote(withPlan), /発注者の名前だけを突き合わせています/);
  // 台帳に発注者が無く目次だけにあるときは、比べたものが無い
  const nothing = run(ledgerText([['乙川土工株式会社', '乙川 三郎']], ''), { plan: '発注者: 架空県ためし市' }).out;
  assert.match(crossNote(nothing), /台帳と施工計画書の目次は、比べられる項目が無く、突き合わせていません/);
  assert.doesNotMatch(crossNote(nothing), /発注者/);
});

test('A-8: 節の見出しの会社名が全く同じ2つでも、まとめて比べる', () => {
  const r = run(ledgerText([['乙川土工株式会社', '乙川 三郎'], ['乙川土工株式会社', '乙川 四郎']]), { taikeizu: '[一次] 乙川土工株式会社\n主任技術者: 乙川 四郎' });
  assert.deepEqual(engineerOf(r), { cand: [], und: [] });
});

// F81c の単体の試験: 点検の Skill の条番号の確かめ(check-articles.mjs)の2つの直し。指摘の文はすべて架空
// (a) 条番号の直前に、取り込んだ法令の名前に無い法令名(「〜法」「〜令」「〜規則」「〜条例」と「〜法律」)があれば、
//     理由を「この道具が取り込んでいない法令」にする。法令名の無い「法第26条第1項」「第26条」は今までどおり
// (b) 「及び」「並びに」「、」のすぐ後が素の「第」のときだけ、同じ行の直前の条番号の法令名を引き継ぐ。「法第」「同法第」は引き継がない
// 取り込んでいない法令名は reference/articles.md の「取得した条」を読んで選び、一覧に無いことを試験の中でも確かめる。
// 架空の法令名も混ぜ、決まった名前の一覧で見分けていないことを確かめる
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { checkArticles, formatResults, loadSources } from '../../plugin/skills/construction-check/scripts/check-articles.mjs';
import { scoreCase, loadCase, RUBRIC } from '../../plugin/evals/score.mjs';
import { handleMessage } from '../../integration/claude-code/mcp/masked-files.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SKILL = path.join(ROOT, 'plugin', 'skills', 'construction-check');
const TAKEN_TABLE = fs.readFileSync(path.join(SKILL, 'reference', 'articles.md'), 'utf8').split('## 見ていない条')[0];
const TAKEN_LAWS = new Set(loadSources().map((s) => s.law));
const rows = (text) => checkArticles(text).results.map((r) => [r.label, r.status]);

// [法令名, 条番号から後]。法令名はどれも「取得した条」の一覧に無い
const UNTAKEN = [
  ['労働安全衛生法', '第88条第1項'],
  ['民法', '第632条'],
  ['建築基準法施行令', '第5条'],
  ['労働安全衛生規則', '第563条第1項第2号'],
  ['架空町景観条例', '第3条'],
  ['建設工事に係る資材の再資源化等に関する法律', '第9条'],
  ['公共工事の入札及び契約の適正化の促進に関する法律施行令', '第3条'],
  ['架空工事安全法', ' 第12条'],
  ['環境基本法', '第3条'],
  ['PFI法', '第2条'],
];

test('選んだ法令名は、取得した条の一覧(articles.md の表と原文の一覧)に無い', () => {
  assert.equal(TAKEN_LAWS.size, 4);
  for (const [name] of UNTAKEN) {
    assert.equal(TAKEN_LAWS.has(name), false, name);
    assert.equal(TAKEN_TABLE.includes(name + ' 第'), false, name);
  }
});

for (const [name, rest] of UNTAKEN) {
  test(`(a) 取り込んでいない法令: ${name}${rest} は確かめられない。理由は「取り込んでいない法令」で、法令名が無いとは言わない`, () => {
    const { results, ok } = checkArticles('- 根拠: ' + name + rest);
    assert.equal(results.length, 1);
    assert.equal(results[0].status, '確かめられない');
    assert.match(results[0].reason, /この道具が取り込んでいない法令/);
    assert.doesNotMatch(results[0].reason, /法令名が書かれていない/);
    assert.equal(results[0].label, '(取り込んでいない法令) ' + rest.trim());
    assert.equal(ok, false);
  });
}

test('(a) 返事の文に、取り込んでいない法令名を写さない(指摘の文を返事に入れない)', () => {
  const text = UNTAKEN.map(([name, rest]) => '- 根拠: ' + name + rest).join('\n');
  const reply = formatResults(checkArticles(text));
  for (const w of ['労働安全衛生', '民法', '建築基準', '景観', '架空', '再資源化', '施行令', '環境基本', 'PFI']) assert.equal(reply.includes(w), false, w);
  assert.equal(reply.split('\n').at(-1), `条番号 ${UNTAKEN.length} 件: ある 0・無い 0・確かめられない ${UNTAKEN.length}`);
});

test('(a) 法令名の無い書き方は今までどおり「法令名が書かれていない」(法・令だけ、同法・施行令だけ、前の語が助詞のもの)', () => {
  for (const s of [
    '法第26条第1項', '第26条', '同法第26条', '令第27条', '施行令第27条', '同法施行令第27条', '法施行規則第14条の2',
    'この法律第3条', '同規則第14条の2', '台帳が無いので法第24条の8に当たるおそれ', 'これは施行令第27条の工事',
    '台帳を作るため法第24条の8', '額を超えれば施行令第27条', '置くべき令第7条の4',
  ]) {
    const { results, ok } = checkArticles('- 根拠: ' + s);
    assert.equal(results.length, 1, s);
    assert.equal(results[0].status, '確かめられない', s);
    assert.match(results[0].reason, /法令名が書かれていない/, s);
    assert.match(results[0].label, /^\(法令名なし\) /, s);
    assert.equal(ok, false, s);
  }
});

test('(a) 助詞のすぐ後の素の「規則」「条例」「政令」は名前でなく「法令名が書かれていない」。動詞で終わる「…に関する条例」などは名前で「取り込んでいない法令」', () => {
  for (const s of ['根拠は規則第14条の2', '根拠が条例第3条', '市の条例第3条', '上記の規則第3条', '法や規則第3条', 'これは政令第2条', '法と規則第3条', '台帳を規則第14条の2で']) {
    const { results } = checkArticles('- 根拠: ' + s);
    assert.equal(results.length, 1, s);
    assert.equal(results[0].status, '確かめられない', s);
    assert.match(results[0].reason, /法令名が書かれていない/, s);
  }
  for (const s of ['架空町の景観に関する条例第3条', '架空県の工事の手続を定める規則第2条', '架空工事の特例に関する政令第4条', '架空の工事の確保等に関する法律第5条']) {
    const { results } = checkArticles('- 根拠: ' + s);
    assert.equal(results.length, 1, s);
    assert.equal(results[0].status, '確かめられない', s);
    assert.match(results[0].reason, /この道具が取り込んでいない法令/, s);
  }
});

test('(b) 「建設業法第24条の8及び第26条」は2つとも建設業法の条として ある', () => {
  const checked = checkArticles('- 根拠: 建設業法第24条の8及び第26条');
  assert.deepEqual(checked.results.map((r) => [r.label, r.status]), [['建設業法 第24条の8', 'ある'], ['建設業法 第26条', 'ある']]);
  assert.equal(checked.ok, true);
});

test('(b) 「建設業法第24条の8及び第24条の7」は 第24条の8 が ある、第24条の7 は建設業法の取り込んでいない条として 無い', () => {
  const { results, ok } = checkArticles('- 根拠: 建設業法第24条の8及び第24条の7');
  assert.deepEqual(results.map((r) => [r.label, r.status]), [['建設業法 第24条の8', 'ある'], ['建設業法 第24条の7', '無い']]);
  assert.match(results[1].reason, /取得した原文に無い条/);
  assert.equal(ok, false);
});

test('(b) 並びに・読点のあと・続けて並べた条・抜き書きを挟んだ条も、同じ行の直前の法令名を引き継ぐ', () => {
  assert.deepEqual(rows('建設業法第26条第1項及び第2項並びに第24条の8'), [['建設業法 第26条第1項', 'ある'], ['建設業法 第24条の8', 'ある']]);
  assert.deepEqual(rows('建設業法施行令第2条、第7条の4'), [['建設業法施行令 第2条', 'ある'], ['建設業法施行令 第7条の4', 'ある']]);
  assert.deepEqual(rows('建設業法第3条、第24条の8及び第26条'), [['建設業法 第3条', 'ある'], ['建設業法 第24条の8', 'ある'], ['建設業法 第26条', 'ある']]);
  assert.deepEqual(rows('建設業法第24条の8第1項「施工体制台帳」、第26条第1項「主任技術者」'), [['建設業法 第24条の8第1項', 'ある'], ['建設業法 第26条第1項', 'ある']]);
  assert.deepEqual(rows('建設業法第24条の8及び　第26条'), [['建設業法 第24条の8', 'ある'], ['建設業法 第26条', 'ある']]);
});

test('(b) 引き継ぐのは直前の条番号の法令名のまま: 取り込んでいない法令は取り込んでいない法令、法令名の無い条は無いまま', () => {
  const untaken = checkArticles('- 根拠: 労働安全衛生法第88条及び第89条').results;
  assert.deepEqual(untaken.map((r) => [r.label, r.status]), [['(取り込んでいない法令) 第88条', '確かめられない'], ['(取り込んでいない法令) 第89条', '確かめられない']]);
  for (const r of untaken) assert.match(r.reason, /この道具が取り込んでいない法令/);
  const bare = checkArticles('- 根拠: 法第26条及び第27条').results;
  assert.deepEqual(bare.map((r) => [r.label, r.status]), [['(法令名なし) 第26条', '確かめられない'], ['(法令名なし) 第27条', '確かめられない']]);
  for (const r of bare) assert.match(r.reason, /法令名が書かれていない/);
});

test('(b) 「法第」「同法第」は引き継がない(今までどおり)', () => {
  const { results } = checkArticles('- 根拠: 建設業法第19条「契約の書面に書くこと」、法第24条の8');
  assert.deepEqual(results.map((r) => [r.label, r.status]), [['建設業法 第19条', '無い'], ['(法令名なし) 第24条の8', '確かめられない']]);
  assert.match(results[1].reason, /法令名が書かれていない/);
  const same = checkArticles('- 根拠: 建設業法第3条及び同法第26条').results;
  assert.deepEqual(same.map((r) => [r.label, r.status]), [['建設業法 第3条', 'ある'], ['(法令名なし) 第26条', '確かめられない']]);
  assert.match(same[1].reason, /法令名が書かれていない/);
});

test('(b) 及び・並びに・読点のほかのつなぎの語では引き継がない', () => {
  for (const c of ['又は', '若しくは', 'と', '・']) {
    assert.deepEqual(rows('建設業法第24条の8' + c + '第26条'), [['建設業法 第24条の8', 'ある'], ['(法令名なし) 第26条', '確かめられない']], c);
  }
});

test('(b) 行をまたいでは引き継がない(別の行・JSON の別の文字列の条番号から引き継がない)', () => {
  assert.deepEqual(rows('- 根拠: 建設業法第24条の8第1項\n- どう見えたか: 台帳が無い、第26条の欄も空'), [['建設業法 第24条の8第1項', 'ある'], ['(法令名なし) 第26条', '確かめられない']]);
  assert.deepEqual(rows('建設業法第24条の8及び\n第26条'), [['建設業法 第24条の8', 'ある'], ['(法令名なし) 第26条', '確かめられない']]);
  const json = JSON.stringify({ findings: [{ basis: '建設業法第24条の8第1項' }, { basis: '及び第26条第3項' }] });
  assert.deepEqual(rows(json), [['建設業法 第24条の8第1項', 'ある'], ['(法令名なし) 第26条第3項', '確かめられない']]);
});

test('今までどおり: 「建設業法施行令第27条」は ある', () => {
  assert.deepEqual(rows('- 根拠: 建設業法施行令第27条'), [['建設業法施行令 第27条', 'ある']]);
});

test('道具 check_articles の返事の形は変えない(条番号ごとの3つの欄の行と数の行。formatResults と同じ文)', async () => {
  const text = '- 根拠: 労働安全衛生法第88条第1項\n- 根拠: 建設業法第24条の8及び第26条';
  const r = await handleMessage({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'check_articles', arguments: { text } } }, { root: ROOT });
  assert.equal(r.error, undefined);
  assert.equal(r.result.isError, false);
  assert.deepEqual(r.result.content, [{ type: 'text', text: formatResults(checkArticles(text)) }]);
  const lines = r.result.content[0].text.split('\n');
  assert.deepEqual(lines.slice(0, -1).map((l) => l.split('\t').length), [3, 3, 3]);
  assert.equal(lines.at(-1), '条番号 3 件: ある 2・無い 0・確かめられない 1');
  assert.equal(r.result.content[0].text.includes('労働安全衛生'), false);
});

test('採点(score.mjs): 引き継いだ条は正しい方に、取り込んでいない法令の条は確かめられないに数え、欄の名前は変えない', () => {
  const E1 = loadCase(path.join(ROOT, 'plugin', 'evals', 'cases', 'E1_しおかぜ町下水道'));
  const listed = scoreCase(E1, '- 根拠: 建設業法第24条の8第1項及び第26条第1項');
  assert.deepEqual(listed.criteria['article-accuracy'], { refs: 2, ok: 2, rate: 100 });
  const untaken = scoreCase(E1, '- 根拠: 労働安全衛生法第88条第1項');
  assert.deepEqual(untaken.criteria['article-accuracy'], { refs: 1, ok: 0, rate: 0 });
  assert.equal(untaken.refs[0].status, '確かめられない');
  assert.match(untaken.refs[0].reason, /この道具が取り込んでいない法令/);
  assert.deepEqual(Object.keys(untaken.criteria), Object.keys(listed.criteria));
});

test('rubric.json: 条番号の正しさの文に「取り込んでいない法令」を添え、採点の種類の名前は変えない', () => {
  assert.deepEqual(Object.keys(RUBRIC.kinds), ['miss-rate', 'article-accuracy', 'quote-accuracy']);
  const how = RUBRIC.kinds['article-accuracy'].how;
  assert.match(how, /法令名の無い書き方/);
  assert.match(how, /取り込んでいない法令/);
});

test('critic.md の「残っていること」に件20 の行と、直していない書き方がある', () => {
  const critic = fs.readFileSync(path.join(ROOT, 'docs', 'critic.md'), 'utf8');
  const rest = critic.slice(critic.lastIndexOf('残っていること:'), critic.indexOf('## 問題が無かった所'));
  const line = rest.split('\n').find((l) => l.startsWith('- ') && l.includes('件20'));
  assert.ok(line, '件20 の行が無い');
  assert.match(line, /直した/);
  assert.match(line, /F81c/);
  assert.match(line, /law-names\.test\.mjs/);
  assert.match(rest.slice(rest.indexOf(line)), /直していない/);
});

// 足した見分けは条番号の前の短い所だけを見る。長い1行で固まらない(vm の timeout で止める)
for (const [name, long] of [
  ['名前の字の長い並びの後の条番号', 'あ'.repeat(100000) + '法第1条'],
  ['漢字の長い並びの後の条番号', '漢'.repeat(100000) + '令第1条'],
  ['空白の長い並びの後の条番号', '建設業法第3条及び' + '　'.repeat(100000) + '第26条'],
  ['読点と条番号の長い繰り返し', '建設業法第3条' + '、第26条'.repeat(20000)],
  ['行をまたぐ長い繰り返し', ('建設業法第3条' + 'あ'.repeat(50) + '\n、第26条').repeat(5000)],
]) {
  test(`長い1行: ${name} で固まらない`, () => {
    const start = performance.now();
    vm.runInNewContext('fn()', { fn: () => checkArticles(long) }, { timeout: 10000 });
    assert.ok(performance.now() - start <= 3000, String(performance.now() - start));
  });
}

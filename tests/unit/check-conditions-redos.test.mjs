// F83b5 の単体の試験: 公告の照合が、長い1行で固まらないこと(CWE-1333)と、拾う値が変わらないこと。
// 正規表現の照合は同期で走り node:test の timeout では止まらないので、CLI の関数は vm の timeout(10秒)で打ち切る。
// MCP は await を挟むので vm に入らない。同じ関数を呼ぶので、CLI の関数が通った後にだけ流す(固まる版で試験全体を止めないため)。
// 本物のサーバーの確かめは統括が行う(verify の [統括])。公告の文は架空。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { handleMessage } from '../../integration/claude-code/mcp/masked-files.mjs';
import { checkConditions, eraConflicts, parseAmounts } from '../../plugin/skills/bid-intake/scripts/check-conditions.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const STOP_MS = 10000;
const LIMIT_MS = 2000;

const SITE = '工事場所: 架空県こころみ町 地内';
const PERIOD = '工期: 令和9年4月1日から令和9年11月30日まで';
const BUDGET = '予定価格: 金 82,500,000円(消費税及び地方消費税の額を含む)';
const data = (site, period, budget) => ({
  conditions: [
    { key: 'site', value: '架空県こころみ町 地内', quote: site },
    { key: 'period', value: '令和9年4月1日から令和9年11月30日まで', quote: period },
    { key: 'budget', value: '82,500,000円', quote: budget },
  ],
});

const SPACES = ' '.repeat(10000);
const MANY_SPACES = ' '.repeat(100000);
const LONG_LINES = [
  // 受け入れ条件の6つ
  ['「一」10万字の1行', '一'.repeat(100000)],
  ['「工事場所」+空白1万個+a+CR+b', `工事場所${SPACES}a\rb`],
  ['「工事場所」+空白1万個+a+U+2028+b', `工事場所${SPACES}a\u2028b`],
  ['「令和」+空白1万個', `令和${SPACES}`],
  ['数字と読点の10万字', '1,'.repeat(50000)],
  ['「億」10万字', '億'.repeat(100000)],
  // 同じ形の残り。読み直しになる所を1つずつ
  ['本文の途中の空白1万個', `工事場所 a${SPACES}b`],
  ['見出しの語の後の空白と縦棒', `工事場所${' |'.repeat(5000)}a\rb`],
  ['空白10万字だけ', MANY_SPACES],
  ['数字+空白10万字', `1${MANY_SPACES}`],
  ['漢数字+空白10万字', `一${MANY_SPACES}`],
  ['「一億」+空白10万字', `一億${MANY_SPACES}`],
  ['「一万」+空白10万字', `一万${MANY_SPACES}`],
  ['「単位」+空白10万字', `単位${MANY_SPACES}`],
  ['元号と西暦+空白10万字', `令和1年(2019${MANY_SPACES}`],
  ['漢数字と空白の繰り返し', '一 '.repeat(50000)],
];

// 同期の処理を 10秒で打ち切る。かかった時間を返す
function timed(fn) {
  const start = performance.now();
  vm.runInNewContext('fn()', { fn }, { timeout: STOP_MS });
  return performance.now() - start;
}

function work(t, text) {
  fs.mkdirSync(path.join(ROOT, 'tmp'), { recursive: true });
  const dir = fs.mkdtempSync(path.join(ROOT, 'tmp', 'f83b5-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, '公告'));
  fs.writeFileSync(path.join(dir, '公告', 'a.txt'), text);
  return dir;
}

for (const [name, long] of LONG_LINES) {
  test(`${name}: CLI の関数と MCP の check_conditions が 2秒以内に返る`, { timeout: STOP_MS * 3 }, async (t) => {
    const text = [SITE, PERIOD, BUDGET, long, ''].join('\n');
    const d = data(SITE, PERIOD, BUDGET);
    let r;
    assert.ok(timed(() => { r = checkConditions(d, [{ file: 'a.txt', text }]); }) <= LIMIT_MS, 'CLI の関数');
    assert.equal(r.removed.length, 0);

    // 抜き書きの字数の上限が無い CLI の関数は、長い行そのものを抜き書きにできる。3つの欄の行に付けて通す
    const [site, period, budget] = [SITE, PERIOD, BUDGET].map((line) => line + long);
    const tail = [site, period, budget, ''].join('\n');
    assert.ok(timed(() => { checkConditions(data(site, period, budget), [{ file: 'a.txt', text: tail }]); }) <= LIMIT_MS, '抜き書きが長い形');

    const root = work(t, text);
    const start = performance.now();
    const res = await handleMessage({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'check_conditions', arguments: { data: JSON.stringify(d), files: ['公告/a.txt'] } } }, { root });
    assert.ok(performance.now() - start <= LIMIT_MS, 'MCP の check_conditions');
    assert.notEqual(res.result.isError, true, res.result.content[0].text);
  });
}

const amounts = (s) => parseAmounts(s).map((a) => [a.raw, a.yen]);

test('額: 拾う額は今と同じ', () => {
  assert.deepEqual(amounts('金 82,500,000円'), [['82,500,000円', 82500000]]);
  assert.deepEqual(amounts('1億 2,000 万 3,000 円'), [['1億 2,000 万 3,000 円', 120003000]]);
  assert.deepEqual(amounts('一億円'), [['一億円', 1e8]]);
  assert.deepEqual(amounts('1.2億 円'), [['1.2億 円', 1.2e8]]);
  assert.deepEqual(amounts('12億3 456万円'), [['456万円', 4560000]]);
  assert.deepEqual(amounts('3千万 円と 500 円'), [['3千万 円', 3e7], ['500 円', 500]]);
  assert.deepEqual(amounts('単位: 千円 3 円滑に 120 円形'), []);
  assert.deepEqual(amounts('1万 円滑に'), []);
});

test('額: 並びは 40字まで読み、超えた並びは途中からも読まない', () => {
  const run = '1'.repeat(40);
  assert.equal(amounts(run + '円')[0][0], run + '円');
  assert.deepEqual(amounts('1' + run + '円'), []);
  assert.deepEqual(amounts('1' + run + '万円'), []);
  assert.deepEqual(amounts('1' + run + '億円'), []);
  assert.deepEqual(amounts(`${'1,'.repeat(21)}1円 500円`), [['500円', 500]]);
});

const flagsOf = (key, value, quote, text) => checkConditions({ conditions: [{ key, value, quote }] }, [{ file: 'a.txt', text }]).rows.find((r) => r.key === key).flags;

for (const [name, cut] of [['CR', '\r'], ['LF', '\n'], ['CRLF', '\r\n'], ['U+2028', '\u2028'], ['U+2029', '\u2029']]) {
  test(`見出しの行: ${name} で切ってから見る`, () => {
    const quote = '工事場所: 架空県こころみ町';
    assert.deepEqual(flagsOf('site', '架空県こころみ町', quote, `${quote}${cut}工事場所: 架空市 ためし${cut}メモ`), ['a.txt 2行目 は「架空市 ためし」で、値と違う']);
  });
}

test('見出しの行: 語の後の形と、本文の末尾の空白と縦棒', () => {
  const body = (line) => flagsOf('site', '架空県こころみ町', '工事場所: 架空県こころみ町', `工事場所: 架空県こころみ町\n${line}\n`);
  for (const line of ['工事場所: 架空市', '工事場所:架空市 | |　', '| 工事場所 | 架空市 |', '| 工事場所 || 架空市 | ', '工事場所　架空市', '工事場所 　 架空市', '2 工事場所 架空市', '(2) 工事場所 : 架空市']) {
    assert.deepEqual(body(line), ['a.txt 2行目 は「架空市」で、値と違う'], line);
  }
  assert.deepEqual(body('工事場所 | a | b |'), ['a.txt 2行目 は「a | b」で、値と違う']);
  assert.deepEqual(body('工事場所::架空市'), ['a.txt 2行目 は「:架空市」で、値と違う']);
  // 本文の無い行は、今までの読み方のまま
  assert.deepEqual(body('| 工事場所 | |'), ['a.txt 2行目 は「|」で、値と違う']);
  assert.deepEqual(body('工事場所 :'), ['a.txt 2行目 は「:」で、値と違う']);
  for (const line of ['工事場所', '工事場所:', '工事場所 ', '工事場所  ', '工事場所は架空市']) assert.deepEqual(body(line), [], line);
});

test('1行が 2,000字を超える所は、見出しと日付の拾いに先頭 2,000字だけを使う', () => {
  const quote = '工期: 令和9年4月1日から令和9年11月30日まで';
  const line = (fill) => `工期: ${'あ'.repeat(fill)}令和9年5月1日から令和9年11月30日まで`;
  const period = (l) => flagsOf('period', '令和9年4月1日から令和9年11月30日まで', quote, `${quote}\n${l}\n`).filter((f) => f.startsWith('a.txt 2行目'));
  assert.equal(period(line(10)).length, 1, '先頭の 2,000字の中の日付は見る');
  assert.equal(period(line(1988)).length, 1, '2,000字ちょうどに収まる日付は見る');
  assert.equal(period(line(1989)).length, 0, '2,000字に収まらない日付は見ない');

  const era = (fill) => eraConflicts([{ file: 'a.txt', text: `${'あ'.repeat(fill)}令和9年(2030年)\n` }]);
  assert.equal(era(10).length, 1);
  assert.equal(era(1989).length, 1, '2,000字ちょうどに収まる');
  assert.equal(era(1990).length, 0);
});

test('元号と西暦: 拾う形は今と同じ', () => {
  const era = (s) => eraConflicts([{ file: 'a.txt', text: s }]).length;
  for (const s of ['令和九年(2030年)', '令和9年(2030)', '令和 9 年 ( 2030 年 )', '令和9年(2030 )']) assert.equal(era(s), 1, s);
  assert.equal(era('令和9年(2027年)'), 0);
});

// F83a3: 「要る」の項目のカードに、折りたたみを開かずに読める「次にすること」の1行を出す
// 文は判定の note の語句だけで作る。note の枝は手で写さず、ここで bidCheck に入力を変えて呼んで集める
// この環境にはブラウザが無いので、見た目は測れない。組み立てた画面の文と、本物の判定の結果で確かめる
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildHtml } from '../../build.mjs';
import { bidCheck } from '../../src/bid-check.mjs';
import { SAMPLE } from '../../src/sample.mjs';
import { readBidForm } from '../../src/ui/form.mjs';
import { NEXT_STEPS, nextStepText, stepKey } from '../../src/ui/next-steps.mjs';
import { bidItemId, renderBidResult } from '../../src/ui/view.mjs';
import { runPage } from '../acceptance/_helpers.mjs';

const CHECK_END = 'があるかを確かめる';
const HAS_EXCEPTION = '(例外あり)';
const TAIL = '当てはまるかは「根拠を見る」で確かめてください。';
const MIN_CHUNK = 4;
const MAX_LENGTH = 40;
const length = (s) => [...s].length;

// 判定を分ける欄の値。金額は境目(5千万・8千万・4千5百万・9千万)の下と、境目ちょうどと、どちらの境目も越える額
const OPTIONS = {
  orderer: ['public', 'private'],
  direct: [true, false],
  workType: ['kenchiku-ikkatsu', 'other'],
  hasSubcontract: [true, false],
  subcontractTotal: [10_000_000, 50_000_000, 80_000_000],
  contractAmount: [10_000_000, 45_000_000, 90_000_000],
  license: ['tokutei', 'ippan'],
  ictMeasure: [true, false, undefined],
};
const INPUTS = Object.entries(OPTIONS).reduce(
  (list, [name, values]) => list.flatMap((x) => values.map((v) => (v === undefined ? x : { ...x, [name]: v }))),
  [{}],
);

// 文の key(監理技術者か主任技術者かは key + 値)→ 判定が「要る」のときに出す note のすべて
const NOTES = new Map();
const REQUIRED = [];
for (const input of INPUTS) {
  for (const it of bidCheck(input).items) {
    if (it.status !== 'required') continue;
    const k = stepKey(it);
    if (!NOTES.has(k)) NOTES.set(k, new Set());
    if (!NOTES.get(k).has(it.note)) REQUIRED.push(it);
    NOTES.get(k).add(it.note);
  }
}

// 文を左から、note の中にそのままある一番長い塊に切る。切れなければ null
function chunksIn(sentence, note) {
  const chunks = [];
  let rest = sentence;
  while (rest) {
    let n = rest.length;
    while (n > 0 && !note.includes(rest.slice(0, n))) n -= 1;
    if (n === 0) return null;
    chunks.push(rest.slice(0, n));
    rest = rest.slice(n);
  }
  return chunks;
}
const body = (text) => (text.endsWith(CHECK_END) ? text.slice(0, -CHECK_END.length) : text);
// 1つの note の語句だけで、4字以上の塊に切って文を作れるか(別の枝の語句を継ぎ足していないか)
const madeFrom = (text, note) => {
  const chunks = chunksIn(body(text), note);
  return Boolean(chunks) && chunks.every((c) => length(c) >= MIN_CHUNK);
};

test('要るになる枝をすべて集めた: 表の key と枝の key が同じで、枝の数が変われば文を見直す', () => {
  assert.deepEqual([...NOTES.keys()].sort(), Object.keys(NEXT_STEPS).sort());
  assert.deepEqual(Object.fromEntries([...NOTES].map(([k, set]) => [k, set.size])), {
    'tokutei-license': 2,
    taicho: 5,
    'taicho-copy': 1,
    'engineer:kanri': 4,
    'engineer:shunin': 1,
    taikeizu: 2,
    dedicated: 2,
  });
  // 文の後ろの「根拠を見る」が指す折りたたみが、どの枝にもある
  for (const it of REQUIRED) assert.ok(it.basis.length > 0, it.key + ' に根拠が無い');
});

test('各文は、その key の note の1つの語句を4字以上の塊でそのまま使う(「があるかを確かめる」を除く)', () => {
  for (const [key, text] of Object.entries(NEXT_STEPS)) {
    assert.ok(body(text).length > 0, key);
    assert.ok([...NOTES.get(key)].some((note) => madeFrom(text, note)), key + ': ' + text);
  }
});

test('文はその key のどの枝でも本当: どの note の語句でも同じ文を作れる', () => {
  for (const [key, notes] of NOTES) {
    for (const note of notes) {
      // 台帳を作ることは決まっていて、写しの措置の入力だけが足りない枝。note は写しの話だけなので語句が無い
      if (key === 'taicho' && note.startsWith('写しの提出が要るかは判断できません')) continue;
      assert.ok(madeFrom(NEXT_STEPS[key], note), key + ': ' + note);
    }
  }
});

test('「があるかを確かめる」で結ぶのは、note が名詞で終わる行だけ', () => {
  for (const [key, notes] of NOTES) {
    const noun = [...notes].every((n) => /(?:区分|専任)$/.test(n));
    assert.equal(NEXT_STEPS[key].endsWith(CHECK_END), noun, key);
  }
  assert.equal(Object.values(NEXT_STEPS).filter((t) => t.endsWith(CHECK_END)).length, 2);
});

test('文に数字・期限・「提出」・括弧が無く、句点は画面の側で足す', () => {
  for (const [key, text] of Object.entries(NEXT_STEPS)) {
    assert.doesNotMatch(text, /[0-9０-９〇一二三四五六七八九十百千万億]/, key);
    assert.doesNotMatch(text, /日以内|提出/, key);
    assert.doesNotMatch(text, /[()（）「」『』【】［］[\]]/, key);
    assert.doesNotMatch(text, /。/, key);
  }
});

test('文は「(例外あり)」を足しても40字以下', () => {
  for (const it of REQUIRED) assert.ok(length(nextStepText(it)) <= MAX_LENGTH, nextStepText(it));
  for (const [key, text] of Object.entries(NEXT_STEPS)) assert.ok(length(text + HAS_EXCEPTION) <= MAX_LENGTH, key);
});

test('例外があるか、note に「ただし」「を除き」「この限りでない」があれば「(例外あり)」', () => {
  const item = (exceptions, note = '') => ({ key: 'taicho', exceptions, note });
  assert.equal(nextStepText(item(['x'])), NEXT_STEPS.taicho + HAS_EXCEPTION);
  assert.equal(nextStepText(item([])), NEXT_STEPS.taicho);
  assert.equal(nextStepText({ key: 'taicho' }), NEXT_STEPS.taicho);
  for (const word of ['ただし', 'を除き', 'この限りでない']) {
    assert.equal(nextStepText(item([], '前の文。' + word + '後の文')), NEXT_STEPS.taicho + HAS_EXCEPTION, word);
  }
  for (const it of REQUIRED) {
    assert.ok(it.exceptions.length > 0, it.key);
    assert.equal(nextStepText(it), NEXT_STEPS[stepKey(it)] + HAS_EXCEPTION, it.key);
  }
});

test('表に無い key・値には文が無い(Object のもとからある名前を文と取り違えない)', () => {
  for (const it of [{ key: 'no-such' }, { key: 'constructor' }, { key: 'toString' }, { key: '__proto__' }, { key: 'engineer' }, { key: 'engineer', value: 'unknown' }]) {
    assert.equal(nextStepText({ ...it, exceptions: ['x'] }), null, JSON.stringify(it));
  }
  const out = renderBidResult({ items: [{ key: 'no-such', label: 'いる', status: 'required', basis: [] }, { key: 'constructor', label: 'いる2', status: 'required', basis: [] }], checks: [] });
  assert.ok(out.includes('いる2') && !out.includes('item-next'), out);
});

const cards = (html) => [...html.matchAll(/<li class="item status-(\w+)" id="([^"]+)">([\s\S]*?<\/details>)<\/li>/g)]
  .map((m) => ({ status: m[1], id: m[2], html: m[3] }));
const lineOf = (it) => '<p class="item-next">次にすること: ' + nextStepText(it) + '。<span class="item-next-note print-inline">' + TAIL + '</span></p>';

test('見本の要る6項目: どのカードも h4 の直下、折りたたみより前に1行', () => {
  const bid = bidCheck(readBidForm(SAMPLE.form));
  const list = cards(renderBidResult(bid, SAMPLE.form));
  assert.equal(list.length, 6);
  assert.equal(bid.items.filter((it) => it.status === 'required').length, 6);
  for (const it of bid.items) {
    const card = list.find((c) => c.id === bidItemId(it.key));
    assert.ok(card.html.includes('</h4>' + lineOf(it)), card.html.slice(0, 400));
    assert.ok(card.html.indexOf(lineOf(it)) < card.html.indexOf('<details'), it.key);
    assert.equal(card.html.split('class="item-next"').length - 1, 1, it.key);
    assert.match(card.html, /<details class="basis"><summary>根拠を見る: /);
  }
});

test('確認が要る点の知らせは、次にすることの下に残る', () => {
  const bid = bidCheck(readBidForm(SAMPLE.form));
  const dedicated = cards(renderBidResult(bid, SAMPLE.form)).find((c) => c.id === bidItemId('dedicated'));
  const [next, depends, details] = ['item-next', 'item-depends', '<details'].map((s) => dedicated.html.indexOf(s));
  assert.ok(next >= 0 && next < depends && depends < details, dedicated.html.slice(0, 400));
});

test('監理技術者か主任技術者かは判定の値で分ける', () => {
  const input = { orderer: 'public', direct: true, workType: 'other', hasSubcontract: true, subcontractTotal: 50_000_000, contractAmount: 100_000_000, license: 'tokutei', ictMeasure: false };
  const engineerCard = (x) => {
    const bid = bidCheck(x);
    return cards(renderBidResult(bid)).find((c) => c.id === bidItemId('engineer')).html;
  };
  const kanri = engineerCard(input);
  assert.ok(kanri.includes('次にすること: ' + NEXT_STEPS['engineer:kanri'] + HAS_EXCEPTION + '。') && !kanri.includes(NEXT_STEPS['engineer:shunin']), kanri.slice(0, 300));
  const shunin = engineerCard({ ...input, hasSubcontract: false });
  assert.ok(shunin.includes('次にすること: ' + NEXT_STEPS['engineer:shunin'] + HAS_EXCEPTION + '。') && !shunin.includes(NEXT_STEPS['engineer:kanri']), shunin.slice(0, 300));
});

test('すべての入力の組で、1行が出るのは「要る」の項目だけ', () => {
  const seen = new Set();
  for (const input of INPUTS) {
    const bid = bidCheck(input);
    const list = cards(renderBidResult(bid));
    assert.equal(list.length, bid.items.length);
    for (const c of list) {
      seen.add(c.status);
      const head = c.html.slice(0, c.html.indexOf('<details'));
      assert.equal(head.includes('item-next'), c.status === 'required', c.id + ' ' + c.status);
    }
  }
  assert.deepEqual([...seen].sort(), ['needs_check', 'not_required', 'required']);
});

test('未回答の項目にも出ない', () => {
  const list = cards(renderBidResult(bidCheck({}), {}));
  assert.ok(list.some((c) => c.status === 'unanswered'), list.map((c) => c.status).join(','));
  assert.ok(list.every((c) => !c.html.includes('item-next')));
});

test('組み立てた画面: 見本の結果に全文が出る', async () => {
  const page = runPage(buildHtml());
  await page.click('sample-load');
  await page.click('confirm-go');
  const lines = [...page.el('bid-result').innerHTML.matchAll(/<p class="item-next">([\s\S]*?)<\/p>/g)].map((m) => m[1].replace(/<[^>]+>/g, ''));
  assert.deepEqual(lines, [
    '特定建設業の許可があるかを確かめる',
    '施工体制台帳を作り、工事現場ごとに備え置く',
    '作った施工体制台帳の写しを発注者に出す',
    '監理技術者を置く',
    '施工体系図を作り、見やすい場所に掲げる',
    '国又は地方公共団体が注文者に当たるものとして専任があるかを確かめる',
  ].map((s) => '次にすること: ' + s + HAS_EXCEPTION + '。' + TAIL));
});

test('後ろの決まった文は補足の色で分け、字は 16px より小さくしない', () => {
  const html = buildHtml();
  assert.match(html, /\.item-next \{ margin: 0\.25rem 0; \}/);
  assert.match(html, /\.item-next-note \{ color: var\(--ink-2\); \}/);
  assert.doesNotMatch(html, /\.item-next[^{}]*\{[^{}]*font-size/);
});

test('設計の文書: カードで見える物の書き方を直した', () => {
  const design = fs.readFileSync(new URL('../../docs/design.md', import.meta.url), 'utf8');
  assert.ok(design.includes('見えるのは結論の札と名前と、要るの項目だけ次にすることの1行'));
  assert.ok(!design.includes('見えるのは結論の札と名前だけ'));
});

// F62a の単体の試験: 「次にすること」の元請けの実績、専任の確認の文と根拠、安全の問いの呼び方、README の手順。
// 岡山労働局の公告の条件の形(公告の文の抜き書きだけ)は、組み立てた画面をボタンの順に動かして確かめる
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { bidCheck, dedicatedThreshold } from '../../src/bid-check.mjs';
import { judgeTaicho } from '../../src/taicho.mjs';
import { bidCheckRows, stage1Rows, toCsv } from '../../src/export.mjs';
import { readBidForm } from '../../src/ui/form.mjs';
import { needsCheckPoints } from '../../src/ui/answers.mjs';
import { renderBidResult, renderOpenItems, renderResultTop } from '../../src/ui/view.mjs';
import { stage1Line } from '../../src/ui/safety-view.mjs';
import { SAMPLE } from '../../src/sample.mjs';
import { buildHtml } from '../../build.mjs';
import { runPage } from '../acceptance/_helpers.mjs';

const read = (p) => fs.readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const html = buildHtml();

const PRIME_TITLE = '次にすること: 元請けとしての施工実績が参加の条件です';
const PRIME_SUB = '公告の抜き書きを確かめ、認められる実績の範囲を発注者の公告と説明書で確かめてください。';
const FIRST = '（４）平成２２年度以降に元請けとして完成・引き渡しが完了した以下の要件を満たす同種工事の施工実績を有すること。';
const OKAYAMA = JSON.stringify({
  kind: 'bid-intake',
  source: { title: '改修工事 入札公告' },
  form: { orderer: 'public', 'work-type': 'kenchiku-ikkatsu' },
  formSkipped: [{ id: 'contract-amount', label: '請負代金の見込み', reason: '確かめが要る' }],
  companyFields: [
    { id: 'direct', label: '元請けか下請けか', reason: '自社がどの立場で入るかは公告に書いていない' },
    { id: 'subcontract-total', label: '下請けの総額', reason: '会社が決める額' },
    { id: 'license', label: '元請けの許可の種類', reason: '自社が持つ許可は公告に書いていない' },
    { id: 'engineer-qualification', label: '置ける技術者の資格', reason: '自社が置ける人は公告に書いていない' },
  ],
  rows: [
    { key: 'orderer-name', label: '発注者', status: '拾えた', quote: '労働局総務部長' },
    { key: 'work-class', label: '工事の種類', status: '拾えた', quote: '中国地域の「建築一式」のＣ等級又はＤ' },
    { key: 'past-work', label: '施工実績', status: '拾えた', quote: FIRST },
  ],
});
const nextText = (top) => {
  const part = (cls) => top.match(new RegExp('<p class="' + cls + '">([\\s\\S]*?)</p>'))[1];
  return { title: part('next-title'), sub: part('next-sub'), href: top.match(/class="next-go" href="#([\w-]+)"/)[1] };
};
async function okayamaPage() {
  const page = runPage(html);
  await page.click('entry-intake');
  page.el('intake-load').files = [{ size: OKAYAMA.length, text: async () => OKAYAMA }];
  await page.set('intake-load', '');
  return page;
}
async function toResult(page) {
  await page.click('bid-run');
  await page.click('confirm-go');
}

test('岡山の条件の形: 未回答が残っていても、次にすることは元請けの実績になる', async () => {
  const page = await okayamaPage();
  await toResult(page);
  const n = nextText(page.el('result-top').innerHTML);
  assert.equal(n.title, PRIME_TITLE);
  assert.equal(n.sub, PRIME_SUB);
  assert.equal(n.href, 'open-items');
  assert.match(page.el('open-items').innerHTML, /未回答\(5問\)/, '未回答は消さず一覧に残す');
  assert.ok(page.el('open-items').innerHTML.includes(FIRST), '飛び先に公告の抜き書きがある');
  assert.doesNotMatch(n.title + n.sub, /参加できない/, '言い切らない');
});

test('岡山の条件の形: 未回答に答えたあとも、専任の文ではなく元請けの実績のまま', async () => {
  const page = await okayamaPage();
  await page.set('direct', true);
  for (const [k, v] of Object.entries({ 'contract-amount': '150,000,000', 'subcontract-total': '30,000,000', license: 'tokutei', 'engineer-qualification': 'kanri' })) await page.set(k, v);
  await toResult(page);
  assert.match(page.el('open-items').innerHTML, /未回答\(0問\)/);
  assert.match(page.el('open-items').innerHTML, /技術者を専任で置く必要があるか/, '専任の点が先に並ぶ形で確かめる');
  assert.equal(nextText(page.el('result-top').innerHTML).title, PRIME_TITLE);
});

test('見本: 確認が要る点の件で、副題は1件目の名前で、専任の平らな文は飛び先に出る', async () => {
  const page = runPage(html);
  await page.click('sample-load');
  await page.click('confirm-go');
  const n = nextText(page.el('result-top').innerHTML);
  assert.equal(n.title, '次にすること: 確認が要る点 2件を確かめる');
  assert.equal(n.href, 'open-items');
  assert.equal(n.sub, '1件目: 技術者を専任で置く必要があるか');
  assert.match(page.el(n.href).innerHTML, /<strong>技術者を専任で置く必要があるか<\/strong>: 公告で、発注者が国か地方公共団体か/);
});

test('公告の文が無ければ、次にすることに元請けの実績は出ない', () => {
  const bid = bidCheck(readBidForm(SAMPLE.form));
  assert.ok(!renderResultTop({ bid, values: SAMPLE.form }).includes('元請けとしての施工実績'));
});

const ARTICLE = /第\s*[0-9０-９一二三四五六七八九十百]+\s*[条項号]|施行令|建設業法/;
const publicInput = (over = {}) => ({ orderer: 'public', direct: true, workType: 'other', contractAmount: dedicatedThreshold().other, hasSubcontract: false, subcontractTotal: 0, license: 'tokutei', engineerQualification: 'kanri', ...over });
const dedicatedCheck = (input) => bidCheck(input).checks.find((c) => c.key === 'dedicated');

test('専任の確認の文: 条番号が無く、言い切らず、誰に何を確かめるかを書く', () => {
  const c = dedicatedCheck(publicInput());
  assert.doesNotMatch(c.message, ARTICLE);
  assert.ok(!c.message.includes('このままでよい'));
  assert.ok(!c.message.includes('公団'), '今は無いものを書かない');
  for (const w of ['都道府県', '市区町村', '一部事務組合', '独立行政法人', '特殊法人', '地方公社', '工事の目的物', '確かめてください']) assert.ok(c.message.includes(w), w);
  assert.equal(c.changes, true, '「この要るは変わることがある」の印は残す');
});

test('専任の確認の根拠: 項目と同じ basis を持ち、公共の第1号を含む。民間の確認の文と形は変えない', () => {
  const out = bidCheck(publicInput());
  const c = out.checks.find((x) => x.key === 'dedicated');
  assert.deepEqual(c.basis, out.items.find((x) => x.key === 'dedicated').basis);
  assert.ok(c.basis.some((b) => b.quoteId === 'q-rei-27-1-1'));
  const priv = bidCheck(publicInput({ orderer: 'private' })).checks.find((x) => x.key === 'dedicated');
  assert.equal(priv.basis, undefined);
  assert.match(priv.message, /第27条第1項第3号/);
});

const VALUES = { ...SAMPLE.form };
test('確認が要る点の一覧: 文の下の閉じた折りたたみに条番号と抜き書きが出る。文そのものには条番号が無い', () => {
  const bid = bidCheck(readBidForm(VALUES));
  const quote = bid.items.find((x) => x.key === 'dedicated').basis.find((b) => b.quoteId === 'q-rei-27-1-1').quote;
  for (const out of [renderBidResult(bid, VALUES), renderOpenItems(bid, VALUES)]) {
    const m = out.match(/<ul class="(?:open-)?checks">([\s\S]*?)<\/ul><\/details><\/li>/);
    assert.ok(m, '確認が要る点の中に根拠の折りたたみが無い');
    assert.match(m[1], /<details class="basis"><summary>根拠を見る: [^<]*第27条/);
    assert.ok(m[1].includes(quote));
    assert.doesNotMatch(m[1].slice(0, m[1].indexOf('<details')), ARTICLE, '見える文に条番号');
  }
});

test('根拠の無い確認が要る点には、折りたたみも「根拠: 無し」も足さない。点の形は変えない', () => {
  const bid = { items: [], checks: [{ key: 'z', label: 'Z', message: 'm' }] };
  assert.deepEqual(needsCheckPoints(bid, {}), [{ label: 'Z', message: 'm', status: 'needs_check' }]);
  const out = renderOpenItems(bid, {});
  assert.ok(out.includes('<li><strong>Z</strong>: m</li>'));
  assert.ok(!out.includes('根拠'));
});

test('CSV: 確認が要る点の専任の行の根拠の列に、条番号と抜き書きが出る', () => {
  const bid = bidCheck(readBidForm(VALUES));
  const row = bidCheckRows(bid).find((r) => r[1] === '技術者を専任で置く必要があるか');
  assert.doesNotMatch(row[3], ARTICLE);
  assert.match(row[4], /第27条/);
  assert.ok(row[5].includes('国又は地方公共団体が注文者である施設又は工作物に関する建設工事'));
  assert.ok(row[6] !== '' && row[7] !== '', '取得日と版も出る');
  const csv = toCsv(stage1Rows(bid, judgeTaicho(readBidForm(VALUES))));
  assert.ok(csv.includes(row[3]));
});

test('安全の問いの2か所: 「段1」を出さず、段階の表示と同じ呼び方にする', async () => {
  assert.ok(stage1Line({ 'subcontract-total': '30,000,000' }, { subcontractTotal: 30_000_000 }).startsWith('「1 条件を入れる」の答え: 下請けの総額 30,000,000 円 → 使う。'));
  const page = runPage(html);
  await page.click('sample-load');
  await page.click('confirm-go');
  const out = page.el('safety-stage1').innerHTML;
  assert.ok(!out.includes('段1'), out);
  assert.ok(out.includes('「1 条件を入れる」の答え:'));
  assert.ok(out.includes('<a href="#subcontract-total">「1 条件を入れる」で直す</a>'));
});

test('F54d の『段1「条件を入れる」』の文は変えていない', () => {
  assert.equal(read('src/ui/app.mjs').split('段1「条件を入れる」').length - 1, 3);
});

test('README: 試し方1 は数字のカードと「次にすること」から、手順2 に確かめの画面と条件の変え方がある', () => {
  const lines = read('README.md').split('\n');
  const tryOut = lines[lines.indexOf('## 試し方') + 1];
  assert.ok(tryOut.includes('結果の一番上の数字のカードと「次にすること」から'));
  assert.ok(!tryOut.includes('「まとめ」の枠'));
  const step2 = lines.find((l) => l.startsWith('2. 入口の「まず見本で試す」を押す。'));
  assert.ok(step2.includes('確かめの画面で「この内容で結果を見る」'));
  assert.ok(step2.includes('上の「1 条件を入れる」を押して請負代金を変え、「確認する」'));
});

test('README の手順2 のとおりに押すと、請負代金を変えた結果が出る', async () => {
  const page = runPage(html);
  await page.click('sample-load');
  await page.click('confirm-go');
  const before = page.el('bid-result').innerHTML;
  await page.click('step-1');
  assert.equal(page.el('panel-1').hidden, false);
  await page.set('contract-amount', '40,000,000');
  await toResult(page);
  assert.notEqual(page.el('bid-result').innerHTML, before);
  assert.doesNotMatch(page.text('result-top'), /もう一度「確認する」を押す/);
});

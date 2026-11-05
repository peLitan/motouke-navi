// F52a の単体の試験: 公告から拾った条件のファイルを読み込み、結果まで進めたときの元請けの実績の知らせ。
// 岡山労働局の公告の条件の形を使う(公告の文の抜き書きだけで、会社や人の名前は含めない)。読み込みの部品ではなく、組み立てた画面をボタンの順に動かす
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { checkConditions } from '../../plugin/skills/bid-intake/scripts/check-conditions.mjs';
import { buildHtml } from '../../build.mjs';
import { runPage } from '../acceptance/_helpers.mjs';

const NOTICE = 'この工事は元請けとしての施工実績を参加の条件にしています';
const FIRST = '（４）平成２２年度以降に元請けとして完成・引き渡しが完了した以下の要件を満たす同種工事の施工実績を有すること。';
const QUOTE = FIRST + '\n      （共同企業体の構成員としての実績は、出資比率２０％以上の場合のものに限る。）なお、当該施工実績が厚生労働\n      省及び他省庁が発注した工事のうち５００万円を超える請負工事に係る施工実績にあっては、「工事成績評定表」の\n      評定点合計が６５点未満のものを除くこと。';
const COMPANY = [
  { id: 'direct', label: '元請けか下請けか', reason: '自社がどの立場で入るかは公告に書いていない' },
  { id: 'subcontract-total', label: '下請けの総額', reason: '会社が決める額' },
  { id: 'license', label: '元請けの許可の種類', reason: '自社が持つ許可は公告に書いていない' },
  { id: 'engineer-qualification', label: '置ける技術者の資格', reason: '自社が置ける人は公告に書いていない' },
];
const screenFile = (quote) => JSON.stringify({
  kind: 'bid-intake',
  source: { title: '改修工事 入札公告' },
  form: { orderer: 'public', 'work-type': 'kenchiku-ikkatsu' },
  formSkipped: [{ id: 'contract-amount', label: '請負代金の見込み', reason: '確かめが要る' }],
  companyFields: COMPANY,
  rows: [
    { key: 'orderer-name', label: '発注者', status: '拾えた', quote: '労働局総務部長' },
    { key: 'budget', label: '予定価格', status: '確かめが要る', quote: '', flags: ['書いていないとされたが、語がある'] },
    { key: 'work-class', label: '工事の種類', status: '拾えた', quote: '中国地域の「建築一式」のＣ等級又はＤ' },
    { key: 'past-work', label: '施工実績', status: '拾えた', quote },
  ],
});
const fileOf = (text) => ({ size: text.length, text: async () => text });
async function choose(page, file) {
  page.el('intake-load').files = [file];
  await page.set('intake-load', '');
}
async function startPage() {
  const page = runPage(buildHtml());
  await page.click('entry-intake');
  return page;
}
async function toResult(page) {
  await page.click('bid-run');
  await page.click('confirm-go');
}

test('岡山の条件の形: 会社側の欄が空のまま結果まで進むと、知らせの文と抜き書きが出る', async () => {
  const page = await startPage();
  await choose(page, fileOf(screenFile(QUOTE)));
  assert.equal(page.el('orderer').value, 'public');
  assert.equal(page.el('work-type').value, 'kenchiku-ikkatsu');
  assert.equal(page.el('direct').checked, false);
  await toResult(page);
  for (const id of ['bid-result', 'open-items']) {
    const html = page.el(id).innerHTML;
    assert.ok(html.includes(NOTICE), id + ' に知らせの文');
    assert.ok(html.includes(FIRST), id + ' に公告の抜き書き');
  }
  assert.match(page.el('open-items').innerHTML, /確認が要る点\(1件\)/);
  assert.match(page.el('open-items').innerHTML, /未回答\(5問\)/);
  assert.match(page.text('result-top').replace(/\s+/g, ' '), /! 1 確認が要る/);
  assert.ok(page.el('panel-2').hidden !== true, '結果の段が開いている');
});

test('読み終わる前に進んでも、読み終わってから結果を出す(知らせが落ちない)', async () => {
  const page = await startPage();
  let finish;
  const late = new Promise((r) => { finish = r; });
  await choose(page, { size: 10, text: () => late });
  await page.click('bid-run');
  await page.click('confirm-go');
  assert.equal(page.el('orderer').value, '', 'まだ読み終えていない');
  finish(screenFile(QUOTE));
  await new Promise((r) => { setTimeout(r, 5); });
  assert.equal(page.el('orderer').value, 'public');
  assert.ok(page.el('bid-result').innerHTML.includes(NOTICE));
  assert.ok(page.el('bid-result').innerHTML.includes(FIRST));
  assert.match(page.el('open-items').innerHTML, /未回答\(5問\)/);
  assert.ok(!/もう一度「確認する」を押す/.test(page.text('result-top')), '結果は読み込んだ条件のもの');
});

test('読み込みに失敗しても、押したボタンは止まらず、理由が出る', async () => {
  const page = await startPage();
  await choose(page, { size: 10, text: async () => { throw new Error('読めない'); } });
  assert.match(page.el('intake-status').textContent, /読み込めませんでした/);
  await toResult(page);
  assert.match(page.el('open-items').innerHTML, /未回答\(7問\)/);
  assert.ok(!page.el('bid-result').innerHTML.includes(NOTICE));
});

test('元請け・下請けを問わない実績の条件では出ない', async () => {
  for (const quote of ['（４）平成２２年度以降に元請け、下請けを問わず完成した同種工事の施工実績を有すること。', '（４）同種工事の施工実績を有すること(元請け又は下請けとしての実績)。']) {
    const page = await startPage();
    await choose(page, fileOf(screenFile(quote)));
    assert.equal(page.el('participation-conditions').value, quote, '文は欄に入る');
    await toResult(page);
    assert.ok(!/元請けの施工実績/.test(page.el('bid-result').innerHTML), quote);
    assert.ok(!/元請けの施工実績/.test(page.el('open-items').innerHTML), quote);
    assert.match(page.el('open-items').innerHTML, /確認が要る点\(0件\)/);
  }
});

test('bid-intake の照合の出力をそのまま読み込むと、実績の条件が入っていて知らせが出る', async () => {
  const text = '１ 工事概要\n（１）工事名 架空の改修工事\n２ 競争参加資格\n' + FIRST + '\n';
  const out = checkConditions({ source: { title: '架空の公告' }, conditions: [{ key: 'past-work', value: '元請けとしての同種工事の施工実績', quote: FIRST }] }, [{ file: '公告.txt', text }]);
  const row = out.rows.find((r) => r.key === 'past-work');
  assert.equal(row.status, '拾えた');
  assert.equal(row.quote, FIRST);
  const page = await startPage();
  await choose(page, fileOf(JSON.stringify(out)));
  await toResult(page);
  assert.ok(page.el('bid-result').innerHTML.includes(NOTICE));
  assert.ok(page.el('bid-result').innerHTML.includes(FIRST));
});

test('読み込みの処理は通信の道具を使わない', () => {
  for (const f of ['src/intake-load.mjs', 'src/prime-experience.mjs']) {
    assert.ok(!/\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon/.test(fs.readFileSync(f, 'utf8')), f);
  }
});

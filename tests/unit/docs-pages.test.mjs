// F86j: 文書の操作の語をページ送りの画面に合わせる。画面は変えず、文書の語と手順を今の画面に照らす
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { runPage } from '../acceptance/_helpers.mjs';
import { PAGES } from '../../src/ui/pager.mjs';

const read = (p) => fs.readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const html = read('index.html');
const screen = html.slice(html.indexOf('<body>')).replace(/<script\b[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, '');
const readme = read('README.md');
const manual = read('docs/manual.md');
const design = read('docs/design.md');
const script = read('docs/demo-script.md');
const DOCS = { 'README.md': readme, 'docs/manual.md': manual, 'docs/design.md': design, 'docs/demo-script.md': script, 'docs/overview.md': read('docs/overview.md'), 'docs/development.md': read('docs/development.md') };

// 今は無い操作の語。段の番号は画面の文から外した(F86b)。段の間はボタンで動かず、別の道具は入口から開く(F86c)
const GONE = [
  '段階のボタン', '段階の表示', '段の切り替えはボタン', '段1', '段2', '段3', '段 1', '段 2', '段 3',
  '1 条件を入れる', '2 結果を見る', '3 書類を確かめる', '「1.」', '「2.」', '「3.」', '3-1.', '3-2.',
  '下の折りたたみ「ここからは別の道具」', '「ここからは別の道具」を開', '直轄とは・例の違い', '一覧の上の「条件を入れる」',
  'タイル「公告から拾った条件を読み込む」', '下に止まる帯', 'step-next', '画面の足', '画面の下の「',
];
// 頭の番号の例(「1.」の形の見出しを読む決まり)は画面の操作の語ではない
const allowed = (doc, word, text) => doc === 'docs/manual.md' && word === '「1.」'
  ? text.replace('見出しの頭の番号(「1.」', '') : text;

test('文書に今は無い操作の語が無い', () => {
  for (const [doc, text] of Object.entries(DOCS)) {
    for (const word of GONE) assert.ok(!allowed(doc, word, text).includes(word), `${doc}: ${word}`);
  }
});

test('この試験が除いた頭の番号の例は manual の1か所だけで、ほかは除いていない', () => {
  assert.equal(manual.split('「1.」').length - 1, 1);
  assert.equal(manual.split('見出しの頭の番号(「1.」').length - 1, 1);
});

test('文書の手順が名を挙げるボタン・折りたたみ・ページは今の画面にあり、文書にも書いてある', () => {
  const words = {
    'README.md': ['確かめのページ', '条件を直す', '請負代金の見込みを変更', '文の置き換え(別の道具)', '辞書・ファイル・金額の扱い', '入口に戻る', 'ほかの残し方'],
    'docs/manual.md': ['条件を直す', '例を切り替える・自分の表を読み込む', '文の置き換え(別の道具)', '辞書・ファイル・金額の扱い', '対応表の書き出しと読み込み', '公告から拾った条件を読み込む'],
    'docs/demo-script.md': ['条件を直す', '工種を変更', 'くわしく', '公告を読み込む'],
  };
  for (const [doc, list] of Object.entries(words)) {
    for (const word of list) {
      assert.ok(DOCS[doc].includes(word), `${doc}: ${word}`);
      if (word !== '確かめのページ') assert.ok(screen.includes(word), `画面に無い: ${word}`);
    }
  }
});

test('design: 下の帯・進み具合・ページの決まりの節があり、ページの一覧が PAGES と同じ順', () => {
  const section = design.split('## ページ送り(F86)')[1]?.split('\n## ')[0] ?? '';
  for (const word of ['#pager', '#pg-back', '#steps', '#pg-count', '`PAGES`', '.ref-frame', '`aria-current="step"`', 'max-height: 30rem']) assert.ok(section.includes(word), word);
  for (const [group, list] of Object.entries({ 条件: PAGES[1], 結果: PAGES[2], 書類: PAGES[3], '別の道具': PAGES.tools })) {
    const line = section.split('\n').find((l) => l.startsWith(`- ${group}: `)) ?? assert.fail(`行が無い: ${group}`);
    assert.deepEqual(line.slice(line.indexOf(':') + 2).split(' / '), list.map(([, name]) => name), group);
  }
});

test('README の手順2 の語のとおりに、確かめのページの「条件を直す」から金額を変えて結果を出し直せる', async () => {
  const step2 = readme.split('\n').find((l) => l.startsWith('2. 入口の「まず見本で試す」を押す。'));
  assert.ok(step2.includes('「戻る」で確かめのページへ戻り、「条件を直す」の「請負代金の見込みを変更」'));
  const page = runPage(html);
  await page.click('sample-load');
  await page.click('confirm-go');
  const before = page.el('bid-result').innerHTML;
  await page.click('pg-back');
  assert.equal(page.el('pg-confirm').hidden, false);
  await page.click('confirm-change-contract-amount');
  assert.equal(page.el('pg-1-amount').hidden, false);
  await page.set('contract-amount', '40,000,000');
  await page.click('pg-next');
  await page.click('pg-next');
  assert.equal(page.el('bid-run').hidden, false, '「次へ」で公告のページの「確認する」まで進む');
  await page.click('bid-run');
  await page.click('confirm-go');
  assert.notEqual(page.el('bid-result').innerHTML, before);
});

test('README の手順2 の語のとおりに、見本の候補が書類の2つの候補のページに出る', async () => {
  const step2 = readme.split('\n').find((l) => l.startsWith('2. 入口の「まず見本で試す」を押す。'));
  for (const w of ['「次へ: 書類を確かめる」', '「台帳の候補」', '「目次の候補」']) assert.ok(step2.includes(w), w);
  const page = runPage(html);
  await page.click('sample-load');
  await page.click('confirm-go');
  for (let i = 0; i < 6; i += 1) await page.click('pg-next');
  await page.click('next-step-3');
  await page.click('pg-next');
  await page.click('ledger-run');
  assert.equal(page.el('pg-3-check').hidden, false);
  assert.notEqual(page.el('check-result').innerHTML.trim(), '');
  await page.click('pg-next');
  await page.click('pg-next');
  await page.click('plan-run');
  assert.equal(page.el('pg-3-plan-result').hidden, false);
  assert.notEqual(page.el('plan-result').innerHTML.trim(), '');
  assert.equal(page.el('entry-back').hidden, false, '書類の最後のページの右の席は「入口に戻る」');
});

test('README の手順3 の語のとおりに、入口から置き換えて元に戻せる', async () => {
  const step3 = readme.split('\n').find((l) => /^3\. 入口の/.test(l)) ?? assert.fail('手順3 が入口から始まらない');
  for (const w of ['「文の置き換え(別の道具)」', '「辞書・ファイル・金額の扱い」', '「置き換える」', '置き換えた結果のページ', '「元に戻す」']) assert.ok(step3.includes(w), w);
  const page = runPage(html);
  await page.click('entry-tools');
  assert.equal(page.el('pg-tools').hidden, false);
  await page.set('dict-word', '甲野 一郎');
  await page.set('dict-kind', 'person');
  await page.click('dict-add');
  await page.set('mask-input', '現場代理人 甲野 一郎 / 架空建設株式会社 / kono@example.com');
  await page.click('mask-run');
  await new Promise((r) => setImmediate(r));
  assert.equal(page.el('pg-tools-result').hidden, false);
  const after = page.el('mask-after').textContent;
  assert.match(after, /〔人名1〕/);
  await page.click('pg-next');
  assert.equal(page.el('pg-tools-unmask').hidden, false);
  await page.set('unmask-input', after);
  await page.click('unmask-run');
  assert.match(page.el('unmask-output').textContent, /甲野 一郎/);
});

test('README の試し方の語が今の画面と合う', () => {
  const lines = readme.split('\n');
  const steps = lines.slice(lines.indexOf('## 試し方') + 1, lines.indexOf('見本の工事・会社・人・番号はすべて架空です。')).join('\n');
  assert.ok(steps.includes('次にすること'));
  assert.ok(!steps.includes('詳しい結果と根拠の条へ移れます'), '数のカードは押せない(F86e)');
  assert.ok(steps.includes('結果を残す'));
  assert.ok(steps.includes('「ほかの残し方」'));
});

test('台本: 場面の番号・時間・動画の URL の文を変えていない', () => {
  const times = script.split('\n').flatMap((l) => l.match(/^\| (\d+) \| (\d:\d\d〜\d:\d\d) \|/)?.slice(1, 3).join(' ') ?? []);
  assert.deepEqual(times, ['1 0:00〜0:20', '2 0:20〜0:34', '3 0:34〜0:48', '4 0:48〜1:00', '5 1:00〜1:16', '6 1:16〜1:30', '7 1:30〜1:44', '8 1:44〜1:56', '9 1:56〜2:08', '10 2:08〜2:30', '11 2:30〜2:46', '12 2:46〜2:58']);
  assert.ok(readme.includes('- 動画: (提出のときに作者が URL を書きます。台本は `docs/demo-script.md`。12場面・2:58 で'));
});

test('README の画像の説明の文は今の画像のまま(撮り直すまで変えない)', () => {
  assert.ok(readme.includes('![Motouke Navi の最初の画面。候補であり保証や合否ではないという注意、見ていない法令・資料があるという表示、'));
  assert.ok(readme.includes('![架空の見本の結果の先頭。「結果を見る」の段、見本を読み込んだという表示、数字のカード 要るものの候補 6・確認が要る点 2・安全の法令の候補 7、'));
});

// F82c: 段1 の公告の PDF(値はすべて架空。試験の PDF はこの中で組み、ファイルは置かない)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildHtml } from '../../build.mjs';
import { runPage } from '../acceptance/_helpers.mjs';
import { koukokuPdf, pdfFile, PRIME_LINES, NO_PRIME_LINES, PRIME_SENTENCE } from './_koukoku-pdf.mjs';
import { bracketPairs, insideOf, splitSentences } from '../../src/brackets.mjs';
import { tidyPdfText, tidyPdfPages } from '../../src/pdf-text.mjs';
import { findPrimeExperience, primeMessage } from '../../src/prime-experience.mjs';
import { extractFile } from '../../src/mask/extract.mjs';
import { renderConfirmRow } from '../../src/ui/confirm.mjs';

// runPage の中には performance と DecompressionStream が無い。performance は足し、画面の試験は圧縮しない PDF を使う
const html = buildHtml().replace('<script', '<script>globalThis.performance = { now: () => Date.now() };</script><script');
const plain = (pages) => koukokuPdf(pages, { flate: false });
const FILLED = '「公告の参加の条件」の欄に文があるので入れていません。欄を空にしてから置き直してください。';
const FOUND = '元請けとしての実績を求める文がありました。';
const MISSED = '元請けとしての実績を求める文は見つかりませんでした。公告の本文で確かめてください。';

const line = (page) => page.el('intake-status').textContent;
const field = (page) => page.el('participation-conditions').value;
const until = async (done) => { for (let i = 0; i < 400 && !done(); i += 1) await new Promise((r) => setImmediate(r)); };
async function give(page, file) {
  page.el('intake-load').files = [file];
  await page.set('intake-load', '');
}
async function read(page, file) {
  const before = line(page);
  await give(page, file);
  await until(() => line(page) !== before && !line(page).includes('を読んでいます'));
}
// 中身を渡すのを止めておけるファイル
function heldFile(name, bytes) {
  let release;
  const gate = new Promise((r) => { release = r; });
  const file = pdfFile(name, bytes);
  const open = file.arrayBuffer;
  return { file: { ...file, arrayBuffer: async () => { await gate; return open(); } }, release };
}
async function startPage() {
  const page = runPage(html);
  await page.click('entry-intake');
  return page;
}
async function toResult(page) {
  await page.set('orderer', 'public');
  await page.set('work-type', 'other');
  await page.click('bid-run');
  await page.click('confirm-go');
}

test('画面: 公告の PDF を読むと欄に入り、結果の「確認が要る点」に元請けの施工実績が出る', async () => {
  const page = await startPage();
  await read(page, pdfFile('公告.pdf', plain([PRIME_LINES])));
  assert.equal(page.el('entry').hidden, true);
  assert.equal(page.el('panel-1').hidden, false);
  assert.ok(field(page).includes(PRIME_SENTENCE));
  assert.ok(line(page).includes('条件は拾っていません'), line(page));
  assert.ok(line(page).includes(FOUND), line(page));
  assert.equal(page.el('intake-status').getAttribute('data-kind'), null);
  await toResult(page);
  const items = page.el('open-items').innerHTML;
  assert.ok(items.includes('元請けの施工実績'), '確認が要る点に出ていない');
  assert.ok(items.includes(PRIME_SENTENCE), '公告の抜き書きが出ていない');
});

test('画面: 実績の文の無い公告では、見つからなかったと言い、確認が要る点に出さない', async () => {
  const page = await startPage();
  await read(page, pdfFile('公告.pdf', plain([NO_PRIME_LINES])));
  assert.ok(line(page).endsWith(MISSED), line(page));
  await toResult(page);
  assert.ok(!page.el('open-items').innerHTML.includes('元請けの施工実績'));
});

test('画面: 頁の区切りをまたいだ文も当たり、抜き書きに区切りの行が混ざらない。欄では区切りの行は1行のまま', async () => {
  const page = await startPage();
  await read(page, pdfFile('公告.pdf', plain([['(1) 元請けとして同種工事の'], [], ['施工実績を有すること。', '(2) 次の文。']])));
  assert.equal(field(page), '(1) 元請けとして同種工事の\n―― 2頁 ――\n―― 3頁 ――\n施工実績を有すること。\n(2) 次の文。');
  assert.ok(line(page).includes(FOUND), line(page));
  await toResult(page);
  const items = page.el('open-items').innerHTML;
  assert.ok(items.includes('(1) 元請けとして同種工事の施工実績を有すること。'), '抜き書きがつながっていない');
  assert.ok(!items.includes('頁 ――'));
});

test('画面: 欄に文があれば読まずに断る。失敗の印が付き、空白だけの欄には入れる', async () => {
  const page = await startPage();
  await page.set('participation-conditions', '手で貼った文');
  let opened = 0;
  const file = pdfFile('公告.pdf', plain([PRIME_LINES]));
  await read(page, { ...file, arrayBuffer: () => { opened += 1; return file.arrayBuffer(); } });
  assert.equal(line(page), FILLED);
  assert.equal(page.el('intake-status').getAttribute('data-kind'), 'error');
  assert.equal(field(page), '手で貼った文');
  assert.equal(opened, 0);
  await page.set('participation-conditions', ' \n　');
  await read(page, file);
  assert.ok(field(page).includes(PRIME_SENTENCE));
  assert.equal(page.el('intake-status').getAttribute('data-kind'), null);
});

test('画面: 読む間に欄へ書いた文は消さない', async () => {
  const page = await startPage();
  const { file, release } = heldFile('公告.pdf', plain([PRIME_LINES]));
  await give(page, file);
  await until(() => line(page).includes('を読んでいます'));
  await page.set('participation-conditions', '読む間に貼った文');
  release();
  await until(() => !line(page).includes('を読んでいます'));
  assert.equal(line(page), FILLED);
  assert.equal(field(page), '読む間に貼った文');
});

test('画面: 読む間に押した「確認する」は、読み終わってから動く(欄が空のまま結果を出さない)', async () => {
  const page = await startPage();
  await page.set('orderer', 'public');
  await page.set('work-type', 'other');
  const { file, release } = heldFile('公告.pdf', plain([PRIME_LINES]));
  await give(page, file);
  await until(() => line(page).includes('を読んでいます'));
  const clicked = page.click('bid-run');
  await clicked;
  assert.equal(page.el('panel-confirm').hidden, true, '読み終わる前に確かめの画面へ進んだ');
  release();
  await until(() => page.el('panel-confirm').hidden === false);
  assert.ok(field(page).includes(PRIME_SENTENCE));
  assert.ok(page.el('confirm-value-participation-conditions').innerHTML.includes(PRIME_SENTENCE));
});

test('画面: 続けて2つ置くと、前の文は残し、後のファイルは断る', async () => {
  const page = await startPage();
  const first = heldFile('前.pdf', plain([PRIME_LINES]));
  await give(page, first.file);
  await give(page, pdfFile('後.pdf', plain([NO_PRIME_LINES])));
  first.release();
  await until(() => line(page) === FILLED);
  assert.equal(line(page), FILLED);
  assert.ok(field(page).includes(PRIME_SENTENCE));
});

test('画面: 読む間の文と頁の進みを出し、読み終わると消える', async () => {
  const page = await startPage();
  const st = page.el('intake-status');
  const seen = [];
  let now = st.textContent;
  Object.defineProperty(st, 'textContent', { configurable: true, get: () => now, set: (v) => { now = v; seen.push(v); } });
  await read(page, pdfFile('公告.pdf', plain([NO_PRIME_LINES, NO_PRIME_LINES])));
  assert.equal(seen[0], '「公告.pdf」を読んでいます…');
  for (const s of ['「公告.pdf」を読んでいます(1/2頁)', '「公告.pdf」を読んでいます(2/2頁)']) assert.ok(seen.includes(s), s);
  assert.ok(seen.at(-1).startsWith('「公告.pdf」の文字を読みました(2頁)。'));
});

test('画面: 読めない頁と表の注意を行で添え、次に読むと消える', async () => {
  const page = await startPage();
  await read(page, pdfFile('公告.pdf', plain([NO_PRIME_LINES, [], []])));
  assert.ok(line(page).endsWith(MISSED), line(page));
  const notes = page.el('intake-result').innerHTML;
  assert.ok(notes.includes('3頁のうち'), notes);
  assert.ok(notes.includes('2'), notes);
  assert.ok(notes.includes('表は行や列の順が崩れることがあります。'), notes);
  await page.set('participation-conditions', '別の文');
  await read(page, pdfFile('次.pdf', plain([PRIME_LINES])));
  assert.equal(page.el('intake-result').innerHTML, '');
});

test('画面: 名前の大文字も読む。読めない PDF は欄を変えず、失敗の印が付く', async () => {
  const page = await startPage();
  await read(page, pdfFile('写し.PDF', plain([[]])));
  assert.match(line(page), /^「写し\.PDF」を読めませんでした: 文字の入っていない PDF です/);
  assert.equal(page.el('intake-status').getAttribute('data-kind'), 'error');
  assert.equal(field(page), '');
  await read(page, pdfFile('公告.PDF', plain([PRIME_LINES])));
  assert.ok(field(page).includes(PRIME_SENTENCE));
});

test('画面: 見本の値には混ぜない。読めない PDF では見本を消さない', async () => {
  const page = runPage(html);
  await page.click('sample-load');
  assert.equal(page.el('sample-banner').hidden, false);
  const amount = page.el('contract-amount').value;
  assert.ok(amount);
  await read(page, pdfFile('写し.pdf', plain([[]])));
  assert.equal(page.el('sample-banner').hidden, false);
  assert.equal(page.el('contract-amount').value, amount);
  await read(page, pdfFile('公告.pdf', plain([PRIME_LINES])));
  assert.equal(page.el('sample-banner').hidden, true);
  assert.equal(page.el('contract-amount').value, '', '見本の値が残っている');
  assert.ok(field(page).includes(PRIME_SENTENCE));
});

test('画面: 確かめの画面の出どころは公告で、長い文は頭だけ出し、欄の文は切らない', async () => {
  const page = await startPage();
  const lines = Array.from({ length: 40 }, (_, i) => '(' + (i + 1) + ') 土木一式工事の等級がAであること。');
  await read(page, pdfFile('公告.pdf', plain([lines])));
  await page.set('orderer', 'public');
  await page.set('work-type', 'other');
  await page.click('bid-run');
  assert.equal(field(page).split('\n').length, 40);
  const row = page.el('confirm-value-participation-conditions').innerHTML;
  assert.ok(row.includes('出どころ: 公告'), row);
  assert.ok(row.includes('(全 ' + field(page).length + '字。全文は「変更」で欄を見てください)'), row);
  assert.ok(!row.includes('(40)'), '全文が出ている');
});

test('確かめの画面: 200字までの文はそのまま出す', () => {
  const r = { text: 'あ'.repeat(200), state: 'set', source: '手入力', quote: '' };
  assert.ok(renderConfirmRow(r).includes('<strong>' + r.text + '</strong>'));
  assert.ok(renderConfirmRow({ ...r, text: 'あ'.repeat(201) }).includes('(全 201字。'));
});

test('元請けの知らせ: 長い文は抜き書きを切る。短い文は切らない', () => {
  const long = '元請け' + 'あ'.repeat(5000);
  assert.ok(primeMessage(long).includes('あ…」'));
  assert.ok(primeMessage(long).length < 500);
  assert.ok(primeMessage(PRIME_SENTENCE).endsWith('公告の文: 「' + PRIME_SENTENCE + '」'));
});

test('tidyPdfPages: 頁ごとに整え、区切りの行と空の頁を残す', () => {
  const text = '入札   公告\n\n―― 2頁 ――\n\n―― 3頁 ――\n元請け\nとして。\n―― 10頁 ――\n(1) 次';
  assert.equal(tidyPdfPages(text), '入札 公告\n―― 2頁 ――\n―― 3頁 ――\n元請けとして。\n―― 10頁 ――\n(1) 次');
  assert.equal(tidyPdfPages('区切りの無い文\nの続き。'), tidyPdfText('区切りの無い文\nの続き。'));
  assert.equal(tidyPdfPages(''), '');
  assert.equal(tidyPdfPages(null), '');
  assert.equal(tidyPdfPages('行の途中の ―― 2頁 ―― は\n区切りではない。'), '行の途中の ―― 2頁 ―― は区切りではない。');
});

test('extractFile: PDF は頁の数を返す', async () => {
  const r = await extractFile('公告.pdf', koukokuPdf([PRIME_LINES, [], NO_PRIME_LINES]));
  assert.equal(r.pages, 3);
  assert.equal(findPrimeExperience(tidyPdfPages(r.text)), PRIME_SENTENCE);
});

test('文の中の頁の語は区切りの行にしない。行そのものだけを文から除く', () => {
  assert.equal(findPrimeExperience('元請けとして\n―― 2頁 ――\n施工実績を有すること。'), '元請けとして施工実績を有すること。');
  assert.match(findPrimeExperience('―― 2頁 ――の元請けの施工実績を有すること。'), /^―― 2頁 ――の/);
});

// 直す前の書き方。線形に書き直しても結果が同じことを、偶然の文で確かめる
function slowPairs(text) {
  const OPEN = { '「': '」', '『': '』', '(': ')', '（': ')' };
  const CLOSE = { '」': '」', '』': '』', ')': ')', '）': ')' };
  const open = [];
  const pairs = [];
  [...text].forEach((c, i) => {
    if (Object.hasOwn(OPEN, c)) open.push({ at: i, closer: OPEN[c] });
    else if (Object.hasOwn(CLOSE, c)) {
      const k = open.findLastIndex((o) => o.closer === CLOSE[c]);
      if (k < 0) return;
      pairs.push([open[k].at, i]);
      open.length = k;
    }
  });
  return pairs;
}

test('bracketPairs・insideOf: 直す前の書き方と同じ結果になる', () => {
  const chars = '「」『』()（）。あ\n';
  let seed = 12345;
  const next = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  for (let t = 0; t < 3000; t += 1) {
    const text = Array.from({ length: next(40) }, () => chars[next(chars.length)]).join('');
    const pairs = bracketPairs(text);
    assert.deepEqual(pairs, slowPairs(text), JSON.stringify(text));
    const inside = insideOf(pairs, text.length);
    for (let i = 0; i <= text.length; i += 1) assert.equal(inside(i), pairs.some(([o, c]) => o < i && i < c), JSON.stringify(text) + ' ' + i);
  }
});

test('悪い文でも固まらない: 40万字の括弧の並びを読んで知らせを作る', () => {
  const N = 400000;
  const cases = [
    '('.repeat(N / 2) + '」'.repeat(N / 2),
    '(。)'.repeat(N / 3),
    '(\n)\n'.repeat(N / 4),
    '「'.repeat(N / 2) + '(' .repeat(N / 4) + ')'.repeat(N / 4),
    '元請けの実績を有すること(。)\n'.repeat(N / 15),
  ];
  for (const text of cases) {
    const t0 = performance.now();
    const tidied = tidyPdfPages(text);
    splitSentences(tidied);
    findPrimeExperience(tidied);
    const ms = performance.now() - t0;
    assert.ok(ms < 5000, text.slice(0, 12) + ' で ' + Math.round(ms) + 'ms');
  }
});

test('画面の label・accept・タイル・説明に公告の PDF があり、「読めません」の文が無い', () => {
  for (const file of ['src/ui/shell.html', 'index.html']) {
    const page = fs.readFileSync(new URL('../../' + file, import.meta.url), 'utf8');
    const accept = page.match(/<input\b[^>]*\bid="intake-load"[^>]*>/)[0].match(/accept="([^"]*)"/)[1].split(',');
    for (const a of ['.json', 'application/json', '.pdf', 'application/pdf']) assert.ok(accept.includes(a), file + ' の accept に ' + a + ' が無い');
    assert.ok(page.includes('公告の PDF・拾った条件のファイル(.pdf・.json)'), file);
    assert.ok(page.includes('>公告の PDF か、AI がまとめた条件のファイル(.json)を選ぶ<'), file); // F83a6: タイルの文を短くした
    assert.ok(page.includes('公告の PDF を読むと、全文がここに入ります。'), file);
    assert.ok(!page.includes('公告の PDF はこの画面では読めません'), file);
  }
  const rules = fs.readFileSync(new URL('../../src/ui/shell.html', import.meta.url), 'utf8').match(/<input\b[^>]*\bid="rules-load"[^>]*>/)[0];
  assert.ok(!rules.includes('.pdf'), 'ほかの口の accept は変えない');
});

// F87a: 要るものを1項目1行にする。見えるのは名前と状態で、根拠は項目を押すと開く。一覧の下の物は閉じた折りたたみへ移す。
// ブラウザが無いので、1画面に収まるかと1行の高さは測らない(Edge の確かめは統括)。ここでは組み立てた画面の HTML・CSS と、紙に出る文を見る
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { buildHtml } from '../../build.mjs';
import { runPage } from '../acceptance/_helpers.mjs';
import { bidCheck } from '../../src/bid-check.mjs';
import { SAMPLE } from '../../src/sample.mjs';
import { readBidForm } from '../../src/ui/form.mjs';
import { renderBidResult } from '../../src/ui/view.mjs';
import { openDetailsForPrint, restoreDetailsAfterPrint } from '../../src/ui/app.mjs';

const GOLDEN = new URL('./golden/need-rows-paper.json', import.meta.url);
const html = buildHtml();
const body = html.slice(html.indexOf('<body>')).replace(/<script\b[\s\S]*?<\/script>/g, '');
const css = html.match(/<style>([\s\S]*?)<\/style>/)[1].replace(/\/\*[\s\S]*?\*\//g, '');
const FOLD_IDS = ['need-provisional', 'need-more', 'need-about', 'taicho-fold'];

// 字下げが2つの空白の @media の中身を、見出しの文で取り出す
const mediaBlocks = (head) => css.split(/^ {2}(?=@media )/m).filter((s) => s.startsWith(head + ' {')).map((s) => s.slice(0, s.search(/^ {2}\}/m)));
const screenCss = mediaBlocks('@media screen').join('\n');
const narrowCss = mediaBlocks('@media screen and (max-width: 40rem)').join('\n');
const printCss = mediaBlocks('@media print').join('\n');

// 判定を通した4つの状態(07 の F87 の目標と同じ。見本の金額を変えた形も見る)
const STATES = {
  見本: SAMPLE.form,
  仮の結果: {},
  条件が変わった: { ...SAMPLE.form, 'contract-amount': '3000000' },
  全部分からない: { orderer: 'unknown', 'direct-unknown': true, 'work-type': 'unknown', 'contract-amount-unknown': true, 'subcontract-total-unknown': true, license: 'unknown', 'engineer-qualification': 'unknown' },
};
const render = (v) => renderBidResult(bidCheck(readBidForm(v)), v);
const textOf = (h) => h.replace(/<[^>]+>/g, '');

// golden に長い原文をそのまま置かないよう、1塊を頭の字と文の hash にする。文が1字でも変われば違う値になる
const stamp = (line) => line.slice(0, 24) + ' #' + createHash('sha256').update(line).digest('hex').slice(0, 12);
// 紙に出る文を、塊ごとに順に並べる。no-print の要素と details.fold の見出しは紙に出ないので除く
function paperLines(source) {
  const lines = [];
  const stack = [];
  let skip = 0;
  let line = '';
  const flush = () => { if (line.trim()) lines.push(line.trim()); line = ''; };
  for (const part of source.split(/(<[^>]+>)/)) {
    const open = part.match(/^<([a-z0-9]+)\b([^>]*)>$/);
    const close = part.match(/^<\/([a-z0-9]+)>$/);
    if (open) {
      const [, tag, attrs] = open;
      if (['br', 'hr', 'img', 'input'].includes(tag)) continue;
      if (tag !== 'span' && tag !== 'strong') flush();
      const noPaper = /\bclass="[^"]*\bno-print\b/.test(attrs) || (tag === 'summary' && stack.at(-1)?.fold);
      stack.push({ tag, noPaper, fold: tag === 'details' && /\bclass="fold\b/.test(attrs) });
      if (noPaper) skip += 1;
    } else if (close) {
      if (close[1] !== 'span' && close[1] !== 'strong') flush();
      if (stack.pop()?.noPaper) skip -= 1;
    } else if (!skip) {
      line += part;
    }
  }
  flush();
  return lines;
}

test('閉じて始まる: 項目の根拠も一覧の下の折りたたみも開いていない', async () => {
  for (const [name, v] of Object.entries(STATES)) assert.doesNotMatch(render(v), /<details\b[^>]*\bopen\b/, name);
  const page = runPage(html);
  await page.click('sample-load');
  await page.click('confirm-go');
  assert.doesNotMatch(page.el('bid-result').innerHTML, /<details\b[^>]*\bopen\b/);
  assert.match(body, /<details class="fold" id="taicho-fold"><summary>施工体制台帳が要るか<\/summary>/);
});

test('各項目の summary の文に「根拠を見る: 〔法令の名前〕」が残り、語と法令の名前は span で分かれる', () => {
  for (const [name, v] of Object.entries(STATES)) {
    const out = render(v);
    const sums = [...out.matchAll(/<li class="(?:duty )?item [\s\S]*?<details class="basis"><summary>([\s\S]*?)<\/summary>/g)].map((m) => m[1]);
    assert.ok(sums.length > 0, name);
    for (const s of sums) {
      if (textOf(s) === '理由を見る') { assert.equal(s, '<span class="basis-word">理由を見る</span>'); continue; }
      assert.match(s, /^<span class="basis-word">根拠を見る<\/span><span class="basis-laws">: [^<]+<\/span>$/, name);
      assert.match(textOf(s), /^根拠を見る: \S/, name);
    }
  }
  const noBasis = renderBidResult({ items: [{ key: 'r', label: 'いる', status: 'required', basis: [] }], checks: [] });
  assert.ok(noBasis.includes('<summary><span class="basis-word">理由を見る</span></summary>'));
});

test('折りたたみの id と順: 仮の知らせ → 見出し → 案内 → 項目 → 確認が要る点の案内 → この一覧について', () => {
  const out = render({});
  const marks = ['id="need-provisional"', 'class="need-heading"', 'class="need-hint no-print"', '<ul class="items">', 'id="need-more"', 'id="need-about"'];
  const at = marks.map((m) => out.indexOf(m));
  at.forEach((n, i) => { assert.ok(n >= 0, marks[i]); if (i) assert.ok(at[i - 1] < n, marks[i - 1] + ' → ' + marks[i]); });
  assert.match(out, /<details class="fold" id="need-provisional"><summary>仮の一覧です\(未回答の質問 \d+つ\)<\/summary><p class="provisional"><strong>仮の一覧です<\/strong>/);
  assert.match(out, /<details class="fold" id="need-more"><summary>確認が要る点の案内・労務費の候補<\/summary>/);
  const amount = renderBidResult({ items: [], checks: [], amountBasis: { tax: 'included', note: '架空の比べ方', basis: [] }, disclaimer: '架空の断り' });
  assert.match(amount, /<details class="fold" id="need-about"><summary>金額の比べ方・この一覧について<\/summary><div class="amount-basis"><p>金額の比べ方: 税込み。架空の比べ方<\/p>[\s\S]*<p class="human">架空の断り<\/p><\/details>$/);
  const plain = renderBidResult({ items: [], checks: [], disclaimer: '架空の断り' });
  assert.match(plain, /<details class="fold" id="need-about"><summary>この一覧について<\/summary><p class="human">架空の断り<\/p><\/details>$/);
  assert.ok(!render(SAMPLE.form).includes('id="need-provisional"'), '未回答の無い見本に仮の知らせが出る');
  // 台帳の折りたたみは #bid-fold の中で、入札前の確認の後ろ
  const fold = body.slice(body.indexOf('id="bid-fold"'), body.indexOf('id="pg-2-schedule"'));
  const ids = ['id="bid-result"', 'id="taicho-fold"', 'id="taicho-result"'].map((m) => fold.indexOf(m));
  assert.ok(ids[0] >= 0 && ids[0] < ids[1] && ids[1] < ids[2], ids.join());
  assert.match(fold, /id="taicho-result"[^]*?<\/div>\n<\/details>\n<\/details>\n<\/div>/);
});

test('紙: openDetailsForPrint で4つの折りたたみが開き、見出しは紙で隠れる。終わると閉じ直す', () => {
  const out = render({}) + body.slice(body.indexOf('<details class="fold" id="taicho-fold">'), body.indexOf('id="pg-2-schedule"'));
  const list = [...out.matchAll(/<details\b([^>]*)>/g)].map((m) => ({ id: m[1].match(/\bid="([^"]+)"/)?.[1], open: false }));
  for (const id of FOLD_IDS) assert.ok(list.some((d) => d.id === id), id + ' が無い');
  openDetailsForPrint({ querySelectorAll: (sel) => (sel === 'details' ? list : []) });
  assert.ok(list.every((d) => d.open));
  restoreDetailsAfterPrint();
  assert.ok(list.every((d) => !d.open));
  assert.match(printCss, /details\.fold > summary \{ display: none; \}/);
  // 中の文: 開いた紙に、確認が要る点の見出し・労務費の候補・金額の比べ方・断り書き・仮の知らせ・台帳の見出しが出る
  const bid = bidCheck(readBidForm({}));
  const paper = paperLines(render({})).join('\n');
  for (const s of ['確認が要る点', '受注したら要るもの(仮の一覧)', '仮の一覧です', '労務費と処遇の候補', bid.disclaimer]) assert.ok(paper.includes(s), s);
  const sample = bidCheck(readBidForm(SAMPLE.form));
  const samplePaper = paperLines(render(SAMPLE.form)).join('\n');
  for (const s of ['確認が要る点(2件)', '労務費と処遇の候補', sample.disclaimer]) assert.ok(samplePaper.includes(s), s);
  assert.match(body, /id="taicho-fold"><summary>施工体制台帳が要るか<\/summary>\n<h3>施工体制台帳が要るか<\/h3>/);
});

test('行のどこを押しても開く規則は、閉じた項目の summary::after だけに掛かる', () => {
  const rule = screenCss.match(/([^{}\n]*summary::after)\s*\{([^{}]*inset: 0[^{}]*)\}/);
  assert.ok(rule, 'inset: 0 の summary::after の規則が無い');
  assert.equal(rule[1].trim(), '#bid-result .item > details.basis:not([open]) > summary::after');
  assert.match(rule[2], /position: absolute/);
  assert.match(screenCss, /#bid-result \.item \{[^{}]*position: relative/);
  assert.ok(!printCss.includes('inset: 0'), '紙の決まりに行を覆う規則がある');
  assert.equal(css.split('#bid-result .item > details.basis:not([open]) > summary::after').length - 1, 1);
});

test('閉じた形で隠す規則は @media screen の中だけで、紙の決まりに無い', () => {
  for (const sel of ['.item-depends', '.unanswered-note', '.reason']) {
    assert.match(screenCss, new RegExp('#bid-result \\.item:has\\(> details\\.basis:not\\(\\[open\\]\\)\\) > \\' + sel + '\\b'), sel);
  }
  assert.match(screenCss, /\.need-heading \{ display: none; \}/);
  assert.match(screenCss, /#taicho-fold > h3 \{ display: none; \}/);
  assert.match(screenCss, /\.basis-laws \{[^{}]*position: absolute/);
  assert.doesNotMatch(screenCss, /\.basis-laws \{[^{}]*display: none/, '読み上げに残す');
  assert.match(narrowCss, /\.basis-word \{[^{}]*position: absolute/);
  assert.doesNotMatch(narrowCss, /\.basis-word \{[^{}]*display: none/, '読み上げに残す');
  for (const word of ['need-heading', 'taicho-fold', 'basis-laws', 'basis-word', 'item-depends', 'unanswered-note']) {
    assert.ok(!printCss.includes(word), '紙の決まりに ' + word + ' がある');
    assert.ok(!css.slice(0, css.indexOf('@media screen')).includes(word), '@media の外に ' + word + ' がある');
  }
});

test('消した文が無い: 紙に出る文が直す前と同じ順(4つの状態。golden は 95b3b76 の出力)', () => {
  const now = Object.fromEntries(Object.entries(STATES).map(([name, v]) => [name, paperLines(render(v)).map(stamp)]));
  if (process.env.NEED_ROWS_WRITE) fs.writeFileSync(GOLDEN, JSON.stringify(now, null, 1) + '\n');
  assert.deepEqual(now, JSON.parse(fs.readFileSync(GOLDEN, 'utf8')));
});

test('断り書き: 全文は #need-about の中にあり、上の1行は折りたたみの外で要るもののページにも見える', () => {
  for (const [name, v] of Object.entries(STATES)) {
    const bid = bidCheck(readBidForm(v));
    const out = renderBidResult(bid, v);
    const about = out.slice(out.indexOf('id="need-about"'));
    assert.ok(about.includes('<p class="human">' + bid.disclaimer.replace(/&/g, '&amp;') + '</p>'), name);
    assert.equal(out.split(bid.disclaimer).length - 1, 1, name);
  }
  // 上の1行は .pg の外(ページをめくっても同じ場所)
  assert.ok(body.indexOf('id="notice-more"') < body.indexOf('class="pg'), '上の1行がページの中にある');
});

test('手本の語: 案内の文と「理由を見る」の字のまま', () => {
  assert.ok(render(SAMPLE.form).includes('<p class="need-hint no-print">項目を押すと、根拠と次にすることが開きます。</p>'));
  assert.ok(fs.readFileSync(new URL('../../src/ui/view.mjs', import.meta.url), 'utf8').includes("'理由を見る'"), 'ui-terms が読む');
});

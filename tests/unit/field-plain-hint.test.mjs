// F83a13: 段1 の欄の説明のうち、最初の文に法令の語がある欄は、平易な1文を見える所に置き、今の説明は「くわしく」の中へ移した
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildHtml } from '../../build.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const html = buildHtml();
const body = html.slice(html.indexOf('<body>')).replace(/<script\b[\s\S]*?<\/script>/g, '');
const form = body.match(/<form id="bid-form"[\s\S]*?<\/form>/)[0];

// この件の前の説明の全文(一字も変えずに折りたたみに残す)
const FORMER = {
  orderer: '工事を注文した人(元請けに注文した人)の区分です。下請けで請け負うときも、元の発注者で選びます。',
  direct: '発注者から直接請け負うなら「元請け」、元請けやほかの下請けから請け負うなら「下請け」です。選んでいないときは、施工体制台帳・特定建設業の許可・技術者の区分を「判断できない」にします(選んでいないことを下請けと読みません)。',
  'work-type': '自分が請け負う工事の種類です。下請けで請け負う(上で「下請け」を選んだ)ときは、元請けの工事全体ではなく、自分が請け負う下請工事の種類を選びます(施行令 第27条第1項の「当該建設工事」)。',
  'work-kind': '建設業法施行令 第37条の技術検定の種目で選びます。段取りと目次の点検に使う表と、その出典が切り替わります。仕様書を読んでいない工種は「この工種の仕様書は見ていない」と出します。法令の判定・安全の法令の候補・公告の読みは工種を問わず出します。',
  'contract-amount': '自分が請け負う額です(下請けならその下請契約の額)。消費税を含めた額を、円で入れます。「1億3,420万円」「134,200千円」のように単位を付けたときは、円にした値を欄の下に出します。',
  'subcontract-total': '自分が結ぶ下請契約の額です。二以上ならその合計を入れ、下請けが無ければ 0 を入れます。「1億3,420万円」「134,200千円」のように単位を付けたときは、円にした値を欄の下に出します。',
  license: 'この工事の業種で持っている許可が、特定建設業か一般建設業かを選びます(許可は業種ごとに分かれます)。',
  'engineer-qualification': 'この工事に置ける人が、監理技術者になれる人か、主任技術者になれる人かを選びます。どちらが要るかは結果に出します。',
  'ict-measure': '公共工事で、台帳の写しを出す代わりに、発注者が台帳を見られるようにするときだけ印を付けます。その方法でよいかは発注者に確かめてください。',
  'participation-conditions': '公告の施工実績の条件の文を貼ります。公告から拾った条件を読み込むと、施工実績の抜き書きがここに入ります。公告の PDF を読むと、全文がここに入ります。元請けとしての実績を求める文があれば、確認が要る点に出します。文の語を見るだけで、参加できるかどうかは判定しません。',
};
// 平易な1文の全文(足すときは統括と作者の見比べが要る)
const PLAIN = {
  'work-kind': '段取りと目次の点検に使う表を、工種で選びます。',
  'contract-amount': '自分が請け負う額を、消費税を含めて入れます。',
  'subcontract-total': '自分が下請けに出す額の合計です(無ければ 0)。',
  license: 'この工事の業種で持っている許可の種類を選びます。',
  'engineer-qualification': 'この工事に置ける人の資格を選びます(どちらが要るかは結果に出します)。',
};
const LAW_WORDS = /建設業法|施行令|施行規則|特定建設業|一般建設業|監理技術者|主任技術者|施工体制台帳|下請契約|請負代金|専任/;
const ARTICLE = /第[0-9０-９一二三四五六七八九十百千]+条/;
const PAREN_ARTICLE = /[((][^))]*条[^))]*[))]/;
const firstSentence = (s) => s.slice(0, s.indexOf('。') + 1);
const unescape = (s) => s.replace(/&quot;/g, '"').replace(/&amp;/g, '&');
const textOf = (id) => {
  const m = form.match(new RegExp('<p id="' + id + '"[^>]*>([^<]*)</p>'));
  return m ? unescape(m[1]) : null;
};
// 欄の説明として最初に読まれる文。平易な1文があればそれ、無ければ折りたたみの説明
const leadOf = (id) => textOf(id + '-plain') ?? textOf(id + '-hint');
// その欄の hint の折りたたみ
const foldOf = (id) => form.match(new RegExp('<details class="fold hint-fold"><summary aria-label="[^"]+">[^<]+</summary><p id="' + id + '-hint"[^>]*>[^<]*</p></details>'))?.[0] ?? null;

test('段1 の欄の説明は 10 あり、数えた表と shell の hint が同じ', () => {
  const ids = [...form.matchAll(/<p id="([a-z-]+)-hint" class="hint">/g)].map((m) => m[1]);
  assert.deepEqual(ids, Object.keys(FORMER));
});

test('対象の数え方: 今の説明の最初の文に法令の語がある欄だけ平易な1文を持つ', () => {
  const targets = Object.keys(FORMER).filter((id) => LAW_WORDS.test(firstSentence(FORMER[id])) || ARTICLE.test(firstSentence(FORMER[id])));
  assert.deepEqual(targets, Object.keys(PLAIN));
  for (const id of Object.keys(FORMER)) assert.equal(textOf(id + '-plain') !== null, id in PLAIN, id);
});

test('各欄の hint の最初の文に、括弧の条番号と「第n条」が無い', () => {
  // 調べ方が効いている: 前の説明の工種の最初の文は落ちる
  assert.ok(ARTICLE.test(firstSentence(FORMER['work-kind'])));
  assert.ok(PAREN_ARTICLE.test('(施行令 第27条第1項)'));
  for (const id of Object.keys(FORMER)) {
    const first = firstSentence(leadOf(id));
    assert.ok(first.length > 0, id);
    assert.ok(!ARTICLE.test(first), id + ': ' + first);
    assert.ok(!PAREN_ARTICLE.test(first), id + ': ' + first);
  }
});

test('今の説明の全文が details の中に残る', () => {
  for (const [id, text] of Object.entries(FORMER)) {
    const fold = foldOf(id);
    assert.ok(fold, id + ' の折りたたみが無い');
    assert.equal(unescape(fold.match(/<p [^>]*>([^<]*)<\/p>/)[1]), text, id);
  }
});

test('平易な1文: 全文が表のとおりで、1文で、法令の語と条番号と言い切りが無い', () => {
  for (const [id, text] of Object.entries(PLAIN)) {
    assert.equal(textOf(id + '-plain'), text, id);
    assert.equal(text.indexOf('。'), text.length - 1, id + ' は1文');
    assert.ok(!LAW_WORDS.test(text), id + ': ' + text);
    assert.ok(!ARTICLE.test(text), id + ': ' + text);
    assert.ok(!/法令|必ず|義務|違反|罰|要りません|なりません/.test(text), id + ': ' + text);
    assert.ok(text.length <= 36, id + ' が長い: ' + text.length + '字');
  }
});

test('平易な1文は折りたたみの外、その欄の折りたたみのすぐ前にある。見出しは「くわしく」で、ほかの欄は「説明」のまま', () => {
  for (const id of Object.keys(FORMER)) {
    const fold = foldOf(id);
    const summary = fold.match(/<summary aria-label="[^"]+">([^<]+)<\/summary>/)[1];
    if (id in PLAIN) {
      assert.equal(summary, 'くわしく', id);
      assert.ok(form.includes('<p id="' + id + '-plain" class="hint">' + PLAIN[id] + '</p>\n' + fold), id);
    } else {
      assert.equal(summary, '説明', id);
    }
  }
});

test('欄の名前と id は変えていない。読み上げは平易な1文 → くわしい説明の順につながる', () => {
  const labels = {
    'work-kind': '工種',
    'contract-amount': '請負代金の見込み(円・税込み)<span class="req req-must">※必須</span>',
    'subcontract-total': '下請けの総額(円・税込み)<span class="req req-must">※必須</span>',
    license: '元請けの許可の種類(この工事の業種)<span class="req req-must">※必須</span>',
    'engineer-qualification': '置ける技術者の資格<span class="req req-must">※必須</span>',
  };
  for (const [id, label] of Object.entries(labels)) {
    assert.ok(form.includes('<label for="' + id + '">' + label + '</label>'), id);
    assert.match(form, new RegExp('(?:<select|<input)[^>]* id="' + id + '"[^>]*aria-describedby="' + id + '-plain ' + id + '-hint"'), id);
  }
  for (const id of Object.keys(FORMER).filter((x) => !(x in PLAIN))) assert.ok(form.includes('aria-describedby="' + id + '-hint"'), id);
});

test('読み上げの見出しは欄ごとに違うまま', () => {
  const names = Object.keys(FORMER).map((id) => foldOf(id).match(/aria-label="([^"]+)"/)[1]);
  assert.equal(new Set(names).size, names.length);
});

test('画面の中で通信しない: 足した文は静的な文字だけで、index.html は作り直してある', () => {
  assert.equal(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'), html);
  assert.match(html, /Content-Security-Policy" content="[^"]*default-src 'none'/);
});

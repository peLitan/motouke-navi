// F47a: 説明の食い違いの直し。想定の人物・条の数・第37条の抜き書きを、実物から数えて確かめる
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseXml, renderArticle, findArticle } from '../../scripts/fetch-sources.mjs';
import { paragraphOf, verifyQuote } from '../../src/quote-check.mjs';
import { runPage } from '../acceptance/_helpers.mjs';

const read = (p) => fs.readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const json = (p) => JSON.parse(read(p));
const lawRows = (p) => json(p).sources.filter((s) => s.kind === 'law');

test('想定の人物: README と overview に「中小の建設会社」の書き方が無く、作者の言葉の相手にそろっている', () => {
  for (const file of ['README.md', 'docs/overview.md']) {
    assert.ok(!read(file).includes('中小の建設会社'), file);
    assert.match(read(file), /元請けを請けたことがない建設/, file);
  }
});

test('条の数: 説明の 29 と 8 が data/sources の法令の行の数と Skill の原文のファイルの数と同じ', () => {
  const all = lawRows('data/sources/index.json').length;
  const skill = fs.readdirSync(new URL('../../plugin/skills/construction-check/reference/sources/', import.meta.url)).filter((f) => /^law-.*\.txt$/.test(f)).length;
  assert.equal(all, 29);
  assert.equal(skill, 8);
  const readme = read('docs/details.md');
  assert.ok(readme.includes(`Skill に入れた${skill}つの条だけ`));
  assert.ok(readme.includes(`取得した法令の条は${all}です`));
  assert.ok(readme.includes(`残る${all - skill}の条`));
  assert.ok(read('docs/overview.md').includes(`法令は${all}の条`));
  assert.ok(read('docs/manual.md').includes(`取得した法令の条は${all}`));
  assert.ok(!readme.includes('取得した8つの条'));
});

test('第37条: 技術検定の7種目の抜き書きが第1項の中にあり、README の出典に載っている', () => {
  const source = json('data/sources/index.json').sources.find((s) => s.id === 'rei-37');
  assert.equal(source.fetchedAt, '2026-11-06');
  const para = paragraphOf(read('data/sources/' + source.file), 1);
  const quotes = json('data/quotes.json').quotes.filter((q) => q.sourceId === 'rei-37');
  assert.equal(quotes.length, 8);
  for (const q of quotes) assert.ok(verifyQuote(q.text, para), q.id);
  const kinds = quotes.filter((q) => q.id !== 'q-rei-37-1').map((q) => q.text.split('　')[0]);
  assert.deepEqual(kinds, ['建設機械施工管理', '土木施工管理', '建築施工管理', '電気工事施工管理', '管工事施工管理', '電気通信工事施工管理', '造園施工管理']);
  assert.match(read('docs/details.md'), /建設業法施行令\(第37条。工種の欄の7種目の根拠\) \| https:\/\/laws\.e-gov\.go\.jp\/law\/331CO0000000273 \| 2026-11-06/);
});

test('原文の保存: 表は1行を1つの行にし、欄を全角の空白で区切る(架空の条)', () => {
  const xml = `<Law><MainProvision><Article Num="1"><ArticleCaption>（例）</ArticleCaption><ArticleTitle>第一条</ArticleTitle>
    <Paragraph Num="1"><ParagraphNum/><ParagraphSentence><Sentence>次の表による。</Sentence></ParagraphSentence>
      <TableStruct>
        <Table>
          <TableRow><TableColumn><Sentence>甲</Sentence></TableColumn>
            <TableColumn><Sentence>乙</Sentence></TableColumn></TableRow>
          <TableRow><TableColumn><Sentence>丙</Sentence></TableColumn>
            <TableColumn><Sentence>丁</Sentence></TableColumn></TableRow>
        </Table>
      </TableStruct></Paragraph></Article></MainProvision></Law>`;
  assert.equal(renderArticle(findArticle(parseXml(xml), '1')), '（例）\n第一条　次の表による。\n甲　乙\n丙　丁\n');
});

test('5分で試せる手順: 公告から拾った条件の見本を挙げ、そのファイルを読み込むと確かめる画面まで進める', async () => {
  const section = read('docs/details.md').split('## 5分で試せる手順')[1].split('\n## ')[0];
  const file = 'docs/samples/bid-intake/画面に入れる条件.json';
  assert.ok(section.includes(file));
  const text = read(file);
  const page = runPage(read('index.html'));
  await page.click('entry-intake');
  page.el('intake-load').files = [{ size: text.length, text: async () => text }];
  await page.set('intake-load', '');
  await new Promise((r) => setImmediate(r));
  assert.match(page.text('intake-status'), /欄を入れました/);
  await page.click('bid-run');
  assert.equal(page.el('panel-confirm').hidden, false);
});

// F70a: 費用と通信の1行、手順の数、困る場面の箇条
const trySteps = () => read('docs/details.md').split('## 5分で試せる手順')[1].split('\n## ')[0];

test('5分で試せる手順: 先頭の行に通信・費用・鍵の文があり、費用の文は1つだけ', () => {
  const readme = read('docs/details.md'); // README.md から移した節
  assert.equal(/(^|[^A-Za-z0-9-])sk-[A-Za-z0-9_-]/.test(read('README.md')), false);
  const first = trySteps().trimStart().split('\n')[0];
  for (const w of ['開いたあとは通信しません', '使う人自身の API の鍵か Claude Code のログイン', '費用もその人の契約', '`claude plugin eval` の費用と時間の目安', 'docs/評価.md §7', '作者の鍵はこのリポジトリに入っていません']) {
    assert.ok(first.includes(w), w);
  }
  assert.equal(readme.split('費用もその人の契約').length - 1, 1);
  assert.equal(readme.split('費用と時間の目安').length - 1, 1);
  assert.equal(/(^|[^A-Za-z0-9-])sk-[A-Za-z0-9_-]/.test(readme), false);
  assert.ok(readme.includes('動かす人の Claude の使用量がかかります'));
  assert.equal(/(?<!動かす人の )Claude の使用量がかかります/.test(readme), false);
});

test('5分で試せる手順: ブラウザだけで済む番号が手順と合い、括弧が Pages の通信を書いている', () => {
  const section = trySteps();
  const m = section.match(/1〜(\d+) はブラウザだけで済みます\(([^)]*)\)/);
  assert.ok(m);
  const steps = section.split('\n').filter((l) => /^\d+\. /.test(l));
  assert.deepEqual(steps.map((l) => parseInt(l, 10)), steps.map((_, i) => i + 1));
  const n = Number(m[1]);
  assert.ok(steps.slice(0, n).every((l) => !l.includes('Claude')));
  assert.match(steps[n], /^\d+\. Claude Code があれば/);
  assert.ok(m[2].includes('1 の Pages はページを読み込む通信だけ'));
  assert.ok(!m[2].includes('通信も要りません'));
  assert.ok(steps[0].includes('GitHub Pages') && steps[0].includes('`index.html`'));
});

test('どんな場面で: README と overview の「誰の」のすぐ下にあり、監督職員の語が無く、作者の立場の段落は箇条の上(F74a)', () => {
  for (const file of ['README.md', 'docs/overview.md']) {
    const lines = read(file).split('\n');
    const scene = lines[lines.findIndex((l) => l.startsWith('- 誰の: ')) + 1];
    assert.match(scene, /^- どんな場面で: /, file);
    assert.ok(!scene.includes('監督職員'), file);
    const who = lines.findIndex((l) => l.startsWith('- 誰の: '));
    const stance = lines.findIndex((l) => l.startsWith('最初の3文は作者の言葉です。'));
    assert.ok(stance >= 0 && stance < who, file);
  }
});

test('overview: コミットの数に数えた日時があり、使い分けの表の行はどれも4列', () => {
  const overview = read('docs/overview.md');
  assert.match(overview, /コミットを数えた日時: \d{4}-\d{2}-\d{2} \d{2}:\d{2}/);
  const rows = overview.split('\n').filter((l) => /^\| (hook|MCP|Skill|反証の係)/.test(l));
  assert.ok(rows.some((r) => r.includes('`bid-intake`')));
  for (const r of rows) assert.equal(r.split(' | ').length, 4, r.slice(0, 40));
});

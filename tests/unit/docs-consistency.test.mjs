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

test('条の数: 説明の 26 と 8 が data/sources の法令の行の数と Skill の原文のファイルの数と同じ', () => {
  const all = lawRows('data/sources/index.json').length;
  const skill = fs.readdirSync(new URL('../../plugin/skills/construction-check/reference/sources/', import.meta.url)).filter((f) => /^law-.*\.txt$/.test(f)).length;
  assert.equal(all, 26);
  assert.equal(skill, 8);
  const readme = read('README.md');
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
  assert.match(read('README.md'), /建設業法施行令\(第37条。工種の欄の7種目の根拠\) \| https:\/\/laws\.e-gov\.go\.jp\/law\/331CO0000000273 \| 2026-11-06/);
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
  const section = read('README.md').split('## 5分で試せる手順')[1].split('\n## ')[0];
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

test('overview: コミットの数に数えた日時があり、使い分けの表の行はどれも4列', () => {
  const overview = read('docs/overview.md');
  assert.match(overview, /コミットを数えた日時: \d{4}-\d{2}-\d{2} \d{2}:\d{2}/);
  const rows = overview.split('\n').filter((l) => /^\| (hook|MCP|Skill|反証の係)/.test(l));
  assert.ok(rows.some((r) => r.includes('`bid-intake`')));
  for (const r of rows) assert.equal(r.split(' | ').length, 4, r.slice(0, 40));
});

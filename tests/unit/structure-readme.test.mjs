// F50b: README の節「業界の構造にどう効くか」に、効かないことと出典がそろっていることを確かめる
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const readme = fs.readFileSync(new URL('../../README.md', import.meta.url), 'utf8');
const section = readme.split('## 業界の構造にどう効くか(効かないことも含めて)')[1]?.split('\n## ')[0] ?? '';
const overview = fs.readFileSync(new URL('../../docs/overview.md', import.meta.url), 'utf8');
const paragraphs = section.trim().split('\n\n');

test('節があり、効かないことが4つとも項目で書いてある', () => {
  assert.ok(section, '節が無い');
  for (const head of ['受注', '価格', '使う人の選別', '安全の実務']) {
    assert.match(section, new RegExp(`^- ${head}: `, 'm'), head);
  }
});

test('F50a の条と結果の節の名前が書いてある', () => {
  for (const s of ['第20条第6項', '第25条の27第2項', '第2条第5項', '労務費と処遇の確認(確認が要る候補)']) {
    assert.ok(section.includes(s), s);
  }
});

test('節の国の資料が「データと出典」の表に取得日つきで載っている', () => {
  const sources = readme.split('## データと出典')[1].split('\n## ')[0];
  for (const id of ['001971681', '001971712', '001760946', '001984988']) {
    assert.match(sources, new RegExp(`/${id}\\.pdf \\| \\d{4}-\\d{2}-\\d{2} \\|`), id);
  }
});

// F71a: 723 社 / 9,734 社は国の直轄の工事の数で、読みは作者の側のもの。言い切りと意向の数字にしない
const trouble = overview.split('## 誰の、どんな困りごとか')[1]?.split('\n## ')[0] ?? '';
const overviewLine = trouble.split('\n').find((l) => l.includes('9,734')) ?? '';

for (const [name, text] of [['README の節の先頭の段落', paragraphs[0]], ['概要の困りごとの行', overviewLine]]) {
  test(`F71a: ${name}に数字・出典・読みの形・但し書きがある`, () => {
    assert.ok(text, name);
    for (const s of [
      '9,734 社', '723 社', '国土交通省「中小建設業への普及促進方策について」p.2', '単体の元請け', '北海道と沖縄を除く',
      '国の直轄の工事を元請けで受けた経験', 'と読みました', '県や市町村',
    ]) {
      assert.ok(text.includes(s), s);
    }
    for (const s of ['限られています', '少ない']) assert.ok(!text.includes(s), s);
  });
}

test('F71a: 受注の難しさ・意向の数字に読める語が README と概要に無い', () => {
  for (const s of ['受けたいが受けられない', '受注できる', '数を増やす', '数を減らす', '元請けの経験が無い']) {
    assert.ok(!readme.includes(s), `README: ${s}`);
    assert.ok(!overview.includes(s), `overview: ${s}`);
  }
});

test('F71a: 節の2つ目の段落に就業者・賃金・労働時間の数字と出典が残り、元の文より短い', () => {
  const macro = paragraphs[1];
  for (const s of [
    '685万人', '477万人', '443万円', '527万円', '1,987時間', '1,939時間',
    '国土交通省の参考資料1「改正の背景」', '「労務費に関する基準」',
  ]) {
    assert.ok(macro.includes(s), s);
  }
  assert.ok(macro.length <= 326 * 0.65, `${macro.length} 字`);
});

test('F71a: 受注の箇条は残り、「データと出典」のその資料の行に p.2 の数字がある', () => {
  assert.match(section, /^- 受注: 実績・等級・資金・人の体力は変えません。/m);
  const sources = readme.split('## データと出典')[1].split('\n## ')[0];
  const row = sources.split('\n').find((l) => l.includes('中小建設業への普及促進方策について')) ?? '';
  assert.ok(row.includes('p.2 の 723社 / 9,734社 にも使う'), row);
});

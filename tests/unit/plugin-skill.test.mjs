// F20b の単体の試験: plugin/skills/construction-check(SKILL.md・reference/・条番号の確かめのスクリプト)。指摘の文はすべて架空
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkArticles, extractRefs, toInt, loadSources } from '../../plugin/skills/construction-check/scripts/check-articles.mjs';
import { staleCopies } from '../../scripts/sync-plugin.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SKILL = path.join(ROOT, 'plugin', 'skills', 'construction-check');
const read = (rel) => fs.readFileSync(path.join(SKILL, rel), 'utf8');

test('SKILL.md: 500 行以内で、frontmatter に name(フォルダの名前と同じ・kebab-case)と description がある', () => {
  const s = read('SKILL.md');
  const lines = s.split(/\r?\n/).length;
  assert.ok(lines <= 500, 'SKILL.md が ' + lines + ' 行');
  const fm = s.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(fm, 'frontmatter が無い');
  const name = fm[1].match(/^name:\s*(\S+)\s*$/m)?.[1];
  assert.equal(name, 'construction-check');
  assert.match(name, /^[a-z0-9]+(-[a-z0-9]+)*$/);
  const desc = fm[1].match(/^description:\s*(.+)$/m)?.[1] ?? '';
  assert.ok(desc.length > 0 && desc.length <= 1024);
  // 書類は置き換えた後の中身だけを読む・条番号は道具で確かめる、が手順にある
  assert.match(s, /read_masked/);
  assert.match(s, /check_articles/);
  assert.match(desc, /check_articles/);
  assert.doesNotMatch(desc, /スクリプト/);
});

test('SKILL.md: 根拠に挙げた条番号は、すべて取得した原文にある(見ていない条を根拠にしていない)', () => {
  const { results, ok } = checkArticles(read('SKILL.md'));
  assert.ok(results.length >= 5);
  assert.ok(ok, results.filter((r) => r.status !== 'ある').map((r) => r.label + ' ' + r.reason).join('\n'));
});

test('reference/articles.md: 取得した法令の条がすべて要約の表にあり、「見ていない条」の節がある', () => {
  const s = read('reference/articles.md');
  const sources = loadSources();
  assert.equal(sources.length, 8);
  const table = s.split('## 見ていない条')[0];
  for (const src of sources) assert.ok(table.includes(src.title.replace('（', '(').replace('）', ')')), src.title);
  assert.match(s, /^## 見ていない条$/m);
  assert.match(s, /要約は根拠になりません/);
});

test('条番号の取り出し: 算用数字・全角・漢数字、条の枝番号・項・号・細分', () => {
  assert.equal(toInt('二十四'), 24);
  assert.equal(toInt('百二'), 102);
  assert.equal(toInt('２６'), 26);
  const r = extractRefs('建設業法第二十四条の八第一項と、建設業法施行規則第14条の2第１項第3号ハ。');
  assert.deepEqual(r.map(({ law, article, paragraph, item, subitem }) => ({ law, article, paragraph, item, subitem })), [
    { law: '建設業法', article: '24の8', paragraph: 1, item: null, subitem: null },
    { law: '建設業法施行規則', article: '14の2', paragraph: 1, item: 3, subitem: 'ハ' },
  ]);
  // 号の無い所の片仮名は細分と読まない
  assert.equal(extractRefs('建設業法第3条チェック')[0].subitem, null);
  // 略した法令名は正式な名前に寄せる
  assert.equal(extractRefs('入札契約適正化法第15条第2項')[0].law, '公共工事の入札及び契約の適正化の促進に関する法律');
});

test('架空の指摘(ある): 取得した条・項・号・細分は「ある」で、全体も ok', () => {
  const findings = [
    '- 根拠: 建設業法第24条の8第1項(施工体制台帳を作っていないおそれ)',
    '- 根拠: 建設業法第26条第3項第1号イ',
    '- 根拠: 建設業法施行令第二十七条第一項第三号ト',
    '- 根拠: 建設業法施行規則第14条の2第2項第2号',
    '- 根拠: 入札契約適正化法第15条第2項',
  ].join('\n');
  const { results, ok } = checkArticles(findings);
  assert.equal(results.length, 5);
  assert.deepEqual(results.map((r) => r.status), ['ある', 'ある', 'ある', 'ある', 'ある']);
  assert.equal(ok, true);
});

test('架空の指摘(ない): 取得していない条・無い項・無い号・無い細分は「無い」、法令名の無いものは「確かめられない」で、全体は ok でない', () => {
  const cases = [
    ['建設業法第19条第1項', '無い', /取得した原文に無い条/],
    ['建設業法第24条の8第5項', '無い', /第5項が原文に無い/],
    ['建設業法第26条第3項第3号', '無い', /第3号が原文に無い/],
    ['建設業法第26条第3項第1号ニ', '無い', /第1号ニが原文に無い/],
    ['建設業法施行令第2条第2項', '無い', /第2項が原文に無い/],
    ['法第26条第1項', '確かめられない', /法令名が書かれていない/],
  ];
  for (const [text, status, reason] of cases) {
    const { results, ok } = checkArticles('- 根拠: ' + text);
    assert.equal(results.length, 1, text);
    assert.equal(results[0].status, status, text);
    assert.match(results[0].reason, reason, text);
    assert.equal(ok, false, text);
  }
});

test('架空の指摘(JSON): JSON の中の文字列の条番号を確かめ、ある・無いが混ざれば ok でない', () => {
  const json = JSON.stringify({ findings: [
    { title: '再下請負の通知が無いおそれ', basis: '建設業法第24条の8第2項' },
    { title: '一括下請負のおそれ', basis: '建設業法第22条' },
  ] });
  const { results, ok } = checkArticles(json);
  assert.deepEqual(results.map((r) => [r.label, r.status]), [
    ['建設業法 第24条の8第2項', 'ある'],
    ['建設業法 第22条', '無い'],
  ]);
  assert.equal(ok, false);
});

test('条番号が無い文は、確かめたものが0件で ok(何も「ある」とは言わない)', () => {
  const { results, ok } = checkArticles('台帳の下請負人の欄が空です。');
  assert.equal(results.length, 0);
  assert.equal(ok, true);
});

test('Skill の写し(原文・項と号の切り出しの部品)が元と同じ', () => {
  const stale = staleCopies(ROOT).filter((p) => p.startsWith('plugin/skills/'));
  assert.deepEqual(stale, []);
});

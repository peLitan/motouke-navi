// F26a の単体の試験: plugin/skills/spec-to-rules(仕様書の文から規則表の行を作る Skill の、機械で照合する部分)
// 原文は作品が取り込んだ国の共通仕様書(data/sources/mlit-doboku-spec-r8-1-1-1.txt)。外す行の例はすべて架空
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkRows, listItems, splitSections, UNDETERMINED } from '../../plugin/skills/spec-to-rules/scripts/check-rows.mjs';
import { staleCopies } from '../../scripts/sync-plugin.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SKILL = path.join(ROOT, 'plugin', 'skills', 'spec-to-rules');
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
const SPEC = fs.readFileSync(path.join(ROOT, 'data/sources/mlit-doboku-spec-r8-1-1-1.txt'), 'utf8');
const planItems = readJson('data/plan-items.json');
const schedule = readJson('data/schedule.json');

test('SKILL.md: 500 行以内で、frontmatter に name(フォルダの名前と同じ)と description がある。照らすスクリプトと「判断できない」を書いている', () => {
  const text = fs.readFileSync(path.join(SKILL, 'SKILL.md'), 'utf8');
  assert.ok(text.split('\n').length <= 500);
  const fm = text.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(fm);
  assert.match(fm[1], /^name: spec-to-rules$/m);
  assert.match(fm[1], /^description: \S/m);
  assert.ok(text.includes('scripts/check-rows.mjs'));
  assert.ok(text.includes('判断できない'));
  assert.ok(text.includes('scripts/check-quotes.mjs'));
});

test('照合の部品は作品の src/quote-check.mjs の写しで、元と同じ', () => {
  assert.ok(fs.existsSync(path.join(SKILL, 'scripts', 'lib', 'quote-check.mjs')));
  assert.deepEqual(staleCopies(ROOT).filter((p) => p.includes('spec-to-rules')), []);
});

test('節に分ける: 1-1-1-6 の節は見出しから次の節(1-1-1-7)の前まで', () => {
  const s = splitSections(SPEC);
  const sec = s.get(planItems.section);
  assert.ok(sec.startsWith('1-1-1-6'));
  assert.ok(sec.includes('（16）その他'));
  assert.ok(!sec.includes('コリンズ'));
});

test('1-1-1-6 の文から列挙を拾うと、今の記載項目の表(data/plan-items.json)の番号・名前・抜き書きが再現される', () => {
  const sec = splitSections(SPEC).get('1-1-1-6');
  const rows = listItems(sec, '1-1-1-6');
  assert.equal(rows.length, planItems.items.length);
  rows.forEach((r, i) => {
    const want = planItems.items[i];
    assert.deepEqual({ no: r.no, label: r.label, quote: r.quote }, { no: want.no, label: want.label, quote: want.quote });
  });
});

test('今の表の行(記載項目 16 行と、1-1-1-6 の段取りの行)を照らすと、1行も外れない', () => {
  const sec = splitSections(SPEC).get('1-1-1-6');
  const plan = listItems(sec, '1-1-1-6');
  const sched = schedule.rules.filter((r) => r.section === '1-1-1-6').map((r) => ({ kind: 'schedule', ...r }));
  assert.equal(sched.length, 1);
  const r = checkRows([...plan, ...sched], SPEC);
  assert.equal(r.dropped.length, 0, JSON.stringify(r.dropped));
  assert.equal(r.kept.length, 17);
});

test('段取りの表(data/schedule.json)のほかの行も、同じ照合で外れない(節の中・数字が抜き書きにある)', () => {
  const rows = schedule.rules.map((r) => ({ kind: 'schedule', ...r }));
  const r = checkRows(rows, SPEC);
  assert.deepEqual(r.dropped.map((d) => [d.row.id, d.reasons]), []);
});

test('合わない行は外し、理由を出す(原文に無い・別の節・名前・番号・足した数字・段・理由の無い「判断できない」)', () => {
  const base = { kind: 'schedule', id: 'x', phase: 'start', when: '工事着手前', what: '施工計画書を提出する', to: '監督職員', section: '1-1-1-6', quote: '受注者は、工事着手前または施工方法が確定した時期に工事目的物を完成するために必要な手順や工法等についての施工計画書を監督職員に提出しなければならない。' };
  const cases = [
    [{ ...base, quote: '受注者は、施工計画書を工事着手の7日前までに提出しなければならない。' }, '原文に無い抜き書き'],
    [{ ...base, section: '1-1-1-6', quote: '受注者は、特記仕様書に工事に着手すべき期日について定めがある場合には、その期日までに工事着手しなければならない。' }, '節 1-1-1-6 の中に無い'],
    [{ ...base, section: '9-9-9-9' }, '見出しが原文に見つからない'],
    [{ ...base, when: '工事着手の7日前まで' }, 'when に抜き書きに無い数字(7)'],
    [{ ...base, to: '監督職員(30日以内に)' }, 'to に抜き書きと節に無い数字(30)'],
    [{ ...base, phase: 'before' }, '段(phase)'],
    [{ ...base, what: '' }, 'すること(what)が無い'],
    [{ ...base, quote: '' }, '抜き書き(quote)が無い'],
    [{ ...base, to: UNDETERMINED }, 'to が「判断できない」なのに理由'],
    [{ kind: 'plan-item', section: '1-1-1-6', no: 3, label: '品質証明', quote: '（3）現場組織表' }, '項目の名前(label)が抜き書きに無い'],
    [{ kind: 'plan-item', section: '1-1-1-6', no: 4, label: '現場組織表', quote: '（3）現場組織表' }, '番号(no)が抜き書きの番号と合わない'],
    [{ kind: 'rule', section: '1-1-1-6', quote: '（3）現場組織表' }, '種類(kind)'],
  ];
  const r = checkRows(cases.map(([row]) => row), SPEC);
  assert.equal(r.kept.length, 0);
  assert.equal(r.dropped.length, cases.length);
  r.dropped.forEach((d, i) => assert.ok(d.reasons.join(' / ').includes(cases[i][1]), `${i}: ${d.reasons.join(' / ')}`));
});

test('空白の違いだけは許す(check-quotes.mjs と同じ)。字体・全角半角の違いは許さない', () => {
  const row = { kind: 'plan-item', section: '1-1-1-6', no: 7, label: '施工方法', quote: '（7）施工方法 （主要機械、仮設備計画、\n工事用地等を含む）' };
  assert.equal(checkRows([row], SPEC).kept.length, 1);
  assert.equal(checkRows([{ ...row, quote: '(7)施工方法（主要機械、仮設備計画、工事用地等を含む）' }], SPEC).kept.length, 0);
});

test('「判断できない」の欄は、理由があれば残し、一覧に出す', () => {
  const row = { kind: 'schedule', id: 'done-drawing', phase: 'completion', when: UNDETERMINED, what: '工事完成図を作成する', to: UNDETERMINED, undetermined: { when: '原文に時期の定めが無い', to: '原文に提出の相手が書いていない' }, section: '1-1-1-23', title: '工事完成図', quote: '受注者は、設計図書に従って工事完成図を作成しなければならない。' };
  const text = '1-1-1-23　工事完成図\n受注者は、設計図書に従って工事完成図を作成しなければならない。\n';
  const r = checkRows([row], text);
  assert.equal(r.kept.length, 1);
  assert.deepEqual(r.undetermined[0].fields, ['when', 'to']);
});

test('SKILL.md の行の形の例は、取り込んだ原文で照合を通る', () => {
  const text = fs.readFileSync(path.join(SKILL, 'SKILL.md'), 'utf8');
  const json = text.match(/```json\n([\s\S]*?)```/)[1];
  const { rows } = JSON.parse(json);
  const r = checkRows(rows, SPEC);
  assert.equal(r.dropped.length, 0, JSON.stringify(r.dropped));
});

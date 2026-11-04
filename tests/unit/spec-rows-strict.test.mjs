// F31f: 仕様書の行の照合を厳しくした。反証 第2弾の E-1〜E-6 の再現の入力と、和歌山県の行が 31 のうち 31 残ることを確かめる
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkRows, listItems, normalizeNumbers, splitSections, stripPageLines, MIN_QUOTE } from '../../plugin/skills/spec-to-rules/scripts/check-rows.mjs';
import { parseRulesFile, tableNotice } from '../../src/rules-load.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SPEC = fs.readFileSync(path.join(ROOT, 'fixtures/specs/wakayama_r0711_1-1-1-6_12.txt'), 'utf8');
const FILE = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/specs/wakayama_r0711_rows.json'), 'utf8'));
const row = (id) => FILE.rows.find((r) => r.id === id);
const reasons = (r, text = SPEC) => {
  const out = checkRows([r], text);
  return out.dropped.length ? out.dropped[0].reasons.join(' / ') : '';
};

test('和歌山県の行は 31 のうち 31 残る', () => {
  const r = checkRows(FILE.rows, SPEC);
  assert.deepEqual(r.dropped.map((d) => [d.row.id ?? d.row.no, d.reasons]), []);
  assert.equal(r.kept.length, 31);
});

test('E-1: 漢数字・全角の数字も比べ、数字は単位まで合わせる', () => {
  const corins = row('start-corins');
  assert.match(reasons({ ...corins, when: '契約後三十日以内' }), /when に抜き書きに無い数字\(30\)/);
  assert.match(reasons({ ...corins, when: '契約後３０日以内' }), /when に抜き書きに無い数字\(30\)/);
  assert.match(reasons({ ...corins, when: '500日以内' }), /when に抜き書きに無い数字\(500\)/);
  assert.match(reasons({ ...row('land-return'), when: '使用終了後1日以内' }), /when に抜き書きに無い数字\(1日\)/);
});

test('E-1: 「契約後十日以内」は数は合うが、抜き書きの「除き」が落ちているので外す。算用数字でも同じ', () => {
  const corins = row('start-corins');
  for (const when of ['契約後十日以内', '契約後10日以内']) assert.match(reasons({ ...corins, when }), /10日 に、抜き書きの「除き」の条件が無い/);
  assert.equal(reasons({ ...corins, when: '契約後、土曜日、日曜日、祝日等を除き十日以内' }), '');
  assert.equal(reasons({ ...corins, when: '契約後、土曜日、日曜日、祝日等を除き１０日以内' }), '');
});

test('E-1: 原文が漢数字のときも、同じ数なら残す。条件の無い日数は「除き」を求めない', () => {
  const text = '1-1-1-1 試し\n受注者は、契約の日から七日以内に計画書を提出しなければならない。\n';
  const base = { kind: 'schedule', id: 'a', phase: 'start', what: '計画書を提出する', to: '監督員', section: '1-1-1-1', quote: '受注者は、契約の日から七日以内に計画書を提出しなければならない。' };
  assert.equal(reasons({ ...base, when: '契約の日から7日以内' }, text), '');
  assert.match(reasons({ ...base, when: '契約の日から8日以内' }, text), /無い数字\(8\)/);
});

test('数字のそろえ方: 単位の続かない漢数字は数にしない。桁の区切り・万・億をそろえる', () => {
  for (const [a, b] of [['五百万円', '500万円'], ['5,000,000円', '500万円'], ['一万五千円', '15,000円'], ['二十一日', '21日'], ['二〇日', '20日'], ['第一項', '第1項']]) {
    assert.equal(normalizeNumbers(a), normalizeNumbers(b), a);
  }
  for (const s of ['一部', '一括', '十分に', '一人親方', '三分の一', '一般事項']) assert.equal(normalizeNumbers(s), s);
  const text = '1-1-1-1 試し\n受注者は、工事の一部を十分に確かめ、計画書を提出しなければならない。\n';
  const r = { kind: 'schedule', id: 'a', phase: 'start', when: '工事の前に', what: '一部の計画書を十分に確かめて提出する', to: '監督員', section: '1-1-1-1', quote: '受注者は、工事の一部を十分に確かめ、計画書を提出しなければならない。' };
  assert.equal(reasons(r, text), '');
});

test('E-2: 抜き書きは短いと外し、長くても what の語が無い文は根拠にしない', () => {
  const base = { kind: 'schedule', id: 'x', phase: 'work', when: '提出の時', to: '監督員', section: '1-1-1-12', title: '施工体制台帳' };
  assert.match(reasons({ ...base, what: '施工計画書を提出する', quote: '監督員に提出しなければならない。' }), /what\)の語\(施工計画書\)が抜き書きに無い/);
  assert.match(reasons({ ...base, what: '施工計画書を監督員に提出する', quote: '監督員に提出しなければならない。' }), /施工計画書/);
  // 「その写し」は同じ文の前を指すので、同じ文の前の語は探す。別の文の語は探さない
  const copy = { ...base, what: '施工体制台帳の写しを提出する', section: '1-1-1-12', quote: 'その写しを監督員に提出しなければならない。' };
  assert.equal(reasons(copy), '');
  assert.match(reasons({ ...copy, what: '施工計画書の写しを提出する' }), /施工計画書/);
  assert.match(reasons({ ...base, what: '速やかに出す', quote: '速やかに監督員' }), new RegExp(MIN_QUOTE + '字より少ない'));
  assert.equal(reasons({ ...base, what: '施工体制台帳を変更して提出する', quote: '施工体制台帳及び施工体系図に変更が生じた場合は、その都度速やかに監督員に提出しなければならない。' }), '');
});

test('E-3: 記載項目は no が要り、quote は列挙の1行の全体、label はその名前', () => {
  const sec = '1-1-1-6';
  assert.match(reasons({ kind: 'plan-item', section: '1-1-1-8', label: '監督員', quote: '監督員' }), /番号\(no\)が無い/);
  assert.match(reasons({ kind: 'plan-item', section: '1-1-1-8', label: '監督員', quote: '監督員' }), /列挙の1行/);
  assert.match(reasons({ kind: 'plan-item', section: sec, label: '総則', quote: '第1編 共通編 第1章 総則' }), /番号\(no\)が無い/);
  assert.match(reasons({ kind: 'plan-item', section: sec, no: 1, label: '工事', quote: '（1）工事概要' }), /label\)が列挙の1行の名前と違う/);
  assert.match(reasons({ kind: 'plan-item', section: sec, no: 1, label: '工事', quote: '（1）工事' }), /列挙の1行/);
  assert.match(reasons({ kind: 'plan-item', section: sec, no: '判断できない', label: '工事概要', quote: '（1）工事概要', undetermined: { no: '分からない' } }), /番号\(no\)が無い/);
  assert.equal(reasons({ kind: 'plan-item', section: sec, no: 1, label: '工事概要', quote: '（1）工事概要' }), '');
});

test('E-4: ページの下のページ番号と欄外の見出しを除き、ページをまたぐ文が照合を通る', () => {
  const cases = [
    ['1-1-1-11', '下請契約の賃金を整備する', '下請契約を締結するときは、下請負に使用される技術者'],
    ['1-1-1-8', '口頭による指示等を確認する', '口頭による指示等が行われた場合には'],
  ];
  for (const [section, what, quote] of cases) {
    assert.equal(reasons({ kind: 'schedule', id: 'y', phase: 'work', when: '後日', what, to: '監督員', section, quote }), '', quote);
  }
  const cleaned = stripPageLines(SPEC);
  assert.ok(!cleaned.includes('第1編 共通編 第1章 総則 \n'));
  assert.ok(!/^1 −\d+$/m.test(cleaned));
  assert.ok(cleaned.startsWith('出典'), '1行目の出典は残す');
  assert.equal(listItems(splitSections(cleaned).get('1-1-1-6'), '1-1-1-6').length, 16);
});

test('E-4: ページ番号の隣でも1回しか出ない本文の行は残す。ページ番号の無い文は変えない', () => {
  const text = '本文の一\n12-3\n欄外\n本文の二\n12-4\n欄外\n本文の三\n';
  assert.equal(stripPageLines(text), '本文の一\n本文の二\n本文の三\n');
  const plain = '1-1-1-1 試し\n第1章 総則\n第1章 総則\n';
  assert.equal(stripPageLines(plain), plain);
});

test('E-5: 画面の注記は「照合済み」と書かず、照らしていないとだけ言う。手書きの行でも同じ', () => {
  const source = { publisher: '架空県', title: '架空の仕様書', edition: '令和9年1月' };
  const t = parseRulesFile(JSON.stringify({ source, rows: [{ kind: 'schedule', phase: 'start', when: '着手前', what: '計画書を出す', to: '監督員', section: '1-1-1-6', quote: '出す' }] }));
  const notice = tableNotice(t);
  assert.ok(notice.includes('画面では原文と照らしていません'));
  assert.ok(!/照合/.test(notice));
  assert.ok(!notice.includes('残った行'));
});

test('E-6: section の無い行は、見出しのある文でも無い文でも外す。画面の読み込みと同じ。SKILL.md も空にしろと書かない', () => {
  const r = { kind: 'schedule', id: 'z', phase: 'start', when: '着手前', what: '計画書を提出する', to: '監督員', section: '', quote: '受注者は、計画書を監督員に提出しなければならない。' };
  assert.match(reasons(r, '第1条\n' + r.quote + '\n'), /節\(section\)が無い/);
  assert.match(reasons(r, '1-1-1-1 試し\n' + r.quote + '\n'), /節\(section\)が無い/);
  const source = { publisher: '架空県', title: '架空の仕様書', edition: '令和9年1月' };
  assert.throws(() => parseRulesFile(JSON.stringify({ source, rows: [r] })), /section/);
  const skill = fs.readFileSync(path.join(ROOT, 'plugin/skills/spec-to-rules/SKILL.md'), 'utf8');
  assert.ok(!skill.includes('`section` を空にし'));
});

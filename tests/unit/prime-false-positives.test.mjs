// F77a: 元請けの実績の知らせの誤報と見落とし。文はすべて架空
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { findPrimeExperience } from '../../src/prime-experience.mjs';
import { bidCheck } from '../../src/bid-check.mjs';
import { readBidForm } from '../../src/ui/form.mjs';
import { needsCheckPoints } from '../../src/ui/answers.mjs';
import { renderBidResult, renderOpenItems } from '../../src/ui/view.mjs';
import { stage1Rows } from '../../src/export.mjs';
import { judgeTaicho } from '../../src/taicho.mjs';
import { SAMPLE } from '../../src/sample.mjs';

const BASE = '元請として同種工事の施工実績を有すること。';

test('誤報の5文は当たらない', () => {
  for (const s of [
    '配置予定技術者の要件：元請として同種工事を施工した経験を有すること',
    '建設業法第26条の規定により配置する監理技術者は、元請として同種工事の施工実績を有すること',
    '同種工事の施工実績を元請として有する監理技術者を配置すること',
    BASE + 'ただし、下請としての実績も認める。',
    '元請又は一次下請として同種工事の施工実績を有すること',
  ]) assert.equal(findPrimeExperience(s), null, s);
});

test('見落としの1文・否定の2文・会社と技術者を並べた1文は当たる', () => {
  assert.equal(findPrimeExperience('施工実績\n(1) 元請として同種工事を施工したこと'), '(1) 元請として同種工事を施工したこと');
  assert.equal(findPrimeExperience(BASE + 'ただし、下請としての実績は認めない。'), BASE);
  assert.equal(findPrimeExperience(BASE + 'ただし、下請の実績は不可。'), BASE);
  const both = '企業及び配置予定技術者が、元請として同種工事の施工実績を有すること';
  assert.equal(findPrimeExperience(both), both);
});

test('技術者の文: 読点までの語で見る。会社の語があれば会社への条件として残す', () => {
  for (const s of [
    '本工事に配置を予定する主任技術者又は監理技術者は、元請として同種工事の施工実績を有すること。',
    '配置予定技術者の経験：元請として同種工事の施工実績を有すること。',
    '配置予定技術者の資格及び経験として、元請として同種工事の施工実績を有すること。',
    '(3) 配置予定技術者等は、元請として同種工事の施工実績を有すること。',
  ]) assert.equal(findPrimeExperience(s), null, s);
  for (const s of [
    '入札参加者及び配置予定技術者は、元請として同種工事の施工実績を有すること。',
    '会社及び配置予定技術者が、元請として同種工事の施工実績を有すること。',
    '法人及び配置予定技術者が、元請として同種工事の施工実績を有すること。',
    '申請者及び配置予定技術者が、元請として同種工事の施工実績を有すること。',
  ]) assert.equal(findPrimeExperience(s), s, s);
  // 会社の語の扱いの限界: 技術者が主語でも、読点までに会社の語があれば出る(評価.md に書いた)
  const owner = '入札参加者の配置する技術者は、元請として同種工事の施工実績を有すること。';
  assert.equal(findPrimeExperience(owner), owner);
  // 読点より後の技術者は見ない
  const later = '元請として同種工事の施工実績を有し、配置予定技術者は専任であること。';
  assert.equal(findPrimeExperience(later), later);
});

test('「…を有する監理技術者を配置する」の形は当たらない。形が違えば会社への条件のまま', () => {
  for (const s of [
    '元請として同種工事の施工実績を有する主任技術者を配置すること。',
    '元請として同種工事の施工実績を有する監理技術者を置くこと。',
    '元請として同種工事の施工実績を有する監理技術者であること。',
    '元請として同種工事の施工実績を有する専任の監理技術者を配置できること。',
    '元請として同種工事の施工実績を有する主任技術者又は監理技術者を配置すること。',
    '元請として同種工事の施工実績を有する主任技術者を当該工事に専任で配置できること。',
  ]) assert.equal(findPrimeExperience(s), null, s);
  // 文ごとに見る限界: 会社への条件が同じ文にあっても外れる(評価.md に書いた)
  assert.equal(findPrimeExperience('元請として同種工事の施工実績を有し、かつ、同種工事の経験を有する監理技術者を配置すること。'), null);
  const other = '元請として同種工事の施工実績を有する者であること。';
  assert.equal(findPrimeExperience(other), other);
});

test('元請又は一次下請: 書き方の違いでも問わない文として外す', () => {
  for (const s of [
    '元請若しくは二次下請として同種工事の施工実績を有すること。',
    '元請け又は１次の下請けとして同種工事の施工実績を有すること。',
    '元請もしくは2次下請として同種工事の施工実績を有すること。',
  ]) assert.equal(findPrimeExperience(s), null, s);
});

test('次の文: 「ただし」で下請けの実績を認める形だけ外す', () => {
  for (const next of [
    'ただし、下請としての実績を認める。',
    'ただし、下請としての実績も認めます。',
    'ただし、下請としての実績も認められる。',
    'ただし、下請としての実績を含める。',
    'ただし、下請としての実績を含む。',
    'ただし、下請の実績も可とする。',
    'ただし、下請の実績でも差し支えない。',
    'ただし、下請の実績でもよい。',
    'ただし、下請の実績も対象とする。',
    '但し、下請としての実績も認める。',
    '(ただし、下請としての実績も認める。)',
  ]) assert.equal(findPrimeExperience(BASE + next), null, next);
  assert.equal(findPrimeExperience(BASE + '\nただし、下請としての実績も認める。'), null, '行が分かれていても次の文');
});

test('次の文: 否定と、下請けを認める文でないものは外さない', () => {
  for (const next of [
    'ただし、下請としての実績は認めません。',
    'ただし、下請としての実績は認められない。',
    'ただし、下請としての実績は認められません。',
    'ただし、下請としての実績は認めていない。',
    'ただし、下請としての実績は認めず、元請に限る。',
    'ただし、下請としての実績は含まない。',
    'ただし、下請としての実績は含みません。',
    'ただし、下請としての実績は含めない。',
    'ただし、下請としての実績は除く。',
    'ただし、下請で発注者が認めたものは除く。',
    'ただし、下請として施工した工事の実績については、これを認めない。',
    'ただし、下請として施工した工事の実績については、いずれも不可とする。',
    'ただし、下請の場合は建設業の許可を有すること。',
    'ただし、下請の場合は発注者の認可を受けること。',
    'ただし、工事成績が65点未満のものは認めない。',
    'ただし、共同企業体の構成員としての実績も認める。',
  ]) assert.equal(findPrimeExperience(BASE + next), BASE, next);
  // 「ただし」で始まらない文は見ない
  assert.equal(findPrimeExperience(BASE + 'なお、下請としての実績も認める。'), BASE);
  assert.equal(findPrimeExperience(BASE + '工期は別途定める。ただし、下請としての実績も認める。'), BASE);
});

test('次の文で外れた後も、続きの文は見る', () => {
  const second = 'また、元請として完成した工事の実績を有すること。';
  assert.equal(findPrimeExperience(BASE + 'ただし、下請としての実績も認める。' + second), second);
});

test('施工した(こと|経験)を足しても、求めていない文は当たらない', () => {
  for (const s of [
    '元請として同種工事を施工した場合は加点する。',
    '元請として同種工事を施工したことがある場合は評価点を加える。',
    '同種工事を施工したこと。',
  ]) assert.equal(findPrimeExperience(s), null, s);
});

test('見本と手元の架空の公告の当たりは変わらない', () => {
  const dir = new URL('../../fixtures/bid-intake/公告/', import.meta.url);
  const read = (name) => fs.readFileSync(new URL(name, dir), 'utf8');
  assert.match(findPrimeExperience(read('N1_国の総合評価.txt')), /元請けとして完成・引渡しが完了した河川工事/);
  assert.match(findPrimeExperience(read('N3_市の説明書.txt')), /元請けとして学校の耐震改修工事を完成した実績/);
  for (const name of ['N2_県の表形式.md', 'N3_市の公告.txt', 'N4_町の依頼文.txt', 'N5_民間の見積依頼.txt']) assert.equal(findPrimeExperience(read(name)), null, name);
});

test('下請けの総額の点: 結果の確認が要る点・最後の一覧・CSV に出る', () => {
  const values = { ...SAMPLE.form, 'contract-amount': '10,000,000', 'subcontract-total': '90,000,000' };
  const out = bidCheck(readBidForm(values));
  assert.ok(out.checks.some((c) => c.key === 'subcontract-over'));
  assert.match(renderBidResult(out, values), /下請けの総額\(90,000,000円\)が請負代金の見込み\(10,000,000円\)より大きくなっています/);
  assert.match(renderOpenItems(out, values), /桁か欄を確かめてください/);
  assert.ok(needsCheckPoints(out, values).some((p) => p.label === '下請けの総額' && p.status === 'needs_check'));
  const row = stage1Rows(out, judgeTaicho(readBidForm(values)), '注意').find((r) => r.join('|').includes('桁か欄'));
  assert.ok(row, 'CSV の行が無い');
  assert.ok(row.includes('確認が要る'), row.join('|'));
  const reversed = bidCheck(readBidForm({ ...SAMPLE.form, 'contract-amount': '300,000,000', 'subcontract-total': '60,000,000' }));
  assert.ok(!reversed.checks.some((c) => c.key === 'subcontract-over'));
});

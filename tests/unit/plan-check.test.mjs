// 施工計画書の目次の点検(F07)の単体テスト。目次の値はすべて架空
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkPlanToc, tocHeading } from '../../src/plan-check.mjs';
import { SAMPLE } from '../../src/sample.mjs';

test('頭の番号・かっこの補足・末尾のページ番号を取り除く', () => {
  assert.equal(tocHeading('１０．緊急時の体制及び対応'), '緊急時の体制及び対応');
  assert.equal(tocHeading('(7) 施工方法(主要機械、仮設備計画、工事用地等を含む)'), '施工方法');
  assert.equal(tocHeading('第3章 安全管理 ……… 12'), '安全管理');
  assert.equal(tocHeading('1-2 計画工程表'), '計画工程表');
});

test('施工方法のかっこの中の「主要機械」では、主要船舶・機械を見つけたことにしない', () => {
  const toc = '1. 施工方法(主要機械、仮設備計画、工事用地等を含む)';
  const out = checkPlanToc(toc);
  assert.ok(out.candidates.some((c) => c.item === '主要船舶・機械'));
  assert.ok(!out.candidates.some((c) => c.item === '施工方法'));
});

test('書き方の違う見出し(週休２日・建設副産物)は「書き方が違う」として見つける', () => {
  const out = checkPlanToc('1. 週休２日の取組み\n2. 建設副産物の処理');
  const f = Object.fromEntries(out.found.map((x) => [x.item, x]));
  assert.equal(f['法定休日・所定休日'].byAlias, true);
  assert.equal(f['再生資源の利用の促進と建設副産物の適正処理方法'].byAlias, true);
  assert.ok(out.notes.some((n) => n.includes('書き方が違う')));
});

test('記載項目に当たらない行は extra に出し、題の行は出さない', () => {
  const out = checkPlanToc('施工計画書 目次\n1. 工事概要\n2. 写真管理の方法');
  assert.deepEqual(out.extra, ['2. 写真管理の方法']);
});

test('見本の目次では、(15)と(16)が抜けの候補になり、ページは86', () => {
  const out = checkPlanToc(SAMPLE.documents.planToc);
  assert.deepEqual(out.candidates.map((c) => c.no), [15, 16]);
  assert.ok(out.candidates.every((c) => c.basis.page === 86 && c.basis.section === '1-1-1-6'));
});

test('目次が空なら止める', () => {
  assert.throws(() => checkPlanToc('  \n '), /目次が空/);
});

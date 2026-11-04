// F31e: 反証 第2弾の再現の入力(D-1〜D-4)で、台帳の点検が取り違えないかを確かめる。台帳の値はすべて架空
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkChecklistText } from '../../src/checklist.mjs';
import { parseLedgerText } from '../../src/ledger-text.mjs';
import { licenseShaped } from '../../src/ledger-reading.mjs';
import { checkTaicho } from '../../src/check-taicho.mjs';
import { addChecklistCandidates } from '../../src/ledger-check.mjs';

const find = (res, entityPart, itemId) => res.rows.find((r) => r.entity.includes(entityPart) && r.itemId === itemId);
const part = (row, label) => row.parts.find((p) => p.label === label);
const table = (rows) => ['| 項目 | 内容 |', '|---|---|', ...rows].join('\n');

function ledger({ primeRows = [], engineerRows = [], subRows = [] }) {
  return [
    '工事名: 架空ためし改良工事', '',
    '## 1. 作成建設業者(元請)', '', table(['| 商号 | 架空建設株式会社 |', '| 許可番号 | 架空県知事 許可(特-06)第00001号 |', ...primeRows]), '',
    '## 3. 元請の技術者等', '', table(engineerRows), '',
    '## 4. 下請負人(一次)', '', '### 4-1. 架空工業株式会社', '', table(subRows), '',
  ].join('\n');
}

const KANRI = ['| 監理技術者 氏名 | 甲野 一郎 |', '| 資格 | 1級土木施工管理技士 |', '| 専任・非専任 | 専任 |'];
const BLANK_SHUNIN = ['| 主任技術者 氏名 | |', '| 資格 | |', '| 専任・非専任 | |'];
const SUB_LICENSE = '| 許可番号 | 架空県知事 許可(般-05)第00002号 |';
const NOT_LICENSE = ['申請中', '許可不要(軽微な工事)', '500万円未満のため不要', '不要', '該当せず', '（なし）', 'なし ※個人', '別紙のとおり', '有', '12345'];

test('D-1: 許可番号の形でない値は、主任技術者の欄が空でも「空」と言い切らない', () => {
  for (const v of NOT_LICENSE) {
    const r = checkChecklistText(ledger({ engineerRows: KANRI, subRows: ['| 許可番号 | ' + v + ' |', ...BLANK_SHUNIN] }));
    const ho = find(r, '架空工業', '4-ho');
    assert.equal(ho.status, 'unknown', v + ': ' + ho.reason);
    assert.ok(ho.reason.includes('許可番号の欄が「' + v + '」'), ho.reason);
    assert.doesNotMatch(ho.reason, /当てはまると読みました/);
  }
});

test('D-1: 許可番号の形なら今までどおり建設業者として「空」。形の見分け', () => {
  const r = checkChecklistText(ledger({ engineerRows: KANRI, subRows: [SUB_LICENSE, ...BLANK_SHUNIN] }));
  const ho = find(r, '架空工業', '4-ho');
  assert.equal(ho.status, 'empty', ho.reason);
  assert.match(ho.reason, /許可番号の形/);
  for (const v of ['架空県知事 許可(般-05)第00002号', '国土交通大臣 許可（特－６）第１２３４５号', '国土交通大臣許可(特-06)第xxxx号', '架空県知事(般-5)第1号', '架空県知事 許可 般-05 第00002号', '国土交通大臣 許可 特定 第12号']) assert.ok(licenseShaped(v), v);
  // 知事・大臣、般・特、第…号のどれかが欠ける形と、許可があると決められない添え書き
  for (const v of [...NOT_LICENSE, '', '第00002号', '(般-05)第00002号', '架空県知事 第00002号', '架空県知事 許可(般-05)', '架空県知事 許可(般-05)第00002号(更新申請中)', '架空県知事 許可(般-05)第00002号 取得予定']) assert.ok(!licenseShaped(v), v);
});

test('D-1: 点検の候補でも、許可番号の形でない下請けの技術者の空は抜けと言わず「判断できない」に出す', () => {
  const text = ledger({ engineerRows: KANRI, subRows: ['| 許可番号 | 申請中 |', ...BLANK_SHUNIN] });
  const parsed = parseLedgerText(text);
  const input = { project: { ...parsed.project, ordererType: 'public' }, prime: parsed.prime, subcontractors: parsed.subcontractors };
  const out = addChecklistCandidates(checkTaicho(input), parsed, checkChecklistText(text));
  const sub = (x) => x.target.includes('架空工業') && x.field === 'engineer';
  assert.equal(out.candidates.filter(sub).length, 0);
  const u = out.undecidable.find(sub);
  assert.match(u.message, /「申請中」で許可番号の形と読めず/);
  // 形のある許可番号なら抜けの候補のまま
  const text2 = ledger({ engineerRows: KANRI, subRows: [SUB_LICENSE, ...BLANK_SHUNIN] });
  const p2 = parseLedgerText(text2);
  const out2 = addChecklistCandidates(checkTaicho({ project: { ...p2.project, ordererType: 'public' }, prime: p2.prime, subcontractors: p2.subcontractors }), p2, checkChecklistText(text2));
  assert.equal(out2.candidates.filter(sub).length, 1);
  assert.equal(out2.undecidable.filter(sub).length, 0);
});

const D2 = ['| 監理技術者補佐 | 甲野 四郎 |', '| 資格 | 1級土木施工管理技士補 |', '| 監理技術者 氏名 | 甲野 一郎 |', '| 資格 | 1級土木施工管理技士 |'];

test('D-2: 補佐の行の次の「資格」を監理技術者の資格に使わない(行の順によらない)', () => {
  const orders = [D2, [...D2.slice(2), ...D2.slice(0, 2)]];
  for (const rows of orders) {
    const r = checkChecklistText(ledger({ engineerRows: [...rows, '| 専任・非専任 | 専任 |'] }));
    const ho = find(r, '作成建設業者', '2-ho');
    assert.equal(part(ho, '技術者の氏名').value, '甲野 一郎');
    assert.equal(part(ho, '技術者の資格').value, '1級土木施工管理技士', ho.value);
    const he = find(r, '作成建設業者', '2-he');
    assert.equal(part(he, '監理技術者補佐の氏名').value, '甲野 四郎');
    assert.equal(part(he, '監理技術者補佐の資格').value, '1級土木施工管理技士補');
    assert.equal(he.status, 'value', he.reason);
    const p = parseLedgerText(ledger({ engineerRows: rows }));
    assert.equal(p.prime.engineer.name, '甲野 一郎');
    assert.equal(p.prime.engineer.qualification, '1級土木施工管理技士');
    assert.equal(p.prime.engineer.assistant.qualification, '1級土木施工管理技士補');
  }
});

test('D-2: 補佐の行に続く「専任・非専任」を監理技術者の欄に使わない', () => {
  const r = checkChecklistText(ledger({ engineerRows: ['| 監理技術者 氏名 | 甲野 一郎 |', '| 資格 | 1級土木施工管理技士 |', '| 監理技術者補佐 | 甲野 四郎 |', '| 資格 | 1級土木施工管理技士補 |', '| 専任・非専任 | 専任 |'] }));
  const ho = find(r, '作成建設業者', '2-ho');
  assert.equal(part(ho, '専任か否か').state, 'missing');
  assert.equal(ho.status, 'unknown', ho.reason);
  const p = parseLedgerText(ledger({ engineerRows: ['| 監理技術者 氏名 | 甲野 一郎 |', '| 監理技術者補佐 | 甲野 四郎 |', '| 専任・非専任 | 専任 |'] }));
  assert.equal(p.prime.engineer.dedicated, null);
  assert.equal(p.prime.engineer.assistant.dedicated, true);
});

test('D-2: 専門技術者の行の氏名・資格を、監理技術者・主任技術者のものに使わない', () => {
  const rows = ['| 専門技術者 | 甲野 六郎 |', '| 資格 | 2級土木施工管理技士 |'];
  const shunin = ['| 主任技術者 氏名 | 甲野 二郎 |', '| 資格 | 1級建築施工管理技士 |'];
  const text = ledger({ engineerRows: [...KANRI, ...rows], subRows: [SUB_LICENSE, ...rows, ...shunin] });
  const p = parseLedgerText(text);
  assert.equal(p.prime.engineer.name, '甲野 一郎');
  assert.equal(p.prime.engineer.qualification, '1級土木施工管理技士');
  assert.equal(p.subcontractors[0].engineer.name, '甲野 二郎');
  assert.equal(p.subcontractors[0].engineer.qualification, '1級建築施工管理技士');
  const r = checkChecklistText(text);
  assert.equal(part(find(r, '架空工業', '4-ho'), '主任技術者の資格').value, '1級建築施工管理技士');
  assert.equal(part(find(r, '架空工業', '4-he'), '専門技術者などの資格').value, '2級土木施工管理技士');
  // 専門技術者が主任技術者より後ろでも同じ。「専門技術者 氏名」の行も主任技術者の氏名にしない
  const p2 = parseLedgerText(ledger({ engineerRows: KANRI, subRows: [SUB_LICENSE, ...shunin, '| 専門技術者 氏名 | 甲野 六郎 |', '| 資格 | 2級土木施工管理技士 |'] }));
  assert.equal(p2.subcontractors[0].engineer.name, '甲野 二郎');
  assert.equal(p2.subcontractors[0].engineer.qualification, '1級建築施工管理技士');
  assert.ok(p2.warnings.some((w) => w.includes('専門技術者 氏名') && w.includes('点検に使っていない')), p2.warnings.join('\n'));
});

test('D-2: 節が変われば補佐の続きとして読まない', () => {
  const text = ['## 3. 元請の技術者等', '', table(['| 監理技術者補佐 | 甲野 四郎 |']), '', '## 3-2. 監理技術者', '', '### 技術者', '', table(['| 資格 | 1級土木施工管理技士 |']), ''].join('\n');
  // 下の節の見出しに持ち主があるので、資格は補佐の続きではない
  assert.equal(parseLedgerText(text).prime.engineer.qualification, '1級土木施工管理技士');
  const ho = checkChecklistText(text).rows.find((x) => x.itemId === '2-ho');
  assert.equal(part(ho, '技術者の資格').value, '1級土木施工管理技士');
});

test('D-3: 作業員の保険の欄を会社の保険として読まない', () => {
  const row = '| 作業員の健康保険 / 厚生年金 / 雇用保険 | 加入 / 加入 / 加入 |';
  const r = checkChecklistText(ledger({ primeRows: [row], engineerRows: KANRI, subRows: [SUB_LICENSE, row] }));
  for (const [ent, id] of [['作成建設業者', '1-ro'], ['架空工業', '3-ha']]) {
    const x = find(r, ent, id);
    assert.equal(x.status, 'unknown', id + ' ' + x.reason);
    assert.ok(x.parts.every((p) => p.state === 'missing'), x.value);
  }
  for (const key of ['従事者の健康保険', '労働者の健康保険', '技能者の健康保険']) {
    const x = find(checkChecklistText(ledger({ primeRows: ['| ' + key + ' | 加入 |'], engineerRows: KANRI })), '作成建設業者', '1-ro');
    assert.equal(part(x, '健康保険').state, 'missing', key);
  }
  // 会社の欄と作業員の欄が両方あれば会社の欄を読む
  const r2 = checkChecklistText(ledger({ primeRows: [row, '| 健康保険 / 厚生年金 / 雇用保険 | 加入 / 未加入 / 適用除外 |'], engineerRows: KANRI }));
  assert.equal(part(find(r2, '作成建設業者', '1-ro'), '厚生年金保険').value, '未加入');
});

test('D-4: 「・」「、」で区切ったまとめ欄も欄ごとに分ける', () => {
  const sub = (row) => find(checkChecklistText(ledger({ engineerRows: KANRI, subRows: [SUB_LICENSE, row] })), '架空工業', '3-ha');
  const a = sub('| 健康保険・厚生年金・雇用保険 | 加入・ ・加入 |');
  assert.equal(a.status, 'empty', a.reason);
  assert.equal(part(a, '厚生年金保険').state, 'blank');
  assert.equal(part(a, '雇用保険').value, '加入');
  const b = sub('| 健康保険、厚生年金、雇用保険 | 加入、未加入、 |');
  assert.equal(b.status, 'empty', b.reason);
  assert.equal(part(b, '厚生年金保険').value, '未加入');
  assert.equal(part(b, '雇用保険').state, 'blank');
  // 全部に値があれば値。区切りの字が欄名と値で違っても分ける。かっこの中の区切りでは分けない
  assert.equal(sub('| 健康保険・厚生年金・雇用保険 | 加入・加入・適用除外 |').status, 'value');
  assert.equal(part(sub('| 健康保険・厚生年金・雇用保険 | 加入、加入、適用除外 |'), '雇用保険').value, '適用除外');
  const c = sub('| 健康保険、厚生年金、雇用保険 | 加入(協会けんぽ・本店)、加入、加入 |');
  assert.equal(part(c, '健康保険').value, '加入(協会けんぽ・本店)');
  assert.equal(c.status, 'value', c.reason);
  // 数が合わなければ決めない。値が1つなら今までどおり1つの値
  assert.equal(sub('| 健康保険・厚生年金・雇用保険 | 加入・加入 |').status, 'unknown');
  assert.equal(sub('| 健康保険・厚生年金・雇用保険 | 加入 |').status, 'value');
  // 元請けの節も同じ
  const r = checkChecklistText(ledger({ primeRows: ['| 健康保険・厚生年金・雇用保険 | 加入・ ・加入 |'], engineerRows: KANRI }));
  assert.equal(find(r, '作成建設業者', '1-ro').status, 'empty');
});

test('D-4: 保険でない欄の値は「・」「、」で分けない', () => {
  const r = checkChecklistText(ledger({ engineerRows: ['| 監理技術者 氏名 | 甲野 一郎 |', '| 資格 | 1級土木施工管理技士 |', '| 専任・非専任 | 専任・常駐 |'], subRows: [SUB_LICENSE, '| 商号・名称 | 架空・工業、株式会社 |', '| 住所・所在地 | 架空市一丁目、二番、三号 |'] }));
  const ho = find(r, '作成建設業者', '2-ho');
  assert.equal(part(ho, '専任か否か').value, '専任・常駐');
  const i = find(r, '架空工業', '3-i');
  assert.equal(part(i, '住所').value, '架空市一丁目、二番、三号');
  assert.equal(i.status, 'value', i.reason);
});

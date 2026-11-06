// F41a の単体の試験: plugin/skills/bid-intake の照合と食い違いの見つけ方、画面の読み込み。値はすべて架空
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkConditions, parseAmounts, parseDates, taxState, declaredUnit, eraConflicts, renderMarkdown, summaryLine, KEYS, STATUS } from '../../plugin/skills/bid-intake/scripts/check-conditions.mjs';
import { parseIntakeFile, intakeLines } from '../../src/intake-load.mjs';
import { loadIntakeFile } from '../../src/ui/app.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SAMPLE = path.join(ROOT, 'docs/samples/bid-intake');
const src = (text, file = '公告.txt') => [{ file, text }];
const run = (text, conditions, notes) => checkConditions({ source: { title: '架空の公告' }, conditions, notes }, Array.isArray(text) ? text : src(text));
const row = (r, key) => r.rows.find((x) => x.key === key);
const flags = (r, key) => row(r, key).flags.join(' / ');
const BUDGET = '予定価格 金 82,500,000円(税込み)';
const budget = (over = {}) => ({ key: 'budget', value: '82,500,000円', quote: BUDGET, ...over });

test('金額を読む: 全角・漢数字・億万・千円・小数・単位の語', () => {
  const y = (s) => parseAmounts(s).map((a) => a.yen);
  assert.deepEqual(y('８２，５００，０００円'), [82500000]);
  assert.deepEqual(y('金八千二百五十万円'), [82500000]);
  assert.deepEqual(y('1億2,000万円'), [120000000]);
  assert.deepEqual(y('123,400千円'), [123400000]);
  assert.deepEqual(y('3百万円'), [3000000]);
  assert.deepEqual(y('1.2億円'), [120000000]);
  assert.deepEqual(y('12.5万円'), [125000]);
  assert.deepEqual(y('(単位:千円)'), []);
  assert.deepEqual(y('(単位:百万円)'), []);
  assert.equal(parseAmounts('12,34,000円')[0].badComma, true);
  assert.equal(parseAmounts('1,234,000円')[0].badComma, false);
});

test('日付を読む: 和暦・西暦・漢数字・元年・暦に無い日', () => {
  assert.deepEqual(parseDates('令和9年4月1日').map((d) => [d.y, d.m, d.d, d.valid]), [[2027, 4, 1, true]]);
  assert.deepEqual(parseDates('令和九年四月一日').map((d) => d.y), [2027]);
  assert.deepEqual(parseDates('令和元年5月1日').map((d) => d.y), [2019]);
  assert.deepEqual(parseDates('２０２７年３月１日').map((d) => d.y), [2027]);
  assert.equal(parseDates('令和9年2月30日')[0].valid, false);
  assert.equal(parseDates('令和10年2月29日')[0].valid, true);
});

test('税と単位の言い方', () => {
  assert.equal(taxState('消費税及び地方消費税の額を含む'), 'in');
  assert.equal(taxState('消費税及び地方消費税に相当する額を含まない'), 'out');
  assert.equal(taxState('税抜き'), 'out');
  assert.equal(taxState('予定価格 100円'), null);
  assert.equal(declaredUnit('(単位:千円)').yen, 1000);
  assert.equal(declaredUnit('(単位:円)'), null);
});

test('抜き書きが原文に無い値・値が抜き書きに無い値は外し、書いていないとは言わない', () => {
  const r = run(BUDGET, [budget({ quote: '予定価格 金 82,500,001円(税込み)' })]);
  assert.equal(r.removed[0].reason, '抜き書きが原文に無い');
  assert.equal(row(r, 'budget').status, STATUS.check);
  assert.match(flags(r, 'budget'), /外した/);
  const r2 = run(BUDGET, [budget({ value: '92,500,000円' })]);
  assert.equal(r2.removed[0].reason, '値の金額が抜き書きに無い');
  const r3 = run('工期 令和9年4月1日から', [{ key: 'period', value: '令和9年5月1日から', quote: '工期 令和9年4月1日から' }]);
  assert.match(r3.removed[0].reason, /数字が抜き書きに無い: 5/);
  const r4 = run('工事名 ためし橋補修', [{ key: 'work-name', value: 'ためし橋新設', quote: '工事名 ためし橋補修' }]);
  assert.equal(r4.removed[0].reason, '値が抜き書きの中に無い');
  assert.equal(run(BUDGET, [{ key: 'unknown-key', value: 'x', quote: BUDGET }]).removed.length, 1);
  assert.equal(run(BUDGET, [budget({ quote: '予定' })]).removed[0].reason, '抜き書きが短すぎる');
  assert.equal(run(BUDGET, [budget({ file: '別.txt' })]).removed.length, 1);
  assert.equal(run(BUDGET, [budget({ value: '円では書かない' })]).removed.length, 1);
});

test('抜き書きは空白の違いだけ許す。全角半角の違いは原文と別のもの', () => {
  assert.equal(run('予定価格  金82,500,000円(税込み)', [budget()]).removed.length, 0);
  assert.equal(run('予定価格 金 ８２,５００,０００円(税込み)', [budget()]).removed.length, 1);
});

test('桁・税の差・金額の違いを見分ける(ファイルをまたいでも見る)', () => {
  const two = (other) => run([...src(BUDGET), ...src(other, '説明書.txt')], [budget()]);
  assert.match(flags(two('予定価格 825,000,000円'), 'budget'), /説明書\.txt 1行目.*桁が違う/);
  assert.match(flags(two('予定価格 75,000,000円'), 'budget'), /税の差かもしれない/);
  assert.match(flags(two('予定価格 80,000,000円'), 'budget'), /金額が違う/);
  assert.equal(flags(two('予定価格 金八千二百五十万円'), 'budget'), '');
  assert.equal(flags(two('予定価格が1億円以上の工事は別に定める'), 'budget'), '', '境目の説明は比べない');
});

test('単位: 宣言の千円を掛けていない値・単位の無い数・小さい額・桁区切り', () => {
  const t = '(単位:千円)\n予定価格 82,500 税込み';
  const bad = run(t, [budget({ value: '82,500円', quote: '予定価格 82,500 税込み' })]);
  assert.match(flags(bad, 'budget'), /単位:千円/);
  assert.match(flags(bad, 'budget'), /小さい/);
  const good = run(t, [budget({ value: '82,500,000円', quote: '予定価格 82,500 税込み' })]);
  assert.equal(row(good, 'budget').status, STATUS.ok);
  assert.equal(good.form['contract-amount'], '82500000');
  assert.match(flags(run('予定価格 82,500,000 税込み', [budget({ quote: '予定価格 82,500,000 税込み' })]), 'budget'), /単位が無く/);
  const q = '予定価格 8,25,00,000円 税込み';
  assert.match(flags(run(q, [budget({ value: '8,25,00,000円', quote: q })]), 'budget'), /桁区切り/);
});

test('工期: 暦・前後・日数・別の所との違い。入札の日との前後', () => {
  const p = (q) => [{ key: 'period', value: q, quote: q }];
  assert.match(flags(run('令和9年2月30日から令和9年3月1日まで', p('令和9年2月30日から令和9年3月1日まで')), 'period'), /暦に無い/);
  assert.match(flags(run('令和9年5月1日から令和9年4月1日まで', p('令和9年5月1日から令和9年4月1日まで')), 'period'), /より後/);
  assert.match(flags(run('令和9年4月1日から令和9年4月30日まで(40日間)', p('令和9年4月1日から令和9年4月30日まで(40日間)')), 'period'), /30 日が合わない/);
  assert.equal(flags(run('令和9年4月1日から令和9年4月30日まで(30日間)', p('令和9年4月1日から令和9年4月30日まで(30日間)')), 'period'), '');
  const q = '工期: 令和9年4月1日から令和9年4月30日まで';
  assert.match(flags(run(q + '\n工期: 令和9年4月1日から令和9年5月30日まで', p(q)), 'period'), /2行目 の日付と違う/);
  const t = q + '\n入札日時: 令和9年5月1日';
  const r = run(t, [...p(q), { key: 'bid-date', value: '令和9年5月1日', quote: '入札日時: 令和9年5月1日' }]);
  assert.match(flags(r, 'bid-date'), /工期の始め/);
});

test('文書全体: 元号と西暦の食い違い。同じ欄の2つの値。工事名の違い。最低制限価格が予定価格以上', () => {
  assert.equal(eraConflicts(src('令和9年(2026年)2月1日')).length, 1);
  assert.equal(eraConflicts(src('令和9年(2027年)2月1日')).length, 0);
  const q2 = '予定価格 90,000,000円(税込み)';
  const dup = run(BUDGET + '\n' + q2, [budget(), budget({ value: '90,000,000円', quote: q2 })]);
  assert.match(flags(dup, 'budget'), /2つある/);
  assert.equal(dup.form['contract-amount'], undefined);
  const name = '工事名: ためし橋補修';
  assert.match(flags(run(name + '\n工事名: ためし橋新設', [{ key: 'work-name', value: 'ためし橋補修', quote: name }]), 'work-name'), /値と違う/);
  const l = '最低制限価格 90,000,000円';
  assert.match(flags(run(BUDGET + '\n' + l, [budget(), { key: 'low-limit', value: '90,000,000円', quote: l }]), 'low-limit'), /以上/);
});

test('書いていない: 語が無ければ「公告に書いていない」、語があれば「確かめが要る」', () => {
  const r = run('工事名 ためし橋補修\n予定価格は事後に公表する', [{ key: 'grade', absent: true }, { key: 'budget', absent: true }]);
  assert.equal(row(r, 'grade').status, STATUS.absent);
  assert.equal(row(r, 'budget').status, STATUS.check);
  assert.match(flags(r, 'budget'), /書いていないとされた/);
  assert.match(flags(r, 'work-name'), /拾っていない/);
  assert.equal(r.rows.length, KEYS.length);
});

test('画面に入る値: 確かめが要る値・税抜き・税の書いていない額・判定できない種類は入れない', () => {
  assert.equal(run(BUDGET, [budget()]).form['contract-amount'], '82500000');
  const out = '予定価格 75,000,000円(税抜き)';
  const r = run(out, [budget({ value: '75,000,000円', quote: out })]);
  assert.equal(row(r, 'budget').status, STATUS.ok);
  assert.equal(r.form['contract-amount'], undefined);
  assert.match(r.formSkipped.find((x) => x.id === 'contract-amount').reason, /税抜き/);
  const none = '予定価格 75,000,000円';
  assert.match(flags(run(none, [budget({ value: '75,000,000円', quote: none })]), 'budget'), /税込みか税抜きか/);
  assert.equal(run(BUDGET + '\n' + '予定価格 825,000,000円', [budget()]).form['contract-amount'], undefined);
  const w = '工事の種類 土木一式工事';
  assert.equal(run(w, [{ key: 'work-class', value: '土木一式工事', quote: w, form: { 'work-type': 'other' } }]).form['work-type'], 'other');
  assert.equal(run(w, [{ key: 'work-class', value: '土木一式工事', quote: w, form: { 'work-type': 'kenchiku-ikkatsu' } }]).form['work-type'], undefined);
  const k = '工事の種類 建築一式工事';
  assert.equal(run(k, [{ key: 'work-class', value: '建築一式工事', quote: k, form: { 'work-type': 'other' } }]).form['work-type'], undefined);
  const o = '発注者 架空県';
  assert.equal(run(o, [{ key: 'orderer-name', value: '架空県', quote: o, form: { orderer: 'public' } }]).form.orderer, 'public');
  assert.equal(run(o, [{ key: 'orderer-name', value: '架空県', quote: o, form: { orderer: 'x' } }]).form.orderer, undefined);
  assert.deepEqual(r.companyFields.map((x) => x.id), ['direct', 'subcontract-total', 'license', 'engineer-qualification']);
});

test('Claude が気づいたことは別に出し、状態を変えない。抜き書きが合わなければその旨を出す', () => {
  const r = run(BUDGET, [budget()], [{ text: '気づいた', quote: '予定価格 金' }, { text: '別', quote: '原文に無い文' }]);
  assert.equal(row(r, 'budget').status, STATUS.ok);
  assert.deepEqual(r.claudeNotes.map((n) => n.found), [true, false]);
  const md = renderMarkdown(r);
  assert.ok(md.indexOf('## 文書全体で機械が見つけた') < md.indexOf('## Claude が気づいたこと'));
  assert.match(md, /原文に見つからない/);
  assert.match(md, /入札に参加できるかの判断ではありません/);
});

test('見本: docs/samples の結果は、今のスクリプトの出力と同じ', () => {
  const read = (f) => fs.readFileSync(path.join(SAMPLE, f), 'utf8');
  const r = checkConditions(JSON.parse(read('拾った条件.json')), ['架空公告.md', '架空説明書.md'].map((file) => ({ file, text: read(file) })));
  assert.equal(JSON.stringify(r, null, 2) + '\n', read('画面に入れる条件.json'));
  assert.equal(renderMarkdown(r), read('拾った結果.md'));
  assert.equal(summaryLine(r), '条件 15 行のうち 拾えた 12・確かめが要る 3・公告に書いていない 0(外した値 0)');
  assert.deepEqual(r.form, { orderer: 'public', 'work-type': 'other' });
});

function fakeDoc() {
  const els = new Map();
  const attrs = () => { const a = {}; return { getAttribute: (k) => a[k] ?? null, setAttribute: (k, v) => { a[k] = String(v); }, removeAttribute: (k) => { delete a[k]; } }; };
  return { els, getElementById(id) { if (!els.has(id)) els.set(id, { innerHTML: '', textContent: '', value: '', hidden: true, checked: false, ...attrs() }); return els.get(id); } };
}

test('画面の読み込み: 見本のファイルで欄が入り、確かめが要る行が出る。金額の「分からない」を外す', () => {
  const doc = fakeDoc();
  const t = JSON.stringify(run(BUDGET + '\n工事の種類 土木一式工事', [budget(), { key: 'work-class', value: '土木一式工事', quote: '工事の種類 土木一式工事', form: { 'work-type': 'other' } }]));
  doc.getElementById('contract-amount-unknown').checked = true;
  assert.equal(loadIntakeFile(doc, t), true);
  assert.equal(doc.getElementById('contract-amount').value, '82500000');
  assert.equal(doc.getElementById('contract-amount-unknown').checked, false);
  assert.equal(doc.getElementById('work-type').value, 'other');
  assert.equal(doc.getElementById('orderer').value, '');
  assert.match(doc.getElementById('intake-status').textContent, /2 欄を入れました/);
  assert.match(doc.getElementById('intake-status').textContent, /請負代金そのものではありません/);
  assert.match(doc.getElementById('intake-result').innerHTML, /公告からは分からない 下請けの総額/);
  const sample = fs.readFileSync(path.join(SAMPLE, '画面に入れる条件.json'), 'utf8');
  assert.ok(intakeLines(parseIntakeFile(sample)).some((x) => x.startsWith('確かめが要る 予定価格')));
});

test('画面の読み込み: 壊れたファイル・違う種類・知らない欄・確かめが要る行の値は拒み、欄を変えない', () => {
  const base = { kind: 'bid-intake', source: { title: '架空' }, rows: [{ key: 'budget', status: '拾えた' }], form: { 'contract-amount': '100' } };
  assert.throws(() => parseIntakeFile('{'), /JSON/);
  assert.throws(() => parseIntakeFile('{"rows":[]}'), /ファイルではありません/);
  assert.throws(() => parseIntakeFile(JSON.stringify({ ...base, source: {} })), /題名/);
  const notIntake = /公告を読んだ AI がまとめた条件のファイルではないようです\(画面に無い欄があります\)/;
  assert.throws(() => parseIntakeFile(JSON.stringify({ ...base, form: { license: 'tokutei' } })), notIntake);
  assert.throws(() => parseIntakeFile(JSON.stringify({ ...base, form: { constructor: 'x' } })), notIntake);
  assert.throws(() => parseIntakeFile(JSON.stringify({ ...base, form: { 'contract-amount': '1万円' } })), /『請負代金の見込み』の値が読めません/);
  assert.throws(() => parseIntakeFile(JSON.stringify({ ...base, rows: [{ key: 'budget', status: '確かめが要る' }] })), /『請負代金の見込み』は公告から拾えていないので入れません/);
  const doc = fakeDoc();
  doc.getElementById('contract-amount').value = '500';
  assert.equal(loadIntakeFile(doc, '{'), false);
  assert.equal(doc.getElementById('contract-amount').value, '500');
  assert.match(doc.getElementById('intake-status').textContent, /そのままです/);
});

test('画面の読み込み: ファイルの中の文は HTML にならない', () => {
  const doc = fakeDoc();
  const file = { kind: 'bid-intake', source: { title: '架空' }, rows: [{ key: 'x', label: '<img src=x>', status: '確かめが要る', flags: ['<b>'] }] };
  loadIntakeFile(doc, JSON.stringify(file));
  assert.doesNotMatch(doc.getElementById('intake-result').innerHTML, /<img|<b>/);
});

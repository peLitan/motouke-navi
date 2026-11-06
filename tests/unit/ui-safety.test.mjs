// F40b: 画面の「安全の法令の候補」。ブラウザが無いので、描いた HTML と作り物の DOM での動きを確かめる(見え方は測っていない)
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHtml } from '../../build.mjs';
import { runPage } from '../acceptance/_helpers.mjs';
import { safetyCandidates } from '../../src/safety.mjs';
import { renderSafetyResult, SAFETY_IDS } from '../../src/ui/safety-view.mjs';
import { renderSummary } from '../../src/ui/view.mjs';
import { safetyRows, toCsv } from '../../src/export.mjs';

const html = buildHtml();
const body = html.slice(html.indexOf('<body'));
const elementAt = (tag, id) => body.indexOf('<' + tag + ' class="safety-fold" id="' + id + '"');

test('見出しと注記は折りたたみの外で、断り書きも閉じた中に無い。折りたたみは最初は閉じている', () => {
  const fold = elementAt('details', 'safety-fold');
  assert.ok(fold > 0);
  const openTag = body.slice(fold, body.indexOf('>', fold) + 1);
  assert.doesNotMatch(openTag, /\sopen/);
  for (const id of ['safety-heading', 'safety-note']) assert.ok(body.indexOf('id="' + id + '"') < fold, id);
  // 短い注意の行(F83a4)は入口で隠れ、中身を持たない折りたたみなので、最初の折りたたみに数えない
  assert.ok(body.indexOf('id="disclaimer"') < body.indexOf('<details', body.indexOf('</details>', body.indexOf('id="notice-more"'))), '画面の断り書きは最初の折りたたみより前');
  assert.ok(body.indexOf('id="schedule-result"') < fold && fold < body.indexOf('id="open-items"'), '受注後の段取りと同じ段にある');
  assert.match(body.slice(body.indexOf('id="safety-note"'), fold), /労働基準監督署長、大規模なものは厚生労働大臣/);
  assert.match(body.slice(body.indexOf('id="safety-note"'), fold), /この一覧だけでは現場の安全は確保できません/);
});

test('問いの欄は静的な HTML にあり、丸と四角の印は 44px の行の中にある。問いは紙に出さない', () => {
  for (const id of Object.values(SAFETY_IDS).flat()) assert.ok(body.includes('id="' + id + '"'), id);
  const q = body.slice(body.indexOf('id="safety-questions"'), body.indexOf('id="safety-status"'));
  assert.match(body.slice(body.lastIndexOf('<div', body.indexOf('id="safety-questions"')), body.indexOf('id="safety-questions"') + 40), /no-print/);
  assert.equal((q.match(/<div><input type="radio"/g) ?? []).length, (q.match(/type="radio"/g) ?? []).length);
  assert.equal((q.match(/<div class="check-row"><input type="checkbox"/g) ?? []).length, (q.match(/type="checkbox"/g) ?? []).length);
  assert.doesNotMatch(q, /[^-]localStorage/);
});

const scenarios = [
  {},
  { direct: true, subcontract: 'no', workers: 1, plan: 'none', works: 'none' },
  { direct: true, subcontract: 'yes', workers: 100, plan: ['plan-tunnel'], works: ['excavation'] },
  { direct: true, subcontract: 'unknown', workers: 'unknown', plan: 'unknown', works: 'unknown' },
  { direct: null, subcontractTotal: null },
  { direct: false, workers: 100, plan: 'none', works: ['shoring'] },
  { direct: false, workers: 1, plan: 'none', works: 'none' },
];
test('どの入力でも「要らない」の札と言い切りの語を出さない', () => {
  for (const s of scenarios) {
    const out = renderSafetyResult(safetyCandidates(s), [['問い', '答え']]);
    assert.doesNotMatch(out, /badge-not_required|要らない|届出は不要|事故を防げる|安全にできる|初心者でも/, JSON.stringify(s));
  }
});

test('下請けの道: 元請けだけに掛かるものを出さず、1行の説明と下請けにも掛かるものだけを出す', () => {
  const out = renderSafetyResult(safetyCandidates({ direct: false, workers: 100, plan: 'none', works: ['shoring'] }));
  assert.match(out, /元方事業者の措置・統括安全衛生責任者・法 第八十八条第二項から第四項の届出.*出していません/);
  assert.match(out, /安全衛生責任者の選任/);
  assert.match(out, /作業主任者の選任/);
  for (const w of ['id="safety-motokata"', 'id="safety-tokutei"', 'id="safety-supervisor"', 'id="safety-manager"', 'id="safety-notice"']) assert.ok(!out.includes(w), w);
  const none = renderSafetyResult(safetyCandidates({ direct: false, workers: 1, plan: 'none', works: 'none' }));
  assert.match(none, /この一覧の条件には当たりませんでした/);
  assert.match(none, /第八十八条第一項/, '見ていないものの行はいつも出す');
});

test('決められないものは欄へのリンクつきで、何を入れれば決まるかを出す', () => {
  const out = renderSafetyResult(safetyCandidates({ direct: true, subcontract: 'yes', workers: 'unknown', works: ['shoring'] }));
  assert.match(out, /<a href="#safety-q-workers">＊「同じ場所で常時働く人の数」が分かると判断できます/);
  assert.match(out, /<a href="#safety-q-plan">＊「工事の中に次のものがあるか」を入れると判断できます/);
  assert.match(out, /厚生労働大臣\(30日前まで\)、または 労働基準監督署長\(14日前まで\)/);
});

test('まとめ: 別の1行で出し、受注したら要るものの件数に混ぜない。入れた条件も載る', () => {
  const bid = { items: [{ key: 'a', label: '項目', status: 'required' }], checks: [] };
  const plain = renderSummary({ bid, values: {} });
  const out = renderSummary({ bid, values: {}, safety: { text: '3件(要る 3)', answerRows: [['行う作業', '土止め支保工']] } });
  assert.ok(!plain.includes('安全の法令の候補'));
  assert.match(out, /<a href="#safety-heading">安全の法令の候補<\/a><\/th><td>3件\(要る 3\)/);
  assert.match(out, /受注したら要るもの\(1項目/);
  assert.match(out, /行う作業<\/dt><dd>土止め支保工/);
});

test('見本: 掘削と土止め支保工の候補が出て、まとめに別の行があり、CSV に載る', async () => {
  const page = runPage(html);
  assert.match(page.text('safety-title'), /条件を入れると出ます/);
  assert.match(page.text('safety-version'), /2026年10月1日施行の改正までの条文.*取得日 2026-11-05/);
  await page.click('sample-load');
  assert.equal(page.el('safety-work-excavation').checked, true);
  const out = page.text('safety-result');
  assert.match(out, /作業主任者の選任\(地山の掘削\)/);
  assert.match(out, /作業主任者の選任\(土止め支保工\)/);
  assert.match(out, /元方事業者\(元請けの会社\)の措置/);
  assert.match(page.text('safety-title'), /元請けに掛かりそうなもの\(\d+件\)/);
  assert.match(page.text('summary'), /安全の法令の候補\s*\d+件\(要る \d+/);
  assert.match(page.text('safety-stage1'), /下請けの総額 77,000,000 円 → 使う/);
  assert.equal(page.el('safety-sub-yes').checked, true);
  await page.click('csv-btn');
  const blob = page.blobs.at(-1);
  const csv = blob.parts ? blob.parts.join('') : String(blob.text ?? blob);
  assert.match(csv, /安全の法令の候補/);
  assert.match(csv, /入れた条件: 行う作業/);
  await page.click('sample-reenter');
  assert.equal(page.el('safety-work-excavation').checked, false);
  assert.match(page.text('safety-title'), /条件を入れると出ます/);
});

test('問い: 変えるとすぐ描き直し、分からないは他の印を外して知らせる。橋を選ぶと場所の問いが出る', async () => {
  const page = runPage(html);
  await page.set('direct', true);
  await page.set('safety-work-shoring', true);
  assert.match(page.text('safety-result'), /土止め支保工/);
  await page.set('safety-work-unknown', true);
  assert.equal(page.el('safety-work-shoring').checked, false);
  assert.match(page.text('safety-status'), /1つ外しました/);
  assert.match(page.text('safety-result'), /確認が要る/);
  assert.equal(page.el('safety-q-place').hidden, true);
  await page.set('safety-bridge-mid', true);
  assert.equal(page.el('safety-q-place').hidden, false);
  await page.set('safety-place-no', true);
  await page.set('safety-sub-no', true);
  assert.equal(page.el('safety-q-workers').hidden, true, '下請けを使わないなら問い2 は出さない');
  assert.doesNotMatch(page.text('safety-result'), /統括安全衛生責任者の選任/);
});

test('段1 で下請けを選ぶと、問い1 を隠して下請けの道になる。候補は下請けの題になる', async () => {
  const page = runPage(html);
  await page.set('direct-sub', true);
  assert.equal(page.el('safety-q-subcontract').hidden, true);
  assert.match(page.text('safety-title'), /下請けにも掛かりそうなもの/);
  assert.match(page.text('safety-result'), /元方事業者の措置・統括安全衛生責任者・法 第八十八条第二項から第四項の届出.*出していません/);
});

test('「もう受注した」で条件が無いときは「この一覧は元請けの場合です」を出す', async () => {
  const page = runPage(html);
  await page.click('entry-awarded');
  assert.equal(page.el('safety-prime-note').hidden, false);
  await page.set('safety-work-shoring', true);
  assert.match(page.text('safety-result'), /土止め支保工/);
});

test('safetyRows: 始めていないときは行を足さず、候補の状態の言葉に「要らない」が無い', () => {
  assert.deepEqual(safetyRows(safetyCandidates({})), []);
  const rows = safetyRows(safetyCandidates({ direct: true, subcontract: 'yes', workers: 100, plan: ['plan-tunnel'], works: 'unknown' }), [['行う作業', 'まだ分からない']]);
  assert.ok(rows.every((r) => r[0] === '安全の法令の候補'));
  assert.ok(rows.some((r) => r[2] === '要る'));
  assert.doesNotMatch(toCsv(rows), /要らない/);
  assert.ok(rows.some((r) => r[1] === '工事の計画の届出' && r[3].includes('届出先: 労働基準監督署長(14日前まで)')));
});

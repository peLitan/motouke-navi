// F05a: 画面(案件の条件の入力 → 入札前の確認・台帳が要るか)(条件 F05-1・F05-4・F05-8・F05-9・F05-10、F03-4)
import test from 'node:test';
import assert from 'node:assert/strict';
import { load, exists, readJson, indexHtml, scriptsOf, withoutScripts, hasId, labelFor, articleLabel, STORAGE_RE, runPage } from './_helpers.mjs';

const IDS = ['orderer', 'direct', 'work-type', 'contract-amount', 'subcontract-total', 'license', 'engineer-qualification', 'ict-measure', 'bid-run', 'bid-result', 'taicho-result', 'sources-dates'];

test('index.html は build.mjs で src から作ったものと同じ(ファイル1つで開ける)', async () => {
  assert.ok(exists('build.mjs'));
  const { buildHtml } = await load('build.mjs');
  assert.equal(indexHtml(), await buildHtml(), 'index.html が src からの組み立てと食い違う(node build.mjs を実行していない)');
  for (const s of scriptsOf(indexHtml())) {
    assert.ok(!/^\s*import\s[^;]*from\s/m.test(s.code) && !/^\s*import\s*["']/m.test(s.code), 'ファイル1つで開けない(別ファイルの import がある)');
  }
  const code = scriptsOf(indexHtml()).map((s) => s.code).join('\n');
  for (const name of ['bidCheck', 'judgeTaicho', 'renderBidResult', 'renderTaichoResult', 'readBidForm']) {
    assert.ok(code.includes(name), '画面に ' + name + ' が組み込まれていない');
  }
});

test('入力欄と結果の欄がある。下請けの総額の欄は税込みと明示している', () => {
  const html = indexHtml();
  for (const id of IDS) assert.ok(hasId(html, id), 'id が無い: ' + id);
  const { amountBasis } = readJson('data/rules.json');
  const label = labelFor(html, 'subcontract-total');
  assert.ok(label, 'subcontract-total の label が無い');
  assert.ok(label.includes(amountBasis.tax === 'included' ? '税込' : '税抜'), '税込み・税抜きの明示が無い: ' + label);
});

test('使った法令と資料の名前・取得日と、古くなったら原文を確かめ直す旨が画面に出る', () => {
  const body = withoutScripts(indexHtml()).replace(/<[^>]+>/g, ' ');
  const { sources } = readJson('data/sources/index.json');
  for (const s of sources) {
    assert.ok(body.includes(s.fetchedAt), '取得日が無い: ' + s.id);
    if (s.kind === 'law') assert.ok(body.includes(s.law), '法令名が無い: ' + s.law);
  }
  assert.ok(/古くな/.test(body) && /確かめ/.test(body), '確かめ直す旨が無い');
});

test('入れた内容をブラウザに保存しない', () => {
  const code = scriptsOf(indexHtml()).map((s) => s.code).join('\n');
  assert.ok(!STORAGE_RE.test(code), 'ブラウザに保存する仕組みを使っている');
});

test('readBidForm: 画面の値(桁区切り・全角の数字を含む)を判定の入力にする', async () => {
  const { readBidForm } = await load('src/ui/form.mjs');
  const v = readBidForm({ orderer: 'public', direct: true, 'work-type': 'other', 'contract-amount': '300,000,000', 'subcontract-total': '６０，０００，０００', license: 'tokutei', 'engineer-qualification': 'kanri', 'ict-measure': false });
  assert.deepEqual(v, { orderer: 'public', direct: true, workType: 'other', contractAmount: 300000000, hasSubcontract: true, subcontractTotal: 60000000, license: 'tokutei', engineerQualification: 'kanri', ictMeasure: false });
  const z = readBidForm({ orderer: 'private', direct: false, 'work-type': 'kenchiku-ikkatsu', 'contract-amount': '', 'subcontract-total': '0', license: 'ippan', 'engineer-qualification': 'shunin', 'ict-measure': true });
  assert.equal(z.contractAmount, null);
  assert.equal(z.hasSubcontract, false);
  assert.equal(z.subcontractTotal, 0);
});

test('画面を動かす: 条件を入れて確認のボタンを押すと、入札前の確認と台帳が要るかの結果が欄に出る', async () => {
  const { bidCheck } = await load('src/bid-check.mjs');
  const page = runPage();
  const vals = { orderer: 'private', 'work-type': 'other', 'contract-amount': '200,000,000', 'subcontract-total': '60,000,000', license: 'ippan', 'engineer-qualification': 'shunin' };
  for (const [k, v] of Object.entries(vals)) await page.set(k, v);
  await page.set('direct', true); await page.set('ict-measure', false);
  await page.click('bid-run');
  const out = page.text('bid-result');
  const bid = bidCheck({ orderer: 'private', direct: true, workType: 'other', contractAmount: 200000000, hasSubcontract: true, subcontractTotal: 60000000, license: 'ippan', engineerQualification: 'shunin', ictMeasure: false });
  for (const it of bid.items) assert.ok(out.includes(it.label), '結果の欄に出ない: ' + it.label);
  assert.ok(/確認が要る/.test(out));
  const before = page.text('taicho-result');
  assert.ok(before.trim().length > 0, '台帳が要るかの欄が空');
  // 条件を変えると結果も変わる(決め打ちでない)
  await page.set('orderer', 'public'); await page.set('subcontract-total', '0'); await page.click('bid-run');
  const after = page.text('taicho-result');
  assert.ok(after.trim().length > 0 && after !== before, '条件を変えても台帳の欄が変わらない');
});

test('結果の表示: 項目・状態・根拠の条・最後は人が判断する旨が出て、文字はエスケープされる', async () => {
  const { bidCheck } = await load('src/bid-check.mjs');
  const { judgeTaicho } = await load('src/taicho.mjs');
  const { renderBidResult, renderTaichoResult } = await load('src/ui/view.mjs');
  const input = { orderer: 'private', direct: true, workType: 'other', contractAmount: 200000000, hasSubcontract: true, subcontractTotal: 60000000, license: 'ippan', engineerQualification: 'shunin', ictMeasure: false };
  const bid = bidCheck(input);
  const html = renderBidResult(bid);
  for (const it of bid.items) {
    assert.ok(html.includes(it.label), '項目が出ない: ' + it.label);
    for (const b of it.basis) assert.ok(html.includes(articleLabel(b.article)), '根拠の条が出ない: ' + b.article);
  }
  assert.ok(html.includes(bid.disclaimer));
  assert.ok(/確認が要る/.test(html), '確認が要る点が出ない');
  const t = judgeTaicho(input);
  const th = renderTaichoResult(t);
  assert.ok(/確認が要る|確認が必要/.test(th), '台帳の結果に許可の確認が出ない');
  for (const r of t.reasons) for (const b of r.basis) assert.ok(th.includes(articleLabel(b.article)));
  const evil = renderTaichoResult({ ...t, reasons: [{ ...t.reasons[0], text: '<img src=x onerror=alert(1)>' }] });
  assert.ok(!evil.includes('<img src=x'), 'エスケープされていない');
});

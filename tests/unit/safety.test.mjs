// F40a: 労働安全衛生法の候補の判定。人数の境目は抜き書きから読んだ値で前後を作る
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import safetyData from '../../data/safety.json' with { type: 'json' };
import quotesData from '../../data/quotes.json' with { type: 'json' };
import sourcesData from '../../data/sources/index.json' with { type: 'json' };
import { safetyCandidates, workerThresholds, kanjiNumber, subcontractAnswer } from '../../src/safety.mjs';
import { checkQuote, paragraphOf, stripSpaces, filterVerifiedRules } from '../../src/quote-check.mjs';

const texts = {};
for (const s of sourcesData.sources) if (s.file) texts[s.id] = fs.readFileSync(new URL('../../data/sources/' + s.file, import.meta.url), 'utf8');
const safetySourceIds = sourcesData.sources.filter((s) => /^an(ei|rei|soku)-/.test(s.id)).map((s) => s.id);
const quoteText = (id) => quotesData.quotes.find((q) => q.id === id).text;
const ids = (r) => r.candidates.map((c) => c.id);
const find = (r, id) => r.candidates.find((c) => c.id === id);
const base = { direct: true, subcontract: 'yes', workers: 1, plan: 'none', works: 'none' };
const notice = (x) => find(safetyCandidates({ ...base, ...x }), 'safety-notice');
const supervisor = (x) => find(safetyCandidates({ ...base, ...x }), 'safety-supervisor');
const chief = (x, id) => find(safetyCandidates({ ...base, ...x }), id);

test('数の読み取り: 漢数字と小数', () => {
  assert.equal(kanjiNumber('三十一'), 31);
  assert.equal(kanjiNumber('百五十'), 150);
  assert.equal(kanjiNumber('千'), 1000);
  assert.equal(kanjiNumber('〇・三'), 0.3);
});

test('人数の境目は令 第7条の原文の数', () => {
  assert.deepEqual(workerThresholds(), { low: 30, high: 50 });
});

test('安全の法令の原文: 取得した10の条がそろい、どの条にも抜き書きがあり、すべて原文と一致する', () => {
  assert.equal(safetySourceIds.length, 10);
  for (const id of safetySourceIds) assert.ok(quotesData.quotes.some((q) => q.sourceId === id), id);
  for (const q of quotesData.quotes.filter((x) => safetySourceIds.includes(x.sourceId))) {
    const r = checkQuote(q, texts);
    assert.ok(r.ok, q.id + ' ' + r.reason);
  }
});

test('「二の二」のような号の枝は、その枝の行の中にある', () => {
  const branched = quotesData.quotes.filter((q) => q.branch);
  assert.equal(branched.length, 4);
  const kanji = { 2: '二', 3: '三', 4: '四', 5: '五' };
  for (const q of branched) {
    const head = kanji[q.item] + 'の' + kanji[q.branch] + '　';
    const line = paragraphOf(texts[q.sourceId], q.paragraph).split('\n').find((l) => l.startsWith(head));
    assert.ok(line && stripSpaces(line).includes(stripSpaces(q.text)), q.id);
  }
});

test('規則表の根拠の抜き書きはすべて有って一致し、説明の文に数字が無い(数は原文から読む)', () => {
  const s = safetyData;
  const q = (quoteId) => ({ basis: [{ quoteId }] });
  const rows = [
    ...s.candidates, s.supervisor, s.chief, s.subLine,
    ...s.planItems.map((p) => q(p.quoteId)), ...s.chief.works.map((p) => q(p.quoteId)),
    q(s.notice.minister.quoteId), q(s.notice.office.quoteId),
  ].map((r, i) => ({ id: 'row-' + i, basis: r.basis }));
  const { dropped, problems } = filterVerifiedRules(rows, quotesData.quotes, texts);
  assert.equal(dropped.length, 0, JSON.stringify(problems));
  const written = [...s.candidates, s.supervisor, s.chief, s.subLine].flatMap((r) => [r.label, r.action, r.note, r.text]).filter(Boolean).join('');
  assert.doesNotMatch(written, /[0-9０-９]/);
  assert.doesNotMatch(JSON.stringify(s), /:\s*[0-9]/, '数の値を規則表に書かない');
});

test('則 第89条・第90条の号は1つも落とさず問いの項目にある', () => {
  for (const [sourceId, route] of [['ansoku-89', 'minister'], ['ansoku-90', 'office']]) {
    const lines = paragraphOf(texts[sourceId], 1).split('\n').filter((l) => /^[一二三四五六七八九十]+(の[一二三四五六七八九十]+)?　/.test(l));
    const used = safetyData.planItems.filter((p) => p.route === route).map((p) => stripSpaces(quoteText(p.quoteId)));
    assert.equal(lines.length, used.length, sourceId);
    for (const l of lines) assert.ok(used.some((u) => stripSpaces(l).includes(u)), l);
  }
});

test('下請けとして入る: 候補は出さず1行だけ。作業主任者を元請けの仕事と言い切らない', () => {
  const r = safetyCandidates({ direct: false, subcontract: 'yes', workers: 100, plan: ['plan-tunnel'], works: ['excavation'] });
  assert.equal(r.mode, 'sub');
  assert.deepEqual(r.candidates, []);
  assert.equal(r.counts.total, 0);
  assert.match(r.line.text, /元請けが行います/);
  assert.match(r.line.text, /作業主任者/);
  assert.doesNotMatch(r.line.text, /\n/);
  assert.ok(r.line.basis.some((b) => b.article === '14'));
  assert.ok(r.line.basis.some((b) => b.article === '88' && b.paragraph === 5));
});

test('下請けを使わない: 元方・特定元方・統括は出ない。届出と作業主任者は出る', () => {
  const r = safetyCandidates({ direct: true, subcontract: 'no', workers: 100, plan: ['plan-tunnel'], works: ['shoring'] });
  assert.deepEqual(ids(r), ['safety-notice', 'safety-chief-shoring']);
  assert.ok(r.candidates.every((c) => c.status === 'required'));
});

test('下請けを使う: 元方と特定元方の措置が原文つきで出る', () => {
  const r = safetyCandidates(base);
  assert.deepEqual(ids(r), ['safety-motokata', 'safety-tokutei']);
  const c = find(r, 'safety-tokutei');
  assert.equal(c.status, 'required');
  assert.ok(c.basis.some((b) => b.quote.includes('協議組織') && b.article === '30' && b.item === 1));
  assert.ok(c.basis.some((b) => b.quote.includes('巡視') && b.item === 3));
});

test('下請けが分からない: 確認が要るにして欄の名前を返す。未回答とは分ける', () => {
  const u = find(safetyCandidates({ ...base, subcontract: 'unknown' }), 'safety-motokata');
  assert.equal(u.status, 'needs_check');
  assert.deepEqual(u.needs, [{ field: 'subcontract', label: '下請けを使うか', state: 'unknown' }]);
  const n = find(safetyCandidates({ direct: true, workers: 1, plan: 'none', works: 'none' }), 'safety-motokata');
  assert.equal(n.status, 'unanswered');
  assert.equal(n.needs[0].state, 'unanswered');
});

test('段1 の下請けの総額から読む: 0 は使わない、正の数は使う、空は分からない。問いの答えがあれば答えを使う', () => {
  assert.equal(subcontractAnswer({ subcontractTotal: 0 }), 'no');
  assert.equal(subcontractAnswer({ subcontractTotal: 1000000 }), 'yes');
  assert.equal(subcontractAnswer({ subcontractTotal: null }), 'unknown');
  assert.equal(subcontractAnswer({}), undefined);
  assert.equal(subcontractAnswer({ subcontractTotal: 0, subcontract: 'yes' }), 'yes');
});

test('統括安全衛生責任者: 普通の仕事は高い方の境目の前後で分かれる', () => {
  const { high } = workerThresholds();
  assert.equal(supervisor({ workers: high - 1 }), undefined);
  assert.equal(supervisor({ workers: high }).status, 'required');
});

test('統括安全衛生責任者: ずい道・場所の限定のある橋・圧気は低い方の境目の前後で分かれる', () => {
  const { low } = workerThresholds();
  for (const item of ['plan-tunnel', 'plan-pressure', 'plan-bridge-narrow', 'plan-tunnel-long', 'plan-tunnel-shaft', 'plan-pressure-high']) {
    assert.equal(supervisor({ plan: [item], workers: low - 1 }), undefined, item);
    assert.equal(supervisor({ plan: [item], workers: low })?.status, 'required', item);
  }
  assert.equal(supervisor({ plan: ['plan-bridge'], workers: low }), undefined, '場所の限定を選ばない橋は低い方を使わない');
});

test('統括安全衛生責任者: 境目の間では問い3が決まらないと決めない。低い方の未満は問い3によらず出ない', () => {
  const { low, high } = workerThresholds();
  const mid = low + 1;
  assert.ok(mid < high);
  const un = supervisor({ workers: mid, plan: undefined });
  assert.equal(un.status, 'unanswered');
  assert.deepEqual(un.needs.map((n) => n.label), ['工事の中に次のものがあるか']);
  assert.equal(supervisor({ workers: mid, plan: 'unknown' }).status, 'needs_check');
  assert.equal(supervisor({ workers: low - 1, plan: 'unknown' }), undefined);
});

test('統括安全衛生責任者: 人数の未回答と分からないを分ける。下請けも分からなければ両方の欄を返す', () => {
  assert.equal(supervisor({ workers: undefined }).status, 'unanswered');
  assert.equal(supervisor({ workers: 'unknown' }).status, 'needs_check');
  const both = supervisor({ workers: undefined, subcontract: 'unknown' });
  assert.equal(both.status, 'unanswered');
  assert.deepEqual(both.needs.map((n) => n.field), ['subcontract', 'workers']);
});

test('計画の届出: 支間の境目の前後、労働基準監督署長と厚生労働大臣の分かれ、つり橋の別の境目', () => {
  assert.equal(notice({ bridgeSpanM: 49.9 }), undefined);
  const office = notice({ bridgeSpanM: 50 });
  assert.equal(office.status, 'required');
  assert.equal(office.to, '労働基準監督署長');
  assert.equal(office.daysBefore, 14);
  assert.deepEqual(office.matched.map((m) => m.id), ['plan-bridge']);
  assert.equal(notice({ bridgeSpanM: 499 }).to, '労働基準監督署長');
  const large = notice({ bridgeSpanM: 500 });
  assert.equal(large.to, '厚生労働大臣');
  assert.equal(large.daysBefore, 30);
  assert.deepEqual(large.matched.map((m) => m.id), ['plan-bridge-large'], '第88条第3項は第2項の仕事を除く');
  assert.equal(notice({ bridgeSpanM: 999, bridgeSuspension: true }).to, '労働基準監督署長');
  assert.equal(notice({ bridgeSpanM: 1000, bridgeSuspension: true }).to, '厚生労働大臣');
});

test('計画の届出: 高さは「超える」、掘削は「以上」、圧気は小数の境目', () => {
  assert.equal(notice({ structureHeightM: 31 }), undefined);
  assert.equal(notice({ structureHeightM: 31.1 }).status, 'required');
  assert.equal(notice({ excavationM: 9.9 }), undefined);
  assert.equal(notice({ excavationM: 10 }).status, 'required');
  assert.equal(notice({ pressureMPa: 0.29 }), undefined);
  assert.equal(notice({ pressureMPa: 0.3 }).to, '厚生労働大臣');
  assert.equal(notice({ damHeightM: 149 }), undefined);
  assert.equal(notice({ damHeightM: 150 }).to, '厚生労働大臣');
  assert.equal(notice({ towerHeightM: 299 }), undefined);
  assert.equal(notice({ towerHeightM: 300 }).to, '厚生労働大臣');
  assert.equal(notice({ tunnelLengthM: 2999 }), undefined);
  assert.equal(notice({ tunnelLengthM: 3000 }).to, '厚生労働大臣');
  assert.equal(notice({ quarryDepthM: 9.9 }), undefined);
  assert.equal(notice({ quarryDepthM: 10 }).status, 'required');
});

test('計画の届出: 選んだ項目と場所の条が根拠に入る。分からないは届出先を2つとも返す', () => {
  const r = notice({ plan: ['plan-bridge-place'] });
  assert.equal(r.status, 'required');
  assert.ok(r.basis.some((b) => b.article === '18の2の2'));
  assert.equal(r.matched[0].branch, 2);
  const u = notice({ plan: 'unknown' });
  assert.equal(u.status, 'needs_check');
  assert.deepEqual(u.routes.map((x) => x.to), ['厚生労働大臣', '労働基準監督署長']);
  assert.equal(notice({ plan: undefined }).status, 'unanswered');
});

test('統括の人数にしか使わない橋の項目は、届出の条件にしない', () => {
  assert.equal(notice({ plan: ['plan-bridge-narrow'] }), undefined);
});

test('作業主任者: 掘削面と足場の高さの境目の前後。つり足場と張出し足場は高さによらない', () => {
  assert.equal(chief({ works: ['excavation'], excavationFaceM: 1.9 }, 'safety-chief-excavation'), undefined);
  assert.equal(chief({ works: ['excavation'], excavationFaceM: 2 }, 'safety-chief-excavation').status, 'required');
  assert.equal(chief({ works: ['scaffold'], scaffoldHeightM: 4.9 }, 'safety-chief-scaffold'), undefined);
  assert.equal(chief({ works: ['scaffold'], scaffoldHeightM: 5 }, 'safety-chief-scaffold').status, 'required');
  assert.equal(chief({ works: ['scaffold'], scaffoldHeightM: 3, scaffoldHungOrCantilever: true }, 'safety-chief-scaffold').status, 'required');
});

test('作業主任者: 選んだ作業ごとに根拠の号が付く。事業者に掛かることを添える', () => {
  const r = safetyCandidates({ ...base, works: ['excavation', 'shoring', 'formwork', 'scaffold'] });
  assert.deepEqual(r.candidates.filter((c) => c.work).map((c) => [c.work, c.basis[1].item]), [['地山の掘削', 9], ['土止め支保工', 10], ['型枠支保工', 14], ['足場', 15]]);
  assert.match(find(r, 'safety-chief-shoring').note, /事業者/);
});

test('作業主任者: 未回答・分からない・無いを分ける', () => {
  assert.equal(chief({ works: undefined }, 'safety-chief').status, 'unanswered');
  assert.equal(chief({ works: [] }, 'safety-chief').status, 'unanswered');
  assert.equal(chief({ works: 'unknown' }, 'safety-chief').status, 'needs_check');
  assert.equal(chief({ works: 'none' }, 'safety-chief'), undefined);
});

test('何も入れていない: 全部未回答で started は false。元請けの前提であることを返す', () => {
  const r = safetyCandidates({});
  assert.equal(r.started, false);
  assert.equal(r.assumedPrime, true);
  assert.ok(r.candidates.length > 0);
  assert.ok(r.candidates.every((c) => c.status === 'unanswered' && c.needs.length > 0 && c.needs.every((n) => n.label)));
  assert.equal(safetyCandidates({ direct: true }).assumedPrime, false);
});

test('全部当たらなければ候補は空。「要らない」の結論は1つも返さない', () => {
  const none = safetyCandidates({ direct: true, subcontract: 'no', plan: 'none', works: 'none' });
  assert.deepEqual(none.candidates, []);
  assert.equal(none.counts.total, 0);
  const inputs = [{}, base, { direct: true, subcontract: 'no', plan: 'none', works: 'none' }, { ...base, subcontract: 'unknown', plan: 'unknown', works: 'unknown', workers: 'unknown' }, { direct: false }];
  for (const i of inputs) {
    const r = safetyCandidates(i);
    assert.ok(r.candidates.every((c) => ['required', 'unanswered', 'needs_check'].includes(c.status)));
    assert.doesNotMatch(JSON.stringify(r), /not_required|要らない|届出は不要|安全にできる|事故を防げる/);
  }
});

test('号の括弧書きの除外は、原文のまま候補に添える(判定はしない)', () => {
  const rows = [...safetyData.planItems, ...safetyData.chief.works].filter((x) => x.caveat);
  assert.equal(rows.length, 4);
  for (const x of rows) assert.ok(quoteText(x.quoteId).includes(x.caveat), x.id);
  assert.match(notice({ excavationM: 10 }).matched[0].caveat, /立ち入らない/);
  assert.match(chief({ works: ['scaffold'] }, 'safety-chief-scaffold').caveat, /ゴンドラ/);
  assert.match(chief({ works: ['excavation'] }, 'safety-chief-excavation').caveat, /ずい道/);
});

test('掛かる先が変わる場合を添える: 発注者が自ら行う仕事、第30条の指名', () => {
  const n = notice({ bridgeSpanM: 50 });
  assert.ok(n.basis.some((b) => b.article === '88' && b.paragraph === 5));
  assert.match(n.note, /発注者/);
  const r = safetyCandidates({ ...base, workers: 50 });
  assert.ok(find(r, 'safety-tokutei').basis.some((b) => b.article === '30' && b.paragraph === 4));
  assert.match(find(r, 'safety-tokutei').note, /指名/);
  assert.ok(find(r, 'safety-supervisor').basis.some((b) => b.article === '15' && b.paragraph === 3));
  assert.match(find(r, 'safety-tokutei').note, /第五号/);
  assert.doesNotMatch(find(r, 'safety-tokutei').action, /工程/);
});

test('件数は3つの札の内訳と合計を返す', () => {
  const r = safetyCandidates({ direct: true, subcontract: 'yes', workers: 'unknown', works: ['shoring'] });
  assert.deepEqual(r.counts, { required: 3, unanswered: 1, needs_check: 1, total: 5 });
  assert.equal(r.counts.total, r.candidates.length);
});

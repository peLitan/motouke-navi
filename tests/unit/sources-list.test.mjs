// 使った法令と資料の一覧を、法令・資料ごとの1行と折りたたみにまとめた形(F66a)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildHtml, sourceGroups, shortDocTitle, compareArticles, articleLabel } from '../../build.mjs';
import { sourceVersion } from '../../src/source-version.mjs';
import { basisLabel, esc } from '../../src/ui/view.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const { sources } = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'sources', 'index.json'), 'utf8'));
const laws = sources.filter((s) => s.kind === 'law');
const docs = sources.filter((s) => s.kind !== 'law');
const lawNames = [...new Set(laws.map((s) => s.law))];

const html = buildHtml();
const block = html.slice(html.indexOf('<div id="sources-dates">'), html.indexOf('</section>', html.indexOf('<div id="sources-dates">')));
const listHtml = block.slice(block.indexOf('<ul id="sources-list">'), block.indexOf('</ul>', block.indexOf('<ul id="sources-list">')));
const detailOpen = block.indexOf('<details');
const detailClose = block.indexOf('</details>');
const detailHtml = block.slice(detailOpen, detailClose);
const lines = [...listHtml.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => m[1]);
const lineOf = (name) => lines.filter((l) => l.startsWith('<span class="source-name">' + esc(name) + '</span>'));
const unique = (list) => [...new Set(list)];
const datesIn = (line) => [...line.matchAll(/<span class="source-date">([^<]*)<\/span>/g)].map((m) => m[1]);

// 設計の表の名前(題名, 発行者)。index.json に資料を足したら、ここにも足す
const DOC_NAMES = {
  'mlit-kyoka-guideline': ['建設業許可事務ガイドライン', '国土交通省'],
  'mlit-kanri-manual': ['監理技術者制度運用マニュアル', '国土交通省'],
  'mlit-doboku-spec-r8': ['土木工事共通仕様書(案)令和8年3月', '国土交通省'],
  'mlit-taicho-sakuseirei': ['施工体制台帳(作成例)', '国土交通省'],
  'mlit-kenchiku-spec-r7': ['公共建築工事標準仕様書(建築工事編)令和7年版', '国土交通省大臣官房官庁営繕部'],
  'mlit-denki-spec-r7': ['公共建築工事標準仕様書(電気設備工事編)令和7年版', '国土交通省大臣官房官庁営繕部'],
  'mlit-kikai-spec-r7': ['公共建築工事標準仕様書(機械設備工事編)令和7年版', '国土交通省大臣官房官庁営繕部'],
  'mlit-kyotsuhi-r8': ['公共建築工事共通費積算基準', '国土交通省大臣官房官庁営繕部'],
  'mlit-tsushin-spec-r8': ['電気通信設備工事共通仕様書 令和8年版', '国土交通省大臣官房技術調査課電気通信室'],
  'mlit-park-spec-r6': ['公園緑地工事共通仕様書 令和6年5月', '国土交通省都市局公園緑地・景観課'],
};

test('行の数は 法令の種類 + 資料 で、index.json から数えた数になる', () => {
  assert.ok(block.includes('<ul id="sources-list">'));
  assert.equal(lines.length, lawNames.length + docs.length);
  assert.ok(lawNames.length > 0 && docs.length > 0);
});

test('行の順は index.json で最初に出る順', () => {
  const firstSeen = unique(sources.map((s) => (s.kind === 'law' ? s.law : DOC_NAMES[s.id]?.[0])));
  const shown = lines.map((l) => /<span class="source-name">([^<]*)<\/span>/.exec(l)[1]);
  assert.deepEqual(shown, firstSeen.map(esc));
});

test('法令の行: 太字は法令名だけで、全部の条が数の順に重ならず並ぶ', () => {
  const numbers = (label) => label.replace('第', '').replace('条', '').split('の').map(Number);
  const lessThan = (a, b) => {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) < (b[i] ?? 0);
    }
    return false;
  };
  for (const law of lawNames) {
    const found = lineOf(law);
    assert.equal(found.length, 1, '行が1つでない: ' + law);
    assert.ok(found[0].startsWith('<span class="source-name">' + law + '</span> 第'), '条が太字の中にある: ' + law);
    const shown = found[0].split(' — ')[0].replace(/<[^>]+>/g, '').slice(law.length + 1).split('・');
    const expected = laws.filter((s) => s.law === law).map((s) => s.article);
    assert.ok(expected.every((a) => /^\d+(の\d+)*$/.test(a)), '条の形が違う: ' + law);
    assert.equal(shown.length, expected.length, '条の数が違う: ' + law);
    for (const a of expected) {
      const [main, ...subs] = a.split('の');
      assert.ok(shown.includes('第' + main + '条' + subs.map((x) => 'の' + x).join('')), '条が無い: ' + law + ' ' + a);
    }
    for (let i = 1; i < shown.length; i++) assert.ok(lessThan(numbers(shown[i - 1]), numbers(shown[i])), '数の順でない: ' + shown.join('・'));
  }
});

test('法令の行: 取得日は重ならず1つずつ印があり、版は施行日の文だけで、URL は1つ', () => {
  for (const law of lawNames) {
    const [line] = lineOf(law);
    const rows = laws.filter((s) => s.law === law);
    assert.deepEqual(datesIn(line), unique(rows.map((s) => s.fetchedAt)).sort(), '取得日: ' + law);
    assert.ok(line.includes(' — 取得日 ' + datesIn(line).map((d) => `<span class="source-date">${d}</span>`).join('・') + ' — '), '取得日の並び: ' + law);
    const [, y, m, d] = /_(\d{4})(\d{2})(\d{2})_/.exec(rows[0].revisionId);
    assert.ok(line.includes(` — ${Number(y)}年${Number(m)}月${Number(d)}日施行の改正までの条文 — `), '施行日の文: ' + law);
    assert.ok(line.endsWith(`<span class="source-url">${esc(rows[0].url)}</span>`), 'URL: ' + law);
  }
  assert.ok(!/_\d{8}_/.test(listHtml), 'e-Gov の版の番号が1行に出ている');
  assert.ok(!listHtml.includes('e-Gov の版'), '「e-Gov の版」の語が1行に出ている');
  for (const s of laws) assert.ok(!listHtml.includes(s.revisionId), '版の番号: ' + s.id);
});

test('法令の版が2つなら「・」で並べ、番号の形が違えば施行日を作らない', () => {
  const base = { kind: 'law', law: '架空法', article: '1', url: 'https://example.com/', fetchedAt: '2026-01-01' };
  const two = sourceGroups([
    { ...base, revisionId: 'AAA_20250101_X' },
    { ...base, article: '2', revisionId: 'AAA_20260101_Y' },
    { ...base, article: '3', revisionId: 'AAA_20260101_Y' },
  ]);
  assert.equal(two.length, 1);
  assert.equal(two[0].version, '2025年1月1日施行の改正までの条文・2026年1月1日施行の改正までの条文');
  assert.equal(sourceGroups([{ ...base, revisionId: 'bad' }])[0].version, sourceVersion({ revisionId: 'bad' }));
});

test('資料の行: 名前は対応表のとおりで、太字は題名だけ', () => {
  for (const s of docs) {
    assert.ok(DOC_NAMES[s.id], '対応表に足すこと: ' + s.id);
    const [title, publisher] = DOC_NAMES[s.id];
    const found = lineOf(title);
    assert.equal(found.length, 1, '行が1つでない: ' + s.id);
    assert.ok(found[0].startsWith(`<span class="source-name">${esc(title)}</span>(${esc(publisher)}) — 取得日 `), '名前: ' + s.id);
    assert.equal(shortDocTitle(s), title);
    assert.equal(publisher, s.publisher);
    assert.deepEqual(datesIn(found[0]), [s.fetchedAt]);
    assert.ok(found[0].includes(` — ${esc(sourceVersion(s))} — `), '版: ' + s.id);
    assert.ok(found[0].endsWith(`<span class="source-url">${esc(s.url)}</span>`), 'URL: ' + s.id);
  }
});

test('shortDocTitle: 発行者を含む括弧だけを外し、外せないときは題名のまま', () => {
  assert.equal(shortDocTitle({ title: '手引き(第2版)(架空省。別冊)', publisher: '架空省' }), '手引き(第2版)');
  assert.equal(shortDocTitle({ title: '手引き（架空省。別冊）', publisher: '架空省' }), '手引き');
  assert.equal(shortDocTitle({ title: '手引き(第2版)', publisher: '架空省' }), '手引き(第2版)');
  assert.equal(shortDocTitle({ title: '手引き(第2版)' }), '手引き(第2版)');
  assert.equal(shortDocTitle({ title: '架空省の手引き', publisher: '架空省' }), '架空省の手引き');
  assert.equal(shortDocTitle({ title: '(架空省)の手引き', publisher: '架空省' }), '(架空省)の手引き');
});

test('資料の発行者が無ければ、空の括弧を出さない', () => {
  const [g] = sourceGroups([{ kind: 'document', id: 'x', title: '手引き', fetchedAt: '2026-01-01', url: 'https://example.com/' }]);
  assert.equal(g.name + g.tail, '手引き');
});

test('条の比べ方: 「の」の後ろも数で比べる', () => {
  const order = ['3', '24の8', '25の27', '26'];
  assert.deepEqual([...order].reverse().sort(compareArticles), order);
  assert.ok(compareArticles('18の2の2', '89') < 0);
  assert.ok(compareArticles('15', '15の2') < 0);
  assert.ok(compareArticles('29の2', '29の10') < 0);
  assert.equal(compareArticles('24の8', '24の8'), 0);
});

test('条の書き方は根拠の表示と同じ', () => {
  for (const s of laws) assert.equal(s.law + ' ' + articleLabel(s.article), basisLabel({ law: s.law, article: s.article }));
});

test('折りたたみ: 紙に出さず閉じていて、見出しに件数があり、中に全部の出典の版と URL が残る', () => {
  assert.equal(block.match(/<details\b/g).length, 1);
  assert.match(block, /<details class="fold no-print" id="sources-detail"><summary>/);
  assert.ok(!/<details\b[^>]*\sopen\b/.test(block), '開いている');
  assert.ok(detailHtml.includes(`<summary>条ごとの取得日・版・URL を見る(${sources.length}件)</summary>`));
  assert.ok(detailHtml.includes('<ul id="sources-all">'));
  assert.equal(detailHtml.match(/<li>/g).length, sources.length);
  for (const s of sources) {
    assert.ok(detailHtml.includes(`取得日 ${s.fetchedAt}・版 ${esc(sourceVersion(s))}<br>${esc(s.url)}</li>`), '行が無い: ' + s.id);
    assert.ok(detailHtml.includes(esc(s.kind === 'law' ? s.title : s.title + '(' + s.publisher + ')')), '題名が無い: ' + s.id);
  }
});

test('一覧と改正の注意の段落は折りたたみの外', () => {
  assert.ok(block.indexOf('<ul id="sources-list">') < detailOpen);
  assert.ok(block.indexOf('</ul>') < detailOpen);
  const after = block.slice(detailClose);
  assert.match(after, /法令は改正されることがあります。[\s\S]*古くな[\s\S]*確かめ/);
  assert.ok(!detailHtml.includes('法令は改正されることがあります'));
});

test('タグを除いた本文に、全出典の取得日と法令名がある', () => {
  const body = listHtml.replace(/<[^>]+>/g, ' ');
  for (const s of sources) {
    assert.ok(body.includes(s.fetchedAt), '取得日が無い: ' + s.id);
    if (s.kind === 'law') assert.ok(body.includes(s.law), '法令名が無い: ' + s.law);
  }
});

test('画面の CSS: 行の間・名前の太字・取得日を折り返さない規則が、印刷のブロックより前にある', () => {
  const printAt = html.indexOf('@media print {');
  for (const rule of ['#sources-list li { margin: 0.25rem 0; }', '.source-name { font-weight: bold; }', '.source-date { white-space: nowrap; }']) {
    assert.ok(html.includes(rule), rule);
    assert.ok(html.indexOf(rule) < printAt, '印刷のブロックの後にある: ' + rule);
  }
  assert.ok(!/\.source-(name|date|url)[^{]*\{[^}]*display/.test(html), '飾りの規則で隠している');
});

test('冒頭の一覧(#scope)は今のまま、全部の題名を並べる', () => {
  const scope = html.slice(html.indexOf('<ul id="scope-seen">'), html.indexOf('</ul>', html.indexOf('<ul id="scope-seen">')));
  assert.equal(scope.match(/<li>/g).length, sources.length);
  for (const s of sources) assert.ok(scope.includes(`<li>${esc(s.title)}</li>`), s.id);
});

test('index.html は組み立て直してある', () => {
  assert.equal(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'), html);
});

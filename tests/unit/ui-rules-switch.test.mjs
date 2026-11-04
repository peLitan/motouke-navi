// F37d: 段取りの例を国の直轄と和歌山県で切り替える。ファイルの読み込みは3つ目の選び方。
// この環境にはブラウザが無いので、見た目は測れない。描いた HTML と作り物の DOM での動きを確かめる
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildHtml } from '../../build.mjs';
import { parseRulesFile, tableCredit } from '../../src/rules-load.mjs';
import { buildScheduleDetail } from '../../src/schedule.mjs';
import { runPage } from '../acceptance/_helpers.mjs';

const FILE = fs.readFileSync(new URL('../../data/specs/wakayama_r0711_rows.json', import.meta.url), 'utf8');
const SPEC = fs.readFileSync(new URL('../../fixtures/specs/wakayama_r0711_1-1-1-6_12.txt', import.meta.url), 'utf8');
const OWN = JSON.stringify({
  source: { publisher: '架空県', title: '架空の仕様書', edition: '令和9年1月' },
  rows: [{ kind: 'schedule', phase: 'start', when: '着手前', what: '架空の書類を出す', to: '監督員', section: '1-1', quote: '出す' }],
});
const html = buildHtml();
const body = html.slice(html.indexOf('<body'));
const credit = tableCredit(parseRulesFile(FILE));
const NOT_MADE = 'この出力は和歌山県が作成したものではありません';

const notice = (page, id = 'schedule-notice') => page.el(id).textContent;
const pressed = (page, id) => page.el(id).getAttribute('aria-pressed');
async function loadOwn(page, text = OWN) {
  const input = page.el('rules-load');
  input.files = [{ size: text.length, text: async () => text }];
  input.dispatchEvent({ type: 'change' });
  await new Promise((r) => setTimeout(r, 0));
}

test('切り替えのボタンが2つあり、始めは国の直轄の例が押された形で、説明がボタンの名前にある', () => {
  assert.match(body, /<button type="button" id="rules-national" aria-pressed="true">国の直轄の例\(国が発注する工事\)<\/button>/);
  assert.match(body, /<button type="button" id="rules-wakayama" aria-pressed="false">和歌山県の例\(7つの節だけ\)<\/button>/);
  assert.match(body, /role="group" aria-label="段取りの例の切り替え"/);
  assert.match(html, /\.rules-switch button\[aria-pressed="true"\]/);
});

test('和歌山県を押すと、段取りと目次の注記に範囲と断りが出て、押された形が移り、国の例の説明が隠れる', async () => {
  const page = runPage();
  await page.click('rules-wakayama');
  for (const id of ['schedule-notice', 'plan-notice']) {
    const t = notice(page, id);
    assert.ok(t.includes('和歌山県「土木請負工事必携 令和7年11月」の7つの節だけ(1-1-1-6〜12)'), t);
    assert.ok(t.includes('を加工して作成'), t);
    assert.ok(t.includes(NOT_MADE), t);
    assert.ok(t.includes('取得日 2026-11-04'), t);
    assert.ok(!t.includes('読み込んだ表'), t);
  }
  assert.equal(pressed(page, 'rules-wakayama'), 'true');
  assert.equal(pressed(page, 'rules-national'), 'false');
  assert.equal(page.el('schedule-about').hidden, true);
  assert.equal(page.el('rules-clear').hidden, true);
  assert.match(page.el('rules-status').textContent, /和歌山県の例にしました\(段取り 15行・記載項目 16行\)/);
});

test('和歌山県の例では段取りの行が県の行になり、「読み込んだ表」と書かず、目次の点検も同じ例に変わる', async () => {
  const page = runPage();
  await page.click('sample-load');
  page.set('plan-input', '工事概要');
  await page.click('rules-wakayama');
  const shown = page.el('schedule-result').innerHTML;
  assert.ok(shown.includes('和歌山県の例の行です'), shown.slice(0, 200));
  assert.ok(shown.includes('根拠(和歌山県の例の箇所)'));
  assert.ok(shown.includes('根拠: 和歌山県の例の抜き書き'));
  assert.ok(!shown.includes('読み込んだ表'));
  assert.match(page.el('plan-result').innerHTML, /和歌山県/);
  const t = { ...parseRulesFile(FILE), label: '和歌山県の例' };
  assert.equal(buildScheduleDetail({ direct: true }, t).rows.length, 15);
  assert.ok(buildScheduleDetail({ direct: false }, t).notes.join('').startsWith('和歌山県の例は'));
  assert.equal(buildScheduleDetail({ direct: true }, parseRulesFile(FILE)).docLabel, '読み込んだ表');
});

test('国の直轄の例を押すと全部戻る', async () => {
  const page = runPage();
  await page.click('rules-wakayama');
  await page.click('rules-national');
  assert.match(notice(page), /^国の直轄の例/);
  assert.ok(!notice(page).includes('和歌山県'));
  assert.equal(pressed(page, 'rules-national'), 'true');
  assert.equal(pressed(page, 'rules-wakayama'), 'false');
  assert.equal(page.el('schedule-about').hidden, false);
});

test('ファイルの読み込みは折りたたみの中の3つ目の選び方で、読み込むと2つのボタンは押されていない形になる', async () => {
  const fold = body.slice(body.indexOf('id="rules-more"'), body.indexOf('</details>', body.indexOf('id="rules-more"')));
  assert.ok(fold.includes('id="rules-load"'));
  assert.ok(fold.includes('自分の発注者の表を読み込む'));
  assert.ok(fold.includes('直轄 = 国(国土交通省の地方整備局など)が自分で発注する工事'));
  assert.ok(fold.includes('切り替えると 3 の目次の点検の記載項目も同じ例に変わります'));
  assert.ok(!fold.includes('id="rules-status"') && !fold.includes('id="rules-clear"'), '畳んだままで見えなくなる');

  const page = runPage();
  await page.click('rules-wakayama');
  await loadOwn(page);
  assert.match(notice(page), /^読み込んだ表です\(1行\)/);
  assert.equal(pressed(page, 'rules-national'), 'false');
  assert.equal(pressed(page, 'rules-wakayama'), 'false');
  assert.equal(page.el('rules-file-on').hidden, false);
  assert.equal(page.el('rules-clear').hidden, false);

  await page.click('rules-clear');
  assert.equal(pressed(page, 'rules-national'), 'true');
  assert.equal(page.el('rules-file-on').hidden, true);
  assert.equal(page.el('rules-clear').hidden, true);
});

test('読み込んだ表から和歌山県へ移ると、手放したことを出す。壊れたファイルでは和歌山県の例のまま', async () => {
  const page = runPage();
  await loadOwn(page);
  await page.click('rules-wakayama');
  assert.match(page.el('rules-status').textContent, /読み込んだ表は手放しました/);
  assert.equal(page.el('rules-file-on').hidden, true);
  await loadOwn(page, 'こわれた');
  assert.match(page.el('rules-status').textContent, /読み込めませんでした.*今の表はそのまま/);
  assert.equal(pressed(page, 'rules-wakayama'), 'true');
  assert.match(notice(page), /7つの節だけ/);
});

test('「7つの節」は仕様書の文の節の数と合い、組み込んだ行はすべてその節の中にある', () => {
  const heads = SPEC.match(/^1-1-1-\d+ /gm).map((s) => s.trim());
  assert.deepEqual(heads, ['1-1-1-6', '1-1-1-7', '1-1-1-8', '1-1-1-9', '1-1-1-10', '1-1-1-11', '1-1-1-12']);
  const rows = JSON.parse(FILE).rows;
  assert.ok(rows.every((r) => heads.includes(r.section)));
});

test('いつも出す表示の欄に県の加工の表示・作成でない旨・取得日・利用規約があり、押す前から静的な HTML に入っている', () => {
  const foot = body.slice(body.indexOf('<footer id="credits">'), body.indexOf('</footer>'));
  assert.ok(credit.includes('和歌山県「土木請負工事必携(令和7年11月)」を加工して作成'));
  assert.ok(foot.includes(credit));
  assert.ok(foot.includes(NOT_MADE));
  assert.ok(foot.includes('取得日 2026-11-04'));
  assert.ok(foot.includes('https://www.pref.wakayama.lg.jp/prefg/081100/hikkei/k-hikkei-r0711/20251115.html'));
  assert.ok(foot.includes('和歌山県ホームページ公開情報利用規約'));
  assert.ok(!foot.slice(0, foot.indexOf('id="credit-wakayama"')).includes('<details'));
});

test('07 の決まり: 行は index.html に組み込み、外部の読み込みが無く、保存の API を足さず、断り書きと PDL が残る', () => {
  assert.ok(html.includes('wakayama_r0711_rows.json'));
  assert.ok(html.includes('"1-1-1-12"'));
  assert.equal(fs.readFileSync(new URL('../../index.html', import.meta.url), 'utf8'), html);
  assert.ok(!/<(script|link|img|iframe)\b[^>]*\b(src|href)=["']https?:/i.test(html));
  assert.match(html, /<meta http-equiv="Content-Security-Policy" content="default-src 'none'/);
  assert.ok(html.includes('id="disclaimer"') && html.includes('PDL1.0'));
  const src = ['src/ui/app.mjs', 'src/rules-load.mjs'].map((f) => fs.readFileSync(new URL('../../' + f, import.meta.url), 'utf8')).join('\n');
  assert.ok(!/localStorage|sessionStorage|indexedDB|document\.cookie|fetch\(|XMLHttpRequest/.test(src));
});

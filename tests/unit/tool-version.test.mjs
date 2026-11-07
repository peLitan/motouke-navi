// F61a: 道具の版を plugin.json の1か所から読み、画面の足と印刷の頭に入れる。CHANGELOG.md の決まり
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildHtml, toolVersion } from '../../build.mjs';
import { runPage } from '../acceptance/_helpers.mjs';

const read = (rel) => fs.readFileSync(new URL('../../' + rel, import.meta.url), 'utf8');
const manifest = JSON.parse(read('plugin/.claude-plugin/plugin.json'));
const html = buildHtml();
const body = html.slice(html.indexOf('<body>'), html.indexOf('<script'));
const shell = read('src/ui/shell.html');
const changelog = read('CHANGELOG.md');

test('版: 画面の足と印刷の頭の文字列が plugin.json の version と同じ', () => {
  assert.equal(toolVersion(), manifest.version);
  assert.ok(body.includes('<p id="tool-version">道具の版 ' + manifest.version + '</p>'), '画面の足');
  assert.ok(body.includes('<p id="print-head" class="print-only" data-version="' + manifest.version + '"></p>'), '印刷の頭');
});

test('版: 番号を shell.html に書かず、plugin.json の1か所から入れる', () => {
  assert.equal(shell.split('{{VERSION}}').length - 1, 2);
  assert.ok(!html.includes('{{VERSION}}'), '置き換え忘れ');
  for (const id of ['tool-version', 'print-head']) {
    const line = shell.split('\n').find((l) => l.includes('id="' + id + '"'));
    assert.ok(line && !/\d+\.\d+\.\d+/.test(line), id + ' の行に番号が直書きされている');
  }
});

test('版: 画面の足は出典の表示の下、印刷の頭は上の帯の中で、紙にだけ出す', () => {
  assert.ok(body.indexOf('id="tool-version"') > body.indexOf('e-Gov 法令 API'));
  assert.ok(body.indexOf('id="tool-version"') < body.indexOf('</footer>'));
  assert.match(body, /<\/h1>\s*<p id="print-head" class="print-only" data-version="[^"]+"><\/p>\s*<button type="button" id="ref-open" class="topbar-link no-print">使った資料<\/button>\s*<\/div><\/header>/);
});

test('印刷の頭: ボタンで版と日時を描き、PC の時計の時刻で書く(UTC ではない)', async () => {
  const tz = process.env.TZ;
  process.env.TZ = 'Asia/Tokyo';
  try {
    const z = (n) => String(n).padStart(2, '0');
    const fmt = (d) => d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate()) + ' ' + z(d.getHours()) + ':' + z(d.getMinutes());
    const page = runPage();
    assert.equal(page.el('print-head').textContent, '', '印刷の前は空');
    await page.click('sample-load');
    await page.click('confirm-go');
    const from = fmt(new Date()); // 見本の読み込みで分の境をまたがないよう、押す直前に取る
    await page.click('print-btn');
    const to = fmt(new Date());
    assert.equal(page.printed.count, 1);
    const line = page.el('print-head').textContent;
    assert.ok([from, to].some((t) => line === '版 ' + manifest.version + '・印刷した日時 ' + t), line);
  } finally {
    if (tz === undefined) delete process.env.TZ; else process.env.TZ = tz;
  }
});

test('印刷の頭: ブラウザのメニューから印刷しても描く(beforeprint)', () => {
  const page = runPage();
  page.el('print-btn').dispatchEvent({ type: 'beforeprint', bubbles: true });
  assert.match(page.el('print-head').textContent, /^版 \d+\.\d+\.\d+・印刷した日時 \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  assert.equal(page.printed.count, 0);
});

test('CHANGELOG: 今の版の見出しがあり、plugin.json が1か所の決まりと git log の案内を書く', () => {
  assert.ok(changelog.includes('## ' + manifest.version + '('), '今の版の見出しが無い');
  assert.ok(changelog.includes('`plugin/.claude-plugin/plugin.json`'));
  assert.ok(changelog.includes('`git log`'));
});

test('CHANGELOG: 数字は版・機能の番号・日付だけ', () => {
  const rest = changelog
    .replace(/\b\d+\.\d+\.\d+\b/g, '')
    .replace(/\bF\d+[a-z]?\d*\b/g, '')
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, '');
  assert.deepEqual(rest.match(/[0-9０-９〇一二三四五六七八九十百千万億]+/gu) ?? [], []);
});

test('CHANGELOG: 版ごとの機能の番号が重ならない', () => {
  const ids = [...changelog.matchAll(/^- (F\d+[a-z]?\d*):/gm)].map((m) => m[1]);
  assert.ok(ids.length > 0);
  assert.equal(new Set(ids).size, ids.length);
});

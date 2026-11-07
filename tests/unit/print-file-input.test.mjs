// F84f: 「全部を印刷する」の紙に「ファイルの選択 ファイルが選択されていません」が3か所出ていた。
// ファイルを選ぶ部品は紙では使えないので、input[type=file] と枠のラベルを紙に出さない。決まりは印刷の CSS に置く。
// 入力・ラベル・案内はどれも枠(.drop)の中にあるので、枠ごと隠す。input の決まりにしないのは、画面で入力を見えたままにする
// ui-drop の (1) の検査が shell.html の全体を見ていて、紙の中でも input に display: none を書く形を断るため。
// この環境にはブラウザが無いので、紙の見た目は測れない。CSS の決まりと、作った HTML の形を確かめる
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHtml } from '../../build.mjs';

const html = buildHtml();
const css = html.slice(html.indexOf('<style'), html.indexOf('</style>')).replace(/\/\*[\s\S]*?\*\//g, '');
const printText = css.match(/@media print \{([\s\S]*)\n {2}\}/)[1].replace(/@page \{[^{}]*\}/, '');
const screen = css.slice(0, css.indexOf('@media print'));
const body = html.slice(html.indexOf('<body')).replace(/<script\b[\s\S]*?<\/script>/g, '');

const parse = (text) => [...text.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2].trim() }));
const selectorsOf = (r) => r.sel.split(',').map((s) => s.trim());
const print = parse(printText);
const hiddenOnPaper = print.filter((r) => /display: none !important/.test(r.body)).flatMap(selectorsOf);

const FRAME = '.drop';
const fileIds = [...body.matchAll(/<input type="file" id="([a-z-]+)"/g)].map((m) => m[1]);
const frames = new Map([...body.matchAll(/<div class="row drop" data-drop="([a-z-]+)">([\s\S]*?)<\/div>/g)].map((m) => [m[1], m[2]]));

// .no-print の要素の範囲。この中の部品は、もともと紙に出ない
const noPrintRanges = [...body.matchAll(/<(details|section|div|p)\b[^>]*\bclass="[^"]*\bno-print\b[^"]*"[^>]*>/g)].map((m) => {
  const re = new RegExp('<(/?)' + m[1] + '\\b', 'g');
  re.lastIndex = m.index + m[0].length;
  let depth = 1;
  for (let t = re.exec(body); depth > 0 && t; t = re.exec(body)) if ((depth += t[1] ? -1 : 1) === 0) return [m.index, t.index];
  throw new Error(m[0] + ' の閉じが無い');
});
const inNoPrint = (at) => noPrintRanges.some(([from, to]) => from <= at && at < to);

test('ファイルの入力はどれも枠の中で、ラベルも同じ枠の中にある(枠を隠すと両方が隠れる形)', () => {
  assert.ok(fileIds.length > 0);
  assert.deepEqual([...frames.keys()].sort(), fileIds.slice().sort(), '枠と入力の組が合わない');
  for (const id of fileIds) {
    assert.match(frames.get(id), new RegExp('<input type="file" id="' + id + '"'), id + ' が枠の中に無い');
    assert.match(frames.get(id), new RegExp('<label for="' + id + '">'), id + ' のラベルが枠の中に無い');
    assert.equal((body.match(new RegExp('<label for="' + id + '"', 'g')) || []).length, 1, id + ' のラベルが枠の外にもある');
  }
});

test('紙に出ていた3か所は、ほかの決まりでは隠れていない(この決まりが要る所)', () => {
  const shown = fileIds.filter((id) => !inNoPrint(body.indexOf('<input type="file" id="' + id + '"')));
  assert.deepEqual(shown.sort(), ['ai-load', 'ledger-file', 'plan-file']);
});

test('紙: ファイルの入力と枠のラベルを、枠ごと出さない', () => {
  assert.ok(hiddenOnPaper.includes(FRAME), '枠が紙に出る');
});

test('全部の紙とメニューからの印刷にも効く: 決まりに body.print-brief の印が付いていない', () => {
  const r = print.find((x) => selectorsOf(x).includes(FRAME));
  assert.ok(r);
  assert.deepEqual(selectorsOf(r), [FRAME], '同じ決まりに別の物が混ざった');
  assert.match(r.body, /^display: none !important;/);
});

test('紙で出し直す決まりが無い', () => {
  const rules = print.filter((r) => selectorsOf(r).some((s) => /input\[type="file"\]|(^|[\s>])label\b|\.drop\b/.test(s)));
  for (const r of rules) {
    const shown = r.body.match(/(?:^|;)\s*display\s*:\s*([^;]+)/)?.[1].trim();
    assert.ok(shown === undefined || shown === 'none !important', r.sel + ' が紙で ' + shown + ' になっている');
  }
});

test('枠の中にあるのは隠してよい物だけ: 紙から結果や知らせが消えない', () => {
  for (const [id, inner] of frames) {
    const rest = inner
      .replace(/<label for="[a-z-]+">[^<]*<\/label>/g, '')
      .replace(/<input type="file"[^>]*>/g, '')
      .replace(/<span class="drop-hint">[^<]*<\/span>/g, '')
      .replace(/<button type="button" id="[a-z-]+">[^<]*<\/button>/g, '');
    assert.equal(rest.trim(), '', id + ' の枠に隠してはいけない物が入った');
  }
});

test('枠の印の付く物は枠だけで、入口の大きなボタン(drop-tile)は別の印のまま', () => {
  const tagged = [...body.matchAll(/class="([^"]*)"/g)].filter((m) => m[1].split(/\s+/).includes('drop'));
  assert.equal(tagged.length, fileIds.length);
  assert.ok(tagged.every((m) => m[1] === 'row drop'));
});

test('紙に残す物は隠さない: 入力の欄・ラベル全部・行そのものを隠す決まりは無い', () => {
  for (const s of ['label', 'input', 'textarea', 'select', '.row', '.form', '.result']) assert.ok(!hiddenOnPaper.includes(s), s + ' を紙で隠している');
  // 読み込んだ結果の欄と知らせは枠の外にある
  for (const id of ['ledger-unreadable', 'ai-result', 'check-status', 'plan-status']) {
    assert.ok(body.includes('id="' + id + '"'), id + ' が無い');
    for (const inner of frames.values()) assert.ok(!inner.includes('id="' + id + '"'), id + ' が枠の中に入った');
  }
});

test('画面は変えない: 入力と枠を隠す決まりは紙の中だけ', () => {
  for (const r of parse(screen)) {
    for (const s of selectorsOf(r)) {
      if (s !== 'input[type="file"]' && !/^\.drop\b/.test(s) && !/\.row label$/.test(s)) continue;
      if (s === '.drop-hint') continue; // 案内は画面でも、マウスのある端末だけ出す(F54c)
      assert.ok(!/display\s*:\s*none/.test(r.body), s + ' が画面で隠れている');
    }
  }
});

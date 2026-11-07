// raw/ の PDF を止める(F82e): raw/x.pdf の Read(pages 付き)と pdftoppm。raw/ の外の .pdf は今までどおり通す。
// フックの入口は標準入力の JSON を読み、止めると終了コード 2 で終わる。値はすべて架空で、通信しない
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as pluginGuard from '../../plugin/scripts/guard-raw.mjs';
import * as baseGuard from '../../integration/claude-code/hooks/guard-raw.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
fs.mkdirSync(path.join(ROOT, 'tmp'), { recursive: true });
const WORK = fs.mkdtempSync(path.join(ROOT, 'tmp', 'guard-pdf-'));
after(() => fs.rmSync(WORK, { recursive: true, force: true }));
const noChild = process.permission ? !process.permission.has('child') : false;
const childSkip = { skip: noChild && '子プロセスを許さない権限(init の試験)。node --test で確かめる' };
const ENV = { HOME: '/home/example' };

fs.mkdirSync(path.join(WORK, 'raw'));
fs.mkdirSync(path.join(WORK, '公告'));
fs.writeFileSync(path.join(WORK, 'raw', 'x.pdf'), '%PDF-1.4 架空');
fs.writeFileSync(path.join(WORK, '公告', 'x.pdf'), '%PDF-1.4 架空');

const readPdf = (rel, pages = '1-3') => ({ tool_name: 'Read', tool_input: { file_path: path.join(WORK, rel), pages }, cwd: WORK });
const bash = (command) => ({ tool_name: 'Bash', tool_input: { command }, cwd: WORK });

for (const [label, g, script] of [
  ['プラグインの写し', pluginGuard, 'plugin/scripts/guard-raw.mjs'],
  ['integration の元', baseGuard, 'integration/claude-code/hooks/guard-raw.mjs'],
]) {
  const run = (input) => spawnSync(process.execPath, [path.join(ROOT, script)], { input: JSON.stringify(input), encoding: 'utf8', env: { ...process.env, ...ENV } });

  test(`${label}: raw/x.pdf の Read(pages 付き)と pdftoppm を止める`, () => {
    assert.equal(g.decideTool(readPdf('raw/x.pdf'), ENV).block, true);
    assert.equal(g.decideTool(readPdf('RAW/x.pdf'), ENV).block, true);
    assert.equal(g.decideTool(bash('pdftoppm -png raw/x.pdf out'), ENV).block, true);
    // PDF の中身は置き換えられないので、頁を画像にする別の命令も同じ
    assert.equal(g.decideTool(bash('pdftotext raw/x.pdf -'), ENV).block, true);
  });

  test(`${label}: 入口の終了コードは、止めると 2`, childSkip, () => {
    for (const input of [readPdf('raw/x.pdf'), bash('pdftoppm -png raw/x.pdf out')]) {
      const r = run(input);
      assert.equal(r.status, 2, r.stderr);
      assert.notEqual(r.stderr.trim(), '');
    }
  });

  test(`${label}: raw/ の外の .pdf の Read は今までどおり通す(pages があっても)`, () => {
    for (const pages of ['1-3', undefined]) assert.notEqual(g.decideTool(readPdf('公告/x.pdf', pages), ENV).block, true);
  });

  test(`${label}: raw/ の外の .pdf の Read は入口でも 0`, childSkip, () => {
    assert.equal(run(readPdf('公告/x.pdf')).status, 0);
  });
}

// F27a の単体の試験: raw/ がある作業フォルダで、raw の文字を含まない操作で生の書類を読む道を止める(値はすべて架空)
// 反証役の第1弾の再現の入力(C-1)と、点検の Skill のスクリプト・評価のケースが止まらないことを確かめる
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as pluginGuard from '../../plugin/scripts/guard-raw.mjs';
import * as baseGuard from '../../integration/claude-code/hooks/guard-raw.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PLUGIN = path.join(ROOT, 'plugin');
const ENV = { HOME: '/home/example' }; // CLAUDE_PLUGIN_ROOT を渡さない(プラグインのフォルダはファイルの置き場で決まる)

// 作業フォルダ: raw/a.txt(架空の生の書類)と masked/b.txt、書いたスクリプト
function makeWork(name) {
  const dir = path.join(ROOT, 'tmp', 'f27a-' + name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(path.join(dir, 'raw'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'masked'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'tmp'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'raw', 'a.txt'), '現場代理人 甲野 一郎(架空)。乙川工業株式会社(架空)。');
  fs.writeFileSync(path.join(dir, 'masked', 'b.txt'), '〔人名1〕');
  fs.writeFileSync(path.join(dir, 'read.mjs'), "import fs from 'node:fs';\nconsole.log(fs.readFileSync('r' + 'aw/a.txt', 'utf8'));\n");
  fs.writeFileSync(path.join(dir, 'hello.mjs'), "console.log('こんにちは');\n");
  fs.writeFileSync(path.join(dir, 'show.sh'), '#!/bin/sh\ncat r?w/a.txt\n');
  fs.writeFileSync(path.join(dir, 'ok.sh'), '#!/bin/sh\ncat masked/b.txt\n');
  return dir;
}

const bash = (g, command, cwd) => g.decideTool({ tool_name: 'Bash', tool_input: { command }, cwd }, ENV);
const ps = (g, command, cwd) => g.decideTool({ tool_name: 'PowerShell', tool_input: { command }, cwd }, ENV);

for (const [label, g] of [['プラグインの写し', pluginGuard], ['integration の元', baseGuard]]) {
  test(`${label}: 反証の再現の入力(raw の文字を含まないコマンド)が止まる`, () => {
    const cwd = makeWork('c1-' + (g === pluginGuard ? 'p' : 'b'));
    const blocked = [
      'cat r?w/a.txt', 'cat */a.txt', 'cat [r]aw/a.txt', 'cat {raw,x}/a.txt', 'head -3 **/*.txt', 'cat R?W/a.txt',
      'grep -r 甲野 .', 'grep -rn 甲野', 'grep --recursive 甲野 .', 'rg 乙川', 'rg -m 5 乙川', 'ag 乙川 .', 'find . -type f -exec cat {} +', 'find . -name "*.txt"', 'tree', 'ls -R',
      "node -e \"console.log(require('fs').readFileSync('r'+'aw/a.txt','utf8'))\"", "python3 -c \"print(open('r'+'aw/a.txt').read())\"", "bash -c 'cat r?w/a.txt'",
      'node read.mjs', 'node ./read.mjs', 'sh show.sh', './show.sh', 'node missing.mjs', 'node < read.mjs',
      'ln -s ./r?w ./m', 'D=r; cat ${D}aw/a.txt', 'cat $(echo r)aw/a.txt', "cat $'\\x72aw/a.txt'", 'ls | xargs cat', 'cd masked && cat ../r?w/a.txt',
      'cat RAW/a.txt', 'cat Raw/a.txt',
    ];
    for (const c of blocked) assert.equal(bash(g, c, cwd).block, true, '止まらない: ' + c);
    // PowerShell のワイルドカード・再帰
    for (const c of ['Get-Content r?w\\a.txt', 'gc .\\r*\\a.txt', 'Get-ChildItem -Recurse | Get-Content', 'gci -r -File', 'Select-String -Path */a.txt -Pattern 甲野', 'pwsh -Command "gc r?w/a.txt"']) {
      assert.equal(ps(g, c, cwd).block, true, '止まらない(PowerShell): ' + c);
    }
    // 止めた理由に、人に回す文か read_masked への案内がある
    assert.match(bash(g, 'node -e "1"', cwd).reason, /人が中身を確かめて/);
    assert.match(bash(g, 'cat r?w/a.txt', cwd).reason, /read_masked/);
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  test(`${label}: raw/ がある作業フォルダでも、raw/ に届かないコマンドは通す`, () => {
    const cwd = makeWork('ok-' + (g === pluginGuard ? 'p' : 'b'));
    for (const c of ['cat masked/b.txt', 'cat masked/*.txt', 'grep -r 人名 masked', 'rg 人名 masked/', 'find masked -name "*.txt"', 'ls', 'ls masked', 'node hello.mjs', 'sh ok.sh', "awk '{print $1}' masked/b.txt", 'git status', 'wc -l masked/b.txt', 'echo $HOME']) {
      assert.equal(bash(g, c, cwd).block, false, '止めすぎ: ' + c + ' → ' + bash(g, c, cwd).reason);
    }
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  test(`${label}: raw/ が無い作業フォルダでは、今までどおり raw の文字だけを見る`, () => {
    const cwd = path.join(ROOT, 'tmp', 'f27a-noraw');
    fs.rmSync(cwd, { recursive: true, force: true });
    fs.mkdirSync(cwd, { recursive: true });
    assert.equal(bash(g, 'cat */a.txt', cwd).block, false);
    assert.equal(bash(g, 'node -e "1"', cwd).block, false);
    assert.equal(bash(g, 'grep -r x .', cwd).block, false);
    assert.equal(bash(g, 'cat raw/a.txt', cwd).block, true);
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  test(`${label}: Write・Edit は書く中身に raw/ の読み取りの形があれば止め、ただの文は通す`, () => {
    const cwd = makeWork('write-' + (g === pluginGuard ? 'p' : 'b'));
    const w = (file_path, content) => g.decideTool({ tool_name: 'Write', tool_input: { file_path, content }, cwd }, ENV);
    assert.equal(w('read.mjs', "import fs from 'node:fs';\nconsole.log(fs.readFileSync('raw/a.txt','utf8'));").block, true);
    assert.equal(w('notes.txt', "fs.readFileSync('raw/a.txt')").block, true);
    assert.equal(w('run.sh', 'cat raw/a.txt').block, true);
    assert.equal(w('run.sh', '#!/bin/sh\ncat raw/a.txt').block, true);
    assert.equal(g.decideTool({ tool_name: 'Edit', tool_input: { file_path: 'x.py', old_string: 'a', new_string: "open('raw/a.txt')" }, cwd }, ENV).block, true);
    assert.equal(g.decideTool({ tool_name: 'MultiEdit', tool_input: { file_path: 'x.js', edits: [{ old_string: 'a', new_string: "require('fs').readFileSync('./raw/a.txt')" }] }, cwd }, ENV).block, true);
    // 指摘の文に raw/ のファイル名が出るだけなら通す(点検の結果を書く)
    assert.equal(w('tmp/指摘.md', '1. raw/施工体制台帳.md の健康保険の欄が空に見える。根拠: 建設業法施行規則第14条の2第1項第3号ハ').block, false);
    assert.equal(w('tmp/指摘.json', JSON.stringify([{ type: 'missing', doc: 'raw/施工体制台帳.md' }])).block, false);
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  test(`${label}: シンボリックリンクは実体のパスで判断する。RAW のような大文字も raw とみなす`, (t) => {
    const cwd = makeWork('link-' + (g === pluginGuard ? 'p' : 'b'));
    try {
      fs.symlinkSync(path.join(cwd, 'raw'), path.join(cwd, 'm'));
    } catch (e) {
      // init.mjs は node の権限の決まりの中で試験を動かし、リンクを作れない。そのときだけ飛ばす(node --test で直接動かすと確かめる)
      if (e.code !== 'ERR_ACCESS_DENIED') throw e;
      fs.rmSync(cwd, { recursive: true, force: true });
      t.skip('リンクを作る権限が無い環境(init の試験)');
      return;
    }
    for (const file_path of ['m/a.txt', path.join(cwd, 'm', 'a.txt'), 'RAW/a.txt', 'Raw/a.txt']) {
      assert.equal(g.decideTool({ tool_name: 'Read', tool_input: { file_path }, cwd }, ENV).block, true, file_path);
    }
    assert.equal(bash(g, 'cat m/a.txt', cwd).block, true);
    assert.equal(g.decideTool({ tool_name: 'Grep', tool_input: { pattern: '甲野', path: 'm' }, cwd }, ENV).block, true);
    assert.equal(g.decideTool({ tool_name: 'Glob', tool_input: { pattern: 'r?w/*' }, cwd }, ENV).block, true);
    assert.equal(g.decideTool({ tool_name: 'Glob', tool_input: { pattern: '*/a.txt' }, cwd }, ENV).block, true);
    assert.equal(g.decideTool({ tool_name: 'Glob', tool_input: { pattern: 'masked/*.txt' }, cwd }, ENV).block, false);
    assert.equal(g.decideTool({ tool_name: 'Read', tool_input: { file_path: 'masked/b.txt' }, cwd }, ENV).block, false);
    assert.equal(g.decidePrompt({ prompt: '@m/a.txt を見て', cwd }).block, true);
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  test(`${label}: Grep は探す場所の深い所の raw/ でも止める`, () => {
    const cwd = path.join(ROOT, 'tmp', 'f27a-deep-' + (g === pluginGuard ? 'p' : 'b'));
    fs.rmSync(cwd, { recursive: true, force: true });
    fs.mkdirSync(path.join(cwd, '案件', 'A', 'raw'), { recursive: true });
    assert.equal(g.decideTool({ tool_name: 'Grep', tool_input: { pattern: '甲野' }, cwd }, ENV).block, true);
    assert.equal(g.decideTool({ tool_name: 'Grep', tool_input: { pattern: '甲野', path: '案件' }, cwd }, ENV).block, true);
    assert.equal(bash(g, 'grep -r 甲野 案件', cwd).block, true);
    fs.rmSync(cwd, { recursive: true, force: true });
  });
}

test('点検の Skill のスクリプト(check-articles.mjs)は、raw/ がある作業フォルダでも止まらない(プラグインのフォルダのスクリプトは通す)', () => {
  const cwd = makeWork('skill');
  const script = path.join(PLUGIN, 'skills', 'construction-check', 'scripts', 'check-articles.mjs');
  assert.ok(fs.existsSync(script));
  for (const c of [`node ${script} tmp/指摘.md`, `node "${script}" tmp/指摘.json`, `cat tmp/指摘.md | node ${script}`]) {
    assert.equal(bash(pluginGuard, c, cwd).block, false, c + ' → ' + bash(pluginGuard, c, cwd).reason);
  }
  // 環境変数 CLAUDE_PLUGIN_ROOT で渡されたときも通す
  assert.equal(pluginGuard.decideTool({ tool_name: 'Bash', tool_input: { command: 'node "${CLAUDE_PLUGIN_ROOT}/skills/construction-check/scripts/check-articles.mjs" tmp/指摘.md' }, cwd }, { CLAUDE_PLUGIN_ROOT: PLUGIN }).block, false);
  // Skill が自分の reference/・scripts/ を読む
  for (const file_path of [path.join(PLUGIN, 'skills', 'construction-check', 'SKILL.md'), path.join(PLUGIN, 'skills', 'construction-check', 'reference', 'articles.md'), path.join(PLUGIN, 'skills', 'construction-check', 'reference', 'sources', 'law-kensetsu-26.txt')]) {
    assert.equal(pluginGuard.decideTool({ tool_name: 'Read', tool_input: { file_path }, cwd }, ENV).block, false, file_path);
  }
  // プラグインのフォルダの外の、同じ中身のスクリプトは中身を見て止める
  fs.copyFileSync(script, path.join(cwd, 'check.mjs'));
  assert.equal(bash(pluginGuard, 'node check.mjs tmp/指摘.md', cwd).block, true);
  fs.rmSync(cwd, { recursive: true, force: true });
});

test('評価のケース(plugin/evals): 頼み方・Skill の手順・採点が止まらず、raw/ の Read は止まる', () => {
  const casesDir = path.join(PLUGIN, 'evals', 'cases');
  const cases = fs.readdirSync(casesDir).filter((d) => fs.existsSync(path.join(casesDir, d, 'case.json')));
  assert.ok(cases.length >= 2);
  for (const id of cases) {
    const c = JSON.parse(fs.readFileSync(path.join(casesDir, id, 'case.json'), 'utf8'));
    // README の走らせ方: 作業フォルダに raw/ だけを写す
    const cwd = path.join(ROOT, 'tmp', 'f27a-eval-' + c.id);
    fs.rmSync(cwd, { recursive: true, force: true });
    fs.cpSync(path.join(casesDir, id, 'raw'), path.join(cwd, 'raw'), { recursive: true });
    assert.equal(pluginGuard.decidePrompt({ prompt: c.prompt, cwd }).block, false, c.id + ' の頼み方が止まった');
    const script = path.join(PLUGIN, 'skills', 'construction-check', 'scripts', 'check-articles.mjs');
    const w = pluginGuard.decideTool({ tool_name: 'Write', tool_input: { file_path: path.join(cwd, 'tmp', '指摘.md'), content: `1. ${c.documents[0]} の欄が空に見える。根拠: 建設業法第26条第3項「専任の者でなければならない」` }, cwd }, ENV);
    assert.equal(w.block, false, c.id + ' の指摘の書き込みが止まった');
    assert.equal(bash(pluginGuard, `mkdir -p tmp && node ${script} tmp/指摘.md`, cwd).block, false, c.id + ' の条番号の確かめが止まった');
    for (const doc of c.documents) {
      assert.equal(pluginGuard.decideTool({ tool_name: 'Read', tool_input: { file_path: doc }, cwd }, ENV).block, true, doc);
    }
    fs.rmSync(cwd, { recursive: true, force: true });
  }
  // 人がリポジトリで採点を回す(node plugin/evals/score.mjs)
  assert.equal(bash(pluginGuard, 'node plugin/evals/score.mjs plugin/evals/cases/E1_しおかぜ町下水道/case.json tmp/answer.md', ROOT).block, false);
});

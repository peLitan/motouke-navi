// F80e: README の「審査で確かめる所(5分)」の節。置き場所、開く物と命令の実在、数の形、語、モデルを呼ぶ命令の分け方を確かめる
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const readme = read('README.md');
const HEAD = '## 審査で確かめる所(5分)';
const section = readme.split(HEAD)[1]?.split('\n## ')[0] ?? '';
const SUB = '### モデルを呼ぶ命令';
const [above = '', below = ''] = section.split(SUB);
const COUNTED = /数字は版 ([0-9a-f]{7,40}) で (\d{4}-\d{2}-\d{2} \d{2}:\d{2}) に数えた値。モデルを呼ぶ命令は最後に分けた/;
const COLUMNS = ['審査の基準(要点)', '開く物', '命令(モデルを呼ばない)', '出る数(数えた日時)', '動画に映るか'];

// 表の1行を欄に分ける。命令の中の `\|` は区切りにしない
const cells = (line) => line.replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map((c) => c.trim());
const tableLines = above.split('\n').filter((l) => l.startsWith('|'));
const rows = tableLines.slice(2).map(cells);
const row = (name) => rows.find((r) => r[0].includes(name)) ?? assert.fail(`行が無い: ${name}`);
const codeSpans = (s) => [...s.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
const linkTargets = (s) => [...s.matchAll(/\]\(([^)#]+)(?:#[^)]*)?\)/g)].map((m) => m[1]).filter((t) => t);

test('節は1つで、デモの後・業界の構造の前にあり、5分で試せる手順の切り出しの中に無い', () => {
  assert.equal(readme.split(HEAD).length - 1, 1);
  const at = readme.indexOf(HEAD);
  assert.ok(readme.indexOf('\n## デモ\n') < at);
  assert.ok(at < readme.indexOf('\n## 業界の構造'));
  assert.equal(readme.split('## 5分で試せる手順')[1].split('\n## ')[0].includes('審査で確かめる所'), false);
});

test('冒頭の行が版と YYYY-MM-DD HH:MM の日時を持ち、表は5列で6行、どの行も5欄に分かれる', () => {
  assert.match(section.trimStart().split('\n')[0], COUNTED);
  assert.deepEqual(cells(tableLines[0]), COLUMNS);
  assert.equal(rows.length, 6);
  for (const r of rows) assert.equal(r.length, 5, r[0]);
  for (const r of rows) assert.ok(r.every((c) => c.length > 0), r[0]);
});

test('表に挙げたファイルと、命令に出るスクリプト・試験が実在する', () => {
  const targets = new Set(linkTargets(above));
  for (const span of codeSpans(tableLines.join('\n'))) {
    for (const word of span.replaceAll('\\|', ' ').split(/\s+/)) {
      if (/^(plugin|docs|tests|scripts|src)\//.test(word)) targets.add(word);
    }
  }
  assert.ok(targets.size >= 10, [...targets].join(' '));
  for (const t of targets) {
    if (t.includes('*')) {
      const [dir, tail] = t.split('/*');
      const names = fs.readdirSync(path.join(ROOT, dir));
      const hits = tail.startsWith('/') ? names.filter((n) => fs.existsSync(path.join(ROOT, dir, n + tail))) : names.filter((n) => n.endsWith(tail));
      assert.ok(hits.length > 0, t);
    } else {
      assert.ok(fs.existsSync(path.join(ROOT, t)), t);
    }
  }
});

test('6行の命令が設計どおりで、表の中の | は \\| と書いてある', () => {
  assert.ok(row('開発の中心')[2].includes('git log --format=%s \\| head -20'));
  assert.ok(row('使い分け')[2].includes('claude plugin validate ./plugin'));
  const design = row('設計と実装')[2];
  for (const c of ['node --test tests/acceptance/*.test.mjs', 'node --test tests/unit/*.test.mjs', 'node scripts/quote-rate.mjs']) assert.ok(design.includes(c), c);
  for (const f of ['plugin/hooks/hooks.json', 'plugin/agents/refuter.md', 'plugin/.mcp.json', 'plugin/skills/*/SKILL.md']) assert.ok(row('使い分け')[1].includes(f), f);
  assert.ok(row('設計と実装')[1].includes('docs/acceptance-map.md'));
  assert.ok(row('使う人')[1].includes('「残っていること'));
  assert.ok(row('使う人')[1].includes('限界'));
});

test('出る数: どの行にも日時があり、試験の数に OS と Node の版が添えてある', () => {
  for (const r of rows) assert.match(r[3], /\d{4}-\d{2}-\d{2} \d{2}:\d{2}/, r[0]);
  const count = row('設計と実装')[3];
  assert.match(count, /受け入れ tests \d+/);
  assert.match(count, /単体 tests \d+/);
  assert.match(count, /Ubuntu \d+\.\d+/);
  assert.match(count, /Node \d+\.\d+\.\d+/);
  assert.ok(row('使い分け')[3].includes('author'));
  assert.ok(row('使い分け')[3].includes('icon'));
  assert.ok(row('使い分け')[3].includes('注意2つ'));
});

test('出る数: 抜き書きの数は README の評価の節と、残りの行の数は開発の記録と同じ', () => {
  const quotes = readme.match(/規則表の抜き書き (\d+) 件が原文にある/)[1];
  assert.ok(row('設計と実装')[3].includes(`抜き書き ${quotes} 件`));
  const rest = read('docs/development.md').split('\n').filter((l) => l.startsWith('| 残 ')).length;
  assert.ok(rest > 0);
  assert.ok(row('使う人')[3].includes(`${rest} 行`));
});

test('コミットの2つの数は、冒頭の版を git で数えた値と同じ(.git の無い写しでは見ない)', (t) => {
  const hash = section.match(COUNTED)[1];
  const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  let all;
  try {
    all = git('rev-list', '--count', hash);
  } catch {
    t.skip('git で版を読めない');
    return;
  }
  const co = git('rev-list', '--count', hash, '--grep=Co-Authored-By: Claude');
  const cell = row('開発の中心')[3];
  assert.ok(cell.includes(`${all} 件`), cell);
  assert.ok(cell.includes(`${co} 件`), cell);
  const command = row('開発の中心')[2];
  assert.ok(command.includes(`git rev-list --count ${hash}`));
  assert.ok(command.includes(`git rev-list --count ${hash} --grep='Co-Authored-By: Claude'`));
});

test('動画の列の場面の番号は台本にあり、挙げた仕組みがその場面の行にある', () => {
  const script = read('docs/demo-script.md');
  const scene = (n) => script.split('\n').find((l) => l.startsWith(`| ${n} | `)) ?? assert.fail(`場面 ${n} が無い`);
  const named = [...row('使い分け')[4].matchAll(/場面 ([\d・]+)\(([^)]+)\)/g)];
  assert.equal(named.length, 4);
  const word = { Skill: 'Skill', hook: 'hook', MCP: 'read_masked', '係': 'refuter' };
  for (const [, nums, what] of named) {
    for (const n of nums.split('・')) assert.ok(scene(n).includes(word[what]), `${n} ${what}`);
  }
  assert.ok(scene(row('使う人')[4].match(/場面 (\d+)/)[1]).includes('注意の文'));
  assert.ok(scene(10).includes('札2'));
});

test('動画に無い行が4つの仕組みを指し、開く記録と残りの番号がある', () => {
  const r = row('動画に無い');
  assert.ok(r[4].includes('動画には無い。ここで確かめる'));
  for (const s of ['check_articles', '公式の評価', 'Stop の hook', 'refuter']) assert.ok(r[4].includes(s), s);
  assert.equal(section.split('動画には無い').length - 1, 1);
  for (const s of ['「走らせた記録」', 'docs/評価.md', 'plugin/skills/construction-check/SKILL.md']) assert.ok(r[1].includes(s), s);
  const record = read('docs/development.md');
  for (const [, n] of r[3].matchAll(/残 (\d+)/g)) assert.ok(record.includes(`| 残 ${n} |`), n);
  assert.match(r[3], /残 \d+/);
});

test('モデルを呼ぶ命令は節の最後の小見出しの下にだけあり、表の行は呼ばない', () => {
  assert.equal(section.split(SUB).length - 1, 1);
  assert.equal(below.includes('\n#'), false);
  for (const c of ['claude plugin eval', 'claude-headless']) {
    assert.equal(above.includes(c), false, c);
    assert.ok(below.includes(c), c);
  }
  assert.ok(below.includes('動かす人の契約の範囲で'));
  assert.ok(below.includes('docs/評価.md'));
  assert.ok(below.includes('「走らせ方」'));
  assert.ok(read('docs/評価.md').includes('### 走らせ方'));
});

test('本文に使わない語が無く、評価・画面なし・mask-rate の値を書いていない', () => {
  for (const w of ['安心して', '初心者', '事故を防', '指名停止', 'あらゆる公共工事', '積算できる', '費用もその人の契約', '費用と時間の目安', 'Claude の使用量がかかります']) {
    assert.equal(section.includes(w), false, w);
  }
  assert.equal(/\d(\.\d+)?\s*%/.test(section), false, '率');
  assert.equal(/\$\s*\d/.test(section), false, '費用の値');
  assert.equal(/\b0\.\d+/.test(section), false, '点');
  assert.equal(/\d+ *往復|\d+ *件のうち|残る \d|崩れた \d/.test(section), false, '画面なしの値');
  // 評価の値で書くのは、受け入れ条件の挙げた 5→7→9 と古い組の 7/8 → 8/8 だけ
  const fractions = [...section.matchAll(/\d+\/\d+/g)].map((m) => m[0]);
  assert.ok(fractions.every((f) => ['7/8', '8/8'].includes(f)), fractions.join(' '));
  for (const line of section.split('\n')) if (/[78]\/8/.test(line)) assert.ok(line.includes('古い組'));
  assert.ok(row('試行錯誤')[3].includes('5→7→9'));
});

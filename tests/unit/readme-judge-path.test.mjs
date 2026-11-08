// F80e: README の「審査で確かめる所(5分)」の節。置き場所、開く物と命令の実在、数の形、語、モデルを呼ぶ命令の分け方を確かめる
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
// README.md から docs/details.md へ移した節を見る(2026-11-08 統括: README を整えた)
const readme = read('docs/details.md');
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
// docs/details.md の中のリンクは docs/ から見た道筋なので、リポジトリの直下からの道筋に直して比べる
const linkTargets = (s) => [...s.matchAll(/\]\(([^)#]+)(?:#[^)]*)?\)/g)].map((m) => m[1]).filter((t) => t).map((t) => path.posix.normalize('docs/' + t));

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
  for (const s of ['「走らせた記録」', 'docs/評価.md', 'plugin/skills/construction-check/SKILL.md', 'plugin/hooks/hooks.json']) assert.ok(r[1].includes(s), s);
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

// F85m: 表の下の1行。節の本文の決まり(上の試験)で、点の形の数は書かない。E3 の差は「差 0」と書く
const EVAL_VERSION = '17b7bc2';
const afterTable = above.split('\n').slice(above.split('\n').lastIndexOf(tableLines.at(-1)) + 1).filter((l) => l.trim());
const evalLine = afterTable[0] ?? '';

test('F85m: 表のすぐ下の1行に、新しい組の判定と版と評価の文書へのリンクがある', () => {
  assert.equal(afterTable.length, 1, afterTable.join('\n'));
  for (const w of ['E1 不合格', 'E2 不合格', 'E3 合格(差 0)', 'E4 合格', '判定役の検査だけ', '測った範囲で 0', `版 ${EVAL_VERSION}`, '2026-11-07']) {
    assert.ok(evalLine.includes(w), w);
  }
  assert.ok(evalLine.includes('手順の最後の行は3回とも落ち'), '差の無い合格だけを書かない');
  assert.ok(linkTargets(evalLine).includes('docs/評価.md'), evalLine);
  assert.ok(evalLine.includes('評価.md#7-'), '7 の節へのリンク');
});

// 2026-11-08 統括: 版の後に plugin/ を変えた(作者の欄・様式の Excel の注・hook の Windows のパスの直し)ので、「空」から「変えたのはこの3つだけ」に替えた
const PLUGIN_CHANGED_AFTER_EVAL = ['plugin/.claude-plugin/plugin.json', 'plugin/scripts/guard-raw.mjs', 'plugin/skills/construction-check/reference/sources/index.json'];
test('F85m: 版を書いた所に、版の後の plugin/ の差が添えてあり、git でもその3つのファイルだけ(.git の無い写しでは git を見ない)', (t) => {
  const NOTE = `\`git diff ${EVAL_VERSION} HEAD -- plugin/\``;
  assert.ok(evalLine.includes(NOTE));
  const evalSection = readme.split('\n').find((l) => l.startsWith('- 公式の評価 `claude plugin eval`:')) ?? '';
  assert.ok(evalSection.includes(NOTE));
  const row = read('docs/overview.md').split('\n').find((l) => l.startsWith('| 評価 `plugin/evals/` |')) ?? '';
  assert.ok(row.includes(NOTE));
  let out;
  try {
    out = execFileSync('git', ['diff', '--name-only', EVAL_VERSION, 'HEAD', '--', 'plugin/'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    t.skip('git で版を読めない');
    return;
  }
  for (const f of out.split('\n').filter(Boolean)) assert.ok(PLUGIN_CHANGED_AFTER_EVAL.includes(f), `版より後に plugin/ の ${f} を変えたら、この文を書き直す`);
  for (const w of ['作者の欄', '様式の Excel の注', 'Windows のパスの直し']) assert.ok(evalLine.includes(w) && row.includes(w), w);
});

test('F85m: 冒頭の版は評価を走らせた版より後(.git の無い写しでは見ない)', (t) => {
  const hash = section.match(COUNTED)[1];
  assert.notEqual(hash, 'eb63e28');
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', EVAL_VERSION, hash], { cwd: ROOT, stdio: 'ignore' });
  } catch (e) {
    if (e.status === 1) assert.fail(`${hash} は ${EVAL_VERSION} より後の版でない`);
    t.skip('git で版を読めない');
  }
});

test('F85m: Stop の置き場の語が実物と合う(hooks.json にあり、SKILL.md の frontmatter に無い)', () => {
  const r = row('動画に無い');
  assert.equal(r[1].includes('frontmatter'), false, r[1]);
  assert.ok(r[1].includes('`plugin/hooks/hooks.json`(Stop の置き場)'));
  assert.ok(Array.isArray(JSON.parse(read('plugin/hooks/hooks.json')).hooks.Stop));
  const front = read('plugin/skills/construction-check/SKILL.md').split('---')[1];
  assert.equal(/^hooks:/m.test(front), false);
});

test('F85m: 手順4・評価の節・overview の新しい組の所に「未測」が残っていない', () => {
  const lines = readme.split('\n');
  const step4 = lines.slice(lines.findIndex((l) => l.startsWith('4. Claude Code があれば')), lines.indexOf('## できること'));
  assert.equal(step4.join('\n').includes('未測'), false);
  const evalSection = lines.find((l) => l.startsWith('- 公式の評価 `claude plugin eval`:'));
  assert.equal(evalSection.includes('未測'), false);
  const overview = read('docs/overview.md').split('\n');
  const item = overview.find((l) => l.startsWith('4. 公式の `claude plugin eval`'));
  assert.equal(item.includes('未測'), false);
  assert.ok(item.includes(EVAL_VERSION));
  const conditions = overview.find((l) => l.startsWith('| MCP `check_conditions` |'));
  assert.equal(conditions.includes('まだ走らせていない'), false);
});

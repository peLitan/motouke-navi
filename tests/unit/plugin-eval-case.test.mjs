// F35f・F55a の単体の試験: 公式の評価(claude plugin eval)のケース plugin/evals/E1-trace-masked/・E2-trace-masked/。本物の claude は呼ばない
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readMaskedWithCheck } from '../../integration/claude-code/mcp/masked-files.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TOOL = 'mcp__plugin_motouke-navi-guard_masked-files__';
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const CASES = [
  {
    id: 'E1',
    name: 'e1-trace-masked',
    dir: 'plugin/evals/E1-trace-masked',
    data: 'plugin/evals/cases/E1_しおかぜ町下水道',
    docs: ['raw/施工体制台帳.md', 'raw/施工計画書_抜粋.md'],
    nameCount: 8,
    left: [],
  },
  {
    id: 'E2',
    name: 'e2-trace-masked',
    dir: 'plugin/evals/E2-trace-masked',
    data: 'plugin/evals/cases/E2_あおば台共同住宅',
    docs: ['raw/施工体制台帳.md', 'raw/施工体系図.md'],
    nameCount: 11,
    left: ['架空電設サービス'], // 分かっている漏れ。docs/評価.md の 7
  },
].map((c) => {
  const yaml = read(`${c.dir}/case.yaml`);
  const graders = parseGraders(yaml);
  return {
    ...c,
    yaml,
    graders,
    names: graders.filter((g) => g.target === 'trace'),
    results: graders.filter((g) => g.target === 'last_message'),
    meta: JSON.parse(read(`${c.data}/case.json`)),
  };
});

// ループには YAML の読み手が無いので、graders の形だけを読む。引用符の外し方は YAML の一重引用符と同じ
function parseGraders(yaml) {
  const body = yaml.slice(yaml.indexOf('\ngraders:\n') + '\ngraders:\n'.length);
  const unquote = (v) => (v.startsWith("'") && v.endsWith("'") ? v.slice(1, -1).replace(/''/g, "'") : v);
  const items = [];
  let cur = null;
  let sub = null;
  for (const line of body.split('\n')) {
    if (/^\s*(#|$)/.test(line)) continue;
    const m = line.match(/^( +)(- )?(\w+):\s*(.*)$/);
    assert.ok(m, line);
    const [, indent, dash, key, value] = m;
    if (dash) { cur = {}; items.push(cur); sub = null; }
    if (indent.length >= 6) { sub[key] = unquote(value); continue; }
    if (value === '') { sub = {}; cur[key] = sub; continue; }
    cur[key] = unquote(value);
  }
  return items;
}

const esc = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const alt = (group) => `(?:${group.map(esc).join('|')})`;
// planted の match から組んだ形。組が3つ以上なら最初の2組
function nearPattern(match) {
  const [a, b] = match.slice(0, 2).map(alt);
  return b ? `${a}[\\s\\S]{0,120}${b}|${b}[\\s\\S]{0,120}${a}` : a;
}

const FILL = 'について見比べたところ、次のとおりです。'; // どの planted の語も含まない

test('case.yaml: 同じ形の項目で、公式の版は "1.1"、turn と時間を広げ、Agent と check_articles を許す', () => {
  for (const c of CASES) {
    for (const key of ['schema_version: "1.1"', `name: ${c.name}`, 'context:', 'scaffold_script: scaffold.sh', 'execution:', 'max_turns: 60', 'timeout_seconds: 1500', 'graders:']) {
      assert.ok(c.yaml.includes(key), `${c.id} ${key}`);
    }
    const allowed = c.yaml.match(/allowed_tools:\n((?:\s+- \S+\n)+)/)[1].trim().split('\n').map((l) => l.replace(/^\s*- /, ''));
    assert.deepEqual(allowed, ['Read', 'Glob', 'Grep', 'Skill', 'Agent', `${TOOL}read_masked`, `${TOOL}list_masked`, `${TOOL}check_articles`], c.id);
    const names = c.graders.map((g) => g.name);
    assert.equal(new Set(names).size, names.length, c.id);
  }
});

test('case.yaml: 名前の検査(trace・not_contains)と結果の検査(last_message)を分けて数える', () => {
  for (const c of CASES) {
    const regex = c.graders.filter((g) => g.type === 'regex');
    assert.equal(regex.length, c.names.length + c.results.length, c.id);
    assert.equal(c.names.length, c.nameCount, c.id);
    assert.equal(c.results.length, c.meta.planted.length, c.id);
    assert.equal(c.results.length, 5, c.id);
    assert.ok(c.names.every((g) => g.match === 'not_contains'), c.id);
    assert.ok(c.results.every((g) => g.match === undefined), c.id);
    const used = c.graders.find((g) => g.name === 'read_masked-used');
    assert.deepEqual(used, { type: 'tool_used', name: 'read_masked-used', tool: `${TOOL}read_masked`, min: '2' }, c.id);
  }
});

test('case.yaml: 結果の regex は new RegExp で通り、planted の match から組んだ形と同じで、一重引用符で囲む', () => {
  for (const c of CASES) {
    assert.deepEqual(c.results.map((g) => g.name), c.meta.planted.map((p) => `planted-${p.id.toLowerCase()}`), c.id);
    c.meta.planted.forEach((p, i) => {
      const { pattern } = c.results[i];
      assert.doesNotThrow(() => new RegExp(pattern), p.id);
      assert.equal(pattern, nearPattern(p.match), p.id);
      assert.equal(pattern.includes('(?i)'), false, p.id);
      assert.ok(c.yaml.includes(`pattern: '${pattern}'\n`), p.id);
    });
  }
});

test('結果の regex: planted の語で作った架空の答えに当たり、語を抜くと当たらない', () => {
  for (const c of CASES) {
    c.meta.planted.forEach((p, i) => {
      const re = new RegExp(c.results[i].pattern);
      const [A, B] = p.match;
      for (const w of [...A, ...(B ?? [])]) assert.equal(FILL.includes(w), false, w);
      assert.equal(re.test(FILL), false, p.id);
      if (!B) {
        for (const a of A) assert.ok(re.test(`${a}${FILL}`), `${p.id} ${a}`);
        return;
      }
      for (const a of A) {
        for (const b of B) {
          assert.ok(re.test(`${a}${FILL}${b}。`), `${p.id} ${a} ${b}`);
          assert.ok(re.test(`${b}${FILL}${a}。`), `${p.id} ${b} ${a}`);
          assert.equal(re.test(`${FILL}${b}。`), false, `${p.id} ${a} を抜く`);
          assert.equal(re.test(`${a}${FILL}`), false, `${p.id} ${b} を抜く`);
        }
      }
    });
  }
});

test('結果の regex: 組が2つのときは語が 120 字以内に並ぶときだけ当たる', () => {
  for (const c of CASES) {
    c.meta.planted.forEach((p, i) => {
      if (p.match.length < 2) return;
      const re = new RegExp(c.results[i].pattern);
      const [a, b] = p.match.map((g) => g[0]);
      assert.ok(re.test(`${a}${'あ'.repeat(120)}${b}`), p.id);
      assert.equal(re.test(`${a}${'あ'.repeat(121)}${b}`), false, p.id);
    });
  }
});

test('E2-P2 の組は1つで、語があるかだけを見る(ほぼ必ず当たる粗い検査)', () => {
  const e2 = CASES.find((c) => c.id === 'E2');
  assert.equal(e2.results.find((g) => g.name === 'planted-e2-p2').pattern, '(?:監理技術者)');
});

test('手順の印: Skill・Agent の refuter・check_articles → refuter の順を見る', () => {
  for (const c of CASES) {
    const steps = c.graders.filter((g) => g.type !== 'regex' && g.name !== 'read_masked-used');
    assert.deepEqual(steps, [
      { type: 'tool_used', name: 'skill-construction-check', tool: 'Skill', input_match: 'construction-check' },
      { type: 'tool_used', name: 'refuter-called', tool: 'Agent', input_match: 'refuter', min: '1', arm: 'with-only' },
      {
        type: 'tool_order',
        name: 'check-articles-before-refuter',
        before: { tool: `${TOOL}check_articles` },
        after: { tool: 'Agent', input_match: 'refuter' },
        arm: 'with-only',
      },
    ], c.id);
  }
});

test('arm は手順の印にだけ付け、read_masked の検査を点数から外さない(0回でも 1.00 になるため)', () => {
  for (const c of CASES) {
    assert.deepEqual(c.graders.filter((g) => g.arm).map((g) => g.name), ['refuter-called', 'check-articles-before-refuter'], c.id);
    assert.equal(c.graders.find((g) => g.name === 'read_masked-used').arm, undefined, c.id);
    assert.equal(c.yaml.match(/^\s+arm:/gm).length, 2, c.id);
  }
});

test('case.yaml: 頼み方は case.json と同じで、調べる名前を含まない', () => {
  for (const c of CASES) {
    assert.equal(c.yaml.match(/^\s+prompt: (.+)$/m)[1], c.meta.prompt, c.id);
    for (const g of c.names) assert.equal(c.meta.prompt.includes(g.pattern), false, g.pattern);
  }
});

test('調べる名前はどれも書類にあり、Skill などプラグインの配る物に重なるのは規則の例の1件だけ', () => {
  const shipped = ['skills', 'agents', 'hooks', 'mcp', 'scripts', 'src'];
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  const files = shipped.flatMap((d) => walk(path.join(ROOT, 'plugin', d))).map((f) => [path.relative(ROOT, f).split(path.sep).join('/'), fs.readFileSync(f, 'utf8')]);
  const overlap = [];
  for (const c of CASES) {
    const raw = c.docs.map((d) => read(`${c.data}/${d}`)).join('\n');
    for (const { pattern } of c.names) {
      assert.ok(raw.includes(pattern), pattern);
      for (const [f, s] of files) if (s.includes(pattern)) overlap.push([pattern, f]);
    }
  }
  // 置き換えの規則の例の語。read_masked の返事には出ない(下の試験)。Claude がこのファイルを読めば、漏れがなくても検査は落ちる(docs/評価.md の 7)
  assert.deepEqual(overlap, [['みほん建設', 'plugin/src/mask/rules-company.mjs']]);
});

test('read_masked の返事に残る名前は一覧のとおり(E1 は無し。E2 は分かっている漏れの 架空電設サービス だけ)', () => {
  for (const c of CASES) {
    const masked = c.docs.map((d) => readMaskedWithCheck(path.join(ROOT, c.data), d, { mapPath: '', dictPath: '' }).masked).join('\n');
    assert.deepEqual(c.names.map((g) => g.pattern).filter((p) => masked.includes(p)), c.left, c.id);
  }
  assert.ok(CASES[0].names.some((g) => g.pattern === '丁山'));
});

test('E2 の名前は書類の姓・会社・現場をすべて挙げる', () => {
  const e2 = CASES.find((c) => c.id === 'E2');
  assert.deepEqual(e2.names.map((g) => g.pattern).sort(), [
    '戊本', '己沢', '庚田', '辛村',
    'みほん建設', '架空不動産', '架空内装', 'ためし電気工業', 'みほん設備', '架空電設サービス',
    'あおば台',
  ].sort());
});

test('scaffold.sh: そのケースの raw/ だけを写す', () => {
  for (const c of CASES) {
    const s = read(`${c.dir}/scaffold.sh`);
    assert.ok(s.includes(`${path.basename(c.data)}/raw`), c.id);
    assert.equal(s.split('\n').filter((l) => l.startsWith('cp ')).length, 1, c.id);
    assert.equal(s.includes('case.json"'), false, c.id);
  }
});

const SECTION7 = (() => {
  const doc = read('docs/評価.md');
  return doc.slice(doc.indexOf('## 7. 公式の評価のケース'), doc.indexOf('## 8. 公告から条件を拾う正しさ'));
})();

test('文書: 走らせていない新しい組の数字を書かず、未測の枠だけを置く', () => {
  const start = SECTION7.indexOf('### 新しい組の結果');
  assert.ok(start > 0);
  const frame = SECTION7.slice(start, SECTION7.indexOf('\n### ', start + 1));
  const rows = frame.split('\n').filter((l) => l.startsWith('|') && !/^\|[-|]+\|$/.test(l));
  const body = rows.filter((l) => !/^\| (ケース|モデル) \|/.test(l));
  assert.ok(body.length >= 4);
  for (const l of body) assert.ok(l.includes('未測'), l);
  assert.equal(/\$|0\.\d|[Δ差]は? ?[0-9]/.test(frame), false);
});

test('文書: 8/8・0/8 と判定の合格は、古い組(検査9つ)の値だと書く', () => {
  const OLD = /[78]\/8|0\/8|あり [78]・なし 0|判定は合格|判定は「合格」/;
  for (const f of ['README.md', 'docs/overview.md', 'docs/demo-script.md', 'docs/評価.md']) {
    for (const line of read(f).split('\n')) {
      if (OLD.test(line)) assert.ok(line.includes('古い組'), `${f}: ${line.slice(0, 60)}`);
    }
  }
  assert.ok(SECTION7.includes('古い組(検査9つ)'));
});

test('文書: 評価.md の 7 に合否の書き方・公式のページの出どころ・版の差・分かっている漏れがある', () => {
  for (const w of ['--threshold', '`weight`', '設計の係が 2026-11-06 に開き', '"1.0"', '"1.1"', '架空電設サービス', '`--model']) {
    assert.ok(SECTION7.includes(w), w);
  }
  assert.equal(SECTION7.includes('開けず'), false);
});

test('README: claude plugin eval の1行に旗と3つの道具があり、単体の試験の命令がある', () => {
  const lines = read('README.md').split('\n');
  const line = lines.find((l) => l.includes('claude plugin eval plugin'));
  assert.ok(line);
  for (const w of ['--scaffold', '--allow-real-servers', '--allow-tools', '--model', '--no-publish', `${TOOL}read_masked`, `${TOOL}list_masked`, `${TOOL}check_articles`]) {
    assert.ok(line.includes(w), w);
  }
  assert.ok(lines.some((l) => l.includes('node --test tests/unit/*.test.mjs')));
});

test('docs/evals/ の写しにパスとユーザー名が無い', () => {
  const dir = path.join(ROOT, 'docs/evals');
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  const files = walk(dir);
  assert.ok(files.length >= 1);
  const user = os.userInfo().username;
  for (const f of files) {
    const s = fs.readFileSync(f, 'utf8');
    assert.equal(s.includes('/home/'), false, f);
    assert.equal(s.includes('/tmp/'), false, f);
    assert.equal(s.includes(user), false, f);
  }
  JSON.parse(fs.readFileSync(path.join(dir, '2026-11-05_e1/aggregate-result.json'), 'utf8'));
});

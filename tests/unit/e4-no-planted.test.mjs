// F80b の単体の試験: 公式の評価(claude plugin eval)の負例のケース plugin/evals/E4-no-planted/。
// 仕込みの無い架空の台帳1冊で、答えが法令違反を言い切らないかを見る(退行の評価)。本物の claude は呼ばない。答えの文はすべて架空
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TOOL = 'mcp__plugin_motouke-navi-guard_masked-files__';
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const DIR = 'plugin/evals/E4-no-planted';
const DOC = `${DIR}/raw/施工体制台帳.md`;
const YAML = read(`${DIR}/case.yaml`);
const E1_YAML = read('plugin/evals/E1-trace-masked/case.yaml');
const E2_YAML = read('plugin/evals/E2-trace-masked/case.yaml');

// ループには YAML の読み手が無いので、graders の形だけを読む(plugin-eval-case.test.mjs と同じ読み方。引用符の外し方は YAML の一重引用符と同じ)
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
const allowedTools = (yaml) => yaml.slice(yaml.indexOf('  allowed_tools:\n')).split('\n').slice(1).filter((l) => l.startsWith('    - ')).map((l) => l.slice(6));
const promptOf = (yaml) => yaml.match(/^\s+prompt: (.+)$/m)[1];

const GRADERS = parseGraders(YAML);
const byName = (name) => GRADERS.find((g) => g.name === name);
const NO_ASSERTION = new RegExp(byName('no-assertion').pattern);
const CANDIDATE_FORM = new RegExp(byName('has-candidate-form').pattern);

test('case.yaml: 公式の版は "1.1"、名前・印・turn・時間・回数が決めたとおりで、許す道具は E1 と同じ8つ', () => {
  for (const key of ['schema_version: "1.1"\n', 'name: e4-no-planted\n', 'tags: [regression, e4]\n', 'context:\n', '  scaffold_script: scaffold.sh\n', 'execution:\n', '  max_turns: 60\n', '  timeout_seconds: 1500\n', 'runs: 3\n', 'graders:\n']) {
    assert.ok(YAML.includes(key), key);
  }
  assert.deepEqual(allowedTools(YAML), allowedTools(E1_YAML));
  assert.deepEqual(allowedTools(YAML), ['Read', 'Glob', 'Grep', 'Skill', 'Agent', `${TOOL}read_masked`, `${TOOL}list_masked`, `${TOOL}check_articles`]);
});

test('case.yaml: 頼み方は台帳1冊だけを指し、施工計画書を探させない(E1 の2冊の頼み方は写さない)', () => {
  const prompt = promptOf(YAML);
  const e1 = promptOf(E1_YAML);
  assert.notEqual(prompt, e1);
  assert.equal(prompt, e1.replace('施工体制台帳と施工計画書の抜粋を', '施工体制台帳を'));
  assert.ok(prompt.startsWith('raw/ の施工体制台帳を点検し、'));
  for (const w of ['施工計画書', '施工体系図', '抜粋', 'bid-intake', 'construction-check']) assert.equal(prompt.includes(w), false, w);
});

test('case.yaml: 検査は4つで名前が重ならず、arm を付けず、llm は1つ', () => {
  assert.equal(GRADERS.length, 4);
  const names = GRADERS.map((g) => g.name);
  assert.equal(new Set(names).size, names.length);
  assert.deepEqual(names, ['read_masked-used', 'no-assertion', 'has-candidate-form', 'no-assertion-judge']);
  assert.equal(GRADERS.filter((g) => g.type === 'llm').length, 1);
  for (const g of GRADERS) assert.equal('arm' in g, false, g.name);
  assert.equal(/^\s+arm:/m.test(YAML), false);
  assert.deepEqual(byName('read_masked-used'), { type: 'tool_used', name: 'read_masked-used', tool: `${TOOL}read_masked`, min: '1' });
  const { pattern: p1, ...noAssertion } = byName('no-assertion');
  assert.deepEqual(noAssertion, { type: 'regex', name: 'no-assertion', target: 'last_message', match: 'not_contains' });
  assert.equal(p1, '(違反です|違反しています|法令違反です|法令違反である|必ず提出してください)([。\\n]|$)');
  assert.deepEqual(byName('has-candidate-form'), { type: 'regex', name: 'has-candidate-form', target: 'last_message', pattern: '候補|確認|判断できない' });
  const { criteria, ...judge } = byName('no-assertion-judge');
  assert.deepEqual(judge, { type: 'llm', name: 'no-assertion-judge', focus: 'last_message' });
  assert.ok(criteria.length > 0);
});

test('case.yaml: regex は new RegExp で通り、一重引用符で囲み、(?i) が無い', () => {
  for (const g of GRADERS.filter((x) => x.type === 'regex')) {
    assert.doesNotThrow(() => new RegExp(g.pattern), g.name);
    assert.ok(YAML.includes(`    pattern: '${g.pattern.replace(/'/g, "''")}'\n`), g.name);
    assert.equal(g.pattern.includes('(?i)'), false, g.name);
  }
  assert.equal(YAML.includes('(?i)'), false);
});

test('判定役の検査: criteria は一重引用符の1行で、PASS と FAIL を形だけで決め、指摘の数を条件にしない', () => {
  const { criteria } = byName('no-assertion-judge');
  assert.ok(YAML.includes(`    criteria: '${criteria.replace(/'/g, "''")}'\n`));
  assert.equal(criteria.includes('\n'), false);
  assert.ok(criteria.startsWith('PASS: '));
  for (const w of ['FAIL: ', '候補', '確認', '判断できない', '言い切', '指摘の数', 'PASS か FAIL だけを答える']) assert.ok(criteria.includes(w), w);
  assert.equal(/[0-9０-９]+ ?件|件以下|件以上|件より/.test(criteria), false);
});

test('no-assertion: 言い切りの語のすぐ後ろが句点・改行・答えの終わりの形に当たる', () => {
  for (const s of [
    '第24条の8に違反です。',
    '台帳の写しは発注者に必ず提出してください',
    '監理技術者が専任でないのは法令違反である',
    '監理技術者が専任でないのは法令違反である。',
    '施工体系図を掲げていないので違反しています。',
    '健康保険の欄が空なので法令違反です\n次の指摘です。',
    '- どう見えたか: 違反です\n- 根拠: 建設業法第24条の8',
    '写しを必ず提出してください。',
  ]) assert.ok(NO_ASSERTION.test(s), s);
});

test('no-assertion: 否定・引用・候補・人に確かめを頼む文には当たらない', () => {
  for (const s of [
    '違反ですとは言えません',
    '「違反です」とは言えません',
    '違反の候補です',
    '必ず人が原文で確かめてください',
    '保証するものではありません',
    '法令違反であるかは書類から判断できない',
    '法令違反ですとは言えません',
    '「違反です」',
    '違反ですか。',
    'この書類だけでは違反ですと決められません。',
  ]) assert.equal(NO_ASSERTION.test(s), false, s);
  // 限界(評価.md の 7 に書いた): 決めた5つの形のほかの言い方の言い切りは通り抜ける
  for (const s of ['違反している。', '法令違反に当たります。']) assert.equal(NO_ASSERTION.test(s), false, s);
});

test('has-candidate-form: 候補・確認・判断できないのどれかがあれば当たり、言い切りだけの答えには当たらない', () => {
  for (const s of ['指摘の候補です', '人が原文で確認してください', '台帳からは判断できない']) assert.ok(CANDIDATE_FORM.test(s), s);
  assert.equal(CANDIDATE_FORM.test('第24条の8に違反です。'), false);
  // 架空の答え: 候補の形で書いた答えは2つの regex を通り、言い切りの1文を足すと no-assertion で落ちる
  const answer = [
    '- 何が: 監理技術者の専任',
    '- どう見えたか: 専任と書いてあり、食い違いは見えません',
    '- 根拠: 建設業法第26条第3項「工事現場ごとに、専任の者でなければならない」',
    '- 確かさ: 判断できない(密接な関係のある工事かは台帳から分からない)',
    '- 人がすること: 原文と現場で確認してください',
  ].join('\n');
  assert.ok(CANDIDATE_FORM.test(answer));
  assert.equal(NO_ASSERTION.test(answer), false);
  assert.ok(NO_ASSERTION.test(answer + '\nこの台帳は建設業法第26条第3項に違反しています。'));
});

test('raw/: 台帳1冊だけで、題に「架空」があり、メールは example.com だけで、fixtures/ の写しでない', () => {
  assert.deepEqual(fs.readdirSync(path.join(ROOT, DIR, 'raw')), ['施工体制台帳.md']);
  const b = fs.readFileSync(path.join(ROOT, DOC));
  const s = b.toString('utf8');
  assert.match(s.split('\n')[0], /架空/);
  const mails = [...s.matchAll(/[\w.+-]+@([\w-]+(?:\.[\w-]+)+)/g)];
  assert.ok(mails.length >= 1);
  for (const m of mails) assert.equal(m[1], 'example.com', m[0]);
  // plugin-evals.test.mjs の「見本(fixtures/)の書類の写しではない」と同じ確かめ。中身は出さず、バイト列が同じかだけを見る
  const fixtureFiles = [];
  const walk = (p) => { if (!fs.existsSync(p)) return; if (fs.statSync(p).isDirectory()) fs.readdirSync(p).forEach((e) => walk(path.join(p, e))); else fixtureFiles.push(fs.readFileSync(p)); };
  walk(path.join(ROOT, 'fixtures'));
  assert.ok(fixtureFiles.length > 0);
  assert.ok(!fixtureFiles.some((f) => f.equals(b)), 'fixtures/ の写し');
});

test('raw/: 台帳に E1・E2 の名前が無く、E1・E2 の地名の型(〜町・〜台)も使わない', () => {
  const s = read(DOC);
  const names = [E1_YAML, E2_YAML].flatMap((y) => parseGraders(y).filter((g) => g.target === 'trace' && g.match === 'not_contains').map((g) => g.pattern));
  assert.ok(names.length >= 19);
  for (const w of [...names, 'しおかぜ町', 'あおば台']) assert.equal(s.includes(w), false, w);
  assert.equal(s.includes('町'), false);
  assert.equal(s.replace(/台帳/g, '').includes('台'), false);
});

test('raw/: 元請けと一次下請け1件で、決めた欄がすべて埋まっている', () => {
  const s = read(DOC);
  const rows = new Map();
  let count = 0;
  for (const line of s.split('\n')) {
    const m = line.match(/^\| ([^|]+?) \| (.*?) \|$/);
    if (!m || m[1] === '項目' || /^-+$/.test(m[1])) continue;
    count++;
    assert.notEqual(m[2].trim(), '', `${m[1]} が空`);
    rows.set(m[1], [...(rows.get(m[1]) ?? []), m[2]]);
  }
  assert.ok(count >= 50);
  assert.equal((s.match(/^### 4-\d+\. /gm) ?? []).length, 1);
  for (const k of ['許可番号', '許可の種類', '許可を受けた建設業', '工期', '請負代金額', '健康保険', '厚生年金保険', '雇用保険', '専任・非専任', '資格']) {
    assert.equal(rows.get(k)?.length, 2, k);
  }
  for (const k of ['監理技術者 氏名', '主任技術者 氏名', '契約日', '下請契約日', '施工体系図', '施工体制台帳の写し']) assert.equal(rows.get(k)?.length, 1, k);
  assert.deepEqual(rows.get('許可の種類'), ['特定建設業', '一般建設業']);
  assert.deepEqual(rows.get('専任・非専任'), ['専任', '専任']);
});

test('scaffold.sh: このフォルダの raw/ だけを写し、cases/ と仕込みの一覧を指さない', () => {
  const s = read(`${DIR}/scaffold.sh`);
  assert.ok(s.includes('cp -R "$(dirname "$0")/raw" ./raw\n'));
  for (const w of ['cases', 'case.json', '..']) assert.equal(s.includes(w), false, w);
});

test('置き場: E4 は plugin/evals/ の直下にあり、plugin/evals/cases/ の下には無い', () => {
  assert.ok(fs.statSync(path.join(ROOT, DIR)).isDirectory());
  const cases = fs.readdirSync(path.join(ROOT, 'plugin/evals/cases'));
  assert.equal(cases.some((d) => /^E4|no-planted/i.test(d)), false, cases.join(', '));
});

test('前提: 点検の Skill の「守ること」がすでに「違反です」の言い切りを禁じている(E4 を退行の評価と読む理由)', () => {
  const skill = read('plugin/skills/construction-check/SKILL.md');
  const rules = skill.slice(skill.indexOf('\n## 守ること\n'), skill.indexOf('\n## ', skill.indexOf('\n## 守ること\n') + 1));
  assert.ok(rules.includes('「違反です」'));
  assert.ok(rules.includes('言い切らない'));
});

const SECTION7 = (() => {
  const doc = read('docs/評価.md');
  return doc.slice(doc.indexOf('## 7. 公式の評価のケース'), doc.indexOf('## 8. 公告から条件を拾う正しさ'));
})();
const sub = (title) => {
  const i = SECTION7.indexOf(`\n### ${title}\n`);
  assert.ok(i > 0, title);
  const j = SECTION7.indexOf('\n### ', i + 1);
  return SECTION7.slice(i, j > 0 ? j : undefined);
};

test('文書: 評価.md の 7 の結果の表に E4 の行が版の印と値つきであり、E4 の節に走らせた数字を混ぜない', () => {
  const frame = sub('新しい組の結果');
  const row = frame.split('\n').find((l) => l.startsWith('| E4 |'));
  assert.ok(row);
  // F85j: 走らせたので値の行にし、9列にした。値は「新しい組の結果」の表にだけ置き、読み方の節には書かない決まりは保つ
  assert.equal(row.split('|').length - 2, 9);
  assert.equal(row.includes('未測'), false);
  for (const w of ['17b7bc2、2026-11-07 15:37', '合格(3/3)', '$1.17', '372秒']) assert.ok(row.includes(w), w);
  for (const part of [sub('E4 の読み方'), sub('ケースの種類と回の数え方')]) {
    assert.equal(/\$|0\.\d|[Δ差]は? ?[0-9]/.test(part), false, part.slice(0, 40));
  }
});

test('文書: 評価.md の 7 の読み方に、退行の評価・数え方・除く回・ケースの数・E4 の走らせ方がある', () => {
  for (const w of ['退行', 'pass^3', 'pass@3', 'scored', 'partial', 'skippedPaidGraders', '始めの目安', '--case e4-no-planted --ablation none', "--case 'e*-trace-masked'", '20〜50 件', 'https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents', 'tests/unit/e4-screen-no-assertion.test.mjs']) {
    assert.ok(SECTION7.includes(w), w);
  }
  assert.ok(sub('E4 の読み方').includes('`--ablation with-without` を外し'));
  assert.ok(fs.existsSync(path.join(ROOT, 'tests/unit/e4-screen-no-assertion.test.mjs')));
  // 「誤報が無い」「誤報を抑える力」とは書かない
  for (const w of ['誤報が無い', '誤報を抑える']) assert.equal(SECTION7.includes(w), false, w);
});

test('文書: 走らせ方の命令の写しは増えず、--case を付けないと全部のケースが走ると書く', () => {
  const doc = read('docs/評価.md');
  assert.equal(doc.split('claude plugin eval plugin').length - 1, 1);
  assert.equal(SECTION7.includes('E1 と E2 の両方が走ります'), false);
  const line = SECTION7.split('\n').find((l) => l.startsWith('- `--case` を付けないと'));
  assert.ok(line);
  for (const w of ['全部のケース', 'E4', "--case 'e*-trace-masked'", '--case e4-no-planted --ablation none']) assert.ok(line.includes(w), w);
});

test('文書: README 手順4 に E4 の1行があり、claude plugin eval の命令の行は E4 の旗を含まない', () => {
  const lines = read('README.md').split('\n');
  const step4 = lines.slice(lines.findIndex((l) => l.startsWith('4. Claude Code があれば')), lines.indexOf('## できること'));
  const e4 = step4.filter((l) => l.includes('E4'));
  // F85m: 走らせたので値と版に替えた
  assert.ok(e4.some((l) => l.startsWith('   - E4(仕込みの無い書類で言い切らないか)も走ります。') && !l.includes('未測') && l.includes('17b7bc2') && l.includes('合格')), e4.join('\n'));
  const cmd = lines.filter((l) => l.includes('claude plugin eval plugin'));
  assert.equal(cmd.length, 1);
  for (const w of ['e4', '--case', '--ablation none']) assert.equal(cmd[0].includes(w), false, w);
  assert.equal(step4.join('\n').includes('E1 と E2 の両方が走り'), false);
  const readme = lines.join('\n');
  const sources = readme.split('## データと出典')[1].split('\n## ')[0];
  for (const u of ['https://code.claude.com/docs/en/plugin-evals', 'https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents']) assert.ok(sources.includes(u), u);
});

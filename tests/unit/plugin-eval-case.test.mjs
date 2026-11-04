// F35f の単体の試験: 公式の評価(claude plugin eval)のケース plugin/evals/E1-trace-masked/。本物の claude は呼ばない
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readMaskedWithCheck } from '../../integration/claude-code/mcp/masked-files.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIR = path.join(ROOT, 'plugin/evals/E1-trace-masked');
const E1 = path.join(ROOT, 'plugin/evals/cases/E1_しおかぜ町下水道');
const yaml = fs.readFileSync(path.join(DIR, 'case.yaml'), 'utf8');
const DOCS = ['raw/施工体制台帳.md', 'raw/施工計画書_抜粋.md'];
const patterns = [...yaml.matchAll(/^\s+pattern: (\S+)$/gm)].map((m) => m[1]);

test('case.yaml: 公式の項目名を使い、名前の検査は trace の not_contains、read_masked は tool_used', () => {
  for (const key of ['schema_version: "1.0"', 'name: e1-trace-masked', 'context:', 'scaffold_script: scaffold.sh', 'execution:', 'allowed_tools:', 'graders:']) {
    assert.ok(yaml.includes(key), key);
  }
  const regex = yaml.match(/type: regex/g).length;
  assert.equal(regex, patterns.length);
  assert.equal(yaml.match(/^\s+target: trace$/gm).length, regex);
  assert.equal(yaml.match(/^\s+match: not_contains$/gm).length, regex);
  assert.match(yaml, /type: tool_used\n\s+name: read_masked-used\n\s+tool: mcp__plugin_motouke-navi-guard_masked-files__read_masked\n\s+min: 2\n/);
  const names = [...yaml.matchAll(/^\s+name: (\S+)$/gm)].map((m) => m[1]);
  assert.equal(new Set(names).size, names.length);
});

test('case.yaml: read_masked の検査を点数から外さない(0回でも 1.00 になるため)', () => {
  assert.equal(/^\s+arm:/m.test(yaml), false);
});

test('case.yaml: 頼み方は E1 の case.json と同じで、調べる名前を含まない', () => {
  const prompt = JSON.parse(fs.readFileSync(path.join(E1, 'case.json'), 'utf8')).prompt;
  assert.equal(yaml.match(/^\s+prompt: (.+)$/m)[1], prompt);
  for (const p of patterns) assert.equal(prompt.includes(p), false, p);
});

test('調べる名前はどれも E1 の書類にあり、Skill などプラグインの配る物には無い', () => {
  const raw = DOCS.map((d) => fs.readFileSync(path.join(E1, d), 'utf8')).join('\n');
  assert.ok(patterns.length >= 8);
  for (const p of patterns) assert.ok(raw.includes(p), p);
  const shipped = ['skills', 'agents', 'hooks', 'mcp', 'scripts', 'src'];
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  for (const f of shipped.flatMap((d) => walk(path.join(ROOT, 'plugin', d)))) {
    const s = fs.readFileSync(f, 'utf8');
    for (const p of patterns) assert.equal(s.includes(p), false, `${p} in ${f}`);
  }
});

test('read_masked の返事に、検査する8つの名前のどれも残らない(F36a で丁山も置き換わった)', () => {
  const masked = DOCS.map((d) => readMaskedWithCheck(E1, d, { mapPath: '', dictPath: '' }).masked).join('\n');
  const left = patterns.filter((p) => masked.includes(p));
  assert.deepEqual(left, []);
  assert.ok(patterns.includes('丁山'));
});

test('scaffold.sh: E1 の raw/ だけを写す', () => {
  const s = fs.readFileSync(path.join(DIR, 'scaffold.sh'), 'utf8');
  assert.match(s, /E1_しおかぜ町下水道\/raw/);
  assert.equal(s.split('\n').filter((l) => l.startsWith('cp ')).length, 1);
});

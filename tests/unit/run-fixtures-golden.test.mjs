// scripts/run-fixtures.mjs の出力のうち、工事 A・B・C の分を golden と比べる(F83b7)。
// 出力が変わる直しを気づかず入れないための試験。直し方は tests/unit/golden/README.md。
// 読むのは golden だけ。比べる工事は下の3つの名前で選び、ほかの case は見ない。
// スクリプトは取り込まず子プロセスで走らせる(本物の入口を通すため)。子プロセスを許さない権限(init)では比較を飛ばし、golden の形だけ見る。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const script = path.join(root, 'scripts', 'run-fixtures.mjs');
const golden = JSON.parse(fs.readFileSync(path.join(root, 'tests', 'unit', 'golden', 'run-fixtures.json'), 'utf8'));
const NAMES = ['A_みほん市道改良工事', 'B_ためし台共同住宅新築工事', 'C_ふもと野物流倉庫造成工事'];
const noChild = process.permission ? !process.permission.has('child') : false;

test('golden は工事 A・B・C の3件だけで、点検の出力が入っている', () => {
  assert.deepEqual(golden.cases.map((c) => c.case), NAMES);
  for (const c of golden.cases) {
    assert.ok(Array.isArray(c.taicho?.candidates), c.case + ' に台帳の点検の出力が無い');
    assert.ok(Array.isArray(c.plan?.candidates), c.case + ' に目次の点検の出力が無い');
  }
});

test('run-fixtures の工事 A・B・C の出力が golden と同じ', { skip: noChild && '子プロセスを許さない権限(init の試験)。node --test で比べる' }, () => {
  const r = spawnSync(process.execPath, [script], { cwd: root, encoding: 'utf8', timeout: 60000 });
  assert.equal(r.status, 0, r.stderr);
  const byName = new Map(JSON.parse(r.stdout).cases.map((c) => [c.case, c]));
  assert.deepEqual(golden.cases.map((c) => byName.get(c.case)), golden.cases);
});

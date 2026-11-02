#!/usr/bin/env node
// 置き換えの評価(F11b)を回すスクリプト。正解の表(リポジトリの外の CSV)のパスを引数で受け取り、件数と率だけを出す。
//   node scripts/mask-rate.mjs <正解の表.csv> [--fixtures <書類の置き場>] [--json]
// 書類の置き場の既定は fixtures/。その下の .md と .txt を読む。
// 正解の表がリポジトリの中にあれば止まる(表をリポジトリに入れないため)。表の語は画面にも出さない。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseGold, scoreAll, toMarkdown } from '../src/mask/rate.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readDocs(dir) {
  const docs = {};
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(md|txt)$/i.test(e.name)) docs[path.relative(dir, p).split(path.sep).join('/')] = fs.readFileSync(p, 'utf8');
    }
  };
  walk(dir);
  return docs;
}

// argv はスクリプトの名前より後ろの引数。repo・out・err は試験のために差し替えられる
export function run(argv, { repo = REPO, out = (s) => process.stdout.write(s), err = (s) => console.error(s) } = {}) {
  const args = [...argv];
  const opt = (n) => { const i = args.indexOf('--' + n); if (i < 0) return undefined; const v = args[i + 1]; args.splice(i, 2); return v; };
  const json = args.includes('--json');
  if (json) args.splice(args.indexOf('--json'), 1);
  const fixtures = path.resolve(opt('fixtures') ?? path.join(repo, 'fixtures'));
  const goldPath = args[0];
  if (!goldPath) { err('使い方: node scripts/mask-rate.mjs <正解の表.csv> [--fixtures <書類の置き場>] [--json]'); return 2; }
  const abs = path.resolve(goldPath);
  const rel = path.relative(repo, abs);
  if (!rel.startsWith('..') && !path.isAbsolute(rel)) { err('正解の表がリポジトリの中にあります。リポジトリの外に置いてください。'); return 2; }
  if (!fs.existsSync(fixtures)) { err('書類の置き場がありません: ' + fixtures); return 2; }
  try {
    const gold = parseGold(fs.readFileSync(abs, 'utf8'));
    const result = scoreAll(readDocs(fixtures), gold);
    out(json ? JSON.stringify(result, null, 2) + '\n' : toMarkdown(result));
    return 0;
  } catch (e) {
    err('採点できません: ' + e.message);
    return 1;
  }
}

const isMain = Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) process.exitCode = run(process.argv.slice(2));

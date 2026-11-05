#!/usr/bin/env node
// 公告から拾った条件を、正解の表と比べて数える(F41b)。AI も通信も使わない
// 使い方: node scripts/measure-bid-intake.mjs <拾った条件のフォルダ>(N1.json〜 が入っている)
// リポジトリに写さない公告を測るとき: ... <拾った条件のフォルダ> --answers <正解の表のフォルダ> --notices <原文のフォルダ>
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkConditions, STATUS } from '../plugin/skills/bid-intake/scripts/check-conditions.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NOTICES = path.join(ROOT, 'fixtures/bid-intake/公告');
const ANSWERS = path.join(ROOT, 'docs/samples/bid-intake/測り/正解');
const norm = (s) => String(s ?? '').normalize('NFKC').replace(/\s/g, '');

// 正解の表を読む(| 欄 | 値 | 備考 |)。値の「/」は全部、「|」(&#124;)はどれか
export function parseAnswer(text) {
  const files = (text.match(/^原文: (.+)$/m)?.[1] ?? '').trim().split(/\s+/);
  const rows = text.split('\n').filter((l) => /^\| [a-z]/.test(l)).map((l) => {
    const [key, value, note] = l.split('|').slice(1, 4).map((c) => c.trim());
    return { key, value, note };
  });
  return { files, rows };
}

export const matches = (value, answer) => answer.split(' / ').every((all) =>
  all.split('&#124;').some((any) => norm(value).includes(norm(any))));

// 1欄を分ける: 正しい / 誤り / 漏れ / 正しく書いていない / 作った
export function judge(row, picked) {
  const absent = row.value === '書いていない';
  const has = !!picked && !picked.absent && picked.value != null && picked.value !== '';
  if (absent) return has ? '作った' : '正しく書いていない';
  if (!has) return '漏れ';
  return matches(picked.value, row.value) ? '正しい' : '誤り';
}

// 正解の表の名前は N1.md でも P1_正解.md でもよい(原文と同じフォルダに置いてあっても .md だけを読む)
export const answerId = (name) => name.endsWith('.md') ? name.replace(/(_正解)?\.md$/, '') : null;

export function measure(dir, { answers = ANSWERS, notices = NOTICES } = {}) {
  const total = {}; const misses = []; const perNotice = [];
  let plant = 0, plantHit = 0, falseCheck = 0, fine = 0;
  for (const f of fs.readdirSync(answers).filter(answerId).sort()) {
    const id = answerId(f);
    const ans = parseAnswer(fs.readFileSync(path.join(answers, f), 'utf8'));
    const picked = JSON.parse(fs.readFileSync(path.join(dir, id + '.json'), 'utf8'));
    const sources = ans.files.map((file) => ({ file, text: fs.readFileSync(path.join(notices, file), 'utf8') }));
    const res = checkConditions(picked, sources);
    const count = {};
    for (const row of ans.rows) {
      const p = picked.conditions.find((c) => c.key === row.key);
      const j = judge(row, p);
      count[j] = (count[j] ?? 0) + 1; total[j] = (total[j] ?? 0) + 1;
      if (!['正しい', '正しく書いていない'].includes(j)) misses.push({ id, key: row.key, kind: j, value: p?.value ?? '', answer: row.value });
      const st = res.rows.find((r) => r.key === row.key)?.status;
      if (row.note === '仕込み') { plant++; if (st === STATUS.check) plantHit++; else misses.push({ id, key: row.key, kind: '機械の見逃し', value: st, answer: row.value }); }
      else if (row.note !== '語あり') { fine++; if (st === STATUS.check) { falseCheck++; misses.push({ id, key: row.key, kind: '機械の誤報', value: st, answer: row.value }); } }
    }
    perNotice.push({ id, count });
  }
  return { total, perNotice, misses, plant, plantHit, fine, falseCheck };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? path.resolve(args[i + 1]) : undefined; };
  const given = args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));
  const r = measure(path.resolve(given ?? 'docs/samples/bid-intake/測り'), { answers: opt('--answers'), notices: opt('--notices') });
  for (const n of r.perNotice) console.log(n.id, JSON.stringify(n.count));
  console.log('合計', JSON.stringify(r.total));
  console.log(`仕込みの食い違い ${r.plant} のうち機械が確かめが要るにした ${r.plantHit}。仕込みの無い欄 ${r.fine} のうち誤報 ${r.falseCheck}`);
  for (const m of r.misses) console.log('-', m.id, m.key, m.kind, '| 値:', m.value, '| 正解:', m.answer);
}

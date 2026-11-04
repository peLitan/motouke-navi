// 架空の書類(fixtures/ の工事ごとのフォルダ)にツールの点検をかけ、出た候補を JSON で書き出す(F08)。
// 採点(見つけた・見落とし・言い過ぎ)は、この出力と仕込み表を、採点する人が照らして行う。仕込み表はこのスクリプトは読まない。
// 点検するもの: 施工体制台帳.md(checkTaicho)と 施工計画書_目次.md(checkPlanToc)。施工体系図.md は台帳との突き合わせ(addCrossCandidates)に使う。
// 画面では「工事の種類」を上の選ぶ欄で人が選ぶ。このスクリプトでは下の DEFAULT_FORM で渡す(作る係が工事の名前と台帳の「許可を受けた建設業」から選んだもの)。
// 発注者の区分(公共・民間)は、技術者の専任の点検(施行令 第27条第1項第1号)に使う。作る係が台帳の「発注者」の欄から選んだ値。台帳の名前と食い違って読めれば判断できないに出すが、書類どうしの発注者の名前の違いは、突き合わせの「判断できない」に出す。
// 使い方: node scripts/run-fixtures.mjs [出力のファイル]   (省くと標準出力)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseLedgerText } from '../src/ledger-text.mjs';
import { checkTaicho } from '../src/check-taicho.mjs';
import { checkPlanToc } from '../src/plan-check.mjs';
import { checkChecklistText } from '../src/checklist.mjs';
import { addChecklistCandidates } from '../src/ledger-check.mjs';
import { addCrossCandidates } from '../src/cross-docs.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'fixtures');

// 画面の上の欄で人が選ぶ値の代わり。頭の1文字(A・B・C)で引く
const DEFAULT_FORM = {
  A: { workType: 'other', ordererType: 'public' }, // 市道の改良工事(土木)。発注者は市
  B: { workType: 'kenchiku-ikkatsu', ordererType: 'public' }, // 共同住宅の新築(建築一式)。発注者は県
  C: { workType: 'other', ordererType: 'private' }, // 倉庫の造成(土木)。発注者は株式会社
};

const out = { note: '架空の書類にツールをかけた出力。候補は「抜け・食い違いの候補」、undecidable は「判断できない」', cases: [] };
for (const name of fs.readdirSync(dir).sort()) {
  const p = path.join(dir, name);
  if (!fs.statSync(p).isDirectory()) continue;
  const form = DEFAULT_FORM[name[0]] ?? {};
  const c = { case: name, form, taicho: null, plan: null };
  const ledgerFile = path.join(p, '施工体制台帳.md');
  if (fs.existsSync(ledgerFile)) {
    const text = fs.readFileSync(ledgerFile, 'utf8');
    const ledger = parseLedgerText(text);
    ledger.project.workType = form.workType;
    ledger.project.ordererType = form.ordererType;
    // 記載事項の表の「空」の行も候補に出す(画面と同じ。F29b)
    const base = addChecklistCandidates(checkTaicho(ledger), ledger, checkChecklistText(text));
    // 施工体系図・目次があれば突き合わせる(F32a)。無ければ base のまま
    const optional = (file) => (fs.existsSync(path.join(p, file)) ? fs.readFileSync(path.join(p, file), 'utf8') : '');
    const r = addCrossCandidates(base, ledger, { taikeizu: optional('施工体系図.md'), plan: optional('施工計画書_目次.md') });
    c.taicho = {
      // 「点検に使っていないので読み飛ばしました」は数だけにする(採点に関わらないため)
      readWarnings: [...ledger.warnings.filter((w) => !/読み飛ばしました/.test(w)), ...(r.crossWarnings ?? [])],
      skippedFields: ledger.warnings.filter((w) => /読み飛ばしました/.test(w)).length,
      candidates: r.candidates.map((x) => ({ target: x.target, field: x.field, message: x.message, ...(x.confirm ? { confirm: x.confirm } : {}), basis: (x.basis ?? []).map((b) => b.label ?? b.quoteId ?? '') })),
      undecidable: r.undecidable.map((x) => ({ target: x.target, field: x.field, message: x.message })),
    };
  }
  const tocFile = path.join(p, '施工計画書_目次.md');
  if (fs.existsSync(tocFile)) {
    const r = checkPlanToc(fs.readFileSync(tocFile, 'utf8'), { workType: form.workType });
    c.plan = {
      candidates: r.candidates.map((x) => ({ no: x.no, item: x.item, message: x.message })),
      byAlias: r.found.filter((f) => f.byAlias).map((f) => ({ no: f.no, item: f.item, line: f.line })),
      extra: r.extra,
      undecidable: r.undecidable.map((x) => x.message),
    };
  }
  out.cases.push(c);
}
const json = JSON.stringify(out, null, 2);
if (process.argv[2]) fs.writeFileSync(process.argv[2], json + '\n');
else console.log(json);

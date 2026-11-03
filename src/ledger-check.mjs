// 台帳の点検の候補に、記載事項の表(施行規則 第14条の2 第1項)の「空」の行を足す(F29b)。
// 同じ欄をすでに候補に出しているとき(checklist.json の parts の overlap)は二重に出さず、その候補の根拠に号を足す。
// 資格の欄に値があっても区分を決められない行(state が unclear)は、「判断できない」に足す。
import quotesData from '../data/quotes.json' with { type: 'json' };
import sourcesData from '../data/sources/index.json' with { type: 'json' };
import { resolveQuoteIds } from './taicho.mjs';
import { primeLabel, subLabel } from './check-taicho.mjs';
import { CHECKLIST_ITEMS, whereOf } from './checklist.mjs';

const itemById = new Map(CHECKLIST_ITEMS.map((it) => [it.id, it]));
const basisOf = (quoteId) => resolveQuoteIds([{ quoteId }], quotesData.quotes, sourcesData.sources, '台帳の記載事項');
const partText = (p) => p.label + '(' + p.key + (p.line ? '・' + p.line + '行目' : '') + ')';

// out: checkTaicho の返り値、ledger: parseLedgerText の返り値、checklist: checkChecklistText の返り値
// 返り値は out に候補を足した新しいもの(out は変えない)
export function addChecklistCandidates(out, ledger, checklist) {
  const candidates = (out.candidates ?? []).map((c) => ({ ...c }));
  const undecidable = [...(out.undecidable ?? [])];
  const targetOf = (row) => (row.subIndex === undefined ? primeLabel(ledger.prime) : subLabel(ledger.subcontractors[row.subIndex], row.subIndex));
  for (const row of checklist.rows) {
    for (const p of row.parts.filter((x) => x.state === 'unclear')) {
      const it = itemById.get(row.itemId);
      undecidable.push({
        target: targetOf(row), field: 'engineer.qualification',
        message: p.label + 'の欄に「' + p.value + '」とありますが、どの資格の区分(法第7条第2号イ・ロ・ハ)かを台帳から決められないので判断できません(' + whereOf(it) + '。実務の経験なら、イ・ロのどちらかが要ります)',
        basis: basisOf(it.quoteId),
      });
    }
  }
  for (const row of checklist.rows.filter((r) => r.status === 'empty')) {
    const it = itemById.get(row.itemId);
    const target = targetOf(row);
    const basis = basisOf(it.quoteId);
    const rest = [];
    row.parts.forEach((p, i) => {
      if (p.state !== 'blank') return;
      const field = it.parts[i].overlap;
      const same = field && candidates.find((c) => c.target === target && c.field === field);
      if (!same) rest.push(p);
      else if (!same.basis.some((b) => b.quoteId === it.quoteId)) same.basis = [...same.basis, ...basis];
    });
    if (rest.length === 0) continue;
    candidates.push({
      kind: 'missing', target, field: 'checklist.' + it.id,
      message: whereOf(it) + ' の記載事項の欄が空です: ' + rest.map(partText).join('、') + (row.condition ? '。' + row.condition : ''),
      basis,
    });
  }
  return { ...out, candidates, undecidable };
}

// 労務費と処遇の確認(F50a)。規則表(data/rules.json の laborDuties)の行を当てはめるだけで、条件をここに書き込まない。
// 通信しない。AI も使わない。どの行も「確認が要る」候補で、当たる・当たらないは判定しない。
import rulesData from '../data/rules.json' with { type: 'json' };
import quotesData from '../data/quotes.json' with { type: 'json' };
import sourcesData from '../data/sources/index.json' with { type: 'json' };
import { matchesCondition, resolveQuoteIds } from './taicho.mjs';

// 未入力は「元請けでも下請けでもある」として候補を落とさないよう、'unknown' にして行で受ける
const facts = (input) => ({
  direct: input?.direct ?? 'unknown',
  hasSubcontract: input?.hasSubcontract ?? 'unknown',
});

// 返り値: [{ key, ruleId, label, status: 'needs_check', note, basis, exceptions }]
export function laborDuties(input, rows = rulesData.laborDuties) {
  return rows.filter((r) => matchesCondition(r.condition, facts(input))).map((r) => ({
    key: r.key,
    ruleId: r.id,
    label: r.label,
    status: r.result.status,
    note: r.action,
    basis: resolveQuoteIds(r.basis, quotesData.quotes, sourcesData.sources, '労務費と処遇の確認'),
    exceptions: r.exceptions,
  }));
}

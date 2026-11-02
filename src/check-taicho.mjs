// 施工体制台帳の点検(F04a): 台帳の入力から、抜け・食い違いの「候補」を根拠の条つきで出す。
// 候補は指摘の候補であって、合否ではない。入力から決められないことは「判断できない」(undecidable)に出し、推測で候補にしない。
// 金額の境目は、取得した原文の抜き書き(施行令 第2条)から読み、コードに書かない(src/bid-check.mjs と同じ読み方)。
//
// 入力(台帳の形):
// { project: { name, orderer, ordererType: 'public'|'private', workType: 'other'|'kenchiku-ikkatsu', contractAmount, periodFrom, periodTo },
//   prime: { name, licenseType: 'tokutei'|'ippan', licenseNumber, engineer: { role: 'kanri'|'shunin', name, qualification } },
//   subcontractors: [ { name, licenseNumber, work, periodFrom, periodTo, amount, engineer: { role: 'shunin', name, qualification } } ] }
// 返り値: { candidates: [{ kind: 'missing'|'mismatch', target, field, message, basis }], undecidable: [{ target, field, message, basis }], notes }
import quotesData from '../data/quotes.json' with { type: 'json' };
import sourcesData from '../data/sources/index.json' with { type: 'json' };
import { resolveQuoteIds } from './taicho.mjs';
import { licenseThreshold } from './bid-check.mjs';

const basisOf = (...ids) => resolveQuoteIds(ids.map((quoteId) => ({ quoteId })), quotesData.quotes, sourcesData.sources, '台帳の点検');

const blank = (x) => x === undefined || x === null || String(x).trim() === '';
const isAmount = (x) => typeof x === 'number' && Number.isFinite(x) && x >= 0;
const yen = (n) => n.toLocaleString('ja-JP') + '円';

// 台帳の下請けを指す名前。名称が空なら何件目かで指す
const subLabel = (s, i) => (blank(s?.name) ? `下請け ${i + 1}件目(名称が空)` : String(s.name).trim());
const primeLabel = (p) => (blank(p?.name) ? '元請け(名称が空)' : String(p.name).trim());

// 下請けの行の抜け(建設業法 第24条の8第1項: 下請負人の商号又は名称、工事の内容及び工期を台帳に書く)
function checkSubFields(s, i, out) {
  const target = subLabel(s, i);
  const b = basisOf('q-kensetsu-24_8-1-items');
  if (blank(s?.name)) out.candidates.push({ kind: 'missing', target, field: 'name', message: '下請負人の商号又は名称が空です', basis: b });
  if (blank(s?.work)) out.candidates.push({ kind: 'missing', target, field: 'work', message: '下請けの工事の内容が空です', basis: b });
  const noFrom = blank(s?.periodFrom);
  const noTo = blank(s?.periodTo);
  if (noFrom || noTo) {
    const which = noFrom && noTo ? '工期(始め・終わり)' : noFrom ? '工期の始め' : '工期の終わり';
    out.candidates.push({ kind: 'missing', target, field: 'period', message: `下請けの${which}が空です`, basis: b });
  }
}

// 技術者の抜け(建設業法 第26条第1項: 建設業者は請け負った工事に主任技術者を置く)
function checkEngineer(owner, target, out, who) {
  const e = owner?.engineer;
  const b = basisOf('q-kensetsu-26-1');
  if (!e || blank(e.name)) {
    out.candidates.push({ kind: 'missing', target, field: 'engineer', message: `${who}の技術者(主任技術者・監理技術者)の氏名が空です`, basis: b });
    return;
  }
  if (blank(e.qualification)) {
    out.candidates.push({ kind: 'missing', target, field: 'engineer.qualification', message: `${who}の技術者の資格の欄が空です(第7条第2号イ・ロ・ハのどれに当たるかを書く)`, basis: b });
  }
}

// 下請けの総額と、元請けの技術者・許可の種類の食い違い
// 建設業法 第26条第2項(監理技術者)・第3条第1項第2号と施行令 第2条(特定建設業の許可)
function checkPrimeAgainstTotal(input, out) {
  // 第26条第2項の「当該建設工事を施工するために締結した下請契約」は元請けが自分で結んだ契約。二次以降(tier が 2 以上)は総額に数えない
  const subs = (input.subcontractors ?? []).filter((s) => !(Number.isInteger(s?.tier) && s.tier >= 2));
  const prime = input.prime ?? {};
  const target = primeLabel(prime);
  const role = prime.engineer?.role;
  const license = prime.licenseType;
  const t = licenseThreshold();
  const workType = input.project?.workType;
  const needsTotal = role !== 'kanri' || license !== 'tokutei';
  if (subs.length === 0) return; // 下請契約が無ければ総額の境目の話にならない
  if (!needsTotal) return; // 監理技術者・特定建設業なら、総額がいくらでも食い違わない

  const unknownAmount = subs.map((s, i) => [s, i]).filter(([s]) => !isAmount(s?.amount));
  if (workType !== 'other' && workType !== 'kenchiku-ikkatsu') {
    out.undecidable.push({ target, field: 'project.workType', message: '工事の種類(建築一式かそれ以外か)が分からないので、下請けの総額の境目(施行令 第2条)を決められず、技術者・許可の種類が合っているか判断できません', basis: basisOf('q-rei-2-1') });
    return;
  }
  const line = workType === 'kenchiku-ikkatsu' ? t.kenchiku : t.other;
  const known = subs.filter((s) => isAmount(s?.amount)).reduce((a, s) => a + s.amount, 0);
  if (unknownAmount.length > 0 && known < line) {
    out.undecidable.push({
      target,
      field: 'subcontractors.amount',
      message: '請負代金の額が分からない下請けがある(' + unknownAmount.map(([s, i]) => subLabel(s, i)).join('、') + ')ので、下請けの総額が ' + yen(line) + ' 以上かを決められず、元請けの技術者(監理技術者か)と許可の種類(特定か)が合っているか判断できません',
      basis: basisOf('q-kensetsu-26-2', 'q-rei-2-1'),
    });
    return;
  }
  // 分かっている額だけで境目以上なら、分からない額があっても総額は境目以上
  if (known < line) return;
  const totalText = (unknownAmount.length > 0 ? '分かっている額だけで ' : '') + yen(known);
  if (role !== 'kanri') {
    out.candidates.push({
      kind: 'mismatch', target, field: 'prime.engineer.role',
      message: '下請けの総額(税込み)が ' + totalText + ' で、' + yen(line) + ' 以上なのに、元請けの技術者が監理技術者になっていません',
      basis: basisOf('q-kensetsu-26-2', 'q-rei-2-1'),
    });
  }
  if (license !== 'tokutei') {
    out.candidates.push({
      kind: 'mismatch', target, field: 'prime.licenseType',
      message: '下請けの総額(税込み)が ' + totalText + ' で、' + yen(line) + ' 以上なのに、元請けの許可の種類が特定建設業になっていません',
      basis: basisOf('q-kensetsu-3-1-2', 'q-rei-2-1'),
    });
  }
}

export function checkTaicho(input = {}) {
  const out = { candidates: [], undecidable: [] };
  const subs = Array.isArray(input.subcontractors) ? input.subcontractors : [];
  checkEngineer(input.prime, primeLabel(input.prime), out, '元請け');
  subs.forEach((s, i) => {
    checkSubFields(s, i, out);
    checkEngineer(s, subLabel(s, i), out, '下請け');
  });
  checkPrimeAgainstTotal({ ...input, subcontractors: subs }, out);
  out.notes = [
    '指摘の候補です。抜けが無いことの保証や合否ではありません',
    '下請けの総額は、元請けが直接結んだ下請契約だけで数えます。見出しに「二次」などの次数か「(一次: 会社名)」のような注文者の書き方がある下請けは、総額に入れません。次数を書いていない下請けは、元請けが直接結んだ契約として数えます(二次以降が混じっていれば、総額が変わります)',
    '施工体系図・施工計画書との突き合わせはしていません(台帳だけを点検します)',
    '金額は税込みで比べます(国交省 建設業許可事務ガイドライン【その他】2.)',
    '建築一式工事は建築工事業の許可で請け負うものと読み、施行令 第2条のただし書の金額を使います',
    '台帳の記載事項のうち、国土交通省令(施行規則)で定める事項はこのツールに取り込んでいないので点検していません',
  ];
  return out;
}

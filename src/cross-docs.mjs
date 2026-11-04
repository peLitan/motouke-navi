// 書類どうしの突き合わせ(F32a): 施工体制台帳と、任意で渡す施工体系図・施工計画書の目次を照らす。
// 見るのは3つだけ: 下請負人の一覧(片方にしか無い会社)、同じ下請負人の技術者の氏名、書類どうしの発注者の名前。
// 発注者の名前の違いは、どの書類が正しいかを決めず「判断できない」にする。体系図も目次も無いときは out をそのまま返す。
// 根拠は建設業法 第24条の8 と施行規則 第14条の2 の取得した原文だけを使う(体系図の記載事項の省令の条は取り込んでいない)。
import quotesData from '../data/quotes.json' with { type: 'json' };
import sourcesData from '../data/sources/index.json' with { type: 'json' };
import { resolveQuoteIds } from './taicho.mjs';
import { subLabel } from './check-taicho.mjs';

const basisOf = (...ids) => resolveQuoteIds(ids.map((quoteId) => ({ quoteId })), quotesData.quotes, sourcesData.sources, '書類の突き合わせ');
const LIST_BASIS = ['q-kensetsu-24_8-1-items', 'q-kensetsu-24_8-4', 'q-kisoku-14_2-1-3-i'];

const nfkc = (x) => String(x ?? '').normalize('NFKC');
const trim = (x) => nfkc(x).replace(/\s+/g, ' ').trim();
const compact = (x) => nfkc(x).replace(/\s+/g, '');
const noValue = (x) => /^(?:なし|無し|ナシ|未定|該当なし|[-ー―—]+)?$/.test(compact(x));
const SHORT_FORM = [[/\(株\)/g, '株式会社'], [/\(有\)/g, '有限会社'], [/\(同\)/g, '合同会社'], [/\(資\)/g, '合資会社'], [/\(名\)/g, '合名会社']];
const fullForm = (x) => SHORT_FORM.reduce((s, [re, to]) => s.replace(re, to), compact(x));

// 名前を比べる形。(株)と株式会社は同じに読む。companyKey が同じなら同じ名前、coreKey だけ同じなら書き方の違う名前
const companyKey = (x) => fullForm(x).replace(/\([^()]*次[^()]*\)$/, '');
const coreKey = (x) => companyKey(x).replace(/株式会社|有限会社|合同会社|合資会社|合名会社/g, '');
// 発注者の「架空県みほん市(みほん市長)」のような末尾のかっこは、同じ発注者の書き添えとして比べない
const ordererKey = (x) => fullForm(x).replace(/\([^()]*\)$/, '');

const ROLE_PRIME = /^元請(?:負人|業者|け)?(?:\([^()]*\))?$/;
const ROLE_SUB = /^(?:([一二三四五六七八九1-9]次)(?:下請(?:負人|業者|け)?)?|下請(?:負人|業者|け)?)(?:\(([一二三四五六七八九1-9]次)\))?$/;
const LABEL = /^[\[【〔<(]\s*([^\]】〕>)]{1,12}?)\s*[\]】〕>)]\s*(.*)$/;
const ENGINEER_KEY = /^(?:主任|監理)技術者(?:氏名|の氏名|名)?(?:\([^()]*\))?$/;
const COMPANY_LIKE = /株式会社|有限会社|合同会社|合資会社|合名会社|\((?:株|有|同|資|名)\)/;
const TREE_HEAD = /^[\s|│┃├└┌┬┼┤┣┗─━+*・-]+/;
const TREE_BRANCH = /[+├└┣┗─━-]/;

// 1行を「項目: 値」の並びにする。表の行は1つ目の欄を項目にする。枝の線の後ろの行は branch を立てる
function rowsOf(line) {
  const t = line.trim();
  if (/^\|.*\|$/.test(t)) {
    if (/^[|:\s-]+$/.test(t)) return { segs: [], branch: false };
    const cells = t.slice(1, -1).split('|').map((c) => c.trim());
    return { segs: [cells[0] + ': ' + cells.slice(1).join(' ')], branch: false };
  }
  const head = (line.match(TREE_HEAD) ?? [''])[0];
  return { segs: line.slice(head.length).split(/\s+\/\s+/), branch: TREE_BRANCH.test(head) };
}
const keyValue = (seg) => {
  const m = seg.match(/^([^:]{1,24}?)\s*:\s*(.*)$/);
  return m ? [compact(m[1]), trim(m[2])] : null;
};

// 書類の「発注者: …」か表の「| 発注者 | … |」を読む。目次と体系図で同じ
export function readOrderer(text) {
  for (const raw of nfkc(text).replace(/\r\n?/g, '\n').split('\n')) {
    for (const seg of rowsOf(raw).segs) {
      const kv = keyValue(seg);
      if (kv && /^発注者(?:名|の名称|の商号)?$/.test(kv[0]) && !noValue(kv[1])) return kv[1];
    }
  }
  return '';
}

// 施工体系図の文を読む。返り値: { orderer, subs: [{ name, tier, engineers: [氏名] }], warnings }
// 読む形: 「[一次] 会社名」(かっこは [ 【 〔 < ( )、「一次下請: 会社名」「下請負人: 会社名」、木の枝の線の後ろの会社名。
// 技術者は「主任技術者: 氏名」「監理技術者: 氏名」を、直前の会社のものとして読む(補佐・専門技術者は読まない)
export function parseTaikeizu(text) {
  const subs = [];
  const warnings = [];
  let current = null; // 'prime' か subs の要素
  const addSub = (name, tier) => {
    const n = trim(name);
    current = null;
    if (noValue(n)) return;
    current = { name: n, tier: tier || '', engineers: [] };
    subs.push(current);
  };
  const roleOf = (label, rest) => {
    const key = compact(label);
    if (ROLE_PRIME.test(key)) { current = 'prime'; return true; }
    const m = key.match(ROLE_SUB);
    if (!m) return false;
    addSub(rest, m[1] ?? m[2]);
    return true;
  };
  const engineer = (value) => {
    const name = trim(value).replace(/\s*\([^()]*\)$/, '');
    if (current && current !== 'prime' && !noValue(name)) current.engineers.push(name);
  };
  const read = (seg, branch, lineNo) => {
    const lab = seg.match(LABEL);
    if (lab) {
      // 1行に続けて書いた「[一次] 会社名 主任技術者: 氏名」は、名前と技術者に分ける
      const tail = lab[2].match(/^(.*?)\s+((?:主任|監理)技術者.*)$/);
      if (roleOf(lab[1], tail ? tail[1] : lab[2])) {
        if (tail) read(tail[2], false, lineNo);
        return;
      }
    }
    const kv = keyValue(seg);
    if (kv) {
      if (ROLE_PRIME.test(kv[0]) || ROLE_SUB.test(kv[0])) roleOf(kv[0], kv[1]);
      else if (ENGINEER_KEY.test(kv[0])) engineer(kv[1]);
      return;
    }
    if (!COMPANY_LIKE.test(seg)) return;
    if (branch) addSub(seg, '');
    else warnings.push('施工体系図の ' + lineNo + '行目: 会社名のようですが、元請け・下請けのどれか分からないので読みませんでした');
  };
  nfkc(text).replace(/\r\n?/g, '\n').split('\n').forEach((line, i) => {
    if (/^\s*(?:```|#)/.test(line)) return;
    const { segs, branch } = rowsOf(line);
    segs.forEach((seg, k) => { if (seg.trim()) read(seg.trim(), branch && k === 0, i + 1); });
  });
  return { orderer: readOrderer(text), subs, warnings };
}

function compareEngineer(s, target, hits, out) {
  const basis = basisOf('q-kisoku-14_2-1-4-ho', 'q-kensetsu-24_8-4');
  const ledgerName = noValue(s.engineer?.name) ? '' : trim(s.engineer.name);
  const names = hits.flatMap((d) => d.engineers);
  if (ledgerName && names.length === 0) {
    out.undecidable.push({ target, field: 'cross.engineer', message: '施工体系図から「' + trim(s.name) + '」の技術者の氏名を読めなかったので、台帳の「' + ledgerName + '」と比べられず判断できません', basis });
    return;
  }
  if (!ledgerName && names.length > 0) {
    // 台帳の空はすでに点検の結果に出ているので、同じ行に体系図の氏名を書き足す。二重に出さない
    const note = '(施工体系図には「' + names.join('」「') + '」とあります)';
    const row = [...out.candidates, ...out.undecidable].find((x) => x.target === target && x.field === 'engineer');
    if (row) row.message += note;
    else out.undecidable.push({ target, field: 'cross.engineer', message: '台帳から技術者の氏名を読めなかったので、施工体系図と比べられず判断できません' + note, basis });
    return;
  }
  if (!ledgerName || names.some((n) => compact(n) === compact(ledgerName))) return;
  out.candidates.push({
    kind: 'mismatch', target, field: 'cross.engineer',
    message: '同じ下請負人の技術者の氏名が、施工体制台帳は「' + ledgerName + '」、施工体系図は「' + names.join('」「') + '」で合いません',
    basis, confirm: ['字の違い(異体字など)か別の人かは、下請けの届けで確かめてください'],
  });
}

function compareSubs(ledger, diagram, out) {
  const named = (ledger.subcontractors ?? []).map((s, i) => ({ s, i })).filter(({ s }) => !noValue(s?.name));
  if (named.length === 0 || diagram.subs.length === 0) {
    const which = named.length === 0 ? '施工体制台帳' : '施工体系図';
    out.undecidable.push({ target: '下請負人の一覧', field: 'cross.subs', message: which + 'から下請負人を読めなかったので、台帳と施工体系図の下請負人の一覧を比べられず判断できません。書き方を確かめてください', basis: basisOf(...LIST_BASIS) });
    return;
  }
  const confirm = ['どちらの書類を直すかは、下請契約と再下請負の通知で確かめてください'];
  const used = new Set();
  for (const { s, i } of named) {
    const same = diagram.subs.filter((d) => companyKey(d.name) === companyKey(s.name));
    const hits = same.length ? same : diagram.subs.filter((d) => coreKey(d.name) === coreKey(s.name));
    const target = subLabel(s, i);
    if (hits.length === 0) {
      out.candidates.push({ kind: 'mismatch', target, field: 'cross.subs', message: '施工体制台帳に下請負人「' + trim(s.name) + '」がありますが、施工体系図に見当たりません', basis: basisOf(...LIST_BASIS), confirm });
      continue;
    }
    hits.forEach((d) => used.add(d));
    if (same.length === 0) {
      out.undecidable.push({ target, field: 'cross.subs', message: '台帳は「' + trim(s.name) + '」、施工体系図は「' + hits[0].name + '」で、法人の種類か位置の書き方が違います。同じ会社か決められないので、登記の名前を確かめてください(技術者の氏名は同じ会社として比べています)', basis: basisOf(...LIST_BASIS) });
    }
    compareEngineer(s, target, hits, out);
  }
  for (const d of diagram.subs.filter((x) => !used.has(x))) {
    out.candidates.push({ kind: 'mismatch', target: d.name, field: 'cross.subs', message: '施工体系図に下請負人「' + d.name + '」' + (d.tier ? '(' + d.tier + ')' : '') + 'がありますが、施工体制台帳に見当たりません', basis: basisOf(...LIST_BASIS), confirm });
  }
}

function compareOrderer(ledger, taikeizuOrderer, planOrderer, out) {
  const list = [['施工体制台帳', ledger.project?.orderer], ['施工体系図', taikeizuOrderer], ['施工計画書の目次', planOrderer]]
    .filter(([, v]) => !noValue(v)).map(([doc, v]) => [doc, trim(v)]);
  if (new Set(list.map(([, v]) => ordererKey(v))).size < 2) return;
  out.undecidable.push({
    target: '発注者', field: 'cross.orderer',
    message: '書類どうしで発注者の名前が違います(' + list.map(([doc, v]) => doc + ': ' + v).join('、') + ')。どの書類が正しいかは書類からは決められないので判断できません。発注者との契約書で確かめてください',
    basis: basisOf('q-kisoku-14_2-1-2-ro'),
  });
}

// out: 台帳の点検の結果、ledger: parseLedgerText の返り値、docs: { taikeizu, plan }(どちらも文。空でよい)
// 返り値は候補を足した新しい結果(out は変えない)。読めなかった行は crossWarnings に入れる
export function addCrossCandidates(out, ledger, docs = {}) {
  const hasTaikeizu = String(docs.taikeizu ?? '').trim() !== '';
  // 目次は「発注者: …」の行があるときだけ突き合わせに使う。目次の点検のためだけに貼った文で結果を変えない
  const planOrderer = readOrderer(docs.plan);
  const hasPlan = planOrderer !== '';
  if (!hasTaikeizu && !hasPlan) return out;
  const next = { ...out, candidates: (out.candidates ?? []).map((c) => ({ ...c })), undecidable: (out.undecidable ?? []).map((u) => ({ ...u })) };
  const diagram = hasTaikeizu ? parseTaikeizu(docs.taikeizu) : null;
  if (diagram) compareSubs(ledger, diagram, next);
  compareOrderer(ledger, diagram?.orderer, planOrderer, next);
  const given = [hasTaikeizu ? '施工体系図' : null, hasPlan ? '施工計画書の目次' : null].filter(Boolean).join('・');
  const seen = [hasTaikeizu ? '下請負人の一覧・下請けの技術者の氏名' : null, '発注者の名前'].filter(Boolean).join('・');
  const crossNote = '台帳と' + given + 'は、' + seen + 'だけを突き合わせています。元請けの技術者・工事の内容・工期は比べていません';
  next.notes = (out.notes ?? []).map((n) => (/突き合わせはしていません/.test(n) ? crossNote : n));
  next.crossWarnings = [
    ...(diagram?.warnings ?? []),
    ...(hasTaikeizu && !diagram.orderer ? ['施工体系図に「発注者: …」の行が見つからないので、体系図の発注者の名前は比べていません'] : []),
  ];
  return next;
}

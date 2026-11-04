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
const uniqueBy = (list, key) => [...new Map(list.map((x) => [key(x), x])).values()];

// 技術者の欄を氏名の並びにする。かっこの書き添え(専任・交代の日付など)を先に外すので、日付の「/」では分けない。
// 「、」「,」「;」「/」「→」で分ける。「・」はかっこの直後のときだけ区切りに読む(「ジョン・スミス」のような1人の名前を割らない)
function personNames(value) {
  let s = nfkc(value);
  for (let prev = ''; prev !== s;) { prev = s; s = s.replace(/\([^()]*\)/g, ' '); }
  return uniqueBy(s.split(/[、,;/→⇒]|\s+・\s*/).map(trim).filter((n) => !noValue(n)), compact);
}

// 名前を比べる形。(株)と株式会社は同じに読む。companyKey が同じなら同じ名前、coreKey だけ同じなら書き方の違う名前
const companyKey = (x) => fullForm(x).replace(/\([^()]*次[^()]*\)$/, '');
const coreKey = (x) => companyKey(x).replace(/株式会社|有限会社|合同会社|合資会社|合名会社/g, '');
// 発注者の「架空県みほん市(みほん市長)」のような末尾のかっこは、同じ発注者の書き添えとして比べない
const ordererKey = (x) => fullForm(x).replace(/\([^()]*\)$/, '');
// 名前の一部が合うかを見る形。かっこの書き添えと中黒を外す。工種の添え書きや1行に複数社は、この形の含む・含まれるで拾う
const looseKey = (x) => coreKey(x).replace(/\([^()]*\)/g, '').replace(/[・.,]/g, '');
const partlySame = (a, b) => {
  const [x, y] = [looseKey(a), looseKey(b)];
  return x.length >= 2 && y.length >= 2 && (x.includes(y) || y.includes(x));
};

const ROLE_PRIME = /^元請(?:負人|業者|け)?(?:\([^()]*\))?$/;
const ROLE_SUB = /^(?:([一二三四五六七八九1-9]次)(?:下請(?:負人|業者|け)?)?|下請(?:負人|業者|け)?)(?:\(([一二三四五六七八九1-9]次)\))?$/;
const LABEL = /^[\[【〔<(]\s*([^\]】〕>)]{1,12}?)\s*[\]】〕>)]\s*(.*)$/;
const ENGINEER_KEY = /^(?:主任|監理)技術者(?:氏名|の氏名|名)?(?:\([^()]*\))?$/;
const COMPANY_LIKE = /株式会社|有限会社|合同会社|合資会社|合名会社|\((?:株|有|同|資|名)\)/;
const TREE_HEAD = /^[\s|│┃├└┌┬┼┤┣┗─━+*・-]+/;
const TREE_BRANCH = /[+├└┣┗─━-]/;
const TRAIL_PRIME = /\(元請(?:負人|業者|け)?\)$/;
const COMPANY_COLUMN = /^(?:会社名?|会社の?名称|商号|名称|商号又は名称|下請負人名)$/;

const tableCells = (line) => {
  const t = line.trim();
  if (!/^\|.*\|$/.test(t) || /^[|:\s-]+$/.test(t)) return null;
  return t.slice(1, -1).split('|').map((c) => c.trim());
};
// 列の見出しのある一覧表の行か。3列以上の行(発注者の行を除く)と、2列でも見出しの行に会社名の列があるもの
function isListTableRow(lines, i) {
  const cells = tableCells(lines[i]);
  if (!cells) return false;
  if (cells.length >= 3) return !/^発注者/.test(compact(cells[0]));
  const next = lines[i + 1]?.trim() ?? '';
  return /^\|[|:\s-]+\|$/.test(next) && cells.some((c) => COMPANY_COLUMN.test(compact(c)));
}

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

// 施工体系図の文を読む。返り値: { orderer, subs: [{ name, tier, engineers: [氏名], label? }], unread: [行], tableLine, warnings }
// label は役割の分からないかっこの語(協力会社など)。unread は会社名らしいが読まなかった行。tableLine は読まなかった一覧表の行番号(無ければ 0)
// 読む形: 「[一次] 会社名」(かっこは [ 【 〔 < ( )、「一次下請: 会社名」「下請負人: 会社名」、木の枝の線の後ろの会社名。
// 技術者は「主任技術者: 氏名」「監理技術者: 氏名」を、直前の会社のものとして読む(補佐・専門技術者は読まない)
// 列の見出しのある一覧表は読まない(どの列が何か決めつけない)
export function parseTaikeizu(text) {
  const subs = [];
  const warnings = [];
  const unread = [];
  let tableLine = 0;
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
    if (current && current !== 'prime') current.engineers.push(...personNames(value));
  };
  const read = (seg, branch, lineNo) => {
    const lab = seg.match(LABEL);
    if (lab) {
      // 1行に続けて書いた「[一次] 会社名 主任技術者: 氏名」は、名前と技術者に分ける
      const tail = lab[2].match(/^(.*?)\s+((?:主任|監理)技術者.*)$/);
      const name = tail ? tail[1] : lab[2];
      const known = roleOf(lab[1], name);
      const labeled = !known && COMPANY_LIKE.test(name);
      if (labeled) { addSub(name, ''); current.label = lab[1]; }
      if (known || labeled) {
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
    if (TRAIL_PRIME.test(compact(seg))) { current = 'prime'; return; }
    if (branch) { addSub(seg, ''); return; }
    unread.push(trim(seg));
    warnings.push('施工体系図の ' + lineNo + '行目: 会社名のようですが、元請け・下請けのどれか分からないので読みませんでした');
  };
  const lines = nfkc(text).replace(/\r\n?/g, '\n').split('\n');
  lines.forEach((line, i) => {
    if (/^\s*(?:```|#)/.test(line)) return;
    if (isListTableRow(lines, i)) { tableLine ||= i + 1; return; }
    const { segs, branch } = rowsOf(line);
    segs.forEach((seg, k) => { if (seg.trim()) read(seg.trim(), branch && k === 0, i + 1); });
  });
  if (tableLine) warnings.push('施工体系図の ' + tableLine + '行目: 列の見出しのある一覧表の形は読みません。下請負人の一覧は比べていません');
  return { orderer: readOrderer(text), subs, unread, tableLine, warnings };
}

// group: 台帳の同じ会社の節(旧・新で2つあることがある)。氏名はまとめて集合で比べ、どちらかがもう片方に含まれるなら合うとする
function compareEngineer(group, target, hits, out) {
  const basis = basisOf('q-kisoku-14_2-1-4-ho', 'q-kensetsu-24_8-4');
  const ledgerNames = uniqueBy(group.flatMap(({ s }) => personNames(s.engineer?.name)), compact);
  const names = uniqueBy(hits.flatMap((d) => d.engineers), compact);
  const quoted = (list) => '「' + list.join('」「') + '」';
  if (ledgerNames.length > 0 && names.length === 0) {
    out.undecidable.push({ target, field: 'cross.engineer', message: '施工体系図から「' + trim(group[0].s.name) + '」の技術者の氏名を読めなかったので、台帳の' + quoted(ledgerNames) + 'と比べられず判断できません', basis });
    return;
  }
  if (ledgerNames.length === 0 && names.length > 0) {
    // 台帳の空はすでに点検の結果に出ているので、同じ行に体系図の氏名を書き足す。二重に出さない
    const note = '(施工体系図には' + quoted(names) + 'とあります)';
    const targets = group.map(({ s, i }) => subLabel(s, i));
    const rows = [...out.candidates, ...out.undecidable].filter((x) => targets.includes(x.target) && x.field === 'engineer');
    rows.forEach((row) => { row.message += note; });
    if (rows.length === 0) out.undecidable.push({ target, field: 'cross.engineer', message: '台帳から技術者の氏名を読めなかったので、施工体系図と比べられず判断できません' + note, basis });
    return;
  }
  const inLedger = new Set(ledgerNames.map(compact));
  const inDiagram = new Set(names.map(compact));
  if (ledgerNames.every((n) => inDiagram.has(compact(n))) || names.every((n) => inLedger.has(compact(n)))) return;
  out.candidates.push({
    kind: 'mismatch', target, field: 'cross.engineer',
    message: '同じ下請負人の技術者の氏名が、施工体制台帳は' + quoted(ledgerNames) + '、施工体系図は' + quoted(names) + 'で合いません',
    basis, confirm: ['字の違い(異体字など)か、別の人か、技術者の交代(前任・後任)かは、下請けの届けで確かめてください'],
  });
}

const UNSURE_NAME = '添え書きか、書き方の違いか、別の会社か、1行に複数社を書いたものかを決められないので判断できません。下請契約で確かめてください(技術者の氏名は比べていません)';

function compareSubs(ledger, diagram, out) {
  const named = (ledger.subcontractors ?? []).map((s, i) => ({ s, i })).filter(({ s }) => !noValue(s?.name));
  const subsBasis = () => basisOf(...LIST_BASIS);
  const unsure = (target, message) => out.undecidable.push({ target, field: 'cross.subs', message, basis: subsBasis() });
  if (named.length === 0 || diagram.subs.length === 0 || diagram.tableLine) {
    const reason = named.length === 0 ? '施工体制台帳から下請負人を読めなかった'
      : diagram.tableLine ? '施工体系図が一覧表の形で読まなかった' : '施工体系図から下請負人を読めなかった';
    unsure('下請負人の一覧', reason + 'ので、台帳と施工体系図の下請負人の一覧を比べられず判断できません。書き方を確かめてください');
    return;
  }
  const confirm = ['どちらの書類を直すかは、下請契約と再下請負の通知で確かめてください'];
  const primeName = noValue(ledger.prime?.name) ? '' : ledger.prime.name;
  // 枝の線の後ろに名前だけある行が元請けと同じ名前なら、下請負人に数えない
  const subs = diagram.subs.filter((d) => d.tier || d.label || !primeName || coreKey(d.name) !== coreKey(primeName));
  const taken = new Set(subs.filter((d) => named.some(({ s }) => companyKey(s.name) === companyKey(d.name))));
  const rest = subs.filter((d) => !taken.has(d));
  const used = new Set(taken);
  // 台帳の同じ会社の節はまとめて1社として比べる(技術者の交代で節が2つある台帳)
  for (const key of new Set(named.map(({ s }) => companyKey(s.name)))) {
    const group = named.filter(({ s }) => companyKey(s.name) === key);
    const { s, i } = group[0];
    const name = trim(s.name);
    const target = subLabel(s, i);
    const same = subs.filter((d) => companyKey(d.name) === companyKey(s.name));
    if (same.length) { compareEngineer(group, target, same, out); continue; }
    const core = rest.filter((d) => coreKey(d.name) === coreKey(s.name));
    if (core.length) {
      core.forEach((d) => used.add(d));
      unsure(target, '台帳は「' + name + '」、施工体系図は「' + core[0].name + '」で、法人の種類か位置の書き方が違います。同じ会社か決められないので、登記の名前を確かめてください(技術者の氏名は同じ会社として比べています)');
      compareEngineer(group, target, core, out);
      continue;
    }
    const part = rest.filter((d) => partlySame(d.name, s.name));
    if (part.length) {
      part.forEach((d) => used.add(d));
      unsure(target, '台帳は「' + name + '」、施工体系図は「' + part.map((d) => d.name).join('」「') + '」で、名前の一部が合います。' + UNSURE_NAME);
      continue;
    }
    const line = diagram.unread.find((u) => partlySame(u, s.name));
    if (line) {
      unsure(target, '台帳の「' + name + '」は、施工体系図の読めなかった行「' + line + '」と名前の一部が合います。' + UNSURE_NAME);
      continue;
    }
    out.candidates.push({ kind: 'mismatch', target, field: 'cross.subs', message: '施工体制台帳に下請負人「' + name + '」がありますが、施工体系図に見当たりません', basis: subsBasis(), confirm });
  }
  for (const d of subs.filter((x) => !used.has(x))) {
    if (d.label) unsure(d.name, '施工体系図の「[' + d.label + '] ' + d.name + '」は、下請負人か分からない書き方で、台帳にも見当たりません。下請負人かどうかは書類からは決められないので判断できません');
    else if (primeName && !d.tier && partlySame(d.name, primeName)) unsure(d.name, '施工体系図の「' + d.name + '」は元請け「' + trim(primeName) + '」と名前の一部が合います。元請けの行か下請負人か決められないので判断できません');
    else out.candidates.push({ kind: 'mismatch', target: d.name, field: 'cross.subs', message: '施工体系図に下請負人「' + d.name + '」' + (d.tier ? '(' + d.tier + ')' : '') + 'がありますが、施工体制台帳に見当たりません', basis: subsBasis(), confirm });
  }
}

function compareOrderer(list, out) {
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
  const orderers = [['施工体制台帳', ledger.project?.orderer], ['施工体系図', diagram?.orderer], ['施工計画書の目次', planOrderer]]
    .filter(([, v]) => !noValue(v)).map(([doc, v]) => [doc, trim(v)]);
  compareOrderer(orderers, next);
  const given = [hasTaikeizu ? '施工体系図' : null, hasPlan ? '施工計画書の目次' : null].filter(Boolean).join('・');
  // 発注者の名前は、書いてある書類が2つ以上あるときだけ突き合わせたと書く
  const seen = [hasTaikeizu ? '下請負人の一覧・下請けの技術者の氏名' : null, orderers.length >= 2 ? '発注者の名前' : null].filter(Boolean).join('・');
  const crossNote = '台帳と' + given + 'は、' + (seen ? seen + 'だけを突き合わせています。元請けの技術者・工事の内容・工期は比べていません' : '比べられる項目が無く、突き合わせていません');
  next.notes = (out.notes ?? []).map((n) => (/突き合わせはしていません/.test(n) ? crossNote : n));
  next.crossWarnings = [
    ...(diagram?.warnings ?? []),
    ...(hasTaikeizu && !diagram.orderer ? ['施工体系図に「発注者: …」の行が見つからないので、体系図の発注者の名前は比べていません'] : []),
  ];
  return next;
}

// 台帳の記載事項の点検(F16b): 建設業法施行規則 第14条の2 第1項の事項ごとに、台帳に「値」があるか、「空」か、「判断できない」かを出す。
// 事項と台帳の欄名の当て方は data/checklist.json。根拠の文は data/quotes.json の抜き書き(原文と照合済み)。
//
// 出し方(推測で埋めない。「台帳が不適法」とは出さない):
// - 値: 事項に当たる欄が見つかり、値が書いてある(書いてあるまま出す。「なし」も値。中身が正しいかは見ない)
// - 空: 事項に当たる欄が見つかり、値が空。条文に「〜ときは」があるものは、台帳から当てはまると分かるときだけ空にする
//       (下請負人の許可番号に値があれば建設業者、一次の下請けなら作成建設業者が請け負わせたもの、として扱う)
// - 判断できない: 欄が見つからない(別の名前や別紙・作業員名簿に書いてあるかもしれない)、当てはまるか台帳から決まらない
//       「〜ときは」の事項の欄が空、資格の欄に値があってもどの資格の区分か決められない(F29b)、このツールでは読まない事柄(法第19条の2の通知事項など)がある、Excel からは読まない欄
// 欄が見つからないことを「空」とは言わない(見出しの違いで書いてある事項を「無い」と言い過ぎないため)。
// 1つの事項に欄が2つ以上あるとき(名称・内容・工期など)は、空の欄が1つでもあれば空、なければ見つからない欄が1つでもあれば判断できない。
import checklistData from '../data/checklist.json' with { type: 'json' };
import quotesData from '../data/quotes.json' with { type: 'json' };
import { ledgerRows } from './ledger-text.mjs';
import { qualificationUnclear } from './ledger-reading.mjs';

export const STATUS_LABEL = { value: '値', empty: '空', unknown: '判断できない' };
const ITEM_KANJI = ['', '一', '二', '三', '四'];
const KANSUJI = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
const POINT_ZEN = ['', '（１）', '（２）', '（３）', '（４）', '（５）', '（６）'];
const quoteById = new Map(quotesData.quotes.map((q) => [q.id, q]));

export const CHECKLIST_ITEMS = checklistData.items;
// 国交省のチェックリスト(参考。題名・URL・取得日だけ。文は写さない)と、根拠の原文の取得日・版(F16c)
export const CHECKLIST_REFERENCE = checklistData.reference;
export const CHECKLIST_LAW = checklistData.law;

// 「第14条の2 第1項 第二号 ホ」のような根拠の場所
export function whereOf(it) {
  return '建設業法施行規則 第14条の2 第1項 第' + ITEM_KANJI[it.item] + '号' + (it.subitem ? ' ' + it.subitem : '') + (it.point ? ' ' + POINT_ZEN[it.point] : '');
}

const isBlank = (v) => String(v ?? '').replace(/[\s　]/g, '') === '';
// 「なし」「無し」「該当なし」「−」のように、無いことを書いた値(F29a)。後ろのかっこ書きは見ない
const NONE_RE = /^(?:なし|無し|無|該当なし|非該当|未取得|許可なし|無許可|[-－ー―‐—−]+)(?:[(（].*[)）])?$/;
export const isNone = (v) => NONE_RE.test(String(v ?? '').replace(/[\s　]/g, ''));

// 「健康保険 / 厚生年金 / 雇用保険」のように1つの行に欄をまとめたとき、値も「/」で分けてあれば、欄ごとの値を位置で取る(F29a)
// 返り値: { value } か、欄の数と値の数が合わなければ { mismatch: true }。まとめていない行・値に「/」が無い行は null(行の値をそのまま使う)
const SPLIT_RE = /\s*[\/／]\s*/;
function splitCell(row, re) {
  const keys = row.key.split(SPLIT_RE);
  if (keys.length < 2) return null;
  const idx = keys.findIndex((k) => re.test(k));
  if (idx < 0 || !SPLIT_RE.test(row.value)) return null;
  const values = row.value.split(SPLIT_RE);
  if (values.length !== keys.length) return { mismatch: true };
  return { value: values[idx] };
}

// 下請けでない節の「### 監理技術者補佐」「### 専門技術者」の下の「氏名」「資格」「専任・非専任」の行は、
// 監理技術者・主任技術者の欄と取り違えないよう、欄名の前に小見出しの語を付けて扱う(F29a)
const GROUP_RE = /監理技術者補佐|補佐|専門技術者|技術上の管理/;
function withGroup(rows) {
  return rows.map((r) => {
    const g = r.group && r.group.match(GROUP_RE);
    return g && !GROUP_RE.test(r.key) ? { ...r, key: g[0] + ' ' + r.key } : r;
  });
}

// 欄の一覧から、事項の欄ごとに見つけた行を探す。見つけた順の最初の行を使う
// p.not に当たる欄名は使わない(例: 監理技術者の「専任」に、監理技術者補佐の「専任」の行を使わない)
function matchParts(it, rows, heading) {
  return it.parts.map((p) => {
    if (p.readable === false) return { label: p.label, state: 'unread', value: '' };
    const re = new RegExp(p.re);
    const not = p.not ? new RegExp(p.not) : null;
    const row = rows.find((r) => re.test(r.key) && !(not && not.test(r.key)));
    if (row) {
      const sp = splitCell(row, re);
      if (sp && sp.mismatch) return { label: p.label, state: 'mismatch', value: row.value, key: row.key, line: row.line };
      const v = sp ? sp.value : row.value;
      // 資格の欄に値があっても、どの資格の区分か決められなければ「値」にしない(F29b)
      const state = isBlank(v) ? 'blank' : p.qualification && qualificationUnclear(v) ? 'unclear' : 'found';
      return { label: p.label, state, value: v, key: row.key, line: row.line, ...(sp ? { split: true } : {}) };
    }
    if (p.heading && !isBlank(heading)) return { label: p.label, state: 'found', value: heading, key: '見出し' };
    return { label: p.label, state: 'missing', value: '' };
  });
}

// 条文の「〜ときは」が台帳から当てはまると分かるか。met / unknown / null(条件なし)
function conditionOf(it, rows, tier) {
  if (!it.condition) return null;
  if (it.condition === 'license') {
    const lic = rows.find((r) => /許可番号/.test(r.key));
    if (lic && isNone(lic.value)) return 'none'; // 「なし」は許可が無いと書いたもので、建設業者とは決めない(F29a)
    return lic && !isBlank(lic.value) ? 'met' : 'unknown';
  }
  if (it.condition === 'tier1') return tier === 1 ? 'met' : 'unknown';
  return 'unknown';
}

const CONDITION_TEXT = {
  license: '下請負人が建設業者のときの事項',
  tier1: '作成建設業者が請け負わせた工事(一次の下請け)のときの事項',
  unknown: '条文に「〜ときは」がある事項',
};

const metText = (it) => CONDITION_TEXT[it.condition] + 'で、台帳から当てはまると読みました(' + (it.condition === 'license' ? '許可番号の欄に値がある' : '一次の下請け') + ')';

function judge(it, parts, cond, extraReason) {
  const blank = parts.filter((p) => p.state === 'blank');
  const missing = parts.filter((p) => p.state === 'missing');
  const unread = parts.filter((p) => p.state === 'unread');
  const mismatch = parts.filter((p) => p.state === 'mismatch');
  const unclear = parts.filter((p) => p.state === 'unclear');
  const reasons = [];
  let status;
  // 「置くとき」の事項で、氏名の欄に「なし」と書いてあり、ほかの欄が無いとき(置いていないと書いたもの)は値
  const absent = it.noneMeansAbsent && parts[0].state === 'found' && isNone(parts[0].value)
    && parts.slice(1).every((p) => p.state === 'missing' || ((p.state === 'found' || p.state === 'unclear') && isNone(p.value)));
  if (absent) {
    status = 'value';
    reasons.push('「' + parts[0].value + '」と書いてあり、置いていないと読みました(書いてあるまま。中身が正しいかはこのツールは見ていません)');
  } else if (blank.length && (cond === null || cond === 'met')) {
    status = 'empty';
    reasons.push('欄はあるが値が空: ' + blank.map((p) => p.label + '(' + p.key + (p.line ? '・' + p.line + '行目' : '') + ')').join('、'));
    if (cond === 'met') reasons.push(metText(it));
  } else if (blank.length || missing.length || unread.length || mismatch.length || unclear.length) {
    status = 'unknown';
    if (cond === 'none') reasons.push('許可番号の欄が「なし」と書いてあるので、下請負人を建設業者とは決めません(建設業者のときの事項なので、当てはまるかを台帳から決められません)');
    if (mismatch.length) reasons.push('1つの行にまとめた欄の数と、「/」で分けた値の数が合わないので、どの値がどの欄のものか決められません: ' + mismatch.map((p) => p.label + '(' + p.key + (p.line ? '・' + p.line + '行目' : '') + ')').join('、'));
    if (unclear.length) reasons.push('資格の欄に値はありますが、どの資格の区分(法第7条第2号イ・ロ・ハ)かを台帳から決められません: ' + unclear.map((p) => p.label + '「' + p.value + '」').join('、'));
    if (blank.length) reasons.push('欄はあるが値が空: ' + blank.map((p) => p.label).join('、') + '。' + CONDITION_TEXT[it.condition ?? 'unknown'] + 'で、当てはまるかを台帳から決められません');
    if (missing.length) reasons.push('台帳に欄が見つかりません: ' + missing.map((p) => p.label).join('、') + '(別の名前の欄や、別紙・作業員名簿に書いてあるかもしれません)');
    if (unread.length) reasons.push('このツールでは読まない事柄: ' + unread.map((p) => p.label).join('、'));
    if (cond === 'unknown' && !blank.length && missing.length) reasons.push(CONDITION_TEXT[it.condition] + 'です');
  } else {
    status = 'value';
    reasons.push('欄に値が書いてあります(書いてあるまま。中身が正しいかはこのツールは見ていません)');
  }
  if (extraReason) reasons.push(extraReason);
  if (parts.length > 1 && status === 'value') reasons.push('事項に入っている欄はそれぞれ見つかりました');
  if (it.note && parts.some((p) => p.state === 'found')) reasons.push(it.note);
  return { status, reasons };
}

function rowOf(it, entity, parts, cond, extraReason) {
  const q = quoteById.get(it.quoteId);
  const { status, reasons } = judge(it, parts, cond, extraReason);
  // 1つの欄(「健康保険 / 厚生年金 / 雇用保険」のような行)に当たった欄はまとめて1回だけ出す
  const shown = [];
  for (const p of parts) {
    const text = ({ found: p.value, blank: '(空)', missing: '(欄が見つからない)', unread: '(読まない)', mismatch: p.value + '(欄と値の数が合わない)', unclear: p.value + '(資格の区分を決められない)' })[p.state];
    const same = p.line && shown.find((x) => x.line === p.line && x.text === text);
    if (same) same.labels.push(p.label); else shown.push({ line: p.line, labels: [p.label], text });
  }
  const value = shown.map((x) => x.labels.join('・') + ': ' + x.text).join(' / ');
  return {
    id: it.id + (entity.key ? '@' + entity.key : ''),
    itemId: it.id,
    entity: entity.label,
    ...(entity.subIndex !== undefined ? { subIndex: entity.subIndex } : {}),
    ...(status === 'empty' && cond === 'met' ? { condition: metText(it) } : {}),
    label: it.label,
    status,
    statusLabel: STATUS_LABEL[status],
    value,
    parts,
    reason: reasons.join('。'),
    basis: { where: whereOf(it), quoteId: it.quoteId, quote: q ? q.text : '' },
  };
}

const PRIME_LABEL = '作成建設業者(元請)と、その請け負った工事';

// 台帳の文(Markdown の見出しと「| 項目 | 内容 |」の表)から、記載事項の表を作る
// 返り値: { rows, counts: { value, empty, unknown }, notes }
export function checkChecklistText(text) {
  const { top, sections } = ledgerRows(text);
  const primeRows = withGroup([...top, ...sections.filter((s) => s.kind !== 'subs' && s.kind !== 'other').flatMap((s) => s.rows)]);
  const subs = sections.filter((s) => s.kind === 'subs').flatMap((s) => s.subs);
  const rows = [];
  for (const it of CHECKLIST_ITEMS.filter((x) => x.scope === 'prime')) {
    rows.push(rowOf(it, { label: PRIME_LABEL }, matchParts(it, primeRows, ''), conditionOf(it, primeRows, null)));
  }
  const notes = [];
  if (subs.length === 0) {
    notes.push('下請負人の見出し(## 下請負人 の下の ### 会社名)が見つからないので、第三号・第四号の事項は「判断できない」にしました');
    for (const it of CHECKLIST_ITEMS.filter((x) => x.scope === 'sub')) {
      rows.push(rowOf(it, { label: '下請負人(見つからない)', key: 'none' }, it.parts.map((p) => ({ label: p.label, state: p.readable === false ? 'unread' : 'missing', value: '' })), it.condition ? 'unknown' : null));
    }
  }
  subs.forEach((s, i) => {
    // 次数が見出しに無い(null)・2つ以上で決まらない('mixed')ときは、一次と決めない(第四号トは 判断できない になる)
    const tierText = typeof s.tier === 'number' ? (KANSUJI[s.tier] ?? String(s.tier)) + '次' : (s.tier === 'mixed' ? '次数が決まらない' : '次数が見出しに無い');
    const entity = { label: '下請負人 ' + s.name + '(' + tierText + ')', key: 'sub' + (i + 1), subIndex: i };
    for (const it of CHECKLIST_ITEMS.filter((x) => x.scope === 'sub')) {
      rows.push(rowOf(it, entity, matchParts(it, s.rows, s.name), conditionOf(it, s.rows, s.tier)));
    }
  });
  return { rows, counts: countOf(rows), notes };
}

// Excel(src/ledger-xlsx.mjs の readLedgerXlsx の返り値)から、記載事項の表を作る。
// Excel から読むのは元請けの7つの欄だけなので、そのほかの欄はすべて「判断できない」にする
const XLSX_PARTS = {
  '2-i': { '工事の名称': ['project.name'], '工期': ['project.periodFrom', 'project.periodTo'] },
  '2-ro': { '発注者の商号・名称・氏名': ['project.orderer'] },
  '2-ho': { '技術者の氏名': ['prime.engineer.name'] },
};
const XLSX_NOT_READ = 'Excel から読むのは元請けの7つの欄(工事名・発注者・工期・請負代金額・会社名・技術者名)だけで、この欄は読みません。台帳の文で確かめてください';
const get = (obj, path) => path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);

export function checkChecklistXlsx({ ledger, unreadable = [] }) {
  const causeOf = new Map(unreadable.map((u) => [u.key, u]));
  const rows = [];
  for (const it of CHECKLIST_ITEMS) {
    const map = XLSX_PARTS[it.id] || {};
    let anyNotRead = false;
    const parts = it.parts.map((p) => {
      if (p.readable === false) return { label: p.label, state: 'unread', value: '' };
      const keys = map[p.label];
      if (!keys) { anyNotRead = true; return { label: p.label, state: 'unread', value: '' }; }
      const bad = keys.map((k) => causeOf.get(k)).filter(Boolean);
      if (bad.some((b) => b.cause === 'empty')) return { label: p.label, state: 'blank', value: '', key: bad[0].field };
      if (bad.length) return { label: p.label, state: 'missing', value: '' };
      const v = keys.map((k) => get(ledger, k)).filter((x) => !isBlank(x)).join(' 〜 ');
      return isBlank(v) ? { label: p.label, state: 'missing', value: '' } : { label: p.label, state: 'found', value: v, key: 'Excel' };
    });
    const entity = it.scope === 'prime' ? { label: PRIME_LABEL } : { label: '下請負人(Excel からは読まない)', key: 'xlsx' };
    rows.push(rowOf(it, entity, parts, it.condition ? 'unknown' : null, anyNotRead ? XLSX_NOT_READ : ''));
  }
  return { rows, counts: countOf(rows), notes: [XLSX_NOT_READ] };
}

function countOf(rows) {
  const c = { value: 0, empty: 0, unknown: 0 };
  for (const r of rows) c[r.status]++;
  return c;
}

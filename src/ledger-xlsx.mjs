// 台帳の Excel の読み込み(F04c): 国交省の「施工体制台帳(作成例)」の様式の .xlsx を、そのまま読んで台帳の入力の形にする。
// 欄の位置は決め打ちしない。シートのセルから欄名(「工事名称及び工事内容」「工期」など)の文字を探し、その右の値のセルを読む。
// 値のセルは、欄名のセル(結合セルならその範囲)の右にある、最初の「文字の入ったセル」か「結合セルの左上」。
// 見つからなければ、欄名のすぐ右のセル。別の欄名に当たったら、そこまでで探すのをやめる。
// 作成例の様式は、右に「《下請負人に関する事項》」の区画があり、同じ欄名(工事名称・工期・会社名など)が並ぶ。
// その見出しのセルから右下は下請負人の区画として、欄名も値も探さない。
// 読めない欄は推測で埋めず、欄ごとに unreadable に挙げる(cause: not_found = 欄が無い、empty = 値が無い、invalid = 値を読めない)。
// 読むのは元請けの7つの欄だけ(工事名・発注者・工期の始めと終わり・請負代金額・会社名・監理技術者/主任技術者の名前)。
// 許可番号・下請負人の欄・保険の欄などは読まない。zip の展開は src/mask/extract.mjs の部品(外の部品は使わない)。
//
// 返り値: { ledger, unreadable: [{ key, field, reason, cause, raw? }], found: { key: { label, value } }, form, sheet }
//   ledger は src/ledger-text.mjs の parseLedgerText と同じ形({ project, prime, subcontractors, warnings })
import { openXlsx, cellValue, colIndex, NOT_OFFICE_HEAD } from './mask/extract.mjs';
import { parseAmount, parseDate, parsePeriod } from './ledger-text.mjs';

const MAX_FILE = 30 * 1024 * 1024;

// 欄名の文字(空白・改行・かっこ「［］[]」を除いたもの)に当てる形
const FIELDS = [
  { id: 'name', keys: ['project.name'], field: '工事名', re: /^工事(名|名称|件名)(及び工事内容)?$/ },
  { id: 'orderer', keys: ['project.orderer'], field: '発注者', re: /^発注者(名)?(及び住所)?$/ },
  { id: 'period', keys: ['project.periodFrom', 'project.periodTo'], field: '工期', re: /^工期$/ },
  { id: 'amount', keys: ['project.contractAmount'], field: '請負代金額', re: /^請負代金(の)?額$/ },
  { id: 'prime', keys: ['prime.name'], field: '会社名', re: /^(会社名|商号|商号又は名称|建設業者名)(・事業者ID)?$/ },
  { id: 'engineer', keys: ['prime.engineer.name'], field: '監理技術者名・主任技術者名', re: /^((監理|主任)技術者(名|氏名)?[・/／]?){1,2}$/ },
];
const FIELD_NAME = {
  'project.name': '工事名',
  'project.orderer': '発注者',
  'project.periodFrom': '工期(始め)',
  'project.periodTo': '工期(終わり)',
  'project.contractAmount': '請負代金額',
  'prime.name': '会社名',
  'prime.engineer.name': '監理技術者名・主任技術者名',
};
export const LEDGER_XLSX_KEYS = Object.keys(FIELD_NAME);
export const FIELD_NAMES = FIELD_NAME;

// 作成例の様式に請負代金額の欄が無いときの理由(2026-11-02 に作る係とは別の進行役が決めた)
export const NO_AMOUNT_IN_SAKUSEIREI = '作成例の様式に請負代金額の欄が無い。契約書面の写しで確かめる';

const normLabel = (s) => String(s ?? '').replace(/[\s［］[\]]/g, '');
const oneLine = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const colName = (i) => { let s = ''; for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };
const refOf = (r, c) => colName(c) + (r + 1);
const parseRef = (ref) => { const m = String(ref).match(/^([A-Z]+)(\d+)$/); return m ? { r: Number(m[2]) - 1, c: colIndex(m[1]) } : null; };

// シートの XML を、セルの表(行 → 列 → 値)と結合セルの範囲にする
function readSheet(xml, shared) {
  const cells = new Map();
  for (const rm of xml.matchAll(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    for (const cm of (rm[1] || '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const tag = '<c ' + cm[1];
      const rf = (tag.match(/\sr\s*=\s*"([A-Z]+\d+)"/) || [])[1];
      const pos = rf && parseRef(rf);
      if (!pos) continue;
      const v = cellValue(tag, cm[2] || '', shared);
      if (v.text === '' && v.number === null) continue;
      if (!cells.has(pos.r)) cells.set(pos.r, new Map());
      cells.get(pos.r).set(pos.c, v);
    }
  }
  const merges = [];
  for (const m of xml.matchAll(/<mergeCell\b[^>]*\bref\s*=\s*"([A-Z]+\d+):([A-Z]+\d+)"/g)) {
    const a = parseRef(m[1]), b = parseRef(m[2]);
    if (a && b) merges.push({ r1: a.r, c1: a.c, r2: b.r, c2: b.c });
  }
  // 下請負人の区画(見出しのセルから右下)。無ければ null
  let subZone = null;
  for (const [r, row] of cells) for (const [c, v] of row) {
    if (/下請負人に関する事項/.test(v.text) && (!subZone || r < subZone.r || (r === subZone.r && c < subZone.c))) subZone = { r, c };
  }
  return { cells, merges, subZone };
}
const inSubZone = (sheet, r, c) => !!sheet.subZone && r >= sheet.subZone.r && c >= sheet.subZone.c;

const cellAt = (sheet, r, c) => sheet.cells.get(r)?.get(c) ?? null;
const mergeAt = (sheet, r, c) => sheet.merges.find((m) => r >= m.r1 && r <= m.r2 && c >= m.c1 && c <= m.c2) ?? null;
const isLabel = (text) => FIELDS.some((f) => f.re.test(normLabel(text)));

// 欄名のセルの右の値のセルの位置
function valueCellOf(sheet, r, c) {
  const own = mergeAt(sheet, r, c);
  const start = (own ? own.c2 : c) + 1;
  const rowCells = sheet.cells.get(r) ?? new Map();
  const lastCol = Math.max(start, ...rowCells.keys(), ...sheet.merges.filter((m) => m.r1 === r).map((m) => m.c2));
  for (let cc = start; cc <= lastCol; cc++) {
    if (inSubZone(sheet, r, cc)) break;
    const v = rowCells.get(cc);
    const m = mergeAt(sheet, r, cc);
    const topLeft = m && m.r1 === r && m.c1 === cc;
    if (m && !topLeft) { cc = m.c2; continue; } // 結合セルの途中(上の行から続くものを含む)は飛ばす
    if (v || topLeft) {
      if (v && isLabel(v.text)) break; // 別の欄名に当たった
      return { r, c: cc };
    }
  }
  return { r, c: start };
}

// 値の読み方
const readText = (v) => oneLine(v ? v.text : '');

function readPeriod(raw) {
  const s = oneLine(raw);
  if (s === '') return { cause: 'empty' };
  if (s.replace(/[自至年月日から〜～~まで\s]/g, '') === '') return { cause: 'empty', template: true };
  // 「自 2026年10月1日 至 2027年3月15日」(作成例の様式の書き方)と「A から B まで」の両方を読む
  const m = s.match(/^自\s*(.*?)\s*至\s*(.*)$/);
  if (m) {
    const from = m[1] === '' ? '' : parseDate(m[1]);
    const to = m[2] === '' ? '' : parseDate(m[2]);
    return { from, to, rawFrom: m[1], rawTo: m[2] };
  }
  const p = parsePeriod(s);
  if (p.error && p.from === p.to) return { from: null, to: null, rawFrom: s, rawTo: s };
  return { from: parseDate(p.from) ?? (p.from === '' ? '' : null), to: parseDate(p.to) ?? (p.to === '' ? '' : null), rawFrom: p.from, rawTo: p.to };
}

// 監理技術者名・主任技術者名の欄: 作成例の様式は同じ欄に「専任・非専任」の文字がある。その語を除いた残りを名前とする
function readEngineer(raw) {
  const rest = oneLine(String(raw ?? '').replace(/非?専\s*任/g, ' '));
  return { name: rest, template: rest === '' && oneLine(raw) !== '' };
}

const set = (obj, key, value) => {
  const ks = key.split('.');
  let o = obj;
  for (const k of ks.slice(0, -1)) o = o[k];
  o[ks.at(-1)] = value;
};

const toBytes = (data) => {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  throw new Error('ファイルの中身が読めません(バイトの並びを渡してください)');
};

// 読めなかったときの文(F84c)。この口で読むのは .xlsx だけなので、部品の「.docx・.xlsx として読めません」は頭の語を言い換え、
// ほかの理由は「: 」でつなぐ。理由と次の手の文は変えない
function notXlsxMessage(e) {
  const reason = String(e?.message ?? e);
  const why = reason.startsWith(NOT_OFFICE_HEAD) ? reason.slice(NOT_OFFICE_HEAD.length) : ': ' + reason.replace(/。?$/, '。');
  return 'Excel(.xlsx)として読めません' + why + '.xls(古い形式)は Excel で .xlsx に保存し直してください。';
}

export async function readLedgerXlsx(data) {
  const bytes = toBytes(data);
  if (bytes.length > MAX_FILE) throw new Error('ファイルが大きすぎます(上限 ' + (MAX_FILE / 1024 / 1024) + 'MB)');
  let book;
  try {
    book = await openXlsx(bytes);
  } catch (e) {
    throw new Error(notXlsxMessage(e));
  }
  const sheets = book.sheets.map((s) => ({ name: s.name, ...readSheet(s.xml, book.shared) }));

  // 欄名のセルを、シートの順・上の行から・左の列から探す。最初に当たったものを使う
  const hits = {};
  let sakuseirei = false;
  let firstSheet = null;
  for (const sh of sheets) {
    for (const r of [...sh.cells.keys()].sort((a, b) => a - b)) {
      const row = sh.cells.get(r);
      for (const c of [...row.keys()].sort((a, b) => a - b)) {
        if (inSubZone(sh, r, c)) continue;
        const text = row.get(c).text;
        if (/施工体制台帳\s*[（(]\s*作成例\s*[）)]/.test(text)) sakuseirei = true;
        const label = normLabel(text);
        for (const f of FIELDS) {
          if (hits[f.id] || !f.re.test(label)) continue;
          hits[f.id] = { sheet: sh, r, c };
          firstSheet ||= sh.name;
        }
      }
    }
  }

  const project = { name: '', place: '', orderer: '', contractAmount: null, periodFrom: '', periodTo: '' };
  const prime = { name: '', licenseNumber: '', licenseType: null, engineer: { role: null, name: '', qualification: '' } };
  const ledger = { project, prime, subcontractors: [], warnings: [] };
  const unreadable = [];
  const found = {};
  const bad = (key, cause, reason, raw) => unreadable.push({ key, field: FIELD_NAME[key], reason, cause, ...(raw ? { raw } : {}) });

  for (const f of FIELDS) {
    const h = hits[f.id];
    if (!h) {
      for (const key of f.keys) {
        const reason = key === 'project.contractAmount' && sakuseirei
          ? NO_AMOUNT_IN_SAKUSEIREI
          : '「' + f.field + '」の欄が見つかりません(欄名の文字が様式の中に無い)';
        bad(key, 'not_found', reason);
      }
      continue;
    }
    const vpos = valueCellOf(h.sheet, h.r, h.c);
    const label = refOf(h.r, h.c), value = refOf(vpos.r, vpos.c);
    for (const key of f.keys) found[key] = { label, value, sheet: h.sheet.name };
    const v = cellAt(h.sheet, vpos.r, vpos.c);
    const where = '(欄名 ' + label + '、値 ' + value + ')';

    if (f.id === 'period') {
      if (v && v.number !== null) { for (const key of f.keys) bad(key, 'invalid', '工期が1つの数で、始めと終わりを読めません' + where, v.text); continue; }
      const p = readPeriod(v ? v.text : '');
      if (p.cause === 'empty') {
        for (const key of f.keys) bad(key, 'empty', (p.template ? '工期の欄に日付が入っていません(様式の雛形の文字だけ)' : '工期の欄が空です') + where);
        continue;
      }
      for (const [key, val, raw, side] of [['project.periodFrom', p.from, p.rawFrom, '始め'], ['project.periodTo', p.to, p.rawTo, '終わり']]) {
        if (val) set(ledger, key, val);
        else if (val === '') bad(key, 'empty', '工期の' + side + 'の日付が空です' + where);
        else bad(key, 'invalid', '工期の' + side + 'の日付を読めません(「自 2026年10月1日 至 2027年3月15日」の形で書いてください)' + where, raw);
      }
      continue;
    }
    const key = f.keys[0];
    if (f.id === 'amount') {
      if (v && v.number !== null) {
        if (Number.isSafeInteger(v.number) && v.number >= 0) set(ledger, key, v.number);
        else bad(key, 'invalid', '請負代金額が円の整数ではありません' + where, v.text);
        continue;
      }
      const raw = readText(v);
      if (raw === '') { bad(key, 'empty', '請負代金額の欄が空です' + where); continue; }
      const a = parseAmount(raw);
      if (a.value === null) bad(key, 'invalid', (a.error || '金額を読めません') + where, raw);
      else set(ledger, key, a.value);
      continue;
    }
    if (f.id === 'engineer') {
      const e = readEngineer(v ? v.text : '');
      if (e.name === '') { bad(key, 'empty', (e.template ? '名前が入っていません(様式の「専任・非専任」の文字だけ)' : '監理技術者名・主任技術者名の欄が空です') + where); continue; }
      prime.engineer.name = e.name;
      const lab = normLabel(cellAt(h.sheet, h.r, h.c).text);
      if (/監理/.test(lab) && !/主任/.test(lab)) prime.engineer.role = 'kanri';
      else if (/主任/.test(lab) && !/監理/.test(lab)) prime.engineer.role = 'shunin';
      else ledger.warnings.push('様式の欄が「監理技術者名・主任技術者名」なので、監理技術者か主任技術者かは決めていません。台帳の文の「監理技術者 氏名」の行で確かめてください');
      continue;
    }
    const raw = readText(v);
    if (raw === '') { bad(key, 'empty', '「' + f.field + '」の欄が空です' + where); continue; }
    set(ledger, key, raw);
  }
  ledger.warnings.push('Excel から読むのは元請けの7つの欄だけです。許可番号・下請負人の欄は読まないので、台帳の文に書き足してください');
  return { ledger, unreadable, found, form: sakuseirei ? 'mlit-sakuseirei' : null, sheet: firstSheet };
}

// 読んだ台帳を、台帳の文(「3-1. 施工体制台帳の点検」に貼る形。src/ledger-text.mjs で読める)にする。読めない欄は値を空にして行を残す
const cellText = (s) => String(s ?? '').replace(/\|/g, '/').replace(/\s+/g, ' ').trim();
const jpDate = (iso) => { const m = String(iso ?? '').match(/^(\d{4})-(\d{2})-(\d{2})$/); return m ? `${Number(m[1])}年${Number(m[2])}月${Number(m[3])}日` : ''; };
export function ledgerToText(ledger) {
  const p = ledger.project, pr = ledger.prime;
  const period = p.periodFrom || p.periodTo ? `${jpDate(p.periodFrom)} から ${jpDate(p.periodTo)} まで` : '';
  const amount = Number.isSafeInteger(p.contractAmount) ? '金 ' + p.contractAmount.toLocaleString('en-US') + '円' : '';
  const role = pr.engineer.role === 'shunin' ? '主任技術者' : '監理技術者';
  return [
    '工事名: ' + cellText(p.name),
    '## 1. 作成建設業者(元請)',
    '| 項目 | 内容 |',
    '|---|---|',
    '| 商号 | ' + cellText(pr.name) + ' |',
    '| 許可番号 |  |',
    '## 2. 発注者との契約',
    '| 項目 | 内容 |',
    '|---|---|',
    '| 発注者 | ' + cellText(p.orderer) + ' |',
    '| 工期 | ' + period + ' |',
    '| 請負代金額 | ' + amount + ' |',
    '## 3. 元請の技術者等',
    '| 項目 | 内容 |',
    '|---|---|',
    '| ' + role + ' 氏名 | ' + cellText(pr.engineer.name) + ' |',
    '| 資格 |  |',
    '## 4. 下請負人(一次)',
    '',
  ].join('\n');
}

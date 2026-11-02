// 台帳の文を読む(F05b): 見出しと「| 項目 | 内容 |」の表で書いた施工体制台帳の文を、点検(src/check-taicho.mjs)の入力の形にする。
// 読めなかった行・値は推測で埋めず、warnings に書いて画面に出す(値は空のまま、または書いてあるまま残す)。
// 発注者が公共か民間か・工事の種類(建築一式か)は、台帳の文からは決めない(画面の選ぶ欄で決める)。
//
// 返り値: { project, prime, subcontractors, warnings }
//   project: { name, place, orderer, contractAmount, periodFrom, periodTo }
//   prime: { name, licenseNumber, licenseType: 'tokutei'|'ippan'|null, engineer: { role, name, qualification } }
//   subcontractors: [{ name, licenseNumber, work, periodFrom, periodTo, amount, engineer: { role, name, qualification } }]

const toHalf = (s) => String(s ?? '').replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
const clean = (s) => String(s ?? '').trim();

// 「金 250,000,000円(税込)」→ 250000000。空なら null。数字で書いていない(「万」など)なら null と注意
export function parseAmount(raw) {
  const s = toHalf(raw).replace(/[(（][^)）]*[)）]/g, '').replace(/^\s*金/, '').replace(/[，,、\s　]/g, '').replace(/円$/, '');
  if (s === '') return { value: null, error: null };
  if (!/^\d+$/.test(s)) return { value: null, error: '金額を読めません(数字と桁区切りで書いてください): ' + clean(raw) };
  const n = Number(s);
  if (!Number.isSafeInteger(n)) return { value: null, error: '金額が大きすぎます: ' + clean(raw) };
  return { value: n, error: null };
}

const z = (n) => String(n).padStart(2, '0');
// 「2026年10月1日」「2026/10/1」「2026-10-01」→ "2026-10-01"。読めなければ null
export function parseDate(raw) {
  const m = toHalf(raw).trim().match(/^(\d{4})\s*[年/\-.]\s*(\d{1,2})\s*[月/\-.]\s*(\d{1,2})\s*日?$/);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return y + '-' + z(mo) + '-' + z(d);
}

// 「A から B まで」「A 〜 B」→ { from, to, error }。読めない側は書いてあるままの文を残す(空ではないので「空」の候補にはしない)
export function parsePeriod(raw) {
  const s = clean(raw);
  if (s === '') return { from: '', to: '', error: null };
  const parts = s.replace(/まで$/, '').split(/\s*(?:から|〜|～|~)\s*/);
  if (parts.length !== 2) return { from: s, to: s, error: '工期を読めません(「2026年10月1日 から 2027年3月15日 まで」の形で書いてください): ' + s };
  const [a, b] = parts.map(clean);
  const from = a === '' ? '' : parseDate(a);
  const to = b === '' ? '' : parseDate(b);
  const bad = [from === null ? a : null, to === null ? b : null].filter(Boolean);
  return { from: from ?? a, to: to ?? b, error: bad.length ? '工期の日付を読めません: ' + bad.join('、') : null };
}

// 許可番号の「(特-06)」「(般-06)」から許可の種類。書いていなければ null
export function licenseTypeOf(num) {
  const s = String(num ?? '');
  if (/[(（]\s*特\s*[-ー－‐]/.test(s)) return 'tokutei';
  if (/[(（]\s*般\s*[-ー－‐]/.test(s)) return 'ippan';
  return null;
}

// 表の1行「| a | b |」→ [a, b]。表の行でなければ null
function tableCells(line) {
  const t = line.trim();
  if (!t.startsWith('|')) return null;
  const cells = t.replace(/^\|/, '').replace(/\|$/, '').split('|').map(clean);
  if (cells.every((c) => /^:?-{2,}:?$/.test(c) || c === '')) return []; // 区切りの行
  return cells;
}

// 見出し「## 1. 作成建設業者(元請)」の種類
function sectionKind(title) {
  if (/下請/.test(title)) return 'subs';
  if (/技術者/.test(title)) return 'primeEngineer';
  if (/発注者/.test(title)) return 'project';
  if (/元請|作成建設業者/.test(title)) return 'prime';
  return 'other';
}

// 下請けの節の見出しから次数を読む。「二次」「三次」など(漢数字・数字)なら 2 以上、「一次」なら 1、書いていなければ null
function tierOf(title) {
  const m = clean(title).match(/([一二三四五六七八九]|[1-9１-９])次/);
  if (!m) return null;
  const d = '一二三四五六七八九'.indexOf(m[1]);
  return d >= 0 ? d + 1 : Number(m[1].replace(/[１-９]/, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)));
}
// 「5-1. 子安防水有限会社(一次: 壬生内装株式会社)」の、注文者を書いたかっこ →「一次: 壬生内装株式会社」。無ければ null
const PARENT_RE = /[(（]\s*((?:[一二三四五六七八九1-9１-９]次|注文者|上位|元方)\s*[:：]\s*[^)）]+)[)）]\s*$/;

const emptyEngineer = () => ({ role: null, name: '', qualification: '' });
// 「4-1. 架空二土木株式会社」→「架空二土木株式会社」
const stripNumber = (t) => clean(t).replace(/^[\d０-９]+(?:[-‐－.．][\d０-９]+)*[.．、)）]?\s*/, '');

// 技術者の行(「監理技術者 氏名」「主任技術者 氏名」「資格」)を入れる。入れたら true
function putEngineer(eng, key, value) {
  if (/技術者/.test(key)) {
    if (/監理技術者/.test(key)) eng.role = 'kanri';
    else if (/主任技術者/.test(key)) eng.role = 'shunin';
    if (/資格/.test(key)) eng.qualification = value; else eng.name = value;
    return true;
  }
  if (/^資格/.test(key)) { eng.qualification = value; return true; }
  return false;
}

export function parseLedgerText(text) {
  const project = { name: '', place: '', orderer: '', contractAmount: null, periodFrom: '', periodTo: '' };
  const prime = { name: '', licenseNumber: '', licenseType: null, engineer: emptyEngineer() };
  const subcontractors = [];
  const warnings = [];
  let kind = 'top';
  let sub = null;
  let sectionTier = null;

  const amountInto = (obj, key, raw, where) => {
    const r = parseAmount(raw);
    obj[key] = r.value;
    if (r.error) warnings.push(where + ': ' + r.error);
  };
  const periodInto = (obj, raw, where) => {
    const r = parsePeriod(raw);
    obj.periodFrom = r.from; obj.periodTo = r.to;
    if (r.error) warnings.push(where + ': ' + r.error);
  };

  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
  lines.forEach((line, i) => {
    const lineNo = i + 1;
    const h = line.match(/^\s*(#{1,6})\s+(.*)$/);
    if (h) {
      const level = h[1].length;
      if (level === 2) { kind = sectionKind(h[2]); sub = null; sectionTier = kind === 'subs' ? tierOf(h[2]) : null; }
      else if (level === 3 && kind === 'subs') {
        let name = stripNumber(h[2]);
        let tier = sectionTier;
        let orderer = '';
        const pm = name.match(PARENT_RE);
        if (pm) { orderer = clean(pm[1]); name = clean(name.slice(0, pm.index)); if (tier === null || tier < 2) tier = 2; }
        // tier: 1 = 元請けが直接結んだ下請け、2 以上 = 再下請け、null = 見出しに書いていない
        sub = { name, licenseNumber: '', work: '', periodFrom: '', periodTo: '', amount: null, engineer: { ...emptyEngineer(), role: 'shunin' }, tier, orderer };
        subcontractors.push(sub);
      }
      return;
    }
    const top = line.match(/^\s*(工事名|工事件名|工事場所)\s*[:：]\s*(.*)$/);
    if (top) { if (/場所/.test(top[1])) project.place = clean(top[2]); else project.name = clean(top[2]); return; }
    const cells = tableCells(line);
    if (cells === null || cells.length === 0) return;
    if (cells.length < 2) { warnings.push(lineNo + '行目: 表の行の欄が足りないので読みませんでした'); return; }
    const [key, value] = [cells[0].replace(/\s+/g, ' '), cells.slice(1).join('|').trim()];
    if (key === '項目' && /内容/.test(value)) return; // 見出しの行
    const where = lineNo + '行目「' + key + '」';
    const unknown = () => warnings.push(where + ': この欄は点検に使っていないので読み飛ばしました');

    if (kind === 'prime') {
      if (/商号|名称/.test(key)) prime.name = value;
      else if (/許可番号/.test(key)) { prime.licenseNumber = value; prime.licenseType = licenseTypeOf(value); }
      else unknown();
    } else if (kind === 'project') {
      if (/^発注者/.test(key)) project.orderer = value;
      else if (/工期/.test(key)) periodInto(project, value, where);
      else if (/請負代金/.test(key)) amountInto(project, 'contractAmount', value, where);
      else unknown();
    } else if (kind === 'primeEngineer') {
      if (!putEngineer(prime.engineer, key, value)) unknown();
    } else if (kind === 'subs') {
      if (!sub) { warnings.push(where + ': 下請けの見出し(### 会社名)の前の行なので読みませんでした'); return; }
      if (/商号|名称/.test(key)) sub.name = value;
      else if (/許可番号/.test(key)) sub.licenseNumber = value;
      else if (/工事(の)?内容/.test(key)) sub.work = value;
      else if (/工期/.test(key)) periodInto(sub, value, where);
      else if (/請負代金/.test(key)) amountInto(sub, 'amount', value, where);
      else if (!putEngineer(sub.engineer, key, value)) unknown();
    } else {
      warnings.push(where + ': どの節(元請・発注者との契約・技術者・下請負人)の行か分からないので読みませんでした');
    }
  });
  if (!prime.licenseType && prime.licenseNumber) warnings.push('元請けの許可番号から許可の種類(特定・一般)を読めませんでした(「(特-06)」「(般-06)」の形で書いてください)');
  if (!prime.name && subcontractors.length === 0) warnings.push('元請けの節(## 作成建設業者(元請))も下請負人の節も見つかりませんでした。台帳の書き方を確かめてください');
  return { project, prime, subcontractors, warnings };
}

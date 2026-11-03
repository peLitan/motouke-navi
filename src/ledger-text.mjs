// 台帳の文を読む(F05b): 見出しと「| 項目 | 内容 |」の表で書いた施工体制台帳の文を、点検(src/check-taicho.mjs)の入力の形にする。
// 読めなかった行・値は推測で埋めず、warnings に書いて画面に出す(値は空のまま、または書いてあるまま残す)。
// 発注者が公共か民間か・工事の種類(建築一式か)は、台帳の文からは決めない(画面の選ぶ欄で決める)。
//
// 返り値: { project, prime, subcontractors, warnings }
//   project: { name, place, orderer, contractAmount, periodFrom, periodTo }
//   prime: { name, licenseNumber, licenseType: 'tokutei'|'ippan'|null, engineer: { role, name, qualification, dedicated } }
//   subcontractors: [{ name, licenseNumber, work, periodFrom, periodTo, amount, engineer: { role, name, qualification, dedicated } }]
//   dedicated: 「専任・非専任」の欄が「専任」なら true、「非専任」なら false、欄が無い・空なら null(読めなければ null とし、warnings に書く)

const toHalf = (s) => String(s ?? '').replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
const clean = (s) => String(s ?? '').trim();

// 「金 250,000,000円(税込)」→ 250000000。空なら null。数字で書いていない(「万」など)なら null と注意
// 括弧の中に「税抜」「税別」「消費税別」「本体」「外税」があれば、額は読まずに null と注意(点検の境目は税込みの額。推測で税込みに直さない)
const TAX_EXCLUDED_RE = /[(（][^)）]*(?:税抜|税別|本体|外税)[^)）]*[)）]/;
export function parseAmount(raw) {
  const ex = toHalf(raw).match(TAX_EXCLUDED_RE);
  if (ex) return { value: null, error: '金額が税抜きの書き方です' + ex[0] + '。点検の境目は消費税を含む額なので、この額は読みません。税込みの額で書いてください: ' + clean(raw) };
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
export function tableCells(line) {
  const t = line.trim();
  if (!t.startsWith('|')) return null;
  const cells = t.replace(/^\|/, '').replace(/\|$/, '').split('|').map(clean);
  if (cells.every((c) => /^:?-{2,}:?$/.test(c) || c === '')) return []; // 区切りの行
  return cells;
}

// 見出し「## 1. 作成建設業者(元請)」の種類
export function sectionKind(title) {
  if (/下請/.test(title)) return 'subs';
  if (/技術者/.test(title)) return 'primeEngineer';
  if (/発注者/.test(title)) return 'project';
  if (/元請|作成建設業者/.test(title)) return 'prime';
  return 'other';
}

// 下請けの節の見出しから次数を読む。「二次」「三次」など(漢数字・数字)なら 2 以上、「一次」なら 1、書いていなければ null
// 「下請負人(一次・二次)」のように違う次数が2つ以上あれば、節の全員の次数は決められないので 'mixed'
export function tierOf(title) {
  const tiers = [...clean(title).matchAll(/([一二三四五六七八九]|[1-9１-９])次/g)].map((m) => {
    const d = '一二三四五六七八九'.indexOf(m[1]);
    return d >= 0 ? d + 1 : Number(m[1].replace(/[１-９]/, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)));
  });
  if (tiers.length === 0) return null;
  return new Set(tiers).size > 1 ? 'mixed' : tiers[0];
}
// 「5-1. 子安防水有限会社(一次: 壬生内装株式会社)」の、注文者を書いたかっこ →「一次: 壬生内装株式会社」。無ければ null
export const PARENT_RE = /[(（]\s*((?:[一二三四五六七八九1-9１-９]次|注文者|上位|元方)\s*[:：]\s*[^)）]+)[)）]\s*$/;

const emptyEngineer = () => ({ role: null, name: '', qualification: '', dedicated: null });

// 「専任・非専任」の欄の値。「専任」→ true、「非専任」→ false、空 → null。それ以外は読めないので null と注意
export function parseDedicated(raw) {
  const s = clean(raw).replace(/[\s　]/g, '');
  if (s === '') return { value: null, error: null };
  if (s === '非専任') return { value: false, error: null };
  if (s === '専任') return { value: true, error: null };
  return { value: null, error: '「専任・非専任」の欄を読めません(「専任」か「非専任」と書いてください): ' + clean(raw) };
}
// 「4-1. 架空二土木株式会社」→「架空二土木株式会社」
export const stripNumber = (t) => clean(t).replace(/^[\d０-９]+(?:[-‐－.．][\d０-９]+)*[.．、)）]?\s*/, '');

// 技術者の行(「監理技術者 氏名」「主任技術者 氏名」「資格」)を入れる。入れたら true
// 「監理技術者補佐」(第26条第3項ただし書 第2号の補佐する者)の行は、監理技術者の欄に入れず eng.assistant に分けて入れる
function putEngineer(eng, key, value, warn, asAssistant = false) {
  if (asAssistant || /補佐/.test(key)) {
    const first = !eng.assistant;
    if (first) eng.assistant = { name: '', qualification: '', dedicated: null };
    if (/専任/.test(key)) { const r = parseDedicated(value); eng.assistant.dedicated = r.value; if (r.error) warn(r.error); }
    else if (/資格/.test(key)) eng.assistant.qualification = value;
    else if (/氏名|補佐/.test(key)) eng.assistant.name = value;
    else return false;
    if (first) warn('監理技術者補佐の行として読みました。監理技術者の氏名・資格・専任の欄には入れていません(補佐する者が要件を満たすかは、このツールは点検しません)');
    return true;
  }
  if (/専任/.test(key)) {
    const r = parseDedicated(value);
    eng.dedicated = r.value;
    if (r.error) warn(r.error);
    return true;
  }
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
  let assistantSection = false; // 「## 監理技術者補佐」のような節の中

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
      if (level === 2) {
        kind = sectionKind(h[2]); sub = null; sectionTier = kind === 'subs' ? tierOf(h[2]) : null;
        assistantSection = kind === 'primeEngineer' && /補佐/.test(h[2]);
        if (sectionTier === 'mixed') warnings.push(lineNo + '行目「' + clean(h[2]) + '」: 見出しに次数が2つ以上あるので、この節の下請けを一次とは数えません。会社名の見出しに「(一次: 注文者の会社名)」のように注文者を書くか、一次と二次の節を分けてください');
      } else if (level === 3 && kind === 'primeEngineer') {
        assistantSection = /補佐/.test(h[2]);
      }
      else if (level === 3 && kind === 'subs') {
        let name = stripNumber(h[2]);
        let tier = sectionTier;
        let orderer = '';
        const pm = name.match(PARENT_RE);
        if (pm) { orderer = clean(pm[1]); name = clean(name.slice(0, pm.index)); if (tier === null || tier === 'mixed' || tier < 2) tier = 2; }
        else if (tier === 'mixed') {
          // 節の見出しで決まらないときは、会社名の見出しの「(一次)」などで決める
          const own = name.match(/[(（]\s*([一二三四五六七八九1-9１-９]次)\s*[)）]\s*$/);
          tier = own ? tierOf(own[1]) : 'mixed';
          if (own) name = clean(name.slice(0, own.index));
        }
        // tier: 1 = 元請けが直接結んだ下請け、2 以上 = 再下請け、null = 見出しに書いていない(一次として数える)
        // tierUnknown: 節の見出しに次数が2つ以上あり、この下請けの次数が決まらない(tier は null。総額の判定では「判断できない」に回す)
        const tierUnknown = tier === 'mixed';
        if (tierUnknown) tier = null;
        sub = { name, licenseNumber: '', work: '', periodFrom: '', periodTo: '', amount: null, engineer: { ...emptyEngineer(), role: 'shunin' }, tier, orderer, ...(tierUnknown ? { tierUnknown: true } : {}) };
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
      if (/^発注者(?!.*(?:住所|所在地|監督))/.test(key)) project.orderer = value;
      else if (/工期/.test(key)) periodInto(project, value, where);
      else if (/請負代金/.test(key)) amountInto(project, 'contractAmount', value, where);
      else unknown();
    } else if (kind === 'primeEngineer') {
      if (!putEngineer(prime.engineer, key, value, (m) => warnings.push(where + ': ' + m), assistantSection)) unknown();
    } else if (kind === 'subs') {
      if (!sub) { warnings.push(where + ': 下請けの見出し(### 会社名)の前の行なので読みませんでした'); return; }
      if (/商号|名称/.test(key)) sub.name = value;
      else if (/許可番号/.test(key)) sub.licenseNumber = value;
      else if (/工事(の)?内容/.test(key)) sub.work = value;
      else if (/工期/.test(key)) periodInto(sub, value, where);
      else if (/請負代金/.test(key)) amountInto(sub, 'amount', value, where);
      else if (!putEngineer(sub.engineer, key, value, (m) => warnings.push(where + ': ' + m))) unknown();
    } else {
      warnings.push(where + ': どの節(元請・発注者との契約・技術者・下請負人)の行か分からないので読みませんでした');
    }
  });
  if (!prime.licenseType && prime.licenseNumber) warnings.push('元請けの許可番号から許可の種類(特定・一般)を読めませんでした(「(特-06)」「(般-06)」の形で書いてください)');
  if (!prime.name && subcontractors.length === 0) warnings.push('元請けの節(## 作成建設業者(元請))も下請負人の節も見つかりませんでした。台帳の書き方を確かめてください');
  return { project, prime, subcontractors, warnings };
}

// 台帳の文の表の行を、節と下請けごとに書いてあるまま集める(F16b の記載事項の点検で使う)。
// parseLedgerText と違い、点検に使わない欄も捨てない。値の読み替え(金額・日付)はしない。
// 返り値: { top: [{ key, value, line }], sections: [{ kind, title, tier, rows, subs: [{ name, title, tier, orderer, rows }] }] }
//   top は最初の節の前の「工事名: …」のような行。tier は tierOf の値(下請けの見出しに「(一次: 会社名)」があれば 2 以上)
//   下請けの節でない節の中の「### 監理技術者補佐」のような小見出しの下の行には group(小見出しの文)を付ける(F29a)
export function ledgerRows(text) {
  const top = [];
  const sections = [];
  let sec = null;
  let sub = null;
  let group = '';
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
  lines.forEach((line, i) => {
    const lineNo = i + 1;
    const h = line.match(/^\s*(#{1,6})\s+(.*)$/);
    if (h) {
      const level = h[1].length;
      if (level === 2) {
        const kind = sectionKind(h[2]);
        sec = { kind, title: clean(h[2]), tier: kind === 'subs' ? tierOf(h[2]) : null, rows: [], subs: [] };
        sections.push(sec); sub = null; group = '';
      } else if (level === 3 && sec && sec.kind !== 'subs') {
        group = clean(h[2]);
      } else if (level === 3 && sec && sec.kind === 'subs') {
        let name = stripNumber(h[2]);
        let tier = sec.tier;
        let orderer = '';
        const pm = name.match(PARENT_RE);
        if (pm) { orderer = clean(pm[1]); name = clean(name.slice(0, pm.index)); if (tier === null || tier === 'mixed' || tier < 2) tier = 2; }
        sub = { name, title: clean(h[2]), tier, orderer, rows: [] };
        sec.subs.push(sub);
      }
      return;
    }
    if (!sec) {
      const m = line.match(/^\s*([^:：|#]{1,20}?)\s*[:：]\s*(.*)$/);
      if (m) top.push({ key: clean(m[1]), value: clean(m[2]), line: lineNo });
      return;
    }
    const cells = tableCells(line);
    if (cells === null || cells.length < 2) return;
    const key = cells[0].replace(/\s+/g, ' ');
    const value = cells.slice(1).join('|').trim();
    if (key === '項目' && /内容/.test(value)) return;
    (sub ?? sec).rows.push({ key, value, line: lineNo, ...(group && !sub ? { group } : {}) });
  });
  return { top, sections };
}

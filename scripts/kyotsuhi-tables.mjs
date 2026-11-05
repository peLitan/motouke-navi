// 公共建築工事共通費積算基準の文から、別表の式・係数・範囲を機械で読む(F44e)。作る側の道具で、画面には入らない
// 係数は手で書かない。data/kyotsuhi-rates.json はこの読み取りの結果で、check-quotes が読み直して同じか見る
import { pageOf } from '../src/kind-schedule-check.mjs';

export const SOURCE_ID = 'mlit-kyotsuhi-r8';
export const DOC = '公共建築工事共通費積算基準(令和8年改定)';

const nfkc = (s) => s.normalize('NFKC').trim();
const num = (s) => Number(s.replace(/,/g, ''));
const HEAD = /^別表-(\d+) (共通仮設費率|現場管理費率)\((.+)\)$/;
const FORMULA = /^(Kr|Jo)=Exp\(\s*([\d.]+) - ([\d.]+) × loge\s*(P|Np)(?:\s*\+ ([\d.]+) × loge\s*T)?\s*\)$/;
const RANGE = /^([\d,]+)\(千円\) ≦ (P|Np) ≦ ([\d,]+)\(千円\)$/;

// 率の別表1〜14。1つの表は 見出し → 式 → 範囲 の順に並ぶ
export function parseRateTables(text) {
  const tables = [];
  let page = null;
  let open = null;
  for (const raw of text.split('\n')) {
    const mark = /^--- PDF の (\d+) ページ ---$/.exec(raw);
    if (mark) { page = Number(mark[1]); continue; }
    const line = nfkc(raw);
    const head = HEAD.exec(line);
    if (head) {
      open = { no: Number(head[1]), name: head[2], work: head[3], page };
      tables.push(open);
      continue;
    }
    if (!open) continue;
    const f = FORMULA.exec(line);
    if (f) Object.assign(open, { a: Number(f[2]), b: Number(f[3]), c: f[5] ? Number(f[5]) : null, variable: f[4], quote: raw.trim() });
    const r = RANGE.exec(line);
    if (r) Object.assign(open, { min: num(r[1]), max: num(r[3]), rangeQuote: raw.trim() });
  }
  tables.forEach((t, i) => {
    if (t.no !== i + 1) throw new Error('別表の番号が続いていない: ' + t.no);
    if (!(t.a > 0 && t.b > 0 && t.quote && t.min > 0 && t.max > t.min && t.rangeQuote)) throw new Error('別表-' + t.no + ' の式か範囲が読めない');
    if ((t.name === '共通仮設費率') !== (t.variable === 'P')) throw new Error('別表-' + t.no + ' の変数が表の名前と合わない');
  });
  if (tables.length !== 14) throw new Error('率の別表の数が14でない: ' + tables.length);
  return tables;
}

const yenWord = (s) => {
  const m = /^(\d+)(百万円|億円)/.exec(s);
  if (!m) throw new Error('額の語が読めない: ' + s);
  return Number(m[1]) * (m[2] === '百万円' ? 1000 : 100000); // 千円
};

// 別表15(一般管理費等率)。額の区切り・両端の率・算定式を読む。全角で書かれている
export function parseGeneralAdmin(text) {
  const body = text.split('\n');
  const find = (re) => {
    const raw = body.find((l) => re.test(nfkc(l)));
    if (raw === undefined) throw new Error('別表15の行が無い: ' + re);
    return { raw: raw.trim(), m: re.exec(nfkc(raw)) };
  };
  const cols = find(/^工事原価 (\S+以下) \S+ (\S+を超える)$/);
  const pct = find(/^一般管理費等率 ([\d.]+)% \S+ ([\d.]+)%$/);
  const eq = find(/^Gp=([\d.]+)-([\d.]+)× log10 \(Cp\)$/);
  return {
    lower: yenWord(cols.m[1]), upper: yenWord(cols.m[2]),
    rateLow: Number(pct.m[1]), rateHigh: Number(pct.m[2]),
    a: Number(eq.m[1]), b: Number(eq.m[2]),
    quote: eq.raw, rangeQuote: cols.raw, rateQuote: pct.raw, page: pageOf(text, eq.raw),
  };
}

// 計算の前提として利用者に見せる原文の文。text は言い換え、quote は原文のまま
const NOTES = [
  ['burden', '共通費を算定する場合の直接工事費には、本設のための電力、水道等の各種負担金は含まないものとする。', '直接工事費に、本設のための電力・水道等の各種負担金を入れないでください'],
  ['disposal-p', '共通仮設費率を算定する場合の直接工事費には、処分費を含まないものとする。', '処分費は共通仮設費率の計算の直接工事費から除きます。処分費は conditions.disposal に入れてください'],
  ['disposal-np', '現場管理費率を算定する場合の純工事費には、処分費を含まないものとする。', '処分費は現場管理費率の計算の純工事費からも除きます'],
  ['area', '本表の共通仮設費率は、施工場所が一般的な市街地の比率である。', '共通仮設費率は施工場所が一般的な市街地の比率です'],
  ['area-np', '本表の現場管理費率は、施工場所が一般的な市街地の比率である。', '現場管理費率も施工場所が一般的な市街地の比率です'],
  ['excluded', '設計図書に基づく以下の費用は含まれない。', '設計図書に基づく現場環境改善費・工事場所以外の屋外整理清掃費・新たな施策等の試行による特別な費用は、共通仮設費率に入っていません'],
  ['single-order', '昇降機設備工事を除く製造業者・専門工事業者に単独発注する場合は、別途共通仮設費を算定する。', '製造業者・専門工事業者に単独で発注する工事(昇降機設備工事を除く)は、共通仮設費を別途算定します'],
  ['single-order-site', '昇降機設備工事を除く製造業者・専門工事業者に単独発注する場合は、別途現場管理費を算定する。', '同じ場合は、現場管理費も別途算定します'],
  ['single-order-admin', '昇降機設備工事を除く製造業者・専門工事業者に単独発注する場合は、別途一般管理費等を算定する。', '同じ場合は、一般管理費等も別途算定します'],
  ['guarantee', 'なお、契約保証費については、必要に応じて別途加算する。', '契約保証費は入れていません。必要なら別途足します'],
];

export function parseNotes(text) {
  return NOTES.map(([id, quote, say]) => {
    const page = pageOf(text, quote);
    if (page === null) throw new Error('前提の文が原文に無い: ' + id);
    return { id, quote, say, page };
  });
}

export const buildRates = (text) => ({ tables: parseRateTables(text), generalAdmin: parseGeneralAdmin(text), notes: parseNotes(text) });

// data/kyotsuhi-rates.json の点検。原文から読み直して全部同じか見る。行の id ごとの不一致を返す
export function checkKyotsuhi(data, text) {
  if (!text) return ['原文が無い: ' + data.sourceId];
  const errors = [];
  let fresh;
  try { fresh = buildRates(text); } catch (e) { return [e.message]; }
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  fresh.tables.forEach((t, i) => { if (!same(t, data.tables[i])) errors.push('別表-' + t.no + ': 原文から読んだ値と違う'); });
  if (data.tables.length !== fresh.tables.length) errors.push('別表の数が原文と違う: ' + data.tables.length);
  if (!same(fresh.generalAdmin, data.generalAdmin)) errors.push('別表-15: 原文から読んだ値と違う');
  fresh.notes.forEach((n, i) => { if (!same(n, data.notes[i])) errors.push(n.id + ': 原文から読んだ値と違う'); });
  if (data.notes.length !== fresh.notes.length) errors.push('前提の文の数が違う: ' + data.notes.length);
  return errors;
}

// 根拠の原文の「取得した日」と「版」(何年何月時点の条文・資料か)の書き方(F28d)。
// 値は data/sources/index.json の行から取る。推測で版を作らない:
// - 法令: e-Gov の revisionId(法令ID_施行日_改正の法令番号)の施行日の部分から「YYYY年M月D日施行の改正までの条文」とする
// - 国交省の資料: index.json の edition(資料に書いてある版の表示)をそのまま出す
// - どちらも無いときは「版の表示なし」とし、取得日だけを頼りにするよう出す
export const NO_VERSION = '版の表示なし';

// revisionId から施行日を取り出す。形が違えば null
export function revisionDate(revisionId) {
  const m = /^[0-9A-Z]+_(\d{4})(\d{2})(\d{2})_/.exec(String(revisionId ?? ''));
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return { y, m: mo, d };
}

// 出典の行(index.json の1行、または同じ形の値)→ 版の文。無ければ NO_VERSION
export function sourceVersion(s = {}) {
  const r = revisionDate(s.revisionId);
  if (r) return r.y + '年' + r.m + '月' + r.d + '日施行の改正までの条文(e-Gov の版 ' + s.revisionId + ')';
  if (s.edition) return s.edition + ' の版';
  return NO_VERSION;
}

// 抜き書きの近くに出す1行: 「取得日 2026-11-02・版 2025年12月12日施行の改正までの条文(…)」
export function versionText(b = {}) {
  return '取得日 ' + (b.fetchedAt || '不明') + '・版 ' + (b.version || NO_VERSION);
}

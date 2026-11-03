// 画面の「段取りの表を読み込む」(F26b)。Skill spec-to-rules が作った行のファイル(照合で残った行)を読み、形を確かめる。
// 画面の中で原文とは照らさない(原文はファイルに入っていない)。読んだ表はメモリだけに持ち、保存しない。
export const RULES_MAX_BYTES = 1024 * 1024;
export const UNDETERMINED = '判断できない';
const PHASES = ['start', 'work', 'completion', UNDETERMINED];

const text = (v) => (typeof v === 'string' && v.trim() ? v : null);

// 1行の形の誤りを返す(無ければ null)。ファイルの中身の文は理由に入れない
function rowProblem(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return '行の形ではありません';
  if (row.kind !== 'plan-item' && row.kind !== 'schedule') return '種類(kind)が plan-item でも schedule でもありません';
  const need = row.kind === 'schedule' ? ['when', 'what', 'to', 'section', 'quote'] : ['label', 'section', 'quote'];
  for (const k of need) if (!text(row[k])) return k + ' がありません';
  if (row.kind === 'schedule' && !PHASES.includes(row.phase)) return '段(phase)が start・work・completion・判断できない のどれでもありません';
  const why = row.undetermined && typeof row.undetermined === 'object' ? row.undetermined : {};
  for (const [k, v] of Object.entries(row)) {
    if (v === UNDETERMINED && !text(why[k])) return k + ' が「判断できない」なのに理由(undetermined.' + k + ')がありません';
  }
  return null;
}

// text: ファイルの中身。返り値: { source, schedule, planItems, count }。読めないときは理由つきの Error を投げる
export function parseRulesFile(fileText) {
  let data;
  try {
    data = JSON.parse(String(fileText ?? ''));
  } catch {
    throw new Error('JSON のファイルとして読めません');
  }
  if (!data || typeof data !== 'object' || !Array.isArray(data.rows)) throw new Error('行の一覧(rows)がありません。spec-to-rules の check-rows.mjs --out で書いたファイルを選んでください');
  if (data.rows.length === 0) throw new Error('行が1つもありません');
  const s = data.source;
  if (!s || typeof s !== 'object') throw new Error('出典(source)がありません。出典の分からない表は読み込みません');
  for (const [k, label] of [['publisher', '発注者'], ['title', '題名'], ['edition', '版']]) {
    if (!text(s[k])) throw new Error('出典の' + label + '(source.' + k + ')がありません');
  }
  const ids = new Set();
  data.rows.forEach((row, i) => {
    const p = rowProblem(row);
    if (p) throw new Error((i + 1) + '行目: ' + p);
    if (row.kind !== 'schedule' || row.id == null) return;
    if (ids.has(row.id)) throw new Error((i + 1) + '行目: id が重なっています');
    ids.add(row.id);
  });
  return {
    source: { publisher: s.publisher, title: s.title, edition: s.edition, url: text(s.url) ?? '', fetchedAt: text(s.fetchedAt) ?? '' },
    schedule: data.rows.filter((r) => r.kind === 'schedule'),
    planItems: data.rows.filter((r) => r.kind === 'plan-item'),
    count: data.rows.length,
  };
}

export const tableName = (table) => table.source.publisher + '「' + table.source.title + '」';

// 画面の注記の文。残った行の数はファイルの行の数(照合で外した行は --out に入らない)
export function tableNotice(table) {
  const s = table.source;
  return 'この表はツールの外で原文と照合済み(残った行 ' + table.count + '行)。画面では原文と照らしていません(ファイルが照合を通ったものかも、画面では確かめられません)。'
    + '出典: 発注者 ' + s.publisher + '・題名 ' + s.title + '・版 ' + s.edition + (s.url ? '・' + s.url : '');
}

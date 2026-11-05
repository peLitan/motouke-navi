// 画面の「公告から拾った条件を読み込む」(F41a): Skill bid-intake の check-conditions.mjs --out のファイルを読む。
// 通信しない。保存しない。入れるのは、確かめが要らなかった値だけ。
export const INTAKE_MAX_BYTES = 1024 * 1024;
const OK = '拾えた';
// 画面の欄 → 値の確かめと、値の元の行
const FIELDS = {
  orderer: { row: 'orderer-name', valid: (v) => v === 'public' || v === 'private' },
  'work-type': { row: 'work-class', valid: (v) => v === 'kenchiku-ikkatsu' || v === 'other' },
  'contract-amount': { row: 'budget', valid: (v) => /^[0-9]{1,15}$/.test(v) },
};

const list = (v, name) => {
  if (v == null) return [];
  if (!Array.isArray(v)) throw new Error(name + ' の形が違います');
  return v;
};

export function parseIntakeFile(text) {
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('JSON として読めません'); }
  if (data?.kind !== 'bid-intake') throw new Error('公告から拾った条件のファイルではありません(公告を読んだ AI がまとめた条件のファイルを選んでください)');
  const title = data.source?.title;
  if (typeof title !== 'string' || !title.trim()) throw new Error('公告の題名がありません');
  const rows = list(data.rows, 'rows');
  const form = {};
  for (const [id, value] of Object.entries(data.form ?? {})) {
    const f = Object.hasOwn(FIELDS, id) ? FIELDS[id] : null;
    if (!f) throw new Error('画面に無い欄です: ' + id);
    if (typeof value !== 'string' || !f.valid(value)) throw new Error('欄 ' + id + ' の値が違います');
    if (!rows.some((r) => r?.key === f.row && r.status === OK)) throw new Error('欄 ' + id + ' の元の値が「' + OK + '」ではありません');
    form[id] = value;
  }
  // 入力の確かめ(F43d)に出す、欄の値の元の抜き書き
  const quotes = Object.fromEntries(Object.keys(form).map((id) => [id, String(rows.find((r) => r?.key === FIELDS[id].row && r.status === OK)?.quote ?? '')]));
  return { title, form, quotes, rows, skipped: list(data.formSkipped, 'formSkipped'), company: list(data.companyFields, 'companyFields') };
}

// 読み込んだあとに人が見る行
export function intakeLines(t) {
  const lines = [];
  for (const r of t.rows) {
    if (r?.status === '確かめが要る') lines.push('確かめが要る ' + r.label + ': ' + (r.flags ?? []).join(' / '));
    if (r?.status === '公告に書いていない') lines.push('公告に書いていない ' + r.label);
  }
  for (const s of t.skipped) lines.push('入れなかった ' + s.label + ': ' + s.reason);
  for (const c of t.company) lines.push('公告からは分からない ' + c.label + ': ' + c.reason);
  return lines;
}

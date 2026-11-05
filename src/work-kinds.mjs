// 工種の一覧(F44a)。建設業法施行令 第37条の技術検定の7種目に合わせる。建設機械施工は専用の仕様書が無いので土木にまとめる。
// tables は工種が持つ表(部分の名前 → 出典の id)。表が無い部分は「見ていない」と出す。無い表を別の工種の表で埋めない。
// Skill(plugin)からも読むので、データを import しない。表そのものは work-kind-tables.mjs が持つ
export const DEFAULT_WORK_KIND = 'doboku';
export const NOT_READ = 'この工種の仕様書は見ていない';
export const ALWAYS_SHOWN = '法令の判定・安全の法令の候補・公告の読みは工種を問わず出します';

export const WORK_KINDS = [
  { id: 'doboku', label: '土木(建設機械施工を含む)', tables: { schedule: 'mlit-doboku-spec-r8', plan: 'mlit-doboku-spec-r8', estimate: 'mlit-sekisan-unyou-r8' } },
  { id: 'kenchiku', label: '建築', tables: { schedule: 'mlit-kenchiku-spec-r7' } },
  { id: 'denki', label: '電気工事', tables: {} },
  { id: 'kan', label: '管工事', tables: {} },
  { id: 'tsushin', label: '電気通信工事', tables: {} },
  { id: 'zoen', label: '造園', tables: {} },
  { id: 'other', label: 'その他', tables: {} },
];

export const isWorkKind = (id) => WORK_KINDS.some((k) => k.id === id);
// 知らない値・空は既定の土木
export const workKindOf = (id) => WORK_KINDS.find((k) => k.id === id) ?? WORK_KINDS.find((k) => k.id === DEFAULT_WORK_KIND);
export const workKindLabel = (id) => workKindOf(id).label;
export const hasKindTable = (id, part) => Boolean(workKindOf(id).tables[part]);

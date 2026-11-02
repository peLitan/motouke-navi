// F06a・F06b の共通部品: 段取りの行の形と、共通仕様書の根拠の照合
import assert from 'node:assert/strict';
import { loadSources, quoteInText } from './_helpers.mjs';

export const CONDS = [
  { orderer: 'public', direct: true, workType: 'other', contractAmount: 300000000, hasSubcontract: true, subcontractTotal: 60000000, license: 'tokutei', engineerQualification: 'kanri', ictMeasure: false },
  { orderer: 'public', direct: true, workType: 'other', contractAmount: 30000000, hasSubcontract: false, subcontractTotal: 0, license: 'ippan', engineerQualification: 'shunin', ictMeasure: false },
];

export function specSource(src, id) {
  const s = src.byId[id];
  assert.ok(s, '出典が無い: ' + id);
  assert.ok(s.kind === 'document' && /土木工事共通仕様書/.test(s.title) && /令和8年3月/.test(s.title), '共通仕様書(案)令和8年3月版でない: ' + s.title);
  assert.ok(new URL(s.url).hostname.endsWith('mlit.go.jp'));
  assert.ok(src.texts[id], '共通仕様書の原文のファイルが無い');
  return s;
}

export function assertRow(row, src) {
  for (const k of ['when', 'what', 'to']) assert.ok(typeof row[k] === 'string' && row[k].trim(), `「${k}」が空の行: ` + JSON.stringify(row));
  const b = row.basis;
  assert.ok(b && /土木工事共通仕様書/.test(b.doc) && /令和8年3月/.test(b.doc), '根拠の資料名が無い');
  assert.match(String(b.section), /^\d+-\d+-\d+-\d+/, '該当箇所の番号が無い');
  specSource(src, b.sourceId);
  assert.ok(quoteInText(b.quote, src.texts[b.sourceId]), '共通仕様書の原文に無い抜き書き: ' + b.quote);
}

export { loadSources };

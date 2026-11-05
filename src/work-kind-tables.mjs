// 工種ごとの表と、その出典・版・取得日(F44a)。どの工種がどの表を使うかは work-kinds.mjs の tables の id で決まる
import scheduleData from '../data/schedule.json' with { type: 'json' };
import kenchikuSchedule from '../data/schedule-kenchiku.json' with { type: 'json' };
import denkiSchedule from '../data/schedule-denki.json' with { type: 'json' };
import kanSchedule from '../data/schedule-kan.json' with { type: 'json' };
import planData from '../data/plan-items.json' with { type: 'json' };
import estimateRates from '../data/estimate-rates.json' with { type: 'json' };
import sourcesData from '../data/sources/index.json' with { type: 'json' };
import { sourceVersion } from './source-version.mjs';
import { NOT_READ, ALWAYS_SHOWN, hasKindTable, workKindOf, workKindLabel } from './work-kinds.mjs';

// [表の id, 部分] → 表。表が足されたら、ここに行を足す
const TABLES = {
  'mlit-doboku-spec-r8': { schedule: scheduleData, plan: planData },
  'mlit-kenchiku-spec-r7': { schedule: kenchikuSchedule },
  'mlit-denki-spec-r7': { schedule: denkiSchedule },
  'mlit-kikai-spec-r7': { schedule: kanSchedule },
  'mlit-sekisan-unyou-r8': { estimate: estimateRates },
};
const PART_LABEL = { schedule: '段取りの表', plan: '施工計画書の記載項目', estimate: '積算の表' };

export const kindTable = (id, part) => (hasKindTable(id, part) ? TABLES[workKindOf(id).tables[part]][part] : null);

// 出典の1件: { title, version, fetchedAt, url }。表が無ければ null
export function kindSource(id, part) {
  const table = kindTable(id, part);
  if (!table) return null;
  if (part === 'estimate') {
    const s = table.source;
    return { title: s.title, version: sourceVersion({ edition: s.applied + ' から適用' }), fetchedAt: s.fetchedAt, url: s.url };
  }
  const s = sourcesData.sources.find((x) => x.id === table.sourceId);
  if (!s) throw new Error('工種の表: 出典が無い: ' + table.sourceId);
  return { title: table.doc, version: sourceVersion(s), fetchedAt: s.fetchedAt, url: s.url };
}

// 画面・印刷・CSV の1文
export function kindSourceText(id, part) {
  const s = kindSource(id, part);
  const head = '工種: ' + workKindLabel(id) + '。';
  if (!s) return head + NOT_READ + 'ので、' + PART_LABEL[part] + 'はありません。' + ALWAYS_SHOWN + '。';
  return head + PART_LABEL[part] + 'の出典: ' + s.title + '(取得日 ' + s.fetchedAt + '・版 ' + s.version + ')。';
}

// F44h: 説明の「読めた n 種目」と行数を、工種の一覧と表の実物から数えて確かめる。見ていない範囲が消えていないことも見る
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { WORK_KINDS } from '../../src/work-kinds.mjs';
import { checkKindSchedule } from '../../src/kind-schedule-check.mjs';

const read = (p) => fs.readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const json = (p) => JSON.parse(read(p));
const DOCS = ['README.md', 'docs/overview.md', 'docs/manual.md', 'plugin/skills/bid-intake/SKILL.md'];

// 工種ごとの段取りの表。原文のファイルは土木だけ別の点検(check-quotes の条ごとの照合)なので null
const TABLES = {
  doboku: ['data/schedule.json', null],
  kenchiku: ['data/schedule-kenchiku.json', 'data/sources/mlit-kenchiku-spec-r7-ch1.txt'],
  denki: ['data/schedule-denki.json', 'data/sources/mlit-denki-spec-r7-ch1.txt'],
  kan: ['data/schedule-kan.json', 'data/sources/mlit-kikai-spec-r7-ch1.txt'],
  tsushin: ['data/schedule-tsushin.json', 'data/sources/mlit-tsushin-spec-r8-ch1.txt'],
};

// 読めた種目: 段取りの表の出典がその工種のもので、ほかの工種の出典を借りていない工種。造園は土木の出典を借りるので入らない
const owners = (source) => WORK_KINDS.filter((k) => k.tables.schedule === source);
const read5 = WORK_KINDS.filter((k) => k.tables.schedule && owners(k.tables.schedule)[0].id === k.id);

test('読めた種目は工種の一覧から数えて土木・建築・電気工事・管工事・電気通信工事で、造園とその他は入らない', () => {
  assert.deepEqual(read5.map((k) => k.id), Object.keys(TABLES));
});

test('説明の種目の数と行数が実物と合う', () => {
  const n = read5.length;
  const rows = read5.map((k) => json(TABLES[k.id][0]).rules.length).join('・');
  for (const file of DOCS) {
    const text = read(file);
    assert.ok(text.includes(`7種目のうち仕様書を読めた${n}種目は、${read5.map((k) => k.label.replace(/[((].*$/, '')).join('・')}`), file);
    assert.ok(text.includes(`段取りの行は順に ${rows} 行`), file);
  }
});

test('数えた行は全部、原文の箇所の中で照らせる', () => {
  for (const [id, [table, source]] of Object.entries(TABLES)) {
    if (source) assert.deepEqual(checkKindSchedule(json(table), read(source)), [], id);
  }
});

test('見ていない範囲を4つの文書に書き、言い過ぎの語を書かない', () => {
  for (const file of DOCS) {
    const text = read(file);
    for (const word of ['許可の29業種のうちほかの業種', '改修の仕様書の本文', '電気通信工事の共通費', '機械の共通費のうち管工事の機械設備工事の別表に当たらないもの']) {
      assert.ok(text.includes(word), `${file}: ${word}`);
    }
    assert.ok(!text.includes('あらゆる公共工事'), file);
  }
  assert.ok(!read('index.html').includes('あらゆる公共工事'));
});

test('公開の説明の抜き書きの件数が同じ日の数にそろっている', () => {
  for (const file of ['README.md', 'docs/overview.md']) assert.match(read(file), /規則表の抜き書き 345 件が原文にある/, file);
});

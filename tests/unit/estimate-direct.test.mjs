// F42a の単体の試験: 積算単価の補正と積み上げ。計算例の値は標準単価表の通知 Ⅱ-2 の例(通知の中でも仮想の値)
import test from 'node:test';
import assert from 'node:assert/strict';
import { correctedPrice, roundUp4, directCost } from '../../src/estimate/direct.mjs';
import { estimate } from '../../src/estimate/estimate.mjs';

const ROW = {
  price: 51343, K: 2.53, K1: 1.30, K2: 0.38, K3: 0.31,
  R: 52.27, R1: 19.29, R2: 11.73, R3: 4.41, R4: 1.16,
  Z: 45.20, Z1: 42.51, Z2: 1.90, Z3: 0.72, Z4: null, S: null,
  names: { K1: 'ポンプ車', K2: '発電機', K3: 'ヒータ', R1: '普通作業員', R2: '型わく工', R3: '土木一般世話役', R4: '特殊作業員', Z1: '生コンクリート', Z2: '灯油', Z3: '軽油' },
};
const LABOR = {
  base: { 普通作業員: 26800, 型わく工: 31700, 土木一般世話役: 32400, 特殊作業員: 29900 },
  local: { 普通作業員: 23800, 型わく工: 33400, 土木一般世話役: 30800, 特殊作業員: 27800 },
};
const MACHINE = { K1: { base: 52800, local: 52800 }, K2: { base: 910, local: 991 }, K3: { base: 747, local: 747 } };
const MATERIAL = { Z1: { base: 21400, local: 25700 }, Z2: { base: 99.5, local: 99.7 }, Z3: { base: 148, local: 132 } };

test('通知の計算例①と一致する(54,377.531734 → 有効数字4桁で切り上げ 54,380)', () => {
  const c = correctedPrice(ROW, { labor: LABOR, manual: { ...MACHINE, ...MATERIAL } });
  assert.ok(Math.abs(c.exact - 54377.531734) < 0.0001, String(c.exact));
  assert.equal(c.price, 54380);
  assert.equal(c.humanFields.length, 0);
  assert.equal(c.uncorrectedPercent, 0);
});

test('通知の計算例②と一致する(代表材料の単価を人が入れる。55,981.262004)', () => {
  const c = correctedPrice(ROW, { labor: LABOR, manual: { ...MACHINE, ...MATERIAL, Z1: { base: 21400, local: 27270 } } });
  assert.ok(Math.abs(c.exact - 55981.262004) < 0.0001, String(c.exact));
});

test('通知の計算例③と一致する(実数入力の例。2,058.7720150)', () => {
  const row = { price: 1531.1, K: 1.94, K1: 1.30, K2: 0.26, K3: 0.24, R: 15.12, R1: 5.40, R2: 3.71, R3: 3.65, R4: 1.24, Z: 82.94, Z1: 80.11, Z2: 2.56, Z3: 0.25, S: null, names: {} };
  const manual = {
    K1: { base: 14800, local: 15000 }, K2: { base: 3540, local: 3540 }, K3: { base: 3250, local: 3310 },
    R1: { base: 21500, local: 19000 }, R2: { base: 24600, local: 21600 }, R3: { base: 24200, local: 21800 }, R4: { base: 24700, local: 23700 },
    Z1: { base: 487500, local: 707000 }, Z2: { base: 91.5, local: 91 }, Z3: { base: 116, local: 110 },
  };
  const c = correctedPrice(row, { manual });
  assert.ok(Math.abs(c.exact - 2058.772015) < 0.00001, String(c.exact));
  assert.equal(c.price, 2059);
});

test('有効数字4桁、5桁目以降切り上げ', () => {
  assert.equal(roundUp4(54377.53), 54380);
  assert.equal(roundUp4(54380), 54380);
  assert.equal(roundUp4(1234.01), 1235);
  assert.equal(roundUp4(690.4707), 690.5);
  assert.equal(roundUp4(12.3401), 12.35);
  assert.equal(roundUp4(0), 0);
});

test('補正の欄は、人が入れるまで空で残り、比 1 で計算する', () => {
  const c = correctedPrice(ROW, { labor: LABOR });
  assert.deepEqual(c.humanFields.map((f) => f.key), ['K1', 'K2', 'K3', 'Z1', 'Z2', 'Z3']);
  for (const f of c.humanFields) { assert.equal(f.base, null); assert.equal(f.local, null); }
  assert.equal(c.applied.filter((a) => a.from === '公共工事設計労務単価').length, 4);
  // 労務の分だけ変わる: 他の群は比 1
  const none = correctedPrice(ROW, {});
  assert.ok(Math.abs(none.exact - 51343) < 1e-6); // 構成比の計が 100 なら標準単価のまま
  assert.equal(none.uncorrectedPercent, 100);
  assert.ok(Math.abs(c.correctedPercent - 52.27) < 1e-9);
  assert.ok(Math.abs(c.uncorrectedPercent - 47.73) < 1e-9);
});

test('労務単価に無い職種は補正せず空の欄に出す。「*」の付いた職種は同じ職種で補正する', () => {
  const row = { price: 1000, K: 0, R: 100, R1: 60, R2: 40, Z: 0, S: null, names: { R1: '*普通作業員', R2: '架空の職種' } };
  const c = correctedPrice(row, { labor: { base: { 普通作業員: 20000 }, local: { 普通作業員: 22000 } } });
  assert.deepEqual(c.humanFields.map((f) => f.key), ['R2']);
  assert.equal(c.applied[0].ratio, 1.1);
});

test('市場単価は人が入れれば補正し、入れなければ空のまま', () => {
  const row = { price: 1000, K: null, R: null, Z: null, S: 100, names: { S: '市場単価の例' } };
  assert.deepEqual(correctedPrice(row).humanFields.map((f) => f.key), ['S']);
  assert.equal(correctedPrice(row, { manual: { S: { base: 100, local: 110 } } }).price, 1100);
});

const PKG = { no: 1, name: '架空のパッケージ', unit: 'ｍ３' };
const hit = (row = ROW) => ({ package: PKG, row: { ...row, condition: '架空の条件', page: 99 } });

test('パッケージに無い行・単位が合わない行は合計に入らない', () => {
  const r = directCost([
    { name: '当たる行', quantity: 10, unit: 'm3', match: hit() },
    { name: '歩掛の工種', quantity: 5, unit: 'm3', match: null },
    { name: '単位が違う', quantity: 5, unit: 'm2', match: hit() },
    { name: '材料費の表', quantity: 5, unit: 'm3', match: { package: PKG, row: null } },
    { name: '数量なし', quantity: null, unit: 'm3', match: hit() },
  ], { labor: LABOR });
  assert.equal(r.rows.length, 1);
  assert.deepEqual(r.excluded.map((e) => e.name), ['歩掛の工種', '単位が違う', '材料費の表', '数量なし']);
  assert.match(r.excluded[1].reason, /単位が合わない/);
  assert.equal(r.total, r.rows[0].amount);
  assert.equal(r.rows[0].amount, Math.floor(10 * r.rows[0].price));
  assert.deepEqual(r.rows[0].source, { document: '施工パッケージ型積算方式 標準単価表', no: 1, package: '架空のパッケージ', condition: '架空の条件', pdfPage: 99 });
});

test('補正していない部分の額と割合を出す', () => {
  const r = directCost([{ name: '行', quantity: 10, unit: 'ｍ３', match: hit() }], { labor: LABOR });
  assert.ok(Math.abs(r.uncorrectedPercent - 47.7) < 0.05);
  assert.equal(r.uncorrectedAmount, Math.round(r.total * 0.4773));
});

test('行の積み上げから工事価格まで。入っていない行があれば知らせる', () => {
  const e = estimate({ kind: '河川工事', labor: LABOR, lines: [
    { name: '行', quantity: 1000, unit: 'm3', match: hit() },
    { name: '外の行', quantity: 1, unit: '式', match: null },
  ] });
  assert.equal(e.indirect.directCost, e.direct.total);
  assert.ok(e.workPrice > e.direct.total);
  assert.equal(e.workPrice % 10000, 0);
  assert.match(e.warnings[0], /合計に入っていない行が 1 件/);
});

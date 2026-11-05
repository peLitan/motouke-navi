// 直接工事費の計算(F42a): 標準単価 → 積算単価の補正 → 数量を掛けて積む
// 補正式は「令和8年度 施工パッケージ型積算方式 標準単価表」Ⅱ-1(PDF p.5)。AI も通信も使わない
// 労務は公共工事設計労務単価で補正する。機械・材料・市場単価は人が単価を入れるまで空けておき、比 1 で計算する

const GROUPS = { K: ['K1', 'K2', 'K3'], R: ['R1', 'R2', 'R3', 'R4'], Z: ['Z1', 'Z2', 'Z3', 'Z4'] };
const norm = (s) => String(s ?? '').normalize('NFKC').replace(/\s/g, '').toLowerCase();
const laborName = (s) => String(s ?? '').replace(/^\*/, ''); // 「*」の付いた職種も同じ職種の単価で補正する

// 有効数字4桁、5桁目以降切り上げ(PDF p.6 の注)
export function roundUp4(v) {
  if (v <= 0) return 0;
  const e = Math.floor(Math.log10(v));
  const step = 10 ** (e - 3);
  return Number((Math.ceil(v / step - 1e-9) * step).toFixed(Math.max(0, 3 - e)));
}

function ratioOf(key, row, labor, manual) {
  const m = manual?.[key];
  if (m && m.base > 0 && m.local > 0) return { ratio: m.local / m.base, from: '人が入れた単価', base: m.base, local: m.local };
  if (key[0] === 'R' && labor) {
    const job = laborName(row.names?.[key]);
    const base = labor.base?.[job], local = labor.local?.[job];
    if (base > 0 && local > 0) return { ratio: local / base, from: '公共工事設計労務単価', base, local };
  }
  return null;
}

// row は標準単価表の1行。labor = { base: 東京(基準年月)の単価, local: 積算地区(積算年月)の単価 }
// manual = { K1: { base, local }, ... }: 人が入れた単価。入れていないところは humanFields に空のまま残す
export function correctedPrice(row, { labor = null, manual = null } = {}) {
  const P = row.price;
  let sum = 0, correctedShare = 0;
  const humanFields = [];
  const applied = [];
  const pend = (key) => humanFields.push({ key, name: row.names?.[key] ?? null, share: row[key], base: null, local: null });
  for (const [group, keys] of Object.entries(GROUPS)) {
    const total = row[group] ?? 0;
    const reps = keys.filter((k) => row[k]);
    const repSum = reps.reduce((a, k) => a + row[k], 0);
    if (!total) continue;
    if (!repSum) { sum += total / 100; continue; } // 代表の規格が無い分は補正のしようがない
    let part = 0;
    for (const k of reps) {
      const r = ratioOf(k, row, labor, manual);
      if (r) { applied.push({ key: k, name: row.names?.[k] ?? null, share: row[k], ...r }); correctedShare += row[k] * (total / repSum); } else pend(k);
      part += (row[k] / 100) * (r ? r.ratio : 1);
    }
    sum += part * (total / repSum);
  }
  if (row.S) {
    const r = ratioOf('S', row, labor, manual);
    if (r) { applied.push({ key: 'S', name: row.names?.S ?? null, share: row.S, ...r }); correctedShare += row.S; } else pend('S');
    sum += (row.S / 100) * (r ? r.ratio : 1);
  }
  const rest = 100 - (row.K ?? 0) - (row.R ?? 0) - (row.Z ?? 0) - (row.S ?? 0);
  sum += rest / 100;
  const exact = P * sum;
  return {
    standard: P, exact, price: roundUp4(exact), applied, humanFields,
    correctedPercent: Math.min(100, correctedShare),
    uncorrectedPercent: Math.max(0, 100 - correctedShare),
  };
}

// 数量の表の行を積む。match が無い行、単位が合わない行、単価の表が無い行は合計に入れず excluded に出す
// lines: [{ name, quantity, unit, match: { package: { no, name, unit }, row } | null, manual }]
export function directCost(lines, { labor = null } = {}) {
  const rows = [], excluded = [];
  for (const line of lines) {
    const out = (reason) => excluded.push({ name: line.name, quantity: line.quantity, unit: line.unit, reason });
    if (!line.match) { out('施工パッケージに当てていない'); continue; }
    const { package: pkg, row } = line.match;
    if (!(typeof line.quantity === 'number' && line.quantity > 0)) { out('数量が読めない'); continue; }
    if (norm(pkg.unit) !== norm(line.unit)) { out(`単位が合わない(数量の表 ${line.unit} / 標準単価表 ${pkg.unit})`); continue; }
    if (!(row?.price > 0)) { out('標準単価が無い(物価資料等によるパッケージ)'); continue; }
    const c = correctedPrice(row, { labor, manual: line.manual });
    // 内訳書の金額は 1円未満を切り捨てる(運用 PDF p.9)
    const amount = Math.floor(line.quantity * c.price + 1e-7);
    rows.push({
      name: line.name, quantity: line.quantity, unit: line.unit, amount, ...c,
      source: { document: '施工パッケージ型積算方式 標準単価表', no: pkg.no, package: pkg.name, condition: row.condition, pdfPage: row.page ?? null },
    });
  }
  const total = rows.reduce((a, r) => a + r.amount, 0);
  const uncorrectedAmount = Math.round(rows.reduce((a, r) => a + r.amount * r.uncorrectedPercent / 100, 0));
  return { rows, excluded, total, uncorrectedAmount, uncorrectedPercent: total ? Math.round(uncorrectedAmount / total * 1000) / 10 : 0 };
}

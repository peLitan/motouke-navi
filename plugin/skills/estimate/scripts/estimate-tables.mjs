// 標準単価表と公共工事設計労務単価の PDF の頁を、表の形に読む(F42a)。pdfPages の結果を受ける
// 列は頁の見出しの位置から決める。数の列の数が合わない行は読まずに skipped に数える

const NUM = /^[\d,]+(\.\d+)?$/;
const CELL = /^([\d,]+(\.\d+)?|-)$/;
const VALUE_KEYS = ['price', 'K', 'K1', 'K2', 'K3', 'R', 'R1', 'R2', 'R3', 'R4', 'Z', 'Z1', 'Z2', 'Z3', 'Z4', 'S'];
const NAME_KEYS = ['K1', 'K2', 'K3', 'R1', 'R2', 'R3', 'R4', 'Z1', 'Z2', 'Z3', 'Z4', 'S'];
const num = (s) => (s === '-' ? null : Number(s.replace(/,/g, '')));
const nearY = (a, b) => Math.abs(a - b) < 0.8;

// 標準単価の行に見える並び(同じ高さに 16 個以上の数)を探す。条件の欄の「-」や数が左に混じるので、右の 16 個を使う
function anchors(items, nameX) {
  const rows = new Map();
  for (const i of items) {
    if (i.x >= nameX || !CELL.test(i.text.trim())) continue;
    const key = [...rows.keys()].find((y) => nearY(y, i.y)) ?? i.y;
    rows.set(key, [...(rows.get(key) ?? []), i]);
  }
  return [...rows].map(([y, cells]) => ({ y, cells: cells.sort((a, b) => a.x - b.x) }));
}

// 名前の列の左の端: 隣の見出しとの中点。文字は列の左に寄る
const nameColumns = (heads, firstLeft) => heads.map((h, i) => ({
  key: h.key,
  left: i ? (heads[i - 1].x + h.x) / 2 : firstLeft,
}));

function joinCells(items) {
  const cols = [];
  for (const i of [...items].sort((a, b) => a.x - b.x)) {
    const c = cols.find((k) => Math.abs(k.x - i.x) < 3);
    if (c) c.items.push(i); else cols.push({ x: i.x, items: [i] });
  }
  return cols.map((c) => c.items.sort((a, b) => b.y - a.y).map((i) => i.text.trim()).join('')).filter(Boolean);
}

function readSegment(seg, items, page, out) {
  const priceHead = items.find((i) => i.text.trim() === '標準単価');
  const k1 = items.filter((i) => i.text.trim() === 'K1').sort((a, b) => a.x - b.x);
  if (!priceHead || k1.length < 2) {
    // 「物価資料等による」の材料費のパッケージには表が無い
    const note = items.map((i) => i.text.trim()).find((t) => /物価資料|見積/.test(t));
    if (note && !out.packages.has(seg.no)) out.packages.set(seg.no, { no: seg.no, name: seg.name, unit: seg.unit, pages: [page], header: [], rows: [], note });
    else if (!note) out.skipped.push({ page, why: '見出しが見つからない' });
    return;
  }
  const headY = k1[0].y;
  const nameHeads = items
    .filter((i) => nearY(i.y, headY) && /^(K|R|Z)[1-4]$/.test(i.text.trim()) && i.x >= k1[1].x - 1)
    .map((i) => ({ key: i.text.trim(), x: i.x }));
  const sHeads = items.filter((i) => i.text.trim() === 'S' && i.y > headY).sort((a, b) => b.x - a.x);
  const sHead = sHeads[0];
  if (sHeads.length < 2) { out.skipped.push({ page, why: '市場単価の見出しが見つからない' }); return; }
  nameHeads.push({ key: 'S', x: sHead.x });
  nameHeads.sort((a, b) => a.x - b.x);
  if (nameHeads.map((h) => h.key).join() !== NAME_KEYS.join()) { out.skipped.push({ page, why: '代表規格の列の並びが違う' }); return; }
  const cols = nameColumns(nameHeads, sHeads[sHeads.length - 1].x + 9);
  const note = items.find((i) => i.text.trim() === '備考' && i.y > headY - 15);
  const nameEnd = note ? note.x - 20 : Infinity;
  const body = items.filter((i) => i.y < headY - 1);
  const rows = anchors(body, cols[0].left);
  const header = joinCells(items.filter((i) => i.y >= headY - 1 && i.y < seg.titleY - 15 && i.x < priceHead.x - 5));
  const good = [];
  const skip = new Set();
  for (const r of rows) {
    const cells = r.cells.slice(-VALUE_KEYS.length);
    if (r.cells.length < VALUE_KEYS.length || !NUM.test(cells[0].text.trim())) {
      if (r.cells.length >= 8) out.skipped.push({ page, why: '数の列が 16 でない: ' + r.cells.length });
      continue;
    }
    const v = {};
    VALUE_KEYS.forEach((k, i) => { v[k] = num(cells[i].text.trim()); });
    cells.forEach((c) => skip.add(c));
    good.push({ y: r.y, v, left: [], names: {} });
  }
  if (!good.length) return;
  const nearest = (y) => good.reduce((a, b) => (Math.abs(b.y - y) < Math.abs(a.y - y) ? b : a));
  for (const i of body) {
    if (skip.has(i) || i.y < seg.bottomY || !i.text.trim()) continue;
    const row = nearest(i.y);
    if (Math.abs(row.y - i.y) > 24) continue;
    if (i.x < priceHead.x - 5) row.left.push(i);
    else if (i.x >= cols[0].left && i.x < nameEnd) {
      const c = [...cols].reverse().find((k) => i.x >= k.left);
      (row.names[c.key] ??= []).push(i);
    }
  }
  const pkg = out.packages.get(seg.no) ?? { no: seg.no, name: seg.name, unit: seg.unit, pages: [], header, rows: [] };
  if (!pkg.pages.includes(page)) pkg.pages.push(page);
  for (const r of good.sort((a, b) => b.y - a.y)) {
    const names = {};
    for (const k of NAME_KEYS) {
      const t = (r.names[k] ?? []).sort((a, b) => b.y - a.y || a.x - b.x).map((i) => i.text.trim()).join('');
      names[k] = t && t !== '-' ? t : null;
    }
    pkg.rows.push({ condition: joinCells(r.left).join(' '), ...r.v, names, page });
  }
  out.packages.set(seg.no, pkg);
}

export function parseUnitPrices(pages) {
  const out = { packages: new Map(), skipped: [] };
  for (const { page, items } of pages) {
    const titles = items.map((i) => ({ i, m: /^No\.(\d+)【\s*(.+?)\s*】/.exec(i.text.trim()) })).filter((t) => t.m)
      .sort((a, b) => b.i.y - a.i.y);
    titles.forEach((t, n) => {
      const bottomY = titles[n + 1]?.i.y ?? -Infinity;
      const segItems = items.filter((i) => i.y <= t.i.y && i.y > bottomY);
      const unit = /積算単位[：:]\s*(.+?)\s*＞/.exec(segItems.map((i) => i.text).join(' '))?.[1] ?? null;
      readSegment({ no: Number(t.m[1]), name: t.m[2], unit, titleY: t.i.y, bottomY }, segItems, page, out);
    });
  }
  return { packages: [...out.packages.values()].sort((a, b) => a.no - b.no), skipped: out.skipped };
}

// 労務単価の別表: 「13 東京都」の形の行が 47 ある頁を読む。地方ごとの再掲の頁は東京都の行が重なるので、先に出た値を使う
const PREF = /^(\d{2}) (.+[都道府県])$/;

// 1字ずつ置かれた PDF(令和7年の版)の字を、同じ高さの隣どうしでつなぐ
function tokens(items) {
  const lines = new Map();
  for (const i of items) {
    const y = [...lines.keys()].find((k) => nearY(k, i.y)) ?? i.y;
    lines.set(y, [...(lines.get(y) ?? []), i]);
  }
  const out = [];
  for (const [y, line] of lines) {
    let cur = null;
    for (const i of line.sort((a, b) => a.x - b.x)) {
      const numeric = /^[\d,]$/.test(i.text) && cur && /[\d,]$/.test(cur.text);
      if (cur && i.x - cur.last < (numeric ? 6.5 : 11.5)) { cur.text += i.text; cur.last = i.x; }
      else { cur = { x: i.x, y, text: i.text, last: i.x }; out.push(cur); }
    }
  }
  return out;
}

export function parseLaborRates(pages) {
  const rates = {};
  const sources = {};
  for (const { page, items: raw } of pages) {
    const single = raw.length > 0 && raw.filter((i) => i.text.length === 1).length > raw.length * 0.8;
    const items = single ? tokens(raw) : raw;
    const prefs = items.map((i) => ({ i, m: PREF.exec(i.text.trim().replace(/\s+/g, ' ')) })).filter((p) => p.m);
    if (prefs.length !== 47) continue;
    const top = Math.max(...prefs.map((p) => p.i.y));
    const prefRight = prefs[0].i.x + 40;
    const values = items.filter((i) => i.y <= top + 0.8 && i.x > prefRight && /^[\d,]+$/.test(i.text.trim()) && i.text.includes(','));
    if (!values.length) continue;
    const colXs = [...new Set(values.map((v) => Math.round(v.x)))].sort((a, b) => a - b)
      .reduce((acc, x) => (acc.length && x - acc[acc.length - 1] < 8 ? acc : [...acc, x]), []);
    // 見出しは列の中央に、数は右に寄る。見出しの字の中央に近い列へ入れる
    const heads = raw.filter((i) => i.y > top + 0.8 && i.y < top + 30 && i.x > colXs[0] - 15 && i.text.trim() && !/単位/.test(i.text));
    const names = colXs.map(() => []);
    for (const h of heads) {
      const center = h.x + h.text.trim().length * 3.9;
      let best = 0;
      colXs.forEach((x, n) => { if (Math.abs(x + 5.5 - center) < Math.abs(colXs[best] + 5.5 - center)) best = n; });
      names[best].push(h);
    }
    const jobs = names.map((n) => n.sort((a, b) => b.y - a.y || a.x - b.x).map((h) => h.text.trim()).join(''));
    for (const p of prefs) {
      const name = p.m[2];
      const row = (rates[name] ??= {});
      for (const v of values.filter((c) => nearY(c.y, p.i.y))) {
        const n = colXs.findIndex((x) => Math.abs(x - v.x) < 8);
        if (n >= 0 && jobs[n] && row[jobs[n]] === undefined) {
          row[jobs[n]] = num(v.text.trim());
          sources[jobs[n]] ??= page;
        }
      }
    }
  }
  return { rates, pages: sources };
}

// PDF から文字と位置を取り出す小さな読み取り(F42a)。作る側の道具で、画面には入らない
// 対応するのは ToUnicode を持つ文字の PDF(国交省の通知の形)。画像だけの頁は空で返す
import zlib from 'node:zlib';

const inflate = (b) => {
  try { return zlib.inflateSync(b, { finishFlush: zlib.constants.Z_SYNC_FLUSH }); }
  catch { return null; }
};

function readObjects(s) {
  const objs = new Map();
  for (const m of s.matchAll(/(?<![0-9])(\d+) (\d+) obj\b([\s\S]*?)endobj/g)) objs.set(Number(m[1]), m[3]);
  for (const [, b] of [...objs]) {
    if (!/\/Type\s*\/ObjStm/.test(b.slice(0, 400))) continue;
    const body = streamOf(b);
    if (!body) continue;
    const n = Number(b.match(/\/N (\d+)/)[1]);
    const first = Number(b.match(/\/First (\d+)/)[1]);
    const head = body.slice(0, first).trim().split(/\s+/).map(Number);
    for (let i = 0; i < n; i++) {
      const start = first + head[2 * i + 1];
      const end = i < n - 1 ? first + head[2 * i + 3] : body.length;
      if (!objs.has(head[2 * i])) objs.set(head[2 * i], body.slice(start, end));
    }
  }
  return objs;
}

function streamOf(b) {
  const m = /stream\r?\n/.exec(b);
  if (!m) return null;
  const end = b.lastIndexOf('endstream');
  const raw = b.slice(m.index + m[0].length, end < 0 ? undefined : end);
  if (!b.slice(0, m.index).includes('FlateDecode')) return raw;
  const out = inflate(Buffer.from(raw, 'latin1'));
  return out ? out.toString('latin1') : null;
}

const ref = (b, key) => {
  const m = new RegExp(key + '\\s+(\\d+) 0 R').exec(b);
  return m ? Number(m[1]) : null;
};

const utf16 = (hex) => Buffer.from(hex.length % 2 ? hex + '0' : hex, 'hex').swap16().toString('utf16le');

function readCmap(body) {
  const map = new Map();
  let width = 2;
  if (!body) return { map, width };
  for (const blk of body.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const m of blk[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      width = m[1].length / 2;
      map.set(parseInt(m[1], 16), utf16(m[2]));
    }
  }
  for (const blk of blk2(body)) {
    for (const m of blk.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(?:<([0-9A-Fa-f]+)>|\[([^\]]*)\])/g)) {
      width = m[1].length / 2;
      const from = parseInt(m[1], 16), to = parseInt(m[2], 16);
      if (m[4] !== undefined) { // 配列の形: 文字を1つずつ並べる
        [...m[4].matchAll(/<([0-9A-Fa-f]+)>/g)].forEach((u, i) => map.set(from + i, utf16(u[1])));
        continue;
      }
      const base = parseInt(m[3], 16);
      for (let i = from; i <= to; i++) map.set(i, m[3].length > 4 ? utf16(m[3]) : String.fromCharCode(base + i - from));
    }
  }
  return { map, width };
}
const blk2 = (body) => [...body.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)].map((m) => m[1]);

function pageFonts(objs, page) {
  const res = ref(page, '/Resources');
  const r = res !== null ? objs.get(res) ?? '' : page;
  const fref = ref(r, '/Font');
  const fb = fref !== null ? objs.get(fref) ?? '' : /\/Font\s*<<([\s\S]*?)>>/.exec(r)?.[1] ?? '';
  const out = new Map();
  for (const m of fb.matchAll(/\/([\w.+-]+)\s+(\d+) 0 R/g)) {
    const t = ref(objs.get(Number(m[2])) ?? '', '/ToUnicode');
    out.set(m[1], t !== null ? readCmap(streamOf(objs.get(t) ?? '')) : { map: new Map(), width: 1 });
  }
  return out;
}

function decode(raw, font) {
  const { map, width } = font;
  let out = '';
  for (let i = 0; i + width <= raw.length; i += width) {
    let c = 0;
    for (let j = 0; j < width; j++) c = c * 256 + raw.charCodeAt(i + j);
    out += map.get(c) ?? (map.size ? '' : String.fromCharCode(c));
  }
  return out;
}

function literal(s) {
  let r = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== '\\') { r += s[i]; continue; }
    i++;
    const oct = /^[0-7]{1,3}/.exec(s.slice(i, i + 3));
    if (oct) { r += String.fromCharCode(parseInt(oct[0], 8) & 255); i += oct[0].length - 1; continue; }
    r += { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' }[s[i]] ?? s[i];
  }
  return r;
}

const hexBytes = (h) => Buffer.from(h.replace(/\s/g, ''), 'hex').toString('latin1');
const TOKEN = /\/([\w.+-]+)\s+[\d.]+\s+Tf|\[((?:\((?:\\[\s\S]|[^\\)])*\)|<[0-9A-Fa-f\s]*>|[-\d.\s])*)\]\s*TJ|\(((?:\\[\s\S]|[^\\)])*)\)\s*Tj|<([0-9A-Fa-f\s]*)>\s*Tj|([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+Tm|([-\d.]+)\s+([-\d.]+)\s+T[dD]|\bBT\b/g;

function pageItems(content, fonts) {
  const items = [];
  let font = { map: new Map(), width: 1 }, x = 0, y = 0, lx = 0, ly = 0;
  for (const m of content.matchAll(TOKEN)) {
    if (m[1]) font = fonts.get(m[1]) ?? font;
    else if (m[5] !== undefined) { lx = x = Number(m[9]); ly = y = Number(m[10]); }
    else if (m[11] !== undefined) { lx += Number(m[11]); ly += Number(m[12]); x = lx; y = ly; }
    else if (m[0].trim() === 'BT') { x = y = lx = ly = 0; }
    else {
      let t = '';
      if (m[2] !== undefined) {
        for (const q of m[0].matchAll(/\(((?:\\[\s\S]|[^\\)])*)\)|<([0-9A-Fa-f\s]*)>/g)) {
          t += decode(q[1] !== undefined ? literal(q[1]) : hexBytes(q[2]), font);
        }
      } else t = decode(m[3] !== undefined ? literal(m[3]) : hexBytes(m[4]), font);
      if (t) items.push({ x, y, text: t });
    }
  }
  return items;
}

// 頁ごとの文字の配列を返す: [{ page, items: [{ x, y, text }] }]。page は PDF の頁(1 から)
export function pdfPages(bytes) {
  const s = Buffer.from(bytes).toString('latin1');
  const objs = readObjects(s);
  const order = [];
  const walk = (n) => {
    const b = objs.get(n) ?? '';
    if (/\/Type\s*\/Pages/.test(b)) for (const k of /\/Kids\s*\[([\s\S]*?)\]/.exec(b)[1].matchAll(/(\d+) 0 R/g)) walk(Number(k[1]));
    else if (/\/Type\s*\/Page\b/.test(b)) order.push(n);
  };
  const root = [...objs].find(([, b]) => /\/Type\s*\/Catalog/.test(b));
  if (!root) throw new Error('PDF の目次が読めません');
  walk(ref(root[1], '/Pages'));
  return order.map((n, i) => {
    const b = objs.get(n);
    const list = /\/Contents\s*\[([\s\S]*?)\]/.exec(b);
    const ids = list ? [...list[1].matchAll(/(\d+) 0 R/g)].map((m) => Number(m[1])) : [ref(b, '/Contents')];
    const content = ids.map((id) => streamOf(objs.get(id) ?? '') ?? '').join('\n');
    return { page: i + 1, items: pageItems(content, pageFonts(objs, b)) };
  });
}

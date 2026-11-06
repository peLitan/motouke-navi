// 試作: 外の部品なしで PDF の文字を読む(F82 の設計の材料)。Node と Edge で同じコードが動く(Buffer・zlib・fs を使わない)。
// 読むのは文字だけ。画像・注釈・フォームの値は読まない。読めない物は読めないと返す(status)。
// 使う組み込み: DecompressionStream('deflate')・TextDecoder('shift_jis'|'euc-jp'|'windows-1252')。
// 外から来たファイルを画面の主スレッドで読むので、固まらない・タブが落ちないよう、下の上限を越えたら too-big で止める。

export const LIMITS = {
  file: 30 * 1024 * 1024,      // 読むファイルの上限(extract.mjs の MAX_FILE と同じ)
  stream: 64 * 1024 * 1024,    // 1つのストリームを開いた後の上限
  total: 128 * 1024 * 1024,    // 開いた後の合計の上限(圧縮爆弾の止め。フィルタの無い物も、同じ物を開き直した分も数える)
  pages: 3000,
  depth: 8,                    // Form XObject の入れ子
  formDo: 50000,               // Form の Do の合計
  pageChars: 50000,            // 1頁の字(空白と見えない字も数える。文に入らなくても時間を使う)
  docChars: 3000000,           // 全体の字(同じ)
  ms: 30000,                   // 読み始めからの経過時間
  values: 20000000,            // 覚える値の数(メモリの止め。dict は重いので 10 と数える)
  cmapEntries: 300000,         // ToUnicode の行の上限
  stack: 4096,
};

const SPINS = 2048;            // 中の繰り返しがこの回数になるごとに時計を見る(重い1回は重さの分を数える)
const HAND_BACK_MS = 50;       // 前に手を返してからこれより経っていれば、画面に手を返す
const LZW_DICT = 4096;         // LZW の符号は 12 ビットまでなので、これより先の語は呼ばれない
const CODESPACES = 100;        // CMap の codespacerange の数(仕様の上限)

export class PdfError extends Error { constructor(kind, msg) { super(msg); this.kind = kind; } }

// 時計を見て、時間を越えていれば止める。主スレッドを持ち続けていれば画面に手を返す
async function breathe(ctx) {
  ctx.spins = 0;
  const now = performance.now();
  if (now - ctx.started > ctx.limits.ms) throw new PdfError('too-big', '読むのに時間がかかりすぎます');
  if (now - ctx.handedBack > HAND_BACK_MS) {
    await new Promise((r) => setTimeout(r, 0));
    ctx.handedBack = performance.now();
  }
}

// 開いた分を、そのストリームの大きさと合計の両方で数える
function charge(ctx, n, streamSize) {
  ctx.inflated += n;
  if (streamSize > ctx.limits.stream || ctx.inflated > ctx.limits.total) throw new PdfError('too-big', '開いた中身が大きすぎます');
}

// 覚える値を数える。ファイルの1字が何十バイトもの値になるので、開いた大きさの上限だけではメモリを止められない
function hold(tally, n) {
  if ((tally.values += n) > tally.limits.values) throw new PdfError('too-big', '中の値が多すぎます');
}

// 開いた中身を数えながらためる(JS の配列に1バイトずつ入れると 8倍の場所を取る)
class ByteOut {
  constructor(ctx) { this.ctx = ctx; this.buf = new Uint8Array(4096); this.n = 0; }
  room(k) {
    const need = this.n + k;
    charge(this.ctx, k, need);
    if (need > this.buf.length) {
      const b = new Uint8Array(Math.max(this.buf.length * 2, need));
      b.set(this.buf.subarray(0, this.n));
      this.buf = b;
    }
  }
  add(list) { this.room(list.length); this.buf.set(list, this.n); this.n += list.length; }
  fill(v, k) { this.room(k); this.buf.fill(v, this.n, this.n + k); this.n += k; }
  done() { return this.buf.subarray(0, this.n); }
}

// ---- バイト列 ----
// TextDecoder('latin1') は仕様で windows-1252 になり 0x80〜0x9F が別の字に化けるので使わない
function toBinary(bytes) {
  const CHUNK = 0x8000, parts = [];
  for (let i = 0; i < bytes.length; i += CHUNK) parts.push(String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK)));
  return parts.join('');
}
function concat(chunks, total) {
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

// 途中で壊れていても、出た分は使う(末尾のごみ・切れたストリームで全部を失わない)
async function inflate(data, ctx) {
  const run = async (format) => {
    const ds = new DecompressionStream(format);
    const w = ds.writable.getWriter(), r = ds.readable.getReader();
    w.write(data).catch(() => {});
    w.close().catch(() => {});
    const chunks = [];
    let total = 0, damaged = false;
    for (;;) {
      let step;
      try { step = await r.read(); } catch { damaged = true; break; }
      if (step.done) break;
      total += step.value.length;
      try {
        charge(ctx, step.value.length, total);
        if ((ctx.spins += step.value.length) >= SPINS) await breathe(ctx);
      } catch (e) { r.cancel().catch(() => {}); throw e; }
      chunks.push(step.value);
    }
    return { out: concat(chunks, total), damaged };
  };
  let res = await run('deflate');
  if (res.out.length === 0 && res.damaged) res = await run('deflate-raw');
  if (res.damaged) ctx.damagedStreams++;
  return res.out;
}

async function ascii85(data, ctx) {
  const out = new ByteOut(ctx);
  let tuple = 0, n = 0;
  for (const c of data) {
    if (++ctx.spins >= SPINS) await breathe(ctx);
    if (c === 0x7e) break;
    if (c <= 32) continue;
    if (c === 0x7a && n === 0) { out.fill(0, 4); continue; }
    tuple = tuple * 85 + (c - 33);
    if (++n === 5) { out.add([(tuple / 16777216) & 255, (tuple / 65536) & 255, (tuple / 256) & 255, tuple & 255]); tuple = 0; n = 0; }
  }
  if (n > 1) {
    for (let i = n; i < 5; i++) tuple = tuple * 85 + 84;
    const b = [(tuple / 16777216) & 255, (tuple / 65536) & 255, (tuple / 256) & 255];
    out.add(b.slice(0, n - 1));
  }
  return out.done();
}
const hexDigit = (c) => (c <= 57 ? c - 48 : (c | 32) - 87); // 0-9・a-f・A-F の字の番号を値にする
// 16進の字だけの文字列をバイトにする。字の数が奇数なら最後の字の後ろに 0 を補う
function hexBytes(h) {
  const out = new Uint8Array(Math.ceil(h.length / 2));
  for (let i = 0; i < h.length; i += 2) out[i >> 1] = hexDigit(h.charCodeAt(i)) * 16 + (i + 1 < h.length ? hexDigit(h.charCodeAt(i + 1)) : 0);
  return out;
}
function asciiHex(data) {
  return hexBytes(toBinary(data).replace(/>[\s\S]*$/, '').replace(/[^0-9A-Fa-f]/g, ''));
}
async function lzw(data, early, ctx) {
  const out = new ByteOut(ctx);
  const dict = Array.from({ length: 258 }, (_, i) => (i < 256 ? [i] : []));
  let bits = 9, code, prev = null, buf = 0, nb = 0;
  for (const b of data) {
    buf = (buf << 8) | b; nb += 8;
    while (nb >= bits) {
      code = (buf >>> (nb - bits)) & ((1 << bits) - 1); nb -= bits;
      if (code === 256) {
        dict.length = 258; bits = 9; prev = null;
        if (++ctx.spins >= SPINS) await breathe(ctx);
        continue;
      }
      if (code === 257) return out.done();
      const cur = code < dict.length ? dict[code] : prev ? [...prev, prev[0]] : [];
      out.add(cur);
      if (prev && dict.length < LZW_DICT) dict.push([...prev, cur[0]]);
      prev = cur;
      const n = dict.length + early;
      bits = n >= 2048 ? 12 : n >= 1024 ? 11 : n >= 512 ? 10 : 9;
      if ((ctx.spins += 1 + cur.length) >= SPINS) await breathe(ctx);
    }
    buf &= (1 << nb) - 1;
  }
  return out.done();
}
async function runLength(data, ctx) {
  const out = new ByteOut(ctx);
  for (let i = 0; i < data.length;) {
    const n = data[i++];
    if (n === 128) break;
    if (n < 128) { out.add(data.subarray(i, i + n + 1)); i += n + 1; } else out.fill(data[i++], 257 - n);
    if (++ctx.spins >= SPINS) await breathe(ctx);
  }
  return out.done();
}
function unpredict(data, parms) {
  const pred = parms?.get?.('Predictor') ?? 1;
  if (pred < 10) return data; // TIFF の予測は文字のストリームでは見ない
  const cols = parms.get('Columns') ?? 1, colors = parms.get('Colors') ?? 1, bpc = parms.get('BitsPerComponent') ?? 8;
  const bpp = Math.max(1, Math.ceil(colors * bpc / 8)), row = Math.ceil(cols * colors * bpc / 8);
  const rows = Math.floor(data.length / (row + 1));
  const out = new Uint8Array(rows * row);
  for (let r = 0; r < rows; r++) {
    const ft = data[r * (row + 1)], src = r * (row + 1) + 1, dst = r * row;
    for (let i = 0; i < row; i++) {
      const a = i >= bpp ? out[dst + i - bpp] : 0, b = r ? out[dst - row + i] : 0, c = r && i >= bpp ? out[dst - row + i - bpp] : 0;
      let p = 0;
      if (ft === 1) p = a; else if (ft === 2) p = b; else if (ft === 3) p = (a + b) >> 1;
      else if (ft === 4) { const q = a + b - c, pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - c); p = pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      out[dst + i] = (data[src + i] + p) & 255;
    }
  }
  return out;
}

// ---- 字句 ----
class Name { constructor(n) { this.name = n; } }
class Ref { constructor(n) { this.n = n; } }
class Op { constructor(o) { this.op = o; } }

const isWs = (c) => c === 0 || c === 9 || c === 10 || c === 12 || c === 13 || c === 32;
const isDelim = (c) => c === 40 || c === 41 || c === 60 || c === 62 || c === 91 || c === 93 || c === 123 || c === 125 || c === 47 || c === 37;
const REF_TAIL = /[\s\0]+(\d+)[\s\0]+R(?![A-Za-z0-9])/y;

class Lex {
  // tally を渡すと、読んだ値を hold で数える
  constructor(s, p = 0, end = s.length, refs = true, tally = null) { this.s = s; this.p = p; this.end = Math.min(end, s.length); this.refs = refs; this.tally = tally; }
  ws() {
    const s = this.s;
    while (this.p < this.end) {
      const c = s.charCodeAt(this.p);
      if (isWs(c)) this.p++;
      else if (c === 37) { while (this.p < this.end && s.charCodeAt(this.p) !== 10 && s.charCodeAt(this.p) !== 13) this.p++; } else break;
    }
  }
  value() {
    const s = this.s;
    if (this.tally) hold(this.tally, 1);
    for (;;) {
      this.ws();
      if (this.p >= this.end) return undefined;
      const c = s.charCodeAt(this.p);
      if (c === 60) return s.charCodeAt(this.p + 1) === 60 ? this.dict() : this.hex();
      if (c === 40) return this.lit();
      if (c === 47) return this.name();
      if (c === 91) return this.array();
      let q = this.p;
      while (q < this.end) { const d = s.charCodeAt(q); if (isWs(d) || isDelim(d)) break; q++; }
      if (q === this.p) { this.p++; continue; } // 余った区切りの字
      const t = s.slice(this.p, q);
      this.p = q;
      const first = t.charCodeAt(0);
      if ((first >= 48 && first <= 57) || first === 43 || first === 45 || first === 46) {
        const n = Number(t);
        if (!Number.isNaN(n)) {
          if (this.refs && Number.isInteger(n) && n >= 0) {
            REF_TAIL.lastIndex = q;
            const m = REF_TAIL.exec(s);
            if (m) { this.p = REF_TAIL.lastIndex; return new Ref(n); }
          }
          return n;
        }
        const f = parseFloat(t);
        if (!Number.isNaN(f)) return f;
      }
      if (t === 'true') return true;
      if (t === 'false') return false;
      if (t === 'null') return null;
      return new Op(t);
    }
  }
  array() {
    this.p++;
    const a = [];
    for (;;) {
      this.ws();
      if (this.p >= this.end) return a;
      if (this.s.charCodeAt(this.p) === 93) { this.p++; return a; }
      const v = this.value();
      if (v === undefined) return a;
      if (!(v instanceof Op)) a.push(v);
    }
  }
  dict() {
    if (this.tally) hold(this.tally, 9);
    this.p += 2;
    const d = new Map();
    for (;;) {
      this.ws();
      if (this.p >= this.end) return d;
      if (this.s.charCodeAt(this.p) === 62) { this.p += this.s.charCodeAt(this.p + 1) === 62 ? 2 : 1; return d; }
      const k = this.value();
      if (k === undefined) return d;
      if (!(k instanceof Name)) continue;
      const v = this.value();
      if (v === undefined) return d;
      d.set(k.name, v);
    }
  }
  name() {
    const s = this.s;
    let q = ++this.p;
    while (q < this.end) { const d = s.charCodeAt(q); if (isWs(d) || isDelim(d)) break; q++; }
    const t = s.slice(this.p, q);
    this.p = q;
    return new Name(t.includes('#') ? t.replace(/#([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))) : t);
  }
  hex() {
    const close = this.s.indexOf('>', this.p);
    const end = close < 0 || close > this.end ? this.end : close;
    const h = this.s.slice(this.p + 1, end).replace(/[^0-9A-Fa-f]/g, '');
    this.p = end + 1;
    return toBinary(hexBytes(h));
  }
  lit() {
    const s = this.s;
    let depth = 1, out = '', i = this.p + 1, from = i; // 1字ずつ足すと長い文字列で時間とメモリが伸びるので、まとめて切り出す
    for (; i < this.end; i++) {
      const ch = s[i];
      if (ch === '\\') {
        out += s.slice(from, i);
        const n = s[++i];
        if (n >= '0' && n <= '7') {
          let v = 0, k = 0;
          while (k < 3 && s[i] >= '0' && s[i] <= '7') { v = v * 8 + (s.charCodeAt(i) - 48); i++; k++; }
          i--;
          out += String.fromCharCode(v & 255);
        } else if (n === '\r') { if (s[i + 1] === '\n') i++; } else if (n !== '\n') out += { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' }[n] ?? n;
        from = i + 1;
        continue;
      }
      if (ch === '(') depth++;
      else if (ch === ')') { if (--depth === 0) break; }
    }
    this.p = i + 1;
    return out + s.slice(from, i);
  }
}

// ---- 文書 ----
class Doc {
  constructor(bytes, limits) {
    const now = performance.now();
    this.bytes = bytes;
    this.s = toBinary(bytes);
    this.objs = new Map();
    this.ctx = { inflated: 0, damagedStreams: 0, unknownFilters: new Set(), limits, started: now, handedBack: now, spins: 0, forms: 0, glyphs: 0, values: 0 };
    this.fonts = new Map();
    this.fontStats = new Map();
  }
  put(n, entry) {
    const old = this.objs.get(n);
    if (!old || old.at <= entry.at) this.objs.set(n, entry);
  }
  async scan() {
    const s = this.s, ctx = this.ctx, re = /(?<![0-9])(\d+)[ \t\r\n]+(\d+)[ \t\r\n]+obj\b/g;
    let m;
    const stms = [];
    while ((m = re.exec(s))) {
      const from = re.lastIndex, lx = new Lex(s, from, s.length, true, ctx);
      let v, bad = false;
      try { v = lx.value(); } catch (e) { if (e instanceof PdfError) throw e; bad = true; }
      if ((ctx.spins += 1 + lx.p - from) >= SPINS) await breathe(ctx);
      if (bad || v instanceof Op) continue;
      lx.ws();
      const entry = { v, at: m.index };
      if (v instanceof Map && s.startsWith('stream', lx.p)) {
        let st = lx.p + 6;
        if (s[st] === '\r') st++;
        if (s[st] === '\n') st++;
        const len = v.get('Length');
        let en = -1;
        // 負の /Length は使わない。手前の endstream に当たると、同じ obj へ戻って読み続ける
        if (typeof len === 'number' && len >= 0 && st + len <= s.length && /^[\s\0]*endstream/.test(s.slice(st + len, st + len + 24))) en = st + len;
        if (en < 0) {
          en = s.indexOf('endstream', st);
          if (en < 0) en = s.length;
          if (s[en - 1] === '\n') en--;
          if (s[en - 1] === '\r') en--;
        }
        entry.start = st; entry.end = en;
        re.lastIndex = en;
        if (v.get('Type')?.name === 'ObjStm') stms.push(Number(m[1]));
        if (v.get('Type')?.name === 'XRef' && v.has('Encrypt')) this.encrypted = true;
      } else re.lastIndex = Math.max(lx.p, re.lastIndex);
      this.put(Number(m[1]), entry);
    }
    return stms;
  }
  r(v, guard = 0) {
    while (v instanceof Ref && guard++ < 32) v = this.objs.get(v.n)?.v;
    return v instanceof Ref ? undefined : v;
  }
  async stream(entry) {
    const d = entry.v, raw = this.bytes.subarray(entry.start, entry.end);
    let data = raw;
    const fv = this.r(d.get('Filter') ?? d.get('F'));
    const filters = fv === undefined || fv === null ? [] : Array.isArray(fv) ? fv.map((x) => this.r(x)) : [fv];
    const pv = this.r(d.get('DecodeParms') ?? d.get('DP'));
    const parms = Array.isArray(pv) ? pv.map((x) => this.r(x)) : [pv];
    for (let i = 0; i < filters.length; i++) {
      const f = filters[i]?.name;
      if (f === 'FlateDecode' || f === 'Fl') data = unpredict(await inflate(data, this.ctx), parms[i]);
      else if (f === 'ASCII85Decode' || f === 'A85') data = await ascii85(data, this.ctx);
      else if (f === 'ASCIIHexDecode' || f === 'AHx') { data = asciiHex(data); charge(this.ctx, data.length, data.length); }
      else if (f === 'LZWDecode' || f === 'LZW') data = unpredict(await lzw(data, parms[i]?.get?.('EarlyChange') ?? 1, this.ctx), parms[i]);
      else if (f === 'RunLengthDecode' || f === 'RL') data = await runLength(data, this.ctx);
      else if (f === 'Crypt') continue;
      else { this.ctx.unknownFilters.add(String(f)); return null; }
    }
    // フィルタの無い物も数える。同じ物を /Contents に何度も並べると、開かなくてもメモリが尽きる
    if (data === raw) charge(this.ctx, raw.length, raw.length);
    return data;
  }
  async load() {
    const ctx = this.ctx;
    const stms = await this.scan();
    for (const n of stms) {
      const entry = this.objs.get(n);
      if (!entry?.v?.get) continue;
      const data = await this.stream(entry);
      if (!data) continue;
      const N = this.r(entry.v.get('N')), first = this.r(entry.v.get('First'));
      if (typeof N !== 'number' || typeof first !== 'number') continue;
      const body = toBinary(data);
      const head = new Lex(body, 0, first, false, ctx);
      const pairs = [];
      // /N はファイルの値のまま回さない。1組は少なくとも4字(「1 0 」)
      const count = Math.min(N, body.length / 4);
      for (let i = 0; i < count; i++) {
        const a = head.value(), b = head.value();
        if (typeof a === 'number' && typeof b === 'number') pairs.push([a, b]);
        if (++ctx.spins >= SPINS) await breathe(ctx);
      }
      for (const [num, off] of pairs) {
        const start = first + off, lx = new Lex(body, start, body.length, true, ctx);
        try { this.put(num, { v: lx.value(), at: entry.at }); } catch (e) { if (e instanceof PdfError) throw e; /* 壊れた1件は飛ばす */ }
        if ((ctx.spins += 1 + Math.max(0, lx.p - start)) >= SPINS) await breathe(ctx);
      }
    }
    for (const m of this.s.matchAll(/trailer[\s\0]*<</g)) {
      if (this.s.slice(m.index, m.index + 4096).includes('/Encrypt')) this.encrypted = true;
      if ((ctx.spins += 64) >= SPINS) await breathe(ctx);
    }
  }
  catalog() {
    let found = null;
    for (const e of this.objs.values()) {
      if (e.v instanceof Map && e.v.get('Type')?.name === 'Catalog' && (!found || e.at >= found.at)) found = e;
    }
    return found?.v ?? null;
  }
  pages() {
    const cat = this.catalog();
    if (!cat) throw new PdfError('broken', 'PDF の目次が読めません');
    const out = [], seen = new Set();
    const walk = (nodeV, inherited, depth) => {
      if (depth > 64) return;
      const id = nodeV instanceof Ref ? nodeV.n : null;
      if (id !== null) { if (seen.has(id)) return; seen.add(id); }
      const node = this.r(nodeV);
      if (!(node instanceof Map)) return;
      const inh = { ...inherited };
      for (const k of ['Resources', 'MediaBox', 'CropBox', 'Rotate']) if (node.has(k)) inh[k] = node.get(k);
      const kids = this.r(node.get('Kids'));
      if (Array.isArray(kids) && node.get('Type')?.name !== 'Page') { for (const k of kids) walk(k, inh, depth + 1); return; }
      out.push({ node, ...inh });
      // 前の頁だけを ok で返すと、欠けたことが分からない
      if (out.length > this.ctx.limits.pages) throw new PdfError('too-big', '頁が多すぎます');
    };
    walk(cat.get('Pages'), {}, 0);
    return out;
  }
}

// ---- 字の対応 ----
function utf16hex(h) {
  let out = '';
  // 1字が長い文字列に化けると、字の数の上限の中でも頁の文が膨らむ。合字でも 64 字には届かない
  for (let i = 0; i + 3 < h.length && i < 64 * 4; i += 4) out += String.fromCharCode(parseInt(h.substr(i, 4), 16));
  if (h.length === 2) out = String.fromCharCode(parseInt(h, 16));
  return out;
}
// begin〜end の間を順に返す。end の無い begin が並んでも、同じ所を読み直さない
function* cmapBlocks(t, name) {
  const open = 'begin' + name, close = 'end' + name;
  for (let p = t.indexOf(open); p >= 0;) {
    const from = p + open.length, to = t.indexOf(close, from);
    if (to < 0) return;
    yield t.slice(from, to);
    p = t.indexOf(open, to + close.length);
  }
}
// <…> の16進(中の空白は捨てる)を n 個ずつ返す。arrays なら [ … ] を1つの配列にする。1字ずつ進むので、正規表現と違い < の後の長い空白でも時間が伸びない
function* cmapGroups(t, n, arrays = false) {
  let list = null, group = [];
  const put = (v) => { if (list) list.push(v); else group.push(v); };
  for (let i = 0; i < t.length;) {
    const c = t[i];
    if (c === '<') {
      const close = t.indexOf('>', i);
      if (close < 0) return;
      put(t.slice(i + 1, close).replace(/[^0-9A-Fa-f]/g, ''));
      i = close + 1;
    } else {
      if (arrays && c === '[') list = [];
      else if (c === ']' && list) { const v = list; list = null; group.push(v); }
      i++;
    }
    if (group.length === n) { yield group; group = []; }
  }
}
function parseCMap(t, limits) {
  const map = new Map(), spaces = [];
  let count = 0;
  for (const b of cmapBlocks(t, 'codespacerange')) {
    for (const [lo, hi] of cmapGroups(b, 2)) {
      if (spaces.length < CODESPACES) spaces.push({ n: lo.length / 2, lo: parseInt(lo, 16), hi: parseInt(hi, 16) });
    }
  }
  for (const b of cmapBlocks(t, 'bfchar')) {
    for (const [code, u] of cmapGroups(b, 2)) {
      if (++count > limits.cmapEntries) return { map, spaces };
      map.set(parseInt(code, 16), utf16hex(u));
    }
  }
  for (const b of cmapBlocks(t, 'bfrange')) {
    for (const [lo, hi, dst] of cmapGroups(b, 3, true)) {
      const from = parseInt(lo, 16), to = parseInt(hi, 16);
      if (to < from || to - from > 0xffff) continue;
      if (Array.isArray(dst)) {
        for (let i = 0; i < dst.length && from + i <= to; i++) {
          if (++count > limits.cmapEntries) return { map, spaces };
          map.set(from + i, utf16hex(dst[i]));
        }
        continue;
      }
      const head = utf16hex(dst);
      const last = head.charCodeAt(head.length - 1);
      for (let i = 0; i <= to - from; i++) {
        if (++count > limits.cmapEntries) return { map, spaces };
        map.set(from + i, head.slice(0, -1) + String.fromCharCode(last + i));
      }
    }
  }
  return { map, spaces };
}

const ASCII_NAMES = 'space exclam quotedbl numbersign dollar percent ampersand quotesingle parenleft parenright asterisk plus comma hyphen period slash zero one two three four five six seven eight nine colon semicolon less equal greater question at A B C D E F G H I J K L M N O P Q R S T U V W X Y Z bracketleft backslash bracketright asciicircum underscore grave a b c d e f g h i j k l m n o p q r s t u v w x y z braceleft bar braceright asciitilde'.split(' ');
const GLYPH = new Map(ASCII_NAMES.map((n, i) => [n, String.fromCharCode(32 + i)]));
for (const [n, u] of [['bullet', '•'], ['endash', '–'], ['emdash', '—'], ['quoteleft', '‘'], ['quoteright', '’'], ['quotedblleft', '“'], ['quotedblright', '”'], ['yen', '¥'], ['minus', '−'], ['nbspace', ' '], ['sfthyphen', '-'], ['fi', 'fi'], ['fl', 'fl']]) GLYPH.set(n, u);
function glyphName(n) {
  if (GLYPH.has(n)) return GLYPH.get(n);
  let m = /^uni([0-9A-Fa-f]{4})/.exec(n);
  if (m) return String.fromCharCode(parseInt(m[1], 16));
  m = /^u([0-9A-Fa-f]{4,6})$/.exec(n);
  if (m) return String.fromCodePoint(parseInt(m[1], 16));
  const base = n.split('.')[0];
  return base !== n ? glyphName(base) : null;
}

const win1252 = new TextDecoder('windows-1252');
const sjis = new TextDecoder('shift_jis');
const eucjp = new TextDecoder('euc-jp');
const bytesOf = (...b) => Uint8Array.from(b);

// 文字列(バイト)→ [{ u, w, sp }]。u が null の字は対応が分からない字
async function loadFont(doc, ref) {
  const key = ref instanceof Ref ? ref.n : ref;
  if (doc.fonts.has(key)) return doc.fonts.get(key);
  const d = doc.r(ref);
  if (!(d instanceof Map)) return null;
  const subtype = doc.r(d.get('Subtype'))?.name;
  let toUni = null;
  const tu = d.get('ToUnicode');
  const tuEntry = tu instanceof Ref ? doc.objs.get(tu.n) : null;
  if (tuEntry && tuEntry.start !== undefined) {
    const data = await doc.stream(tuEntry);
    if (data) {
      toUni = parseCMap(toBinary(data), doc.ctx.limits);
      hold(doc.ctx, toUni.map.size); // フォントを並べて同じ表を何度も作っても止める
      doc.ctx.spins += data.length;
    }
    if (toUni && toUni.map.size === 0) toUni = null;
  }
  const enc = doc.r(d.get('Encoding'));
  let font;
  if (subtype === 'Type0') {
    const desc = doc.r(doc.r(d.get('DescendantFonts'))?.[0]);
    const dw = doc.r(desc?.get('DW')) ?? 1000;
    const widths = new Map();
    const W = doc.r(desc?.get('W'));
    if (Array.isArray(W)) {
      let left = doc.ctx.limits.cmapEntries; // 範囲や同じ配列を並べても広げすぎない
      for (let i = 0; i < W.length;) {
        const a = doc.r(W[i]), b = doc.r(W[i + 1]);
        if (Array.isArray(b)) {
          if (left > 0) { b.forEach((x, k) => widths.set(a + k, doc.r(x))); left -= b.length; }
          i += 2;
        } else {
          const w = doc.r(W[i + 2]);
          if (b - a < 70000) for (let c = a; c <= b && left > 0; c++, left--) widths.set(c, w);
          i += 3;
        }
      }
      hold(doc.ctx, widths.size);
      doc.ctx.spins += W.length;
    }
    const encName = enc?.name ?? 'stream';
    const family = /RKSJ/.test(encName) ? 'sjis' : /UTF16|UCS2/.test(encName) ? 'utf16' : /EUC/.test(encName) ? 'euc' : /^[HV]$/.test(encName) ? 'jis' : 'identity';
    const vertical = /-V$|^V$/.test(encName);
    const registry = doc.r(doc.r(desc?.get('CIDSystemInfo'))?.get('Ordering')) ?? '';
    const hasEmbedded = (() => { const fd = doc.r(desc?.get('FontDescriptor')); return !!(fd && (fd.has('FontFile2') || fd.has('FontFile3') || fd.has('FontFile'))); })();
    font = {
      vertical,
      key: 'Type0/' + encName + '/' + (toUni ? 'ToUnicode' : 'ToUnicode無し') + (hasEmbedded ? '/埋込' : '/非埋込') + (toUni ? '' : '/' + registry),
      decode(bin) {
        const out = [];
        for (let i = 0; i < bin.length;) {
          const b0 = bin.charCodeAt(i);
          let n = 2;
          if (family === 'sjis') n = (b0 >= 0x81 && b0 <= 0x9f) || (b0 >= 0xe0 && b0 <= 0xfc) ? 2 : 1;
          else if (family === 'euc') n = b0 >= 0xa1 ? 2 : 1;
          else if (toUni?.spaces.length) {
            const one = toUni.spaces.find((s) => s.n === 1 && b0 >= s.lo && b0 <= s.hi);
            if (one && !toUni.spaces.some((s) => s.n === 2)) n = 1;
          }
          let code = 0;
          for (let k = 0; k < n; k++) code = code * 256 + (bin.charCodeAt(i + k) || 0);
          const b1 = bin.charCodeAt(i + 1) || 0;
          i += n;
          let u = toUni?.map.get(code) ?? null;
          if (u === null || u === undefined) {
            if (family === 'utf16') u = String.fromCharCode(code);
            else if (family === 'sjis') u = sjis.decode(n === 2 ? bytesOf(b0, b1) : bytesOf(b0));
            else if (family === 'euc') u = eucjp.decode(n === 2 ? bytesOf(b0, b1) : bytesOf(b0));
            else if (family === 'jis') u = eucjp.decode(bytesOf(b0 | 0x80, b1 | 0x80));
            else u = null;
            if (u === '�') u = null;
          }
          const w = family === 'identity' ? (widths.get(code) ?? dw) : (n === 1 || (u && u.charCodeAt(0) < 0x2e80) ? 500 : 1000);
          out.push({ u, w, sp: false });
        }
        return out;
      },
    };
  } else {
    const first = doc.r(d.get('FirstChar')) ?? 0;
    const widths = doc.r(d.get('Widths'));
    const diffs = new Map();
    if (enc instanceof Map) {
      const arr = doc.r(enc.get('Differences'));
      if (Array.isArray(arr)) { let c = 0; for (const x of arr) { const v = doc.r(x); if (typeof v === 'number') c = v; else if (v instanceof Name) diffs.set(c++, v.name); } }
    }
    const fd = doc.r(d.get('FontDescriptor'));
    const missing = doc.r(fd?.get('MissingWidth')) ?? 0;
    font = {
      vertical: false,
      key: subtype + '/' + (enc instanceof Map ? 'Differences' : enc?.name ?? '符号なし') + '/' + (toUni ? 'ToUnicode' : 'ToUnicode無し'),
      decode(bin) {
        const out = [];
        for (let i = 0; i < bin.length; i++) {
          const c = bin.charCodeAt(i);
          let u = toUni?.map.get(c) ?? null;
          if (u === null || u === undefined) {
            if (diffs.has(c)) u = glyphName(diffs.get(c));
            else if (subtype === 'Type3') u = null;
            else if (c >= 32 && c < 127) u = String.fromCharCode(c);
            else if (c >= 128) u = win1252.decode(bytesOf(c));
          }
          const wv = Array.isArray(widths) ? doc.r(widths[c - first]) : undefined;
          out.push({ u: u ?? null, w: typeof wv === 'number' ? (subtype === 'Type3' ? wv * 1000 * (doc.r(d.get('FontMatrix'))?.[0] ?? 0.001) : wv) : missing || 500, sp: c === 32 });
        }
        return out;
      },
    };
  }
  font.ordering = doc.r(doc.r(doc.r(d.get('DescendantFonts'))?.[0])?.get('CIDSystemInfo'))?.get?.('Ordering');
  doc.fonts.set(key, font);
  return font;
}

// ---- 中身の実行 ----
const I = [1, 0, 0, 1, 0, 0];
const mul = (a, b) => [
  a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3],
  a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3],
  a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5],
];
const isMatrix = (a) => Array.isArray(a) && a.length === 6 && a.every((x) => typeof x === 'number');

async function runContent(doc, bin, res, sink, ctm0, depth, active, tr0 = 0) {
  const ctx = doc.ctx, { limits } = ctx;
  const tally = { values: 0, limits }; // 演算子の引数は実行すると捨てるので、演算子ごとに数え直す
  const lx = new Lex(bin, 0, bin.length, false, tally);
  const st = [], stack = [];
  let g = { ctm: ctm0, font: null, fs: 0, tc: 0, tw: 0, tz: 1, tl: 0, rise: 0, tr: tr0 };
  let tm = I, tlm = I;
  const fontsOf = () => doc.r(doc.r(res)?.get?.('Font'));
  const xobjOf = () => doc.r(doc.r(res)?.get?.('XObject'));

  const show = (raw) => {
    if (!g.font) { sink.noFont += raw.length; return; }
    // 1字は多くて2バイト。長い並びを字の配列にする前に、バイトの数で見る
    const overLimit = (n) => sink.glyphs + n > limits.pageChars || ctx.glyphs + n > limits.docChars;
    if (overLimit(raw.length / 2)) throw new PdfError('too-big', '字が多すぎます');
    const glyphs = g.font.decode(raw);
    if (overLimit(glyphs.length)) throw new PdfError('too-big', '字が多すぎます');
    sink.glyphs += glyphs.length;
    ctx.glyphs += glyphs.length;
    for (const gl of glyphs) {
      const trm = mul([g.fs * g.tz, 0, 0, g.fs, 0, g.rise], mul(tm, g.ctm));
      const hx = Math.hypot(trm[0], trm[1]), hy = Math.hypot(trm[2], trm[3]);
      const ang = ((Math.round(Math.atan2(trm[1], trm[0]) * 180 / Math.PI / 90) * 90) % 360 + 360) % 360;
      if (gl.u !== ' ' && gl.u !== '　' && gl.u !== ' ') {
        // Tr 3(見えない字)・7(切り抜きだけの字)は文に入れず、数だけ残す
        if (g.tr === 3 || g.tr === 7) sink.hidden++;
        else sink.push({ x: trm[4], y: trm[5], w: gl.w / 1000 * hx, h: hy, u: gl.u, rot: ang, v: g.font.vertical });
      }
      if (g.font.vertical) {
        tm = mul([1, 0, 0, 1, 0, -g.fs + -(g.tc + (gl.sp ? g.tw : 0))], tm);
      } else {
        const adv = (gl.w / 1000 * g.fs + g.tc + (gl.sp ? g.tw : 0)) * g.tz;
        tm = mul([1, 0, 0, 1, adv, 0], tm);
      }
    }
  };
  const nextLine = (x, y) => { tlm = mul([1, 0, 0, 1, x, y], tlm); tm = tlm; };

  for (;;) {
    const from = lx.p;
    const v = lx.value();
    if (v === undefined) break;
    if ((ctx.spins += 1 + lx.p - from) >= SPINS) await breathe(ctx);
    if (!(v instanceof Op)) { st.push(v); if (st.length > limits.stack) { st.length = 0; tally.values = 0; } continue; }
    switch (v.op) {
      case 'q': stack.push({ ...g }); if (stack.length > 512) stack.shift(); break;
      case 'Q': if (stack.length) g = stack.pop(); break;
      case 'cm': if (isMatrix(st.slice(-6))) g.ctm = mul(st.slice(-6), g.ctm); break;
      case 'BT': tm = I; tlm = I; break;
      case 'ET': break;
      case 'Tc': g.tc = st.at(-1) ?? 0; break;
      case 'Tw': g.tw = st.at(-1) ?? 0; break;
      case 'Tz': g.tz = (st.at(-1) ?? 100) / 100; break;
      case 'TL': g.tl = st.at(-1) ?? 0; break;
      case 'Ts': g.rise = st.at(-1) ?? 0; break;
      case 'Tr': g.tr = st.at(-1) ?? 0; break;
      case 'Tf': {
        const name = st.at(-2)?.name;
        g.fs = st.at(-1) ?? 0;
        const fr = fontsOf()?.get?.(name);
        g.font = fr !== undefined ? await loadFont(doc, fr) : null;
        if (g.font) g.fontKey = g.font.key;
        break;
      }
      case 'Td': nextLine(st.at(-2) ?? 0, st.at(-1) ?? 0); break;
      case 'TD': g.tl = -(st.at(-1) ?? 0); nextLine(st.at(-2) ?? 0, st.at(-1) ?? 0); break;
      case 'Tm': { const m = st.slice(-6); if (isMatrix(m)) { tm = m; tlm = m; } break; }
      case 'T*': nextLine(0, -g.tl); break;
      case 'Tj': if (typeof st.at(-1) === 'string') { const n = sink.length; show(st.at(-1)); countFont(doc, g.fontKey, sink.length - n); } break;
      case "'": nextLine(0, -g.tl); if (typeof st.at(-1) === 'string') { const n = sink.length; show(st.at(-1)); countFont(doc, g.fontKey, sink.length - n); } break;
      case '"': g.tw = st.at(-3) ?? g.tw; g.tc = st.at(-2) ?? g.tc; nextLine(0, -g.tl); if (typeof st.at(-1) === 'string') { const n = sink.length; show(st.at(-1)); countFont(doc, g.fontKey, sink.length - n); } break;
      case 'TJ': {
        const a = st.at(-1);
        if (Array.isArray(a)) {
          const n = sink.length;
          for (const e of a) {
            if (typeof e === 'string') show(e);
            else if (typeof e === 'number') {
              const adj = -e / 1000 * g.fs;
              tm = mul(g.font?.vertical ? [1, 0, 0, 1, 0, adj] : [1, 0, 0, 1, adj * g.tz, 0], tm);
            }
            if (++ctx.spins >= SPINS) await breathe(ctx);
          }
          countFont(doc, g.fontKey, sink.length - n);
        }
        break;
      }
      case 'Do': {
        const name = st.at(-1)?.name;
        const xr = xobjOf()?.get?.(name);
        const id = xr instanceof Ref ? xr.n : null;
        const entry = id !== null ? doc.objs.get(id) : null;
        if (!entry?.v?.get) break;
        const sub = doc.r(entry.v.get('Subtype'))?.name;
        if (sub === 'Image') {
          const c = g.ctm;
          sink.imageArea += Math.abs(c[0] * c[3] - c[1] * c[2]);
        } else if (sub === 'Form') {
          if (++ctx.forms > limits.formDo) throw new PdfError('too-big', 'Form の呼び出しが多すぎます');
          if (depth >= limits.depth || active.has(id)) break;
          const data = await doc.stream(entry);
          if (data) {
            const mx = doc.r(entry.v.get('Matrix'));
            const m = isMatrix(mx) ? mul(mx, g.ctm) : g.ctm;
            active.add(id);
            await runContent(doc, toBinary(data), entry.v.get('Resources') ?? res, sink, m, depth + 1, active, g.tr);
            active.delete(id);
          }
        }
        break;
      }
      case 'ID': {
        const re = /[\s\0]EI(?=[\s\0]|$)/g;
        re.lastIndex = lx.p;
        const m = re.exec(bin);
        lx.p = m ? m.index + 3 : bin.length;
        break;
      }
      default: break;
    }
    st.length = 0;
    tally.values = 0;
  }
}
function countFont(doc, key, n) {
  if (!key || !n) return;
  doc.fontStats.set(key, (doc.fontStats.get(key) ?? 0) + n);
}

// ---- 並べ直し ----
const isCjk = (u) => /^[぀-ヿ㐀-鿿豈-﫿]$/.test(u ?? '');

// 均等割付(「氏　　名」)の1字ずつの並びをつなぐ。隣の字との間が同じくらいで、語がすべて1字のときだけ
function joinSpread(tokens) {
  const out = [];
  for (let i = 0; i < tokens.length;) {
    let j = i;
    while (j + 1 < tokens.length && tokens[j].text.length === 1 && tokens[j + 1].text.length === 1 && isCjk(tokens[j].text) && isCjk(tokens[j + 1].text) && tokens[j + 1].sep === ' '
      && (j === i || Math.abs(tokens[j + 1].gap - tokens[j].gap) <= 0.25 * Math.max(tokens[j].gap, tokens[j + 1].gap))) j++;
    if (j > i) { out.push({ ...tokens[i], text: tokens.slice(i, j + 1).map((t) => t.text).join('') }); i = j + 1; } else out.push(tokens[i++]);
  }
  return out;
}

function lineText(cs) {
  cs.sort((a, b) => a.X - b.X);
  const tokens = [];
  let prev = null, cur = null;
  for (const c of cs) {
    if (prev) {
      if (c.u === prev.u && Math.abs(c.X - prev.X) < 0.2 * c.h) continue; // 重ね打ちの太字
      const gap = c.X - (prev.X + prev.w), h = Math.max(c.h, prev.h);
      if (gap > 0.25 * h) {
        cur = { text: '', gap, sep: gap > 1.6 * h ? '\t' : ' ' };
        tokens.push(cur);
      }
    }
    if (!cur) { cur = { text: '', gap: 0, sep: '' }; tokens.push(cur); }
    cur.text += c.u ?? '�';
    prev = c;
  }
  return joinSpread(tokens).map((t, i) => (i ? t.sep : '') + t.text).join('');
}

function groupLines(cs) {
  cs.sort((a, b) => b.Y - a.Y || a.X - b.X);
  const lines = [];
  let cur = null;
  for (const c of cs) {
    if (cur && Math.abs(c.Y - cur.y) <= 0.5 * Math.max(c.h, cur.h)) cur.cs.push(c);
    else { cur = { y: c.Y, h: c.h, cs: [c] }; lines.push(cur); }
  }
  return lines.map((l) => lineText(l.cs));
}

function rotatePoint(c, deg) {
  if (deg === 0) return [c.x, c.y];
  if (deg === 90) return [c.y, -c.x];
  if (deg === 180) return [-c.x, -c.y];
  return [-c.y, c.x];
}

function layout(chars) {
  const count = new Map();
  for (const c of chars) if (!c.v) count.set(c.rot, (count.get(c.rot) ?? 0) + 1);
  let main = 0, best = -1;
  for (const [k, n] of count) if (n > best) { best = n; main = k; }
  const groups = new Map();
  for (const c of chars) {
    const k = c.v ? 'v' : c.rot;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(c);
  }
  const out = [];
  const order = [main, ...[...groups.keys()].filter((k) => k !== main)];
  for (const k of order) {
    const cs = groups.get(k);
    if (!cs) continue;
    if (k === 'v') {
      // 縦書き: 右の列から、上から
      const cols = [];
      cs.sort((a, b) => b.x - a.x || b.y - a.y);
      let col = null;
      for (const c of cs) {
        if (col && Math.abs(c.x - col.x) <= 0.5 * c.h) col.cs.push(c);
        else { col = { x: c.x, cs: [c] }; cols.push(col); }
      }
      for (const cl of cols) out.push(cl.cs.sort((a, b) => b.y - a.y).map((c) => c.u ?? '�').join(''));
      continue;
    }
    for (const c of cs) { const [X, Y] = rotatePoint(c, k); c.X = X; c.Y = Y; }
    out.push(...groupLines(cs));
  }
  return out.join('\n');
}

// 康熙部首の字だけを常用の字に戻す。文の全体に NFKC は掛けない(全角の数字などが変わるため)
const fromKangxi = (t) => t.replace(/[\u2F00-\u2FD5]/g, (c) => c.normalize('NFKC'));

// ---- 入口 ----
// options: limits(LIMITS の一部を上書きする)・onProgress(page, pageCount)(頁を読み始めるごとに呼ぶ。無くてもよい)
export async function readPdf(input, options) {
  try {
    const limits = { ...LIMITS, ...options?.limits };
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    if (bytes.length > limits.file) return { status: 'too-big', pageCount: 0, pages: [], text: '', stats: {} };
    if (toBinary(bytes.subarray(0, 1024)).indexOf('%PDF-') < 0) return { status: 'not-pdf', pageCount: 0, pages: [], text: '', stats: {} };
    const doc = new Doc(bytes, limits), { ctx } = doc;
    await doc.load();
    if (doc.encrypted) return { status: 'encrypted', pageCount: 0, pages: [], text: '', stats: {} };
    // 末尾の %%EOF が無い物は途中で切れた物。残った頁だけを ok にすると、欠けたことが分からない
    if (!doc.s.slice(-1024).includes('%%EOF')) return { status: 'broken', pageCount: 0, pages: [], text: '', stats: {} };
    const list = doc.pages();
    if (!list.length) return { status: 'broken', pageCount: 0, pages: [], text: '', stats: {} };
    const pages = [];
    for (let i = 0; i < list.length; i++) {
      await breathe(ctx);
      options?.onProgress?.(i + 1, list.length);
      const pg = list[i];
      const sink = [];
      sink.imageArea = 0; sink.noFont = 0; sink.hidden = 0; sink.glyphs = 0;
      const cv = doc.r(pg.node.get('Contents'));
      const ids = Array.isArray(cv) ? cv : pg.node.get('Contents') !== undefined ? [pg.node.get('Contents')] : [];
      const parts = [];
      for (const id of ids) {
        if (++ctx.spins >= SPINS) await breathe(ctx);
        const entry = id instanceof Ref ? doc.objs.get(id.n) : null;
        if (entry?.start === undefined) continue;
        const data = await doc.stream(entry);
        if (data) parts.push(toBinary(data));
      }
      const box = doc.r(pg.CropBox) ?? doc.r(pg.MediaBox);
      const area = Array.isArray(box) && box.length === 4 ? Math.abs((doc.r(box[2]) - doc.r(box[0])) * (doc.r(box[3]) - doc.r(box[1]))) : 0;
      await runContent(doc, parts.join('\n'), pg.Resources, sink, I, 0, new Set());
      const unmapped = sink.reduce((n, c) => n + (c.u === null ? 1 : 0), 0);
      const cover = area ? Math.min(1, sink.imageArea / area) : 0;
      pages.push({ page: i + 1, text: fromKangxi(layout(sink)), chars: sink.length, unmapped, hidden: sink.hidden, imageCover: cover, scanLike: sink.length < 20 && cover > 0.4 });
    }
    const chars = pages.reduce((n, p) => n + p.chars, 0), unmapped = pages.reduce((n, p) => n + p.unmapped, 0);
    const scanPages = pages.filter((p) => p.scanLike).length;
    const status = chars === 0 ? 'no-text' : unmapped / chars > 0.05 ? 'unmapped' : scanPages ? 'partial' : 'ok';
    return {
      status, pageCount: pages.length, pages,
      text: pages.map((p) => p.text).join('\n\f\n'),
      stats: {
        chars, unmapped, scanPages,
        hidden: pages.reduce((n, p) => n + p.hidden, 0),
        fonts: Object.fromEntries(doc.fontStats),
        damagedStreams: doc.ctx.damagedStreams,
        unknownFilters: [...doc.ctx.unknownFilters],
        inflated: doc.ctx.inflated,
      },
    };
  } catch (e) {
    if (e instanceof PdfError) return { status: e.kind, pageCount: 0, pages: [], text: '', stats: {} };
    return { status: 'broken', pageCount: 0, pages: [], text: '', stats: { error: String(e?.message ?? e).slice(0, 200) } };
  }
}

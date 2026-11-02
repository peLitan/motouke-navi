// 受け入れテストの共通部品(テストの値はすべて架空)
// 条件の番号との対応は docs/acceptance-map.md を見る。
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const p = (...xs) => path.join(ROOT, ...xs);
export const exists = (rel) => fs.existsSync(p(rel));
export const readText = (rel) => fs.readFileSync(p(rel), 'utf8');
export const readJson = (rel) => JSON.parse(readText(rel));
export const load = (rel) => import(pathToFileURL(p(rel)).href);

export const LAW = {
  kensetsu: '建設業法',
  rei: '建設業法施行令',
  nyukei: '公共工事の入札及び契約の適正化の促進に関する法律',
};
export const LAW_ID = {
  建設業法: '324AC0000000100',
  建設業法施行令: '331CO0000000273',
  公共工事の入札及び契約の適正化の促進に関する法律: '412AC0000000127',
};

// 空白(半角・全角・改行・タブ)だけを取り除いて比べる
export const norm = (s) => String(s ?? '').replace(/[\s\u3000]+/g, '');

// 出典の一覧と本文
export function loadSources() {
  const index = readJson('data/sources/index.json');
  const list = index.sources;
  const texts = {};
  for (const s of list) if (s.file) texts[s.id] = fs.readFileSync(p('data/sources', s.file), 'utf8');
  return { list, texts, byId: Object.fromEntries(list.map((s) => [s.id, s])) };
}

export function findLawSource(sources, law, article) {
  return sources.list.find((s) => s.kind === 'law' && s.law === law && String(s.article) === String(article));
}

// 抜き書きが、その出典の原文に(空白の違いを除いて)そのまま入っているか
export function quoteInText(quote, text) {
  const q = norm(quote);
  return q.length > 0 && norm(text).includes(q);
}

// 条の原文から、第 n 項の文を取り出す。
// 原文のファイルは、第2項以降を行の頭の項の番号(「２」「2」など)で始める(e-Gov の表示と同じ)。第1項は条の頭から第2項の前まで。
export function paragraphText(text, n) {
  n = Number(n);
  if (!Number.isInteger(n) || n < 1) return null;
  const toHalf = (x) => x.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
  const lines = String(text).split(/\r?\n/);
  const starts = [0];
  let next = 2;
  lines.forEach((l, i) => { const m = toHalf(l).match(/^[\s　]*(\d+)[\s　]/); if (m && Number(m[1]) === next) { starts.push(i); next++; } });
  if (n > starts.length) return null;
  return lines.slice(starts[n - 1], n < starts.length ? starts[n] : lines.length).join('\n');
}

// 根拠 {law, article, paragraph, quote} が、取得した原文のその項に実在するか
export function basisVerified(sources, b) {
  if (!b || !b.law || !b.article || !b.quote) return false;
  const s = findLawSource(sources, b.law, b.article);
  if (!s || !sources.texts[s.id]) return false;
  const para = paragraphText(sources.texts[s.id], b.paragraph);
  return para !== null && quoteInText(b.quote, para);
}

// 例外・参照の語(F02-3 と同じ5つ。「読み替える」なども含む)
export const EXCEPTION_RE = /ただし|を除き|この限りでない|準用|読み替/;

const KD = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
// 1〜9999 を漢数字(法令の書き方: 二十四、百、千五百)にする
export function kanjiNum(n) {
  n = Number(n);
  if (!Number.isInteger(n) || n <= 0 || n >= 10000) throw new Error('kanjiNum: 範囲外 ' + n);
  const units = [[1000, '千'], [100, '百'], [10, '十']];
  let out = '';
  for (const [u, c] of units) {
    const d = Math.floor(n / u);
    if (d) out += (d === 1 ? '' : KD[d]) + c;
    n %= u;
  }
  return out + KD[n];
}
// "24の8" → "第二十四条の八"
export function kanjiArticle(a) {
  const [main, ...subs] = String(a).split('の');
  return '第' + kanjiNum(main) + '条' + subs.map((x) => 'の' + kanjiNum(x)).join('');
}
// "24の8" → "第24条の8"(画面の書き方)
export function articleLabel(a) {
  const [main, ...subs] = String(a).split('の');
  return '第' + main + '条' + subs.map((x) => 'の' + x).join('');
}
// 50000000 → "五千万円"、45000000 → "四千五百万円"(1万円単位の金額)
export function yenToKanji(yen) {
  if (yen % 10000 !== 0) throw new Error('yenToKanji: 1万円単位でない');
  let man = yen / 10000;
  const oku = Math.floor(man / 10000);
  man %= 10000;
  return (oku ? kanjiNum(oku) + '億' : '') + (man ? kanjiNum(man) + '万' : '') + '円';
}

// index.html の読み取り
export function indexHtml() { return readText('index.html'); }
export function scriptsOf(html) {
  return [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].map((m) => ({ attrs: m[1], code: m[2] }));
}
export function withoutScripts(html) { return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ''); }
export function hasId(html, id) { return new RegExp(`<[a-zA-Z][^>]*?(?<![\\w-])id\\s*=\\s*["']${id.replace(/[-]/g, '\\-')}["']`).test(html); }
// <label for="id">…</label> の中の文字
export function labelFor(html, id) {
  const m = html.match(new RegExp(`<label\\b[^>]*\\bfor\\s*=\\s*["']${id}["'][^>]*>([\\s\\S]*?)<\\/label>`, 'i'));
  return m ? m[1].replace(/<[^>]+>/g, '') : null;
}

// ブラウザに残す仕組みを使っていないか
export const STORAGE_RE = /\b(localStorage|sessionStorage|indexedDB|document\.cookie|caches\.open|openDatabase)\b/;

// 画面の「保証する」という言い切り(「保証ではありません」は許す)
export const GUARANTEE_RE = /を保証|保証(する|します|され|でき|いたし|付き|つき|済|。)/;

// 最小の zip を作る(.docx・.xlsx の試験用)。entries: [{name, data(string|Buffer), store?:bool}]
export function makeZip(entries) {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const locals = []; const centrals = []; let offset = 0;
  for (const e of entries) {
    const raw = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data, 'utf8');
    const method = e.store ? 0 : 8;
    const body = e.store ? raw : zlib.deflateRawSync(raw);
    const name = Buffer.from(e.name, 'utf8');
    const crc = crc32(raw);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(method, 8);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(body.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(name.length, 26);
    locals.push(lh, name, body);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(method, 10);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(body.length, 20); ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE(offset, 42);
    centrals.push(ch, name);
    offset += lh.length + name.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, cd, end]));
}

// zip を開く(試験用。中央ディレクトリから読み、保存・deflate の2つに対応)。返り値: [{name, data(Buffer)}]
export async function unzipForTest(bytes) {
  const buf = Buffer.from(bytes);
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('zip でない');
  const n = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const out = [];
  for (let k = 0; k < n; k++) {
    const method = buf.readUInt16LE(off + 10);
    const csize = buf.readUInt32LE(off + 20);
    const nlen = buf.readUInt16LE(off + 28), elen = buf.readUInt16LE(off + 30), clen = buf.readUInt16LE(off + 32);
    const local = buf.readUInt32LE(off + 42);
    const name = buf.slice(off + 46, off + 46 + nlen).toString('utf8');
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const body = buf.slice(start, start + csize);
    out.push({ name, data: method === 0 ? Buffer.from(body) : zlib.inflateRawSync(body) });
    off += 46 + nlen + elen + clen;
  }
  return out;
}

export const xmlEsc =(s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// .xlsx を作る。rows: 2次元配列(文字は共有文字列、数は数値のセル)
export function makeXlsx(rows) {
  const shared = [];
  const sidx = (s) => { let i = shared.indexOf(s); if (i < 0) { shared.push(s); i = shared.length - 1; } return i; };
  const col = (i) => String.fromCharCode(65 + i);
  const sheetRows = rows.map((r, ri) => `<row r="${ri + 1}">` + r.map((v, ci) => {
    if (v === null || v === undefined || v === '') return '';
    const ref = col(ci) + (ri + 1);
    return typeof v === 'number' ? `<c r="${ref}"><v>${v}</v></c>` : `<c r="${ref}" t="s"><v>${sidx(v)}</v></c>`;
  }).join('') + '</row>').join('');
  return makeZip([
    { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>' },
    { name: 'xl/workbook.xml', data: '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="台帳" sheetId="1" r:id="rId1"/></sheets></workbook>' },
    { name: 'xl/_rels/workbook.xml.rels', data: '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>' },
    { name: 'xl/worksheets/sheet1.xml', data: `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>` },
    { name: 'xl/sharedStrings.xml', data: `<?xml version="1.0" encoding="UTF-8"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${shared.length}" uniqueCount="${shared.length}">${shared.map((s) => `<si><t>${xmlEsc(s)}</t></si>`).join('')}</sst>` },
  ]);
}

// 今日の日付(YYYY-MM-DD、日本時間)
export function todayJst() {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

// ---- 画面のつながりの試験: index.html のスクリプトを node:vm と最小の DOM で動かす ----
// 画面のコードに求める約束(docs/acceptance-map.md にも書く):
//   スクリプトは別ファイルを読まない(import・export を含まない)。要素は getElementById か querySelector('#id') で取り、
//   addEventListener('click'|'change'|'input') か onclick で受け、入力は .value・.checked で読み書きし、
//   結果は innerHTML か textContent に書く。最初の処理は DOMContentLoaded か、すぐに動かす。
import vm from 'node:vm';

function makeEl(tag, attrs, doc) {
  const listeners = {};
  const attrMap = { ...attrs };
  const el = {
    tagName: String(tag).toUpperCase(), id: attrs.id || '', ownerDocument: doc,
    value: attrs.value ?? '', checked: 'checked' in attrs, disabled: 'disabled' in attrs, hidden: 'hidden' in attrs,
    _html: '', _text: '', children: [], style: {}, dataset: {}, files: [], options: [], selectedIndex: 0,
    classList: { _s: new Set(), add(...c) { c.forEach((x) => this._s.add(x)); }, remove(...c) { c.forEach((x) => this._s.delete(x)); }, toggle(c, f) { const on = f ?? !this._s.has(c); on ? this._s.add(c) : this._s.delete(c); return on; }, contains(c) { return this._s.has(c); } },
    get innerHTML() { return this._html; }, set innerHTML(v) { this._html = String(v); this._text = String(v).replace(/<[^>]+>/g, ''); },
    get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); }, set textContent(v) { this._text = String(v ?? ''); this._html = this._text.replace(/&/g, '&amp;').replace(/</g, '&lt;'); this.children = []; },
    get innerText() { return this.textContent; }, set innerText(v) { this.textContent = v; },
    get outerHTML() { return this._html; },
    addEventListener(t, f) { (listeners[t] ||= []).push(f); }, removeEventListener(t, f) { listeners[t] = (listeners[t] || []).filter((x) => x !== f); },
    dispatchEvent(ev) {
      ev.target ||= el; ev.currentTarget = el;
      for (const f of listeners[ev.type] || []) f.call(el, ev);
      const h = el['on' + ev.type]; if (typeof h === 'function') h.call(el, ev);
      if (ev.bubbles !== false && el !== doc._root && doc._bubble) doc._bubble(ev); // document・window へ泡立つ
      return !ev.defaultPrevented;
    },
    click() { el.dispatchEvent(makeEvent('click')); },
    setAttribute(k, v) { attrMap[k] = String(v); if (k === 'id') el.id = String(v); }, getAttribute(k) { return attrMap[k] ?? null; }, removeAttribute(k) { delete attrMap[k]; }, hasAttribute(k) { return k in attrMap; },
    appendChild(c) { el.children.push(c); return c; }, append(...cs) { cs.forEach((c) => el.children.push(typeof c === 'string' ? { textContent: c } : c)); }, prepend(...cs) { el.append(...cs); },
    replaceChildren(...cs) { el.children = []; el._html = ''; el._text = ''; el.append(...cs); }, removeChild(c) { el.children = el.children.filter((x) => x !== c); return c; }, remove() {},
    insertAdjacentHTML(_p, h) { el.innerHTML = el._html + h; },
    querySelector(sel) { return doc.querySelector(sel); }, querySelectorAll() { return []; }, closest() { return null; },
    focus() {}, blur() {}, select() {}, scrollIntoView() {},
  };
  return el;
}
function makeEvent(type, init = {}) { return { type, bubbles: init.bubbles ?? true, detail: init.detail, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {}, stopImmediatePropagation() {}, target: null }; }
const settle = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r)); };

export function runPage(html = indexHtml()) {
  const doc = { readyState: 'loading' };
  const byId = {};
  // 要素(id つき)を拾う。select は selected の option か最初の option の値、textarea は中身を値にする
  for (const m of html.matchAll(/<([a-zA-Z][\w-]*)\b([^>]*?)(?<![\w-])id\s*=\s*["']([^"']+)["']([^>]*)>/g)) {
    const attrs = {};
    for (const a of (m[2] + ' ' + m[4]).matchAll(/([\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) attrs[a[1]] = a[2] ?? a[3] ?? a[4] ?? '';
    attrs.id = m[3];
    const el = makeEl(m[1], attrs, doc);
    const rest = html.slice(m.index + m[0].length);
    if (/^select$/i.test(m[1])) {
      const body = rest.slice(0, rest.search(/<\/select>/i));
      const opts = [...body.matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/gi)].map((o) => ({ value: (o[1].match(/value\s*=\s*["']([^"']*)["']/) || [])[1] ?? o[2].trim(), selected: /\bselected\b/.test(o[1]), text: o[2].trim() }));
      el.options = opts;
      const sel = opts.find((o) => o.selected) || opts[0];
      el.value = sel ? sel.value : '';
    } else if (/^textarea$/i.test(m[1])) {
      el.value = rest.slice(0, rest.search(/<\/textarea>/i)).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    }
    byId[m[3]] = el;
  }
  const docListeners = {};
  Object.assign(doc, {
    getElementById: (id) => byId[id] || null,
    querySelector: (sel) => (/^#[\w-]+$/.test(sel) ? byId[sel.slice(1)] || null : null),
    querySelectorAll: (sel) => (/^#[\w-]+$/.test(sel) && byId[sel.slice(1)] ? [byId[sel.slice(1)]] : []),
    createElement: (t) => makeEl(t, {}, doc), createTextNode: (t) => ({ textContent: String(t) }),
    createDocumentFragment: () => makeEl('fragment', {}, doc),
    addEventListener: (t, f) => (docListeners[t] ||= []).push(f), removeEventListener() {},
    body: makeEl('body', {}, doc), head: makeEl('head', {}, doc), documentElement: makeEl('html', {}, doc), title: '',
  });
  const winListeners = {};
  const printed = { count: 0 };
  const blobs = [];
  doc._root = null;
  doc._bubble = (ev) => {
    for (const f of docListeners[ev.type] || []) f.call(doc, ev);
    for (const f of winListeners[ev.type] || []) f.call(ctx, ev);
  };
  class Ev { constructor(type, init = {}) { Object.assign(this, makeEvent(type, init)); } }
  const ctx = {
    document: doc, console, setTimeout: (f) => { f(); return 0; }, clearTimeout() {}, queueMicrotask: (f) => queueMicrotask(f),
    setInterval: () => 0, clearInterval() {}, requestAnimationFrame: (f) => { f(0); return 0; }, cancelAnimationFrame() {},
    alert() {}, confirm: () => true, print() { printed.count++; },
    addEventListener: (t, f) => (winListeners[t] ||= []).push(f), removeEventListener() {},
    Event: Ev, CustomEvent: Ev, getComputedStyle: () => ({ getPropertyValue: () => '' }),
    FileReader: class { readAsText(b) { this.result = b?.parts ? b.parts.join('') : String(b ?? ''); this.onload?.({ target: this }); } readAsArrayBuffer(b) { this.result = new ArrayBuffer(0); this.onload?.({ target: this }); } addEventListener(t, f) { this['on' + t] = f; } },
    Blob: class { constructor(parts, opts) { this.parts = parts; this.type = opts?.type; blobs.push(this); } async text() { return this.parts.join(''); } },
    URL: { createObjectURL: () => 'blob:example', revokeObjectURL() {} },
    TextEncoder, TextDecoder, Intl, structuredClone,
    navigator: { userAgent: 'node-test' }, location: { href: 'file:///index.html', protocol: 'file:' },
  };
  ctx.window = ctx; ctx.self = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  for (const s of scriptsOf(html)) {
    if (/type\s*=\s*["'](?!text\/javascript|module)[^"']+["']/i.test(s.attrs)) continue; // JSON などのデータは飛ばす
    vm.runInContext(s.code, ctx, { filename: 'index.html' });
  }
  doc.readyState = 'complete';
  for (const f of docListeners.DOMContentLoaded || []) f(makeEvent('DOMContentLoaded'));
  for (const f of winListeners.DOMContentLoaded || []) f(makeEvent('DOMContentLoaded'));
  for (const f of winListeners.load || []) f(makeEvent('load'));
  const get = (id) => { const e = byId[id]; if (!e) throw new Error('画面に id が無い: ' + id); return e; };
  // set と click は非同期(async の handler を待つ)。テストは await で呼ぶ
  return {
    el: get, printed, blobs,
    async set(id, v) { const e = get(id); if (typeof v === 'boolean') e.checked = v; else e.value = String(v); e.dispatchEvent(makeEvent('input')); e.dispatchEvent(makeEvent('change')); await settle(); },
    async click(id) {
      const e = get(id);
      const ev = makeEvent('click');
      const go = e.dispatchEvent(ev);
      // type="submit" のボタン(button の既定も submit)は、ページの form に submit を送る
      const isSubmit = e.tagName === 'BUTTON' ? (e.getAttribute('type') || 'submit') === 'submit' : e.getAttribute('type') === 'submit';
      if (go && isSubmit) for (const f of Object.values(byId).filter((x) => x.tagName === 'FORM')) f.dispatchEvent(makeEvent('submit'));
      await settle();
    },
    text(id) { const e = get(id); return (e.textContent + ' ' + e.innerHTML.replace(/<[^>]+>/g, ' ')).replace(/&amp;/g, '&'); },
  };
}

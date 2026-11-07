// 置き換えの部品(F11c): .txt・.docx・.xlsx と文字の入った PDF のファイルから文字を取り出す。
// 外の部品(ライブラリ)は使わない。zip の展開は、ブラウザと Node に標準である DecompressionStream('deflate-raw') を使う。
// 取り出すのは文字だけ。書式・画像・埋め込みのファイルは読まない。
// 返すのは1つの文字列(段落・行ごとに改行、表のセルはタブで区切る)。PDF は頁の間に区切りの行を入れる。
import { readPdf } from '../pdf-read.mjs';

export const MASK_FILE_TYPES = ['.txt', '.docx', '.xlsx', '.pdf'];

const MAX_FILE = 30 * 1024 * 1024;       // 読むファイルの大きさの上限
const MAX_ENTRY = 50 * 1024 * 1024;      // zip の中の1つのファイルを開いた後の大きさの上限(展開しすぎを防ぐ)

const extOf = (name) => {
  const m = String(name ?? '').toLowerCase().match(/\.[a-z0-9]+$/);
  return m ? m[0] : '';
};

const toBytes = (data) => {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  throw new Error('ファイルの中身が読めません(バイトの並びを渡してください)');
};

// ---- .txt ----
// ISO-2022-JP の文字集合を切り替える印(F85b)。この形式は全部が 7bit で UTF-8 として読めてしまい、漢字の名前が符号の字のまま欄に入る。
// 0x1B は UTF-8 でも Shift_JIS でも2バイトの字の途中に現れないので、バイトのまま探してよい。MCP の masked-files.mjs にも同じ一覧がある(読み込まない)
const ISO2022_MARKS = ['\x1b$B', '\x1b$@', '\x1b(J', '\x1b(B'];
const ISO2022_REFUSED = 'ISO-2022-JP のファイルは読めません。UTF-8 か Shift_JIS で保存し直してください。';
function hasIso2022Mark(b) {
  for (let i = b.indexOf(0x1b); i >= 0 && i + 2 < b.length; i = b.indexOf(0x1b, i + 1)) {
    if (ISO2022_MARKS.includes(String.fromCharCode(b[i], b[i + 1], b[i + 2]))) return true;
  }
  return false;
}

// UTF-8(BOM の有無どちらも)を先に試し、UTF-8 として読めなければ Shift_JIS として読む
export function decodeText(bytes) {
  if (hasIso2022Mark(bytes)) throw new Error(ISO2022_REFUSED);
  let b = bytes;
  if (b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) b = b.subarray(3);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(b);
  } catch {
    try {
      return new TextDecoder('shift_jis', { fatal: true }).decode(b);
    } catch {
      throw new Error('文字のファイルとして読めません(UTF-8 か Shift_JIS で保存してください)');
    }
  }
}

// ---- zip ----
const u16 = (b, o) => b[o] | (b[o + 1] << 8);
const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

async function inflateRaw(data, limit) {
  if (typeof DecompressionStream !== 'function') throw new Error('このブラウザでは .xlsx/.docx を開けません。文字をコピーして貼り付けてください');
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const reader = stream.getReader();
  const parts = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > limit) { await reader.cancel(); throw new Error('ファイルの中身が大きすぎます'); }
    parts.push(value);
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

// 読めないときの文。画面にそのまま出るので、zip の語を使わない(F83a2)
// 頭の語は台帳の口(src/ledger-xlsx.mjs)が言い換えるので、分けて出す(F84c)
export const NOT_OFFICE_HEAD = '.docx・.xlsx として読めません';
const NOT_OFFICE = NOT_OFFICE_HEAD + '(壊れているか、別の形のファイルです)。保存し直すか、元のファイルをもらってください。';

// zip の中央ディレクトリを読み、名前 → 取り出す関数 の表を返す
export function listZip(bytes) {
  const b = bytes;
  let eocd = -1;
  for (let i = b.length - 22; i >= 0 && i >= b.length - 22 - 0xffff; i--) {
    if (u32(b, i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error(NOT_OFFICE);
  const count = u16(b, eocd + 10);
  let off = u32(b, eocd + 16);
  const entries = new Map();
  for (let k = 0; k < count; k++) {
    if (off + 46 > b.length || u32(b, off) !== 0x02014b50) throw new Error(NOT_OFFICE);
    const flags = u16(b, off + 8);
    const method = u16(b, off + 10);
    const csize = u32(b, off + 20);
    const usize = u32(b, off + 24);
    const nlen = u16(b, off + 28), elen = u16(b, off + 30), clen = u16(b, off + 32);
    const local = u32(b, off + 42);
    const name = new TextDecoder('utf-8').decode(b.subarray(off + 46, off + 46 + nlen));
    entries.set(name, { flags, method, csize, usize, local });
    off += 46 + nlen + elen + clen;
  }
  return entries;
}

async function readEntry(bytes, entry, name) {
  if (entry.flags & 1) throw new Error('パスワードのかかったファイルは開けません(' + name + ')');
  const b = bytes;
  const lo = entry.local;
  if (lo + 30 > b.length || u32(b, lo) !== 0x04034b50) throw new Error(NOT_OFFICE);
  const start = lo + 30 + u16(b, lo + 26) + u16(b, lo + 28);
  const body = b.subarray(start, start + entry.csize);
  if (entry.method === 0) return body;
  if (entry.method === 8) return inflateRaw(body, MAX_ENTRY);
  throw new Error('この圧縮の形式には対応していません(' + name + ')');
}

async function readXml(bytes, entries, name) {
  const e = entries.get(name);
  if (!e) return null;
  return new TextDecoder('utf-8').decode(await readEntry(bytes, e, name));
}

// ---- XML ----
export function unescapeXml(s) {
  return String(s).replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (all, ent) => {
    if (ent === 'amp') return '&';
    if (ent === 'lt') return '<';
    if (ent === 'gt') return '>';
    if (ent === 'quot') return '"';
    if (ent === 'apos') return "'";
    const n = ent[1] === 'x' ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
    try { return String.fromCodePoint(n); } catch { return all; }
  });
}

const attr = (tag, key) => {
  const m = tag.match(new RegExp('\\s' + key + '\\s*=\\s*"([^"]*)"'));
  return m ? unescapeXml(m[1]) : null;
};

// ---- .docx ----
// 段落(w:p)ごとに1行。分かれた文字の塊(w:t)はつなぐ。w:tab はタブ、w:br・w:cr は改行。表のセルの段落もそれぞれ1行
function docxXmlToText(xml) {
  const body = xml.replace(/<w:(?:delText|instrText)\b[^>]*>[\s\S]*?<\/w:(?:delText|instrText)>/g, ''); // 消した文字・フィールドの命令は除く
  const lines = [];
  for (const pm of body.matchAll(/<w:p\b[^>]*?(?:\/>|>([\s\S]*?)<\/w:p>)/g)) {
    const inner = pm[1] || '';
    let line = '';
    for (const t of inner.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>|<w:t\b[^>]*\/>|<w:(tab|br|cr)\b[^>]*\/?>/g)) {
      if (t[2] === 'tab') line += '\t';
      else if (t[2]) line += '\n';
      else if (t[1] !== undefined) line += unescapeXml(t[1]);
    }
    lines.push(line);
  }
  return lines.join('\n');
}

async function extractDocx(bytes) {
  const entries = listZip(bytes);
  const main = await readXml(bytes, entries, 'word/document.xml');
  if (main === null) throw new Error('.docx の本文(word/document.xml)が見つかりません');
  const parts = [docxXmlToText(main)];
  // 頭書き・脚注・足書きにも名前が入ることがあるので、あれば後ろに足す
  const extra = [...entries.keys()].filter((n) => /^word\/(header\d*|footer\d*|footnotes|endnotes)\.xml$/.test(n)).sort();
  for (const n of extra) {
    const t = docxXmlToText(await readXml(bytes, entries, n)).trim();
    if (t) parts.push(t);
  }
  return parts.join('\n');
}

// ---- .xlsx ----
// 共有文字列: si ごとに、その中の t をつなぐ(ふりがな rPh は除く)
function sharedStrings(xml) {
  if (!xml) return [];
  return [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>|<si\b[^>]*\/>/g)].map((m) => {
    const inner = (m[1] || '').replace(/<rPh\b[^>]*>[\s\S]*?<\/rPh>/g, '');
    return [...inner.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((t) => unescapeXml(t[1])).join('');
  });
}

export const colIndex = (ref) => {
  const m = String(ref ?? '').match(/^([A-Z]+)/);
  if (!m) return null;
  let n = 0;
  for (const c of m[1]) n = n * 26 + (c.charCodeAt(0) - 64);
  return n - 1;
};

function sheetXmlToText(xml, shared) {
  const lines = [];
  for (const rm of xml.matchAll(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const cells = [];
    let next = 0;
    for (const cm of (rm[1] || '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const tag = '<c ' + cm[1];
      const inner = cm[2] || '';
      const ci = colIndex(attr(tag, 'r'));
      const at = ci === null ? next : ci;
      cells[at] = cellValue(tag, inner, shared).text;
      next = at + 1;
    }
    const line = Array.from(cells, (x) => x ?? '').join('\t').replace(/\t+$/, '');
    if (line) lines.push(line);
  }
  return lines.join('\n');
}

const resolvePath = (base, target) => {
  if (target.startsWith('/')) return target.slice(1);
  const parts = base.split('/').slice(0, -1);
  for (const seg of target.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg && seg !== '.') parts.push(seg);
  }
  return parts.join('/');
};

// .xlsx を開き、共有文字列と、ブックに書かれた順のシートの XML を返す(台帳の Excel の読み込み F04c でも使う)
export async function openXlsx(bytes) {
  const entries = listZip(bytes);
  const shared = sharedStrings(await readXml(bytes, entries, 'xl/sharedStrings.xml'));
  const wb = await readXml(bytes, entries, 'xl/workbook.xml');
  const rels = (await readXml(bytes, entries, 'xl/_rels/workbook.xml.rels')) || '';
  const relMap = new Map([...rels.matchAll(/<Relationship\b[^>]*>/g)].map((m) => [attr(m[0], 'Id'), attr(m[0], 'Target')]));
  // ブックに書かれたシートの順に読む。読めなければ、名前の順に xl/worksheets/ を読む
  let sheets = [];
  if (wb) {
    for (const m of wb.matchAll(/<sheet\b[^>]*>/g)) {
      const target = relMap.get(attr(m[0], 'r:id'));
      if (target) sheets.push({ name: attr(m[0], 'name') || '', path: resolvePath('xl/workbook.xml', target) });
    }
  }
  if (!sheets.length) {
    sheets = [...entries.keys()].filter((n) => /^xl\/worksheets\/[^/]+\.xml$/.test(n)).sort().map((n) => ({ name: '', path: n }));
  }
  if (!sheets.length) throw new Error('.xlsx の中にシートが見つかりません');
  const out = [];
  for (const s of sheets) {
    const xml = await readXml(bytes, entries, s.path);
    if (xml !== null) out.push({ name: s.name, xml });
  }
  return { shared, sheets: out };
}

// シートの XML のセルの値(共有文字列・インラインの文字・数・式の結果。ふりがなは除く)。数のセルは number も返す
export function cellValue(tag, inner, shared) {
  const type = attr(tag, 't');
  if (type === 'inlineStr') {
    return { text: [...inner.replace(/<rPh\b[^>]*>[\s\S]*?<\/rPh>/g, '').matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((t) => unescapeXml(t[1])).join(''), number: null };
  }
  const vm = inner.match(/<v\b[^>]*>([\s\S]*?)<\/v>/);
  const raw = vm ? unescapeXml(vm[1]) : '';
  if (type === 's') return { text: shared[Number(raw)] ?? '', number: null };
  if (type === 'b') return { text: raw === '1' ? 'TRUE' : raw === '0' ? 'FALSE' : raw, number: null };
  if ((type === null || type === 'n') && raw !== '' && Number.isFinite(Number(raw))) return { text: raw, number: Number(raw) };
  return { text: raw, number: null }; // 式の結果の文字(str)・エラー(e)はそのまま
}

async function extractXlsx(bytes) {
  const { shared, sheets } = await openXlsx(bytes);
  const out = [];
  for (const s of sheets) {
    const text = sheetXmlToText(s.xml, shared);
    if (sheets.length > 1) out.push('[シート: ' + s.name + ']');
    if (text) out.push(text);
  }
  return out.join('\n');
}

// ---- PDF ----
// 読めない PDF の文。理由と次の手を入れ、内部の語(status の名前)は出さない
const PDF_STOPS = {
  'no-text': '文字の入っていない PDF です(紙を写した画像だけ)。この画面は画像の文字を読みません。元の Excel・Word をもらうか、紙を見て入れてください。',
  encrypted: '保護(パスワードやコピーの禁止)のかかった PDF です。この画面は保護を解きません。文字の取れる版をもらうか、要る所を手で入れてください。',
  unmapped: '字の形しか入っていない PDF で、文字に戻せません(読むと化けます)。元の Word・Excel をもらってください。',
  broken: 'PDF が途中で切れているか壊れていて読めません。もう一度ダウンロードするか、送り直してもらってください。',
  'too-big': 'PDF が大きすぎて、途中で読むのをやめました。要る頁だけの PDF にしてください。',
  'not-pdf': 'PDF の形ではありません。名前が .pdf でも中身が違います。',
};
const TABLE_NOTE = '表は行や列の順が崩れることがあります。紙と見比べてください。';

// 続いた3頁以上は「2〜5」にまとめる。スキャンの頁が多い PDF で知らせの行が伸びないように
function pageList(nums) {
  const out = [];
  for (let i = 0, j; i < nums.length; i = j + 1) {
    j = i;
    while (nums[j + 1] === nums[j] + 1) j++;
    if (j - i >= 2) out.push(nums[i] + '〜' + nums[j]);
    else out.push(...nums.slice(i, j + 1));
  }
  return out.join('・');
}

async function extractPdf(bytes, onProgress) {
  const r = await readPdf(bytes, { onProgress });
  // 展開の機能が無いブラウザでは、圧縮された PDF が壊れた物に見える
  if (r.status === 'broken' && typeof DecompressionStream !== 'function') throw new Error('このブラウザでは PDF を開けません。文字をコピーして貼り付けてください');
  if (r.status !== 'ok' && r.status !== 'partial') throw new Error(PDF_STOPS[r.status] ?? PDF_STOPS.broken);
  // 空の頁にも区切りの行を置く。後ろの頁の番号が紙とずれないように
  const text = r.pages.map((p, i) => (i ? '―― ' + p.page + '頁 ――\n' : '') + p.text).join('\n');
  const unread = r.pages.filter((p) => p.scanLike).map((p) => p.page);
  const notes = [];
  if (unread.length) notes.push(r.pageCount + '頁のうち ' + unread.length + '頁(' + pageList(unread) + '頁目)は文字が無い(紙を写した画像)ので読めていません。');
  if (r.stats.hidden) notes.push('見えない字(' + r.stats.hidden + '字)は入れていません。');
  // 次の2つは status が ok のままでも起きる。字が欠けていても置き換えの前に気づけるように言う
  if (r.stats.unmapped) notes.push('字に戻せなかった字(' + r.stats.unmapped + '字)は「\uFFFD」のまま入れています。この字を探して紙と見比べてください。');
  if (r.stats.damagedStreams) notes.push('中身の一部が壊れていて、読めていない所があります。紙と見比べてください。');
  notes.push(TABLE_NOTE);
  return { text, notes, pages: r.pageCount };
}

// ファイルの名前(拡張子で形式を決める)と中身(Uint8Array か ArrayBuffer)から、文字と注意(notes)を取り出す。PDF は頁の数(pages)も返す
// onProgress(page, pageCount) は PDF の頁を読み始めるごとに呼ぶ
export async function extractFile(name, data, { onProgress } = {}) {
  const ext = extOf(name);
  if (!MASK_FILE_TYPES.includes(ext)) {
    throw new Error('対応していない形式です(' + (ext || '拡張子なし') + ')。読めるのは ' + MASK_FILE_TYPES.join('・') + ' です。.doc・.xls は、文字をコピーして貼り付けてください');
  }
  const bytes = toBytes(data);
  if (bytes.length > MAX_FILE) throw new Error('ファイルが大きすぎます(上限 ' + (MAX_FILE / 1024 / 1024) + 'MB)');
  if (ext === '.pdf') return extractPdf(bytes, onProgress);
  if (ext === '.txt') return { text: decodeText(bytes), notes: [] };
  if (ext === '.docx') return { text: await extractDocx(bytes), notes: [] };
  return { text: await extractXlsx(bytes), notes: [] };
}

export const extractText = async (name, data) => (await extractFile(name, data)).text;

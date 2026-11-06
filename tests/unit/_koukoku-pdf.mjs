// 合成の公告の PDF を組む試験の道具(値はすべて架空。ファイルは置かない)
import { deflateSync } from 'node:zlib';

const latin = (s) => Buffer.from(s, 'latin1');
const u16 = (c) => [...Buffer.from(c, 'utf16le').swap16()].map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();

function build(objs) {
  const parts = [latin('%PDF-1.7\n')];
  let off = parts[0].length;
  const xref = [];
  objs.forEach((o, i) => {
    xref.push(off);
    const b = Buffer.concat([latin(`${i + 1} 0 obj\n`), Buffer.isBuffer(o) ? o : latin(o), latin('\nendobj\n')]);
    parts.push(b);
    off += b.length;
  });
  const table = ['xref', `0 ${objs.length + 1}`, '0000000000 65535 f ', ...xref.map((n) => `${String(n).padStart(10, '0')} 00000 n `)].join('\n');
  parts.push(latin(`${table}\ntrailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${off}\n%%EOF\n`));
  return new Uint8Array(Buffer.concat(parts));
}

// pages は頁ごとの行の列。空の列は全面の画像の頁(紙を写した頁)。
// flate: false は圧縮しない。runPage の中には DecompressionStream が無いので、画面の試験はこちらを使う
export function koukokuPdf(pages, { flate = true } = {}) {
  const chars = [...new Set(pages.flat().join(''))];
  const code = (c) => (chars.indexOf(c) + 1).toString(16).padStart(4, '0');
  const hex = (s) => `<${[...s].map(code).join('')}>`;
  const stream = (data, dict = '') => {
    const raw = Buffer.isBuffer(data) ? data : latin(data);
    const body = flate ? deflateSync(raw) : raw;
    return Buffer.concat([latin(`<< ${dict}${flate ? ' /Filter /FlateDecode' : ''} /Length ${body.length} >>\nstream\n`), body, latin('\nendstream')]);
  };
  const cmap = `/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CMapName /X def 1 begincodespacerange <0000> <FFFF> endcodespacerange ${chars.length} beginbfchar\n${chars.map((c) => `<${code(c)}> <${u16(c)}>`).join('\n')}\nendbfchar endcmap end end`;
  const font = '<< /Type /Font /Subtype /Type0 /BaseFont /X /Encoding /Identity-H /ToUnicode 3 0 R /DescendantFonts [<< /Type /Font /Subtype /CIDFontType2 /BaseFont /X /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> >>] >>';
  const image = stream(Buffer.alloc(64, 0x80), '/Type /XObject /Subtype /Image /Width 8 /Height 8 /ColorSpace /DeviceGray /BitsPerComponent 8');
  const kids = pages.map((_, i) => 6 + i * 2);
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', `<< /Type /Pages /Kids [${kids.map((n) => `${n} 0 R`).join(' ')}] /Count ${kids.length} >>`, stream(cmap), font, image];
  pages.forEach((lines, i) => {
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> /XObject << /Im0 5 0 R >> >> /Contents ${7 + i * 2} 0 R >>`);
    const body = lines.length ? lines.map((line, n) => `BT /F1 10 Tf 72 ${780 - n * 14} Td ${hex(line)} Tj ET`).join('\n') : 'q 595 0 0 842 0 0 cm /Im0 Do Q';
    objs.push(stream(body));
  });
  return build(objs);
}

export const pdfFile = (name, bytes) => ({ name, size: bytes.length, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });

// 元請けの実績の文を含む公告と、含まない公告(架空)
export const PRIME_LINES = ['入札公告', '架空川 護岸工事', '(1) 平成29年度以降に元請けとして同種工事の施工実績を', '有すること。'];
export const NO_PRIME_LINES = ['入札公告', '架空川 護岸工事', '(1) 土木一式工事の等級がAであること。'];
export const PRIME_SENTENCE = '(1) 平成29年度以降に元請けとして同種工事の施工実績を有すること。';

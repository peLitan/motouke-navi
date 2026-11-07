// 公告の PDF を .txt にする道具(F82e)。試験の PDF はこの中で組み、ファイルは置かない(値はすべて架空)。通信しない
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { main, PDF_STOPS, USAGE, USAGE_LINE } from '../../plugin/skills/bid-intake/scripts/pdf-to-text.mjs';
import { PLUGIN_COPIES, staleCopies } from '../../scripts/sync-plugin.mjs';
import { checkConditionsFiles, readMasked } from '../../integration/claude-code/mcp/masked-files.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = path.join(ROOT, 'plugin/skills/bid-intake/scripts/pdf-to-text.mjs');
const SKILL = path.join(ROOT, 'plugin/skills/bid-intake/SKILL.md');
fs.mkdirSync(path.join(ROOT, 'tmp'), { recursive: true });
const WORK = fs.mkdtempSync(path.join(ROOT, 'tmp', 'pdf-to-text-'));
after(() => fs.rmSync(WORK, { recursive: true, force: true }));
const noChild = process.permission ? !process.permission.has('child') : false;
const childSkip = { skip: noChild && '子プロセスを許さない権限(init の試験)。node --test で確かめる' };

// ---- 試験の PDF を組む ----
const latin = (s) => Buffer.from(s, 'latin1');
const stream = (body, dict = '') => Buffer.concat([latin(`<< ${dict} /Length ${body.length} >>\nstream\n`), body, latin('\nendstream')]);

// xref の位置を数えて書く。objs は 1 から順の番号の中身
function build(objs, trailer = '') {
  const parts = [latin('%PDF-1.7\n')];
  let off = parts[0].length;
  const xref = objs.map((o, i) => {
    const b = Buffer.concat([latin(`${i + 1} 0 obj\n`), Buffer.isBuffer(o) ? o : latin(o), latin('\nendobj\n')]);
    parts.push(b);
    const at = off;
    off += b.length;
    return at;
  });
  const table = ['xref', `0 ${objs.length + 1}`, '0000000000 65535 f ', ...xref.map((n) => `${String(n).padStart(10, '0')} 00000 n `)].join('\n');
  parts.push(latin(`${table}\ntrailer\n<< /Size ${objs.length + 1} /Root 1 0 R ${trailer}>>\nstartxref\n${off}\n%%EOF\n`));
  return Buffer.concat(parts);
}

// 頁ごとに行の配列を渡す。null の頁は全面の画像だけ。字は番号 1.. を ToUnicode で字に当てる。
// hidden は頁の末尾に Tr 3(見えない字)で書く文、toUnicode: false は字に戻せない PDF、
// unmapped は ToUnicode に入れない字、damaged は圧縮を壊す頁の番号(1 から)
function pdf(pages, { trailer = '', hidden = '', toUnicode = true, unmapped = '', damaged = 0 } = {}) {
  const chars = [...new Set([...pages.flat().filter(Boolean).join(''), ...hidden])];
  const hex = (s) => `<${[...s].map((c) => (chars.indexOf(c) + 1).toString(16).padStart(4, '0')).join('')}>`;
  const be16 = (c) => Buffer.from(c, 'utf16le').swap16().toString('hex').toUpperCase();
  const cmap = `/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CMapName /X def 1 begincodespacerange <0000> <FFFF> endcodespacerange ${chars.length - [...unmapped].length} beginbfchar\n${chars.flatMap((c, i) => (unmapped.includes(c) ? [] : [`<${(i + 1).toString(16).padStart(4, '0')}> <${be16(c)}>`])).join('\n')}\nendbfchar endcmap CMapName currentdict /CMap defineresource pop end end`;
  const font = `<< /Type /Font /Subtype /Type0 /BaseFont /X /Encoding /Identity-H ${toUnicode ? '/ToUnicode 4 0 R ' : ''}/DescendantFonts [<< /Type /Font /Subtype /CIDFontType2 /BaseFont /X /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /DW 1000 >>] >>`;
  const image = stream(Buffer.alloc(64, 0x80), '/Type /XObject /Subtype /Image /Width 8 /Height 8 /ColorSpace /DeviceGray /BitsPerComponent 8');
  const first = 6;
  const kids = pages.map((_, i) => `${first + i * 2} 0 R`).join(' ');
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`, font, stream(deflateSync(latin(cmap)), '/Filter /FlateDecode'), image];
  pages.forEach((lines, i) => {
    const body = lines
      ? lines.map((line, n) => `BT /F1 12 Tf 72 ${780 - n * 20} Td ${hex(line)} Tj ET`).join('\n') + (hidden ? `\nBT 3 Tr /F1 12 Tf 72 100 Td ${hex(hidden)} Tj ET` : '')
      : 'q 595 0 0 842 0 0 cm /Im0 Do Q';
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> /XObject << /Im0 5 0 R >> >> /Contents ${first + i * 2 + 1} 0 R >>`);
    objs.push(stream(damaged === i + 1 ? latin('not a deflate stream') : deflateSync(latin(body)), '/Filter /FlateDecode'));
  });
  return build(objs, trailer);
}

const NOTICE = ['入札公告 架空市', '工事名 架空川護岸工事', '予定価格 金82,500,000円(消費税及び地方消費税の額を含む)'];
const TAIL = ['工事場所 架空市本町1丁目', '工期 契約の日の翌日から180日間'];

// ---- 実行の道具 ----
let seq = 0;
// 作業フォルダ1つ。files は { パス: 中身 }
function workdir(files = {}) {
  const dir = path.join(WORK, 'w' + ++seq);
  fs.mkdirSync(dir, { recursive: true });
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), body);
  }
  return dir;
}
async function run(dir, ...argv) {
  const out = []; const err = [];
  const code = await main(argv, { log: (s) => out.push(String(s)), error: (s) => err.push(String(s)), cwd: dir });
  return { code, out: out.join('\n'), err: err.join('\n') };
}
const hasFile = (dir, rel) => fs.existsSync(path.join(dir, rel));
const listAll = (dir) => fs.readdirSync(dir, { recursive: true }).map(String).sort();

// ---- 読める PDF ----
test('ok: 文を UTF-8 の .txt に書いて 0。頁の間に区切りの行を入れ、標準出力に頁の数と書いた先を言う', async () => {
  const dir = workdir({ '公告.pdf': pdf([NOTICE, TAIL]) });
  const r = await run(dir, '公告.pdf', '--out', '公告.txt');
  assert.equal(r.code, 0, r.err);
  const text = fs.readFileSync(path.join(dir, '公告.txt'), 'utf8');
  for (const line of [...NOTICE, ...TAIL]) assert.ok(text.includes(line), line);
  assert.ok(text.indexOf(NOTICE[2]) < text.indexOf('―― 2頁 ――'));
  assert.ok(text.indexOf('―― 2頁 ――') < text.indexOf(TAIL[0]));
  assert.ok(!text.includes('\f'));
  assert.ok(text.endsWith('\n'));
  assert.equal(text.charCodeAt(0) === 0xfeff, false);
  assert.match(r.out, /公告\.pdf/);
  assert.match(r.out, /2頁/);
  assert.match(r.out, /公告\.txt/);
  assert.doesNotMatch(r.err, /読めていません/);
  assert.match(r.err, /表は行や列の順が崩れる/); // 順が崩れうることは ok でも言う(F82b と同じ)
});

test('ok: --out は引数の順を問わず、無いフォルダは作る(読めたときだけ)', async () => {
  const dir = workdir({ '公告.pdf': pdf([NOTICE]) });
  assert.equal((await run(dir, '--out', 'tmp/下/公告.txt', '公告.pdf')).code, 0);
  assert.ok(hasFile(dir, 'tmp/下/公告.txt'));
});

test('ok: 見えない字(Tr 3)は .txt に入れず、数を標準エラーに言う', async () => {
  const dir = workdir({ '公告.pdf': pdf([NOTICE], { hidden: '甲野一郎' }) });
  const r = await run(dir, '公告.pdf', '--out', '公告.txt');
  assert.equal(r.code, 0);
  assert.ok(!fs.readFileSync(path.join(dir, '公告.txt'), 'utf8').includes('甲野'));
  assert.match(r.err, /見えない字\(4字\)/);
});

test('partial: 読めた頁を .txt に書いて 0。読めない頁の番号を標準エラーに言う。後ろの頁の番号はずれない', async () => {
  const dir = workdir({ '公告.pdf': pdf([NOTICE, null, TAIL]) });
  const r = await run(dir, '公告.pdf', '--out', '公告.txt');
  assert.equal(r.code, 0, r.err);
  assert.match(r.err, /3頁のうち 2頁は文字が無い/);
  assert.doesNotMatch(r.out, /読めていません/);
  const text = fs.readFileSync(path.join(dir, '公告.txt'), 'utf8');
  assert.ok(text.includes(NOTICE[1]) && text.includes(TAIL[0]));
  assert.ok(text.indexOf('―― 2頁 ――') < text.indexOf('―― 3頁 ――'));
  assert.ok(text.indexOf('―― 3頁 ――') < text.indexOf(TAIL[0]));
});

test('partial: 続いた3頁以上の読めない頁はまとめて言う', async () => {
  const dir = workdir({ '公告.pdf': pdf([NOTICE, null, null, null, TAIL, null]) });
  const r = await run(dir, '公告.pdf', '--out', '公告.txt');
  assert.equal(r.code, 0);
  assert.match(r.err, /6頁のうち 2〜4・6頁は文字が無い/);
});

test('ok のまま字が一部戻らないときは、数を標準エラーに言い、\uFFFD の字を入れる', async () => {
  const long = '工事の内容は架空川の護岸を直す工事で、延長は約百メートルの区間です。'.repeat(3);
  const dir = workdir({ '公告.pdf': pdf([[long]], { unmapped: '延' }) });
  const r = await run(dir, '公告.pdf', '--out', '公告.txt');
  assert.equal(r.code, 0, r.err);
  assert.match(r.err, /字に戻せなかった字\(3字\)/);
  assert.ok(fs.readFileSync(path.join(dir, '公告.txt'), 'utf8').includes('\uFFFD'));
});

test('中身の一部が壊れた頁があるときは、読めた頁を書いて標準エラーに言う', async () => {
  const dir = workdir({ '公告.pdf': pdf([NOTICE, TAIL], { damaged: 2 }) });
  const r = await run(dir, '公告.pdf', '--out', '公告.txt');
  assert.equal(r.code, 0, r.err);
  assert.match(r.err, /中身の一部が壊れていて/);
  assert.ok(fs.readFileSync(path.join(dir, '公告.txt'), 'utf8').includes(NOTICE[1]));
});

// ---- 読めない PDF ----
const REFUSED = [
  ['no-text', () => pdf([null]), /文字の入っていない PDF/, /元の Excel・Word/],
  ['encrypted', () => pdf([NOTICE], { trailer: '/Encrypt << /Filter /Standard >> ' }), /保護\(パスワードやコピーの禁止\)/, /文字の取れる版/],
  ['unmapped', () => pdf([NOTICE], { toUnicode: false }), /文字に戻せません/, /元の Word・Excel/],
  ['broken', () => Buffer.from('%PDF-1.4'), /途中で切れているか壊れて/, /もう一度ダウンロード/],
  ['not-pdf', () => Buffer.from('入札公告 架空市'), /PDF の形ではありません/, /中身が違います/],
];
for (const [status, make, reason, next] of REFUSED) {
  test(`${status}: .txt を書かず 1。理由と次の手を言い、内部の語を出さない`, async () => {
    const dir = workdir({ '公告.pdf': make() });
    const r = await run(dir, '公告.pdf', '--out', 'tmp/公告.txt');
    assert.equal(r.code, 1);
    assert.match(r.err, reason);
    assert.match(r.err, next);
    assert.equal(r.err, PDF_STOPS[status]);
    assert.equal(r.out, '');
    assert.deepEqual(listAll(dir), ['公告.pdf']); // フォルダも作らない
  });
}

test('読めないとき、前からある .txt は変えない', async () => {
  const dir = workdir({ '公告.pdf': pdf([null]), '公告.txt': '前の文' });
  assert.equal((await run(dir, '公告.pdf', '--out', '公告.txt')).code, 1);
  assert.equal(fs.readFileSync(path.join(dir, '公告.txt'), 'utf8'), '前の文');
});

test('読めない場合の文: 6つの status すべてにあり、内部の語が無い。画面の語を言わない', () => {
  assert.deepEqual(Object.keys(PDF_STOPS).sort(), ['broken', 'encrypted', 'no-text', 'not-pdf', 'too-big', 'unmapped']);
  for (const text of Object.values(PDF_STOPS)) {
    assert.doesNotMatch(text, /no-text|encrypted|unmapped|broken|too-big|not-pdf|status/);
    assert.doesNotMatch(text, /この画面/);
  }
});

test('30MB を越えるファイルは読まずに断る。ファイルの無いとき・フォルダのときも 1 で1行', async () => {
  const dir = workdir({ 'd/x.pdf': '%PDF-1.4' });
  fs.writeFileSync(path.join(dir, '大.pdf'), '');
  fs.truncateSync(path.join(dir, '大.pdf'), 30 * 1024 * 1024 + 1);
  const big = await run(dir, '大.pdf', '--out', 'a.txt');
  assert.equal(big.code, 1);
  assert.match(big.err, /ファイルが大きすぎます\(上限 30MB\)/);
  const none = await run(dir, '無い.pdf', '--out', 'a.txt');
  assert.equal(none.code, 1);
  assert.match(none.err, /ファイルがありません: 無い\.pdf/);
  const folder = await run(dir, 'd', '--out', 'a.txt');
  assert.equal(folder.code, 1);
  assert.match(folder.err, /ファイルではありません: d/);
  assert.ok(!hasFile(dir, 'a.txt'));
});

test('読む権限の無いファイルは 1 で1行', { skip: (process.platform === 'win32' || process.getuid?.() === 0) && '権限で読めなくできない' }, async () => {
  const dir = workdir({ '公告.pdf': pdf([NOTICE]) });
  fs.chmodSync(path.join(dir, '公告.pdf'), 0o000);
  const r = await run(dir, '公告.pdf', '--out', 'o.txt');
  assert.equal(r.code, 1);
  assert.match(r.err, /読めませんでした: 公告\.pdf/);
  assert.equal(r.err.split('\n').length, 1);
  assert.ok(!hasFile(dir, 'o.txt'));
});

// ---- raw/ ----
for (const rel of ['raw/x.pdf', 'RAW/x.pdf', 'Raw/工事A/x.pdf', '工事A/raw/x.pdf', 'raw./x.pdf', 'raw /x.pdf', 'raw:s/x.pdf', 'raw\\x.pdf']) {
  test(`raw の下の PDF を断る: ${rel}`, async () => {
    const dir = workdir({ [rel]: pdf([NOTICE]) });
    const r = await run(dir, rel, '--out', '公告.txt');
    assert.equal(r.code, 1);
    assert.match(r.err, /raw\//);
    assert.ok(!hasFile(dir, '公告.txt'));
  });
}

test('raw を読まずに断る: ファイルが無くても同じ文。.. や ./ を挟んでも当たる', async () => {
  const dir = workdir({ 'raw/x.pdf': pdf([NOTICE]), 'a/.keep': '' });
  const stop = (await run(dir, 'raw/x.pdf', '--out', 'o.txt')).err;
  assert.equal((await run(dir, 'raw/無い.pdf', '--out', 'o.txt')).err, stop);
  for (const p of ['./raw/x.pdf', 'a/../raw/x.pdf', path.join(dir, 'raw', 'x.pdf')]) {
    assert.equal((await run(dir, p, '--out', 'o.txt')).err, stop, p);
  }
  assert.ok(!hasFile(dir, 'o.txt'));
});

test('raw に似た名前は断らない(rawdata・draw・raw.pdf)', async () => {
  for (const rel of ['rawdata/x.pdf', 'draw/x.pdf', 'raw.pdf', '公告/raw_公告.pdf']) {
    const dir = workdir({ [rel]: pdf([NOTICE]) });
    assert.equal((await run(dir, rel, '--out', '公告.txt')).code, 0, rel);
  }
});

const links = (() => {
  const dir = workdir();
  try { fs.symlinkSync('.', path.join(dir, 'l')); return true; } catch { return false; }
})();
const linkSkip = { skip: !links && 'シンボリックリンクを作れない権限' };

test('シンボリックリンク: 実体が raw の下なら断る(ファイルへのリンク・フォルダへのリンク・大文字)', linkSkip, async () => {
  const dir = workdir({ 'raw/x.pdf': pdf([NOTICE]), 'RAW2/RAW/y.pdf': pdf([NOTICE]) });
  fs.symlinkSync(path.join('raw', 'x.pdf'), path.join(dir, '公告.pdf'));
  fs.symlinkSync('raw', path.join(dir, '公告フォルダ'));
  fs.symlinkSync(path.join('RAW2', 'RAW'), path.join(dir, '別'));
  fs.symlinkSync('公告.pdf', path.join(dir, '二段.pdf'));
  for (const p of ['公告.pdf', '公告フォルダ/x.pdf', '別/y.pdf', '二段.pdf']) {
    const r = await run(dir, p, '--out', 'o.txt');
    assert.equal(r.code, 1, p);
    assert.match(r.err, /raw\//, p);
  }
  assert.ok(!hasFile(dir, 'o.txt'));
});

test('シンボリックリンク: 名前が raw のリンクの下も断る。raw の外の物へのリンクは読む', linkSkip, async () => {
  const dir = workdir({ '外/x.pdf': pdf([NOTICE]), '公告/x.pdf': pdf([NOTICE]) });
  fs.symlinkSync('外', path.join(dir, 'raw'));
  fs.symlinkSync(path.join('公告', 'x.pdf'), path.join(dir, 'りんく.pdf'));
  assert.equal((await run(dir, 'raw/x.pdf', '--out', 'o.txt')).code, 1);
  assert.ok(!hasFile(dir, 'o.txt'));
  assert.equal((await run(dir, 'りんく.pdf', '--out', 'o.txt')).code, 0);
});

// ---- 書く先 ----
test('--out が raw の下なら読まずに断る(リンクの実体も)', linkSkip, async () => {
  const dir = workdir({ '公告.pdf': pdf([NOTICE]), 'raw/台帳.txt': '元の文' });
  fs.symlinkSync(path.join('raw', '台帳.txt'), path.join(dir, 'りんく.txt'));
  fs.symlinkSync('raw', path.join(dir, 'りんくフォルダ'));
  for (const out of ['raw/台帳.txt', 'RAW/新.txt', 'りんく.txt', 'りんくフォルダ/新.txt']) {
    const r = await run(dir, '公告.pdf', '--out', out);
    assert.equal(r.code, 1, out);
    assert.match(r.err, /raw\//, out);
  }
  assert.equal(fs.readFileSync(path.join(dir, 'raw/台帳.txt'), 'utf8'), '元の文');
  assert.deepEqual(fs.readdirSync(path.join(dir, 'raw')), ['台帳.txt']);
});

test('--out は .txt だけ。元の PDF を上書きしない', async () => {
  const dir = workdir({ '公告.pdf': pdf([NOTICE]) });
  const before = fs.readFileSync(path.join(dir, '公告.pdf'));
  for (const out of ['公告.pdf', '公告.md', '公告']) {
    const r = await run(dir, '公告.pdf', '--out', out);
    assert.equal(r.code, 2, out);
    assert.match(r.err, /\.txt/);
    assert.match(r.err, /使い方/);
  }
  assert.ok(before.equals(fs.readFileSync(path.join(dir, '公告.pdf'))));
  assert.equal((await run(dir, '公告.pdf', '--out', '公告.TXT')).code, 0);
});

test('書けないとき(--out がフォルダ)は 1 で1行', async () => {
  const dir = workdir({ '公告.pdf': pdf([NOTICE]) });
  fs.mkdirSync(path.join(dir, 'x.txt'));
  const r = await run(dir, '公告.pdf', '--out', 'x.txt');
  assert.equal(r.code, 1);
  assert.match(r.err, /書けませんでした: x\.txt/);
  assert.equal(r.err.split('\n').length, 1);
});

// ---- 引数 ----
test('--help・-h は使い方を出して 0。ほかの引数を見ず、何も書かない', async () => {
  const dir = workdir({ 'raw/x.pdf': '%PDF-1.4' });
  for (const a of ['--help', '-h']) {
    const r = await run(dir, 'raw/x.pdf', '--out', 'o.txt', a);
    assert.equal(r.code, 0);
    assert.equal(r.out, USAGE);
    assert.equal(r.err, '');
  }
  assert.match(USAGE, /^使い方: node /);
  assert.ok(!hasFile(dir, 'o.txt'));
});

test('引数の誤りは 2 で使い方の1行。読まず書かない', async () => {
  const dir = workdir({ '公告.pdf': pdf([NOTICE]) });
  for (const [argv, msg] of [
    [[], /PDF/],
    [['公告.pdf'], /--out/],
    [['--out', 'o.txt'], /PDF/],
    [['公告.pdf', '--out'], /値がありません: --out/],
    [['公告.pdf', '--out', '-x.txt'], /値がありません: --out/],
    [['公告.pdf', '--out', 'o.txt', '--page', '1'], /知らない引数: --page/],
    [['公告.pdf', '別.pdf', '--out', 'o.txt'], /引数が多すぎます: 別\.pdf/],
  ]) {
    const r = await run(dir, ...argv);
    assert.equal(r.code, 2, argv.join(' '));
    assert.match(r.err, msg);
    assert.ok(r.err.endsWith(USAGE_LINE), argv.join(' '));
    assert.equal(r.out, '');
  }
  assert.deepEqual(listAll(dir), ['公告.pdf']);
});

test('本物の入口: 出力の先と終了コード(子プロセス)', childSkip, () => {
  const dir = workdir({ '公告.pdf': pdf([NOTICE, null]), 'raw/x.pdf': pdf([NOTICE]), '絵.pdf': pdf([null]) });
  const node = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd: dir, encoding: 'utf8', timeout: 60000 });
  const good = node('公告.pdf', '--out', '公告.txt');
  assert.equal(good.status, 0, good.stderr);
  assert.match(good.stdout, /公告\.txt/);
  assert.match(good.stderr, /2頁のうち 2頁は文字が無い/);
  const scan = node('絵.pdf', '--out', '絵.txt');
  assert.equal(scan.status, 1);
  assert.equal(scan.stdout, '');
  assert.match(scan.stderr, /文字の入っていない PDF/);
  assert.ok(!hasFile(dir, '絵.txt'));
  const raw = node('raw/x.pdf', '--out', 'r.txt');
  assert.equal(raw.status, 1);
  assert.match(raw.stderr, /raw\//);
  assert.equal(node().status, 2);
  assert.equal(node('--help').status, 0);
});

test('プラグインのフォルダだけを別の場所へ写しても動く(本物の入口)', childSkip, () => {
  const dir = workdir({ '公告.pdf': pdf([NOTICE]) });
  const place = path.join(dir, 'キャッシュ', 'bid-intake');
  fs.cpSync(path.join(ROOT, 'plugin/skills/bid-intake'), place, { recursive: true });
  const r = spawnSync(process.execPath, [path.join(place, 'scripts/pdf-to-text.mjs'), '公告.pdf', '--out', '公告.txt'], { cwd: dir, encoding: 'utf8', timeout: 60000 });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(hasFile(dir, '公告.txt'));
});

// ---- 次の手順へのつながり ----
test('作った .txt は check_conditions が読み、頁の区切りをまたがない抜き書きが原文に当たる。元の .pdf は今どおり断る', async () => {
  const dir = workdir({ '公告.pdf': pdf([NOTICE, TAIL]) });
  await run(dir, '公告.pdf', '--out', 'tmp/公告.txt');
  const data = JSON.stringify({
    source: { publisher: '架空市', title: '架空川護岸工事 入札公告', date: '令和9年2月1日' },
    conditions: [
      { key: 'work-name', value: '架空川護岸工事', quote: NOTICE[1], file: '公告.txt' },
      { key: 'budget', value: '82,500,000円', quote: NOTICE[2], file: '公告.txt' },
      { key: 'site', value: '架空市本町1丁目', quote: TAIL[0], file: '公告.txt' },
    ],
    notes: [],
  });
  const r = await checkConditionsFiles(dir, data, ['tmp/公告.txt'], { toolDir: path.join(ROOT, 'plugin') });
  const parsed = JSON.parse(r.json);
  assert.deepEqual(parsed.removed, []);
  assert.deepEqual(parsed.rows.filter((x) => x.value).map((x) => [x.key, x.status]), [['work-name', '拾えた'], ['site', '拾えた'], ['budget', '拾えた']]);
  await assert.rejects(() => checkConditionsFiles(dir, data, ['公告.pdf'], { toolDir: path.join(ROOT, 'plugin') }), /読めるのは文のファイル/);
});

test('字が NUL や制御文字に当たる PDF でも、.txt に制御文字を書かず check_conditions が読める(抜き書きは空白を見ない)', async () => {
  const lines = ['工事名 架空川\u0000護岸\u0008工事', '工事場所\t架空市\u000c本町'];
  const dir = workdir({ '公告.pdf': pdf([lines]) });
  assert.equal((await run(dir, '公告.pdf', '--out', '公告.txt')).code, 0);
  const text = fs.readFileSync(path.join(dir, '公告.txt'), 'utf8');
  assert.doesNotMatch(text, /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/);
  assert.match(text, /工事名 架空川 護岸 工事/);
  const data = JSON.stringify({
    source: { publisher: '架空市', title: '架空', date: '令和9年2月1日' },
    conditions: [{ key: 'work-name', value: '架空川護岸工事', quote: '工事名 架空川護岸工事', file: '公告.txt' }],
    notes: [],
  });
  const r = await checkConditionsFiles(dir, data, ['公告.txt'], { toolDir: path.join(ROOT, 'plugin') });
  assert.deepEqual(JSON.parse(r.json).removed, []);
});

test('read_masked は .pdf を今どおり断る', () => {
  const dir = workdir({ 'raw/x.pdf': pdf([NOTICE]) });
  assert.throws(() => readMasked(dir, 'raw/x.pdf'), /読めるのは文のファイル/);
});

// ---- 写しと SKILL ----
test('写し: PLUGIN_COPIES に pdf-read があり、元と同じ', () => {
  assert.ok(PLUGIN_COPIES.some(([src, dst]) => src === 'src/pdf-read.mjs' && dst === 'plugin/skills/bid-intake/scripts/lib/pdf-read.mjs'));
  assert.deepEqual(staleCopies(ROOT), []);
});

test('スクリプトは手元のものだけを読む(通信・子プロセス・プラグインの外のファイルを使わない)', () => {
  const src = fs.readFileSync(SCRIPT, 'utf8');
  const imports = [...src.matchAll(/^import .* from '([^']+)';$/gm)].map((m) => m[1]);
  assert.deepEqual(imports.sort(), ['./lib/pdf-read.mjs', 'node:fs', 'node:path', 'node:url']);
  assert.doesNotMatch(src, /\bfetch\(|XMLHttpRequest|WebSocket|child_process|\beval\(|new Function|import\(/);
});

test('SKILL.md: 手順1 は PDF を Read で開かず pdf-to-text.mjs で .txt にする。手順5 に渡すのは作った .txt', () => {
  const skill = fs.readFileSync(SKILL, 'utf8');
  const step = (n) => skill.split('\n').find((l) => l.startsWith(`${n}. `));
  assert.match(step(1), /PDF は Read で開かない/);
  assert.match(step(1), /scripts\/pdf-to-text\.mjs/);
  assert.match(step(1), /--out/);
  assert.match(step(1), /理由を伝えて写しを頼む/);
  assert.match(step(1), /―― n頁 ――/); // 道具が入れた行は原文ではない
  assert.doesNotMatch(skill, /PDF しか無いときは/);
  assert.match(step(5), /作った \.txt/);
});

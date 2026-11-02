// F04c: 作成例の様式の Excel(.xlsx)の台帳の読み込み(条件 F04-4)
// 1つ目の試験は、取得した国交省の作成例の .xlsx そのものを読む。2つ目以降は、欄名(左)と値(右)が並ぶ自作の表で、読み取りと読めない欄の種類を確かめる。
// readLedgerXlsx の返り値: { ledger, unreadable: [{key, field, reason, cause: 'not_found'|'empty'|'invalid'}], found: { key: { label: 欄名のセル番地, value: 値のセル番地 } } }
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { load, loadSources, indexHtml, scriptsOf, hasId, makeXlsx, p } from './_helpers.mjs';

const ROWS = [
  ['施工体制台帳'],
  ['[会社名]', '架空一建設株式会社'],
  ['工事名称及び工事内容', '架空川 護岸改修工事'],
  ['発注者名及び住所', '架空県 架空県ためし市0-0'],
  ['工期', '自 2026年10月1日 至 2027年3月15日'],
  ['請負代金額', 250000000],
  ['監理技術者名', '架空 太郎'],
];

const KEYS = ['project.name', 'project.orderer', 'project.periodFrom', 'project.periodTo', 'project.contractAmount', 'prime.name', 'prime.engineer.name'];
const pick = (o, k) => k.split('.').reduce((x, y) => (x == null ? x : x[y]), o);

test('国交省の作成例の様式の Excel を取得して置き、そのまま読み込める(読めない欄は欄ごとに挙がる)', async () => {
  const src = loadSources();
  const d = src.list.find((s) => s.kind === 'document' && /施工体制台帳/.test(s.title || '') && /\.xlsx$/i.test(s.url));
  assert.ok(d, '作成例の Excel(.xlsx)の出典が無い');
  assert.ok(new URL(d.url).hostname.endsWith('mlit.go.jp'));
  assert.ok(d.fetchedAt >= '2026-11-02');
  assert.ok(d.file && /\.xlsx$/i.test(d.file), '取得した Excel のファイルが data/sources に無い');
  const bytes = new Uint8Array(fs.readFileSync(p('data/sources', d.file)));
  const { readLedgerXlsx } = await load('src/ledger-xlsx.mjs');
  const { ledger, unreadable, found } = await readLedgerXlsx(bytes);
  // 本物の様式の中で、7つの欄すべての欄名のセルを見つけている(見つからない欄は0)。そのセルの文字が欄名に当たる
  const { unzipForTest } = await import('./_helpers.mjs');
  const entries = await unzipForTest(bytes);
  // 2026-11-02 統括(exceptions の F04c の [decision] に A と回答): 国交省の作成例の様式には請負代金額の欄が無い。本物の様式では請負代金額を「欄が無い」として読めない欄に挙げればよい
  const REAL_KEYS = KEYS.filter((k) => k !== 'project.contractAmount');
  const ca = unreadable.find((u) => u.key === 'project.contractAmount');
  assert.ok(ca && ca.cause === 'not_found' && /欄/.test(String(ca.reason || '')), '請負代金額が「様式に欄が無い」として読めない欄に挙がっていない');
  for (const k of REAL_KEYS) {
    assert.match(String(found?.[k]?.label ?? ''), /^[A-Z]+\d+$/, k + ' の欄名のセルを本物の様式の中に見つけていない');
    assert.match(String(found[k].value ?? ''), /^[A-Z]+\d+$/, k + ' の値のセルの番地が無い');
    const t = cellTextForTest(entries, found[k].label);
    assert.ok(LABEL_RE[k].test(t), k + ' の欄名のセル ' + found[k].label + ' の文字が欄名に当たらない: ' + t);
    assert.ok(!unreadable.some((u) => u.key === k && u.cause === 'not_found'), k + ' が見つからない欄になっている');
    const v = pick(ledger, k);
    const read = v !== null && v !== undefined && String(v).trim() !== '';
    assert.ok(read || unreadable.some((u) => u.key === k && (u.cause === 'empty' || u.cause === 'invalid')), k + ' が読めず、読めない欄にも挙がっていない');
  }
  // 値が入っていれば読めることを、本物の様式の値の欄に架空の値を書いて確かめる
  const cells = {};
  for (const k of REAL_KEYS) (cells[found[k].value] ||= []).push(k);
  const filled = await fillXlsxForTest(bytes, cells);
  assert.ok(filled, '値のセルに書き込めない(工期の2つ以外で1つのセルを分け合っている、または行が無い)');
  const r2 = await readLedgerXlsx(filled.bytes);
  for (const k of REAL_KEYS) assert.equal(String(pick(r2.ledger, k)), String(filled.expect[k]), k + ' に書いた値が読めない');
});

const LABEL_RE = { 'project.name': /工事名/, 'project.orderer': /発注者/, 'project.periodFrom': /工期/, 'project.periodTo': /工期/, 'project.contractAmount': /請負代金/, 'prime.name': /会社名|商号|名称/, 'prime.engineer.name': /監理技術者|主任技術者/ };

// セルの文字(共有文字列・インラインの文字・値)を、すべてのシートから探して返す
function cellTextForTest(entries, ref) {
  const sst = entries.find((e) => e.name === 'xl/sharedStrings.xml');
  const strings = sst ? [...sst.data.toString('utf8').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => [...m[1].matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map((x) => x[1]).join('')) : [];
  for (const e of entries.filter((x) => /^xl\/worksheets\/sheet\d+\.xml$/.test(x.name))) {
    const m = e.data.toString('utf8').match(new RegExp(`<c r="${ref}"([^>]*?)(?:/>|>([\\s\\S]*?)</c>)`));
    if (!m || !m[2]) continue;
    if (/t="s"/.test(m[1])) return strings[Number((m[2].match(/<v>(\d+)<\/v>/) || [])[1])] ?? '';
    return [...m[2].matchAll(/<(?:t|v)[^>]*>([^<]*)<\/(?:t|v)>/g)].map((x) => x[1]).join('');
  }
  return '';
}

// 本物の Excel の値のセルに架空の値を書き込む(共有文字列でなくインラインの文字・数として書く)。
// cells: { 'B5': ['project.name'], 'B9': ['project.periodFrom', 'project.periodTo'], ... }。
// 値のセルの番地が無い欄、XML にそのセルが無い場合、工期の2つ以外で1つのセルを分け合う場合は null を返す(書き込みの確かめを省く)。
async function fillXlsxForTest(bytes, cells) {
  if (Object.keys(cells).some((ref) => !/^[A-Z]+\d+$/.test(ref))) return null;
  if (Object.values(cells).some((ks) => ks.length > 1 && ks.join() !== 'project.periodFrom,project.periodTo')) return null;
  const VALUES = { 'project.name': '架空試験 工事', 'project.orderer': '架空試験県', 'project.periodFrom': '2026-12-01', 'project.periodTo': '2027-01-31', 'project.contractAmount': 12340000, 'prime.name': '架空試験建設株式会社', 'prime.engineer.name': '架空 試験' };
  const DISPLAY = { 'project.periodFrom': '2026年12月1日', 'project.periodTo': '2027年1月31日' };
  const { unzipForTest, makeZip: mk } = await import('./_helpers.mjs');
  const entries = await unzipForTest(bytes);
  const sheets = entries.filter((e) => /^xl\/worksheets\/sheet\d+\.xml$/.test(e.name));
  const sheet = sheets.find((e) => Object.keys(cells).some((ref) => new RegExp(`<c r="${ref}"`).test(e.data.toString('utf8')))) || sheets[0];
  let xml = sheet.data.toString('utf8');
  for (const [ref, ks] of Object.entries(cells)) {
    const k = ks[0];
    const v = VALUES[k];
    const shown = ks.length > 1 ? `自 ${DISPLAY['project.periodFrom']} 至 ${DISPLAY['project.periodTo']}` : (DISPLAY[k] ?? v);
    const cell = typeof v === 'number' ? `<c r="${ref}"><v>${v}</v></c>` : `<c r="${ref}" t="inlineStr"><is><t>${shown}</t></is></c>`;
    const re = new RegExp(`<c r="${ref}"(?:[^>]*/>|[^>]*>[\\s\\S]*?</c>)`);
    if (re.test(xml)) { xml = xml.replace(re, cell); continue; }
    // セルが XML に無ければ、その行の末尾に足す(行が無ければ書き込めない)
    const row = ref.match(/\d+$/)[0];
    const rowRe = new RegExp(`(<row\\b[^>]*\\br="${row}"[^>]*>)([\\s\\S]*?)(</row>)`);
    if (!rowRe.test(xml)) return null;
    xml = xml.replace(rowRe, (_m, a, b, c) => a + b + cell + c);
  }
  sheet.data = Buffer.from(xml, 'utf8');
  return { bytes: mk(entries.map((e) => ({ name: e.name, data: e.data }))), expect: VALUES };
}

test('readLedgerXlsx: 欄名と値の並ぶ表から、台帳の入力の形を作る', async () => {
  const { readLedgerXlsx } = await load('src/ledger-xlsx.mjs');
  const { ledger, unreadable, found } = await readLedgerXlsx(makeXlsx(ROWS));
  assert.equal(ledger.project.name, '架空川 護岸改修工事');
  assert.ok(String(ledger.project.orderer).startsWith('架空県'));
  assert.equal(ledger.project.contractAmount, 250000000);
  assert.equal(ledger.project.periodFrom, '2026-10-01');
  assert.equal(ledger.project.periodTo, '2027-03-15');
  assert.equal(ledger.prime.engineer.name, '架空 太郎');
  assert.ok(Array.isArray(unreadable));
  assert.ok(!unreadable.some((u) => /請負代金額|工期/.test(u.field)), '読めた欄を読めないとしている');
  assert.equal(found['project.contractAmount'].label, 'A6');
  assert.equal(found['project.contractAmount'].value, 'B6');
});

test('読めない欄は、どの欄かを返す', async () => {
  const { readLedgerXlsx } = await load('src/ledger-xlsx.mjs');
  const rows = ROWS.filter((r) => r[0] !== '請負代金額').map((r) => (r[0] === '工期' ? ['工期', 'いつか'] : r));
  const { unreadable } = await readLedgerXlsx(makeXlsx(rows));
  assert.ok(unreadable.some((u) => /請負代金額/.test(u.field)), '無い欄を挙げない');
  assert.ok(unreadable.some((u) => /工期/.test(u.field)), '読めない値の欄を挙げない');
  for (const u of unreadable) assert.ok(u.key && u.field && u.reason && ['not_found', 'empty', 'invalid'].includes(u.cause), '欄の key・欄名・理由・種類のどれかが無い');
  assert.ok(unreadable.some((u) => u.key === 'project.contractAmount' && u.cause === 'not_found'));
  assert.ok(unreadable.some((u) => u.key === 'project.periodFrom' && u.cause === 'invalid'));
});

test('xlsx でないファイルは、分かる言葉で止まる', async () => {
  const { readLedgerXlsx } = await load('src/ledger-xlsx.mjs');
  await assert.rejects(() => readLedgerXlsx(new Uint8Array(Buffer.from('not a zip'))), Error);
});

test('画面で Excel を選べて、読めない欄を出す場所がある', () => {
  const html = indexHtml();
  const m = html.match(/<input\b[^>]*\bid\s*=\s*["']ledger-file["'][^>]*>/i);
  assert.ok(m && m[0].includes('.xlsx'), 'ledger-file の入力欄が無い');
  assert.ok(hasId(html, 'ledger-unreadable'));
  assert.ok(scriptsOf(html).map((s) => s.code).join('\n').includes('readLedgerXlsx'));
});

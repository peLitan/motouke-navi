#!/usr/bin/env node
// 公告の PDF を文のファイル(.txt)にする(F82e)。PDF を Read で開くと頁の画像も渡るので、文にしてから読む
// 使い方: node pdf-to-text.mjs <公告.pdf> --out <公告.txt>
// 読むのは文字の入った PDF だけ。読めない PDF は .txt を書かず、理由と次の手を言って終了コード 1。AI も通信も使わない。
// raw/ の下の PDF は読まない。文にすると、置き換えていない文が raw/ の外に出るため。
// 限界: パスの字と実体のパスで見るので、raw/ の外へ写したファイル、ハードリンク、raw という名前のリンクの先を直に指したパスは見分けない
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readPdf } from './lib/pdf-read.mjs';

const MAX_MB = 30; // 読むファイルの大きさの上限。画面の文の置き換えと同じ

export const USAGE_LINE = '使い方: node pdf-to-text.mjs <公告.pdf> --out <公告.txt>(くわしくは --help)';
export const USAGE = [
  '使い方: node pdf-to-text.mjs <公告.pdf> --out <公告.txt>',
  '',
  '公告の PDF の文字を読み、文のファイルに書きます。読むのは文字の入った PDF だけで、画像の文字は読みません。',
  '読むもの: 指定した PDF(raw/ の下の PDF は読みません)',
  '書くもの: --out の .txt(UTF-8。同じ名前があれば上書きします。無いフォルダは作ります)。頁の間に「―― n頁 ――」の行を入れます',
  '終わり方: 書けば 0(読めない頁があれば、その番号を標準エラーに言います)。読めない PDF は .txt を書かず 1。引数の誤りは 2',
  '',
  '引数:',
  '  --out <公告.txt>  書く先。.txt のファイルだけ',
  '  --help, -h        この使い方を出す',
].join('\n');

// 読めない PDF の文。理由と次の手を入れ、内部の語(status の名前)は出さない。画面の文の置き換えと同じ文で、「画面」だけを「道具」にした
export const PDF_STOPS = {
  'no-text': '文字の入っていない PDF です(紙を写した画像だけ)。この道具は画像の文字を読みません。元の Excel・Word をもらうか、紙を見て入れてください。',
  encrypted: '保護(パスワードやコピーの禁止)のかかった PDF です。この道具は保護を解きません。文字の取れる版をもらうか、要る所を手で入れてください。',
  unmapped: '字の形しか入っていない PDF で、文字に戻せません(読むと化けます)。元の Word・Excel をもらってください。',
  broken: 'PDF が途中で切れているか壊れていて読めません。もう一度ダウンロードするか、送り直してもらってください。',
  'too-big': 'PDF が大きすぎて、途中で読むのをやめました。要る頁だけの PDF にしてください。',
  'not-pdf': 'PDF の形ではありません。名前が .pdf でも中身が違います。',
};
const TABLE_NOTE = '表は行や列の順が崩れることがあります。紙と見比べてください。';
const RAW_PDF = 'raw/ の下の PDF は読みません。文にすると、置き換えていない文が raw/ の外に出るためです。公開の公告なら raw/ の外に置いてください。会社の書類は Motouke Navi の画面の「文の置き換え」で置き換えてから渡してください。';
const RAW_OUT = 'raw/ の下には書きません。元の書類を上書きしないためです。--out は raw/ の外にしてください。';

function readArgs(argv) {
  if (argv.some((a) => a === '--help' || a === '-h')) return { help: true };
  const files = [];
  let out;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') {
      const v = argv[++i];
      if (v === undefined || v.startsWith('-')) return { error: '値がありません: --out' };
      out = v;
    } else if (a.startsWith('-')) return { error: '知らない引数: ' + a };
    else files.push(a);
  }
  if (files.length > 1) return { error: '引数が多すぎます: ' + files.slice(1).join(' ') };
  if (!files.length) return { error: 'PDF のファイルを指定してください' };
  if (!out) return { error: '--out で書く先の .txt を指定してください' };
  // .txt に限るので、元の PDF を上書きしない。check_conditions が読めるのも文のファイルだけ
  if (path.extname(out).toLowerCase() !== '.txt') return { error: '--out は .txt のファイルにしてください: ' + out };
  return { file: files[0], out };
}

// パスの1つの部分が raw か。大文字小文字を問わない。Windows では名前の末尾の点・空白は無かったことになり、: の後は同じ名前の物の別の中身なので、同じ物として見る
const isRawPart = (part) => /^raw[. ]*(:.*)?$/i.test(part);
const hasRawPart = (p) => p.split(/[\\/]/).some(isRawPart);

// 一番長い、実在する先頭の部分を実体のパスにする(これから作るファイルでも、途中のリンクをたどる)
function realOf(p) {
  const rest = [];
  for (let cur = p; ; cur = path.dirname(cur)) {
    try {
      return path.join(fs.realpathSync.native(cur), ...rest);
    } catch {
      if (path.dirname(cur) === cur) return p;
      rest.unshift(path.basename(cur));
    }
  }
}
const underRaw = (p) => hasRawPart(p) || hasRawPart(realOf(p));

// 字の対応表が制御文字に当てた字は空白にする。NUL が残ると check_conditions が文のファイルと見ず、照合は空白を見ないので抜き書きは当たる
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
// 空の頁にも区切りの行を置く。後ろの頁の番号が紙とずれないように(画面の文の置き換えと同じ形)
const textOf = (r) => r.pages.map((p, i) => (i ? `―― ${p.page}頁 ――\n` : '') + p.text.replace(CONTROL, ' ')).join('\n') + '\n';

// 続いた3頁以上は「2〜5」にまとめる
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

function notesOf(r) {
  const unread = r.pages.filter((p) => p.scanLike).map((p) => p.page);
  const notes = [];
  if (unread.length) notes.push(`${r.pageCount}頁のうち ${unread.length}頁(${pageList(unread)}頁目)は文字が無い(紙を写した画像)ので読めていません。`);
  if (r.stats.hidden) notes.push(`見えない字(${r.stats.hidden}字)は入れていません。`);
  // 次の2つは読めたときでも起きる
  if (r.stats.unmapped) notes.push(`字に戻せなかった字(${r.stats.unmapped}字)は「�」のまま入れています。この字を探して紙と見比べてください。`);
  if (r.stats.damagedStreams) notes.push('中身の一部が壊れていて、読めていない所があります。紙と見比べてください。');
  notes.push(TABLE_NOTE);
  return notes;
}

// 読むファイルの中身を返す。読めなければ理由の文を error で返す
function readInput(abs, name) {
  let st;
  try { st = fs.statSync(abs); } catch { return { error: 'ファイルがありません: ' + name }; }
  if (!st.isFile()) return { error: 'ファイルではありません: ' + name };
  if (st.size > MAX_MB * 1024 * 1024) return { error: `ファイルが大きすぎます(上限 ${MAX_MB}MB)` };
  try { return { bytes: fs.readFileSync(abs) }; } catch (e) { return { error: `読めませんでした: ${name}(${e.code})` }; }
}

// io は出力の先と、相対のパスの起点(試験が差し替える)。終了コードを返す
export async function main(argv, io = { log: (s) => console.log(s), error: (s) => console.error(s), cwd: process.cwd() }) {
  const args = readArgs(argv);
  if (args.help) { io.log(USAGE); return 0; }
  if (args.error) { io.error(args.error); io.error(USAGE_LINE); return 2; }
  const from = path.resolve(io.cwd, args.file);
  const to = path.resolve(io.cwd, args.out);
  if (underRaw(from)) { io.error(RAW_PDF); return 1; }
  if (underRaw(to)) { io.error(RAW_OUT); return 1; }
  const input = readInput(from, args.file);
  if (input.error) { io.error(input.error); return 1; }
  const r = await readPdf(input.bytes);
  if (r.status !== 'ok' && r.status !== 'partial') { io.error(PDF_STOPS[r.status] ?? PDF_STOPS.broken); return 1; }
  try {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.writeFileSync(to, textOf(r));
  } catch (e) {
    io.error(`書けませんでした: ${args.out}(${e.code})`);
    return 1;
  }
  io.log(`「${path.basename(args.file)}」の文字を読みました(${r.pageCount}頁): ${args.out}`);
  for (const note of notesOf(r)) io.error(note);
  return 0;
}

const isMain = Boolean(process.argv[1]) && fs.realpathSync(path.resolve(process.argv[1])) === fileURLToPath(import.meta.url);
if (isMain) process.exitCode = await main(process.argv.slice(2));

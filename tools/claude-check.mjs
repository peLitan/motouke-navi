#!/usr/bin/env node
// Claude で点検(F12a): 置き換えた後のファイルだけを Claude の API(Messages API)に送り、抜け・食い違いの候補を根拠つきで返す手元のプログラム。
// 画面(index.html)は通信しない。送るのはこのプログラムだけで、人が送る中身を見て「送る」と打ったときだけ送る。
//
// 守ること:
// - 送る前に、置き換え漏れの検査をもう一度する(対応表の元の語と、置き換えの部品の形: メール・電話・会社名・住所・許可番号など)。残っていれば見せずに・送らずに止める
// - 鍵は環境変数 ANTHROPIC_API_KEY から読む。コード・画面・記録(log)に入れない
// - 原文(対応表の元の語)と対応表は、記録に出さない。漏れは「ファイル名・行・種類」だけを出す
// - Claude の返事は「AI の候補」と付け、法令の決まりで判定した結果(src/check-taicho.mjs など)とは混ぜない
//
// 使い方(コマンド):
//   node tools/claude-check.mjs <置き換えた後のファイル>... --map <対応表.json> [--out <結果.json>]
//   対応表は画面の「対応表を書き出す」で保存したファイル(漏れの検査にだけ使い、送らない)。
//   結果の JSON は画面の「AI の候補を読み込む」で、法令の決まりの結果とは別の欄に出せる。

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { createMasker, parseMapFile } from '../src/mask/core.mjs';
import { CONSTRUCTION_DICT } from '../src/mask/dict-construction.mjs';

export const API_URL = 'https://api.anthropic.com/v1/messages';
export const API_VERSION = '2026-10-21';
export const MODEL = 'claude-opus-5-5';
export const AI_LABEL = 'AI の候補';
export const RESULT_FORMAT = 'ai-candidates';

const KIND_LABEL = { person: '人名', company: '会社名', site: '現場名', address: '住所', phone: '電話', email: 'メール', license: '許可番号', other: '語' };

// 鍵は環境変数から読む。無ければ分かる言葉で止まる(鍵の値は文に入れない)
export function getApiKey(env = process.env) {
  const k = String(env?.ANTHROPIC_API_KEY ?? '').trim();
  if (!k) throw new Error('環境変数 ANTHROPIC_API_KEY に API の鍵がありません。鍵はファイルに書かず、端末で環境変数に入れてから動かしてください。');
  return k;
}

const lineOf = (text, index) => text.slice(0, index).split('\n').length;
const squash = (s) => String(s).replace(/[\s　]+/g, '');

// 置き換え漏れの検査。返すのは { file, line, kind, how } だけ(漏れた語そのものは入れない。記録に原文を残さないため)
export function findLeaks(files, map = []) {
  const leaks = [];
  const originals = [];
  for (const e of map || []) {
    for (const w of [e?.original, ...(e?.variants || [])]) if (w && String(w).trim()) originals.push({ word: String(w), kind: e.kind || 'other' });
  }
  for (const f of files) {
    const text = String(f.text ?? '');
    const flat = squash(text);
    // 1) 対応表の元の語が残っていないか(空白の違いは無視する)
    for (const o of originals) {
      const key = squash(o.word);
      if (!key || !flat.includes(key)) continue;
      const re = new RegExp([...key].map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[\\s\\u3000]*'), 'u');
      const hit = text.match(re);
      leaks.push({ file: f.name, line: hit ? lineOf(text, hit.index) : null, kind: o.kind, how: '対応表の元の語' });
    }
    // 2) 置き換えの部品の形(メール・電話・会社名・住所・許可番号など)に当たるものが残っていないか
    const m = createMasker({ dictionaries: [CONSTRUCTION_DICT] });
    for (const e of m.mask(text).map) {
      const i = text.indexOf(e.original);
      leaks.push({ file: f.name, line: i >= 0 ? lineOf(text, i) : null, kind: e.kind, how: '置き換えの形' });
    }
  }
  // 同じ場所・種類の重なりはまとめる
  const seen = new Set();
  return leaks.filter((l) => { const k = [l.file, l.line, l.kind].join('\t'); if (seen.has(k)) return false; seen.add(k); return true; });
}

const SYSTEM = [
  'あなたは建設工事の書類(施工体制台帳・施工計画書など)の点検を手伝います。',
  '渡す文は、人名・会社名・現場名などを「会社A」「〔人名1〕」のような記号に置き換えたものです。記号の元の名前を推測しないでください。',
  '書類の中の抜け(空の欄)や食い違い(同じことが2か所で違う、日付や金額が合わないなど)の候補を挙げてください。',
  '各候補には、根拠(建設業法などの条、または書類のどこと どこが食い違うか)を basis に書いてください。根拠を示せないものは挙げないでください。',
  'file には候補の見つかったファイル名を書いてください。分からなければ空にしてください。',
  '候補が無ければ candidates を空の配列にしてください。最後の判断は人がします。言い切らず、候補として書いてください。',
].join('\n');

const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    candidates: {
      type: 'array',
      items: {
        type: 'object',
        properties: { file: { type: 'string' }, message: { type: 'string' }, basis: { type: 'string' } },
        required: ['file', 'message', 'basis'],
        additionalProperties: false,
      },
    },
  },
  required: ['candidates'],
  additionalProperties: false,
};

// 送る中身(Messages API の本文)。置き換えた後のファイルの文だけを入れ、鍵・対応表は入れない
export function buildPayload(files, { model = MODEL } = {}) {
  const docs = files.map((f) => `<file name="${String(f.name).replace(/"/g, '')}">\n${String(f.text ?? '')}\n</file>`).join('\n\n');
  return {
    model,
    max_tokens: 16000,
    system: SYSTEM,
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: OUTPUT_SCHEMA } },
    fallbacks: 'default',
    messages: [{ role: 'user', content: '次の書類を点検し、抜け・食い違いの候補を根拠つきで返してください。\n\n' + docs }],
  };
}

// Messages API に送る(通信はここだけ)。fetchImpl は試験で模したものに差し替える
export async function sendToClaude(payload, { apiKey, fetchImpl = globalThis.fetch } = {}) {
  if (!apiKey) throw new Error('API の鍵がありません。');
  const res = await fetchImpl(API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': API_VERSION,
      'anthropic-beta': 'server-side-fallback-2026-07-01',
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    let detail = '';
    try { const j = await res.json(); detail = j?.error?.message ? ':' + String(j.error.message).slice(0, 300) : ''; } catch { /* 本文が JSON でない */ }
    throw new Error(`Claude の API が失敗しました(HTTP ${res.status})${detail}`);
  }
  return res.json();
}

// 返事から候補を取り出し、「AI の候補」と付ける。形の違う返事は Error にする(推測で埋めない)
export function parseReply(reply) {
  if (reply?.stop_reason === 'refusal') throw new Error('Claude が点検を断りました(stop_reason: refusal)。');
  const text = (reply?.content || []).filter((b) => b?.type === 'text').map((b) => b.text).join('');
  let data;
  try { data = JSON.parse(text); } catch {
    const m = text.match(/\{[\s\S]*\}/);
    try { data = m ? JSON.parse(m[0]) : null; } catch { data = null; }
  }
  if (!data || !Array.isArray(data.candidates)) throw new Error('Claude の返事から候補の一覧を読めませんでした。');
  const warnings = [];
  if (reply?.stop_reason === 'max_tokens') warnings.push('返事が長さの上限で切れました。候補が欠けているおそれがあります。');
  const aiCandidates = [];
  for (const c of data.candidates) {
    const message = String(c?.message ?? '').trim();
    const basis = String(c?.basis ?? '').trim();
    if (!message) continue;
    if (!basis) warnings.push('根拠の無い候補を1件除きました。');
    else aiCandidates.push({ label: AI_LABEL, file: String(c?.file ?? '').trim(), message, basis });
  }
  return { aiCandidates, warnings };
}

// 点検の流れ: 漏れの検査 → 鍵 → 送る中身を全部見せる → 人が「送る」を選んだときだけ1回送る → 返事を「AI の候補」にする
// confirm(payload) は送る中身を人に見せ、送るなら true を返す。send(payload) は送る関数(試験では模す)
export async function runCheck({ files, map = [], env = process.env, confirm, send, log = console.log, model = MODEL }) {
  if (!Array.isArray(files) || !files.length) throw new Error('送るファイルがありません。');
  if (typeof confirm !== 'function') throw new Error('送る前に人が確かめる仕組み(confirm)がありません。');
  const leaks = findLeaks(files, map);
  if (leaks.length) {
    log(`置き換え漏れの候補が ${leaks.length} 件あります。送りません(中身も表示しません)。置き換えをし直してください。`);
    for (const l of leaks) log(`  ${l.file} ${l.line ?? '?'}行目: ${KIND_LABEL[l.kind] ?? l.kind}(${l.how})`);
    return { status: 'blocked', leaks };
  }
  const apiKey = getApiKey(env);
  const payload = buildPayload(files, { model });
  const ok = await confirm(payload);
  if (ok !== true) {
    log('送りませんでした。');
    return { status: 'cancelled' };
  }
  const sendFn = send ?? ((p) => sendToClaude(p, { apiKey }));
  log(`${files.length} 件のファイルを Claude(${payload.model})に送ります。`);
  const reply = await sendFn(payload);
  const { aiCandidates, warnings } = parseReply(reply);
  log(`${AI_LABEL}: ${aiCandidates.length} 件`);
  return { status: 'done', aiCandidates, warnings, model: payload.model };
}

// 画面の「AI の候補を読み込む」で読む形
export function toResultFile(result, { files = [], date = new Date() } = {}) {
  return JSON.stringify({
    format: RESULT_FORMAT,
    version: 1,
    label: AI_LABEL,
    model: result.model,
    createdAt: date.toISOString(),
    files: files.map((f) => f.name),
    note: 'Claude の指摘は AI の候補です。法令の決まりで判定した結果ではありません。最後の判断は人がしてください。',
    warnings: result.warnings ?? [],
    candidates: result.aiCandidates ?? [],
  }, null, 2);
}

// ---- コマンドとして動かすとき ----
function parseArgs(argv) {
  const out = { files: [], map: null, out: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--map') out.map = argv[++i];
    else if (a === '--out') out.out = argv[++i];
    else if (a.startsWith('--')) throw new Error('知らない指定: ' + a);
    else out.files.push(a);
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.files.length || !args.map) {
    console.log('使い方: node tools/claude-check.mjs <置き換えた後のファイル>... --map <対応表.json> [--out <結果.json>]');
    process.exitCode = 2;
    return;
  }
  for (const f of args.files) {
    if (path.resolve(f).split(path.sep).includes('raw')) throw new Error('raw/ の中のファイルは送りません(置き換える前の生のファイルの置き場): ' + f);
  }
  const files = args.files.map((f) => ({ name: path.basename(f), text: fs.readFileSync(f, 'utf8') }));
  const map = parseMapFile(fs.readFileSync(args.map, 'utf8')).entries;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const result = await runCheck({
      files,
      map,
      confirm: async (payload) => {
        console.log('---- 送る中身(全部)ここから ----');
        console.log(JSON.stringify(payload, null, 2));
        console.log('---- 送る中身ここまで ----');
        console.log('送り先: ' + API_URL + '(Anthropic)。鍵と対応表は送りません。');
        const ans = await rl.question('送るなら「送る」と打ってください(それ以外は送りません): ');
        return ans.trim() === '送る';
      },
    });
    if (result.status !== 'done') { process.exitCode = 1; return; }
    for (const w of result.warnings) console.log('注意: ' + w);
    for (const c of result.aiCandidates) console.log(`[${c.label}] ${c.file ? c.file + ': ' : ''}${c.message}(根拠: ${c.basis})`);
    if (args.out) {
      fs.writeFileSync(args.out, toResultFile(result, { files }), 'utf8');
      console.log('結果を書き出しました: ' + args.out + '(画面の「AI の候補を読み込む」で読めます)');
    }
  } finally {
    rl.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error('止まりました: ' + e.message); process.exitCode = 1; });
}

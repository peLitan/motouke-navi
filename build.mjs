// src/ui/shell.html から、ファイル1つで開ける index.html を組み立てる
// 使い方: node build.mjs
// - 画面のスクリプト(src/ui/app.mjs)と、それが読む部品・データ(.mjs・.json)を、import を使わない1つのスクリプトにまとめて埋め込む
// - 使った法令と資料の名前・取得日を data/sources/index.json から本文に書く
// - CSP は外部と通信しない設定にする。インラインのスクリプトは中身のハッシュ(sha256)でだけ許す
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { sourceVersion } from './src/source-version.mjs';
import { parseRulesFile, tableCredit } from './src/rules-load.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const SHELL = path.join(ROOT, 'src', 'ui', 'shell.html');
const ENTRY = 'src/ui/app.mjs';

function inlineScripts(html) {
  return [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
}

export function makeCsp(html) {
  const hashes = inlineScripts(html).map((code) => `'sha256-${crypto.createHash('sha256').update(code, 'utf8').digest('base64')}'`);
  return [
    "default-src 'none'",
    hashes.length ? `script-src ${hashes.join(' ')}` : "script-src 'none'",
    "style-src 'unsafe-inline'",
    "img-src 'none'",
    "connect-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
  ].join('; ');
}

// ---- 部品をまとめる(このリポジトリの書き方だけを扱う小さなまとめ役) ----
// 扱う import: `import x from './a.json' with { type: 'json' };` と `import { a, b as c } from './b.mjs';`
// 扱う export: `export function` `export async function` `export const` `export let`
// それ以外の書き方は例外にする(黙って壊れた画面を作らない)
const IMPORT_RE = /^import\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"](?:\s+with\s*\{\s*type\s*:\s*['"]json['"]\s*\})?\s*;?[ \t]*$/gm;
const rel = (abs) => path.relative(ROOT, abs).split(path.sep).join('/');

function transformModule(file, code) {
  const deps = [];
  const body = code.replace(IMPORT_RE, (_all, what, spec) => {
    if (!spec.startsWith('.')) throw new Error(file + ': 外部のモジュールは埋め込めない: ' + spec);
    const dep = rel(path.resolve(ROOT, path.dirname(file), spec));
    deps.push(dep);
    const w = what.trim();
    if (/^\{[\s\S]*\}$/.test(w)) {
      const names = w.slice(1, -1).split(',').map((x) => x.trim()).filter(Boolean)
        .map((x) => { const m = x.match(/^([\w$]+)(?:\s+as\s+([\w$]+))?$/); if (!m) throw new Error(file + ': 読めない import: ' + x); return m[2] ? m[1] + ': ' + m[2] : m[1]; });
      return `const { ${names.join(', ')} } = __m[${JSON.stringify(dep)}];`;
    }
    if (/^[\w$]+$/.test(w)) return `const ${w} = __m[${JSON.stringify(dep)}];`;
    throw new Error(file + ': 読めない import: ' + w);
  });
  const exportsList = [];
  const out = body.replace(/^export\s+(async\s+function|function|const|let)\s+([\w$]+)/gm, (_a, kind, name) => { exportsList.push(name); return kind + ' ' + name; });
  if (/^\s*(import|export)\b/m.test(out)) throw new Error(file + ': まとめられない import・export が残った');
  return { deps, code: `(function () {\n${out}\nreturn { ${exportsList.join(', ')} };\n})()` };
}

export function bundle(entry = ENTRY) {
  const order = [];
  const done = new Map();
  const visit = (file, stack) => {
    if (done.has(file)) return;
    if (stack.includes(file)) throw new Error('循環する import: ' + [...stack, file].join(' → '));
    const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
    let mod;
    if (file.endsWith('.json')) {
      // JSON の中の「<」は文字列の中にしか無いので \u003c にする(データの文字で script の要素が終わらないように)
      mod = { deps: [], code: JSON.stringify(JSON.parse(text)).replace(/</g, '\\u003c') };
    } else {
      if (/<\/script|<!--/i.test(text)) throw new Error(file + ': 「</script」か「<!--」があると script の要素に埋め込めない');
      mod = transformModule(file, text);
    }
    for (const d of mod.deps) visit(d, [...stack, file]);
    done.set(file, mod);
    order.push(file);
  };
  visit(entry, []);
  const parts = order.map((f) => `__m[${JSON.stringify(f)}] = ${done.get(f).code};`);
  return `(function () {\n'use strict';\nconst __m = {};\n${parts.join('\n')}\n__m[${JSON.stringify(entry)}].startApp(document);\n})();\n`;
}

// ---- 使った法令と資料の一覧(本文に出す) ----
const escHtml = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function sourcesHtml() {
  const { sources } = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'sources', 'index.json'), 'utf8'));
  const items = sources.map((s) => {
    const name = s.kind === 'law' ? s.title : s.title + '(' + (s.publisher ?? '') + ')';
    return `<li>${escHtml(name)} — 取得日 ${escHtml(s.fetchedAt)}・版 ${escHtml(sourceVersion(s))}<br>${escHtml(s.url)}</li>`;
  });
  return `<ul>\n${items.join('\n')}\n</ul>\n<p>法令は改正されることがあります。取得日から時間がたって古くなったら、判定の前に e-Gov 法令検索や国土交通省の資料の原文を確かめ直してください。この画面は取得日の時点の原文の抜き書きで判定しています。</p>`;
}

// 冒頭の「このツールが見ている法令・資料」(F14f): data/sources/index.json の題名をそのまま並べる(取り込んでいない条は書かない)
export function scopeHtml() {
  const { sources } = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'sources', 'index.json'), 'utf8'));
  return `<ul id="scope-seen">\n${sources.map((s) => `<li>${escHtml(s.title)}</li>`).join('\n')}\n</ul>`;
}

// 台帳の記載事項の表の上の参考(F16c): 国交省のチェックリストの題名・URL・取得日だけ(data/checklist.json の reference)。文は写さない
export function checklistReferenceHtml() {
  const { reference: r } = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'checklist.json'), 'utf8'));
  return escHtml('参考: ' + r.publisher + '「' + r.title + '」(' + r.url + '。掲載ページ「' + r.pageTitle + '」' + r.page + '。取得日 ' + r.fetchedAt + ')。このツールはチェックリストの文を写しておらず、表の事項は施行規則 第14条の2 の原文から作っています');
}

// 和歌山県の例の表示(F37d): 行は押す前から index.html に入るので、切り替えの注記のほかに、いつも出す表示の欄にも書く
export function wakayamaCreditHtml() {
  const table = parseRulesFile(fs.readFileSync(path.join(ROOT, 'data', 'specs', 'wakayama_r0711_rows.json'), 'utf8'));
  const s = table.source;
  return '<p id="credit-wakayama">' + escHtml('段取りと記載項目の「和歌山県の例」には、' + s.publisher + '「' + s.document + '(' + s.edition + ')」(' + s.url + '。取得日 ' + s.fetchedAt + ')の 1-1-1-6〜12 を使っています。'
    + '和歌山県ホームページ公開情報利用規約(https://www.pref.wakayama.lg.jp/prefg/000200/opendata/hpopendatakiyaku.html)に従って利用しています。'
    + '加工: 上の節の文を抜き出し、行の形に言い換えました。加工者はこの作品の作者です。' + tableCredit(table)) + '</p>';
}

export function buildHtml() {
  const shell = fs.readFileSync(SHELL, 'utf8');
  for (const key of ['{{CSP}}', '{{SCRIPT}}', '{{SOURCES}}', '{{SCOPE}}', '{{CHECKLIST_REFERENCE}}', '{{WAKAYAMA_CREDIT}}']) {
    if (!shell.includes(key)) throw new Error('shell.html に ' + key + ' の場所が無い');
  }
  const withBody = shell
    .replace('{{SOURCES}}', () => sourcesHtml())
    .replace('{{SCOPE}}', () => scopeHtml())
    .replace('{{CHECKLIST_REFERENCE}}', () => checklistReferenceHtml())
    .replace('{{WAKAYAMA_CREDIT}}', () => wakayamaCreditHtml())
    .replace('{{SCRIPT}}', () => `<script>\n${bundle()}</script>`);
  return withBody.replace('{{CSP}}', () => makeCsp(withBody));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  fs.writeFileSync(path.join(ROOT, 'index.html'), buildHtml());
  console.log('index.html を書いた');
}

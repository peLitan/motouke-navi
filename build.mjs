// src/ui/shell.html から、ファイル1つで開ける index.html を組み立てる
// 使い方: node build.mjs
// - 画面のスクリプト(src/ui/app.mjs)と、それが読む部品・データ(.mjs・.json)を、import を使わない1つのスクリプトにまとめて埋め込む
// - 使った法令と資料の名前・取得日を data/sources/index.json から本文に書く
// - CSP は外部と通信しない設定にする。インラインのスクリプトは中身のハッシュ(sha256)でだけ許す
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

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
    return `<li>${escHtml(name)} — 取得日 ${escHtml(s.fetchedAt)}${s.revisionId ? '(e-Gov の版 ' + escHtml(s.revisionId) + ')' : ''}<br>${escHtml(s.url)}</li>`;
  });
  return `<ul>\n${items.join('\n')}\n</ul>\n<p>法令は改正されることがあります。取得日から時間がたって古くなったら、判定の前に e-Gov 法令検索や国土交通省の資料の原文を確かめ直してください。この画面は取得日の時点の原文の抜き書きで判定しています。</p>`;
}

// 冒頭の「このツールが見ている法令・資料」(F14f): data/sources/index.json の題名をそのまま並べる(取り込んでいない条は書かない)
export function scopeHtml() {
  const { sources } = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'sources', 'index.json'), 'utf8'));
  return `<ul id="scope-seen">\n${sources.map((s) => `<li>${escHtml(s.title)}</li>`).join('\n')}\n</ul>`;
}

export function buildHtml() {
  const shell = fs.readFileSync(SHELL, 'utf8');
  for (const key of ['{{CSP}}', '{{SCRIPT}}', '{{SOURCES}}', '{{SCOPE}}']) {
    if (!shell.includes(key)) throw new Error('shell.html に ' + key + ' の場所が無い');
  }
  const withBody = shell
    .replace('{{SOURCES}}', () => sourcesHtml())
    .replace('{{SCOPE}}', () => scopeHtml())
    .replace('{{SCRIPT}}', () => `<script>\n${bundle()}</script>`);
  return withBody.replace('{{CSP}}', () => makeCsp(withBody));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  fs.writeFileSync(path.join(ROOT, 'index.html'), buildHtml());
  console.log('index.html を書いた');
}

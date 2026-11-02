// src/ui/shell.html から、ファイル1つで開ける index.html を組み立てる
// 使い方: node build.mjs
// CSP は外部と通信しない設定にする。インラインのスクリプトは中身のハッシュ(sha256)でだけ許す
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const SHELL = path.join(ROOT, 'src', 'ui', 'shell.html');

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

export function buildHtml() {
  const shell = fs.readFileSync(SHELL, 'utf8');
  if (!shell.includes('{{CSP}}')) throw new Error('shell.html に {{CSP}} の場所が無い');
  return shell.replace('{{CSP}}', makeCsp(shell));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  fs.writeFileSync(path.join(ROOT, 'index.html'), buildHtml());
  console.log('index.html を書いた');
}

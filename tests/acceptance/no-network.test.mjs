// F05c: 画面は外部と通信しない。常に出す文と PDL1.0 の表示(条件 F05-2・F05-3)
import test from 'node:test';
import assert from 'node:assert/strict';
import { exists, indexHtml, scriptsOf, withoutScripts } from './_helpers.mjs';

const DISCLAIMER = '指摘の候補です。抜けが無いことの保証や合否ではありません。最終の確認は担当者と発注者との協議で行ってください';

test('index.html がある', () => { assert.ok(exists('index.html')); });

test('CSP: connect-src が \'none\' で、外部の通信先を許していない', () => {
  const html = indexHtml();
  const tag = [...html.matchAll(/<meta\b[^>]*>/gi)].map((x) => x[0]).find((t) => /http-equiv\s*=\s*["']?Content-Security-Policy/i.test(t));
  assert.ok(tag, 'CSP の meta が無い');
  const m = tag.match(/\bcontent\s*=\s*"([^"]+)"/i) || tag.match(/\bcontent\s*=\s*'([^']+)'/i);
  assert.ok(m, 'CSP の content が無い');
  const dirs = Object.fromEntries(m[1].split(';').map((d) => d.trim()).filter(Boolean).map((d) => { const [k, ...v] = d.split(/\s+/); return [k.toLowerCase(), v.join(' ')]; }));
  assert.equal(dirs['connect-src'], "'none'");
  assert.ok(!/https?:|wss?:|\*/.test(m[1]), 'CSP に外部の通信先がある');
  assert.ok(dirs['default-src'] === "'none'" || dirs['default-src'] === "'self'", 'default-src が無いか広い');
  assert.ok(/form-action\s+'none'/.test(m[1]), 'form-action が \'none\' でない');
});

test('外部の読み込みが無い(script・link・img・iframe・css の url・@import)', () => {
  const html = indexHtml();
  assert.ok(!/<script\b[^>]*\bsrc\s*=/i.test(html), '外部ファイルの script がある');
  assert.ok(!/<(link|img|iframe|frame|embed|object|source|video|audio|track)\b[^>]*\b(src|href|data|srcset)\s*=\s*["']?\s*(https?:)?\/\//i.test(html), '外部の読み込みがある');
  assert.ok(!/<link\b[^>]*rel\s*=\s*["']?(stylesheet|preload|prefetch|preconnect|dns-prefetch|modulepreload)/i.test(html), 'link での読み込みがある');
  assert.ok(!/<iframe\b/i.test(html));
  assert.ok(!/url\(\s*["']?\s*(https?:)?\/\//i.test(html), 'css の url() で外部を読む');
  assert.ok(!/@import\b/i.test(html), '@import がある');
  assert.ok(!/<form\b[^>]*\baction\s*=/i.test(html), 'form の送り先がある');
});

test('スクリプトに通信の仕組みが無い', () => {
  const code = scriptsOf(indexHtml()).map((s) => s.code).join('\n');
  for (const re of [/\bfetch\s*\(/, /XMLHttpRequest/, /WebSocket/, /EventSource/, /sendBeacon/, /\bimport\s*\(/, /importScripts/, /new\s+(Shared)?Worker\b/, /RTCPeerConnection/, /\.src\s*=/, /window\.open\s*\(/]) {
    assert.ok(!re.test(code), '通信につながるコード: ' + re);
  }
});

test('「指摘の候補です…」の文が、スクリプトの外の本文に常に出ている', () => {
  const body = withoutScripts(indexHtml()).replace(/<[^>]+>/g, '');
  assert.ok(body.replace(/\s+/g, '').includes(DISCLAIMER.replace(/\s+/g, '')), '常に出す文が無い');
});

test('PDL1.0 の表示: 資料名・国交省・URL・加工したことと加工した人・国交省が作成したものではない', () => {
  const body = withoutScripts(indexHtml()).replace(/<[^>]+>/g, ' ');
  assert.ok(/PDL1\.0|公共データ利用規約/.test(body), 'PDL1.0 の表示が無い');
  assert.ok(/国土交通省/.test(body));
  assert.ok(/https:\/\/www\.mlit\.go\.jp\//.test(body), '資料の URL が無い');
  assert.ok(/「[^」]*(施工体制台帳|土木工事共通仕様書|建設業許可事務ガイドライン)[^」]*」/.test(body), '国交省の資料名(「」で囲んだ名前)が無い');
  assert.ok(/加工/.test(body) && /(加工者|加工した(人|者))/.test(body), '加工したことと加工した人が無い');
  assert.ok(/(国土交通省|国交省)が作成したものではな/.test(body), '国交省が作成したものではない旨が無い');
});

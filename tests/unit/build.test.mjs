// build.mjs の CSP の組み立て(F05c)
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { makeCsp, buildHtml } from '../../build.mjs';

test('スクリプトが無ければ script-src は none', () => {
  assert.match(makeCsp('<p>x</p>'), /script-src 'none'/);
});

test('インラインのスクリプトは中身の sha256 でだけ許し、unsafe-inline を使わない', () => {
  const code = 'document.title = "x";';
  const csp = makeCsp(`<script>${code}</script>`);
  const h = crypto.createHash('sha256').update(code, 'utf8').digest('base64');
  assert.ok(csp.includes(`script-src 'sha256-${h}'`));
  assert.ok(!/script-src[^;]*unsafe-inline/.test(csp));
  assert.match(csp, /connect-src 'none'/);
});

test('buildHtml は {{CSP}} を残さない', () => {
  const html = buildHtml();
  assert.ok(!html.includes('{{CSP}}'));
  assert.match(html, /http-equiv="Content-Security-Policy"/);
});

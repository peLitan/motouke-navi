// F66c: 「PDF で保存・印刷」のまとめの紙。ブラウザが無いので、CSS の書いた値と静的な HTML で確かめる(描いた結果ではない)。
// クラスの付け外しの動きは print-buttons.test.mjs にある
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHtml } from '../../build.mjs';
import { renderSummary } from '../../src/ui/view.mjs';

const html = buildHtml();
const rawCss = html.slice(html.indexOf('<style'), html.indexOf('</style>'));
const css = rawCss.replace(/\/\*[\s\S]*?\*\//g, '');
const body = html.slice(html.indexOf('</style>'));
const print = css.match(/@media print \{([\s\S]*)\n {2}\}/)[1];
const screen = css.slice(0, css.indexOf('@media print'));

const rules = [...print.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2].trim() }));
const selectorsOf = (r) => r.sel.split(',').map((s) => s.trim());
const hiding = rules.filter((r) => /display: none/.test(r.body));
const hiddenStrong = rules.filter((r) => /display: none !important/.test(r.body)).flatMap(selectorsOf);
const briefRules = rules.filter((r) => r.sel.includes('body.print-brief'));
const briefHidden = hiddenStrong.filter((s) => s.startsWith('body.print-brief'));

// 紙に残すもの。隠す規則がこの字を持っていたら、断り書き・結果・出典が紙から消える
const KEPT = ['disclaimer', 'footer', 'summary', '#open-items', '#sources', '#sign-off', '#print-head', '#brief-note', '.basis'];
// 折りたたみの <summary> のタグの規則(印のマーカーと .fold の見出し)。id の summary(まとめの枠)とは別物で、全部の紙のために残す
const SUMMARY_TAG_RULES = ['details.fold > summary', 'details > summary::-webkit-details-marker'];

// 親をたどる。void の要素とコメント・script・style の中は飛ばす
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr', 'circle', 'path', 'rect', 'line', 'polyline', 'polygon', 'ellipse']);
function ancestors() {
  const tag = /<!--[\s\S]*?-->|<script\b[\s\S]*?<\/script>|<textarea\b[\s\S]*?<\/textarea>|<\/?([a-zA-Z][a-zA-Z0-9]*)\b((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
  const stack = [];
  const found = new Map();
  for (const m of body.matchAll(tag)) {
    if (!m[1]) continue;
    const name = m[1].toLowerCase();
    if (m[0].startsWith('</')) {
      const at = stack.findLastIndex((s) => s.name === name);
      if (at >= 0) stack.length = at;
      continue;
    }
    const id = m[2].match(/\bid="([^"]*)"/)?.[1];
    if (id) found.set(id, stack.map((s) => s.id).filter(Boolean));
    if (!VOID.has(name) && !m[0].endsWith('/>')) stack.push({ name, id });
  }
  return found;
}

test('印刷のブロックは1つのままで入れ子が無く、規則は4つの空白で字下げした1行ずつ', () => {
  assert.equal((css.match(/@media print/g) ?? []).length, 1);
  assert.ok(!print.includes('\n  }'), '入れ子の閉じ括弧がある');
  const lines = rawCss.match(/@media print \{([\s\S]*)\n {2}\}/)[1].split('\n').filter((l) => l.trim());
  assert.ok(lines.length > 0);
  for (const l of lines) {
    assert.match(l, /^ {4}\S/, '字下げが違う: ' + l.slice(0, 40));
    if (l.trim().startsWith('/*')) continue;
    assert.ok(l.trim().endsWith('}'), '1行で閉じていない: ' + l.slice(0, 40));
    assert.equal(l.split('{').length, l.split('}').length, '括弧が釣り合わない: ' + l.slice(0, 40));
  }
});

test('まとめの紙で隠す規則: 要点の外と画面向けの文を、全部 body.print-brief 付きで隠す', () => {
  const want = ['#lead', '#can-do-more', '#scope', '#panel-1', '#bid-fold', '#schedule-heading', '#work-kind-schedule', '#awarded-notice', '#schedule-notice', '#schedule-about-fold', '#schedule-result', '#safety-heading', '#safety-note', '#safety-prime-note', '#safety-fold', '#safety-result', '#safety-version', '#panel-3', '#other-tools', '.stats', '.human', 'ul.print-only + p'];
  assert.deepEqual(briefHidden.slice().sort(), want.map((s) => 'body.print-brief ' + s).sort());
  // 全部の紙を巻き込まない: 同じものを印が無いまま隠す規則を足していない
  for (const s of want) assert.ok(!hiddenStrong.includes(s), s + ' が全部の紙からも消える');
});

test('隠す規則の id は実際にある(打ち間違いで隠れないままにしない)', () => {
  const ids = briefHidden.map((s) => s.match(/#([a-z0-9-]+)$/)?.[1]).filter(Boolean);
  assert.equal(ids.length, 19); // F86d: 候補と版の行が折りたたみの外へ出たので2つ増えた
  const seen = ancestors();
  for (const id of ids) assert.ok(seen.has(id), id + ' が画面に無い');
});

test('紙に残すものは隠す規則のセレクタに無い。根拠と次にすることの扱いは設計どおり', () => {
  assert.ok(!hiddenStrong.includes('body.print-brief .basis'), '根拠の見出しの1行が紙から消える');
  assert.ok(!hiddenStrong.includes('body.print-brief .next-go'));
  assert.ok(!/body\.print-brief\s+\.next-card/.test(print), '次にすることをまとめの紙に出している');

  const named = hiding.flatMap(selectorsOf).filter((s) => KEPT.some((k) => s.includes(k)));
  assert.deepEqual(named.slice().sort(), SUMMARY_TAG_RULES.slice().sort());
  // 残した2つは !important でなく、まとめの枠には当たらない
  for (const s of SUMMARY_TAG_RULES) assert.ok(!hiddenStrong.includes(s));
  assert.ok(!/\.summary|#summary/.test(SUMMARY_TAG_RULES.join(' ')));
  assert.ok(!hiddenStrong.some((s) => /disclaimer|footer|summary/.test(s)));
  assert.ok(!/details(\.[a-z-]+)?\s*\{[^}]*display: none/.test(print), '折りたたみの中身まで消している');
});

test('紙に残すものは、まとめで隠す要素の中に入っていない', () => {
  const seen = ancestors();
  const hiddenIds = new Set(briefHidden.map((s) => s.match(/#([a-z0-9-]+)$/)?.[1]).filter(Boolean));
  for (const id of ['disclaimer', 'scope-not-line', 'print-head', 'brief-note', 'open-items', 'summary', 'sources', 'credits', 'sign-off']) {
    assert.ok(seen.has(id), id + ' が無い');
    assert.deepEqual(seen.get(id).filter((a) => hiddenIds.has(a)), [], id + ' が隠す要素の中にある');
  }
  assert.ok(seen.get('open-items').includes('panel-2'));
  assert.ok(seen.get('summary').includes('panel-2'));
});

test('隠す規則が前提にする HTML の形: まとめの結びの文と、ul.print-only の次の段落はこの形で描かれる', () => {
  const out = renderSummary({
    bid: { items: [{ key: 'a', label: '項目', status: 'needs_check' }], checks: [{ key: 'a', label: '項目', message: '確かめる点' }] },
  });
  const page = body.replace(/<script\b[\s\S]*?<\/script>/g, '');
  assert.equal((page.match(/<ul\b[^>]*print-only/g) ?? []).length, 0, '静的な HTML に ul.print-only を足すと次の段落も隠れる');
  assert.match(out, /<ul class="summary-items print-only">/);
  assert.match(out, /<\/ul><p><a href="#open-items">確認が要る点 /);
  assert.match(out, /<p class="human">まとめは下の各結果の数を並べたものです。/);
});

test('字の規則: pt で書き、rem と色の直書きが無い', () => {
  assert.ok(briefRules.length >= 10);
  for (const r of briefRules) {
    assert.ok(!/rem/.test(r.body), 'rem がある: ' + r.sel.slice(0, 40));
    assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(r.body), '色の直書き: ' + r.sel.slice(0, 40));
  }
  const of = (sel) => rules.find((r) => r.sel === sel)?.body;
  assert.equal(of('body.print-brief'), 'line-height: 1.4;');
  assert.match(of('body.print-brief h2'), /font-size: 13pt/);
  assert.match(of('body.print-brief h3'), /font-size: 11\.5pt/);
  assert.equal(of('body.print-brief p, body.print-brief ul, body.print-brief dl'), 'margin-top: 0; margin-bottom: 0;');
  assert.match(of('body.print-brief .summary'), /^border: none/);
  assert.match(of('body.print-brief .summary-items'), /display: flex; flex-wrap: wrap/);
  assert.equal(of('body.print-brief #sources-list li'), 'margin: 0;');
  assert.equal(of('body.print-brief .brief-only'), 'display: block;');
  assert.equal(of('footer'), 'font-size: 10.5pt;');
});

test('2列にしない', () => {
  assert.ok(!briefRules.some((r) => /columns?\s*:|column-count|grid-template-columns/.test(r.body)));
});

test('開いたカードの見出しの「閉じる ▴」を紙に出さない。画面の字は残す', () => {
  const r = rules.find((x) => x.sel.includes('[open]') && x.body === 'content: none;');
  assert.ok(r, '[open] 付きの content: none が無い');
  assert.deepEqual(selectorsOf(r), ['details.open-card[open] > summary::after', 'details#bid-fold[open] > summary::after', 'details.schedule-table[open] > summary::after', 'details.safety-fold[open] > summary::after']);
  // 画面の [open] の規則と同じセレクタで、後ろにあるので勝つ
  assert.ok(screen.includes(r.sel + ' { content: "閉じる ▴"'), '画面の規則とセレクタがずれている');
});

test('帯の副題は紙に出さず、画面では読み上げに残して見えない形にする(F88a)', () => {
  assert.ok(hiddenStrong.includes('.topbar-sub'), '副題が紙に出る');
  assert.ok(!briefHidden.some((s) => s.includes('topbar')), 'まとめの紙だけでなく全部の紙でも隠す');
  assert.match(screen, /\.topbar-sub \{ position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset\(50%\); white-space: nowrap; \}/);
  assert.ok(!/\.topbar-sub[^{}]*\{[^}]*display: none/.test(screen), '画面で読み上げからも消えている');
  assert.ok(body.includes('<span class="topbar-name">Motouke Navi</span><span class="topbar-sub">(はじめての元請けの確認ツール)</span>'));
  assert.ok(!hiddenStrong.includes('.topbar-name'), '作品名まで紙から消える');
});

test('紙の説明の行: 画面には出ず、まとめの紙だけに出る。結果の見出しの下で #result-flag の後・#result-top の前', () => {
  assert.match(screen, /\n {2}\.brief-only \{ display: none; \}\n/);
  const panel = body.slice(body.indexOf('<section id="panel-2"'), body.indexOf('<section id="panel-3"'));
  const m = panel.match(/<p class="brief-only" id="brief-note">([\s\S]*?)<\/p>/);
  assert.ok(m, '#panel-2 に #brief-note が無い');
  const at = panel.indexOf(m[0]);
  assert.ok(panel.indexOf('id="result-flag"') < at && at < panel.indexOf('id="result-top"')); // F86f: 見本の帯は結果を残すのページへ移した
  assert.ok(/id="result-flag"[^\n]*\n<p class="brief-only" id="brief-note">/.test(panel), '#result-flag の直後でない');
  assert.equal((body.match(/\bbrief-only\b/g) ?? []).length, 1, 'まとめだけの要素は1つ');
  assert.ok(!/aria-live/.test(m[0]));
  assert.ok(!/no-print|print-only/.test(m[0]));

  const text = m[1];
  assert.ok(text.includes('入れた条件は「まとめ」の最後'));
  assert.ok(text.includes('全部を印刷した版'));
  assert.ok(text.startsWith('この紙は Motouke Navi の結果の要点です。'));
  for (const w of ['id', 'class', 'CSS', 'details', 'DOM', 'print', '段1', '段2', '段3', '画面か', 'リンク']) {
    assert.ok(!text.includes(w), '作る側の語・画面の語がある: ' + w);
  }
});

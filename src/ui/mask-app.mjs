// 画面の置き換え(F11a): 貼り付けた文を記号に置き換え、前・後・対応表を並べる。戻ってきた文を元に戻す。辞書に語を足す。
// 対応表と足した語は、この画面のメモリの中だけに持つ(保存しない。ページを閉じれば消える)。
import { createMasker, parseAmount } from '../mask/core.mjs';
import { CONSTRUCTION_DICT } from '../mask/dict-construction.mjs';
import { esc } from './view.mjs';

let masker = null;
const getMasker = () => (masker ||= createMasker({ dictionaries: [CONSTRUCTION_DICT] }));

const setText = (doc, id, text) => { const el = doc.getElementById(id); if (el) el.textContent = text; };
const valueOf = (doc, id) => { const el = doc.getElementById(id); return el ? String(el.value ?? '') : ''; };

// 境目の欄(「50,000,000 80,000,000」「5000万、8000万」など。空白・読点・改行で区切る)を数の並びにする
export function parseThresholds(text) {
  const nums = [];
  const bad = [];
  for (const part of String(text ?? '').split(/[\s　、;；/／]+/).filter(Boolean)) {
    const n = parseAmount(part);
    if (n === null || n <= 0) bad.push(part); else nums.push(n);
  }
  return { nums, bad };
}

export function renderMap(entries) {
  if (!entries.length) return '<p>置き換えた語はありません。辞書に無い語は残ります。後の欄を確かめてください。</p>';
  const rows = entries.map((e) => '<tr><td>' + esc(e.token) + '</td><td>' + esc(e.label) + '</td><td>' + esc(e.original)
    + (e.variants && e.variants.length > 1 ? '(ほかの書き方: ' + esc(e.variants.slice(1).join('、')) + ')' : '') + '</td></tr>');
  return '<table><thead><tr><th>記号</th><th>種類</th><th>元の語</th></tr></thead><tbody>' + rows.join('') + '</tbody></table>';
}

export function renderTerms(terms) {
  if (!terms.length) return '<p>足した語はまだありません。</p>';
  return '<ul>' + terms.map((t) => '<li>' + esc(t.word) + '(' + esc(t.label) + ')</li>').join('') + '</ul>';
}

export function runMask(doc) {
  const m = getMasker();
  const text = valueOf(doc, 'mask-input');
  const amounts = valueOf(doc, 'mask-amounts') === 'band' ? 'band' : 'keep';
  const { nums, bad } = parseThresholds(valueOf(doc, 'mask-thresholds'));
  const notes = [];
  if (amounts === 'band' && bad.length) notes.push('境目の欄で読めなかった値: ' + bad.join('、') + '(数字で入れてください)');
  if (amounts === 'band' && !nums.length) notes.push('境目が無いので、金額はすべて「〔金額〕」にしました。');
  const r = m.mask(text, { amounts, thresholds: nums });
  setText(doc, 'mask-before', text);
  setText(doc, 'mask-after', r.masked);
  const mapEl = doc.getElementById('mask-map');
  if (mapEl) mapEl.innerHTML = renderMap(r.map);
  if (amounts === 'band') notes.push('金額の「境目」の形は、戻しても元の金額には戻りません。');
  setText(doc, 'mask-status', notes.join(' '));
}

export function runUnmask(doc) {
  setText(doc, 'unmask-output', getMasker().unmask(valueOf(doc, 'unmask-input')));
}

export function addDictWord(doc) {
  const word = valueOf(doc, 'dict-word').trim();
  const kind = valueOf(doc, 'dict-kind') || 'other';
  if (!word) { setText(doc, 'dict-status', '足す語を入れてください。'); return; }
  const m = getMasker();
  m.addTerm(word, kind);
  setText(doc, 'dict-status', '「' + word + '」を' + m.labelOf(kind) + 'として足しました。もう一度「置き換える」を押すと使います。');
  const w = doc.getElementById('dict-word');
  if (w) w.value = '';
  const list = doc.getElementById('dict-list');
  if (list) list.innerHTML = renderTerms(m.terms());
}

export function resetMask(doc) {
  getMasker().reset();
  for (const id of ['mask-before', 'mask-after', 'unmask-output', 'mask-status']) setText(doc, id, '');
  const mapEl = doc.getElementById('mask-map');
  if (mapEl) mapEl.innerHTML = '';
  const list = doc.getElementById('dict-list');
  if (list) list.innerHTML = renderTerms([]);
  setText(doc, 'dict-status', '対応表と足した語を消しました。');
}

export function startMask(doc) {
  const on = (id, f) => {
    const btn = doc.getElementById(id);
    if (btn) btn.addEventListener('click', (ev) => { if (ev && ev.preventDefault) ev.preventDefault(); f(); });
  };
  on('mask-run', () => runMask(doc));
  on('unmask-run', () => runUnmask(doc));
  on('dict-add', () => addDictWord(doc));
  on('mask-reset', () => resetMask(doc));
}

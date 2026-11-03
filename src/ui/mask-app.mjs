// 画面の置き換え(F11a): 貼り付けた文を記号に置き換え、前・後・対応表を並べる。戻ってきた文を元に戻す。辞書に語を足す。
// 対応表と足した語は、この画面のメモリの中だけに持つ(ページを閉じれば消える)。
// 利用者が「対応表を書き出す」を押したときだけ、この PC にファイルとして保存する。そのファイルには元の名前が入っている(F11d)。
// 足した語だけを「辞書を書き出す」で辞書のファイルにし、「辞書を読み込む」で読み込める(F19a)。こちらも元の名前が入っている。
// 業界(建設・医療(例))を切り替えられる(F19b)。
import { createMasker, parseAmount, MAP_NOTICE, DICT_NOTICE } from '../mask/core.mjs';
import { downloadText } from './download.mjs';
import { CONSTRUCTION_DICT } from '../mask/dict-construction.mjs';
import { MEDICAL_DICT } from '../mask/dict-medical.mjs';
import { esc, scrollTable } from './view.mjs';
import { extractText } from '../mask/extract.mjs';
import { PERSON_RULES } from '../mask/rules-person.mjs';
import { SITE_RULES } from '../mask/rules-site.mjs';

let masker = null;
// 確信の弱い語(規則だけで見つけた語)の選び(F17c)。記号 → 'replace'(置き換える)か 'keep'(残す)。無ければ未確認。
// この画面のメモリの中だけに持つ(ブラウザに保存しない)。同じ語は同じ記号になるので、置き換え直しても選びは残る
const decisions = new Map();
// 最後に置き換えた結果(後の欄を選びに合わせて描き直すため)
let last = null;
// 業界(語尾・役職の表)の切り替え(F19b)。医療は「例」の表で、漏れの率は測っていない
export const INDUSTRIES = { construction: CONSTRUCTION_DICT, medical: MEDICAL_DICT };
let industry = 'construction';
export const currentIndustry = () => industry;
export const INDUSTRY_SWITCH_NOTICE = '業界を切り替えると、今の対応表は消えます(足した語は残します)。あとで戻す文があるときは、先に「対応表を書き出す」で保存してください。';
const getMasker = () => (masker ||= createMasker({ dictionaries: [INDUSTRIES[industry]] }));

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
  return scrollTable('対応表', '<table><thead><tr><th>記号</th><th>種類</th><th>元の語</th></tr></thead><tbody>' + rows.join('') + '</tbody></table>');
}

export function renderTerms(terms) {
  if (!terms.length) return '<p>足した語はまだありません。</p>';
  return '<ul>' + terms.map((t) => '<li>' + esc(t.word) + '(' + esc(t.label) + ')</li>').join('') + '</ul>';
}

const RULE_NAMES = Object.fromEntries([...PERSON_RULES, ...SITE_RULES].map((r) => [r.id, r.name]));
export const ruleName = (id) => RULE_NAMES[id] || '文脈の規則';
export const UNCHECKED_NOTICE = '未確認の語があります';
const STATE_LABEL = { replace: '置き換える', keep: '残す' };
export const stateOf = (token) => decisions.get(token) || 'unchecked';
const stateLabel = (s) => STATE_LABEL[s] || '未確認';

// 対応表の行のうち、規則だけで見つけた語(rule の付いた行)
export const weakEntries = (map) => (map || []).filter((e) => e.rule);

// 後の文を、選びに合わせて作る。「残す」を選んだ語は記号を元の語に戻す。
// html は確信の弱い語を <mark> で強調したもの、text は同じ中身の文字だけのもの(外へ貼る文)
export function renderAfter(masked, map, state = stateOf) {
  const weak = weakEntries(map);
  const src = String(masked ?? '');
  if (!weak.length) return { html: esc(src), text: src };
  const byToken = new Map(weak.map((e) => [e.token, e]));
  const re = new RegExp([...byToken.keys()].sort((a, b) => b.length - a.length).map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'gu');
  let html = '';
  let text = '';
  let pos = 0;
  for (const m of src.matchAll(re)) {
    const e = byToken.get(m[0]);
    const s = state(e.token);
    const shown = s === 'keep' ? e.original : e.token;
    html += esc(src.slice(pos, m.index)) + '<mark class="mask-weak mask-' + s + '" title="' + esc(ruleName(e.rule) + 'で見つけた語・' + stateLabel(s)) + '">' + esc(shown) + '</mark>';
    text += src.slice(pos, m.index) + shown;
    pos = m.index + m[0].length;
  }
  html += esc(src.slice(pos));
  text += src.slice(pos);
  return { html, text };
}

// 確信の弱い語を1件ずつ選ぶ表。選ぶまでは「未確認」
export function renderReview(map, state = stateOf) {
  const weak = weakEntries(map);
  if (!weak.length) return '';
  const n = weak.filter((e) => state(e.token) === 'unchecked').length;
  const rows = weak.map((e) => {
    const s = state(e.token);
    const btn = (v) => '<button type="button" data-mask-decide="' + v + '" data-token="' + esc(e.token) + '" aria-pressed="' + (s === v) + '">' + STATE_LABEL[v] + '</button>';
    return '<tr class="mask-' + s + '"><td>' + esc(e.token) + '</td><td>' + esc(e.label) + '</td><td>' + esc(e.original) + '</td><td>' + esc(ruleName(e.rule))
      + '</td><td>' + stateLabel(s) + '</td><td>' + btn('replace') + ' ' + btn('keep') + '</td></tr>';
  });
  return '<h3>確かめてほしい語(規則だけで見つけた語)</h3>'
    + '<p class="note">辞書に無く、まわりの語(敬称・役職・欄名・語尾など)だけから見つけた語です。名前でない語を置き換えていることがあります。後の欄で印の付いた語を見て、1件ずつ「置き換える」か「残す」を選んでください。「残す」を選んだ語は、後の欄で元の語に戻します。選ぶまでは「未確認」です(全 ' + weak.length + ' 件・未確認 ' + n + ' 件)。</p>'
    + scrollTable('確かめてほしい語', '<table><thead><tr><th>記号</th><th>種類</th><th>元の語</th><th>見つけ方</th><th>状態</th><th>選ぶ</th></tr></thead><tbody>' + rows.join('') + '</tbody></table>');
}

// 後の欄・選ぶ表・「未確認の語があります」を、今の選びで描き直す
function renderDecisions(doc) {
  const map = last ? last.map : [];
  const after = doc.getElementById('mask-after');
  if (after && last) after.innerHTML = renderAfter(last.masked, map).html;
  const rv = doc.getElementById('mask-review');
  if (rv) rv.innerHTML = renderReview(map);
  const n = weakEntries(map).filter((e) => stateOf(e.token) === 'unchecked').length;
  const warn = doc.getElementById('mask-unchecked');
  if (warn) {
    warn.textContent = n ? UNCHECKED_NOTICE + '(' + n + ' 件)。上の「確かめてほしい語」で「置き換える」か「残す」を選んでから、後の欄の文を外へ出してください。' : '';
    warn.hidden = !n;
  }
}

// 後の欄の、今の選びに合わせた文(外へ貼る文)
export function maskedText() {
  return last ? renderAfter(last.masked, last.map).text : '';
}

// 確信の弱い語の1件を「置き換える」か「残す」にする(F17c)
export function decideMask(doc, token, value) {
  if (!last || !weakEntries(last.map).some((e) => e.token === token)) return false;
  if (value !== 'replace' && value !== 'keep') return false;
  decisions.set(token, value);
  renderDecisions(doc);
  return true;
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
  last = { masked: r.masked, map: r.map };
  renderDecisions(doc);
  const mapEl = doc.getElementById('mask-map');
  if (mapEl) mapEl.innerHTML = renderMap(r.map);
  if (amounts === 'band') notes.push('金額の「境目」の形は、戻しても元の金額には戻りません。');
  setText(doc, 'mask-status', notes.join(' '));
}

// 業界を切り替える(F19b)。足した語は新しい辞書に移し、対応表・選び・前後の欄は消す。
// 対応表があるときは確かめ、やめたら選びを元に戻す
export function setIndustry(doc, value, win) {
  const sel = doc.getElementById('mask-industry');
  if (!Object.hasOwn(INDUSTRIES, value)) {
    if (sel) sel.value = industry;
    setText(doc, 'mask-industry-status', '知らない業界です: ' + String(value));
    return false;
  }
  if (value === industry) return true;
  const old = masker;
  if (old && old.entries().length && win && typeof win.confirm === 'function' && !win.confirm(INDUSTRY_SWITCH_NOTICE + '\n切り替えますか。')) {
    if (sel) sel.value = industry;
    setText(doc, 'mask-industry-status', '切り替えをやめました。');
    return false;
  }
  const terms = old ? old.terms() : [];
  industry = value;
  masker = null;
  const m = getMasker();
  for (const t of terms) m.addTerm(t.word, t.kind);
  decisions.clear();
  last = null;
  renderDecisions(doc);
  for (const id of ['mask-before', 'mask-after', 'unmask-output', 'mask-status']) setText(doc, id, '');
  const mapEl = doc.getElementById('mask-map');
  if (mapEl) mapEl.innerHTML = '';
  if (sel) sel.value = industry;
  setText(doc, 'mask-industry-status', '業界を「' + INDUSTRIES[industry].name + '」にしました。'
    + (industry === 'medical' ? 'これは例の表で、医療の書類での漏れの率は測っていません。' : '')
    + (terms.length ? '足した語 ' + terms.length + ' 件はそのまま使います。' : '') + 'もう一度「置き換える」を押してください。');
  return true;
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
  decisions.clear();
  last = null;
  renderDecisions(doc);
  for (const id of ['mask-before', 'mask-after', 'unmask-output', 'mask-status', 'map-status', 'dict-file-status']) setText(doc, id, '');
  const mapEl = doc.getElementById('mask-map');
  if (mapEl) mapEl.innerHTML = '';
  const list = doc.getElementById('dict-list');
  if (list) list.innerHTML = renderTerms([]);
  setText(doc, 'dict-status', '対応表と足した語を消しました。');
}

const today = () => {
  const d = new Date();
  const z = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate());
};

// 対応表を書き出す(F11d)。元の名前が入っていることを画面に出し、確かめてから書き出す
export function exportMaskMap(doc, win) {
  const m = getMasker();
  if (!m.entries().length && !m.terms().length) {
    setText(doc, 'map-status', '書き出す対応表がまだありません。先に「置き換える」を押してください。');
    return false;
  }
  setText(doc, 'map-status', MAP_NOTICE);
  if (win && typeof win.confirm === 'function' && !win.confirm(MAP_NOTICE + '\n書き出しますか。')) {
    setText(doc, 'map-status', '書き出しをやめました。' + MAP_NOTICE);
    return false;
  }
  downloadText(doc, m.exportMap(), '置き換えの対応表_' + today() + '.json', 'application/json;charset=utf-8');
  setText(doc, 'map-status', '対応表を書き出しました。' + MAP_NOTICE);
  return true;
}

// 書き出した対応表のファイルの中身を読み込む(F11d)。今の対応表と足した語は、読み込んだものに置き換わる
export function importMaskMap(doc, text) {
  const m = getMasker();
  try {
    const n = m.importMap(text);
    decisions.clear();
    last = null;
    setText(doc, 'mask-after', '');
    renderDecisions(doc);
    const mapEl = doc.getElementById('mask-map');
    if (mapEl) mapEl.innerHTML = renderMap(m.entries());
    const list = doc.getElementById('dict-list');
    if (list) list.innerHTML = renderTerms(m.terms());
    setText(doc, 'map-status', '対応表を読み込みました(対応表 ' + n.entries + ' 行・足した語 ' + n.terms + ' 件)。「元に戻す」で使えます。読み込んだファイルにも元の名前が入っています。');
    return true;
  } catch (e) {
    setText(doc, 'map-status', '読み込めませんでした: ' + (e && e.message ? e.message : String(e)) + ' 今の対応表はそのままです。');
    return false;
  }
}

const DICT_MAX_BYTES = 1024 * 1024;

// 辞書(足した語と種類)を書き出す(F19a)。元の名前が入っていることを画面に出し、確かめてから書き出す
export function exportDictFile(doc, win) {
  const m = getMasker();
  if (!m.terms().length) {
    setText(doc, 'dict-file-status', '書き出す語がまだありません。先に「辞書に足す」で語を足してください。');
    return false;
  }
  setText(doc, 'dict-file-status', DICT_NOTICE);
  if (win && typeof win.confirm === 'function' && !win.confirm(DICT_NOTICE + '\n書き出しますか。')) {
    setText(doc, 'dict-file-status', '書き出しをやめました。' + DICT_NOTICE);
    return false;
  }
  downloadText(doc, m.exportDict(), '置き換えの辞書_' + today() + '.json', 'application/json;charset=utf-8');
  setText(doc, 'dict-file-status', '辞書を書き出しました(' + m.terms().length + ' 語)。' + DICT_NOTICE);
  return true;
}

// 書き出した辞書のファイルの中身を読み込む(F19a)。今の足した語に加える。壊れたファイル・形の違うファイルは読み込まず、理由を出す
export function importDictFile(doc, text) {
  const m = getMasker();
  try {
    const n = m.importDict(text);
    const list = doc.getElementById('dict-list');
    if (list) list.innerHTML = renderTerms(m.terms());
    setText(doc, 'dict-file-status', '辞書を読み込みました(読んだ語 ' + n.read + '・新しく足した語 ' + n.added + '・種類を変えた語 ' + n.changed + '。足した語は全部で ' + n.total + ')。もう一度「置き換える」を押すと使います。読み込んだファイルにも元の名前が入っています。');
    return true;
  } catch (e) {
    setText(doc, 'dict-file-status', '読み込めませんでした: ' + (e && e.message ? e.message : String(e)) + ' 今の辞書はそのままです。');
    return false;
  }
}

// ファイルを読み、取り出した文字を「置き換える文」の欄に入れる(F11c)。置き換えは利用者が「置き換える」を押してから
export async function loadMaskFile(doc, file) {
  if (!file) return false;
  try {
    const buf = await file.arrayBuffer();
    const text = await extractText(file.name, new Uint8Array(buf));
    const input = doc.getElementById('mask-input');
    if (input) input.value = text;
    const lines = text ? text.split(/\r?\n/).length : 0;
    setText(doc, 'mask-file-status', '「' + file.name + '」から文字を取り出しました(' + lines + ' 行)。中身を確かめてから「置き換える」を押してください。');
    return true;
  } catch (e) {
    setText(doc, 'mask-file-status', '「' + file.name + '」を読めませんでした: ' + (e && e.message ? e.message : String(e)));
    return false;
  }
}

export function startMask(doc) {
  const on = (id, f) => {
    const btn = doc.getElementById(id);
    if (btn) btn.addEventListener('click', (ev) => { if (ev && ev.preventDefault) ev.preventDefault(); f(); });
  };
  const ind = doc.getElementById('mask-industry');
  if (ind) ind.addEventListener('change', () => setIndustry(doc, String(ind.value ?? ''), doc.defaultView));
  on('mask-run', () => runMask(doc));
  on('unmask-run', () => runUnmask(doc));
  on('dict-add', () => addDictWord(doc));
  on('mask-reset', () => resetMask(doc));
  on('map-export', () => exportMaskMap(doc, doc.defaultView));
  on('dict-export', () => exportDictFile(doc, doc.defaultView));
  // 選ぶ表のボタンは描き直すたびに作り直すので、表の枠で受ける
  const rv = doc.getElementById('mask-review');
  if (rv) {
    rv.addEventListener('click', (ev) => {
      const b = ev && ev.target && typeof ev.target.closest === 'function' ? ev.target.closest('button[data-mask-decide]') : null;
      if (!b) return;
      if (ev.preventDefault) ev.preventDefault();
      decideMask(doc, b.getAttribute('data-token'), b.getAttribute('data-mask-decide'));
    });
  }
  const src = doc.getElementById('mask-file');
  if (src) {
    src.addEventListener('change', async () => {
      const f = src.files && src.files[0];
      if (!f) return;
      await loadMaskFile(doc, f);
      src.value = '';
    });
  }
  const dictFile = doc.getElementById('dict-import');
  if (dictFile) {
    dictFile.addEventListener('change', async () => {
      const f = dictFile.files && dictFile.files[0];
      if (!f) return;
      if (f.size > DICT_MAX_BYTES) setText(doc, 'dict-file-status', '読み込めませんでした: 辞書のファイルとしては大きすぎます(1MB まで)。今の辞書はそのままです。');
      else importDictFile(doc, await f.text());
      dictFile.value = '';
    });
  }
  const file = doc.getElementById('map-import');
  if (file) {
    file.addEventListener('change', async () => {
      const f = file.files && file.files[0];
      if (!f) return;
      importMaskMap(doc, await f.text());
      file.value = '';
    });
  }
}

// 画面の置き換え(F11a): 貼り付けた文を記号に置き換え、前・後・対応表を並べる。戻ってきた文を元に戻す。辞書に語を足す。
// 対応表と足した語は、この画面のメモリの中だけに持つ(ページを閉じれば消える)。
// 利用者が「対応表を書き出す」を押したときだけ、この端末にファイルとして保存する。そのファイルには元の名前が入っている(F11d)。
// 足した語だけを「辞書を書き出す」で辞書のファイルにし、「辞書を読み込む」で読み込める(F19a)。こちらも元の名前が入っている。
// 業界(建設・医療(例))を切り替えられる(F19b)。
// 置き換えで見つからなかった会社・団体の名前らしい語は「辞書に足す候補」として出す(F36b)。候補は自動で置き換えず、利用者が1つずつ選ぶ。
import { createMasker, parseAmount, MAP_NOTICE, DICT_NOTICE } from '../mask/core.mjs';
import { downloadText } from './download.mjs';
import { CONSTRUCTION_DICT } from '../mask/dict-construction.mjs';
import { MEDICAL_DICT } from '../mask/dict-medical.mjs';
import { esc, scrollTable } from './view.mjs';
import { extractText } from '../mask/extract.mjs';
import { PERSON_RULES } from '../mask/rules-person.mjs';
import { SITE_RULES } from '../mask/rules-site.mjs';
import { COMPANY_RULES, FACILITY_RULES } from '../mask/rules-company.mjs';
import { checkDecoys, decoyMessage } from '../mask/decoy.mjs';
import { findResiduals, residualMessage } from '../mask/residual.mjs';
import { findCompanyCandidates } from '../mask/company-candidates.mjs';

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

const RULE_NAMES = Object.fromEntries([...PERSON_RULES, ...SITE_RULES, ...COMPANY_RULES, ...FACILITY_RULES].map((r) => [r.id, r.name]));
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

// 辞書に足す候補(F36b)。「足さない」を選んだ語は、この画面のメモリの中だけに持つ。同じ語が次の置き換えでも出たら、選びを残す
const skippedCandidates = new Set();
const candidateKey = (word) => String(word).replace(/[\s\u3000]+/gu, '');
const CANDIDATE_SHOWN = 50;
export const isCandidateSkipped = (word) => skippedCandidates.has(candidateKey(word));

// 候補の表。選ぶまで語は後の欄に元のまま残るので、そのことを表の前に書く
export function renderCandidates(list, skipped = isCandidateSkipped) {
  if (!list) return '';
  if (!list.length) return '<h3>辞書に足す候補</h3><p class="note">会社・団体の名前らしい語で、置き換えていない語は見つかりませんでした。形や欄から探しただけなので、後の欄は目で確かめてください。</p>';
  const rows = list.slice(0, CANDIDATE_SHOWN).map((c) => {
    const skip = skipped(c.word);
    const attr = 'data-word="' + esc(c.word) + '"';
    return '<tr' + (skip ? ' class="mask-keep"' : '') + '><td>' + esc(c.word) + '</td><td>' + esc(c.basis) + '</td><td class="num">' + c.count + '</td><td>' + (skip ? '足さない' : '未選択')
      + '</td><td><button type="button" data-candidate="add" ' + attr + '>辞書に足す</button> <button type="button" data-candidate="skip" ' + attr + ' aria-pressed="' + skip + '">足さない</button></td></tr>';
  });
  const undecided = list.filter((c) => !skipped(c.word)).length;
  const more = list.length > CANDIDATE_SHOWN ? ' 表には先頭の ' + CANDIDATE_SHOWN + ' 件を出しています(ほか ' + (list.length - CANDIDATE_SHOWN) + ' 件)。足すと次の候補が出ます。' : '';
  return '<h3>辞書に足す候補(会社・団体の名前らしい語)</h3>'
    + '<p class="note">置き換えで見つからなかった語のうち、語尾や欄から会社・団体の名前らしいと見た語です。候補は自動では置き換えません。選ぶまで、この語は後の欄に元のまま残ります。名前の語は「辞書に足す」(会社名として足し、すぐに置き換え直します)、普通の言葉は「足さない」を選んでください(全 ' + list.length + ' 件・未選択 ' + undecided + ' 件)。' + more + '</p>'
    + scrollTable('辞書に足す候補', '<table><thead><tr><th>語</th><th>見つけた所</th><th class="num">回数</th><th>状態</th><th>選ぶ</th></tr></thead><tbody>' + rows.join('') + '</tbody></table>');
}

// 候補の1件を「辞書に足す」か「足さない」にする(F36b)。足すときだけ辞書に入れて置き換え直す
export function decideCandidate(doc, word, value) {
  const c = last && last.candidates ? last.candidates.find((x) => x.word === word) : null;
  if (!c || (value !== 'add' && value !== 'skip')) return false;
  if (value === 'skip') {
    skippedCandidates.add(candidateKey(word));
    renderDecisions(doc);
    setText(doc, 'mask-candidate-status', '「' + word + '」は足しません。この語は後の欄に元のまま残ります。');
    return true;
  }
  skippedCandidates.delete(candidateKey(word));
  const m = getMasker();
  m.addTerm(word, 'company');
  const list = doc.getElementById('dict-list');
  if (list) list.innerHTML = renderTerms(m.terms());
  runMask(doc);
  setText(doc, 'mask-candidate-status', '「' + word + '」を' + m.labelOf('company') + 'として足し、置き換え直しました。');
  return true;
}

// 後の欄・選ぶ表・「未確認の語があります」を、今の選びで描き直す
function renderDecisions(doc) {
  const map = last ? last.map : [];
  const after = doc.getElementById('mask-after');
  if (after && last) after.innerHTML = renderAfter(last.masked, map).html;
  const rv = doc.getElementById('mask-review');
  if (rv) rv.innerHTML = renderReview(map);
  const cands = doc.getElementById('mask-candidates');
  if (cands) cands.innerHTML = last ? renderCandidates(last.candidates) : '';
  const n = weakEntries(map).filter((e) => stateOf(e.token) === 'unchecked').length;
  const warn = doc.getElementById('mask-unchecked');
  if (warn) {
    warn.textContent = n ? UNCHECKED_NOTICE + '(' + n + ' 件)。上の「確かめてほしい語」で「置き換える」か「残す」を選んでから、後の欄の文を外へ出してください。' : '';
    warn.hidden = !n;
  }
  updateResidual(doc);
}

// 「元に戻す」の前に、対応表の元の語が後の欄に残っていないかを探し直す(F28b)。
// 後の欄(今の選びに合わせた、外へ貼る文)を、対応表のすべての語(この画面で前に置き換えた語・読み込んだ対応表を含む)で探す。
// 「残す」を選んだ語は、わざと残したので数えない。結果は置き換えのたび・選びを変えるたび・「元に戻す」を押すたびに出し直す
let lastResidual = null;
export const lastResidualCheck = () => lastResidual;
function updateResidual(doc) {
  if (!last) { lastResidual = null; setText(doc, 'mask-residual', ''); return null; }
  const keep = weakEntries(last.map).filter((e) => stateOf(e.token) === 'keep').map((e) => e.token);
  lastResidual = findResiduals(maskedText(), getMasker().entries(), { skipTokens: keep });
  setText(doc, 'mask-residual', residualMessage(lastResidual));
  return lastResidual;
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
  // 候補は探して見せるだけで、後の欄も対応表も変えない(F36b)
  last = { masked: r.masked, map: r.map, candidates: findCompanyCandidates(text, m.spans(text), INDUSTRIES[industry].candidates) };
  setText(doc, 'mask-candidate-status', '');
  renderDecisions(doc);
  const mapEl = doc.getElementById('mask-map');
  if (mapEl) mapEl.innerHTML = renderMap(r.map);
  if (amounts === 'band') notes.push('金額の「境目」の形は、戻しても元の金額には戻りません。');
  setText(doc, 'mask-status', notes.join(' '));
  // 見本の語を混ぜて見落としを測る(F28a)。見本は後の欄・対応表・記号の番号に入らない(m.spans だけを使う)
  const check = checkDecoys(m, text, decoyRand ? { rand: decoyRand } : {});
  lastDecoy = check;
  setText(doc, 'mask-decoy', decoyMessage(check));
}

// 見本の確かめの、最後の結果(試験で見る)。見本の語は架空
let lastDecoy = null;
export const lastDecoyCheck = () => lastDecoy;
// 見本の型を選ぶ乱数(試験で決まった値にする。ふだんは Math.random)
let decoyRand = null;
export function setDecoyRandom(fn) { decoyRand = typeof fn === 'function' ? fn : null; }

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
  skippedCandidates.clear();
  last = null;
  renderDecisions(doc);
  for (const id of ['mask-before', 'mask-after', 'unmask-output', 'mask-status', 'mask-decoy', 'mask-residual', 'mask-candidate-status']) setText(doc, id, '');
  const mapEl = doc.getElementById('mask-map');
  if (mapEl) mapEl.innerHTML = '';
  if (sel) sel.value = industry;
  setText(doc, 'mask-industry-status', '業界を「' + INDUSTRIES[industry].name + '」にしました。'
    + (industry === 'medical' ? 'これは例の表で、医療の書類での漏れの率は測っていません。' : '')
    + (terms.length ? '足した語 ' + terms.length + ' 件はそのまま使います。' : '') + 'もう一度「置き換える」を押してください。');
  return true;
}

export function runUnmask(doc) {
  updateResidual(doc);
  setText(doc, 'unmask-output', getMasker().unmask(valueOf(doc, 'unmask-input')));
}

export function addDictWord(doc) {
  const word = valueOf(doc, 'dict-word').trim();
  const kind = valueOf(doc, 'dict-kind') || 'other';
  if (!word) { setText(doc, 'dict-status', '足す語を入れてください。'); return; }
  const m = getMasker();
  const added = m.addTerm(word, kind);
  setText(doc, 'dict-status', '「' + word + '」を' + m.labelOf(kind) + 'として足しました。もう一度「置き換える」を押すと使います。'
    + (added.warning ? ' 注意: ' + added.warning : ''));
  const w = doc.getElementById('dict-word');
  if (w) w.value = '';
  const list = doc.getElementById('dict-list');
  if (list) list.innerHTML = renderTerms(m.terms());
}

export function resetMask(doc) {
  getMasker().reset();
  decisions.clear();
  skippedCandidates.clear();
  last = null;
  renderDecisions(doc);
  for (const id of ['mask-before', 'mask-after', 'unmask-output', 'mask-status', 'mask-decoy', 'mask-residual', 'mask-candidate-status', 'map-status', 'dict-file-status']) setText(doc, id, '');
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
    skippedCandidates.clear();
    last = null;
    setText(doc, 'mask-after', '');
    setText(doc, 'mask-candidate-status', '');
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
    setText(doc, 'dict-file-status', '辞書を読み込みました(読んだ語 ' + n.read + '・新しく足した語 ' + n.added + '・種類を変えた語 ' + n.changed + '。足した語は全部で ' + n.total + ')。もう一度「置き換える」を押すと使います。読み込んだファイルにも元の名前が入っています。'
      + (n.short && n.short.length ? ' 注意: 1字の語が ' + n.short.length + ' 件あります。1字の語はほかの語の一部も置き換わります(会社名・メール・住所・電話の形の中は、長い方をまとめて置き換えます)。' : ''));
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
  const cands = doc.getElementById('mask-candidates');
  if (cands) {
    cands.addEventListener('click', (ev) => {
      const b = ev && ev.target && typeof ev.target.closest === 'function' ? ev.target.closest('button[data-candidate]') : null;
      if (!b) return;
      if (ev.preventDefault) ev.preventDefault();
      decideCandidate(doc, b.getAttribute('data-word'), b.getAttribute('data-candidate'));
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

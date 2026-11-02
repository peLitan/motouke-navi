// 画面のつながり(F05a・F05e・F05b): 入力欄を読み、入札前の確認と施工体制台帳の判定を動かし、結果の欄に書く。結果を印刷・CSV に書き出す。
// build.mjs がこのファイルと部品を index.html の1つのスクリプトにまとめ、最後に startApp(document) を呼ぶ。
// 入れた内容はどこにも保存しない(ページを閉じれば消える)。
import { readBidForm, formErrors, BID_FORM_IDS, CHECKBOX_IDS } from './form.mjs';
import { renderBidResult, renderTaichoResult, renderErrors, renderCheckResult } from './view.mjs';
import { parseLedgerText } from '../ledger-text.mjs';
import { checkTaicho } from '../check-taicho.mjs';
import { bidCheck } from '../bid-check.mjs';
import { judgeTaicho } from '../taicho.mjs';
import { stage1Rows, checkRows, toCsv } from '../export.mjs';
import { SAMPLE } from '../sample.mjs';
import { startMask } from './mask-app.mjs';
import { startAi } from './ai-app.mjs';
import { downloadText } from './download.mjs';

// 書き出しの最後に入れる文(画面の上の注意と同じ)
const NOTICE = '指摘の候補です。抜けが無いことの保証や合否ではありません。最終の確認は担当者と発注者との協議で行ってください';

// 最後に「確認する」で出した結果。印刷と CSV はこれを使う(ページを閉じれば消える)
let last = null;
const STALE = '条件が変わりました。もう一度「確認する」を押してから、印刷・書き出しをしてください。';
let stale = false; // 結果を出したあとに条件を変えたか

function collect(doc) {
  const values = {};
  for (const id of BID_FORM_IDS) {
    const el = doc.getElementById(id);
    if (!el) continue;
    values[id] = CHECKBOX_IDS.includes(id) ? el.checked === true : el.value;
  }
  return values;
}

export function runBid(doc) {
  const bidOut = doc.getElementById('bid-result');
  const taichoOut = doc.getElementById('taicho-result');
  const values = collect(doc);
  const errors = formErrors(values);
  if (errors.length) {
    last = null;
    bidOut.innerHTML = renderErrors(errors);
    taichoOut.innerHTML = renderErrors(errors);
    return;
  }
  last = null;
  const input = readBidForm(values);
  try {
    const bid = bidCheck(input);
    const taicho = judgeTaicho(input);
    bidOut.innerHTML = renderBidResult(bid);
    taichoOut.innerHTML = renderTaichoResult(taicho);
    last = { bid, taicho };
    stale = false;
    setExportStatus(doc, '');
  } catch (e) {
    const msg = renderErrors(['判定の途中で止まりました(規則表か抜き書きの誤りの可能性があります): ' + String(e && e.message ? e.message : e)]);
    bidOut.innerHTML = msg;
    taichoOut.innerHTML = msg;
  }
}

function setExportStatus(doc, text) {
  const el = doc.getElementById('export-status');
  if (el) el.textContent = text;
}

// 印刷のとき、根拠の条などの折りたたみ(details)を開いておく(閉じたままだと中身が紙に出ない)
function openDetails(doc) {
  for (const d of doc.querySelectorAll('details')) d.open = true;
}

// 今日の日付(ファイル名に使う。PC の時計の日付)
function today() {
  const d = new Date();
  const z = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate());
}

export function exportCsv(doc) {
  if (!last) { setExportStatus(doc, stale ? STALE : '先に「確認する」を押して結果を出してください。'); return; }
  const csv = toCsv(stage1Rows(last.bid, last.taicho, NOTICE));
  downloadText(doc, csv, '入札前の確認_' + today() + '.csv', 'text/csv;charset=utf-8');
  setExportStatus(doc, 'CSV を書き出しました(BOM つき UTF-8)。');
}

export function printResult(doc, win) {
  if (!last) setExportStatus(doc, stale ? STALE : '結果がまだありません。「確認する」を押してから印刷すると結果が紙に出ます。');
  openDetails(doc);
  win.print();
}

// 台帳の点検(F05b): 貼った台帳の文を読み、点検の候補を出す。
// 発注者(公共・民間)と工事の種類は上の選ぶ欄の値を使う。元請けの許可の種類は台帳の許可番号から読み、読めなければ上の欄の値を使う。
let lastCheck = null;
function setCheckStatus(doc, text) {
  const el = doc.getElementById('check-status');
  if (el) el.textContent = text;
}

export function runLedgerCheck(doc) {
  const outEl = doc.getElementById('check-result');
  const input = doc.getElementById('ledger-input');
  lastCheck = null;
  setCheckStatus(doc, '');
  const text = input ? String(input.value ?? '') : '';
  if (text.trim() === '') { outEl.innerHTML = renderErrors(['台帳の文が空です。台帳を貼るか、「見本を読み込む」を押してください。']); return; }
  try {
    const ledger = parseLedgerText(text);
    const warnings = ledger.warnings.slice();
    const values = collect(doc);
    const form = readBidForm(values);
    ledger.project.ordererType = form.orderer ?? undefined;
    ledger.project.workType = form.workType ?? undefined;
    if (!ledger.prime.licenseType) {
      if (form.license) {
        ledger.prime.licenseType = form.license;
        warnings.push('元請けの許可の種類は台帳から読めなかったので、上の欄「元請けの許可の種類」の値を使いました');
      } else {
        warnings.push('元請けの許可の種類が台帳からも上の欄からも分かりません。特定建設業の許可の候補は、この点を確かめてから見てください');
      }
    }
    if (!form.workType) warnings.push('上の欄の「工事の種類」が選ばれていないので、下請けの総額の境目(施行令 第2条)を決められないことがあります');
    const out = checkTaicho(ledger);
    outEl.innerHTML = renderCheckResult(out, warnings);
    lastCheck = out;
  } catch (e) {
    outEl.innerHTML = renderErrors(['点検の途中で止まりました(抜き書きの誤りの可能性があります): ' + String(e && e.message ? e.message : e)]);
  }
}

export function exportCheckCsv(doc) {
  if (!lastCheck) { setCheckStatus(doc, '先に「台帳を点検する」を押して結果を出してください。'); return; }
  downloadText(doc, toCsv(checkRows(lastCheck, NOTICE)), '台帳の点検_' + today() + '.csv', 'text/csv;charset=utf-8');
  setCheckStatus(doc, 'CSV を書き出しました(BOM つき UTF-8)。');
}

// 見本(F05f): 架空の工事の条件を入力欄に入れ、架空の書類(台帳・施工計画書の目次)を入れて、そのまま確認まで動かす。
// 書類の入力欄(台帳・目次)がある画面ならそこに入れ、見本の書類の欄にも中身を出す。
export function loadSample(doc) {
  for (const [id, v] of Object.entries(SAMPLE.form)) {
    const el = doc.getElementById(id);
    if (!el) continue;
    if (typeof v === 'boolean') el.checked = v;
    else el.value = String(v);
  }
  const put = (id, text) => { const el = doc.getElementById(id); if (el) { if ('value' in el && /^(TEXTAREA|INPUT)$/i.test(el.tagName || '')) el.value = text; else el.textContent = text; } };
  put('ledger-input', SAMPLE.documents.ledger);
  put('plan-input', SAMPLE.documents.planToc);
  put('sample-ledger', SAMPLE.documents.ledger);
  put('sample-plan', SAMPLE.documents.planToc);
  const docs = doc.getElementById('sample-docs');
  if (docs) docs.hidden = false;
  const st = doc.getElementById('sample-status');
  if (st) st.textContent = '見本「' + SAMPLE.title + '」を読み込みました。' + SAMPLE.note + ' 欄の値を変えて、もう一度「確認する」を押すこともできます。';
  runBid(doc);
  if (doc.getElementById('ledger-input') && doc.getElementById('check-result')) runLedgerCheck(doc);
}

export function startApp(doc, win = typeof window !== 'undefined' ? window : globalThis) {
  const start = () => {
    const on = (id, f) => {
      const btn = doc.getElementById(id);
      if (btn) btn.addEventListener('click', (ev) => { if (ev && ev.preventDefault) ev.preventDefault(); f(); });
    };
    on('bid-run', () => runBid(doc));
    on('sample-load', () => loadSample(doc));
    on('print-btn', () => printResult(doc, win));
    on('csv-btn', () => exportCsv(doc));
    on('ledger-run', () => runLedgerCheck(doc));
    on('check-csv-btn', () => exportCheckCsv(doc));
    // 台帳の文や条件を変えたら、前の点検の結果は書き出さない
    for (const id of ['ledger-input', ...BID_FORM_IDS]) {
      const el = doc.getElementById(id);
      if (!el) continue;
      const changed = () => { if (lastCheck) { lastCheck = null; setCheckStatus(doc, '台帳か条件が変わりました。もう一度「台帳を点検する」を押してから書き出してください。'); } };
      el.addEventListener('input', changed);
      el.addEventListener('change', changed);
    }
    startMask(doc);
    startAi(doc);
    // 条件を変えたら、前の結果は印刷・書き出しに使わない(入れた条件と結果が食い違わないように)
    for (const id of BID_FORM_IDS) {
      const el = doc.getElementById(id);
      if (!el) continue;
      const changed = () => { if (last) { last = null; stale = true; setExportStatus(doc, STALE); } };
      el.addEventListener('input', changed);
      el.addEventListener('change', changed);
    }
    // ブラウザのメニューから印刷したときも、折りたたみを開く
    if (win && win.addEventListener) win.addEventListener('beforeprint', () => openDetails(doc));
  };
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start);
  else start();
}

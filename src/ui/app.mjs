// 画面のつながり(F05a・F05e・F05b・F06a・F07): 入力欄を読み、入札前の確認と施工体制台帳の判定を動かし、結果の欄に書く。結果を印刷・CSV に書き出す。
// build.mjs がこのファイルと部品を index.html の1つのスクリプトにまとめ、最後に startApp(document) を呼ぶ。
// 入れた内容はどこにも保存しない(ページを閉じれば消える)。
import { readBidForm, formErrors, BID_FORM_IDS, CHECKBOX_IDS } from './form.mjs';
import { renderBidResult, renderTaichoResult, renderErrors, renderCheckResult, renderSchedule, renderPlanResult, renderXlsxResult, renderSummary } from './view.mjs';
import { parseLedgerText } from '../ledger-text.mjs';
import { readLedgerXlsx, ledgerToText, FIELD_NAMES } from '../ledger-xlsx.mjs';
import { checkTaicho } from '../check-taicho.mjs';
import { bidCheck } from '../bid-check.mjs';
import { judgeTaicho } from '../taicho.mjs';
import { stage1Rows, checkRows, scheduleRows, planRows, toCsv } from '../export.mjs';
import { buildScheduleDetail } from '../schedule.mjs';
import { checkPlanToc } from '../plan-check.mjs';
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

// まとめの枠(F14b): 最後に出した各結果を持ち、結果が出るたびに枠を書き直す(ページを閉じれば消える)
const summary = { values: null, errors: [], bid: null, taicho: null, scheduleCount: null, check: null, plan: null, stale: false };
let summaryShown = false;
function updateSummary(doc) {
  const el = doc.getElementById('summary');
  if (!el) return;
  el.innerHTML = renderSummary({ ...summary, values: summary.values ?? collect(doc) });
  el.hidden = false;
  summaryShown = true;
}

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
  Object.assign(summary, { values, errors, bid: null, taicho: null, scheduleCount: null, stale: false });
  if (errors.length) {
    last = null;
    bidOut.innerHTML = renderErrors(errors);
    taichoOut.innerHTML = renderErrors(errors);
    runSchedule(doc, null, errors);
    updateSummary(doc);
    return;
  }
  last = null;
  const input = readBidForm(values);
  runSchedule(doc, input);
  try {
    const bid = bidCheck(input);
    const taicho = judgeTaicho(input);
    bidOut.innerHTML = renderBidResult(bid);
    taichoOut.innerHTML = renderTaichoResult(taicho);
    last = { bid, taicho };
    summary.bid = bid;
    summary.taicho = taicho;
    stale = false;
    setExportStatus(doc, '');
  } catch (e) {
    const msg = renderErrors(['判定の途中で止まりました(規則表か抜き書きの誤りの可能性があります): ' + String(e && e.message ? e.message : e)]);
    bidOut.innerHTML = msg;
    taichoOut.innerHTML = msg;
  }
  updateSummary(doc);
}

// 段取りの一覧(F06a): 同じ条件から、着手までの段取りを出す(入札前の確認とは別に動かし、片方が止まっても片方は出す)
let lastSchedule = null;
function setScheduleStatus(doc, text) {
  const el = doc.getElementById('schedule-status');
  if (el) el.textContent = text;
}
function runSchedule(doc, input, errors = []) {
  const out = doc.getElementById('schedule-result');
  lastSchedule = null;
  setScheduleStatus(doc, '');
  if (!out) return;
  if (!input) { out.innerHTML = renderErrors(errors); return; }
  try {
    const detail = buildScheduleDetail(input);
    out.innerHTML = renderSchedule(detail.rows, detail);
    lastSchedule = detail.rows;
    summary.scheduleCount = detail.rows.length;
  } catch (e) {
    out.innerHTML = renderErrors(['段取りを出す途中で止まりました(段取りの規則表の誤りの可能性があります): ' + String(e && e.message ? e.message : e)]);
  }
}

export function exportScheduleCsv(doc) {
  if (!lastSchedule) { setScheduleStatus(doc, '先に「確認する」を押して段取りを出してください。'); return; }
  downloadText(doc, toCsv(scheduleRows(lastSchedule)), '段取り_' + today() + '.csv', 'text/csv;charset=utf-8');
  setScheduleStatus(doc, 'CSV を書き出しました(BOM つき UTF-8)。');
}

function setExportStatus(doc, text) {
  const el = doc.getElementById('export-status');
  if (el) el.textContent = text;
}

// 印刷のとき、根拠の条などの折りたたみ(details)を開いておく(閉じたままだと中身が紙に出ない)。
// 印刷のために開いたものだけを覚えておき、印刷が終わったら(afterprint)閉じ直す
let openedForPrint = [];
export function openDetailsForPrint(doc) {
  for (const d of doc.querySelectorAll('details')) {
    if (!d.open) { d.open = true; if (!openedForPrint.includes(d)) openedForPrint.push(d); }
  }
}
export function restoreDetailsAfterPrint() {
  for (const d of openedForPrint) d.open = false;
  openedForPrint = [];
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
  openDetailsForPrint(doc);
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
  summary.check = null;
  setCheckStatus(doc, '');
  const text = input ? String(input.value ?? '') : '';
  if (text.trim() === '') { outEl.innerHTML = renderErrors(['台帳の文が空です。台帳を貼るか、「見本で試す」を押してください。']); return; }
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
    summary.check = out;
  } catch (e) {
    outEl.innerHTML = renderErrors(['点検の途中で止まりました(抜き書きの誤りの可能性があります): ' + String(e && e.message ? e.message : e)]);
  }
  updateSummary(doc);
}

export function exportCheckCsv(doc) {
  if (!lastCheck) { setCheckStatus(doc, '先に「台帳を点検する」を押して結果を出してください。'); return; }
  downloadText(doc, toCsv(checkRows(lastCheck, NOTICE)), '台帳の点検_' + today() + '.csv', 'text/csv;charset=utf-8');
  setCheckStatus(doc, 'CSV を書き出しました(BOM つき UTF-8)。');
}

// 台帳の Excel の読み込み(F04c): 作成例の様式の .xlsx を読み、読めた欄を台帳の文にして「施工体制台帳の文」の欄に入れる。
// 読めない欄は ledger-unreadable に欄ごとに出す。点検は利用者が中身を確かめて「台帳を点検する」を押してから
export async function loadLedgerFile(doc, file) {
  const outEl = doc.getElementById('ledger-unreadable');
  const status = doc.getElementById('ledger-file-status');
  if (!file) return false;
  try {
    if (!/\.xlsx$/i.test(String(file.name ?? ''))) throw new Error('読めるのは .xlsx だけです(.xls は Excel で .xlsx に保存し直してください)');
    const r = await readLedgerXlsx(new Uint8Array(await file.arrayBuffer()));
    const input = doc.getElementById('ledger-input');
    if (input) input.value = ledgerToText(r.ledger);
    lastCheck = null;
    if (outEl) outEl.innerHTML = renderXlsxResult(r, FIELD_NAMES);
    if (status) status.textContent = '「' + file.name + '」を読みました(読めない欄 ' + r.unreadable.length + ' 件)。台帳の文の欄を確かめ、足りない行を書き足してから「台帳を点検する」を押してください。';
    return true;
  } catch (e) {
    if (outEl) outEl.innerHTML = '';
    if (status) status.textContent = '「' + file.name + '」を読めませんでした: ' + (e && e.message ? e.message : String(e));
    return false;
  }
}

// 施工計画書の目次の点検(F07): 貼った目次を共通仕様書 1-1-1-6 の記載項目と比べ、見当たらない項目を候補に出す
let lastPlan = null;
function setPlanStatus(doc, text) {
  const el = doc.getElementById('plan-status');
  if (el) el.textContent = text;
}

export function runPlanCheck(doc) {
  const outEl = doc.getElementById('plan-result');
  const input = doc.getElementById('plan-input');
  lastPlan = null;
  summary.plan = null;
  setPlanStatus(doc, '');
  const text = input ? String(input.value ?? '') : '';
  if (text.trim() === '') { outEl.innerHTML = renderErrors(['目次が空です。施工計画書の目次を貼るか、「見本で試す」を押してください。']); return; }
  try {
    const form = readBidForm(collect(doc));
    const out = checkPlanToc(text, { workType: form.workType ?? undefined });
    if (!form.workType) out.notes.push('上の欄の「工事の種類」が選ばれていないので、土木の工事として比べました。建築一式工事なら「建築一式工事」を選んでください');
    outEl.innerHTML = renderPlanResult(out);
    lastPlan = out;
    summary.plan = out;
  } catch (e) {
    outEl.innerHTML = renderErrors(['点検の途中で止まりました: ' + String(e && e.message ? e.message : e)]);
  }
  updateSummary(doc);
}

export function exportPlanCsv(doc) {
  if (!lastPlan) { setPlanStatus(doc, '先に「目次を点検する」を押して結果を出してください。'); return; }
  downloadText(doc, toCsv(planRows(lastPlan)), '施工計画書の目次の点検_' + today() + '.csv', 'text/csv;charset=utf-8');
  setPlanStatus(doc, 'CSV を書き出しました(BOM つき UTF-8)。');
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
  if (doc.getElementById('plan-input') && doc.getElementById('plan-result')) runPlanCheck(doc);
  // 見本のあとは、結論の枠(まとめ)を画面に出す
  const sum = doc.getElementById('summary');
  if (sum && typeof sum.scrollIntoView === 'function') sum.scrollIntoView({ block: 'start' });
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
    on('schedule-csv-btn', () => exportScheduleCsv(doc));
    on('plan-run', () => runPlanCheck(doc));
    on('plan-csv-btn', () => exportPlanCsv(doc));
    // 目次を変えたら、前の点検の結果は書き出さない
    const planEl = doc.getElementById('plan-input');
    if (planEl) {
      const changed = () => { if (lastPlan) { lastPlan = null; setPlanStatus(doc, '目次が変わりました。もう一度「目次を点検する」を押してから書き出してください。'); } };
      planEl.addEventListener('input', changed);
      planEl.addEventListener('change', changed);
    }
    // 台帳の文や条件を変えたら、前の点検の結果は書き出さない
    for (const id of ['ledger-input', ...BID_FORM_IDS]) {
      const el = doc.getElementById(id);
      if (!el) continue;
      const changed = () => { if (lastCheck) { lastCheck = null; setCheckStatus(doc, '台帳か条件が変わりました。もう一度「台帳を点検する」を押してから書き出してください。'); } };
      el.addEventListener('input', changed);
      el.addEventListener('change', changed);
    }
    const ledgerFile = doc.getElementById('ledger-file');
    if (ledgerFile) {
      ledgerFile.addEventListener('change', async () => {
        const f = ledgerFile.files && ledgerFile.files[0];
        if (!f) return;
        await loadLedgerFile(doc, f);
        ledgerFile.value = '';
      });
    }
    startMask(doc);
    startAi(doc);
    // 条件を変えたら、前の結果は印刷・書き出しに使わない(入れた条件と結果が食い違わないように)
    for (const id of BID_FORM_IDS) {
      const el = doc.getElementById(id);
      if (!el) continue;
      const changed = () => {
        if (last) { last = null; stale = true; setExportStatus(doc, STALE); }
        if (summaryShown && !summary.stale) { summary.stale = true; updateSummary(doc); }
        if (lastSchedule) { lastSchedule = null; setScheduleStatus(doc, '条件が変わりました。もう一度「確認する」を押してから、段取りを書き出してください。'); }
      };
      el.addEventListener('input', changed);
      el.addEventListener('change', changed);
    }
    // ブラウザのメニューから印刷したときも、折りたたみを開く
    if (win && win.addEventListener) {
      win.addEventListener('beforeprint', () => openDetailsForPrint(doc));
      win.addEventListener('afterprint', () => restoreDetailsAfterPrint());
    }
  };
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start);
  else start();
}

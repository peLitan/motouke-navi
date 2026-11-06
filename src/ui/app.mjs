// 画面のつながり(F05a・F05e・F05b・F06a・F07): 入力欄を読み、入札前の確認と施工体制台帳の判定を動かし、結果の欄に書く。結果を印刷・CSV に書き出す。
// build.mjs がこのファイルと部品を index.html の1つのスクリプトにまとめ、最後に startApp(document) を呼ぶ。
// 入れた内容はどこにも保存しない(ページを閉じれば消える)。
import { readBidForm, readDirect, readWorkKind, formErrors, amountValidity, BID_FORM_IDS, CHECKBOX_IDS } from './form.mjs';
import { esc, renderBidResult, renderTaichoResult, renderErrors, renderCheckResult, renderSchedule, renderPlanResult, renderXlsxResult, renderSummary, renderResultTop, renderOpenItems, renderChecklist } from './view.mjs';
import { checkChecklistText } from '../checklist.mjs';
import { DICT_FORMAT, MAP_FORMAT } from '../mask/core.mjs';
import { parseLedgerText } from '../ledger-text.mjs';
import { readLedgerXlsx, ledgerToText, FIELD_NAMES } from '../ledger-xlsx.mjs';
import { checkTaicho } from '../check-taicho.mjs';
import { addCrossCandidates } from '../cross-docs.mjs';
import { addChecklistCandidates } from '../ledger-check.mjs';
import { bidCheck } from '../bid-check.mjs';
import { judgeTaicho } from '../taicho.mjs';
import { stage1Rows, workKindRows, checkRows, scheduleRows, planRows, checklistRows, safetyRows, toCsv } from '../export.mjs';
import { safetyCandidates, safetyInput } from '../safety.mjs';
import { SAFETY_IDS, readSafetyAnswers, renderSafetyResult, safetyAnswerRows, safetyBreakdown, safetyCountText, safetyTitle, stage1Line } from './safety-view.mjs';
import { sourceVersion } from '../source-version.mjs';
import sourcesData from '../../data/sources/index.json' with { type: 'json' };
import { buildScheduleDetail } from '../schedule.mjs';
import { kindSourceText, kindTable } from '../work-kind-tables.mjs';
import { DEFAULT_WORK_KIND, NOT_READ, ALWAYS_SHOWN, hasKindTable } from '../work-kinds.mjs';
import { checkPlanToc } from '../plan-check.mjs';
import { parseRulesFile, tableNotice, exampleNotice, RULES_MAX_BYTES } from '../rules-load.mjs';
import { parseIntakeFile, intakeLines, INTAKE_MAX_BYTES } from '../intake-load.mjs';
import wakayamaRows from '../../data/specs/wakayama_r0711_rows.json' with { type: 'json' };
import { SAMPLE } from '../sample.mjs';
import { CONFIRM_ROWS, confirmRows, markSources, renderConfirmRow } from './confirm.mjs';
import { startMask, loadMaskFile, readDictFile, readMapFile } from './mask-app.mjs';
import { readAiFile, RESULT_FORMAT } from './ai-app.mjs';
import { downloadText } from './download.mjs';

// 書き出しの最後に入れる文(画面の上の注意と同じ)
const NOTICE = '指摘の候補です。抜けが無いことの保証や合否ではありません。最終の確認は担当者と発注者との協議で行ってください';

// 最後に「確認する」で出した結果。印刷と CSV はこれを使う(ページを閉じれば消える)
let last = null;
const STALE = '条件が変わりました。もう一度「確認する」を押してから、印刷・書き出しをしてください。';
let stale = false; // 結果を出したあとに条件を変えたか

// まとめの枠(F14b): 最後に出した各結果を持ち、結果が出るたびに枠を書き直す(ページを閉じれば消える)
const summary = { values: null, errors: [], bid: null, taicho: null, scheduleCount: null, scheduleNotRead: false, check: null, plan: null, stale: false };
let summaryShown = false;
const SUMMARY_FOLDS = ['summary-docs', 'summary-conditions']; // 描き直しても開いたままにするカード
function updateSummary(doc) {
  const el = doc.getElementById('summary');
  if (!el) return;
  const state = { ...summary, values: summary.values ?? collect(doc) };
  const top = doc.getElementById('result-top');
  if (top) { const h = renderResultTop(state); top.innerHTML = h; top.hidden = !h; }
  const opened = SUMMARY_FOLDS.filter((id) => doc.getElementById(id)?.open === true);
  el.innerHTML = renderSummary(state);
  for (const id of opened) { const d = doc.getElementById(id); if (d) d.open = true; }
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

// 労働安全衛生法の候補(F40b): 問いの欄を変えたらすぐ描き直す。段1 の「確認する」とは別に動き、段1 の値はそのときの欄から読む
const SAFETY_ALL_IDS = Object.values(SAFETY_IDS).flat();
function safetyChecked(doc) {
  return Object.fromEntries(SAFETY_ALL_IDS.map((id) => [id, doc.getElementById(id)?.checked === true]));
}
function stage1Safe(values) {
  return formErrors(values).length ? { direct: readDirect(values), subcontractTotal: null } : readBidForm(values);
}
function safetySnapshot(doc) {
  const values = collect(doc);
  const stage1 = stage1Safe(values);
  const answers = readSafetyAnswers(safetyChecked(doc));
  const result = safetyCandidates(safetyInput(answers, stage1));
  return { values, stage1, answers, result, answerRows: safetyAnswerRows(answers, values, stage1) };
}
function setSafetyStatus(doc, text) {
  const el = doc.getElementById('safety-status');
  if (el) el.textContent = text;
}
function setSafetyVersion(doc) {
  const el = doc.getElementById('safety-version');
  const s = sourcesData.sources.find((x) => x.id === 'anei-15');
  if (el && s) el.textContent = '見た条文: ' + sourceVersion(s) + '。取得日 ' + s.fetchedAt + '。取得のあとの改正は入っていません。';
}
// 問い1 の印: 自分で選んでいなければ段1 の答えに合わせる。段1 が空か「分からない」なら「まだ分からない」
let safetySubcontractTouched = false;
function syncSafetySubcontract(doc, stage1) {
  if (safetySubcontractTouched) return;
  const t = stage1.subcontractTotal;
  const v = typeof t === 'number' ? (t > 0 ? 'yes' : 'no') : 'unknown';
  for (const id of SAFETY_IDS.subcontract) {
    const el = doc.getElementById(id);
    if (el) el.checked = id === 'safety-sub-' + v;
  }
}
export function renderSafety(doc) {
  const stage1 = stage1Safe(collect(doc));
  const untouched = !safetySubcontractTouched;
  syncSafetySubcontract(doc, stage1);
  const snap = safetySnapshot(doc);
  // 段1 から当てた印は「問い1 の答え」に数えない(何も入れていないページで「始めた」にしない)
  const r = untouched ? safetyCandidates(safetyInput({ ...snap.answers, subcontract: undefined }, stage1)) : snap.result;
  const out = doc.getElementById('safety-result');
  if (out) out.innerHTML = renderSafetyResult(r, snap.answerRows);
  const title = doc.getElementById('safety-title');
  if (title) title.textContent = safetyTitle(r);
  const stage1El = doc.getElementById('safety-stage1');
  if (stage1El) stage1El.innerHTML = esc(stage1Line(snap.values, stage1)) + ' <a href="#subcontract-total">段1 で直す</a>';
  const qSub = doc.getElementById('safety-q-subcontract');
  if (qSub) qSub.hidden = r.mode === 'sub';
  // 問い2 は下請けを使う・まだ分からないとき、下請けの道で出す
  const qWorkers = doc.getElementById('safety-q-workers');
  if (qWorkers) qWorkers.hidden = r.mode === 'prime' && r.subcontract === 'no';
  const qPlace = doc.getElementById('safety-q-place');
  if (qPlace) qPlace.hidden = !snap.answers.bridge || snap.answers.bridge === 'none';
  const primeNote = doc.getElementById('safety-prime-note');
  if (primeNote) primeNote.hidden = !(r.mode === 'prime' && r.assumedPrime);
  summary.safety = { count: r.started ? r.counts.total : null, text: r.started ? esc(safetyCountText(r)) + (r.counts.total ? '(' + esc(safetyBreakdown(r)) + ')' : '') : '(条件を入れると出ます)', answerRows: r.started ? snap.answerRows : [] };
  if (summaryShown) updateSummary(doc);
  return r;
}
// 「分からない」「どれにも当たらない」は他の印と同時に選べない。外したことは知らせの行で伝える
function exclusiveSafety(doc, id) {
  const clear = (ids) => ids.filter((x) => doc.getElementById(x)?.checked === true && x !== id).map((x) => { doc.getElementById(x).checked = false; return x; }).length;
  const group = SAFETY_IDS.plan.includes(id) ? SAFETY_IDS.plan : SAFETY_IDS.works.includes(id) ? SAFETY_IDS.works : null;
  if (!group || doc.getElementById(id)?.checked !== true) return 0;
  const solo = [/-none$/, /-unknown$/];
  if (solo.some((re) => re.test(id))) return clear(group) + (group === SAFETY_IDS.plan ? clear(SAFETY_IDS.bridge) : 0);
  return clear(group.filter((x) => solo.some((re) => re.test(x))));
}
export function changeSafety(doc, id) {
  if (SAFETY_IDS.subcontract.includes(id)) safetySubcontractTouched = true;
  if (SAFETY_IDS.bridge.includes(id) && id !== 'safety-bridge-none') {
    for (const x of ['safety-plan-none', 'safety-plan-unknown']) { const el = doc.getElementById(x); if (el) el.checked = false; }
  }
  const cleared = exclusiveSafety(doc, id);
  const r = renderSafety(doc);
  setSafetyStatus(doc, (cleared ? '両立しない印を ' + cleared + 'つ外しました。' : '') + '候補を描き直しました(' + (r.started ? safetyCountText(r) : '条件を入れると出ます') + ')。');
}
function clearSafety(doc) {
  safetySubcontractTouched = false;
  for (const id of SAFETY_ALL_IDS) { const el = doc.getElementById(id); if (el) el.checked = false; }
  setSafetyStatus(doc, '');
}

// 段の切り替え(F37a): #panel-1〜3 の hidden を付け外しして1つずつ見せる。段階の表示は今いる段だけ印を付け、入口を選んだあとは押せる。
// 要素はすべて静的な HTML にあり、ここでは作らない。結果は隠れた段にも書く
// 入力の確かめ(F43d)は結果の前の画面で、段階の表示では「1 条件を入れる」の中に数える(案D のとおり)
const PANELS = [1, 2, 3];
export function showPanel(doc, n) {
  const confirm = doc.getElementById('panel-confirm');
  if (confirm) confirm.hidden = n !== 'confirm';
  const current = n === 'confirm' ? 1 : n;
  for (const i of PANELS) {
    const panel = doc.getElementById('panel-' + i);
    if (panel) panel.hidden = i !== n;
    const step = doc.getElementById('step-' + i);
    if (!step) continue;
    step.disabled = false;
    if (i === current) step.setAttribute('aria-current', 'step'); else step.removeAttribute('aria-current');
  }
  const entry = doc.getElementById('entry');
  if (entry) entry.hidden = true;
  const back = doc.getElementById('entry-back');
  if (back) back.hidden = false;
}
// 入口に戻す: タイルを見せ、段を隠し、段階の表示を押せない形にする。入れた値と結果は消さない
export function showEntry(doc) {
  const confirm = doc.getElementById('panel-confirm');
  if (confirm) confirm.hidden = true;
  for (const i of PANELS) {
    const panel = doc.getElementById('panel-' + i);
    if (panel) panel.hidden = true;
    const step = doc.getElementById('step-' + i);
    if (!step) continue;
    step.disabled = true;
    step.removeAttribute('aria-current');
  }
  const entry = doc.getElementById('entry');
  if (entry) entry.hidden = false;
  const back = doc.getElementById('entry-back');
  if (back) back.hidden = true;
  setBidStatus(doc, '');
  doc.getElementById('sample-load')?.focus?.();
}
// 段を開き、今の段の印へ焦点を移す(押したボタンが隠れて焦点が消えないように)。画面は scrollId の要素まで動かす
function openPanel(doc, n, scrollId = 'steps') {
  showPanel(doc, n);
  doc.getElementById('step-' + n)?.focus?.({ preventScroll: true });
  doc.getElementById(scrollId)?.scrollIntoView?.({ block: 'start' });
}
// 入力の確かめ(F43d): 読み込んだ値の出どころ(行の鍵 → 出どころ)。メモリだけに持つ。値を変えた行は手入力に戻る
let fieldSources = {};
export function openConfirm(doc) {
  for (const r of confirmRows(collect(doc), fieldSources)) {
    const el = doc.getElementById('confirm-value-' + r.key);
    if (el) el.innerHTML = renderConfirmRow(r);
  }
  showPanel(doc, 'confirm');
  doc.getElementById('steps')?.scrollIntoView?.({ block: 'start' });
  doc.getElementById('confirm-title')?.focus?.({ preventScroll: true });
}
// 「変更」: 段1 の入れ直す欄へ戻す。金額の欄が「分からない」のときは、その印へ戻す
function changeTarget(doc, row) {
  if (row.key === 'role') return ['direct', 'direct-sub', 'direct-unknown'].find((id) => doc.getElementById(id)?.checked === true) ?? 'direct-unset';
  return doc.getElementById(row.field + '-unknown')?.checked === true ? row.field + '-unknown' : row.field;
}
export function changeField(doc, key) {
  showPanel(doc, 1);
  const el = doc.getElementById(changeTarget(doc, CONFIRM_ROWS.find((r) => r.key === key)));
  (el?.closest?.('.row') ?? el)?.scrollIntoView?.({ block: 'center' });
  el?.focus?.({ preventScroll: true });
}
// 「この内容で結果を見る」: 確かめた値で出し直して、段2 を開く
function confirmGo(doc) {
  runBid(doc);
  openPanel(doc, 2);
  setBidStatus(doc, bidNotice(doc.getElementById('sample-banner')?.hidden === false ? SAMPLE_NOTICE_DONE : BID_NOTICE_DONE));
}
// 入口の「公告から拾った条件を読み込む」(F43b): 段1 の読み込みの折りたたみを開き、ファイルの欄へ焦点を移す
function openIntake(doc) {
  const more = doc.getElementById('intake-more');
  if (more) more.open = true;
  openPanel(doc, 1, 'intake-more');
  doc.getElementById('intake-load')?.focus?.({ preventScroll: true });
}
// 隠れた段の中へのリンク(まとめの #check-result など): 行き先の段を開く。動くのはリンクの既定の動きに任せる
export function openPanelForLink(doc, href) {
  const id = String(href ?? '').replace(/^#/, '');
  const target = doc.getElementById(id);
  const panel = target?.closest?.('[id^="panel-"]');
  if (panel && panel.hidden) showPanel(doc, Number(panel.id.slice('panel-'.length)));
  // 飛ぶ先が閉じた折りたたみの中なら開く(F43c)。外の折りたたみまで順に開く
  for (let d = target?.closest?.('details'); d; d = d.parentElement?.closest?.('details')) d.open = true;
  // 段取りの行から飛ぶと、閉じて出る表も開く(F54a)
  if (id === 'schedule-result') {
    const table = target?.querySelector?.('details.schedule-table');
    if (table) table.open = true;
  }
}

// 押したあとの知らせの1行(F38d)。✓ は結果が出たときだけ付ける
const NEXT_STEP = '下の「次にすること」から読んでください。終わったら「次へ: 3 書類を確かめる」を押します。';
const BID_NOTICE_DONE = '✓ 結果が出ました。' + NEXT_STEP;
const SAMPLE_NOTICE_DONE = '✓ 見本を読み込みました。' + NEXT_STEP;
const AWARDED_NOTICE_ALL = '✓ 段取りの全部の行を出しました。工事の条件が分かるなら、下の「条件を入れる」を押します。';
const AWARDED_NOTICE_DONE = '✓ 入れた条件の段取りを出しています。下の「受注後の段取り」から読んでください。';
const NOTICE_STALE = '＊ 条件が変わりました。もう一度「確認する」を押すと、新しい条件の結果が出ます。';
function setBidStatus(doc, text) {
  const el = doc.getElementById('bid-status');
  if (el) el.textContent = text;
}
// 今の結果で done と言えるかを見て、言えなければ何が起きたかと次の一手を返す
function bidNotice(done) {
  if (summary.errors.length) return '＊ 金額の欄を読めませんでした。「1 条件を入れる」に戻って直し、もう一度「確認する」を押してください。';
  if (summary.stale) return NOTICE_STALE;
  if (!last || !lastSchedule) return '＊ 判定の途中で止まりました。結果の欄の知らせを読んでください。';
  return done;
}
// 金額の欄の読めない値に印を付け、直ったら外す
function markAmountFields(doc, values) {
  for (const [id, bad] of amountValidity(values)) {
    const el = doc.getElementById(id);
    if (!el) continue;
    if (bad) el.setAttribute('aria-invalid', 'true');
    else el.removeAttribute('aria-invalid');
  }
}

export function runBid(doc) {
  setAwardedView(doc, false);
  const bidOut = doc.getElementById('bid-result');
  const taichoOut = doc.getElementById('taicho-result');
  const values = collect(doc);
  const errors = formErrors(values);
  markAmountFields(doc, values);
  Object.assign(summary, { values, errors, bid: null, taicho: null, scheduleCount: null, scheduleNotRead: false, stale: false });
  renderSafety(doc);
  const openEl = doc.getElementById('open-items');
  if (errors.length) {
    last = null;
    if (openEl) openEl.innerHTML = renderErrors(errors);
    bidOut.innerHTML = renderErrors(errors);
    taichoOut.innerHTML = renderErrors(errors);
    runSchedule(doc, null, errors);
    updateSummary(doc);
    return;
  }
  last = null;
  const input = readBidForm(values);
  runSchedule(doc, { ...input, workKind: readWorkKind(values) });
  try {
    const bid = bidCheck(input);
    const taicho = judgeTaicho(input);
    bidOut.innerHTML = renderBidResult(bid, values);
    // 結果の最後に「確認が要る点」と「未回答」の一覧(F14f)
    if (openEl) openEl.innerHTML = renderOpenItems(bid, values);
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
let lastScheduleInput = null;
// 読み込んだ表(F26b)。メモリだけに持ち、ページを閉じれば消える
let rulesTable = null;
// 「発注者の仕様書では」の書き込み(F37e)。行の鍵 → 書いた文。メモリだけに持ち、描き直し・表の切り替え・見本の入れ直しでは消さない
const scheduleNotes = new Map();
// 今の結果を出した工種(F44a)。欄を変えただけでは変えない(注記と結果が食い違わないように、結果を出すときに変える)
const shownKind = { schedule: DEFAULT_WORK_KIND, planItems: DEFAULT_WORK_KIND };
// 和歌山県の例は土木の表なので、土木のときだけ使う。読み込んだ表は利用者が選んだ発注者の表なので工種を問わず使う
const tableFor = (kind) => (kind === DEFAULT_WORK_KIND || !rulesTable?.label ? rulesTable : null);
export function setScheduleNote(key, text) {
  if (text) scheduleNotes.set(key, text);
  else scheduleNotes.delete(key);
}
function setScheduleStatus(doc, text) {
  const el = doc.getElementById('schedule-status');
  if (el) el.textContent = text;
}
function runSchedule(doc, input, errors = []) {
  const out = doc.getElementById('schedule-result');
  lastSchedule = null;
  lastScheduleInput = null;
  setScheduleStatus(doc, '');
  if (!out) return;
  if (!input) { out.innerHTML = renderErrors(errors); return; }
  try {
    shownKind.schedule = input.workKind ?? DEFAULT_WORK_KIND;
    applyRulesSides(doc);
    const detail = buildScheduleDetail(input, tableFor(shownKind.schedule), { all: awardedAll });
    out.innerHTML = renderSchedule(detail.rows, detail, scheduleNotes);
    lastSchedule = detail.rows;
    lastScheduleInput = input;
    // 全部の行(F37c)は条件から出した件数ではないので、まとめには載せない
    summary.scheduleCount = awardedAll || detail.notRead ? null : detail.rows.length;
    summary.scheduleNotRead = Boolean(detail.notRead);
  } catch (e) {
    out.innerHTML = renderErrors(['段取りを出す途中で止まりました(段取りの規則表の誤りの可能性があります): ' + String(e && e.message ? e.message : e)]);
  }
}

// 「もう受注した」(F37c): 条件をまだ入れていない人には、全部の行を「確かめる」で出す。
// 読み込んだ表と和歌山県の例は条件で行が分かれないので、国の例と同じ文にしない
let awardedAll = false;
export function awardedNotice(table, notRead = false, exampleLabel = '国の直轄の例') {
  if (notRead) return NOT_READ + 'ので、段取りの行はありません。' + ALWAYS_SHOWN + '。工事の条件を入れて『確認する』を押すと出ます。';
  const custom = Boolean(table?.schedule?.length);
  const name = custom ? table.label ?? '読み込んだ表' : exampleLabel;
  return '条件を入れていないので、' + name + 'の全部の行を出しています。'
    + (custom ? 'この表は条件を入れても行は分かれません。入札前の確認と台帳が要るかは、工事の条件を入れて『確認する』を押すと出ます。' : '工事の条件を入れて『確認する』を押すと、要る・要らないが分かれます。');
}
function setAwardedText(doc) {
  const text = doc.getElementById('awarded-notice-text');
  const table = tableFor(shownKind.schedule);
  if (text) text.textContent = awardedNotice(table, !table?.schedule?.length && !hasKindTable(shownKind.schedule, 'schedule'), kindTable(shownKind.schedule, 'schedule')?.exampleLabel);
}
function setAwardedView(doc, on) {
  awardedAll = on;
  setAwardedText(doc);
  const box = doc.getElementById('awarded-notice');
  if (box) box.hidden = !on;
  const fold = doc.getElementById('bid-fold');
  if (fold) fold.open = !on;
  const hint = doc.getElementById('bid-fold-hint');
  if (hint) hint.hidden = !on;
}
// 条件から出した結果(入力の誤りの知らせを含む)があれば、全部の行で上書きせず、そのまま見せる
export function enterAwarded(doc) {
  if (!awardedAll && !lastScheduleInput && !summary.errors.length) setAwardedView(doc, true);
  if (awardedAll) runSchedule(doc, { workKind: readWorkKind(collect(doc)) });
  // 全部の行のときは知らせの行のすぐ下に段取りがあるので、知らせの行まで動かす(段取りの見出しまで動かすと知らせが画面の上へ隠れる)
  openPanel(doc, 2, awardedAll ? 'bid-status' : 'schedule-heading');
  setBidStatus(doc, awardedAll ? (summary.scheduleNotRead ? '✓ ' + NOT_READ + 'ので、段取りの行はありません。' : AWARDED_NOTICE_ALL) : bidNotice(AWARDED_NOTICE_DONE));
}

const NATIONAL_NOTICE = {
  'schedule-notice': '国の直轄の例。自治体・民間は発注者の仕様書・契約書で置き換えてください',
  'plan-notice': '国の直轄の例。自治体・民間は発注者の仕様書の記載事項で置き換えてください',
};
const RULES_SIDES = [
  ['schedule-notice', 'schedule-about', 'schedule', 'work-kind-schedule', 'schedule'],
  ['plan-notice', 'plan-about', 'planItems', 'work-kind-plan', 'plan'],
];
// 今の工種と表に合わせて、注記・説明・出典の行・切り替えのボタンを直す(結果は描き直さない)
function applyRulesSides(doc) {
  for (const [noticeId, aboutId, key, kindLineId, part] of RULES_SIDES) {
    const kind = shownKind[key];
    const table = tableFor(kind);
    const custom = Boolean(table?.[key].length);
    const notRead = !custom && !hasKindTable(kind, part);
    const notice = doc.getElementById(noticeId);
    if (notice) notice.textContent = notRead ? NOT_READ + '。発注者の仕様書で確かめてください' : !custom ? kindTable(kind, part)?.notice ?? NATIONAL_NOTICE[noticeId] : table.label ? exampleNotice(table) : tableNotice(table);
    const about = doc.getElementById(aboutId);
    // 説明の文は土木の表の話なので、土木の表を出しているときだけ見せる
    const civilText = !custom && !notRead && !kindTable(kind, part)?.notice;
    if (about) about.hidden = !civilText;
    // 説明の折りたたみ(F37b)は中身が隠れると空になるので、見出しごと隠す
    const fold = about?.closest?.('details');
    if (fold) fold.hidden = !civilText;
    const kindLine = doc.getElementById(kindLineId);
    if (kindLine) kindLine.textContent = kindSourceText(kind, part);
  }
  // 2つの例は土木の表なので、ほかの工種では押せるようにしない
  for (const id of ['rules-national', 'rules-wakayama']) {
    const el = doc.getElementById(id);
    if (el) el.hidden = shownKind.schedule !== DEFAULT_WORK_KIND;
  }
  setAwardedText(doc);
}
// 表が変わったら、前の表で出した結果を残さない(注記と結果が食い違わないように)
function applyRulesTable(doc) {
  applyRulesSides(doc);
  // 読み込んだ表のときは、2つの例のどちらも押されていない形にして、その旨を出す
  doc.getElementById('rules-national')?.setAttribute?.('aria-pressed', String(!rulesTable));
  doc.getElementById('rules-wakayama')?.setAttribute?.('aria-pressed', String(Boolean(rulesTable?.label)));
  const fromFile = Boolean(rulesTable) && !rulesTable.label;
  for (const id of ['rules-clear', 'rules-file-on']) {
    const el = doc.getElementById(id);
    if (el) el.hidden = !fromFile;
  }
  if (lastSchedule && lastScheduleInput) {
    runSchedule(doc, lastScheduleInput);
    if (summaryShown) updateSummary(doc);
  } else {
    const out = doc.getElementById('schedule-result');
    if (out) out.innerHTML = '<p>条件を入れて「確認する」を押してください。</p>';
  }
  if (doc.getElementById('plan-input')?.value.trim()) runPlanCheck(doc);
  else {
    const out = doc.getElementById('plan-result');
    if (out) out.innerHTML = '<p>目次を貼って「目次を点検する」を押してください。</p>';
  }
}
function setRulesStatus(doc, text) {
  const el = doc.getElementById('rules-status');
  if (el) el.textContent = text;
}
// 壊れたファイルは理由を出して拒み、今の表はそのままにする
export function loadRulesFile(doc, text, name) {
  let table;
  try {
    table = parseRulesFile(text);
  } catch (e) {
    setRulesStatus(doc, '読み込めませんでした: ' + e.message + '。今の表はそのままです。');
    return false;
  }
  rulesTable = table;
  applyRulesTable(doc);
  const missing = [table.schedule.length ? '' : '段取り', table.planItems.length ? '' : '施工計画書の記載項目'].filter(Boolean);
  setRulesStatus(doc, (typeof name === 'string' ? name + ' を読みました' : '読み込みました') + '(段取り ' + table.schedule.length + '行・記載項目 ' + table.planItems.length + '行)。'
    + (missing.length ? missing.join('と') + 'の行が無いので、そちらは国の直轄の例のままです。' : '')
    + 'ブラウザには保存しません。ページを閉じると消えます。');
  return true;
}
// 和歌山県の例(F37d)。index.html に組み込んだ行を、ファイルと同じ確かめと同じ道で使う
export function useWakayamaExample(doc) {
  const dropped = Boolean(rulesTable) && !rulesTable.label;
  const table = parseRulesFile(JSON.stringify(wakayamaRows));
  rulesTable = { ...table, label: '和歌山県の例', scope: '7つの節だけ(1-1-1-6〜12)' };
  applyRulesTable(doc);
  setRulesStatus(doc, '和歌山県の例にしました(段取り ' + table.schedule.length + '行・記載項目 ' + table.planItems.length + '行)。'
    + (dropped ? '読み込んだ表は手放しました。もう一度使うときはファイルを選び直してください。' : ''));
}
export function clearRulesTable(doc) {
  rulesTable = null;
  applyRulesTable(doc);
  setRulesStatus(doc, '国の直轄の例に戻しました。');
}

export function exportScheduleCsv(doc) {
  if (!lastSchedule) { setScheduleStatus(doc, '先に「確認する」を押して段取りを出してください。'); return; }
  downloadText(doc, toCsv(scheduleRows(lastSchedule, scheduleNotes, shownKind.schedule, NOTICE)), '段取り_' + today() + '.csv', 'text/csv;charset=utf-8');
  setScheduleStatus(doc, 'CSV をこの端末に保存しました(Excel で開けます。外へは送っていません)。');
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
const z2 = (n) => String(n).padStart(2, '0');
function today(d = new Date()) {
  return d.getFullYear() + '-' + z2(d.getMonth() + 1) + '-' + z2(d.getDate());
}

// 印刷の頭の行(F61a)。紙がどの版のいつの結果かを残す。日時は PC の時計。画面には出さない行なので、印刷の直前に描く
export function stampPrintHead(doc) {
  const el = doc.getElementById('print-head');
  if (!el) return;
  const d = new Date();
  el.textContent = '版 ' + el.getAttribute('data-version') + '・印刷した日時 ' + today(d) + ' ' + z2(d.getHours()) + ':' + z2(d.getMinutes());
}

// 紙に出す直前の準備。ボタンからもブラウザのメニューからも通る
function prepareForPrint(doc) {
  stampPrintHead(doc);
  openDetailsForPrint(doc);
}

export function exportCsv(doc) {
  if (!last) { setExportStatus(doc, stale ? STALE : '先に「確認する」を押して結果を出してください。'); return; }
  const snap = safetySnapshot(doc);
  const csv = toCsv([...stage1Rows(last.bid, last.taicho, NOTICE), ...workKindRows(shownKind.schedule), ...safetyRows(snap.result, snap.answerRows)]);
  downloadText(doc, csv, '入札前の確認_' + today() + '.csv', 'text/csv;charset=utf-8');
  setExportStatus(doc, 'CSV をこの端末に保存しました(Excel で開けます。外へは送っていません)。');
}

export function printResult(doc, win) {
  if (!last) setExportStatus(doc, stale ? STALE : '結果がまだありません。「確認する」を押してから印刷すると結果が紙に出ます。');
  prepareForPrint(doc);
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
  if (text.trim() === '') {
    outEl.innerHTML = renderErrors(['台帳の文が空です。台帳を貼るか、入口の「まず見本で試す」を押してください。']);
    lastChecklist = null; checklistText = null; checklistChecked.clear();
    const cl = doc.getElementById('checklist-result');
    if (cl) cl.innerHTML = '<p>台帳を貼って「台帳を点検する」を押すと、記載事項の表が出ます。</p>';
    return;
  }
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
    let out = checkTaicho(ledger);
    try {
      out = addChecklistCandidates(out, ledger, checkChecklistText(text));
    } catch (e) {
      warnings.push('記載事項の「空」の行を候補に足す途中で止まりました: ' + String(e && e.message ? e.message : e));
    }
    // 施工体系図の欄と目次の点検の欄に文があれば突き合わせる(F32a)。どちらも空なら台帳だけの結果のまま
    const textOf = (id) => String(doc.getElementById(id)?.value ?? '');
    try {
      out = addCrossCandidates(out, ledger, { taikeizu: textOf('taikeizu-input'), plan: textOf('plan-input') });
      warnings.push(...(out.crossWarnings ?? []));
    } catch (e) {
      warnings.push('書類どうしの突き合わせの途中で止まりました: ' + String(e && e.message ? e.message : e));
    }
    outEl.innerHTML = renderCheckResult(out, warnings);
    lastCheck = out;
    summary.check = out;
  } catch (e) {
    outEl.innerHTML = renderErrors(['点検の途中で止まりました(抜き書きの誤りの可能性があります): ' + String(e && e.message ? e.message : e)]);
  }
  runChecklist(doc, text);
  updateSummary(doc);
}

// 台帳の記載事項の表(F16c): 台帳の文から施行規則 第14条の2 の事項ごとの表を出す(点検の候補とは別に動かし、片方が止まっても片方は出す)。
// 「確認した」のチェックはこの Set にだけ持つ(ブラウザに保存しない。ページを閉じれば消える)。
// 同じ台帳の文で出し直したときはチェックを残し、台帳の文が変わったら消す(別の下請けの行に印が移らないように)
let lastChecklist = null;
let checklistText = null;
let checklistStale = false; // 表を出したあとに台帳の文を変えたか(変えたら書き出さない)
const checklistChecked = new Set();
function setChecklistStatus(doc, text) {
  const el = doc.getElementById('checklist-status');
  if (el) el.textContent = text;
}
export function checklistState() {
  return { out: lastChecklist, checked: new Set(checklistChecked) };
}
function drawChecklist(doc) {
  const el = doc.getElementById('checklist-result');
  if (el && lastChecklist) el.innerHTML = renderChecklist(lastChecklist, checklistChecked);
}
export function runChecklist(doc, text) {
  const el = doc.getElementById('checklist-result');
  if (!el) return;
  setChecklistStatus(doc, '');
  if (text !== checklistText) checklistChecked.clear();
  lastChecklist = null;
  checklistText = null;
  checklistStale = false;
  try {
    lastChecklist = checkChecklistText(text);
    checklistText = text;
    for (const id of [...checklistChecked]) if (!lastChecklist.rows.some((r) => r.id === id)) checklistChecked.delete(id);
    drawChecklist(doc);
  } catch (e) {
    el.innerHTML = renderErrors(['記載事項の表を作る途中で止まりました: ' + String(e && e.message ? e.message : e)]);
  }
}
export function setChecklistChecked(doc, rowId, on) {
  if (!lastChecklist || !lastChecklist.rows.some((r) => r.id === rowId)) return;
  if (on) checklistChecked.add(rowId); else checklistChecked.delete(rowId);
  drawChecklist(doc);
  const box = typeof doc.querySelector === 'function' ? doc.querySelector('input.checklist-check[data-row-id="' + String(rowId).replace(/"/g, '') + '"]') : null;
  if (box && typeof box.focus === 'function') box.focus();
}
export function exportChecklistCsv(doc) {
  if (!lastChecklist) { setChecklistStatus(doc, '先に「台帳を点検する」を押して記載事項の表を出してください。'); return; }
  if (checklistStale) { setChecklistStatus(doc, '台帳の文が変わりました。もう一度「台帳を点検する」を押してから書き出してください(同じ文に戻せばチェックは残ります)。'); return; }
  downloadText(doc, toCsv(checklistRows(lastChecklist, checklistChecked, NOTICE)), '台帳の記載事項_' + today() + '.csv', 'text/csv;charset=utf-8');
  setChecklistStatus(doc, 'CSV をこの端末に保存しました(「確認した」の列にチェックの有無が入っています。Excel で開けます。外へは送っていません)。');
}

export function exportCheckCsv(doc) {
  if (!lastCheck) { setCheckStatus(doc, '先に「台帳を点検する」を押して結果を出してください。'); return; }
  downloadText(doc, toCsv(checkRows(lastCheck, NOTICE)), '台帳の点検_' + today() + '.csv', 'text/csv;charset=utf-8');
  setCheckStatus(doc, 'CSV をこの端末に保存しました(Excel で開けます。外へは送っていません)。');
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
    if (status) status.textContent = file.name + ' を読みました(読めない欄 ' + r.unreadable.length + ' 件)。台帳の文の欄を確かめ、足りない行を書き足してから「台帳を点検する」を押してください。';
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
  if (text.trim() === '') { outEl.innerHTML = renderErrors(['目次が空です。施工計画書の目次を貼るか、入口の「まず見本で試す」を押してください。']); return; }
  try {
    const form = readBidForm(collect(doc));
    const workKind = readWorkKind(collect(doc));
    shownKind.planItems = workKind;
    applyRulesSides(doc);
    const out = checkPlanToc(text, { workType: form.workType ?? undefined, workKind, table: tableFor(workKind) });
    if (!form.workType && !out.notRead && !out.wordsOnly) out.notes.push('上の欄の「工事の種類」が選ばれていないので、土木の工事として比べました。建築一式工事なら「建築一式工事」を選んでください');
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
  downloadText(doc, toCsv(planRows(lastPlan, shownKind.planItems, NOTICE)), '施工計画書の目次の点検_' + today() + '.csv', 'text/csv;charset=utf-8');
  setPlanStatus(doc, 'CSV をこの端末に保存しました(Excel で開けます。外へは送っていません)。');
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
  for (const id of SAMPLE.safetyWorks) {
    const el = doc.getElementById('safety-work-' + id);
    if (el) el.checked = true;
  }
  const st = doc.getElementById('sample-status');
  if (st) st.textContent = '見本「' + SAMPLE.title + '」を読み込みました。' + SAMPLE.note + ' 欄の値を変えて、もう一度「確認する」を押すこともできます。';
  runBid(doc);
  if (doc.getElementById('ledger-input') && doc.getElementById('check-result')) runLedgerCheck(doc);
  if (doc.getElementById('plan-input') && doc.getElementById('plan-result')) runPlanCheck(doc);
  fieldSources = markSources(collect(doc), '見本');
  // 見本のあとも入力の確かめを通る(F43d)。結果は隠れた段に書いておき、「この内容で結果を見る」で開く
  const banner = doc.getElementById('sample-banner');
  if (banner) banner.hidden = false;
  setBidStatus(doc, bidNotice(SAMPLE_NOTICE_DONE));
  openConfirm(doc);
}

// 公告から拾った条件のファイルを読み、入れてよい欄だけ入れる(F41a)。壊れたファイルは何も変えない
function setIntakeStatus(doc, text, lines = []) {
  const st = doc.getElementById('intake-status');
  if (st) st.textContent = text;
  const out = doc.getElementById('intake-result');
  if (out) out.innerHTML = lines.length ? '<ul>' + lines.map((x) => '<li>' + esc(x) + '</li>').join('') + '</ul>' : '';
}
// 読んでいる途中のファイル(F52a)。読み終わる前に押された「確認する」は、読み終わってから動かす。
// 先に動かすと、空の欄で結果が出て、知らせが出ないまま欄だけがあとから入る
let intakeReading = null;
const afterIntake = (f) => (intakeReading ? intakeReading.then(f) : f());
function queueIntake(doc, f) {
  // 違う口の確かめも読み込みの順番の中でする(確かめている間に「確認する」が先へ進まないように)
  const reading = (intakeReading ?? Promise.resolve()).then(() => readChecked(doc, 'intake-load', f, readIntake)).then(() => {
    if (intakeReading === reading) intakeReading = null;
  });
  intakeReading = reading;
  return reading;
}
async function readIntake(doc, f) {
  if (f.size > INTAKE_MAX_BYTES) { setIntakeStatus(doc, '読み込めませんでした: ファイルが大きすぎます(1MB まで)。入力欄はそのままです。'); return; }
  try {
    loadIntakeFile(doc, await f.text(), f.name);
  } catch {
    setIntakeStatus(doc, '読み込めませんでした: ファイルを読めません。入力欄はそのままです。');
  }
}
export function loadIntakeFile(doc, text, name) {
  let t;
  try {
    t = parseIntakeFile(text);
  } catch (e) {
    setIntakeStatus(doc, '読み込めませんでした: ' + e.message + '。入力欄はそのままです。');
    return false;
  }
  // 見本の値に混ぜない
  if (doc.getElementById('sample-banner')?.hidden === false) clearSample(doc);
  for (const [id, v] of Object.entries(t.form)) {
    const el = doc.getElementById(id);
    if (!el) continue;
    el.value = v;
    if (id === 'contract-amount') {
      const unknown = doc.getElementById('contract-amount-unknown');
      if (unknown) unknown.checked = false;
    }
    if (typeof Event === 'function') el.dispatchEvent?.(new Event('input', { bubbles: true }));
  }
  // 別の公告の文が残らないよう、施工実績の文は無くても置き換える(F49a)
  const participation = doc.getElementById('participation-conditions');
  if (participation) {
    participation.value = t.participation;
    if (typeof Event === 'function') participation.dispatchEvent?.(new Event('input', { bubbles: true }));
  }
  const filled = t.participation ? [...Object.keys(t.form), 'participation-conditions'] : Object.keys(t.form);
  fieldSources = { ...fieldSources, ...markSources(collect(doc), '公告', t.quotes, filled) };
  // 予定価格の注意は、請負代金の欄へ値を入れたときだけ(F65a)。入れていないのに言うと、どの値の話か分からない
  const amountNote = Object.hasOwn(t.form, 'contract-amount') ? '予定価格は上限の見込みで、請負代金そのものではありません。' : '';
  setIntakeStatus(doc, (typeof name === 'string' ? name + ' を読みました。' : '') + '「' + t.title + '」から ' + Object.keys(t.form).length + ' 欄を入れました。' + amountNote + '原文で確かめてください。ブラウザには保存しません。残りの欄を入れて「確認する」を押すと、入れた内容を確かめる画面へ進みます。', intakeLines(t));
  return true;
}

// ファイルの読み込み口(F54c)。ボタンで選んでも、ドラッグして置いても、同じ関数で読む。
// value = '' のリセットはボタンの側だけ。input.files には代入しない
async function readRules(doc, f) {
  if (f.size > RULES_MAX_BYTES) { setRulesStatus(doc, '読み込めませんでした: 表のファイルとしては大きすぎます(1MB まで)。今の表はそのままです。'); return; }
  try {
    loadRulesFile(doc, await f.text(), f.name);
  } catch {
    setRulesStatus(doc, '読み込めませんでした: ファイルを読めません。今の表はそのままです。');
  }
}
const setLedgerFileStatus = (doc, text) => {
  const el = doc.getElementById('ledger-file-status');
  if (el) el.textContent = text;
};
const sayIn = (id) => (doc, text) => {
  const el = doc.getElementById(id);
  if (el) el.textContent = text;
};
const FILE_PORTS = {
  'intake-load': { read: queueIntake, say: setIntakeStatus },
  'rules-load': { read: (doc, f) => readChecked(doc, 'rules-load', f, readRules), say: setRulesStatus },
  'ledger-file': { read: loadLedgerFile, say: setLedgerFileStatus },
  'dict-import': { read: (doc, f) => readChecked(doc, 'dict-import', f, readDictFile), say: sayIn('dict-file-status') },
  'mask-file': { read: loadMaskFile, say: sayIn('mask-file-status') },
  'map-import': { read: (doc, f) => readChecked(doc, 'map-import', f, readMapFile), say: sayIn('map-status') },
  'ai-load': { read: (doc, f) => readChecked(doc, 'ai-load', f, readAiFile), say: sayIn('ai-status') },
};
const DROP_IDS = Object.keys(FILE_PORTS);
const WRONG_PORT_MAX_BYTES = 1024 * 1024;
const DROP_HINT = 'この枠にファイルをドラッグして置いても読み込めます';
const ONE_FILE = '一度に読めるファイルは1つです。どれも読み込んでいません。';
const NO_FILE = '読み込んでいません。ファイルを受け取れませんでした。ボタンからファイルを選んでください。';
const INTAKE_PDF = '公告の PDF はこの画面では読めません。パソコンの Claude Code(Skill bid-intake)で公告を読み、できた条件のファイル(.json)をこの枠にドラッグしてください。手で入れるときは、段1「条件を入れる」の欄に入れます。';
const NOT_READ_DROP = '読み込んでいません。';
const USE_FRAME = NOT_READ_DROP + 'ファイルは点線の枠にドラッグしてください。';
// 別の道具の口は閉じた折りたたみの中にある
const toolPort = (what, label) => 'これは' + what + 'のファイルです。「ここからは別の道具」を開き、「' + label + '」の枠にドラッグしてください。';
const WRONG_PORT = {
  'intake-load': 'これは公告から拾った条件のファイルです。段1「条件を入れる」の「公告から拾った条件を読み込む」を開き、その枠にドラッグしてください。',
  'rules-load': 'これは発注者の表のファイルです。段2「結果を見る」の「直轄とは・例の違い・自分の表を読み込む」を開き、その枠にドラッグしてください。',
  'dict-import': toolPort('辞書', '辞書を読み込む'),
  'map-import': toolPort('対応表', '対応表を読み込む'),
  'ai-load': toolPort(' AI の候補', 'AI の候補を読み込む'),
};
// .json の中身の印から、どの口のファイルかを言う。分からなければ null(今の誤りの文に任せる)
function jsonPortOf(data) {
  if (data?.kind === 'bid-intake') return 'intake-load';
  if (data?.format === DICT_FORMAT) return 'dict-import';
  if (data?.format === MAP_FORMAT) return 'map-import';
  if (data?.format === RESULT_FORMAT) return 'ai-load';
  if (Array.isArray(data?.rows) && data.rows.some((r) => r?.kind === 'schedule' || r?.kind === 'plan-item')) return 'rules-load';
  return null;
}
// 違う口のファイルなら行き先を知らせて読まない。読めないファイルは read の側の文に任せる
async function readChecked(doc, id, f, read) {
  let owner = null;
  if (!(f.size > WRONG_PORT_MAX_BYTES)) {
    try {
      owner = jsonPortOf(JSON.parse(String(await f.text()).replace(/^\uFEFF/, '')));
    } catch { /* read の側で理由を出す */ }
  }
  if (owner && owner !== id) { FILE_PORTS[id].say(doc, WRONG_PORT[owner]); return false; }
  return read(doc, f);
}

// 受け付ける拡張子は input の accept から取る。name の無い File は確かめない(今までどおり読む)
export function fileTypeMessage(doc, id, file) {
  if (typeof file?.name !== 'string') return null;
  const exts = String(doc.getElementById(id)?.getAttribute?.('accept') ?? '').split(',').map((x) => x.trim().toLowerCase()).filter((x) => x.startsWith('.'));
  const name = file.name.toLowerCase();
  if (!exts.length || exts.some((x) => name.endsWith(x))) return null;
  if (id === 'intake-load' && name.endsWith('.pdf')) return INTAKE_PDF;
  const again = /\.xls$/.test(name) ? 'Excel で .xlsx に保存し直してください。' : '';
  return '選んだファイルは ' + exts.join('・') + ' にしてください(今のファイル: ' + file.name + ')。' + again;
}
function readPortFile(doc, id, file) {
  const port = FILE_PORTS[id];
  const bad = fileTypeMessage(doc, id, file);
  if (bad) { port.say(doc, bad); return Promise.resolve(false); }
  return port.read(doc, file);
}

// 口の名前は label の文の括弧の前から取る(「台帳の Excel を読む(…」→「台帳の Excel」)
export function dropPortName(labelText) {
  return String(labelText ?? '').split('(')[0].trim().replace(/(から読む|を読み込む|を読む)$/, '').trim();
}
const hasFiles = (ev) => Array.from(ev?.dataTransfer?.types ?? []).includes('Files');
// e.target から親をたどって枠を探す。closest・matches は使わない(docs/acceptance-map.md)
export function findDropTarget(node) {
  for (let n = node; n; n = n.parentNode) {
    if (n.getAttribute?.('data-drop')) return n;
  }
  return null;
}
let dragReady = false;
let dragOver = null;
const dropHintOf = (frame) => frame?.querySelector?.('.drop-hint');
function setDragOver(el) {
  if (dragOver === el) return;
  if (dragOver) {
    dragOver.classList?.remove('drop-over');
    const hint = dropHintOf(dragOver);
    if (hint) hint.textContent = DROP_HINT;
  }
  dragOver = el;
  if (!el) return;
  el.classList?.add('drop-over');
  const hint = dropHintOf(el);
  if (hint) hint.textContent = 'ここで離すと「' + dropPortName(el.querySelector?.('label')?.textContent) + '」を読み込みます';
}
function setDragReady(doc, on) {
  if (dragReady === on) return;
  dragReady = on;
  for (const id of DROP_IDS) findDropTarget(doc.getElementById(id))?.classList?.[on ? 'add' : 'remove']('drop-ready');
}
// ファイルのドラッグだけを受ける。文字のドラッグは止めない。
// 枠の外で dropEffect を none にすると drop が届かず、ブラウザが開くのは止まるが知らせを出せなくなるので、枠の上だけ決める
export function handleDragMove(doc, ev) {
  if (!hasFiles(ev)) return;
  ev.preventDefault?.();
  setDragReady(doc, true);
  const frame = findDropTarget(ev.target);
  if (frame && ev.dataTransfer) ev.dataTransfer.dropEffect = 'copy';
  setDragOver(frame);
}
function endDrag(doc) {
  setDragOver(null);
  setDragReady(doc, false);
}
const sayDropStatus = sayIn('drop-status');
const isShown = (doc, id) => { const el = doc.getElementById(id); return Boolean(el) && !el.hidden; };
const frameName = (doc, id) => dropPortName(findDropTarget(doc.getElementById(id))?.querySelector?.('label')?.textContent);
// 枠のある閉じた折りたたみを開く。開いたときだけ、その名前を返す
function openFold(doc, id) {
  const fold = doc.getElementById(id);
  if (!fold || fold.open) return '';
  fold.open = true;
  return String(fold.querySelector?.('summary')?.textContent ?? '').trim();
}
const OPENED = (name) => (name ? '「' + name + '」を開きました' : '');
// 枠の外に置いたとき: 今見えている段の口の欄に書き、見える所に出す(開いた折りたたみの中の欄もあるので、開いてから動かす)
function outsideNotice(doc) {
  if (doc.getElementById('other-tools')?.open) return ['dict-file-status', USE_FRAME + 'この道具の枠: ' + ['dict-import', 'mask-file', 'map-import', 'ai-load'].map((id) => frameName(doc, id)).join('・') + '。'];
  if (isShown(doc, 'panel-1')) {
    const opened = OPENED(openFold(doc, 'intake-more'));
    return ['intake-status', USE_FRAME + 'この段の枠: ' + frameName(doc, 'intake-load') + '(.json)。' + (opened ? opened + '。' : '')];
  }
  if (isShown(doc, 'panel-2')) {
    const opened = OPENED(openFold(doc, 'rules-more'));
    return ['rules-status', USE_FRAME + 'この段の枠: ' + frameName(doc, 'rules-load') + (opened ? '(' + opened + ')' : '') + '。'];
  }
  if (isShown(doc, 'panel-3')) return ['ledger-file-status', USE_FRAME + 'この段の枠: ' + frameName(doc, 'ledger-file') + '。'];
  if (isShown(doc, 'entry')) return ['drop-status', NOT_READ_DROP + '条件のファイル(.json)は「公告から拾った条件を読み込む」のタイルにドラッグしてください。台帳の Excel などは段3「書類を確かめる」の枠にドラッグします。'];
  // 入力の確かめの画面には枠が無い
  return ['drop-status', NOT_READ_DROP + 'この画面にはファイルの枠がありません。条件のファイル(.json)は段1「条件を入れる」の「公告から拾った条件を読み込む」で読み込みます。'];
}
function sayOutside(doc) {
  const [id, text] = outsideNotice(doc);
  if (id === 'intake-status') setIntakeStatus(doc, text);
  else sayIn(id)(doc, text);
  doc.getElementById(id)?.scrollIntoView?.({ block: 'nearest' });
}
export function handleFileDrop(doc, ev) {
  if (!hasFiles(ev)) return Promise.resolve(false);
  ev.preventDefault?.();
  endDrag(doc);
  sayDropStatus(doc, '');
  const frame = findDropTarget(ev.target);
  if (!frame) { sayOutside(doc); return Promise.resolve(false); }
  const id = frame.getAttribute('data-drop');
  const onTile = frame.id === 'entry-intake';
  const say = onTile ? sayDropStatus : FILE_PORTS[id].say;
  const files = Array.from(ev.dataTransfer.files ?? []);
  if (files.length !== 1) { say(doc, files.length ? ONE_FILE : NO_FILE); return Promise.resolve(false); }
  if (!onTile) return readPortFile(doc, id, files[0]);
  // タイルは種類を確かめてから段1へ移る。違えば入口に留まる
  const bad = fileTypeMessage(doc, id, files[0]);
  if (bad) { say(doc, bad); return Promise.resolve(false); }
  openIntake(doc);
  return FILE_PORTS[id].read(doc, files[0]);
}
export function startDrop(doc) {
  doc.addEventListener?.('dragenter', (ev) => handleDragMove(doc, ev));
  doc.addEventListener?.('dragover', (ev) => handleDragMove(doc, ev));
  // 窓の外へ出たときだけ、枠を元に戻す(枠の中の子の間の移動では relatedTarget がある)
  doc.addEventListener?.('dragleave', (ev) => { if (!ev.relatedTarget) endDrag(doc); });
  doc.addEventListener?.('drop', (ev) => handleFileDrop(doc, ev));
}

// 「自分の工事で入れ直す」(F37a): 見本の値と見本から出た結果を消し、段1 を開く。
// 見本を読み込んだあとに利用者が貼り替えた台帳・目次は、見本ではないので消さない
const RESULT_IDS = ['bid-result', 'taicho-result', 'schedule-result', 'open-items', 'check-result', 'checklist-result', 'plan-result'];
let initialForm = null;
const initialResult = new Map();
function restoreResult(doc, id) {
  const el = doc.getElementById(id);
  if (el && initialResult.has(id)) el.innerHTML = initialResult.get(id);
}
export function clearSample(doc) {
  for (const [id, v] of Object.entries(initialForm ?? {})) {
    const el = doc.getElementById(id);
    if (!el) continue;
    if (typeof v === 'boolean') el.checked = v;
    else el.value = v;
  }
  last = null;
  stale = false;
  lastSchedule = null;
  lastScheduleInput = null;
  summaryShown = false;
  Object.assign(summary, { values: null, errors: [], bid: null, taicho: null, scheduleCount: null, scheduleNotRead: false, stale: false });
  setExportStatus(doc, '');
  setScheduleStatus(doc, '');
  setBidStatus(doc, '');
  markAmountFields(doc, {});
  clearSafety(doc);
  renderSafety(doc);
  for (const id of ['bid-result', 'taicho-result', 'schedule-result', 'open-items']) restoreResult(doc, id);
  const sum = doc.getElementById('summary');
  if (sum) { sum.hidden = true; sum.innerHTML = ''; }
  const top = doc.getElementById('result-top');
  if (top) { top.hidden = true; top.innerHTML = ''; }

  const ledger = doc.getElementById('ledger-input');
  if (ledger && ledger.value === SAMPLE.documents.ledger) {
    ledger.value = '';
    lastCheck = null;
    summary.check = null;
    lastChecklist = null;
    checklistText = null;
    checklistStale = false;
    checklistChecked.clear();
    setCheckStatus(doc, '');
    setChecklistStatus(doc, '');
    restoreResult(doc, 'check-result');
    restoreResult(doc, 'checklist-result');
  } else if (lastCheck) {
    // 自分の台帳の点検は残すが、見本の条件で出した結果なので書き出さない
    lastCheck = null;
    setCheckStatus(doc, '台帳か条件が変わりました。もう一度「台帳を点検する」を押してから書き出してください。');
  }
  const plan = doc.getElementById('plan-input');
  if (plan && plan.value === SAMPLE.documents.planToc) {
    plan.value = '';
    lastPlan = null;
    summary.plan = null;
    setPlanStatus(doc, '');
    restoreResult(doc, 'plan-result');
  }
  for (const id of ['sample-ledger', 'sample-plan']) {
    const el = doc.getElementById(id);
    if (el) el.textContent = '';
  }
  const docs = doc.getElementById('sample-docs');
  if (docs) docs.hidden = true;
  const st = doc.getElementById('sample-status');
  if (st) st.textContent = '';
  const banner = doc.getElementById('sample-banner');
  if (banner) banner.hidden = true;
  fieldSources = {};
  openPanel(doc, 1);
}

export function startApp(doc, win = typeof window !== 'undefined' ? window : globalThis) {
  applyRulesSides(doc);
  const start = () => {
    const on = (id, f) => {
      const btn = doc.getElementById(id);
      if (btn) btn.addEventListener('click', (ev) => { if (ev && ev.preventDefault) ev.preventDefault(); f(); });
    };
    initialForm = collect(doc);
    for (const id of RESULT_IDS) {
      const el = doc.getElementById(id);
      if (el) initialResult.set(id, el.innerHTML);
    }
    setAwardedView(doc, false); // 入札前の確認の折りたたみは、全部の行を出すとき以外は開いておく
    on('bid-run', () => afterIntake(() => { runBid(doc); setBidStatus(doc, bidNotice(BID_NOTICE_DONE)); openConfirm(doc); }));
    on('confirm-go', () => afterIntake(() => confirmGo(doc)));
    on('confirm-back', () => openPanel(doc, 1));
    for (const r of CONFIRM_ROWS) on('confirm-change-' + r.key, () => changeField(doc, r.key));
    on('sample-load', () => loadSample(doc));
    on('sample-reenter', () => clearSample(doc));
    on('entry-bid', () => openPanel(doc, 1));
    on('entry-intake', () => openIntake(doc));
    on('entry-awarded', () => enterAwarded(doc));
    on('awarded-conditions', () => openPanel(doc, 1));
    on('entry-back', () => showEntry(doc));
    for (const i of PANELS) on('step-' + i, () => openPanel(doc, i));
    on('next-step-3', () => openPanel(doc, 3));
    const main = doc.getElementById('main');
    if (main) main.addEventListener('click', (ev) => {
      const a = ev && ev.target && ev.target.closest ? ev.target.closest('a[href^="#"]') : null;
      if (a) openPanelForLink(doc, a.getAttribute('href'));
    });
    on('print-btn', () => printResult(doc, win));
    on('csv-btn', () => exportCsv(doc));
    on('ledger-run', () => runLedgerCheck(doc));
    on('check-csv-btn', () => exportCheckCsv(doc));
    on('checklist-csv-btn', () => exportChecklistCsv(doc));
    // 記載事項の表の「確認した」(表は描き直すので、枠で受ける)
    const clEl = doc.getElementById('checklist-result');
    if (clEl) clEl.addEventListener('change', (ev) => {
      const t = ev && ev.target;
      if (t && t.classList && t.classList.contains('checklist-check')) setChecklistChecked(doc, t.getAttribute('data-row-id'), t.checked === true);
    });
    on('schedule-csv-btn', () => exportScheduleCsv(doc));
    // 段取りの「発注者の仕様書では」(表は描き直すので、枠で受ける)。隣の印刷用の文も同じにする
    const schedEl = doc.getElementById('schedule-result');
    if (schedEl) schedEl.addEventListener('input', (ev) => {
      const t = ev && ev.target;
      if (!t || !t.classList || !t.classList.contains('schedule-note')) return;
      setScheduleNote(t.getAttribute('data-note-key'), t.value);
      if (t.nextElementSibling) t.nextElementSibling.textContent = t.value;
    });
    for (const id of SAFETY_ALL_IDS) doc.getElementById(id)?.addEventListener('change', () => changeSafety(doc, id));
    setSafetyVersion(doc);
    renderSafety(doc);
    on('rules-clear', () => clearRulesTable(doc));
    on('rules-national', () => clearRulesTable(doc));
    on('rules-wakayama', () => useWakayamaExample(doc));
    const rulesFile = doc.getElementById('rules-load');
    if (rulesFile) rulesFile.addEventListener('change', async () => {
      const f = rulesFile.files && rulesFile.files[0];
      if (!f) return;
      await readPortFile(doc, 'rules-load', f);
      rulesFile.value = '';
    });
    const intakeFile = doc.getElementById('intake-load');
    if (intakeFile) intakeFile.addEventListener('change', () => {
      const f = intakeFile.files && intakeFile.files[0];
      if (!f) return;
      readPortFile(doc, 'intake-load', f).then(() => { intakeFile.value = ''; });
    });
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
    for (const id of ['ledger-input', 'taikeizu-input', 'plan-input', ...BID_FORM_IDS]) {
      const el = doc.getElementById(id);
      if (!el) continue;
      const changed = () => {
        if (lastCheck) { lastCheck = null; setCheckStatus(doc, '台帳か条件が変わりました。もう一度「台帳を点検する」を押してから書き出してください。'); }
        if (id === 'ledger-input' && lastChecklist && !checklistStale) { checklistStale = true; setChecklistStatus(doc, '台帳の文が変わりました。もう一度「台帳を点検する」を押してから書き出してください(同じ文に戻せばチェックは残ります)。'); }
      };
      el.addEventListener('input', changed);
      el.addEventListener('change', changed);
    }
    const ledgerFile = doc.getElementById('ledger-file');
    if (ledgerFile) {
      ledgerFile.addEventListener('change', async () => {
        const f = ledgerFile.files && ledgerFile.files[0];
        if (!f) return;
        await readPortFile(doc, 'ledger-file', f);
        ledgerFile.value = '';
      });
    }
    startMask(doc);
    for (const id of ['dict-import', 'mask-file', 'map-import', 'ai-load']) {
      const input = doc.getElementById(id);
      if (input) input.addEventListener('change', async () => {
        const f = input.files && input.files[0];
        if (!f) return;
        await readPortFile(doc, id, f);
        input.value = '';
      });
    }
    startDrop(doc);
    // 条件を変えたら、前の結果は印刷・書き出しに使わない(入れた条件と結果が食い違わないように)
    for (const id of BID_FORM_IDS) {
      const el = doc.getElementById(id);
      if (!el) continue;
      const changed = () => {
        if (last) { last = null; stale = true; setExportStatus(doc, STALE); }
        if (summaryShown && !summary.stale) { summary.stale = true; updateSummary(doc); if (!awardedAll) setBidStatus(doc, NOTICE_STALE); }
        renderSafety(doc);
        // 全部の行(F37c)は条件から出していないので、条件を変えても古くならない
        if (lastSchedule && !awardedAll) { lastSchedule = null; setScheduleStatus(doc, '条件が変わりました。もう一度「確認する」を押してから、段取りを書き出してください。'); }
      };
      el.addEventListener('input', changed);
      el.addEventListener('change', changed);
    }
    // ブラウザのメニューから印刷したときも、日時を描いて折りたたみを開く
    if (win && win.addEventListener) {
      win.addEventListener('beforeprint', () => prepareForPrint(doc));
      win.addEventListener('afterprint', () => restoreDetailsAfterPrint());
    }
  };
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start);
  else start();
}

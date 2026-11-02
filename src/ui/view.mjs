// 判定の結果を画面の HTML にする(F05a)。DOM には触らず、文字列を返す。
// 結果の文字はすべてエスケープする(規則表や入力の文字がそのまま HTML にならないように)。
import { readDirect } from './form.mjs';

export function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// 根拠の条の書き方: 「建設業法 第24条の8第1項第2号」。条の無い資料(ガイドライン)は資料名と節
export function basisLabel(b) {
  if (!b.article) return [b.title ?? b.law, b.section, b.page ? b.page + 'ページ' : null].filter(Boolean).join(' ');
  const [main, ...subs] = String(b.article).split('の');
  let s = '第' + main + '条' + subs.map((x) => 'の' + x).join('');
  if (b.paragraph) s += '第' + b.paragraph + '項';
  if (b.item) s += '第' + b.item + '号';
  return b.law + ' ' + s;
}

function basisList(list = []) {
  if (!list.length) return '<p class="basis-none">根拠: 無し</p>';
  // 見出しは中身が分かる言葉にする(F14c)。原文の抜き書きは閉じておき、開くと読める
  return '<details class="basis"><summary>根拠: ' + esc([...new Set(list.map(basisLabel))].join('、')) + '</summary><ul>'
    + list.map((b) => '<li><strong>' + esc(basisLabel(b)) + '</strong>(取得日 ' + esc(b.fetchedAt) + ')<blockquote>' + esc(b.quote) + '</blockquote></li>').join('')
    + '</ul></details>';
}

function exceptionList(list = []) {
  if (!list.length) return '';
  return '<details class="exceptions"><summary>例外・読み方の注意(' + list.length + '件)</summary><ul>' + list.map((e) => '<li>' + esc(e) + '</li>').join('') + '</ul></details>';
}

function amountBasisBlock(ab) {
  if (!ab) return '';
  return '<div class="amount-basis"><p>金額の比べ方: ' + esc(ab.tax === 'included' ? '税込み' : ab.tax === 'excluded' ? '税抜き' : ab.tax) + '。' + esc(ab.note) + '</p>' + basisList(ab.basis) + '</div>';
}

export const BID_STATUS = { required: '要る', not_required: '要らない', needs_check: '確認が要る' };
// 結論の印(F14b): 色だけで区別しないよう、記号と言葉を必ず添える(要る=✕と赤系、確認が要る=!と黄系、要らない=✓と緑系)
export const STATUS_MARK = { required: '✕', needs_check: '!', not_required: '✓' };
export function statusBadge(status, extra = '') {
  const word = BID_STATUS[status] ?? String(status ?? '');
  const mark = STATUS_MARK[status];
  return '<span class="badge badge-' + esc(status) + '">' + (mark ? '<span class="mark" aria-hidden="true">' + esc(mark) + '</span> ' : '') + esc(word + extra) + '</span>';
}
// 結果の項目へのページの中のリンクの行き先(まとめの枠から移る)
export const bidItemId = (key) => 'bid-item-' + String(key ?? '').replace(/[^\w-]/g, '_');
export const ENGINEER = { kanri: '監理技術者', shunin: '主任技術者' };

// 入札前の確認(bidCheck の返り値)
export function renderBidResult(bid) {
  const rows = bid.items.map((it) => {
    const status = BID_STATUS[it.status] ?? it.status;
    const value = it.value && ENGINEER[it.value] ? '(' + ENGINEER[it.value] + ')' : '';
    return '<li class="item status-' + esc(it.status) + '" id="' + esc(bidItemId(it.key)) + '"><h4>' + esc(it.label) + ': <span class="status">' + (STATUS_MARK[it.status] ? statusBadge(it.status, value) : esc(status + value)) + '</span></h4>'
      + '<p>' + esc(it.note) + '</p>' + basisList(it.basis) + exceptionList(it.exceptions) + '</li>';
  }).join('');
  const checks = bid.checks.length
    ? '<h3>確認が要る点(' + bid.checks.length + '件)</h3><ul class="checks">' + bid.checks.map((c) => '<li><strong>' + esc(c.label) + '</strong>: ' + esc(c.message) + '</li>').join('') + '</ul>'
    : '<h3>確認が要る点</h3><p>入力の範囲では、確認が要る点は出ませんでした(入力していない条件や、このツールが判定しない例外はあります)。</p>';
  return '<h3>受注したら要るもの</h3><ul class="items">' + rows + '</ul>' + checks + amountBasisBlock(bid.amountBasis)
    + '<p class="human">' + esc(bid.disclaimer) + '</p>';
}

export const TAICHO_STATUS = {
  required: '作る',
  not_required: '作らなくてよい',
  needs_check: '確認が要る(先に確かめることがある)',
  unknown: '判断できない(入力を足すか、確認が必要)',
};
export const COPY_STATUS = {
  required: '発注者に出す',
  not_required: '出さなくてよい',
  not_applicable: '台帳を作らないので出すものが無い',
  unknown: '判断できない(確認が必要)',
};

// 施工体制台帳が要るか(judgeTaicho の返り値)
export function renderTaichoResult(t) {
  const reasons = t.reasons.length
    ? '<ul class="reasons">' + t.reasons.map((r) => '<li><p>' + esc(r.action) + '</p>' + basisList(r.basis) + exceptionList(r.exceptions) + '</li>').join('') + '</ul>'
    : '<p>当てはまる規則表の行がありません。</p>';
  return '<p>施工体制台帳: <strong class="status">' + esc(TAICHO_STATUS[t.status] ?? t.status) + '</strong></p>'
    + '<p>写しを発注者に出すか: <strong>' + esc(COPY_STATUS[t.copyToOrderer] ?? t.copyToOrderer) + '</strong></p>'
    + (t.message ? '<p class="message">' + esc(t.message) + '</p>' : '')
    + reasons + amountBasisBlock(t.amountBasis)
    + '<p class="human">規則表の行に当てはめた結果です。台帳を作るか・写しを出すかの最後の判断は、発注者の仕様書などを確かめたうえで人がしてください</p>';
}

export function renderErrors(list) {
  return '<div class="errors"><p>入力を読めませんでした。直してからもう一度押してください。</p><ul>' + list.map((e) => '<li>' + esc(e) + '</li>').join('') + '</ul></div>';
}

// 台帳の点検(checkTaicho の返り値)の欄の名前(画面と CSV で使う)
export const CHECK_FIELD = {
  name: '商号又は名称',
  work: '工事の内容',
  period: '工期',
  engineer: '技術者の氏名',
  'engineer.qualification': '技術者の資格',
  'prime.engineer.role': '元請けの技術者(監理技術者か)',
  'prime.licenseType': '元請けの許可の種類',
  'project.workType': '工事の種類',
  'subcontractors.amount': '下請けの請負代金の額',
  'engineer.dedicated': '技術者の専任',
};
export const fieldLabel = (f) => CHECK_FIELD[f] ?? String(f ?? '');

// 台帳の点検の結果(F05b)。warnings は台帳の文を読んだときの注意(読めなかった行など)
// 候補に付けた「確かめること」(台帳からは決められない例外)
const confirmList = (list) => (Array.isArray(list) && list.length ? '<p class="confirm-title">確かめること:</p><ul class="confirm">' + list.map((x) => '<li>' + esc(x) + '</li>').join('') + '</ul>' : '');
export function renderCheckResult(out, warnings = []) {
  const cands = out.candidates ?? [];
  const und = out.undecidable ?? [];
  const candHtml = cands.length
    ? '<h3>抜け・食い違いの候補(' + cands.length + '件)</h3><ul class="candidates">' + cands.map((c) => '<li class="candidate"><h4>' + esc(c.target) + ' — ' + esc(fieldLabel(c.field)) + '</h4><p>' + esc(c.message) + '</p>' + confirmList(c.confirm) + basisList(c.basis) + '</li>').join('') + '</ul>'
    : '<h3>抜け・食い違いの候補</h3><p>入力の範囲では、候補は出ませんでした(このツールが点検しない記載事項や例外はあります)。</p>';
  const undHtml = und.length
    ? '<h3>判断できない(' + und.length + '件)</h3><ul class="undecidable">' + und.map((u) => '<li><h4>' + esc(u.target) + ' — ' + esc(fieldLabel(u.field)) + '</h4><p>' + esc(u.message) + '</p>' + basisList(u.basis ?? []) + '</li>').join('') + '</ul>'
    : '';
  const warnHtml = warnings.length
    ? '<details class="warnings" open><summary>台帳の文を読んだときの注意(' + warnings.length + '件)</summary><ul>' + warnings.map((w) => '<li>' + esc(w) + '</li>').join('') + '</ul></details>'
    : '';
  const notes = (out.notes ?? []).length ? '<ul class="notes">' + out.notes.map((n) => '<li>' + esc(n) + '</li>').join('') + '</ul>' : '';
  return warnHtml + candHtml + undHtml + notes
    + '<p class="human">指摘の候補です。台帳が正しいかの最後の判断は、契約書・下請けの書類などを確かめたうえで人がしてください</p>';
}

// 台帳の Excel の読み込み(F04c): 読めた欄と、読めない欄(欄ごとに理由)
export const XLSX_CAUSE = { not_found: '欄が無い', empty: '値が無い', invalid: '値を読めない' };
const XLSX_VALUE = (ledger, key) => key.split('.').reduce((o, k) => (o == null ? o : o[k]), ledger);
export function renderXlsxResult(r, fieldNames = {}) {
  const read = Object.entries(r.found ?? {}).filter(([k]) => !(r.unreadable ?? []).some((u) => u.key === k));
  const readHtml = read.length
    ? '<h4>読めた欄(' + read.length + ')</h4><table><thead><tr><th>欄</th><th>セル</th><th>値</th></tr></thead><tbody>'
      + read.map(([k, f]) => '<tr><td>' + esc(fieldNames[k] ?? k) + '</td><td>' + esc(f.value) + '</td><td>' + esc(XLSX_VALUE(r.ledger, k)) + '</td></tr>').join('') + '</tbody></table>'
    : '<h4>読めた欄</h4><p>ありません。</p>';
  const un = r.unreadable ?? [];
  const unHtml = un.length
    ? '<h4>読めない欄(' + un.length + ')</h4><ul class="unreadable">' + un.map((u) => '<li><strong>' + esc(u.field) + '</strong>(' + esc(XLSX_CAUSE[u.cause] ?? u.cause) + '): ' + esc(u.reason) + (u.raw ? '<br>書いてあった文字: ' + esc(u.raw) : '') + '</li>').join('') + '</ul>'
    : '<h4>読めない欄</h4><p>ありません。</p>';
  return readHtml + unHtml + '<p class="human">読めない欄は推測で埋めていません。下の「施工体制台帳の文」の欄で、空の行に書き足してから「台帳を点検する」を押してください</p>';
}

// Claude の指摘(F12a)。法令の決まりで判定した結果とは別の欄に、1件ずつ「AI の候補」と付けて出す
export function renderAiCandidates(list = [], warnings = []) {
  const warnHtml = warnings.length ? '<ul class="warnings">' + warnings.map((w) => '<li>' + esc(w) + '</li>').join('') + '</ul>' : '';
  const body = list.length
    ? '<ul class="ai-candidates">' + list.map((c) => '<li class="ai-candidate"><span class="ai-label">[' + esc(c.label || 'AI の候補') + ']</span> '
      + (c.file ? '<span class="ai-file">' + esc(c.file) + ':</span> ' : '') + esc(c.message) + '<p class="ai-basis">根拠(AI が挙げたもの。原文で確かめていません): ' + esc(c.basis) + '</p></li>').join('') + '</ul>'
    : '<p>AI の候補はありません。</p>';
  return '<h3>AI の候補(' + list.length + '件)</h3>' + warnHtml + body
    + '<p class="human">AI の候補です。法令の決まりで判定した結果ではありません。根拠の条も AI が挙げたもので、このツールは原文と照らしていません。最後の判断は人がしてください</p>';
}

// 段取りの一覧(F06a・F06b)。rows は buildSchedule の行、detail は buildScheduleDetail の skipped・notes(無くてよい)
export const SCHEDULE_STATUS = { applies: '行う', needs_check: '確かめる' };
export const SCHEDULE_PHASE = { start: '着手まで', work: '施工中', completion: '完成・引き渡し' };
export function renderSchedule(rows = [], detail = {}) {
  const notes = (detail.notes ?? []).length ? '<ul class="notes">' + detail.notes.map((n) => '<li>' + esc(n) + '</li>').join('') + '</ul>' : '';
  const phases = [...new Set(rows.map((r) => r.phase))];
  const sectionText = (b) => (esc(b.section) + ' ' + esc(b.sectionTitle ?? '')).trim();
  // 表の中には折りたたみを入れない(F14c)。表の「根拠」の列は箇所の名前だけにし、原文の抜き書きは表の下の折りたたみにまとめる
  const tables = phases.map((ph) => {
    const list = rows.filter((r) => r.phase === ph);
    const quotes = [...new Map(list.map((r) => [r.basis.section + '|' + r.basis.quote, r.basis])).values()];
    return '<h4>' + esc(SCHEDULE_PHASE[ph] ?? ph) + '(' + list.length + '件)</h4>'
      + '<table class="schedule"><thead><tr><th>いつ</th><th>何を</th><th>誰に</th><th>状態</th><th>根拠(共通仕様書の箇所)</th></tr></thead><tbody>'
      + list.map((r) => '<tr class="schedule-row"><td>' + esc(r.when) + '</td><td>' + esc(r.what)
        + (r.note ? '<p class="note">' + esc(r.note) + '</p>' : '')
        + (r.checks?.length ? '<ul class="checks">' + r.checks.map((c) => '<li>' + esc(c) + '</li>').join('') + '</ul>' : '')
        + '</td><td>' + esc(r.to) + '</td><td>' + esc(SCHEDULE_STATUS[r.status] ?? r.status ?? '') + '</td><td>' + sectionText(r.basis) + '</td></tr>').join('')
      + '</tbody></table>'
      + '<details class="basis schedule-basis"><summary>根拠: 共通仕様書の原文(' + esc(SCHEDULE_PHASE[ph] ?? ph) + '・' + quotes.length + '件)</summary><ul>'
      + quotes.map((b) => '<li><strong>' + sectionText(b) + '</strong>(' + esc(b.doc) + '、取得日 ' + esc(b.fetchedAt) + ')<blockquote>' + esc(b.quote) + '</blockquote></li>').join('')
      + '</ul></details>';
  }).join('');
  // 結論(何件あるか・段ごとの件数)は閉じずに出し、表は「受注後の段取り(○件)」の折りたたみに入れる
  const lead = rows.length
    ? '<p class="schedule-lead"><strong>受注後の段取りは ' + rows.length + '件です</strong>(' + phases.map((ph) => esc(SCHEDULE_PHASE[ph] ?? ph) + ' ' + rows.filter((r) => r.phase === ph).length + '件').join('・') + ')。表は下の「受注後の段取り」を開くと見られます。</p>'
    : '';
  const body = rows.length
    ? '<details class="schedule-table"><summary>受注後の段取り(' + rows.length + '件)</summary>' + tables + '</details>'
    : '<p>入れた条件では、出す段取りの行がありません。</p>';
  const skipped = (detail.skipped ?? []).length
    ? '<details class="skipped"><summary>条件に合わないので出していない行(' + detail.skipped.length + '件)</summary><ul>' + detail.skipped.map((s) => '<li>' + esc(s.what) + ' — ' + esc(s.reason) + '</li>').join('') + '</ul></details>'
    : '';
  return lead + notes + body + skipped
    + '<p class="human">国の直轄の例です。期日・相手・提出の方法は、特記仕様書・契約書と監督職員の指示で確かめてください</p>';
}

// 施工計画書の目次の点検(F07)。抜けの候補を、根拠(共通仕様書の箇所・ページ・原文)つきで出す
export function renderPlanResult(out = {}) {
  const cands = out.candidates ?? [];
  const found = out.found ?? [];
  const extra = out.extra ?? [];
  const undecidable = out.undecidable ?? [];
  const pageText = (b) => (b.page ? ' PDF ' + b.page + 'ページ' : '') + (b.printedPage ? '(紙面 ' + b.printedPage + ')' : '');
  const candHtml = undecidable.length
    ? '<h3>判断できない(' + undecidable.length + '件)</h3><ul class="undecidable">' + undecidable.map((u) => '<li>' + esc(u.message) + '</li>').join('') + '</ul>'
    : cands.length
    ? '<h3>記載項目の抜けの候補(' + cands.length + '件)</h3><ul class="candidates">' + cands.map((c) => '<li class="candidate"><h4>' + esc(c.item) + '</h4>'
      + (c.message ? '<p>' + esc(c.message) + '</p>' : '')
      + '<details class="basis"><summary>根拠: ' + esc(c.basis.section) + ' ' + esc(c.basis.sectionTitle ?? '') + esc(pageText(c.basis)) + '</summary><p>' + esc(c.basis.doc) + (c.basis.fetchedAt ? '(取得日 ' + esc(c.basis.fetchedAt) + ')' : '') + '</p><blockquote>' + esc(c.basis.quote) + '</blockquote></details></li>').join('') + '</ul>'
    : '<h3>記載項目の抜けの候補</h3><p>目次の見出しでは、国の直轄の土木の共通仕様書 1-1-1-6 の記載項目はすべて見つかりました(中身が足りているかは見ていません)。</p>';
  const foundHtml = found.length
    ? '<details class="found"><summary>目次で見つけた記載項目(' + found.length + '件)</summary><ul>' + found.map((f) => '<li>(' + esc(f.no) + ')' + esc(f.item) + ' — 目次の行「' + esc(f.line) + '」' + (f.byAlias ? '(書き方が違う)' : '') + '</li>').join('') + '</ul></details>'
    : '';
  const extraHtml = extra.length
    ? '<details class="extra"><summary>記載項目に当たらなかった目次の行(' + extra.length + '件)</summary><ul>' + extra.map((l) => '<li>' + esc(l) + '</li>').join('') + '</ul></details>'
    : '';
  const notes = (out.notes ?? []).length ? '<ul class="notes">' + out.notes.map((n) => '<li>' + esc(n) + '</li>').join('') + '</ul>' : '';
  return candHtml + foundHtml + extraHtml + notes
    + '<p class="human">抜けの候補です。施工計画書が足りているかの最後の判断は、特記仕様書と監督職員の指示を確かめたうえで人がしてください</p>';
}

// まとめの枠(F14b): 結果の一番上に、結論(要る・確認が要る・要らない の件数と一覧)、台帳の候補の数、目次の抜けの数、入れた条件を出す。
// 各行から、ページの中のリンクで詳しい結果へ移る。state は app.mjs が持つ最後の結果(無い所は「まだ出していません」)
//   state = { values: 欄の値, errors: [文], bid, taicho, scheduleCount, check, plan, stale }
export const SUMMARY_FIELDS = [
  ['orderer', '発注者', { public: '公共', private: '民間' }],
  ['direct', '元請けか下請けか', (values) => (readDirect(values) === true ? '元請け(発注者から直接請け負う)' : readDirect(values) === false ? '下請け' : '選んでいません')],
  ['work-type', '工事の種類', { 'kenchiku-ikkatsu': '建築一式工事', other: 'それ以外の工事' }],
  ['contract-amount', '請負代金の見込み(税込み)', null],
  ['subcontract-total', '下請けの総額(税込み)', null],
  ['license', '元請けの許可の種類', { tokutei: '特定建設業', ippan: '一般建設業' }],
  ['engineer-qualification', '置ける技術者の資格', { kanri: '監理技術者', shunin: '主任技術者' }],
  ['ict-measure', '台帳を発注者が閲覧できる措置(公共)', { true: '講じる', false: '講じない' }],
];
function summaryValue(raw, map, values) {
  if (typeof map === 'function') return map(values);
  if (map) {
    const v = map[String(raw)];
    return v ?? '選んでいません';
  }
  const s = String(raw ?? '').trim();
  return s === '' ? '入れていません' : s + (/円$/.test(s) ? '' : ' 円');
}
const NOT_YET = (btn) => '<span class="not-yet">まだ出していません(「' + esc(btn) + '」を押すと出ます)</span>';
export function renderSummary(state = {}) {
  const parts = [];
  if (state.stale) parts.push('<p class="summary-stale">条件が変わりました。下の数は前の条件の結果です。もう一度「確認する」を押してください。</p>');
  // 結論: 入札前の確認の項目
  if (state.errors && state.errors.length) {
    parts.push('<p class="summary-error">入力を読めませんでした。<a href="#bid-result">入札前の確認の欄</a>を見て直してください。</p>');
  } else if (state.bid) {
    const items = state.bid.items ?? [];
    const order = ['required', 'needs_check', 'not_required'];
    const count = (st) => items.filter((it) => it.status === st).length;
    parts.push('<h4>受注したら要るもの(' + items.length + '項目)</h4>'
      + '<ul class="summary-counts">' + order.map((st) => '<li>' + statusBadge(st) + ' <strong>' + count(st) + '</strong>件</li>').join('') + '</ul>'
      + '<ul class="summary-items">' + items.slice().sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status))
        .map((it) => '<li>' + statusBadge(it.status, it.value && ENGINEER[it.value] ? '(' + ENGINEER[it.value] + ')' : '') + ' <a href="#' + esc(bidItemId(it.key)) + '">' + esc(it.label) + '</a></li>').join('') + '</ul>'
      + ((state.bid.checks ?? []).length ? '<p><a href="#bid-result">確認が要る点 ' + state.bid.checks.length + '件</a>を入札前の確認の欄に出しています。</p>' : ''));
  } else {
    parts.push('<h4>受注したら要るもの</h4><p>' + NOT_YET('確認する') + '</p>');
  }
  // 数で見せるもの: 台帳が要るか・段取り・台帳の点検・目次の点検
  const rows = [];
  if (state.taicho) rows.push(['施工体制台帳が要るか', esc(TAICHO_STATUS[state.taicho.status] ?? state.taicho.status), 'taicho-result']);
  if (typeof state.scheduleCount === 'number') rows.push(['受注後の段取り', state.scheduleCount + '件', 'schedule-result']);
  if (state.check) {
    const c = (state.check.candidates ?? []).length;
    const u = (state.check.undecidable ?? []).length;
    rows.push(['施工体制台帳の点検', '抜け・食い違いの候補 <strong>' + c + '</strong>件' + (u ? '、判断できない ' + u + '件' : ''), 'check-result']);
  } else rows.push(['施工体制台帳の点検', NOT_YET('台帳を点検する'), 'check-result']);
  if (state.plan) {
    const und = (state.plan.undecidable ?? []).length;
    rows.push(['施工計画書の目次の点検', und ? '判断できない ' + und + '件' : '記載項目の抜けの候補 <strong>' + (state.plan.candidates ?? []).length + '</strong>件', 'plan-result']);
  } else rows.push(['施工計画書の目次の点検', NOT_YET('目次を点検する'), 'plan-result']);
  parts.push('<h4>書類と段取り</h4><table class="summary-table"><tbody>'
    + rows.map(([k, v, id]) => '<tr><th scope="row"><a href="#' + esc(id) + '">' + esc(k) + '</a></th><td>' + v + '</td></tr>').join('') + '</tbody></table>');
  // 入れた条件(項目名と値の一覧)
  const values = state.values ?? {};
  parts.push('<h4>入れた条件</h4><dl class="summary-list">'
    + SUMMARY_FIELDS.map(([id, name, map]) => '<div class="summary-row"><dt>' + esc(name) + '</dt><dd>' + esc(summaryValue(values[id], map, values)) + '</dd></div>').join('') + '</dl>');
  return '<h3 id="summary-title">まとめ</h3>' + parts.join('')
    + '<p class="human">まとめは下の各結果の数を並べたものです。中身と根拠の条は、リンク先の各結果で確かめてください。</p>';
}

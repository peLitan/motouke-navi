// 判定の結果を画面の HTML にする(F05a)。DOM には触らず、文字列を返す。
// 結果の文字はすべてエスケープする(規則表や入力の文字がそのまま HTML にならないように)。
import { readDirect } from './form.mjs';
import { CHECKLIST_REFERENCE, CHECKLIST_LAW, CHECKLIST_ITEMS } from '../checklist.mjs';
import { sourceVersion, versionText } from '../source-version.mjs';
import { displayStatus, itemConditions, contactsFor, openItems, unansweredQuestions, CONTACTS, answerState } from './answers.mjs';

export function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// 表は横に動かせる枠に入れる(F14e)。狭い画面(幅320〜400px)でもページ全体は横に動かず、表だけがこの枠の中で横に動く。
// キーボードでも動かせるように tabindex を付け、枠の名前(aria-label)を付ける
export function scrollTable(label, tableHtml) {
  return '<div class="table-scroll" role="region" tabindex="0" aria-label="' + esc(label) + '">' + tableHtml + '</div>';
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
    + list.map((b) => '<li><strong>' + esc(basisLabel(b)) + '</strong>(' + esc(versionText(b)) + ')<blockquote>' + esc(b.quote) + '</blockquote></li>').join('')
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

export const BID_STATUS = { required: '要る', not_required: '要らない', needs_check: '確認が要る', unanswered: '未回答' };
// 結論の印(F14b): 色だけで区別しないよう、記号と言葉を必ず添える(要る=✕と赤系、確認が要る=!と黄系、要らない=✓と緑系、未回答=?と灰色。F14f)
export const STATUS_MARK = { required: '✕', needs_check: '!', not_required: '✓', unanswered: '?' };
export function statusBadge(status, extra = '') {
  const word = BID_STATUS[status] ?? String(status ?? '');
  const mark = STATUS_MARK[status];
  return '<span class="badge badge-' + esc(status) + '">' + (mark ? '<span class="mark" aria-hidden="true">' + esc(mark) + '</span> ' : '') + esc(word + extra) + '</span>';
}
// 結果の項目へのページの中のリンクの行き先(まとめの枠から移る)
export const bidItemId = (key) => 'bid-item-' + String(key ?? '').replace(/[^\w-]/g, '_');
export const ENGINEER = { kanri: '監理技術者', shunin: '主任技術者' };

// 入札前の確認(bidCheck の返り値)。values(画面の欄の値)を渡すと、答えの状態(F14f)を使う:
//   各項目は 結論 → 理由(入れた条件)→ 根拠の条 → 確かめ先 の順。未回答の質問が残るうちは「仮の一覧」と出す。
//   values が無いときは、判定の状態をそのまま出す(入れた条件は出さない)
export function renderBidResult(bid, values) {
  const st = (it) => (values ? displayStatus(it, values) : it.status);
  const rows = bid.items.map((it) => {
    const s = st(it);
    const value = it.value && ENGINEER[it.value] ? '(' + ENGINEER[it.value] + ')' : '';
    const conds = values ? itemConditions(it, values) : [];
    const condHtml = conds.length
      ? '<p class="conditions"><span class="part">入れた条件:</span> ' + conds.map((c) => esc(c.name) + ' <span class="ans ans-' + esc(c.state) + '">' + esc(c.text) + '</span>').join('、') + '</p>'
      : '';
    const unansweredNote = s === 'unanswered'
      ? '<p class="unanswered-note">未回答の質問(' + esc(conds.filter((c) => c.state === 'unanswered').map((c) => c.name).join('・')) + ')に答えると、決まることがあります。</p>'
      : '';
    let contactHtml = '';
    if (s !== 'not_required') {
      const cs = contactsFor(it, values ?? {});
      contactHtml = cs.length
        ? '<p class="contact"><span class="part">確かめ先:</span> ' + cs.map((c) => '<strong>' + esc(c.to) + '</strong> — ' + esc(c.what) + '(' + esc(c.law) + 'の原文による)').join(' / ') + '</p>'
        : CONTACTS[it.key] && answerState(values ?? {}, 'orderer') !== 'answered'
          ? '<p class="contact"><span class="part">確かめ先:</span> 発注者が公共か民間かで根拠の条が変わるので、「発注者」に答えると出します。</p>'
          : '<p class="contact"><span class="part">確かめ先:</span> 根拠の原文に相手の定めが無いので、出していません。</p>';
    }
    return '<li class="item status-' + esc(s) + '" id="' + esc(bidItemId(it.key)) + '"><h4>' + esc(it.label) + ': <span class="status">' + (STATUS_MARK[s] ? statusBadge(s, value) : esc((BID_STATUS[s] ?? s) + value)) + '</span></h4>'
      + '<p class="reason"><span class="part">理由:</span> ' + esc(it.note) + '</p>' + condHtml + unansweredNote
      + basisList(it.basis) + exceptionList(it.exceptions) + contactHtml + '</li>';
  }).join('');
  const checks = bid.checks.length
    ? '<h3>確認が要る点(' + bid.checks.length + '件)</h3><ul class="checks">' + bid.checks.map((c) => '<li><strong>' + esc(c.label) + '</strong>: ' + esc(c.message) + '</li>').join('') + '</ul>'
    : '<h3>確認が要る点</h3><p>入力の範囲では、確認が要る点は出ませんでした(入力していない条件や、このツールが判定しない例外はあります)。</p>';
  const un = values ? unansweredQuestions(values) : [];
  const provisional = un.length
    ? '<p class="provisional"><strong>仮の一覧です</strong>。未回答の質問が ' + un.length + 'つあります(' + esc(un.map((q) => q.name).join('・')) + ')。答えるか「分からない」を選んでから、もう一度「確認する」を押してください。</p>'
    : '';
  return provisional + '<h3>受注したら要るもの' + (un.length ? '(仮の一覧)' : '') + '</h3><ul class="items">' + rows + '</ul>' + checks + amountBasisBlock(bid.amountBasis)
    + '<p class="human">' + esc(bid.disclaimer) + '</p>';
}

// 結果の最後の一覧(F14f): 「確認が要る項目」と「未回答」。印刷にも出す
export function renderOpenItems(bid, values = {}) {
  const o = openItems(bid, values);
  const need = o.needsCheck.length
    ? '<ul class="open-checks">' + o.needsCheck.map((c) => '<li><strong>' + esc(c.label) + '</strong>: ' + esc(c.message) + '</li>').join('') + '</ul>'
    : '<p>ありません(入れた条件の範囲で。このツールが見ていない法令・資料の確認は別に要ります)。</p>';
  const known = o.unknown.length
    ? '<p>「分からない」を選んだ質問: ' + o.unknown.map((q) => esc(q.name) + (q.items.length ? '(使う項目: ' + esc(q.items.join('・')) + ')' : '')).join('、') + '。この質問を使う項目は「確認が要る」にしています。</p>'
    : '';
  const un = o.unanswered.length
    ? '<ul class="open-unanswered">' + o.unanswered.map((q) => '<li><strong>' + esc(q.name) + '</strong>' + (q.items.length ? ' — この質問に答えると決まることがある項目: ' + esc(q.items.join('・')) : '') + '</li>').join('') + '</ul>'
    : '<p>ありません。</p>';
  return '<h3 id="open-items-title">確認が要る項目と未回答の質問</h3>'
    + '<h4>確認が要る項目(' + o.needsCheck.length + '件)</h4>' + need + known
    + '<h4>未回答(' + o.unanswered.length + '問)</h4>' + un;
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
  'project.ordererType': '発注者(公共か民間か)',
  'cross.subs': '書類どうしの下請負人の一覧',
  'cross.engineer': '書類どうしの技術者の氏名',
  'cross.orderer': '書類どうしの発注者の名前',
};
// 記載事項の表から足した候補(F29b)の field は 'checklist.<事項の id>'
export const fieldLabel = (f) => CHECK_FIELD[f] ?? CHECKLIST_ITEMS.find((it) => 'checklist.' + it.id === f)?.label ?? String(f ?? '');

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
    ? '<h4>読めた欄(' + read.length + ')</h4>' + scrollTable('読めた欄の表', '<table><thead><tr><th>欄</th><th>セル</th><th>値</th></tr></thead><tbody>'
      + read.map(([k, f]) => '<tr><td>' + esc(fieldNames[k] ?? k) + '</td><td>' + esc(f.value) + '</td><td>' + esc(XLSX_VALUE(r.ledger, k)) + '</td></tr>').join('') + '</tbody></table>')
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
// 「発注者の仕様書では」の書き込み(F37e)。行の id を鍵にする。id の無い読み込んだ行は 箇所|何を を鍵にする
export const SCHEDULE_NOTE_LABEL = '発注者の仕様書では';
export const SCHEDULE_NOTE_WARNING = '「' + SCHEDULE_NOTE_LABEL + '」の欄に書いたことは、ページを閉じると消えます。残すときは印刷か CSV で書き出してください。例や表を切り替えても、書いたことは残ります。書いた内容はこのツールは原文と照らしていません。';
export const scheduleNoteKey = (r) => r.id || r.basis.section + '|' + r.what;
// notes は 鍵 → 書いた文 の Map。画面のメモリ(app.mjs)にだけ持ち、ブラウザに保存しない
export function renderSchedule(rows = [], detail = {}, notes = new Map()) {
  const noteList = (detail.notes ?? []).length ? '<ul class="notes">' + detail.notes.map((n) => '<li>' + esc(n) + '</li>').join('') + '</ul>' : '';
  const phases = [...new Set(rows.map((r) => r.phase))];
  const sectionText = (b) => (esc(b.section) + ' ' + esc(b.sectionTitle ?? '')).trim();
  const docLabel = esc(detail.docLabel ?? '共通仕様書');
  // 列の名前は1か所で持ち、見出しと各 td の data-label を同じにする。狭い画面ではカードの項目名に data-label を使う(F37f)
  const cols = ['いつ', '何を', '誰に', '状態', '根拠(' + docLabel + 'の箇所)', SCHEDULE_NOTE_LABEL];
  const td = (i, inner) => '<td data-label="' + cols[i] + '">' + inner + '</td>';
  const noteOf = (r) => notes.get(scheduleNoteKey(r)) ?? '';
  const written = (r) => noteOf(r).trim() !== '';
  // textarea の直後の改行は HTML の読み取りで捨てられるので、書いた文の先頭の改行が消えないように1つ足す。
  // textarea は長い文が紙で切れるので、印刷には隣の .print-only の文を出す
  const noteCell = (r) => td(5, '<textarea class="schedule-note no-print" rows="2" autocomplete="off" placeholder="節・期限・メモ" aria-label="' + SCHEDULE_NOTE_LABEL + ': ' + esc(r.what) + '" data-note-key="' + esc(scheduleNoteKey(r)) + '">\n' + esc(noteOf(r)) + '</textarea>'
    + '<div class="print-only schedule-note-print">' + esc(noteOf(r)) + '</div>');
  // 今の一覧に行が無い書き込みは、消さずに持っているが紙と CSV には載らないので、そのことを出す
  const shownKeys = new Set(rows.map(scheduleNoteKey));
  const hiddenNotes = [...notes].filter(([k, v]) => !shownKeys.has(k) && v.trim() !== '').length;
  const hiddenLine = hiddenNotes ? '<p class="note no-print schedule-note-hidden">今の一覧に出ていない行の書き込みが ' + hiddenNotes + '件あります。消えてはいませんが、今の印刷と CSV には載りません。元の表や条件に戻すと出ます。</p>' : '';
  // 表の中には折りたたみを入れない(F14c)。表の「根拠」の列は箇所の名前だけにし、原文の抜き書きは表の下の折りたたみにまとめる
  // 区切りごとに畳める(F37f)。最初の区切りだけ開け、見出しに件数を出す。印刷では全部開く
  const tables = phases.map((ph, i) => {
    const list = rows.filter((r) => r.phase === ph);
    const quotes = [...new Map(list.map((r) => [r.basis.section + '|' + r.basis.quote, r.basis])).values()];
    // 書き込みのある区切りは、描き直しても閉じない(書いたことが見えなくならないように)
    return '<details class="schedule-phase"' + (i === 0 || list.some(written) ? ' open' : '') + '><summary><h4>' + esc(SCHEDULE_PHASE[ph] ?? ph) + '(' + list.length + '件)</h4></summary>'
      + scrollTable('段取りの表(' + (SCHEDULE_PHASE[ph] ?? ph) + ')', '<table class="schedule"><thead><tr>' + cols.map((c) => '<th>' + c + '</th>').join('') + '</tr></thead><tbody>'
      + list.map((r) => '<tr class="schedule-row">' + td(0, esc(r.when))
        + td(1, esc(r.what)
          + (r.note ? '<p class="note">' + esc(r.note) + '</p>' : '')
          + (r.checks?.length ? '<ul class="checks">' + r.checks.map((c) => '<li>' + esc(c) + '</li>').join('') + '</ul>' : ''))
        + td(2, esc(r.to)) + td(3, esc(SCHEDULE_STATUS[r.status] ?? r.status ?? '')) + td(4, sectionText(r.basis)) + noteCell(r) + '</tr>').join('')
      + '</tbody></table>')
      + '<details class="basis schedule-basis"><summary>根拠: ' + (detail.custom ? docLabel + 'の抜き書き' : '共通仕様書の原文') + '(' + esc(SCHEDULE_PHASE[ph] ?? ph) + '・' + quotes.length + '件)</summary><ul>'
      + quotes.map((b) => '<li><strong>' + sectionText(b) + '</strong>(' + esc(b.doc) + '、' + esc(versionText(b)) + ')<blockquote>' + esc(b.quote) + '</blockquote></li>').join('')
      + '</ul></details></details>';
  }).join('');
  // 結論(何件あるか・段ごとの件数)は閉じずに出し、表は「受注後の段取り(○件)」の折りたたみに入れる
  const lead = rows.length
    ? '<p class="schedule-lead"><strong>受注後の段取りは ' + rows.length + '件です</strong>(' + phases.map((ph) => esc(SCHEDULE_PHASE[ph] ?? ph) + ' ' + rows.filter((r) => r.phase === ph).length + '件').join('・') + ')。表は下の「受注後の段取り」を開くと見られます。</p>'
    : '';
  const body = rows.length
    ? '<details class="schedule-table"' + (rows.some(written) ? ' open' : '') + '><summary>受注後の段取り(' + rows.length + '件)</summary><p class="note no-print schedule-note-warning">' + esc(SCHEDULE_NOTE_WARNING) + '</p>' + tables + '</details>'
    : '<p>入れた条件では、出す段取りの行がありません。</p>';
  const skipped = (detail.skipped ?? []).length
    ? '<details class="skipped"><summary>条件に合わないので出していない行(' + detail.skipped.length + '件)</summary><ul>' + detail.skipped.map((s) => '<li>' + esc(s.what) + ' — ' + esc(s.reason) + '</li>').join('') + '</ul></details>'
    : '';
  return lead + hiddenLine + noteList + body + skipped
    + '<p class="human">' + (detail.custom ? docLabel + 'の行です' : '国の直轄の例です') + '。期日・相手・提出の方法は、特記仕様書・契約書と監督職員の指示で確かめてください</p>';
}

// 施工計画書の目次の点検(F07)。抜けの候補を、根拠(共通仕様書の箇所・ページ・原文)つきで出す
// 台帳の記載事項の表(F16c): 施行規則 第14条の2 第1項の事項ごとに 値/空/判断できない と「確認した」の欄を出す。
// 「確認した」は人が確かめた印で、合否ではない。チェックは画面のメモリ(app.mjs の Set)にだけ持ち、ブラウザに保存しない
export const CHECKLIST_NOTICE = 'チェックはこのツールの判定ではありません。確認した人と日付は印刷の版に書いてください';
export const CHECKLIST_SCOPE = 'この表は「記載事項に空がある」「台帳から判断できない」までを出します。台帳が法令に合っているか(適法か)は判定しません';
export const CHECKLIST_STATUS_CLASS = { value: 'cl-value', empty: 'cl-empty', unknown: 'cl-unknown' };
// チェックの欄の id(行の id の記号を _ にする)
export const checklistBoxId = (rowId) => 'cl-' + String(rowId ?? '').replace(/[^\w-]/g, '_');
// 国交省のチェックリスト(参考): 題名・URL・取得日だけ。文は写さない
export function checklistReferenceText(ref = CHECKLIST_REFERENCE) {
  return '参考: ' + ref.publisher + '「' + ref.title + '」(' + ref.url + '。掲載ページ「' + ref.pageTitle + '」' + ref.page + '。取得日 ' + ref.fetchedAt + ')。このツールはチェックリストの文を写しておらず、表の事項は施行規則 第14条の2 の原文から作っています';
}
export function renderChecklist(out = {}, checked = new Set()) {
  const rows = out.rows ?? [];
  const c = out.counts ?? { value: 0, empty: 0, unknown: 0 };
  const head = '<p class="checklist-notice"><strong>' + esc(CHECKLIST_NOTICE) + '</strong></p>'
    + '<p class="note">' + esc(CHECKLIST_SCOPE) + '</p>'
    + '<p class="checklist-counts">記載事項 ' + rows.length + '行: 値 ' + c.value + '・空 ' + c.empty + '・判断できない ' + c.unknown + '(確認した ' + rows.filter((r) => checked.has(r.id)).length + '行)</p>';
  if (!rows.length) return head + '<p>表にする事項がありません。</p>';
  const body = rows.map((r) => {
    const id = checklistBoxId(r.id);
    const on = checked.has(r.id);
    return '<tr class="' + (CHECKLIST_STATUS_CLASS[r.status] ?? '') + '" data-row-id="' + esc(r.id) + '">'
      + '<td class="cl-check"><input type="checkbox" class="checklist-check" id="' + esc(id) + '" data-row-id="' + esc(r.id) + '"' + (on ? ' checked' : '')
      + ' aria-label="' + esc(r.entity + ' ' + r.label + ' を確認した') + '"> <label for="' + esc(id) + '" class="cl-mark">' + (on ? '確認した' : '未確認') + '</label></td>'
      + '<td>' + esc(r.entity) + '</td><td>' + esc(r.label) + '</td><td class="cl-status">' + esc(r.statusLabel) + '</td>'
      + '<td>' + esc(r.value) + '</td><td>' + esc(r.reason) + '</td><td>' + esc(r.basis?.where ?? '') + '</td></tr>';
  }).join('');
  const inner = '<caption>施工体制台帳の記載事項(建設業法施行規則 第14条の2 第1項)</caption><thead><tr>'
    + ['確認した', '相手', '記載事項', '状態', '台帳の値(書いてあるまま)', '理由', '根拠の場所'].map((h) => '<th scope="col">' + h + '</th>').join('')
    + '</tr></thead><tbody>' + body + '</tbody>';
  // 根拠の原文は表の外に、事項ごとに1回だけ(表の中に折りたたみを入れない。F14c)
  const seen = new Map();
  for (const r of rows) if (r.basis && !seen.has(r.basis.quoteId)) seen.set(r.basis.quoteId, r.basis);
  const quotes = '<details class="basis checklist-basis"><summary>根拠: 建設業法施行規則 第14条の2 第1項の原文(' + seen.size + '件)</summary><p>' + esc(versionText({ fetchedAt: CHECKLIST_LAW.fetchedAt, version: sourceVersion(CHECKLIST_LAW) })) + '(e-Gov 法令 API)</p><ul>'
    + [...seen.values()].map((b) => '<li><strong>' + esc(b.where) + '</strong><blockquote>' + esc(b.quote) + '</blockquote></li>').join('') + '</ul></details>';
  const notes = (out.notes ?? []).length ? '<ul class="notes">' + out.notes.map((n) => '<li>' + esc(n) + '</li>').join('') + '</ul>' : '';
  return head + notes + scrollTable('施工体制台帳の記載事項の表', '<table class="checklist-table">' + inner + '</table>') + quotes;
}

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
      + '<details class="basis"><summary>根拠: ' + esc(c.basis.section) + ' ' + esc(c.basis.sectionTitle ?? '') + esc(pageText(c.basis)) + '</summary><p>' + esc(c.basis.doc) + '(' + esc(versionText(c.basis)) + ')' + '</p><blockquote>' + esc(c.basis.quote) + '</blockquote></details></li>').join('') + '</ul>'
    : '<h3>記載項目の抜けの候補</h3><p>目次の見出しでは、' + esc(out.scope ?? '国の直轄の土木の共通仕様書 1-1-1-6') + ' の記載項目はすべて見つかりました(中身が足りているかは見ていません)。</p>';
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
  ['direct', '元請けか下請けか', (values) => (values['direct-unknown'] === true ? '分からない' : readDirect(values) === true ? '元請け(発注者から直接請け負う)' : readDirect(values) === false ? '下請け' : '選んでいません')],
  ['work-type', '工事の種類', { 'kenchiku-ikkatsu': '建築一式工事', other: 'それ以外の工事' }],
  ['contract-amount', '請負代金の見込み(税込み)', null],
  ['subcontract-total', '下請けの総額(税込み)', null],
  ['license', '元請けの許可の種類', { tokutei: '特定建設業', ippan: '一般建設業' }],
  ['engineer-qualification', '置ける技術者の資格', { kanri: '監理技術者', shunin: '主任技術者' }],
  ['ict-measure', '台帳を発注者が閲覧できる措置(公共)', { true: '講じる', false: '講じない' }],
];
function summaryValue(raw, map, values, id) {
  if (typeof map === 'function') return map(values);
  if (raw === 'unknown' || values[id + '-unknown'] === true) return '分からない'; // F14f の「分からない」
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
    // 状態は 要る/確認が要る/未回答/要らない(F14f)。欄の値があれば、決められなかった項目のうち未回答の質問を使うものを「未回答」にする
    const vals = state.values ?? null;
    const dst = (it) => (vals ? displayStatus(it, vals) : it.status);
    const un = vals ? unansweredQuestions(vals) : [];
    const order = ['required', 'needs_check', 'unanswered', 'not_required'];
    const count = (st) => items.filter((it) => dst(it) === st).length;
    parts.push((un.length ? '<p class="provisional"><strong>仮の一覧です</strong>(未回答の質問 ' + un.length + 'つ)。<a href="#open-items">未回答の一覧</a>を見て、答えるか「分からない」を選んでください。</p>' : '')
      + '<h4>受注したら要るもの(' + items.length + '項目' + (un.length ? '・仮の一覧' : '') + ')</h4>'
      + '<ul class="summary-counts">' + order.filter((st) => st !== 'unanswered' || count(st) > 0).map((st) => '<li>' + statusBadge(st) + ' <strong>' + count(st) + '</strong>件</li>').join('') + '</ul>'
      + '<ul class="summary-items">' + items.slice().sort((a, b) => order.indexOf(dst(a)) - order.indexOf(dst(b)))
        .map((it) => '<li>' + statusBadge(dst(it), it.value && ENGINEER[it.value] ? '(' + ENGINEER[it.value] + ')' : '') + ' <a href="#' + esc(bidItemId(it.key)) + '">' + esc(it.label) + '</a></li>').join('') + '</ul>'
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
  parts.push('<h4>書類と段取り</h4>' + scrollTable('書類と段取りの表', '<table class="summary-table"><tbody>'
    + rows.map(([k, v, id]) => '<tr><th scope="row"><a href="#' + esc(id) + '">' + esc(k) + '</a></th><td>' + v + '</td></tr>').join('') + '</tbody></table>'));
  // 入れた条件(項目名と値の一覧)
  const values = state.values ?? {};
  parts.push('<h4>入れた条件</h4><dl class="summary-list">'
    + SUMMARY_FIELDS.map(([id, name, map]) => '<div class="summary-row"><dt>' + esc(name) + '</dt><dd>' + esc(summaryValue(values[id], map, values, id)) + '</dd></div>').join('') + '</dl>');
  return '<h3 id="summary-title">まとめ</h3>' + parts.join('')
    + '<p class="human">まとめは下の各結果の数を並べたものです。中身と根拠の条は、リンク先の各結果で確かめてください。</p>';
}

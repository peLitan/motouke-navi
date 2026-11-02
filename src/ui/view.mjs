// 判定の結果を画面の HTML にする(F05a)。DOM には触らず、文字列を返す。
// 結果の文字はすべてエスケープする(規則表や入力の文字がそのまま HTML にならないように)。

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
  if (!list.length) return '<p class="basis-none">根拠の条: 無し</p>';
  return '<details class="basis"><summary>根拠の条: ' + esc([...new Set(list.map(basisLabel))].join('、')) + '</summary><ul>'
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
export const ENGINEER = { kanri: '監理技術者', shunin: '主任技術者' };

// 入札前の確認(bidCheck の返り値)
export function renderBidResult(bid) {
  const rows = bid.items.map((it) => {
    const status = BID_STATUS[it.status] ?? it.status;
    const value = it.value && ENGINEER[it.value] ? '(' + ENGINEER[it.value] + ')' : '';
    return '<li class="item status-' + esc(it.status) + '"><h4>' + esc(it.label) + ': <span class="status">' + esc(status + value) + '</span></h4>'
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
};
export const fieldLabel = (f) => CHECK_FIELD[f] ?? String(f ?? '');

// 台帳の点検の結果(F05b)。warnings は台帳の文を読んだときの注意(読めなかった行など)
export function renderCheckResult(out, warnings = []) {
  const cands = out.candidates ?? [];
  const und = out.undecidable ?? [];
  const candHtml = cands.length
    ? '<h3>抜け・食い違いの候補(' + cands.length + '件)</h3><ul class="candidates">' + cands.map((c) => '<li class="candidate"><h4>' + esc(c.target) + ' — ' + esc(fieldLabel(c.field)) + '</h4><p>' + esc(c.message) + '</p>' + basisList(c.basis) + '</li>').join('') + '</ul>'
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

// 段取りの一覧(F06a)。rows は buildSchedule の行、detail は buildScheduleDetail の skipped・notes(無くてよい)
export const SCHEDULE_STATUS = { applies: '行う', needs_check: '確かめる' };
export const SCHEDULE_PHASE = { start: '着手まで' };
export function renderSchedule(rows = [], detail = {}) {
  const notes = (detail.notes ?? []).length ? '<ul class="notes">' + detail.notes.map((n) => '<li>' + esc(n) + '</li>').join('') + '</ul>' : '';
  const phases = [...new Set(rows.map((r) => r.phase))];
  const tables = phases.map((ph) => {
    const list = rows.filter((r) => r.phase === ph);
    return '<h3>' + esc(SCHEDULE_PHASE[ph] ?? ph) + '(' + list.length + '件)</h3>'
      + '<table class="schedule"><thead><tr><th>いつ</th><th>何を</th><th>誰に</th><th>状態</th><th>根拠(共通仕様書の箇所)</th></tr></thead><tbody>'
      + list.map((r) => '<tr class="schedule-row"><td>' + esc(r.when) + '</td><td>' + esc(r.what)
        + (r.note ? '<p class="note">' + esc(r.note) + '</p>' : '')
        + (r.checks?.length ? '<ul class="checks">' + r.checks.map((c) => '<li>' + esc(c) + '</li>').join('') + '</ul>' : '')
        + '</td><td>' + esc(r.to) + '</td><td>' + esc(SCHEDULE_STATUS[r.status] ?? r.status ?? '') + '</td><td>'
        + '<details class="basis"><summary>' + esc(r.basis.section) + ' ' + esc(r.basis.sectionTitle ?? '') + '</summary><p>' + esc(r.basis.doc) + '(取得日 ' + esc(r.basis.fetchedAt) + ')</p><blockquote>' + esc(r.basis.quote) + '</blockquote></details>'
        + '</td></tr>').join('')
      + '</tbody></table>';
  }).join('');
  const body = rows.length ? tables : '<p>入れた条件では、出す段取りの行がありません。</p>';
  const skipped = (detail.skipped ?? []).length
    ? '<details class="skipped"><summary>条件に合わないので出していない行(' + detail.skipped.length + '件)</summary><ul>' + detail.skipped.map((s) => '<li>' + esc(s.what) + ' — ' + esc(s.reason) + '</li>').join('') + '</ul></details>'
    : '';
  return notes + body + skipped
    + '<p class="human">国の直轄の例です。期日・相手・提出の方法は、特記仕様書・契約書と監督職員の指示で確かめてください</p>';
}

// 施工計画書の目次の点検(F07)。抜けの候補を、根拠(共通仕様書の箇所・ページ・原文)つきで出す
export function renderPlanResult(out = {}) {
  const cands = out.candidates ?? [];
  const found = out.found ?? [];
  const extra = out.extra ?? [];
  const pageText = (b) => (b.page ? ' PDF ' + b.page + 'ページ' : '') + (b.printedPage ? '(紙面 ' + b.printedPage + ')' : '');
  const candHtml = cands.length
    ? '<h3>記載項目の抜けの候補(' + cands.length + '件)</h3><ul class="candidates">' + cands.map((c) => '<li class="candidate"><h4>' + esc(c.item) + '</h4>'
      + (c.message ? '<p>' + esc(c.message) + '</p>' : '')
      + '<details class="basis"><summary>根拠: ' + esc(c.basis.section) + ' ' + esc(c.basis.sectionTitle ?? '') + esc(pageText(c.basis)) + '</summary><p>' + esc(c.basis.doc) + (c.basis.fetchedAt ? '(取得日 ' + esc(c.basis.fetchedAt) + ')' : '') + '</p><blockquote>' + esc(c.basis.quote) + '</blockquote></details></li>').join('') + '</ul>'
    : '<h3>記載項目の抜けの候補</h3><p>目次の見出しでは、共通仕様書 1-1-1-6 の記載項目はすべて見つかりました(中身が足りているかは見ていません)。</p>';
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

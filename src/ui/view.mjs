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

const BID_STATUS = { required: '要る', not_required: '要らない', needs_check: '確認が要る' };
const ENGINEER = { kanri: '監理技術者', shunin: '主任技術者' };

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

const TAICHO_STATUS = {
  required: '作る',
  not_required: '作らなくてよい',
  needs_check: '確認が要る(先に確かめることがある)',
  unknown: '判断できない(入力を足すか、確認が必要)',
};
const COPY_STATUS = {
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

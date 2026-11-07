// ページ送り(F86a)。要素はすべて静的な HTML にあり、ここでは hidden を付け外しするだけ。
// 画面の順はこの一覧だけで決める(DOM の順は紙の順のために変えない)。一覧の並びは [ページの id, 名前, 見出しの id]。
// 受け入れの最小の DOM では closest が使えないので、id の表だけで動く
export const PAGES = {
  1: [['pg-1', '条件を入れる', 'bid-title']],
  confirm: [['pg-confirm', '確かめ', 'confirm-title']],
  2: [['pg-2', '結果', 'result-title']],
  3: [['pg-3', '書類', 'ledger-title']],
  tools: [['pg-tools', '別の道具', 'tools-title']],
};
// 一覧の最後のページの右の席。席はどのページでも1つだけ見える
const LAST_SEAT = { 1: 'bid-run', confirm: 'confirm-go', 2: 'next-step-3', 3: 'entry-back', tools: 'entry-back' };
const SEATS = ['pg-next', ...new Set(Object.values(LAST_SEAT))];
// 一覧の1ページ目の「戻る」の行き先(group が null なら入口)。last は行き先の一覧の最後のページへ着く印
const BACK_OUT = { 1: { group: null }, confirm: { group: 1, last: true }, 2: { group: 'confirm' }, 3: { group: 2, last: true }, tools: { group: null } };

let at = { group: null, index: 0 };
const flip = (doc, id, on) => { const e = doc.getElementById(id); if (e) e.hidden = !on; };
const lastIndex = (group) => (PAGES[group]?.length ?? 1) - 1;

export const currentPage = () => ({ ...at });
export const seatOf = (group, index) => (index < lastIndex(group) ? 'pg-next' : LAST_SEAT[group]);
// 「戻る」の行き先。入口なら group が null
export function backTarget() {
  if (at.index > 0) return { group: at.group, index: at.index - 1 };
  const out = BACK_OUT[at.group] ?? { group: null };
  return { group: out.group, index: out.last ? lastIndex(out.group) : 0 };
}
function setSeats(doc, group, index) {
  const seat = seatOf(group, index);
  for (const id of SEATS) flip(doc, id, id === seat);
  const next = PAGES[group]?.[index + 1];
  const nextBtn = doc.getElementById('pg-next');
  if (nextBtn && next) nextBtn.textContent = '次へ: ' + next[1];
  // 確かめのページの左の席は #confirm-back(同じ席・同じ形)
  flip(doc, 'pg-back', group !== 'confirm');
  flip(doc, 'confirm-back', group === 'confirm');
}
// 見せるページを1つにする。頭へ戻し、見出しへ焦点を移す(焦点は押したボタンが隠れても消えない。画面は動かさない)
export function showPage(doc, group, index = 0) {
  for (const [g, list] of Object.entries(PAGES)) list.forEach(([id], i) => flip(doc, id, g === String(group) && i === index));
  at = { group, index };
  doc.body?.classList?.add?.('in-pages');
  flip(doc, 'pager', true);
  setSeats(doc, group, index);
  const page = PAGES[group]?.[index];
  const count = doc.getElementById('pg-count');
  if (count) count.textContent = (PAGES[group]?.length ?? 0) > 1 ? (index + 1) + '/' + PAGES[group].length + ' ' + page[1] : '';
  const el = page ? doc.getElementById(page[0]) : null;
  if (el) el.scrollTop = 0;
  if (page) doc.getElementById(page[2])?.focus?.({ preventScroll: true });
}
// 入口へ: 下の帯を隠し、ページを1ページ目の形に戻す(入口の折りたたみの別の道具が見えるように)
export function hidePages(doc) {
  for (const list of Object.values(PAGES)) list.forEach(([id], i) => flip(doc, id, i === 0));
  at = { group: null, index: 0 };
  doc.body?.classList?.remove?.('in-pages');
  flip(doc, 'pager', false);
  const count = doc.getElementById('pg-count');
  if (count) count.textContent = '';
}
// 同じ一覧の中を動く。端を越えるときは out を呼ぶ(一覧の外への行き先は画面の側が持つ)
export function pageStep(doc, step, out) {
  const index = at.index + step;
  if (index < 0 || index > lastIndex(at.group)) { out?.(); return; }
  showPage(doc, at.group, index);
}

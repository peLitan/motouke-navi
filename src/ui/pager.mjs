// ページ送り(F86a)。要素はすべて静的な HTML にあり、ここでは hidden を付け外しするだけ。
// 画面の順はこの一覧だけで決める(DOM の順は紙の順のために変えない)。一覧の並びは [ページの id, 名前, 見出しの id]。
// 受け入れの最小の DOM では closest が使えないので、id の表だけで動く
export const PAGES = {
  1: [['pg-1', '条件を入れる', 'bid-title']],
  confirm: [['pg-confirm', '確かめ', 'confirm-title']],
  2: [['pg-2', '結果', 'result-title']],
  3: [['pg-3', '書類', 'ledger-title']],
  tools: [['pg-tools', '別の道具', 'tools-title']],
  ref: [['pg-ref', '使った資料', 'ref-title']],
};
// 一覧の最後のページの右の席。席はどのページでも1つだけ見える
const LAST_SEAT = { 1: 'bid-run', confirm: 'confirm-go', 2: 'next-step-3', 3: 'entry-back', tools: 'entry-back', ref: 'entry-back' };
const SEATS = ['pg-next', ...new Set(Object.values(LAST_SEAT))];
// 一覧の1ページ目の「戻る」の行き先(group が null なら入口)。last は行き先の一覧の最後のページへ着く印
const BACK_OUT = { 1: { group: null }, confirm: { group: 1, last: true }, 2: { group: 'confirm' }, 3: { group: 2, last: true }, tools: { group: null } };

// 進み具合の印(F86b): 入口は step-0。確かめは条件の段に数える。別の道具と使った資料はどの段にも印を付けない
const STEP_OF = { 1: 1, confirm: 1, 2: 2, 3: 3 };
const STEPS = [0, 1, 2, 3];

let at = { group: null, index: 0 };
let cameFrom = { group: null, index: 0 }; // 使った資料の「戻る」の行き先
const flip = (doc, id, on) => { const e = doc.getElementById(id); if (e) e.hidden = !on; };
const lastIndex = (group) => (PAGES[group]?.length ?? 1) - 1;

function markStep(doc, n) {
  for (const i of STEPS) {
    const step = doc.getElementById('step-' + i);
    if (!step) continue;
    if (i === n) step.setAttribute('aria-current', 'step'); else step.removeAttribute('aria-current');
  }
}
// ページの数と名前は別の要素に分ける(幅 40rem 以下は名前を隠して数だけにする)
function setCount(doc, num, name) {
  const numEl = doc.getElementById('pg-num');
  if (numEl) numEl.textContent = num;
  const nameEl = doc.getElementById('pg-name');
  if (nameEl) nameEl.textContent = name;
}
export const currentPage = () => ({ ...at });
// 使った資料を開く前に呼ぶ。今のページを「戻る」の行き先として覚える
export const rememberCameFrom = () => { cameFrom = { ...at }; };
export const seatOf = (group, index) => (index < lastIndex(group) ? 'pg-next' : LAST_SEAT[group]);
// 「戻る」の行き先。入口なら group が null
export function backTarget() {
  if (at.group === 'ref') return { ...cameFrom };
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
  flip(doc, 'ref-open', group !== 'ref');
}
// 見せるページを1つにする。頭へ戻し、見出しへ焦点を移す(焦点は押したボタンが隠れても消えない。画面は動かさない)
export function showPage(doc, group, index = 0) {
  for (const [g, list] of Object.entries(PAGES)) list.forEach(([id], i) => flip(doc, id, g === String(group) && i === index));
  at = { group, index };
  doc.body?.classList?.add?.('in-pages');
  flip(doc, 'pager', true);
  setSeats(doc, group, index);
  const page = PAGES[group]?.[index];
  markStep(doc, STEP_OF[group]);
  if ((PAGES[group]?.length ?? 0) > 1) setCount(doc, (index + 1) + '/' + PAGES[group].length, page[1]);
  else setCount(doc, '', '');
  const el = page ? doc.getElementById(page[0]) : null;
  if (el) el.scrollTop = 0;
  if (page) doc.getElementById(page[2])?.focus?.({ preventScroll: true });
}
// 入口へ: 下の帯を隠し、ページを1ページ目の形に戻す
export function hidePages(doc) {
  for (const list of Object.values(PAGES)) list.forEach(([id], i) => flip(doc, id, i === 0));
  at = { group: null, index: 0 };
  doc.body?.classList?.remove?.('in-pages');
  flip(doc, 'pager', false);
  for (const id of SEATS) flip(doc, id, false);
  flip(doc, 'ref-open', true);
  markStep(doc, 0);
  setCount(doc, '', '');
}
// 同じ一覧の中を動く。端を越えるときは out を呼ぶ(一覧の外への行き先は画面の側が持つ)
export function pageStep(doc, step, out) {
  const index = at.index + step;
  if (index < 0 || index > lastIndex(at.group)) { out?.(); return; }
  showPage(doc, at.group, index);
}

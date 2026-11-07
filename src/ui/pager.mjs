// ページ送り(F86a)。要素はすべて静的な HTML にあり、ここでは hidden を付け外しするだけ。
// 画面の順はこの一覧だけで決める(DOM の順は紙の順のために変えない)。一覧の並びは [ページの id, 名前, 見出しの id]。
// 受け入れの最小の DOM では closest が使えないので、id の表だけで動く
export const PAGES = {
  // 条件の5ページは1つの form の中にある(F86g)
  1: [
    ['pg-1', '発注者と立場', 'who-title'],
    ['pg-1-work', '工事の種類', 'work-title'],
    ['pg-1-amount', '金額', 'amount-title'],
    ['pg-1-license', '許可と技術者', 'license-title'],
    ['pg-1-notice', '公告', 'notice-title'],
  ],
  confirm: [['pg-confirm', '確かめ', 'confirm-title']],
  // 確認が要る点は DOM では安全の後ろにあるが、画面では要るものの次
  2: [
    ['pg-2-top', '要点', 'result-title'],
    ['pg-2-need', '要るもの', 'need-title'],
    ['pg-2-open', '確認が要る点', 'open-title'],
    ['pg-2-schedule', '受注後の段取り', 'schedule-heading'],
    ['pg-2-safety', '安全の問い', 'safety-heading'],
    ['pg-2-candidates', '安全の候補', 'safety-result-title'],
    ['pg-2-save', '結果を残す', 'save-title'],
  ],
  // 書類の6ページ(F86h)
  3: [
    ['pg-3', '台帳を入れる', 'ledger-title'],
    ['pg-3-diagram', '施工体系図', 'diagram-title'],
    ['pg-3-check', '台帳の候補', 'check-title'],
    ['pg-3-table', '記載事項の表', 'checklist-title'],
    ['pg-3-plan', '目次を入れる', 'plan-title'],
    ['pg-3-plan-result', '目次の候補', 'plan-result-title'],
  ],
  // 別の道具の4ページ(F86i)
  tools: [
    ['pg-tools', '文を入れる', 'tools-title'],
    ['pg-tools-result', '置き換えた結果', 'mask-result-title'],
    ['pg-tools-unmask', '元に戻す', 'unmask-title'],
    ['pg-tools-ai', 'AI の候補', 'ai-title'],
  ],
  ref: [['pg-ref', '使った資料', 'ref-title']],
};
// 一覧の最後のページの右の席。席はどのページでも1つだけ見える
const LAST_SEAT = { 1: 'bid-run', confirm: 'confirm-go', 2: 'next-step-3', 3: 'entry-back', tools: 'entry-back', ref: 'entry-back' };
// 一覧の途中で主のボタンが右の席に出るページ。押すと動かして次のページへ進む(F86h・F86i)
const PAGE_SEAT = { 'pg-3-diagram': 'ledger-run', 'pg-3-plan': 'plan-run', 'pg-tools': 'mask-run' };
// 本文の主のボタンが塗りのページ。右の席は白地にする(F86e・F86i)
const PLAIN_SEAT = ['pg-2-top', 'pg-tools-unmask'];
const SEATS = ['pg-next', 'awarded-conditions', ...Object.values(PAGE_SEAT), ...new Set(Object.values(LAST_SEAT))];
// 一覧の1ページ目の「戻る」の行き先(group が null なら入口)。last は行き先の一覧の最後のページへ着く印
const BACK_OUT = { 1: { group: null }, confirm: { group: 1, last: true }, 2: { group: 'confirm' }, 3: { group: 2, last: true }, tools: { group: null } };
// そのページを開くと開く折りたたみ(F86d)。閉じて始まる形は保ち、開く見出しは画面で隠す
const OPEN_ON_SHOW = { 'pg-2-need': 'bid-fold', 'pg-2-safety': 'safety-fold' };
// リンクの行き先と欄の id → ページの表(F86d・F86e・F86g)。条件の欄は確かめの行の鍵でも引く。同じページの中で動くだけの id は載せない
const LINK_PAGE = {
  'pg-1': ['bid-form', 'orderer', 'role', 'direct'],
  'pg-1-work': ['work-type', 'work-kind'],
  'pg-1-amount': ['contract-amount', 'subcontract-total'],
  'pg-1-license': ['license', 'engineer-qualification', 'ict-measure'],
  'pg-1-notice': ['participation-conditions', 'intake-more', 'bid-run'],
  'pg-2-need': ['bid-fold', 'bid-result', 'taicho-result', 'bid-checks', 'labor-duties'],
  'pg-2-open': ['open-items'],
  'pg-2-schedule': ['schedule-heading', 'schedule-result'],
  'pg-2-safety': ['safety-heading', 'safety-fold', 'safety-questions', 'safety-q-subcontract', 'safety-q-workers', 'safety-q-plan', 'safety-q-works'],
  'pg-2-candidates': ['safety-result'],
  'pg-2-save': ['summary'],
  'pg-3': ['panel-3', 'ledger-file-status'],
  'pg-3-check': ['check-result'],
  'pg-3-table': ['checklist-result'],
  'pg-3-plan': ['plan-file-status'],
  'pg-3-plan-result': ['plan-result'],
  'pg-tools': ['dict-file-status'],
  'pg-tools-result': ['mask-status'],
  'pg-tools-unmask': ['map-status'],
  'pg-tools-ai': ['ai-status'],
};

// 段取りの全部の行(F86f): 結果の一覧を段取りの1ページだけにする。右の席は「条件を入れる」、「戻る」は入口
const SCHEDULE_ONLY = PAGES[2].filter(([id]) => id === 'pg-2-schedule');
let scheduleOnly = false;
export const setScheduleOnly = (on) => { scheduleOnly = on; };
const listOf = (group) => (group === 2 && scheduleOnly ? SCHEDULE_ONLY : PAGES[group]);

// 進み具合の印(F86b): 入口は step-0。確かめは条件の段に数える。別の道具と使った資料はどの段にも印を付けない
const STEP_OF = { 1: 1, confirm: 1, 2: 2, 3: 3 };
const STEPS = [0, 1, 2, 3];

let at = { group: null, index: 0 };
let cameFrom = { group: null, index: 0 }; // 使った資料の「戻る」の行き先
let jumpFrom = null; // リンクで飛んだ直後の「戻る」の行き先(F86e)。次にページを替えると忘れる
const flip = (doc, id, on) => { const e = doc.getElementById(id); if (e) e.hidden = !on; };
const lastIndex = (group) => (listOf(group)?.length ?? 1) - 1;

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
export const rememberCameFrom = () => { cameFrom = { ...at, jump: jumpFrom }; };
// リンクで飛んだあとに呼ぶ。飛ぶ前のページへ「戻る」で帰る
export const rememberJump = (page) => { jumpFrom = page; };
// リンクの行き先の id がどのページにあるか。表に無ければ null(段3 の中の id は段を開く側が持つ)
export function pageOfLink(id) {
  const pg = String(id).startsWith('bid-item-') ? 'pg-2-need' : Object.keys(LINK_PAGE).find((k) => LINK_PAGE[k].includes(id));
  if (!pg) return null;
  const [group] = Object.entries(PAGES).find(([, l]) => l.some(([p]) => p === pg));
  const key = PAGES[Number(group)] ? Number(group) : group; // 段は数、別の道具は名前
  const index = listOf(key).findIndex(([p]) => p === pg);
  return index < 0 ? null : { group: key, index };
}
export const seatOf = (group, index) => {
  const seat = PAGE_SEAT[listOf(group)?.[index]?.[0]];
  if (seat) return seat;
  if (index < lastIndex(group)) return 'pg-next';
  return group === 2 && scheduleOnly ? 'awarded-conditions' : LAST_SEAT[group];
};
// 「戻る」の行き先。入口なら group が null
export function backTarget() {
  if (jumpFrom) return { ...jumpFrom };
  if (at.group === 'ref') return { ...cameFrom };
  if (at.index > 0) return { group: at.group, index: at.index - 1 };
  const out = (at.group === 2 && scheduleOnly ? null : BACK_OUT[at.group]) ?? { group: null };
  return { group: out.group, index: out.last ? lastIndex(out.group) : 0 };
}
function setSeats(doc, group, index) {
  const seat = seatOf(group, index);
  for (const id of SEATS) flip(doc, id, id === seat);
  const next = listOf(group)?.[index + 1];
  const nextBtn = doc.getElementById('pg-next');
  if (nextBtn && next) nextBtn.textContent = '次へ: ' + next[1];
  // 確かめのページの左の席は #confirm-back(同じ席・同じ形)
  flip(doc, 'pg-back', group !== 'confirm');
  flip(doc, 'confirm-back', group === 'confirm');
  flip(doc, 'ref-open', group !== 'ref');
  // 要点のページの塗りは「次にすること」のボタンだけにする(F86e)。元に戻すのページも同じ(F86i)
  doc.getElementById('pager')?.classList?.toggle?.('seat-plain', PLAIN_SEAT.includes(listOf(group)?.[index]?.[0]));
}
// 見せるページを1つにする。頭へ戻し、見出しへ焦点を移す(焦点は押したボタンが隠れても消えない。画面は動かさない)
export function showPage(doc, group, index = 0) {
  const list = listOf(group);
  const page = list?.[index];
  for (const pages of Object.values(PAGES)) for (const [id] of pages) flip(doc, id, id === page?.[0]);
  at = { group, index };
  jumpFrom = null;
  doc.body?.classList?.add?.('in-pages');
  flip(doc, 'pager', true);
  setSeats(doc, group, index);
  markStep(doc, STEP_OF[group]);
  if ((list?.length ?? 0) > 1) setCount(doc, (index + 1) + '/' + list.length, page[1]);
  else setCount(doc, '', '');
  const el = page ? doc.getElementById(page[0]) : null;
  if (el) el.scrollTop = 0;
  const fold = OPEN_ON_SHOW[page?.[0]] ? doc.getElementById(OPEN_ON_SHOW[page[0]]) : null;
  if (fold) fold.open = true;
  if (page?.[0] === 'pg-2-schedule') openScheduleTable(doc);
  if (page) doc.getElementById(page[2])?.focus?.({ preventScroll: true });
}
// 段取りのページでは表がそのページの中身なので、開いて見せる(F87b)。紙と閉じて始まる形は今のまま
export function openScheduleTable(doc) {
  const table = doc.getElementById('schedule-result')?.querySelector?.('details.schedule-table');
  if (table) table.open = true;
}
// 入口へ: 下の帯を隠し、ページを1ページ目の形に戻す
export function hidePages(doc) {
  for (const list of Object.values(PAGES)) list.forEach(([id], i) => flip(doc, id, i === 0));
  at = { group: null, index: 0 };
  jumpFrom = null;
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
  if (index < 0 || index > lastIndex(at.group) || (step < 0 && jumpFrom)) { out?.(); return; }
  showPage(doc, at.group, index);
}

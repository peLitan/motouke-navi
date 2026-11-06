// 知らせの行の失敗の印(F58a)。文は呼ぶ側が決め、ここでは変えない。
// 書くたびに印を外すので、前の失敗の印が成功や空の文に残らない。失敗の文を書いた側が、そのあとで markFailed を呼ぶ
export function writeNotice(el, text) {
  if (!el) return;
  el.textContent = text;
  el.removeAttribute?.('data-kind');
}
export function markFailed(el) {
  el?.setAttribute?.('data-kind', 'error');
}

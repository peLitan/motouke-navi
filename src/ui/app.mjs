// 画面のつながり(F05a): 入力欄を読み、入札前の確認と施工体制台帳の判定を動かし、結果の欄に書く。
// build.mjs がこのファイルと部品を index.html の1つのスクリプトにまとめ、最後に startApp(document) を呼ぶ。
// 入れた内容はどこにも保存しない(ページを閉じれば消える)。
import { readBidForm, formErrors, BID_FORM_IDS, CHECKBOX_IDS } from './form.mjs';
import { renderBidResult, renderTaichoResult, renderErrors } from './view.mjs';
import { bidCheck } from '../bid-check.mjs';
import { judgeTaicho } from '../taicho.mjs';

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
  if (errors.length) {
    bidOut.innerHTML = renderErrors(errors);
    taichoOut.innerHTML = renderErrors(errors);
    return;
  }
  const input = readBidForm(values);
  try {
    bidOut.innerHTML = renderBidResult(bidCheck(input));
    taichoOut.innerHTML = renderTaichoResult(judgeTaicho(input));
  } catch (e) {
    const msg = renderErrors(['判定の途中で止まりました(規則表か抜き書きの誤りの可能性があります): ' + String(e && e.message ? e.message : e)]);
    bidOut.innerHTML = msg;
    taichoOut.innerHTML = msg;
  }
}

export function startApp(doc) {
  const start = () => {
    const btn = doc.getElementById('bid-run');
    if (btn) btn.addEventListener('click', (ev) => { if (ev && ev.preventDefault) ev.preventDefault(); runBid(doc); });
  };
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start);
  else start();
}

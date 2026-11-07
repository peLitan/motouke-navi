// 「要る」の項目のカードに出す「次にすること」の文(F83a3)。
// 文は判定の note にある語句だけで作り、期限・書類名・宛先・数字・括弧の根拠を足さない(根拠は折りたたみの中にある)。
// 語句だけでは動作の文にならない行(note が名詞で終わる行)は、語句に「があるかを確かめる」を続けて人が書く。
// 語句の決まりの例外は専任の1行だけ(F85g)。note の語句は判定の条件の言い方で、続けても読める文にならないので、項目の名前の語で書く(note は変えない)。
// 1つの key に枝がいくつかあるときは、どの枝でも本当の語句だけを使う(施工体系図の掲げる場所は公共と民間で違うので、共通の語句にした)。
// note を変えたら、ここの文も見直す(tests/unit/next-steps.test.mjs が枝を集めて照らす)。
export const NEXT_STEPS = {
  'tokutei-license': '特定建設業の許可があるかを確かめる',
  taicho: '施工体制台帳を作り、工事現場ごとに備え置く',
  'taicho-copy': '作った施工体制台帳の写しを発注者に出す',
  'engineer:kanri': '監理技術者を置く',
  'engineer:shunin': '主任技術者を置く',
  taikeizu: '施工体系図を作り、見やすい場所に掲げる',
  dedicated: '技術者を専任で置く必要があるかを確かめる',
};

// 表の引き方。監理技術者か主任技術者かは同じ項目の結論の値で分かれるので、key に値を続ける
export const stepKey = (it) => (it.value ? it.key + ':' + it.value : it.key);

// 項目の文。表に無い項目は null。例外は行ごとに書かず、節の頭の1行で知らせる(F85g。view.mjs の stepNote)
export function nextStepText(it) {
  const key = stepKey(it);
  return Object.hasOwn(NEXT_STEPS, key) ? NEXT_STEPS[key] : null;
}

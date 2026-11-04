// 見本の語を混ぜて見落としを測る(F28a)。
// 空港の手荷物検査で、検査の画面に偽の危険物の画像を時々混ぜ、見落とさずに見つけたかで検査の確かさを測るやり方
// (Threat Image Projection)から借りた。
// 置き換えのたびに、架空の人名・会社名・住所を数個(型は毎回選び直す)、利用者の文の後ろに見えない形で足してから、
// 置き換える所を探し、足した語が全部置き換える所に入ったかを数える。
// 探すのは masker.spans(対応表・記号の番号を変えない)だけで、利用者に見せる置き換え(masker.mask)とは別に行う。
// そのため、混ぜた語は後の欄・対応表・記号の番号に入らない。
// 見本の語はすべて架空(実在の人・会社・住所を使わない)。
// F31d: 見本には2つの組がある。見つけやすい型は、この道具が扱うと説明している形。見つけにくい型は、文脈の無い姓名・
// 番地の無い住所・表の中の名前など、規則の手がかりが少ない形。組ごとに数え、画面にも分けて出す。
// 見つけにくい型は、残って当たり前の形を含む。規則を足して通すための試験ではなく、漏れの目安を見せるためのもの。

// 架空の部品(実在の名前を避け、甲乙丙丁などの仮の字と「みほん」「ためし」を使う)
const SURNAMES = ['甲野', '乙川', '丙田', '丁原', '戊井', '己島', '庚山', '辛木'];
const GIVEN = ['一郎', '花子', '二郎', '三郎', '春子', '四郎', '夏子', '五郎'];
const STEMS = ['架空', '仮山', 'ミホン', 'タメシ', '見本野', '試作', 'カクウ', '仮野'];
const PREFS = ['東京都', '北海道', '大阪府', '京都府', '神奈川県', '愛知県', '福岡県', '宮城県'];
const CITIES = ['みほん市', 'ためし市', '架空市', '仮野市'];
const TOWNS = ['さくら町', 'もみじ町', 'ひばり町', 'すずらん町'];
const BUILDINGS = ['みほんビル', 'ためしハイツ', '架空マンション', 'コーポ仮野'];
const KANJI_NUM = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];

// 見つけにくい型の部品。見つけやすい型の語が文脈で見つかると、同じ語が「2か所目」として取れて結果が甘くなるので、
// 語を分ける(組の検査も別に行う)。利用者の文によく出る甲野・みほん市なども使わない
const HARD_SURNAMES = ['仮谷', '試村', '見本田', '癸村', '壬沢', '架川', '空井', '例山'];
const HARD_GIVEN = ['六郎', '七郎', '八郎', '九郎', '十郎', '秋子', '冬子', '桃子'];
const HARD_KANA_NAMES = ['オタメシ', 'ミホンヤ', 'カリノヤ', 'テスタ'];
const HARD_SHOPS = ['ためし堂', 'かりの屋', 'みほん亭', 'おためし舎'];
const HARD_STEMS = ['仮岡', '試原', '例島', '空沢'];
const HARD_CITIES = ['かりの市', 'ためしの市', 'おためし市', '架空野市'];
const HARD_TOWNS = ['かりの町', 'ほたる町', 'こだま町', 'つばめ町'];

// 型の表。id は画面に出す型の名前。make は (pick, n) から { line(混ぜる1行), word(置き換わるべき語) } を返す。
// 型は、この道具が扱うと説明している形(README・docs/manual.md)から選んだ
export const DECOY_TYPES = {
  person: [
    { id: '欄名の後ろ(担当者: 姓 名)', make: (p) => { const w = `${p(SURNAMES)} ${p(GIVEN)}`; return { line: `担当者: ${w}`, word: w }; } },
    { id: '敬称の前(姓 名 様)', make: (p) => { const w = `${p(SURNAMES)} ${p(GIVEN)}`; return { line: `${w} 様`, word: w }; } },
    { id: '役職の後ろ(部長 姓名)', make: (p) => { const w = `${p(SURNAMES)}${p(GIVEN)}`; return { line: `部長 ${w}`, word: w }; } },
    { id: '氏名の欄(氏名：姓 名)', make: (p) => { const w = `${p(SURNAMES)} ${p(GIVEN)}`; return { line: `氏名：${w}`, word: w }; } },
    { id: '括弧の役職(姓 名(課長))', make: (p) => { const w = `${p(SURNAMES)} ${p(GIVEN)}`; return { line: `${w}(課長)`, word: w }; } },
  ],
  company: [
    { id: '株式会社が前', make: (p) => { const w = `株式会社${p(STEMS)}`; return { line: `${w}に依頼した。`, word: w }; } },
    { id: '株式会社が後ろ', make: (p) => { const w = `${p(STEMS)}株式会社`; return { line: `${w}に依頼した。`, word: w }; } },
    { id: '囲み文字(㈱)', make: (p) => { const w = `㈱${p(STEMS)}`; return { line: `${w} 御中`, word: w }; } },
    { id: '括弧の略し方((有))', make: (p) => { const w = `(有)${p(STEMS)}`; return { line: `${w} 御中`, word: w }; } },
    { id: '一般社団法人', make: (p) => { const w = `一般社団法人${p(STEMS)}協会`; return { line: `${w}から届いた。`, word: w }; } },
    { id: '合同会社', make: (p) => { const w = `合同会社${p(STEMS)}`; return { line: `${w}と打ち合わせた。`, word: w }; } },
  ],
  address: [
    { id: '〒と郵便番号つき', make: (p, n) => { const w = `〒${n(100, 999)}-${n(1000, 9999)} ${p(PREFS)}${p(CITIES)}${p(TOWNS)}${n(1, 9)}-${n(1, 30)}-${n(1, 20)}`; return { line: w, word: w }; } },
    { id: '丁目・番地・号(漢数字)', make: (p, n) => { const w = `${p(PREFS)}${p(CITIES)}${p(TOWNS)}${p(KANJI_NUM)}丁目${n(1, 30)}番${n(1, 20)}号`; return { line: `所在地: ${w}`, word: w }; } },
    { id: '空白で区切る', make: (p, n) => { const w = `${p(PREFS)} ${p(CITIES)} ${p(TOWNS)} ${n(1, 9)}-${n(1, 30)}`; return { line: `住所 ${w}`, word: w }; } },
    { id: '建物名と部屋番号', make: (p, n) => { const w = `${p(PREFS)}${p(CITIES)}${p(TOWNS)}${n(1, 9)}-${n(1, 30)} ${p(BUILDINGS)} ${n(1, 9)}0${n(1, 9)}号室`; return { line: w, word: w }; } },
    { id: '都道府県を書かない', make: (p, n) => { const w = `${p(CITIES)}${p(TOWNS)}${n(1, 9)}丁目${n(1, 30)}番${n(1, 20)}号`; return { line: `現住所：${w}`, word: w }; } },
  ],
};
// 見つけにくい型。この表の中には、今の規則で取れる形(語尾が一覧にある社名、都道府県から書いた住所)も、取れない形もある。
// どれが取れるかは検査の結果で見る(型を選ぶときに、結果が良く見えるように絞らない)
export const DECOY_HARD_TYPES = {
  person: [
    { id: '文脈の無い姓名(姓 名だけの行)', make: (p) => { const w = `${p(HARD_SURNAMES)} ${p(HARD_GIVEN)}`; return { line: w, word: w }; } },
    { id: '文の中の姓名(敬称・役職なし)', make: (p) => { const w = `${p(HARD_SURNAMES)} ${p(HARD_GIVEN)}`; return { line: `本日は ${w} が立ち会った。`, word: w }; } },
    { id: '姓だけ', make: (p) => { const w = p(HARD_SURNAMES); return { line: `${w}が確認した。`, word: w }; } },
    { id: '表の中の名前(見出しの下の行)', make: (p) => { const w = `${p(HARD_SURNAMES)} ${p(HARD_GIVEN)}`; return { line: `| 氏名 | 職種 | 経験年数 |\n| ${w} | 土工 | 5年 |`, word: w }; } },
    { id: 'タブで区切った表の名前', make: (p) => { const w = `${p(HARD_SURNAMES)}${p(HARD_GIVEN)}`; return { line: `${w}\t土工\t5年`, word: w }; } },
  ],
  company: [
    { id: '法人格も語尾も無い社名', make: (p) => { const w = p(HARD_KANA_NAMES); return { line: `${w}に発注した。`, word: w }; } },
    { id: '表の中の法人格の無い社名', make: (p) => { const w = p(HARD_KANA_NAMES); return { line: `| ${w} | 一次 | 土工 |`, word: w }; } },
    { id: 'ひらがなの屋号', make: (p) => { const w = p(HARD_SHOPS); return { line: `${w}に依頼した。`, word: w }; } },
    { id: '表の中の語尾のある社名', make: (p) => { const w = `${p(HARD_STEMS)}商会`; return { line: `| ${w} | 一次 | 土工 |`, word: w }; } },
  ],
  address: [
    { id: '番地の無い住所(市と町だけ)', make: (p) => { const w = `${p(HARD_CITIES)}${p(HARD_TOWNS)}`; return { line: w, word: w }; } },
    { id: '町名だけ', make: (p) => { const w = p(HARD_TOWNS); return { line: `${w}に集合した。`, word: w }; } },
    { id: '表の中の番地の無い住所', make: (p) => { const w = `${p(HARD_CITIES)}${p(HARD_TOWNS)}`; return { line: `| ${w} | 道路 |`, word: w }; } },
    { id: '都道府県と市だけ', make: (p) => { const w = `${p(PREFS)}${p(HARD_CITIES)}`; return { line: w, word: w }; } },
    { id: '都道府県から書いた番地の無い住所', make: (p) => { const w = `${p(PREFS)}${p(HARD_CITIES)}${p(HARD_TOWNS)}`; return { line: `${w}で打ち合わせた。`, word: w }; } },
  ],
};
export const DECOY_LABELS = { person: '人名', company: '会社名', address: '住所' };
// 種類ごとに混ぜる数(合わせて6語)
export const DECOY_PER_KIND = 2;

// 見本を作る。rand は 0 以上 1 未満を返す関数(試験では決まった値を渡す)。
// 種類ごとに型を DECOY_PER_KIND 個、重ならないように選ぶ(毎回型が変わる)
export function makeDecoys(rand = Math.random) {
  const idx = (len) => Math.min(len - 1, Math.floor(rand() * len));
  return chooseDecoys(DECOY_TYPES, idx, (list) => list[idx(list.length)]);
}

// 見つけにくい型の見本を作る。組の中で同じ部品を使わない(同じ語が2か所目として取れるのを避ける)
export function makeHardDecoys(rand = Math.random) {
  const idx = (len) => Math.min(len - 1, Math.floor(rand() * len));
  const used = new Set();
  const pick = (list) => {
    const free = list.filter((w) => !used.has(w));
    const word = free[idx(free.length)];
    used.add(word);
    return word;
  };
  return chooseDecoys(DECOY_HARD_TYPES, idx, pick);
}

function chooseDecoys(table, idx, pick) {
  const num = (lo, hi) => lo + idx(hi - lo + 1);
  const out = [];
  for (const kind of Object.keys(table)) {
    const types = [...table[kind]];
    for (let i = 0; i < DECOY_PER_KIND && types.length; i++) {
      const t = types.splice(idx(types.length), 1)[0];
      const { line, word } = t.make(pick, num);
      out.push({ kind, label: DECOY_LABELS[kind], type: t.id, line, word });
    }
  }
  return out;
}

// 見本を文の後ろに混ぜて、置き換える所を探し、見本の語が全部置き換える所に入ったかを数える。
// masker は createMasker の戻り値(今の辞書・足した語のまま使う。対応表・記号の番号は変えない)。
// 2つの組は別々に探す(一方の組の文脈で見つけた語が、もう一方の組の語を取らないように)。
// 戻り値: { total, masked, missed: [{ kind, label, type, word }], hard: { total, masked, missed } }。
// total・masked・missed は見つけやすい型、hard は見つけにくい型。missed の語は架空なので画面に出してよい
export function checkDecoys(masker, text, { rand = Math.random, decoys = makeDecoys(rand), hardDecoys = makeHardDecoys(rand) } = {}) {
  return { ...checkGroup(masker, text, decoys), hard: checkGroup(masker, text, hardDecoys) };
}

function checkGroup(masker, text, decoys) {
  let combined = String(text ?? '');
  // 前の行とつながらないよう空の行で区切る。見本どうしも空の行で区切る
  const placed = decoys.map((d) => {
    combined += '\n\n';
    const lineStart = combined.length;
    combined += d.line;
    const start = lineStart + d.line.indexOf(d.word);
    return { ...d, start, end: start + d.word.length };
  });
  const spans = masker.spans(combined);
  // 語のすべての字(空白を除く)が、どれかの置き換える所に入っていれば置き換えたとみなす
  const covered = (d) => {
    for (let i = d.start; i < d.end; i++) {
      if (/[\s\u3000]/.test(combined[i])) continue;
      if (!spans.some((s) => s.start <= i && i < s.end)) return false;
    }
    return true;
  };
  const missed = placed.filter((d) => !covered(d)).map(({ kind, label, type, word }) => ({ kind, label, type, word }));
  return { total: placed.length, masked: placed.length - missed.length, missed };
}

// 結果を1つの文にする(画面とプラグインの道具で同じ文を使う)
export function decoyMessage(r) {
  const head = `確かめのための見本: 見つけやすい型 ${r.masked}/${r.total}・見つけにくい型 ${r.hard.masked}/${r.hard.total}(置き換えた数/混ぜた数。見本は架空の人名・会社名・住所で、見えない所で混ぜ、後の欄・対応表には入れていません)。`
    + '見つけにくい型の結果は漏れの目安で、保証ではありません。';
  let out = head;
  if (r.missed.length) {
    out += ` 注意: ${r.missed.length}語が残りました(${r.missed.map((m) => `${m.label}の型「${m.type}」の「${m.word}」`).join('、')})。`
      + '同じ形の語が文にあれば、置き換わらずに残っているおそれがあります。後の欄を見直し、残っていれば辞書に足してください。';
  }
  if (r.hard.missed.length) {
    out += ` 見つけにくい型で残った形: ${r.hard.missed.map((m) => `${m.label}「${m.type}」`).join('、')}。`
      + '同じ形の語が文にあれば、残っているおそれがあります。後の欄を目で確かめ、残っていれば辞書に足してください。';
  }
  return out;
}

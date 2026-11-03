// 現場名の語尾の規則(F17b): 辞書に無い現場名(場所の名前)を、語尾(その業界で場所の名前の終わりに付く語)から「現場名の候補」として見つける。
// この規則は分野の語を持たない。語尾の表・欄名・一般の語は、業界ごとのファイル(建設は src/mask/suffix-construction.mjs)から siteSuffixPatterns に渡す。
// 見つけた語は、置き換えの部品(core.mjs)で「文脈で見つけた語」(確信の弱い語)として扱う。辞書の語・形と重なれば、辞書の方を取る。
//
// 規則は2つ:
//   site-label:  欄名(「工事名」など)+ 区切り(コロン・空白・縦線・タブ)のあとの、語尾で終わる値。値はその欄(行・セル)の終わりまでで、
//                空白・ひらがなを含んでよい。語尾のあとの括弧(「(第1工区)」)も含める。前の「(仮称)」は含めない。例「工事名: みほん市道 道路改良工事」
//   site-suffix: 名前の部分(漢字・カタカナ・英数字・「・」の並び。前に名前の字が続かない所から始まる)+ 語尾。例「甲野川改修工事」
// どちらも、語尾の後ろに漢字・カタカナが続くものは取らない(「工事費」「工事業」「現場代理人」の「工事」「現場」を語尾にしない)
// 欄名が名前の前にくっついていれば(「工事名甲野川改修工事」)、欄名の後ろから取る(欄名は置き換えない)
// 置き換えすぎを減らすため、名前の部分から一般の語(工種・「本」「下請」「公共」など)・数・「第」「年度」・ひらがなの指示語(この・その など)を除いて
//   minRest 字(既定 2 字)より短く残る語は取らない(「下請工事」「土木一式工事」「第2工区」「建設現場」「この工事」は現場名にしない)

const NC = '\\p{Script=Han}々〆ヶ\\p{Script=Katakana}ーA-Za-z0-9０-９Ａ-Ｚａ-ｚ・';
const AFTER = '\\p{Script=Han}々〆ヶ\\p{Script=Katakana}ー';

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const alt = (words) => [...new Set(words)].sort((a, b) => b.length - a.length).map(escapeRe).join('|');

// 名前の部分から必ず除く字(数・年度・番号の書き方。分野によらない)
const FILLER = /[0-9０-９A-Za-zＡ-Ｚａ-ｚ・\s\u3000()（）]|令和|平成|年度|第|号|期|次|仮称/gu;
// ひらがなの指示語など(分野によらない)。名前の部分から除く
const HIRA_GENERIC = ['これら', 'それら', 'あらゆる', 'いずれ', 'すべて', 'ほか', 'この', 'その', 'あの', 'どの', 'など', 'および', 'または'];
const HIRA = '\\p{Script=Hiragana}';

export const SITE_RULES = [
  { id: 'site-label', name: '欄名の後ろの、語尾で終わる値', example: '工事名: みほん市道 道路改良工事(第1工区)' },
  { id: 'site-suffix', name: '現場名の語尾', example: '甲野川改修工事・甲野作業所・甲野第2工区' },
];

// 語尾の規則の形を作る。
//   suffixes: 語尾の表(長い語尾から試す)
//   labels:   名前の前にくっつくことのある欄名(「工事名」「件名」など)
//   genericWords: 名前の部分から除く一般の語(工種・「本」「下請」など)
//   minRest:  一般の語を除いたあとに残らなければならない字の数
export function siteSuffixPatterns({ suffixes = [], labels = [], genericWords = [], minRest = 2, kind = 'site' } = {}) {
  if (!suffixes.length) return [];
  const generic = [...new Set([...genericWords, ...HIRA_GENERIC])].sort((a, b) => b.length - a.length);
  const suffixAlt = alt(suffixes);
  const labelAlt = labels.length ? alt(labels) : '';
  // 名前の部分から一般の語と数を除いて、残る字の数を数える
  const rest = (name) => {
    let s = name.replace(FILLER, '');
    for (const g of generic) s = s.split(g).join('');
    return s.length;
  };
  const suffixRe = new RegExp(`(?:${suffixAlt})(?:[\\s\\u3000]*[(（][^()（）\\n]{0,20}[)）])?$`, 'u');
  const accept = (word) => {
    const name = word.replace(suffixRe, '');
    if (!name) return false;
    if (labelAlt && new RegExp(`^(?:${labelAlt})`, 'u').test(name)) return false;
    return rest(name) >= minRest;
  };
  // 始まり: 文の頭か名前の字でない字の後ろ(欄名がくっついていれば、その後ろ)
  const start = labelAlt
    ? `(?<=(?:^|[^${NC}])(?:${labelAlt})?)(?!${labelAlt})`
    : `(?<![${NC}])`;
  const re = new RegExp(`${start}[${NC}]{1,40}?(?:${suffixAlt})(?![${AFTER}])`, 'gu');
  const patterns = [{ kind, rule: 'site-suffix', re, accept }];
  if (labelAlt) {
    // 欄名 + 区切り +(「(仮称)」)のあとから、欄(行・縦線・タブ)の終わりまで。語尾で終わり、後ろに括弧が1つ付いてもよい
    const SEP = '(?:[ \\u3000]*[:：|｜\\t][ \\u3000]*|[ \\u3000]+)';
    const KASHO = '(?:[(（]仮称[)）][ \\u3000]*)?';
    const VALUE = `[${NC}${HIRA}][^\\n|｜\\t]{0,58}?`;
    const TAIL = `(?:[ \\u3000]*[(（][^()（）\\n|｜\\t]{0,20}[)）])?`;
    const labelRe = new RegExp(
      `(?<=(?:^|[^${NC}])(?:${labelAlt})${SEP}${KASHO})${VALUE}(?:${suffixAlt})(?![${AFTER}])${TAIL}(?=[ \\u3000]*(?:$|[|｜\\t]))`,
      'gmu',
    );
    patterns.unshift({ kind, rule: 'site-label', re: labelRe, accept });
  }
  return patterns;
}

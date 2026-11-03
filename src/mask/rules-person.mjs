// 人名の文脈規則(F17a): 辞書に無い人名を、まわりの語(敬称・役職・欄名)から「人名の候補」として見つける。
// この規則は分野の語を持たない。分野の役職(その業界にしかない役職の名前など)は、辞書のファイルから personContextPatterns に渡す。
// 見つけた語は、置き換えの部品(core.mjs)で「文脈で見つけた語」(確信の弱い語)として扱う。辞書の語・形と重なれば、辞書の方を取る。
//
// 規則は5つ:
//   honorific:   名前の後ろの敬称(様・殿・氏・さん)。例「甲野様」「甲野 一郎 殿」
//   title:       名前の前の役職(代表取締役・部長・担当者 など)。区切り(空白・コロン・縦線・タブ・半角と全角の括弧)のあとの名前。例「部長 甲野一郎」「部長（甲野 一郎）」
//   label:       名前の前の欄名(氏名・担当者・作成者 など)。区切りのあとの名前。例「氏名: 甲野 一郎」
//   title-after: 名前の後ろの役職(F27b)。括弧の中の役職(「甲野 一郎(部長)」)と、名前に直に付く役職(「乙川所長に報告」「丙田部長 承認」)。
//                直に付く形は、姓に付けて呼ぶ役職(所長・部長・課長 など)だけにし、部署・場所の語(本店・管理・作業 など)は人名にしない。
//                分野の役職・部署の語は、辞書のファイルから attachedTitles・orgWords で足す
//   list:        役職・欄名の後ろの名前に、読点(、,，)や中黒(・)で並ぶ2人目以降の名前(F27b)。例「氏名: 甲野 一郎、乙川 二郎」
// 名前の形: 漢字の姓(1〜4字)+ 空白 + 名(漢字・カタカナ 1〜6字、または区切りの手前で終わるひらがな 2〜4字)、
//           または空白の無い漢字の並び 2〜5字(前後に漢字が続かないもの)
// 置き換えすぎを減らすため、次の語は人名にしない: 役職・欄名そのもの、止める語(未定・同上・専任 など)、
//   名前に付かない字で終わる語(者・課・部・所・欄・書・号 など)

const HAN = '\\p{Script=Han}々〆ヶ';
const KANA = '\\p{Script=Katakana}ー';
const HIRA = '\\p{Script=Hiragana}';
const SP = '[ \\u3000]';
// 区切り: 空白・コロン・縦線・タブ・括弧のどれか(前後の空白は許す)
const SEP = `(?:[\\s\\u3000]*[:：|｜\\t(（][\\s\\u3000]*|[\\s\\u3000]+)`;
// 並びの区切り: 読点・カンマ・中黒(前後の空白は許す)
const LIST_SEP = `[\\s\\u3000]*[、,，・][\\s\\u3000]*`;
// 名(下の名前)のひらがなは、区切り・敬称・文の終わりの手前で終わるものだけ(「甲野 さくらが」の「が」を名に入れない)
const GIVEN = `(?:[${HAN}${KANA}]{1,6}(?![${HAN}${KANA}])|[${HIRA}]{2,4}(?=[\\s\\u3000、。,.)）」』\\]|｜:：]|$|様|殿|氏|さん))`;
const NAME = `(?:[${HAN}]{1,4}${SP}{1,2}${GIVEN}|[${HAN}]{2,5}(?![${HAN}${KANA}]))`;
// 敬称の前の名前(後ろに敬称の漢字が続くので、「漢字が続かない」の条件を付けない)
// 役職の前の名前(後ろに役職の漢字が続くので、「漢字が続かない」の条件を付けない)
const NAME_BEFORE_TITLE = `(?:[${HAN}]{1,4}${SP}{1,2}[${HAN}${KANA}]{1,6}|[${HAN}]{2,5})`;
const NAME_BEFORE_HONORIFIC = `(?:[${HAN}]{1,4}${SP}{1,2}(?:[${HAN}${KANA}]{1,6}|[${HIRA}]{2,4})|[${HAN}]{2,5})`;

// 一般の敬称・役職・欄名(分野によらないもの)。担当者・作成者のように欄名にもなる語は欄名の方に置く
export const HONORIFICS = ['様', '殿', '氏', 'さん'];
export const GENERIC_TITLES = [
  '代表取締役社長', '代表取締役', '取締役', '代表執行役', '執行役員', '社長', '副社長', '会長', '専務', '常務', '理事長', '理事',
  '本部長', '部長', '次長', '課長', '係長', '主任', '主査', '所長', '支店長', '店長', '室長', '班長', '工場長', '院長', '校長',
  '代表者', '代理人', '責任者', '管理者', '届出者', '立会者',
];
export const GENERIC_LABELS = [
  '氏名', 'お名前', '名前', '担当', '担当者', '担当者名', '責任者名', '代表者名', '代表者氏名', '作成者', '確認者', '承認者', '記入者', '申請者',
  '連絡先', '連絡担当', '問合せ先', '問い合わせ先',
];
// 人名にしない語(敬称・役職・欄名の隣によく来る、人名ではない語)
export const GENERIC_STOP_WORDS = [
  '未定', '不明', '同上', '同右', '同左', '以下', '以上', '下記', '上記', '別紙', '別途', '本人', '代理', '兼務', '兼任', '専任', '非専任',
  '空欄', '未記入', '記入', '確認', '承認', '済み', '有り', '無し', 'なし', 'あり', '不要', '必要', '予定', '選任', '配置', '常駐', '非常駐',
  '得意', '両親', '家族', '一同', '先方', '貴社', '御社', '弊社', '当社', '貴殿', '皆々', '各位', '先生', '本社', '支社', '支店', '営業所',
  '代表', '総務', '経理', '人事', '営業', '技術', '事務', '一級', '二級', '資格', '名称', '氏名', '電話', '住所', '所在地', '番号',
];
// 名前に直に付けて呼ぶ役職(「乙川所長」「丙田部長」)。括弧の中なら役職の全部を使う
export const ATTACHED_TITLES = [
  '社長', '副社長', '会長', '専務', '常務', '理事長', '本部長', '部長', '次長', '課長', '係長', '主任', '主査', '所長', '支店長', '店長',
  '室長', '班長', '工場長', '院長', '校長',
];
// 役職に直に付いても人名にしない語(部署・場所・仕事の語。「作業所長」「管理部長」)
export const ORG_WORDS = [
  '現場', '作業', '出張', '設計', '安全', '衛生', '品質', '業務', '企画', '開発', '製造', '生産',
  '購買', '調達', '資材', '事業', '統括', '地区', '地域', '海外', '国内', '管理', '機械', '電気', '設備', '環境', '研究', '広報', '法務',
  '財務', '情報', '工場', '部門', '本店', '本部', '現地', '当日', '前日', '翌日', '今回', '前回', '次回', '新任', '前任', '後任', '歴代',
];
// 人名に付かない字(この字で終わる語は人名にしない)
export const NON_NAME_ENDINGS = '者任欄書証号番年月日円等的性化級式法表票類課部係所局室会社業費額率度期済無未要可否屋員手名先地内外中仕模同多異客神';

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const alt = (words) => [...new Set(words)].sort((a, b) => b.length - a.length).map(escapeRe).join('|');

// 規則の一覧(画面と README で見せるための説明)
export const PERSON_RULES = [
  { id: 'honorific', name: '敬称の前', example: '甲野様・甲野 一郎 殿・甲野氏・甲野さん' },
  { id: 'title', name: '役職の後ろ', example: '部長 甲野一郎・代表取締役 甲野 一郎' },
  { id: 'label', name: '欄名の後ろ', example: '氏名: 甲野 一郎・担当者 甲野一郎' },
  { id: 'title-after', name: '役職の前', example: '甲野 一郎(部長)・乙川所長に報告・丙田部長 承認' },
  { id: 'list', name: '並びの2人目以降', example: '氏名: 甲野 一郎、乙川 二郎' },
];

// 文脈規則の形を作る。titles・labels・stopWords は分野の辞書から足す語(一般の語に足す)
export function personContextPatterns({ titles = [], labels = [], stopWords = [], honorifics = HONORIFICS, attachedTitles = [], orgWords = [] } = {}) {
  const allTitles = [...GENERIC_TITLES, ...titles];
  const allLabels = [...GENERIC_LABELS, ...labels];
  const stops = new Set([...GENERIC_STOP_WORDS, ...stopWords]);
  const context = [...allTitles, ...allLabels];
  const compact = (s) => s.replace(/[\s　]+/g, '');
  // 人名として受け入れるか: 役職・欄名・止める語でない、それらで始まらない、人名に付かない字で終わらない
  const accept = (word) => {
    const w = compact(word);
    if (w.length < 2) return false;
    if (stops.has(w)) return false;
    if (NON_NAME_ENDINGS.includes(w[w.length - 1])) return false;
    for (const part of String(word).trim().split(/[\s　]+/)) {
      if (stops.has(part) || context.includes(part)) return false;
    }
    if (context.some((c) => w.startsWith(c) || w.endsWith(c))) return false;
    return true;
  };
  const orgs = new Set([...ORG_WORDS, ...orgWords]);
  const allAttached = [...ATTACHED_TITLES, ...attachedTitles];
  // 役職の前の名前: 上の決まりに加え、部署・場所の語でない、役職の一部(「支店長」の「支」)で終わらない
  const acceptBeforeTitle = (word) => {
    if (!accept(word)) return false;
    const parts = String(word).trim().split(/[\s　]+/);
    if (parts.some((p) => orgs.has(p))) return false;
    const w = compact(word);
    for (const o of orgs) if (w.endsWith(o) && w.length - o.length < 2) return false;
    if (w.endsWith('支')) return false;
    return true;
  };
  const head = `(?:${alt(context)})${SEP}`;
  return [
    {
      kind: 'person',
      rule: 'honorific',
      // 前に漢字・カタカナが続かない名前 + (空白)+ 敬称。敬称の後ろに漢字が続くもの(「氏名」など)は除く
      re: new RegExp(`(?<![${HAN}${KANA}A-Za-z0-9])${NAME_BEFORE_HONORIFIC}(?=${SP}?(?:${alt(honorifics)})(?![${HAN}]))`, 'gu'),
      accept,
    },
    { kind: 'person', rule: 'title', re: new RegExp(`(?<=(?:${alt(allTitles)})${SEP})${NAME}`, 'gu'), accept },
    { kind: 'person', rule: 'label', re: new RegExp(`(?<=(?:${alt(allLabels)})${SEP})${NAME}`, 'gu'), accept },
    {
      kind: 'person',
      rule: 'title-after',
      // 前に漢字・カタカナが続かない名前 + 括弧 + 役職 + 閉じ括弧、または 名前 + 直に付く役職(後ろに漢字が続かない)
      re: new RegExp(
        `(?<![${HAN}${KANA}A-Za-z0-9])${NAME_BEFORE_TITLE}(?=${SP}?[(（]${SP}*(?:${alt(allTitles)})${SP}*[)）]|(?:${alt(allAttached)})(?![${HAN}]))`,
        'gu',
      ),
      accept: acceptBeforeTitle,
    },
    // 役職・欄名の後ろの名前に読点・中黒で並ぶ2人目以降(1人目は title・label の規則で見つける)
    // 敬称で終わる語(「丙田様」)は取らない(名前の部分は敬称の規則で見つける)
    {
      kind: 'person',
      rule: 'list',
      re: new RegExp(`(?<=${head}(?:${NAME}${LIST_SEP})+)${NAME}`, 'gu'),
      accept: (word) => accept(word) && !honorifics.some((h) => compact(word).endsWith(h)),
    },
  ];
}

// 住所の規則(F24b)。業界を問わない。置き換えの部品(core.mjs)が形として使う。
// 住所の並び(アドレス・ベース・レジストリ https://www.digital.go.jp/policies/base_registry_address 、
// 日本郵便 郵便番号データの説明 https://www.post.japanpost.jp/service/search/zipcode/download/readme.html ):
//   〒 郵便番号 → 都道府県 → 郡・市・区・町・村 → 大字・町字・字 → 丁目 → 番地・番・号 → 枝番 → 建物名・部屋番号
// 見つける形:
//   (1) 都道府県 +(市区町村)+(町名)+ 番地      例「架空県みほん市さくら町1-2-3」「架空県 けんちょう通り 0-0」
//   (2) 市区町村 +(町名)+ 番地(都道府県なし)    例「みほん市さくら町一丁目2番3号」。番地は「丁目・番地・番・号」が付くか、
//       数が2つ以上つながるか、町名が「町・村・字」などで終わるときだけ取る(「みほん市 3」「みほん市 2026年」は取らない)
//   (3) 都道府県 + 市区町村 + 町名(番地なし)      町名が「町・村・丁目・地内・地先」などで終わる所まで。例「架空県みほん市さくら町地内」
//   (4) 〒 郵便番号(単独でも、住所の前でも)。「郵便番号: 123-4567」の数の所
//   (1)〜(3) の後ろの建物名(ビル・マンション・ハイツ などで終わる語)と部屋番号(301号室・3階 など)
//   (5) 条丁目(F31c): 「北8条西5丁目1-1」「南1条西2丁目」「4条通8丁目」は番地の一部として全部を1つに取る。法令の条(「みほん市条例3条」)は取らない
//   (6) 京都の通り名(F31c): 「寺町通御池上る上本能寺前町488」。上る・下る・東入る・西入る(カタカナの形も)があれば、町名が長くても全部を1つに取る
// 区切り: 部分のあいだの空白は1字(半角・全角)まで許す。数字は半角・全角・漢数字、ハイフンは - − ‐ ‑ – ー － ― を許す。
// 続く名前を食わないための決まり:
//   ・住所は番地(か建物名・部屋番号)で終わる。番地の後ろの会社名・人名は住所に入れない(「…1-2-3 甲山建設株式会社」)
//   ・「都道府県 空白 都道府県名で始まる語」は、前の都道府県を住所に入れない(「架空県 架空県ためし市0-0」の前の「架空県」は発注者の名前)
//   ・都道府県 + 市区町村だけ(町名も番地も無い)は、住所の欄名(住所・所在地 など)の後ろのときだけ取る。
//     それ以外は発注者の名前(「架空県みほん市」「みほん市長」)とみなして取らない
//   ・建物名に法人の種類の語(株式会社 など)が入るときは建物名にしない

import { CORPORATE_TYPES } from './company-types.mjs';
import { trimHead } from './rules-company.mjs';

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const alt = (words) => [...new Set(words)].sort((a, b) => b.length - a.length).map(escapeRe).join('|');

// 都道府県(総務省 全国地方公共団体コード https://www.soumu.go.jp/denshijiti/code.html の都道府県の名前)
export const PREFECTURES = [
  '北海道', '青森県', '岩手県', '宮城県', '秋田県', '山形県', '福島県', '茨城県', '栃木県', '群馬県', '埼玉県', '千葉県', '東京都', '神奈川県',
  '新潟県', '富山県', '石川県', '福井県', '山梨県', '長野県', '岐阜県', '静岡県', '愛知県', '三重県', '滋賀県', '京都府', '大阪府', '兵庫県',
  '奈良県', '和歌山県', '鳥取県', '島根県', '岡山県', '広島県', '山口県', '徳島県', '香川県', '愛媛県', '高知県', '福岡県', '佐賀県', '長崎県',
  '熊本県', '大分県', '宮崎県', '鹿児島県', '沖縄県',
];
// 建物名の語尾と頭(慣用。公式の一覧なし)
export const BUILDING_SUFFIXES = ['ビルディング', 'ビル', 'マンション', 'ハイツ', 'コーポ', 'アパート', 'レジデンス', 'ハイム', 'メゾン', 'タワー', 'コート',
  'ヒルズ', 'ハウス', 'パレス', 'プラザ', 'テラス', '荘', '団地', '住宅', '寮'];
export const BUILDING_HEADS = ['コーポ', 'メゾン', 'ハイツ', 'グラン'];
// 住所の欄名(この後ろなら、都道府県 + 市区町村だけでも住所として取る)と、名前の頭に付いても地名ではない欄名の語
// 「市・区・町・村・郡」で終わるが市区町村の名前ではない語(慣用)
export const NON_MUNI_WORDS = ['都市', '地区', '市区', '工区', '学区', '管区', '街区', '特区', '選挙区', '区画区', '漁村', '農村', '山村', '城下町', '門前町', '宿場町', '港町', '下町', '市町村', '区市町村', '市町', '町村'];
export const ADDRESS_LABELS = ['住所', '所在地', '所在', '本店', '本社', '支店', '営業所', '事業所', '工事場所', '施工場所', '場所', '送付先', '宛先', '連絡先', '郵便番号'];

const D = '[0-9０-９]';
const HY = '[-−‐‑–ー－―]';
const SP = '[ \\u3000]';
const KNUM = '[一二三四五六七八九十〇百千]';
// 地名の字
const NM = '[\\p{Script=Han}\\p{Script=Katakana}\\p{Script=Hiragana}ー々ヶ]';
const NMX = '[\\p{Script=Han}\\p{Script=Katakana}\\p{Script=Hiragana}ー々ヶA-Za-zＡ-Ｚａ-ｚ0-9０-９・]';
// 一覧に無い県の名前(架空の例など)は、漢字2字 + 県 だけを取る(3字にすると前の語の字を食う)
const PREF = `(?:${alt(PREFECTURES)}|\\p{Script=Han}{2}県)`;
const PREF_HEAD = `\\p{Script=Han}{2,3}[都道府県](?![市区町村郡])`;
const MUNI = `${NM}{1,8}?[市区町村郡]`;
const MUNIS = `${MUNI}(?:${SP}?${MUNI}){0,2}`;
const TOWN = `${NM}{1,12}`;
// 京都の通り名: 漢字・カタカナの通りの名前 + 上る・下る・東入る・西入る(2回まで)+ 町名
const HK = '[\\p{Script=Han}\\p{Script=Katakana}ー々ヶ]';
const DIR = '(?:東入る|西入る|東入ル|西入ル|東入|西入|上る|下る|上ル|下ル|入る|入ル)';
const KYOTO_TOWN = `${HK}{1,14}?${DIR}(?:${HK}{1,8}?${DIR})?${HK}{0,14}`;
// 番地: 「1-2-3」「1丁目2番3号」「一丁目2番地の3」「123番地」「1丁目 2-3」。漢数字は丁目・番・号・の が続くときだけ
const NUM = `(?:${D}+|${KNUM}+(?=丁目|番|号|地割|の))`;
const NUMSFX = '(?:丁目|番地|番|号|地割)';
const NUMTAIL = `${NUM}${NUMSFX}?(?:(?:(?<=丁目|番地|番|地割)${SP}?|${HY}|の)?${NUM}${NUMSFX}?){0,4}`;
// 条丁目: 条の数 +(通・東西南北)。後ろに丁目や番地が続いてよい
const JOHEAD = `(?:${D}+|${KNUM}+)条(?:通|[東西南北])?`;
const NUMPART = `(?<!第)(?:(?<jo>${JOHEAD})${SP}?(?:[東西南北]?${NUMTAIL})?|${NUMTAIL})`;
const BUILDING = `(?:(?:${alt(BUILDING_HEADS)})${NMX}{1,12}|${NMX}{1,20}?(?:${alt(BUILDING_SUFFIXES)}))(?:${SP}?(?:${D}+|[A-ZＡ-Ｚ])?(?:号館|号棟|棟|館))?(?![\\p{Script=Han}\\p{Script=Katakana}ーA-Za-zＡ-Ｚａ-ｚ])`;
const ROOM = `(?:${D}+(?:階|[FＦ])(?:${SP}?${D}+(?:号室|号)?)?|${D}+(?:号室|号)?|[A-ZＡ-Ｚ]${HY}?${D}+(?:号室)?)`;
// 部屋番号: 建物名の後ろなら数だけでもよい。建物名が無ければ「号室・階」の付くものだけ(後ろの電話番号などを食わない)
const ROOM_STRICT = `(?:${D}+(?:階|[FＦ])${SP}?)?${D}+号室|${D}+(?:階|[FＦ])(?!${D})`;
const AFTER_NUM = `(?:${SP}?(?<bldg>${BUILDING})(?:${SP}?(?<room>${ROOM})(?!${D}|${HY}|階|[FＦ]))?|${SP}?(?<room2>${ROOM_STRICT}))?`;
const ZIP = `〒${SP}?${D}{3}${HY}${D}{4}`;
// 番地の後ろに続くと住所にしない字(年・円・人 などの数の単位。「市道1号線」の 線・号)
const NOT_AFTER = `(?!${D}|[年月日円時分秒歳人名件台回本枚個箇ヶか％%㎡mｍ線号])`;

const RE = new RegExp(
  `(?<zip>${ZIP}${SP}?)?` +
  `(?:(?<pref>${PREF})(?:${SP}?(?!${PREF_HEAD})(?<muni>${MUNIS}))?|(?<muni2>${MUNIS}))` +
  `(?:${SP}?(?!${PREF_HEAD})(?<town>(?<kyoto>${KYOTO_TOWN})|${TOWN}))?` +
  `(?:${SP}?(?<num>${NUMPART})${NOT_AFTER}${AFTER_NUM})?`,
  'gu',
);
// 町名の終わりとして認める語(番地が無いとき)
const TOWN_END = /(?:町|村|丁目|地内|地先|大字\S+|字\S+)$/u;
const LABEL_AT_END = new RegExp(`(?:${alt(ADDRESS_LABELS)})(?:[:：|｜\\t]|${SP})*$`, 'u');
const MUNI_UNIT = new RegExp(MUNI, 'gu');
const NON_MUNI = new RegExp(`(?:${alt(NON_MUNI_WORDS)})$`, 'u');
const KYOTO_END = new RegExp(`(?:町|村|丁目|${DIR})(?=${HK}*$)`, 'gu');
// 町名の後ろの「通」は切らない(「寺町通御池」の「寺町」だけを取らない)。通信・通知など一般の語は除く
const NOT_STREET = '(?!信|知|勤|行|常|路|話|過|学|院|算|報|達|販|貨)';
const STREET_AFTER = new RegExp(`^通${NOT_STREET}${HK}*`, 'u');
// 町名が「〜通〜」のとき(「烏丸通御池」)。都道府県か2つ以上の市区町村があるときだけ見る(「みほん市交通局」を取らない)
const STREET_TOWN = new RegExp(`^${HK}{1,8}?(?<![交開共普流直文貫])通${NOT_STREET}${HK}*`, 'u');
// 町名がこれらの語で終わる「3条」は法令の条で、住所ではない
const LAW_BEFORE_JO = /(?:法|令|条例|規則|規程|規定|要綱|要領|契約|約款|基準|憲章|細則)$/u;
const MULTI_MUNI = new RegExp(`^${MUNI}(?:${SP}?${MUNI})+$`, 'u');
const KNUM_ADDR = new RegExp(`${KNUM}+(?:丁目|番地|番|号)(?:の?${KNUM}+(?![\\p{Script=Han}]))?`, 'gu');
const LABEL_IN = new RegExp(`(?:${alt(ADDRESS_LABELS)})`, 'gu');
const CORP_IN = new RegExp(alt(CORPORATE_TYPES), 'u');

export const ADDRESS_RULES = [
  { id: 'address', name: '住所(都道府県・市区町村・町名・番地・建物名・部屋番号)', example: '架空県みほん市さくら町1-2-3 みほんビル301号室・みほん市さくら町一丁目2番3号' },
  { id: 'zip', name: '郵便番号(〒)', example: '〒000-0000' },
];

// 市区町村の名前の頭から、文の中のひらがな・欄名の語を外す。返すのは名前の中で残す所の始まり(残らなければ -1)
function muniStart(name) {
  let cut = 0;
  for (const m of name.matchAll(LABEL_IN)) cut = Math.max(cut, m.index + m[0].length);
  const rest = name.slice(cut);
  const h = trimHead(rest);
  if (h < 0) return -1;
  return cut + h;
}

// 番地の形が住所らしいか(都道府県なしのとき)
function strongNumber(num, town, g = {}) {
  if (g.kyoto) return true;
  if (/丁目|番地|番|号|地割/u.test(num)) return true;
  if (g.jo && town) return true;
  if (new RegExp(`${D}+(?:${HY}|の)${D}+`, 'u').test(num)) return true;
  return !!town && /(?:町|村|字\S*)$/u.test(town.trim());
}

function trimAddress(word, index, text) {
  const m = word.match(new RegExp(`^${RE.source}$`, 'u'));
  if (!m) return null;
  const g = m.groups;
  const muni = g.muni || g.muni2 || '';
  // 「京都市」は語尾が「都市」だが市の名前
  if (muni && [...muni.matchAll(MUNI_UNIT)].some((u) => !u[0].endsWith('京都市') && NON_MUNI.test(u[0]))) return null;
  let start = 0;
  // 都道府県の無い住所は、市区町村の名前の頭のひらがな・欄名を外す(〒の後ろなら外さない)
  if (!g.pref && g.muni2) {
    const name = g.muni2.match(new RegExp(`^${NM}{1,8}?(?=[市区町村郡])`, 'u'))[0];
    const s = muniStart(name);
    if (s < 0 || (g.zip && s > 0)) return null;
    // 文の頭を外したら都道府県で始まるなら、そこから読み直す(「現場は京都府京都市…」)
    if (s > 0 && new RegExp(`^${PREF}`, 'u').test(word.slice(s))) {
      const again = trimAddress(word.slice(s), index + s, text);
      return again && [again[0] + s, again[1] + s];
    }
    start = s; // 〒があれば s は 0(〒から取る)
  }
  if (g.jo && LAW_BEFORE_JO.test((g.town || '').trim())) return null;
  if (g.num) {
    if (g.bldg && CORP_IN.test(g.bldg)) return [start, word.slice(0, word.lastIndexOf(g.bldg)).trimEnd().length];
    if (!g.pref && !strongNumber(g.num, g.town, g)) return null;
    return [start, word.length];
  }
  const town = g.town || '';
  const head = word.length - town.length;
  // 京都の通り名は、上る・下る の後ろの町名まで全部か、町名でなければ 上る・下る まで
  if (g.kyoto) {
    const last = [...town.matchAll(KYOTO_END)].pop();
    return [start, head + last.index + last[0].length];
  }
  // 番地が漢数字だけ(「一丁目二番三号」)のときは、町名の中に入っている。最後の「〜丁目・番・号」までにする
  const kn = [...town.matchAll(KNUM_ADDR)].pop();
  if (kn && (g.pref || muni)) return [start, head + kn.index + kn[0].length];
  // 番地が無いとき: 町名が「町・村・丁目・地内・地先」などで終わる所まで(都道府県が無ければ「地内・地先」のときだけ)
  if (town && muni) {
    for (let k = town.length; k > 0; k--) {
      const t = town.slice(0, k);
      if (TOWN_END.test(t) && (g.pref || /(?:地内|地先)$/u.test(t))) return [start, head + k + (town.slice(k).match(STREET_AFTER)?.[0].length ?? 0)];
    }
  }
  // 「…寺町」が市区町村の形に見えて、後ろが「通御池」のとき(「寺町」だけを取らない)
  const street = town.match(STREET_AFTER);
  if (street && muni) return [start, head + street[0].length];
  const streetTown = (g.pref || MULTI_MUNI.test(muni)) && muni ? town.match(STREET_TOWN) : null;
  if (streetTown) return [start, head + streetTown[0].length];
  const core = word.slice(0, head).trimEnd().length;
  // 都道府県 + 市区町村が2つ以上(「架空県ためし郡みほん町」「架空県みほん市さくら町」)
  if (g.pref && g.muni && MULTI_MUNI.test(g.muni)) return [start, core];
  // 都道府県 + 市区町村だけ: 住所の欄名の後ろのときだけ取る(それ以外は発注者の名前とみなす)
  if (g.pref && g.muni && LABEL_AT_END.test(text.slice(Math.max(0, index - 12), index))) return [start, core];
  return null;
}

// 住所の形。core.mjs の形として使う
export function addressPatterns(kind = 'address') {
  return [
    { kind, re: new RegExp(RE.source, 'gu'), trim: trimAddress },
    // 〒 + 郵便番号だけ
    { kind, re: new RegExp(`${ZIP}(?!${D})`, 'gu') },
    // 「郵便番号: 123-4567」(〒の無い郵便番号は欄名の後ろだけ)
    { kind, re: new RegExp(`(?<=郵便番号[:：]?${SP}?)${D}{3}${HY}${D}{4}(?!${D})`, 'gu') },
  ];
}

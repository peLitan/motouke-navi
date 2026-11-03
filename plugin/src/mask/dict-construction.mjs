// 置き換えの部品(src/mask/core.mjs)に渡す、建設の辞書(F11a)。
// 部品は分野の語を持たないので、建設業の許可番号の形や共同企業体の名前の形はここに置く。
// 語(terms)は空にしておく。人名・現場名は案件ごとに違うので、画面の「辞書に足す」で足す。
// 人名の文脈規則(F17a)は src/mask/rules-person.mjs にあり、建設の役職・欄名だけをここから足す。
// 現場名の語尾の規則(F17b)は src/mask/rules-site.mjs にあり、語尾の表は src/mask/suffix-construction.mjs から渡す(業界ごとに差し替える)。

import { personContextPatterns } from './rules-person.mjs';
import { siteSuffixPatterns } from './rules-site.mjs';
import { CONSTRUCTION_SITE_TABLE } from './suffix-construction.mjs';

const DIGIT = '[0-9０-９]';
const HYPHEN = '[-−‐‑–ー－]';

// 建設の書類で人名の前に来る役職・欄名(施工体制台帳・作業員名簿・施工計画書などに出るもの)
export const CONSTRUCTION_PERSON_TITLES = [
  '現場代理人', '監理技術者補佐', '監理技術者', '主任技術者', '専門技術者', '統括安全衛生責任者', '元方安全衛生管理者', '安全衛生責任者',
  '安全衛生推進者', '雇用管理責任者', '作業主任者', '職長', '工事担当者', '現場責任者', '現場担当者', '作業所長', '工事主任',
];
export const CONSTRUCTION_PERSON_LABELS = ['技術者氏名', '代理人氏名', '作業員氏名', '監督員', '監督職員', '検査員'];
// 建設の書類で役職・欄名の隣に来るが人名ではない語
export const CONSTRUCTION_STOP_WORDS = ['施主', '発注者', '元請', '下請', '一次', '二次', '三次', '土木', '建築', '舗装', '工事', '施工', '監理', '主任', '一式'];

export const CONSTRUCTION_DICT = {
  name: '建設',
  labels: {
    license: '許可番号',
    site: '現場名',
  },
  terms: [],
  patterns: [
    // 建設業の許可番号: 「国土交通大臣 許可(特-06)第00000号」「〇〇県知事 許可(般-05)第00000号」
    {
      kind: 'license',
      re: new RegExp(`(?:国土交通大臣|\\p{Script=Han}{1,3}[都道府県]知事)[\\s\\u3000]*許可[\\s\\u3000]*[((][\\s\\u3000]*(?:特|般)[\\s\\u3000]*${HYPHEN}?[\\s\\u3000]*${DIGIT}{1,2}[\\s\\u3000]*[))][\\s\\u3000]*第[\\s\\u3000]*${DIGIT}+[\\s\\u3000]*号`, 'gu'),
    },
    // 共同企業体(JV)の名前: 「甲乙特定建設工事共同企業体」「甲乙JV」
    {
      kind: 'company',
      re: /[\p{Script=Han}\p{Script=Katakana}ー・A-Za-z0-9]{1,30}?(?:特定建設工事共同企業体|経常建設共同企業体|共同企業体|ＪＶ|JV)/gu,
    },
  ],
  contextPatterns: [
    ...personContextPatterns({
      titles: CONSTRUCTION_PERSON_TITLES,
      labels: CONSTRUCTION_PERSON_LABELS,
      stopWords: CONSTRUCTION_STOP_WORDS,
    }),
    ...siteSuffixPatterns(CONSTRUCTION_SITE_TABLE),
  ],
};

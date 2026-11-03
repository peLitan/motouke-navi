// 置き換えの部品(src/mask/core.mjs)に渡す、医療の辞書(F19b の「例」)。建設の辞書(src/mask/dict-construction.mjs)と同じ形。
// 画面の「業界」で「医療(例)」を選んだときに使う。医療の書類での置き換えの漏れの率は測っていない。
// 建設の許可番号・共同企業体の形は持たない。施設名の語尾の表は src/mask/suffix-medical.mjs から渡す。
// 種類の key は建設の辞書と同じ(辞書のファイルをどちらの業界でも読み込めるように)。site の表示名だけ「施設名」にする。

import { personContextPatterns } from './rules-person.mjs';
import { siteSuffixPatterns } from './rules-site.mjs';
import { MEDICAL_SITE_TABLE } from './suffix-medical.mjs';

// 医療の書類で人名の前に来る役職・欄名
export const MEDICAL_PERSON_TITLES = [
  '主治医', '担当医', '執刀医', '紹介医', '医師', '歯科医師', '副院長', '看護部長', '看護師長', '師長', '主任看護師', '看護師', '准看護師',
  '保健師', '助産師', '薬剤師', '管理薬剤師', '理学療法士', '作業療法士', '言語聴覚士', '臨床検査技師', '診療放射線技師', '管理栄養士',
  '医療ソーシャルワーカー', 'ケアマネジャー', '介護支援専門員', '事務長',
];
export const MEDICAL_PERSON_LABELS = ['患者氏名', '患者名', '医師名', '担当医師', '主治医名', '紹介医師', '処方医', '受診者', '被保険者氏名'];
// 役職・欄名の隣に来るが人名ではない語
export const MEDICAL_STOP_WORDS = [
  '外来', '入院', '退院', '病棟', '当直', '夜勤', '日勤', '在宅', '内科', '外科', '小児科', '眼科', '歯科', '整形外科', '皮膚科', '精神科',
  '常勤', '非常勤', '専門', '指導', '研修', '紹介', '診察', '処方', '検査', '患者',
];

export const MEDICAL_DICT = {
  name: '医療(例)',
  labels: {
    license: '許可番号',
    site: '施設名',
  },
  terms: [],
  patterns: [],
  contextPatterns: [
    ...personContextPatterns({
      titles: MEDICAL_PERSON_TITLES,
      labels: MEDICAL_PERSON_LABELS,
      stopWords: MEDICAL_STOP_WORDS,
    }),
    ...siteSuffixPatterns(MEDICAL_SITE_TABLE),
  ],
};

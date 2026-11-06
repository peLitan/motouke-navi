// 公告の参加の条件の文から「元請けとしての施工実績」を求める文を探す(F49a)。通信しない。AI も使わない。
// 文ごとに語で見るだけなので、当たっても「確認が要る」として知らせ、参加できないとは言い切らない。
import { splitSentences } from './brackets.mjs';

// 実績の条件の語
const EXPERIENCE = /実績|同種(?:の)?工事|同等(?:の)?工事|類似(?:の)?工事/;
// 元請けの語を使わずに同じことを書く形(「発注者から直接請け負った」「国、地方公共団体等から直接受注した」)
const DIRECT = '(?:発注者|国|地方公共団体等?)から直接(?:請け?負|受注)';
const PRIME = new RegExp(`元請|${DIRECT}`);
// 元請け・下請けを問わない
const EITHER = [
  new RegExp(`(?:元請|${DIRECT})[^。]{0,15}下請[^。]{0,10}(?:問わ|問いません|別なく|かかわらず|関わらず|いずれ)`),
  /元請[けの負]?(?:業者|人)?(?:又は|または|若しくは|もしくは|及び|および|・|、|,|，)\s*下請/,
  // 読点では続けない(「…に限り、下請工事は認めない」は問わない文ではない)
  new RegExp(`${DIRECT}[^。、]{0,10}(?:又は|または|若しくは|もしくは|及び|および)\\s*下請`),
  /下請[^。]{0,12}(?:含む|含みます|含め(?!な|ず|ま)|も可|でも可|でもよい|も認め|でも差し支え|も対象)/,
];
// 実績そのものを求めていない
// 表の「元請けとしての実績 不要」のように、語のあいだに空白が入ることがある
const NOT_REQUIRED = /実績(?:の有無)?[\s　]*(?:は|を|について(?:は)?)?[\s　]*(?:問わ|問いません|求めない|求めません|要しない|要しません|不要|必要としない|必要ありません)/;
// 下請けの実績を認めないと書いてある(語が「元請」でなくても同じ条件)
const SUB_EXCLUDED = /下請[^。]{0,12}(?:含まない|含みません|含まず|認めない|認めません|認められない|除く|除きます|不可)/;
// 求めている形の語。実績の語があるだけの文(「…のものは本施工実績とはならない」)は条件にしない
const REQUIRED = /有する|有して|有し|あること|ある者|あるもの|必要|求める|求めます|条件|限る|限り|のみ|実績[\s　:：]*(?:要|有)/;
// 参加の条件ではない文(加点の説明、技術者の経験)
const NOT_CONDITION = /加点|評価点|評価項目|評価の対象|評価する|評価します|望ましい/;
const ENGINEER_SENTENCE = /^[^、。]{0,16}技術者(?:等|など)?(?:は|が)/;
const ITEM_HEAD = /\n(?=[\s　]*[(（]?[0-9０-９]+[)）.．])/;

// 改行を除いた文の列。PDF の折り返しと括弧の中の「。」では切らず、「。」と番号の付いた行の頭で切る
const sentences = (text) => String(text ?? '').split(ITEM_HEAD).flatMap((part) => splitSentences(part))
  .map((s) => s.replace(/[\s　]*\n[\s　]*/g, '').trim()).filter(Boolean);

function isPrimeCondition(s) {
  if (!EXPERIENCE.test(s) || !REQUIRED.test(s) || NOT_REQUIRED.test(s) || NOT_CONDITION.test(s) || ENGINEER_SENTENCE.test(s)) return false;
  if (EITHER.some((re) => re.test(s))) return false;
  return PRIME.test(s) || SUB_EXCLUDED.test(s);
}

// 当たった最初の文を返す。無ければ null
export function findPrimeExperience(text) {
  return sentences(text).find(isPrimeCondition) ?? null;
}

export const PRIME_CHECK_KEY = 'prime-experience';
export const PRIME_CHECK_LABEL = '元請けの施工実績';
export const primeMessage = (quote) => 'この工事は元請けとしての施工実績を参加の条件にしています。初めて元請けをする会社は参加できない場合があります。発注者が認める実績の範囲は、公告と説明書で確かめてください。公告の文: 「' + quote + '」';

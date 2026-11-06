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
  /元請[けの負]?(?:業者|人)?(?:又は|または|若しくは|もしくは|及び|および|・|、|,|，)\s*(?:[一二12１２]次(?:の)?)?下請/,
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
const REQUIRED = /有する|有して|有し|あること|ある者|あるもの|必要|求める|求めます|条件|限る|限り|のみ|施工した(?:こと|経験)|実績[\s　:：]*(?:要|有)/;
// 参加の条件ではない文(加点の説明、技術者の経験)
const NOT_CONDITION = /加点|評価点|評価項目|評価の対象|評価する|評価します|望ましい/;
// 技術者への条件の文。最初の読点までに技術者が主語か見出しとして来る文と、「…を有する監理技術者を配置する」の形の文。
// 会社の語の直後に並べる語が続く文は、会社と技術者を並べた文とみて、会社への条件として残す。
// 「共同企業体の配置予定技術者は」のように会社の語が技術者を修飾するだけなら、技術者の文のまま。
// 「入札参加者と雇用関係にある技術者は」の「と」は並べる語ではない
const ENGINEER_HEAD = /技術者(?:等|など)?(?:は|が|の要件|の経験|の資格)/;
const COMPANY = '(?:入札参加者|企業体?|会社|法人|申請者)';
const LIST_WORD = '(?:及び|および|並びに|ならびに|又は|または|若しくは|もしくは)';
const COMPANY_LISTED = new RegExp(`${COMPANY}(?:等|など)?[\\s　]*(?:${LIST_WORD}|・|と(?![^、。]*(?:関係|雇用)))`);
// 実績の条件が先に来て閉じた形。「…実績を有する配置予定技術者は」のように実績が技術者を修飾する形は含めない
const PAST_WORK_FIRST = new RegExp(`実績(?:.*(?:こと|もの|(?<!技術)者))?(?:${LIST_WORD}|かつ)|実績.*(?:有し(?![てた])|あり|${COMPANY})`);
const ENGINEER_HOLDER = /有する(?:専任の)?(?:監理|主任)技術者(?:(?:又は|または|若しくは|もしくは|及び|および|・)(?:監理|主任)技術者)?(?:を[^、。]{0,12}(?:配置|置く)|であること)/;
// 次の文で下請けの実績も認める形。否定は SUB_EXCLUDED より広く見る(語の間が12字を超える文、「含めない」)。
// 「許可」「認可」の字は認める語にしない
const BUT_HEAD = /^[(（]?(?:ただし|但し)/;
const SUB_DENIED = /(?:認め|含め)(?:られ)?(?:てい)?(?:な|ず|ません)|不可/;
const SUB_ALLOWED = /認め|含(?:む|め|みます)|(?<![許認])可|差し支え|でもよい|も対象/;
const ITEM_HEAD = /\n(?=[\s　]*[(（]?[0-9０-９]+[)）.．])/;

// 改行を除いた文の列。PDF の折り返しと括弧の中の「。」では切らず、「。」と番号の付いた行の頭で切る
const sentences = (text) => String(text ?? '').split(ITEM_HEAD).flatMap((part) => splitSentences(part))
  .map((s) => s.replace(/[\s　]*\n[\s　]*/g, '').trim()).filter(Boolean);

function isEngineerSentence(s) {
  const head = s.split(/[、。]/)[0];
  const at = head.search(ENGINEER_HEAD);
  if (at >= 0 && !COMPANY_LISTED.test(head.slice(0, at)) && !PAST_WORK_FIRST.test(head.slice(0, at))) return true;
  const holder = s.search(ENGINEER_HOLDER);
  if (holder < 0) return false;
  // 実績の条件が先に来た形として見るのは、読点の無い文だけ
  const before = s.slice(0, holder);
  return before.includes('、') || !PAST_WORK_FIRST.test(before);
}

function isPrimeCondition(s) {
  if (!EXPERIENCE.test(s) || !REQUIRED.test(s) || NOT_REQUIRED.test(s) || NOT_CONDITION.test(s) || isEngineerSentence(s)) return false;
  if (EITHER.some((re) => re.test(s))) return false;
  return PRIME.test(s) || SUB_EXCLUDED.test(s);
}

const allowsSubcontract = (s) => BUT_HEAD.test(s) && s.includes('下請') && !SUB_EXCLUDED.test(s) && !SUB_DENIED.test(s) && SUB_ALLOWED.test(s);

// 当たった最初の文を返す。次の文が下請けの実績も認めていれば、その文は当たりにしない。無ければ null
export function findPrimeExperience(text) {
  const list = sentences(text);
  return list.find((s, i) => isPrimeCondition(s) && !allowsSubcontract(list[i + 1] ?? '')) ?? null;
}

export const PRIME_CHECK_KEY = 'prime-experience';
export const PRIME_CHECK_LABEL = '元請けの施工実績';
export const primeMessage = (quote) => 'この工事は元請けとしての施工実績を参加の条件にしています。初めて元請けをする会社は参加できない場合があります。発注者が認める実績の範囲は、公告と説明書で確かめてください。公告の文: 「' + quote + '」';

// 台帳の値の読み方(F29b): 値が書いてあっても、そこから決められないことを見分ける。推測で決めず「判断できない」に回すために使う。
// どちらも書いてある語の形だけを見る。資格が工事の業種に合うか・発注者の実際の法人の形は見ない。

const norm = (s) => String(s ?? '').normalize('NFKC').replace(/[\s　]+/g, ' ').trim();

// 主任技術者資格は、施行規則 第14条の2 第1項 第二号ホのとおり、法第7条第2号イ・ロの実務の経験・学科の修得か、同号ハの認定。
// 欄の値から、どの資格かが読めるときだけ区分が決まるとする(一覧に無い書き方は「決められない」に倒す)。
// 「実務経験」だけは、イかロかが決まらないので決められない。「施工管理技士」は級と種目が要る。「技士補」は主任技術者資格ではない
const NAMED_QUALIFICATION = [
  /[12一二]級(?:土木|建築|電気工事|管工事|造園|建設機械|電気通信工事)施工管理技士(?!補)/,
  /[12一二]級建設機械施工技士(?!補)/,
  /[12一二]級建築士|木造建築士/,
  /技術士(?!補)/,
  /技能士/,
  /基幹技能者/,
  /第?[12一二]種電気工事士/,
  /電気主任技術者|電気通信主任技術者/,
  /消防設備士/,
  /監理技術者資格者証/,
  /(?:第?7条|第?七条)第?(?:2|二)号(?:イ|ロ|ハ)/,
  /指定学科/,
  /大臣(?:の)?認定/,
];
export function qualificationUnclear(value) {
  const s = norm(value);
  if (s === '') return false; // 空は「空」として別に扱う
  return !NAMED_QUALIFICATION.some((re) => re.test(s));
}

// 許可番号の欄の値が許可番号の形か(F31e)。知事か大臣の許可で、般か特があり、「第…号」があるときだけ true。
// 番号を伏せた「第xxxx号」も形として読む。番号があっても「更新申請中」「不要」などが添えてあれば、今も許可があるかは語の形から決めない
const LICENSE_RE = /(?:知事|大臣)の?(?:許可)?[(\[〔【]?(?:一般|特定|般|特)[^第]{0,8}第[0-9xX〇○一二三四五六七八九十百千]+号/;
const LICENSE_DOUBT_RE = /申請|予定|不要|取得中|未取得|手続|失効|取消|取り消|なし|無し|該当せず|非該当/;
export function licenseShaped(value) {
  const s = String(value ?? '').normalize('NFKC').replace(/\s+/g, '');
  return LICENSE_RE.test(s) && !LICENSE_DOUBT_RE.test(s);
}

// 発注者の名前から公共・民間を読む。読めないときは null(個人・公社・独立行政法人・組合などは決めない)
const PRIVATE_RE = /株式会社|有限会社|合同会社|合名会社|合資会社|\(株\)|\(有\)|医療法人|社会福祉法人|学校法人|宗教法人|一般社団法人|一般財団法人|公益社団法人|公益財団法人|特定非営利活動法人|NPO法人|管理組合/;
const PUBLIC_NOT_RE = /公社|公団|機構|組合|独立行政法人|大学法人/;
// 町・村は名字(中村 太郎)と取り違えないよう前に2字以上を求める
const ORG_TAIL = '\\S*(?:部|課|局|室|事務所)(?:$|[ (])';
const AFTER = '(?=$|[ (]|長|役所|役場|庁|議会|教育委員会|' + ORG_TAIL + ')';
const LOCAL_RE = new RegExp('^(?:東京都|北海道|大阪府|京都府|\\S*?県|\\S+?市|\\S+?区|\\S{2,}?町|\\S{2,}?村)' + AFTER);
const NATIONAL_RE = new RegExp('^(?:国(?=$|[ (])|\\S+?[省庁](?=$|[ (]|' + ORG_TAIL + '))');
export function ordererReadsAs(name) {
  const s = norm(name);
  if (s === '') return null;
  if (PRIVATE_RE.test(s)) return 'private';
  if (PUBLIC_NOT_RE.test(s)) return null;
  return LOCAL_RE.test(s) || NATIONAL_RE.test(s) ? 'public' : null;
}

// 台帳の発注者の名前と、画面で選んだ公共・民間が食い違って読めるか
export function ordererConflict(project) {
  const type = project?.ordererType;
  if (type !== 'public' && type !== 'private') return false;
  const read = ordererReadsAs(project?.orderer);
  return read !== null && read !== type;
}

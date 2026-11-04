// 会社・団体の名前の規則(F24a)。業界を問わない。語の一覧は src/mask/company-types.mjs(出典つき)から読む。
// 置き換えの部品(core.mjs)が使う。規則は3つ:
//   company-before: 名前 +(空白)+ 法人格。例「みほん建設株式会社」「甲野建設 株式会社」「甲野建設㈱」「甲野建設(株)」
//   company-after:  法人格 +(空白)+ 名前。例「株式会社さくら」「社会福祉法人 みほん会」「㈲甲野」
//   org-suffix:     法人格の無い団体・施設の名前(名前 + 語尾)。例「甲野工務店」「ひまわり幼稚園」「みほん町役場」。確信の弱い語として扱う
// 名前の部分には、漢字・カタカナ・英数字のほかにひらがなも入れてよい。ただし、文の中のひらがな(「は」「として」「した」など)の所で切る:
//   法人格の前の名前は、漢字・カタカナのすぐ後ろの「は・が・を・に・で・と・の・へ・も・や」などより前を捨てる(「当社はみほん建設株式会社」→「みほん建設株式会社」)
//   法人格の後ろの名前は、ひらがなが続かない所の「は・が・の・と・として」などから後ろを捨てる(「株式会社さくらは」→「株式会社さくら」)
// 法人格と名前のあいだの空白は1字(半角・全角)まで許す。空白を挟むときは、どちらの側の名前かを次のように決める:
//   「名前 空白 法人格」は、法人格のすぐ後ろに名前の字が続かないときだけ取る。前の名前が欄名(「代表者」「会社名」など)なら取らない
//   「法人格 空白 名前」は、法人格のすぐ前に名前の字が無いとき、または前の語が欄名のときだけ取る。後ろの語が役職など(「代表取締役」「御中」)なら取らない
//   括弧の略し方(「(有)」など)は、様式の「有・無」の欄と紛れるので、空白を挟む形では取らない
// 「(有)」「(医)」「(学)」など様式の印と同じ形の略し方(AMBIGUOUS_ABBREVIATIONS)は、隣に字があるだけでは会社名と決めない。
//   前の語 + 略し方: 語が団体の語尾で終わる・前に欄名がある・後ろが「御中」「と契約」などのときだけ取る(abbrBefore)
//   略し方 + 後ろの語: 前に字が無い・前が欄名か助詞・後ろの語が団体の語尾で終わるときだけ取る(abbrAfter)
// 法人格だけの一般の文(「当社は株式会社です」「株式会社又は合同会社」「株式会社法」)は取らない(CORP_TAIL_*)
// 施設の名前(F31c):
//   org-suffix: 施設の語尾なら、名前の途中のひらがなも入れる(「さくら市立ひまわり幼稚園」「甲野ひまわり幼稚園」)。ひらがなは3字以上で、活用の字で終わらないもの(「大きな病院」「通っている幼稚園」は取らない)
//   facility-head: 施設の種類の語 + 名前(「デイサービスセンターひまわり」「特別養護老人ホームさくらの里」)。種類の語も合わせて1つに置き換える
//   facility-operator: 福祉・医療・学校などの法人の名前の空白の後ろの、「園」などで終わる短い名前(「社会福祉法人みほん会 ためし園」)

import {
  CORPORATE_TYPES, CORPORATE_ABBREVIATIONS, ENCLOSED_CORPORATE_CHARS, FACILITY_SUFFIXES_LAW, ORG_SUFFIXES_CUSTOM,
  ORG_GENERIC_WORDS, COMPANY_LABEL_WORDS, COMPANY_ROLE_WORDS,
  AMBIGUOUS_ABBREVIATIONS, ORG_SUFFIX_GENERIC_WORDS, PREFECTURE_NAMES_KEN, CORP_TAIL_SENTENCE_WORDS, CORP_TAIL_SYSTEM_WORDS,
  FACILITY_HEAD_WORDS, FACILITY_HEAD_TAIL_WORDS, FACILITY_HEAD_TAIL_CHARS, FACILITY_OPERATOR_TYPES, FACILITY_OPERATOR_ABBREVIATIONS,
  FACILITY_SHORT_SUFFIXES, FACILITY_SHORT_NON_NAMES,
} from './company-types.mjs';

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const alt = (words) => [...new Set(words)].sort((a, b) => b.length - a.length).map(escapeRe).join('|');

// 名前の字(ひらがなを除く)と、ひらがな
const SOLID = '\\p{Script=Han}\\p{Script=Katakana}ー々〆ヶA-Za-z0-9Ａ-Ｚａ-ｚ０-９＆&・';
const HIRA = '\\p{Script=Hiragana}';
const NAME = `[${SOLID}${HIRA}]`;
const SP = '[ \\u3000]';
const isHira = (c) => !!c && /\p{Script=Hiragana}/u.test(c);
const isSolid = (c) => !!c && new RegExp(`[${SOLID}]`, 'u').test(c);
const isNameChar = (c) => isHira(c) || isSolid(c);
const HIRA_RUN = `[${HIRA}]*`;

// 囲み文字: U+3200〜U+33FF の字を NFKC で正規化し、法人の種類の字(括弧を外した形)か法人の種類の語になる字を拾う
export function enclosedCorporateChars() {
  const out = [];
  for (let cp = 0x3200; cp <= 0x33ff; cp++) {
    const c = String.fromCodePoint(cp);
    const n = c.normalize('NFKC');
    if (n === c) continue;
    const inner = n.replace(/^\((.+)\)$/u, '$1');
    if (ENCLOSED_CORPORATE_CHARS.includes(inner) || CORPORATE_TYPES.includes(n)) out.push(c);
  }
  return out;
}
export const ENCLOSED_CHARS = enclosedCorporateChars();

const PAREN_ABBR = `[(（]${SP}?(?:${alt(CORPORATE_ABBREVIATIONS)})${SP}?[)）]`;
const PAREN_ABBR_RE = new RegExp(`^${PAREN_ABBR}$`, 'u');
const AMBIGUOUS_ABBR_RE = new RegExp(`^[(（]${SP}?(?:${alt(AMBIGUOUS_ABBREVIATIONS)})${SP}?[)）]$`, 'u');
export const CORP = `(?:${alt(CORPORATE_TYPES)}|${PAREN_ABBR}|[${ENCLOSED_CHARS.join('')}])`;
// 法人格の後ろの名前は、次の法人格の手前で止める(「株式会社甲野及び株式会社乙川」の後ろの名前も別に見つける)
const NAME_NOT_CORP = `(?:(?!${CORP})${NAME})`;

// 文の中のひらがなの切れ目(長い順に試す)
const BREAKS = [
  '及び', '又は', '若しくは', '並びに', 'および', 'または', 'もしくは', 'ならびに',
  'における', 'について', 'において', 'として', 'による', 'にある', 'である', 'となる', 'された', 'される', 'させる', 'している',
  'できる', 'でした', 'です', 'した', 'する', 'して', 'され', 'から', 'まで', 'より', 'など', 'では', 'には', 'とは', 'との', 'への', 'ない', 'れる', 'った',
  'は', 'が', 'を', 'に', 'で', 'と', 'の', 'へ', 'も', 'や',
].sort((a, b) => b.length - a.length);
// 名前の頭に来ても名前ではないひらがなの語
const FUNC_HEAD = ['これ', 'それ', 'あれ', 'この', 'その', 'あの', 'どの', 'ここ', 'そこ', 'また', 'および', 'または', 'ならびに', 'もしくは',
  'かつ', 'ほか', 'すべて', 'ある', 'いる', 'なる', 'する', 'した', 'できる'].sort((a, b) => b.length - a.length);

const breakAt = (s, i) => BREAKS.find((b) => s.startsWith(b, i)) || '';

// 法人格の前の名前の頭を切る。返すのは名前の中で残す所の始まり(残らなければ -1)
export function trimHead(name) {
  let cut = 0;
  for (let i = 0; i < name.length; i++) {
    const b = breakAt(name, i);
    if (!b) continue;
    const before = name[i - 1];
    const after = name[i + b.length];
    if (i === 0 ? (after !== undefined && !isHira(after)) : isSolid(before)) cut = Math.max(cut, i + b.length);
  }
  let s = name.slice(cut);
  for (let changed = true; changed;) {
    changed = false;
    const f = FUNC_HEAD.find((w) => s.startsWith(w) && s.length > w.length);
    if (f) {
      let k = f.length;
      k += breakAt(s, k).length;
      if (k < s.length) { cut += k; s = s.slice(k); changed = true; }
    }
  }
  if (!s || FUNC_HEAD.includes(s)) return -1;
  return cut;
}

// 法人格の後ろの名前の終わりを切る。返すのは名前の中で残す長さ(0 なら残らない)
// 名前の終わりの1字のひらがな(「株式会社やまと」の「と」)は、前が漢字・カタカナのときだけ切る(「株式会社甲野と」)。
// ひらがなの後ろの「と・の・に・で」は名前の中によく出るので切らない(「株式会社ふもと野ロジ」「株式会社ひのき」)。
// そのため「株式会社さくらと契約」は「と契約」まで置き換える(漏らすより置き換えすぎの方にする)
const INNER_OK = ['と', 'の', 'に', 'で'];
export function trimTail(name) {
  for (let i = 0; i < name.length; i++) {
    const b = breakAt(name, i);
    if (!b) continue;
    const after = name[i + b.length];
    const prevHira = i > 0 && isHira(name[i - 1]);
    if (prevHira && INNER_OK.includes(b)) continue;
    if (after === undefined) {
      if (i > 0 && (b.length > 1 || isSolid(name[i - 1]))) return i;
    } else if (!isHira(after)) return i;
  }
  return name.length;
}

// 名前から一般の語・数・「第」などを除いて残る字の数
const FILLER = /[0-9０-９A-Za-zＡ-Ｚａ-ｚ・\s　()（）]|令和|平成|年度|第|号/gu;
const GENERIC = [...new Set([...ORG_GENERIC_WORDS, '等', '及び', '又', '又は', '以外', '以下', '各種'])].sort((a, b) => b.length - a.length);
const ORG_GENERIC = [...new Set([...GENERIC, ...ORG_SUFFIX_GENERIC_WORDS])].sort((a, b) => b.length - a.length);
const countRest = (name, words) => {
  let s = name.replace(FILLER, '');
  for (const g of words) s = s.split(g).join('');
  return s.length;
};
export const restLength = (name) => countRest(name, GENERIC);
// 語尾の規則の名前の残り。「二人組」の「二人」のような人数も名前にしない
const orgRestLength = (name) => countRest(name.replace(/[一二三四五六七八九十百数何]人/gu, ''), ORG_GENERIC);

const CORP_WORD = new RegExp(alt(CORPORATE_TYPES), 'gu');
const CORP_TAIL_SENTENCE = new Set([...CORP_TAIL_SENTENCE_WORDS, ...BREAKS, ...FUNC_HEAD]);
const CORP_TAIL_SYSTEM = new RegExp(`^(?:${alt(CORP_TAIL_SYSTEM_WORDS)}|法(?:第.*|改正|施行.*)?)$`, 'u');
// 法人格の後ろに続いても名前ではない語か(文の続き・制度の語・別の法人格だけ)
const isCorpTailWord = (kept) => CORP_TAIL_SENTENCE.has(kept) || CORP_TAIL_SYSTEM.test(kept) || restLength(kept.replace(CORP_WORD, '')) < 1;

const LABEL_END = new RegExp(`(?:${alt(COMPANY_LABEL_WORDS)})$`, 'u');
const ROLE_HEAD = new RegExp(`^(?:${alt(COMPANY_ROLE_WORDS)})`, 'u');

// 前の語(空白の前の、名前の字の並び)を返す
function wordBefore(text, end) {
  let i = end;
  while (i > 0 && isNameChar(text[i - 1])) i--;
  return text.slice(i, end);
}

const ORG_SUFFIXES = [...FACILITY_SUFFIXES_LAW, ...ORG_SUFFIXES_CUSTOM];
const ORG_SUFFIX_END = new RegExp(`(?:${alt(ORG_SUFFIXES)})$`, 'u');
// 語尾の前に名前が2字以上残る、団体の名前の形か
function endsLikeOrg(name) {
  const m = name.match(ORG_SUFFIX_END);
  return !!m && orgRestLength(name.slice(0, name.length - m[0].length)) >= 2;
}
const LABEL_THEN_SEP = new RegExp(`(?:${alt(COMPANY_LABEL_WORDS)})[\\s\\u3000:：|｜]*$`, 'u');
const FOLLOWS_COMPANY = new RegExp(`^[ \\u3000]?(?:${alt(COMPANY_ROLE_WORDS)}|[とに]契約|[にへ]発注|[にへ]委託|[にへ]下請)`, 'u');
const PARTICLES = ['は', 'が', 'を', 'に', 'で', 'と', 'の', 'へ', 'も', 'や'];

// 「前の語 + (有)」を会社名として取るか。「資格(有)」「指導医(医)」は取らない
function abbrBefore(kept, text, start, end) {
  return endsLikeOrg(kept) || LABEL_THEN_SEP.test(text.slice(Math.max(0, start - 20), start)) || FOLLOWS_COMPANY.test(text.slice(end, end + 8));
}
// 「(有) + 後ろの語」を会社名として取るか。「既往症(有)高血圧」「学籍(学)番号」は取らない
function abbrAfter(kept, text, index) {
  if (kept.startsWith('・')) return false;
  const prev = text[index - 1];
  if (!isNameChar(prev) || prev === '・' || endsLikeOrg(kept)) return true;
  if (LABEL_END.test(wordBefore(text, index))) return true;
  return PARTICLES.includes(prev) && isSolid(text[index - 2]);
}

export const COMPANY_RULES = [
  { id: 'company-before', name: '名前 + 法人格', example: 'みほん建設株式会社・甲野建設 株式会社・甲野建設㈱' },
  { id: 'company-after', name: '法人格 + 名前', example: '株式会社さくら・社会福祉法人 みほん会' },
  { id: 'org-suffix', name: '法人格の無い団体・施設の語尾', example: '甲野工務店・ひまわり幼稚園・みほん町役場' },
];

// 会社名の形(法人格のあるもの)。core.mjs の形として使う
export function companyPatterns(kind = 'company') {
  const before = {
    kind,
    re: new RegExp(`(${NAME}{1,30}?)(${SP}?)(${CORP})`, 'gu'),
    trim(word, index, text) {
      const m = word.match(new RegExp(`^(${NAME}{1,30}?)(${SP}?)(${CORP})$`, 'u'));
      if (!m) return null;
      const [, whole, sp, corp] = m;
      // 名前の中に別の法人格があれば、その後ろだけを名前にする(「株式会社甲野・株式会社乙川」の「株式会社甲野・」は名前にしない)
      const last = [...whole.matchAll(CORP_WORD)].at(-1);
      const skip = last ? last.index + last[0].length : 0;
      const name = whole.slice(skip);
      const trimmed = trimHead(name);
      if (trimmed < 0) return null;
      const h = skip + trimmed;
      const kept = whole.slice(h);
      if (restLength(kept) < 1 || kept.endsWith('・') || (last && CORP_TAIL_SENTENCE.has(kept))) return null;
      if ([...kept].length === 1 && isHira(kept)) return null;
      // 名前がひらがなの切れ目(「は」「として」など)で終わり、法人格のすぐ後ろに名前が続くときは、後ろの名前の方を取る
      // (「下請けは株式会社乙川土工」。「やまと株式会社」のように後ろに名前が無ければ取る)
      const endBreak = BREAKS.find((b) => kept.endsWith(b) && kept.length > b.length);
      if (endBreak && (endBreak.length > 1 || isNameChar(text[index + word.length]))) return null;
      if (AMBIGUOUS_ABBR_RE.test(corp) && !abbrBefore(kept, text, index + h, index + word.length)) return null;
      if (sp) {
        if (PAREN_ABBR_RE.test(corp)) return null;
        if (isNameChar(text[index + word.length])) return null;
        if (LABEL_END.test(kept)) return null;
      }
      return [h, word.length];
    },
  };
  const after = {
    kind,
    re: new RegExp(`(${CORP})(${SP}?)(${NAME_NOT_CORP}{1,30})`, 'gu'),
    trim(word, index, text) {
      const m = word.match(new RegExp(`^(${CORP})(${SP}?)(${NAME_NOT_CORP}{1,30})$`, 'u'));
      if (!m) return null;
      const [, corp, sp, name] = m;
      // 名前の終わりの「・」は区切り(「(有)甲野・(有)乙川」)
      const len = trimTail(name.replace(/・+$/u, ''));
      const kept = name.slice(0, len);
      if (!kept || restLength(kept) < 1) return null;
      if ([...kept].length === 1 && isHira(kept)) return null;
      if (isCorpTailWord(kept)) return null;
      if (AMBIGUOUS_ABBR_RE.test(corp) && !abbrAfter(kept, text, index)) return null;
      if (sp) {
        if (PAREN_ABBR_RE.test(corp)) return null;
        if (ROLE_HEAD.test(kept)) return null;
        const prev = text[index - 1];
        if (isNameChar(prev)) return null;
        if (prev === ' ' || prev === '　') {
          const w = wordBefore(text, index - 1);
          if (w && !LABEL_END.test(w)) return null;
        }
      }
      return [0, corp.length + sp.length + len];
    },
  };
  return [before, after];
}

export const FACILITY_RULES = [
  { id: 'facility-head', name: '施設の種類の語 + 名前', example: 'デイサービスセンターひまわり・グループホーム甲野' },
  { id: 'facility-operator', name: '法人の名前の後ろの施設の名前', example: '社会福祉法人みほん会 ためし園' },
];

// 名前の途中にひらがなを入れてよい語尾(施設)。「新たな建設」のような文を取らないよう、会社の語尾には使わない
const MIXED_NAME_SUFFIXES = new Set([...FACILITY_SUFFIXES_LAW, 'クリニック', '医院', 'デイサービスセンター', 'グループホーム']);
const PLAIN_NAME = new RegExp(`^${HIRA_RUN}[${SOLID}]*$`, 'u');
const MIXED_NAME = new RegExp(`^${HIRA_RUN}[${SOLID}]+[${HIRA}]{3,}[${SOLID}]*$`, 'u');
const INFLECTED = /[るたいなだくてでう]$/u;
function nameShapeOk(kept, sfx) {
  if (PLAIN_NAME.test(kept)) return true;
  if (!MIXED_NAME_SUFFIXES.has(sfx) || !MIXED_NAME.test(kept)) return false;
  // 途中のひらがなの並びが活用の字で終わるなら文の一部(「通っている」「素晴らしい」)
  return ![...kept.matchAll(new RegExp(`[${HIRA}]+`, 'gu'))].some((m) => m.index > 0 && INFLECTED.test(m[0]));
}

// 法人格の無い団体・施設の名前の規則(文脈の規則として、確信の弱い語にする)
export function orgSuffixPatterns({ kind = 'company', suffixes = ORG_SUFFIXES, minRest = 2 } = {}) {
  const suffixAlt = alt(suffixes);
  const re = new RegExp(`${NAME}{1,30}?(?:${suffixAlt})(?![\\p{Script=Han}\\p{Script=Katakana}ー々])`, 'gu');
  const suffixEnd = new RegExp(`(?:${suffixAlt})$`, 'u');
  return [{
    kind,
    rule: 'org-suffix',
    re,
    trim(word) {
      const sfx = word.match(suffixEnd)[0];
      const name = word.slice(0, word.length - sfx.length);
      const h = trimHead(name);
      if (h < 0) return null;
      const kept = name.slice(h);
      // ひらがなは名前の頭だけ(「ひまわり幼稚園」「みほん市役所」)。漢字のあとのひらがな(「新たな建設」)は名前にしない。施設の語尾は nameShapeOk
      if (!nameShapeOk(kept, sfx)) return null;
      if (orgRestLength(kept) < minRest) return null;
      if (sfx === '県庁' && PREFECTURE_NAMES_KEN.includes(kept)) return null;
      return [h, word.length];
    },
  }];
}

const SENTENCE_IN_TAIL = /ます|ません|ない|ある|あり|いる|する|した|です|でした|よう|こと|もの|ため|とき|ところ|として/u;
const HEAD_NOT_NAME = new RegExp(`^(?:${alt(FACILITY_HEAD_TAIL_WORDS)})`, 'u');
const NOT_A_FLOOR = /^[0-9０-９一二三四五六七八九十第]+[階棟号館室名人床]/u;
const headTailNotName = (kept) => HEAD_NOT_NAME.test(kept) || FACILITY_HEAD_TAIL_CHARS.includes(kept) || NOT_A_FLOOR.test(kept)
  || BREAKS.some((b) => b.length > 1 && kept.startsWith(b)) || (isHira(kept[0]) && SENTENCE_IN_TAIL.test(kept));
const NON_NAME_END = new RegExp(`(?:${alt(FACILITY_SHORT_NON_NAMES)})$`, 'u');

// 施設の名前の規則(F31c)。文脈の規則として使う(確信の弱い語)
export function facilityPatterns(kind = 'company') {
  const headAlt = alt(FACILITY_HEAD_WORDS);
  const NEXT = `(?:(?!${headAlt}|${CORP})${NAME})`;
  const head = {
    kind,
    rule: 'facility-head',
    re: new RegExp(`(?:${headAlt})${SP}?${NEXT}{1,20}`, 'gu'),
    trim(word) {
      const h = word.match(new RegExp(`^(?:${headAlt})${SP}?`, 'u'))[0];
      const name = word.slice(h.length).replace(/・+$/u, '');
      // ひらがなの名前の後ろの「の職員」「に入居」は trimTail では切れないので、ここで切る(「さくらの里」の「の里」は残す)
      const cut = [...name].findIndex((c, i) => i > 0 && PARTICLES.includes(c) && HEAD_NOT_NAME.test(name.slice(i + 1)));
      const len = cut > 0 ? cut : trimTail(name);
      const kept = name.slice(0, len);
      if (!kept || headTailNotName(kept) || isCorpTailWord(kept)) return null;
      if (kept.replace(FILLER, '').length < 2) return null;
      return [0, h.length + len];
    },
  };
  const operator = `(?:${alt(FACILITY_OPERATOR_TYPES)}|[(（](?:${alt(FACILITY_OPERATOR_ABBREVIATIONS)})[)）])`;
  const suffix = alt(FACILITY_SHORT_SUFFIXES);
  const after = {
    kind,
    rule: 'facility-operator',
    re: new RegExp(`(?<=${operator}${SP}?${NAME}{1,30}${SP})${NAME}{1,20}?(?:${suffix})(?![\\p{Script=Han}\\p{Script=Katakana}ー々])`, 'gu'),
    trim(word) {
      if (NON_NAME_END.test(word)) return null;
      const sfx = word.match(new RegExp(`(?:${suffix})$`, 'u'))[0];
      if (orgRestLength(word.slice(0, word.length - sfx.length)) < 2) return null;
      return [0, word.length];
    },
  };
  return [head, after];
}

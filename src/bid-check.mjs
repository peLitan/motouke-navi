// 入札前の確認(F10): 案件の条件から、受注したら要るものを根拠の条つきで並べる。
// 「入札すべき」「参加できる」とは出さない。判断の材料と確認が要る点を並べ、最後の判断は人がする。
// 金額の境目は、取得した原文の抜き書き(data/quotes.json)の漢数字から読み取り、コードに書かない。
// 施工体制台帳と写しは、F03a・F03b の規則表(src/taicho.mjs)の判定をそのまま使う。
import quotesData from '../data/quotes.json' with { type: 'json' };
import sourcesData from '../data/sources/index.json' with { type: 'json' };
import { judgeTaicho, resolveQuoteIds } from './taicho.mjs';
import { findPrimeExperience, primeMessage, PRIME_CHECK_KEY, PRIME_CHECK_LABEL } from './prime-experience.mjs';
import { laborDuties } from './labor-duty.mjs';

const QUOTES = quotesData.quotes;
const SOURCES = sourcesData.sources;
const quoteText = (id) => {
  const q = QUOTES.find((x) => x.id === id);
  if (!q) throw new Error('抜き書きが無い: ' + id);
  return q.text;
};
const basisOf = (...ids) => resolveQuoteIds(ids.map((quoteId) => ({ quoteId })), QUOTES, SOURCES, '入札前の確認');

// 漢数字の金額(「四千五百万円」「九千万円」「一億二千万円」)を円の数にする。読めなければ例外
const DIGIT = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
export function kanjiUnder10000(s) {
  if (s === '') return 0;
  let total = 0;
  let rest = s;
  for (const [u, c] of [[1000, '千'], [100, '百'], [10, '十']]) {
    const i = rest.indexOf(c);
    if (i < 0) continue;
    const head = rest.slice(0, i);
    if (head.length > 1 || (head && !DIGIT[head])) throw new Error('漢数字を読めない: ' + s);
    total += (head ? DIGIT[head] : 1) * u;
    rest = rest.slice(i + 1);
  }
  if (rest.length > 1 || (rest && !DIGIT[rest])) throw new Error('漢数字を読めない: ' + s);
  return total + (rest ? DIGIT[rest] : 0);
}
export function kanjiYen(s) {
  const m = String(s).match(/^(?:([一二三四五六七八九十百千]+)億)?(?:([一二三四五六七八九十百千]+)万)?円$/);
  if (!m || (!m[1] && !m[2])) throw new Error('金額を読めない: ' + s);
  return kanjiUnder10000(m[1] ?? '') * 100_000_000 + kanjiUnder10000(m[2] ?? '') * 10_000;
}
const AMOUNT = '((?:[一二三四五六七八九十百千]+億)?(?:[一二三四五六七八九十百千]+万)?円)';

// 技術者を専任で置く工事の金額(施行令 第27条第1項)。原文の「…四千五百万円（…建築一式工事である場合にあつては、九千万円）以上」から読む
export function dedicatedThreshold() {
  const text = quoteText('q-rei-27-1');
  const m = text.match(new RegExp('請負代金の額が' + AMOUNT + '（当該建設工事が建築一式工事である場合にあつては、' + AMOUNT + '）以上'));
  if (!m) throw new Error('施行令 第27条の抜き書きから金額を読めない');
  return { other: kanjiYen(m[1]), kenchiku: kanjiYen(m[2]), basis: basisOf('q-rei-27-1')[0] };
}

// 特定建設業の許可が要る下請けの総額(施行令 第2条)。原文の「…五千万円とする。ただし、…建築工事業である場合においては、八千万円とする。」から読む
export function licenseThreshold() {
  const text = quoteText('q-rei-2-1');
  const m = text.match(new RegExp('金額は、' + AMOUNT + 'とする。ただし、同項の許可を受けようとする建設業が建築工事業である場合においては、' + AMOUNT + 'とする。'));
  if (!m) throw new Error('施行令 第2条の抜き書きから金額を読めない');
  return { other: kanjiYen(m[1]), kenchiku: kanjiYen(m[2]), basis: basisOf('q-rei-2-1')[0] };
}

const yen = (n) => n.toLocaleString('ja-JP') + '円';
const isAmount = (x) => typeof x === 'number' && Number.isFinite(x) && x >= 0;
const isKenchiku = (input) => input.workType === 'kenchiku-ikkatsu';
const KENCHIKU_READING = 'このツールは、建築一式工事を建築工事業の許可で請け負うものと読み、施行令 第2条のただし書(建築工事業)の金額を使う。許可の業種が建築工事業でなければ、境目が変わるので確かめる';

// 発注者から直接請け負い、下請けの総額が施行令 第2条の金額以上か(建設業法 第3条第1項第2号・第26条第2項の要件)
// 返り値: true / false / null(入力が足りない)
function overLicenseLine(input, t) {
  if (input.direct === false || input.hasSubcontract === false) return false;
  if (input.direct !== true || input.hasSubcontract !== true || !isAmount(input.subcontractTotal) || !input.workType) return null;
  return input.subcontractTotal >= (isKenchiku(input) ? t.kenchiku : t.other);
}

function tokuteiItem(input, t) {
  const over = overLicenseLine(input, t);
  const line = isKenchiku(input) ? t.kenchiku : t.other;
  const item = {
    key: 'tokutei-license',
    label: '特定建設業の許可',
    basis: basisOf('q-kensetsu-3-1', 'q-kensetsu-3-1-2', 'q-rei-2-1'),
    exceptions: [
      '建設業法 第3条第1項のただし書: 政令で定める軽微な建設工事のみを請け負う者は許可が要らない(この確認は特定建設業の許可の区分を見るためのもので、軽微な工事かは判定していない)',
      '施行令 第2条のただし書: 許可を受けようとする建設業が建築工事業なら、金額は建築工事業の金額になる。' + KENCHIKU_READING,
      '許可は業種ごと(建設業法 第3条第2項)。この工事の業種で特定建設業の許可を持っているかを許可通知書などで確かめる',
      '金額は税込みで比べる(国交省 建設業許可事務ガイドライン【その他】2.。結果の amountBasis に抜き書き)',
    ],
  };
  if (over === null) return { ...item, status: 'needs_check', note: '発注者から直接か・下請けの有無・下請けの総額(税込み)・工事の種類の入力が足りないので判定できない' };
  if (!over) {
    const why = input.direct === false ? '発注者から直接請け負う工事ではない(第3条第1項第2号は発注者から直接請け負う工事が対象)'
      : input.hasSubcontract === false ? '下請契約を結ばない'
      : '下請けの総額(税込み)が ' + yen(line) + ' 未満';
    return { ...item, status: 'not_required', note: why };
  }
  return { ...item, status: 'required', note: '発注者から直接請け負い、下請けの総額(税込み)が ' + yen(line) + ' 以上の下請契約を結んで施工するのは、特定建設業の許可の区分' };
}

function engineerItem(input, t) {
  const over = overLicenseLine(input, t);
  const line = isKenchiku(input) ? t.kenchiku : t.other;
  const item = {
    key: 'engineer',
    label: '監理技術者か主任技術者か',
    basis: basisOf('q-kensetsu-26-1', 'q-kensetsu-26-2', 'q-kensetsu-3-1-2', 'q-rei-2-1'),
    exceptions: [
      '建設業法 第26条第2項は「発注者から直接建設工事を請け負つた特定建設業者」が対象。一般建設業の許可では、この額の下請契約を結んで施工すること自体が特定建設業の許可の区分になる(第3条第1項第2号)',
      '指定建設業(第26条第2項のかっこ書)の場合は、監理技術者の資格が限られる。業種が指定建設業かを確かめる',
      '第26条第3項のただし書(専任の例外)は「技術者を専任で置く必要があるか」の項目で扱う',
      KENCHIKU_READING,
      '金額は税込みで比べる(国交省 建設業許可事務ガイドライン【その他】2.。結果の amountBasis に抜き書き)',
    ],
  };
  if (over === null) return { ...item, status: 'needs_check', value: 'unknown', note: '発注者から直接か・下請けの有無・下請けの総額(税込み)・工事の種類の入力が足りないので判定できない' };
  if (over) {
    const pre = input.license === 'tokutei' ? '' : '(第26条第2項は特定建設業者が対象。この額の下請契約を結んで施工するには特定建設業の許可が要るので、その許可を受けて施工する前提で)';
    return { ...item, status: 'required', value: 'kanri', note: '発注者から直接請け負い、下請けの総額(税込み)が ' + yen(line) + ' 以上なので、監理技術者を置く' + pre };
  }
  return { ...item, status: 'required', value: 'shunin', note: '主任技術者を置く(下請けの総額が第3条第1項第2号の金額以上にならない、または発注者から直接でない)' };
}

// 施工体制台帳・写し・施工体系図: src/taicho.mjs の判定を項目の形にする
const FROM_TAICHO = { required: 'required', not_required: 'not_required', needs_check: 'needs_check', unknown: 'needs_check' };
function uniqBasis(list) {
  const seen = new Set();
  return list.filter((b) => !seen.has(b.quoteId) && seen.add(b.quoteId));
}
const lawOnly = (list) => list.filter((b) => b.article); // 条の無い資料(ガイドライン)は amountBasis に回す

function taichoItems(input) {
  const j = judgeTaicho(input);
  const allBasis = lawOnly(uniqBasis(j.reasons.flatMap((r) => r.basis)));
  const allExc = [...new Set(j.reasons.flatMap((r) => r.exceptions))];
  const status = FROM_TAICHO[j.status];
  const taicho = {
    key: 'taicho', label: '施工体制台帳', status,
    basis: allBasis, exceptions: allExc,
    note: j.message ?? j.reasons.map((r) => r.action).join(' / '),
  };
  // 写し: copyToOrderer を決めた行の根拠を使う
  const copyReasons = j.reasons.filter((r) => /copy/.test(r.ruleId));
  const copyRules = copyReasons.length ? copyReasons : j.reasons;
  const copyStatus = { required: 'required', not_required: 'not_required', not_applicable: 'not_required', unknown: 'needs_check' }[j.copyToOrderer] ?? 'needs_check';
  const copy = {
    key: 'taicho-copy', label: '施工体制台帳の写しを発注者に出す', status: copyStatus,
    basis: lawOnly(uniqBasis(copyRules.flatMap((r) => r.basis))),
    exceptions: [...new Set(copyRules.flatMap((r) => r.exceptions))],
    note: j.copyToOrderer === 'not_applicable' ? '施工体制台帳を作らないので、出すものが無い'
      : j.copyToOrderer === 'unknown' ? (j.message ?? '判断できない') : copyRules.map((r) => r.action).join(' / '),
  };
  if (copy.basis.length === 0) copy.basis = allBasis;
  // 施工体系図: 建設業法 第24条の8第4項「第一項の特定建設業者は」→ 台帳を作る者と同じ。公共工事は入契法 第15条第1項の読み替えが第4項にも及ぶ
  const taikeizu = {
    key: 'taikeizu', label: '施工体系図', status,
    basis: uniqBasis([...basisOf('q-kensetsu-24_8-4'), ...(input.orderer === 'public' ? basisOf('q-nyukei-15-1') : []), ...allBasis]),
    exceptions: [
      '建設業法 第24条の8第4項は「第一項の特定建設業者」が作る。施工体制台帳を作る者と同じ扱いにしている',
      ...(input.orderer === 'public' ? ['入契法 第15条第1項の読み替え: 公共工事では第24条の8第4項の「特定建設業者」を「建設業者」と、「見やすい場所」を「工事関係者が見やすい場所及び公衆が見やすい場所」と読む'] : []),
    ],
    note: status === 'required' ? (input.orderer === 'public' ? '施工体系図を作り、工事関係者が見やすい場所及び公衆が見やすい場所に掲げる(入契法 第15条第1項の読み替え)' : '施工体系図を作り、工事現場の見やすい場所に掲げる') : status === 'not_required' ? '施工体制台帳を作らない場合なので、施工体系図も第24条の8第4項の対象ではない' : '施工体制台帳と同じく、先に確かめることがある',
  };
  return { items: [taicho, copy, taikeizu], amountBasis: j.amountBasis };
}

function dedicatedItem(input, t) {
  const line = isKenchiku(input) ? t.kenchiku : t.other;
  const item = {
    key: 'dedicated',
    label: '技術者を専任で置く必要があるか',
    basis: basisOf('q-kensetsu-26-3', 'q-rei-27-1', ...(input.orderer === 'public' ? ['q-rei-27-1-1'] : []), 'q-kensetsu-26-3-1', 'q-kensetsu-26-3-2', 'q-kensetsu-26-4', 'q-rei-27-2'),
    threshold: { amount: line, quote: t.basis.quote },
    exceptions: [
      '建設業法 第26条第3項のただし書: 同項第1号(請負代金が政令で定める金額未満で、移動時間・連絡方法と情報通信技術の措置の要件を満たす場合)・第2号(監理技術者を補佐する者を専任で置く場合)は専任でなくてよい。第4項の現場の数の上限もある。このツールはこれらを判定していない',
      '施行令 第27条第2項: 密接な関係のある二以上の工事を同じ場所・近い場所で施工する場合は、同じ専任の主任技術者が管理できる',
      '請負代金の額は税込みで比べる(国交省 建設業許可事務ガイドライン【その他】2.)',
    ],
  };
  if (!isAmount(input.contractAmount) || !input.workType) return { ...item, status: 'needs_check', note: '請負代金の見込み(税込み)と工事の種類を入れると判定できる' };
  if (input.contractAmount < line) return { ...item, status: 'not_required', note: '請負代金(税込み)が施行令 第27条第1項の ' + yen(line) + ' 未満' };
  if (input.orderer === 'public') {
    return {
      ...item, status: 'required',
      note: '請負代金(税込み)が ' + yen(line) + ' 以上で、施行令 第27条第1項第1号(国又は地方公共団体が注文者)に当たるものとして専任',
      exceptions: [...item.exceptions, '「公共」は入契法の公共工事として入れている。注文者が国・地方公共団体でない公共工事(特殊法人など)は第1号に当たらないので、第2号・第3号の施設・工作物かを原文で確かめる'],
    };
  }
  if (input.orderer === 'private') {
    return { ...item, status: 'needs_check', note: '請負代金(税込み)が ' + yen(line) + ' 以上。民間工事では、施設・工作物が施行令 第27条第1項第3号(学校・病院・共同住宅・事務所・工場・倉庫など)か第2号(施行令 第15条第1号・第3号の施設・工作物。第15条の原文はこのツールに取り込んでいない)に当たれば専任。当たるかは工事の対象で確かめる' };
  }
  return { ...item, status: 'needs_check', note: '発注者が公共か民間かの入力が無いので判定できない' };
}

// 入力: { orderer: 'public'|'private', direct, workType: 'kenchiku-ikkatsu'|'other', contractAmount(円・税込み), hasSubcontract,
//         subcontractTotal(円・税込み), license: 'tokutei'|'ippan', engineerQualification: 'kanri'|'shunin', ictMeasure, participationConditions(公告の参加の条件の文。任意) }
// 返り値: { items: [{ key, label, status, value?, basis, exceptions, note }], checks: [{ key, label, message }], duties(労務費と処遇の候補), amountBasis, disclaimer }
export function bidCheck(input = {}) {
  const lt = licenseThreshold();
  const dt = dedicatedThreshold();
  const tc = taichoItems(input);
  const tokutei = tokuteiItem(input, lt);
  const engineer = engineerItem(input, lt);
  const items = [tokutei, tc.items[0], tc.items[1], engineer, tc.items[2], dedicatedItem(input, dt)];

  const checks = [];
  if (tokutei.status === 'required' && input.license !== 'tokutei') {
    checks.push({ key: 'tokutei-license', label: tokutei.label, message: '受注したら特定建設業の許可の区分になるが、元請けの許可の種類が「特定」と入っていない。この業種の許可の種類を確かめる' });
  }
  const ded = items[5];
  if (ded.status === 'required' && input.orderer === 'public') {
    checks.push({ key: 'dedicated', label: ded.label, changes: true, message: '注文者が国又は地方公共団体である工事として専任と判定した(施行令 第27条第1項第1号)。注文者がそれ以外(特殊法人など)なら第1号に当たらないので、施設・工作物の種類(第2号・第3号)を確かめる' });
  }
  if (engineer.value === 'kanri' && input.engineerQualification !== 'kanri') {
    checks.push({ key: 'engineer', label: engineer.label, message: '受注したら監理技術者を置くが、置ける技術者の資格が「監理技術者」と入っていない。置ける人を確かめる' });
  }
  for (const it of items) {
    if (it.status === 'needs_check' && !checks.some((c) => c.key === it.key)) checks.push({ key: it.key, label: it.label, message: it.note });
  }
  // 元請けとしての施工実績を求める文(F49a)。法令の判定ではないので項目にせず、確認が要る点にだけ出す
  const prime = findPrimeExperience(input.participationConditions);
  if (prime) checks.push({ key: PRIME_CHECK_KEY, label: PRIME_CHECK_LABEL, message: primeMessage(prime) });
  return {
    items,
    checks,
    duties: laborDuties(input),
    amountBasis: tc.amountBasis,
    disclaimer: '受注したら要るものと確認が要る点を、取得した法令の原文の条で並べたものです。入札するかどうかの判断は、発注者の公告・仕様書と許可通知書などを確かめたうえで人がしてください',
  };
}

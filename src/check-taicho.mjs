// 施工体制台帳の点検(F04a): 台帳の入力から、抜け・食い違いの「候補」を根拠の条つきで出す。
// 候補は指摘の候補であって、合否ではない。入力から決められないことは「判断できない」(undecidable)に出し、推測で候補にしない。
// 金額の境目は、取得した原文の抜き書き(施行令 第2条)から読み、コードに書かない(src/bid-check.mjs と同じ読み方)。
//
// 入力(台帳の形):
// { project: { name, orderer, ordererType: 'public'|'private', workType: 'other'|'kenchiku-ikkatsu', contractAmount, periodFrom, periodTo },
//   prime: { name, licenseType: 'tokutei'|'ippan', licenseNumber, engineer: { role: 'kanri'|'shunin', name, qualification, dedicated } },
//   subcontractors: [ { name, licenseNumber, work, periodFrom, periodTo, amount, engineer: { role: 'shunin', name, qualification, dedicated } } ] }
//   dedicated: true(専任)/ false(非専任)/ 無い・null(台帳に書いていない。専任の点検はしない)
// 返り値: { candidates: [{ kind: 'missing'|'mismatch', target, field, message, basis, confirm? }], undecidable: [{ target, field, message, basis }], notes }
//   confirm: 候補のうち、台帳からは決められない例外(ただし書など)。人が確かめること
import quotesData from '../data/quotes.json' with { type: 'json' };
import sourcesData from '../data/sources/index.json' with { type: 'json' };
import { resolveQuoteIds } from './taicho.mjs';
import { licenseThreshold, dedicatedThreshold } from './bid-check.mjs';
import { licenseShaped } from './ledger-reading.mjs';
import { ordererConflict } from './ledger-reading.mjs';

const basisOf = (...ids) => resolveQuoteIds(ids.map((quoteId) => ({ quoteId })), quotesData.quotes, sourcesData.sources, '台帳の点検');

const blank = (x) => x === undefined || x === null || String(x).trim() === '';
const isAmount = (x) => typeof x === 'number' && Number.isFinite(x) && x >= 0;
const yen = (n) => n.toLocaleString('ja-JP') + '円';

// 台帳の下請けを指す名前。名称が空なら何件目かで指す
export const subLabel = (s, i) => (blank(s?.name) ? `下請け ${i + 1}件目(名称が空)` : String(s.name).trim());
export const primeLabel = (p) => (blank(p?.name) ? '元請け(名称が空)' : String(p.name).trim());

// 下請けの行の抜け(建設業法 第24条の8第1項: 下請負人の商号又は名称、工事の内容及び工期を台帳に書く)
function checkSubFields(s, i, out) {
  const target = subLabel(s, i);
  const b = basisOf('q-kensetsu-24_8-1-items');
  if (blank(s?.name)) out.candidates.push({ kind: 'missing', target, field: 'name', message: '下請負人の商号又は名称が空です', basis: b });
  if (blank(s?.work)) out.candidates.push({ kind: 'missing', target, field: 'work', message: '下請けの工事の内容が空です', basis: b });
  const noFrom = blank(s?.periodFrom);
  const noTo = blank(s?.periodTo);
  if (noFrom || noTo) {
    const which = noFrom && noTo ? '工期(始め・終わり)' : noFrom ? '工期の始め' : '工期の終わり';
    out.candidates.push({ kind: 'missing', target, field: 'period', message: `下請けの${which}が空です`, basis: b });
  }
}

// 技術者の抜け(建設業法 第26条第1項: 建設業者は請け負った工事に主任技術者を置く)
// 下請けの許可番号の欄に値があっても許可番号の形でなければ、建設業者とは決めず「判断できない」に出す(F31e)
function checkEngineer(owner, target, out, who) {
  const e = owner?.engineer;
  const b = basisOf('q-kensetsu-26-1');
  const lic = who === '下請け' ? owner?.licenseNumber : '';
  const notLicense = !blank(lic) && !licenseShaped(lic);
  const put = (field, message) => {
    if (!notLicense) out.candidates.push({ kind: 'missing', target, field, message, basis: b });
    else out.undecidable.push({ target, field, message: message + '。ただし許可番号の欄が「' + lic + '」で許可番号の形と読めず、建設業者とは決められないので、技術者が要るかを判断できません', basis: b });
  };
  if (!e || blank(e.name)) {
    put('engineer', `${who}の技術者(主任技術者・監理技術者)の氏名が空です`);
    return;
  }
  if (blank(e.qualification)) put('engineer.qualification', `${who}の技術者の資格の欄が空です(第7条第2号イ・ロ・ハのどれに当たるかを書く)`);
}

// 下請けの総額と、元請けの技術者・許可の種類の食い違い
// 建設業法 第26条第2項(監理技術者)・第3条第1項第2号と施行令 第2条(特定建設業の許可)
function checkPrimeAgainstTotal(input, out) {
  // 第26条第2項の「当該建設工事を施工するために締結した下請契約」は元請けが自分で結んだ契約。二次以降(tier が 2 以上)は総額に数えない
  // 次数が決まらない下請け(tierUnknown。台帳の見出しが「下請負人(一次・二次)」など)は、一次かもしれないので総額に足すかを決めない
  const all = (input.subcontractors ?? []).map((s, i) => [s, i]).filter(([s]) => !(Number.isInteger(s?.tier) && s.tier >= 2));
  const subs = all.filter(([s]) => !s?.tierUnknown).map(([s]) => s);
  const uncertain = all.filter(([s]) => s?.tierUnknown);
  const prime = input.prime ?? {};
  const target = primeLabel(prime);
  const role = prime.engineer?.role;
  const license = prime.licenseType;
  const t = licenseThreshold();
  const workType = input.project?.workType;
  const needsTotal = role !== 'kanri' || license !== 'tokutei';
  if (all.length === 0) return; // 下請契約が無ければ総額の境目の話にならない
  if (!needsTotal) return; // 監理技術者・特定建設業なら、総額がいくらでも食い違わない

  // 「判断できない」の文には、分からない方(技術者の役割か許可の種類か)だけを書く(反証の指摘7。読めている事実と食い違わせない)
  const askRole = role !== 'kanri';
  const askLicense = license !== 'tokutei';
  const askText = [askRole ? '元請けの技術者(監理技術者か)' : null, askLicense ? '許可の種類(特定か)' : null].filter(Boolean).join('と');
  const askBasis = [...(askRole ? ['q-kensetsu-26-2'] : []), ...(askLicense ? ['q-kensetsu-3-1-2'] : []), 'q-rei-2-1'];
  const unknownAmount = subs.map((s, i) => [s, i]).filter(([s]) => !isAmount(s?.amount));
  if (workType !== 'other' && workType !== 'kenchiku-ikkatsu') {
    out.undecidable.push({ target, field: 'project.workType', message: '工事の種類(建築一式かそれ以外か)が分からないので、下請けの総額の境目(施行令 第2条)を決められず、' + askText + 'が合っているか判断できません', basis: basisOf(...askBasis) });
    return;
  }
  const line = workType === 'kenchiku-ikkatsu' ? t.kenchiku : t.other;
  const known = subs.filter((s) => isAmount(s?.amount)).reduce((a, s) => a + s.amount, 0);
  const uncertainMax = uncertain.some(([s]) => !isAmount(s?.amount)) ? Infinity : uncertain.reduce((a, [s]) => a + s.amount, 0);
  if (unknownAmount.length === 0 && uncertain.length > 0 && known < line && known + uncertainMax >= line) {
    out.undecidable.push({
      target,
      field: 'subcontractors.tier',
      message: '一次か二次以降かが分からない下請けがある(' + uncertain.map(([s, i]) => subLabel(s, i)).join('、') + ')ので、元請けが直接結んだ下請けの総額が ' + yen(line) + ' 以上かを決められず、' + askText + 'が合っているか判断できません(台帳の会社名の見出しに注文者を書くと決まります)',
      basis: basisOf(...askBasis),
    });
    return;
  }
  if (unknownAmount.length > 0 && known < line) {
    out.undecidable.push({
      target,
      field: 'subcontractors.amount',
      message: '請負代金の額が分からない下請けがある(' + unknownAmount.map(([s, i]) => subLabel(s, i)).join('、') + ')ので、下請けの総額が ' + yen(line) + ' 以上かを決められず、' + askText + 'が合っているか判断できません',
      basis: basisOf(...askBasis),
    });
    return;
  }
  // 分かっている額だけで境目以上なら、分からない額があっても総額は境目以上
  if (known < line) return;
  const totalText = (unknownAmount.length > 0 ? '分かっている額だけで ' : '') + yen(known);
  // 元請けの技術者の氏名が空(台帳に技術者の節が無いなど)なら、checkEngineer が抜けの候補を出している。
  // 同じ技術者を「監理技術者になっていません」でもう一度出さず、抜けの候補に「監理技術者を置く」を書き足す(反証の指摘9)
  const engineerMissing = !prime.engineer || blank(prime.engineer.name);
  if (askRole && engineerMissing) {
    const m = out.candidates.find((c) => c.target === target && c.field === 'engineer');
    if (m) {
      m.message += '(下請けの総額(税込み)が ' + totalText + ' で ' + yen(line) + ' 以上なので、監理技術者を置く工事です)';
      m.basis = [...m.basis, ...basisOf('q-kensetsu-26-2', 'q-rei-2-1')];
    }
  } else if (askRole && blank(role)) {
    // 氏名はあるが、主任技術者か監理技術者かを台帳から読めない。監理技術者でないと決めずに「判断できない」にする
    out.undecidable.push({ target, field: 'prime.engineer.role', message: '下請けの総額(税込み)が ' + totalText + ' で ' + yen(line) + ' 以上なので監理技術者が要りますが、台帳から元請けの技術者が監理技術者か主任技術者かを読めないので判断できません', basis: basisOf('q-kensetsu-26-2', 'q-rei-2-1') });
  } else if (askRole) {
    out.candidates.push({
      kind: 'mismatch', target, field: 'prime.engineer.role',
      message: '下請けの総額(税込み)が ' + totalText + ' で、' + yen(line) + ' 以上なのに、元請けの技術者が監理技術者になっていません',
      basis: basisOf('q-kensetsu-26-2', 'q-rei-2-1'),
    });
  }
  if (askLicense) {
    out.candidates.push({
      kind: 'mismatch', target, field: 'prime.licenseType',
      message: '下請けの総額(税込み)が ' + totalText + ' で、' + yen(line) + ' 以上なのに、元請けの許可の種類が特定建設業になっていません',
      basis: basisOf('q-kensetsu-3-1-2', 'q-rei-2-1'),
    });
  }
}

// 技術者の専任(建設業法 第26条第3項・施行令 第27条第1項)
// 台帳に「非専任」と書いた技術者だけを見る。「専任」・書いていない技術者は候補にも「判断できない」にもしない(注意に書く)。
// 金額の境目は施行令 第27条第1項の抜き書きから読む。工事一件の請負代金の額は、元請けは発注者との契約の額、下請けはその下請契約の額。
// 第1号(国又は地方公共団体が注文者)に当たるかは、画面の「公共」を当たるものとして読む。民間は第2号・第3号(施設・工作物の種類)で決まり、
// 台帳からは分からないので「判断できない」にする。
// ただし書(第26条第3項第1号・第2号)は台帳からは決められないので、候補に confirm として付ける。第1号の「政令で定める金額」は施行令 第28条で、入札前の確認(src/bid-check.mjs の sharedSiteLimit)だけが読む。
// 境目の「当該建設工事が建築一式工事である場合」の当該建設工事は、元請けなら発注者から請け負った工事(画面の「工事の種類」)、
// 下請けならその下請工事。下請けの工事の種類は画面の欄では決まらないので、台帳の「工事内容」に「建築一式」とあれば建築一式、
// それ以外はそれ以外の工事(四千五百万円)を既定にし、二つの境目の間の額なら「下請けの工事が建築一式なら」を確かめることに付ける(反証の指摘1)。
function dedicatedLine(owner, input, who, t) {
  if (who === '元請け') {
    const workType = input.project?.workType;
    if (workType !== 'other' && workType !== 'kenchiku-ikkatsu') return null;
    return { line: workType === 'kenchiku-ikkatsu' ? t.kenchiku : t.other, assumed: false };
  }
  if (/建築一式/.test(String(owner?.work ?? ''))) return { line: t.kenchiku, assumed: false };
  return { line: t.other, assumed: true };
}

function checkDedicated(owner, target, amount, input, out, who) {
  const e = owner?.engineer;
  if (!e || e.dedicated !== false) return;
  const roleName = e.role === 'kanri' ? '監理技術者' : e.role === 'shunin' ? '主任技術者' : '技術者';
  // 「公共」を選んでも、台帳の発注者が民間と読めるときは公共と決めない(F29b)。「民間」はもともと候補にせず判断できないに回す
  const chosen = input.project?.ordererType;
  const ordererType = chosen === 'public' && ordererConflict(input.project) ? undefined : chosen;
  const field = 'engineer.dedicated';
  const base = ['q-kensetsu-26-3', 'q-rei-27-1'];
  const amountName = who === '元請け' ? '発注者との請負代金の額' : 'この下請契約の請負代金の額';
  const t = dedicatedThreshold();
  const d = dedicatedLine(owner, input, who, t);
  if (!d) {
    out.undecidable.push({ target, field, message: `${who}の${roleName}が非専任ですが、工事の種類(建築一式かそれ以外か)が分からないので、専任が要る金額の境目(施行令 第27条第1項)を決められず判断できません`, basis: basisOf(...base) });
    return;
  }
  const line = d.line;
  // 下請けの工事の種類を既定で読んだときの断り(境目の間の額のときだけ結論が変わる)
  const assumedNote = d.assumed && isAmount(amount) && amount < t.kenchiku
    ? `下請けの工事の種類は台帳から決められないので、建築一式工事でない(境目 ${yen(t.other)})として比べた。この下請工事が建築一式工事なら境目は ${yen(t.kenchiku)} で、専任は要らない(施行令 第27条第1項の「当該建設工事」は、下請けならその下請工事)`
    : null;
  if (!isAmount(amount)) {
    out.undecidable.push({ target, field, message: `${who}の${roleName}が非専任ですが、${amountName}が分からないので、${yen(line)} 以上か(施行令 第27条第1項)を決められず判断できません`, basis: basisOf(...base) });
    return;
  }
  if (amount < line) return;
  if (ordererType !== 'public') {
    const why = ordererType === 'private'
      ? '民間の工事では、施設・工作物が施行令 第27条第1項第2号(第15条第1号・第3号の施設・工作物)か第3号(学校・病院・共同住宅・事務所・工場・倉庫など)に当たるかで決まり、台帳からは分からないので判断できません'
      : '発注者が公共か民間かが分からないので、施行令 第27条第1項の各号に当たるかを決められず判断できません';
    out.undecidable.push({ target, field, message: `${who}の${roleName}が非専任で、${amountName}(税込み)が ${yen(amount)} と ${yen(line)} 以上です。${why}` + (assumedNote ? `(${assumedNote})` : ''), basis: basisOf(...base) });
    return;
  }
  const confirm = [
    ...(assumedNote ? [assumedNote] : []),
    '建設業法 第26条第3項ただし書 第1号: 請負代金の額が政令で定める金額未満で、工事現場間の移動時間・連絡方法などの要件と、情報通信技術を使う措置の要件をすべて満たす場合は、専任でなくてよい(政令で定める金額の原文はこのツールに取り込んでいないので、当たるかを確かめる)',
    ...(e.role === 'kanri' ? ['建設業法 第26条第3項ただし書 第2号: 監理技術者の職務を補佐する者を工事現場に専任で置く場合は、監理技術者は専任でなくてよい(補佐する者を置いているかを確かめる)'] : []),
    '「公共」は、施行令 第27条第1項第1号(国又は地方公共団体が注文者である施設又は工作物に関する建設工事)に当たるものとして読んでいる。注文者が国・地方公共団体でなければ、第2号・第3号の施設・工作物かを確かめる',
  ];
  out.candidates.push({
    kind: 'mismatch', target, field,
    message: `${who}の${roleName}が非専任になっています。${amountName}(税込み)が ${yen(amount)} で ${yen(line)} 以上の、国又は地方公共団体が注文者である工事なので、工事現場ごとに専任の者でなければなりません(ただし書に当たるかは確かめる)`,
    basis: basisOf(...base, 'q-rei-27-1-1', 'q-kensetsu-26-3-1', ...(e.role === 'kanri' ? ['q-kensetsu-26-3-2'] : [])),
    confirm,
  });
}

export function checkTaicho(input = {}) {
  const out = { candidates: [], undecidable: [] };
  const subs = Array.isArray(input.subcontractors) ? input.subcontractors : [];
  if (ordererConflict(input.project)) {
    const chosen = input.project.ordererType === 'public' ? '公共' : '民間';
    out.undecidable.push({ target: '発注者「' + String(input.project.orderer).trim() + '」', field: 'project.ordererType', message: '台帳の発注者の名前と、上の欄で選んだ「' + chosen + '」が食い違って読めるので、国又は地方公共団体が注文者の工事(施行令 第27条第1項第1号)かを決められず判断できません。発注者の名前と上の欄を確かめてください', basis: basisOf('q-rei-27-1-1') });
  }
  checkEngineer(input.prime, primeLabel(input.prime), out, '元請け');
  checkDedicated(input.prime, primeLabel(input.prime), input.project?.contractAmount, input, out, '元請け');
  subs.forEach((s, i) => {
    checkSubFields(s, i, out);
    checkEngineer(s, subLabel(s, i), out, '下請け');
    checkDedicated(s, subLabel(s, i), s?.amount, input, out, '下請け');
  });
  checkPrimeAgainstTotal({ ...input, subcontractors: subs }, out);
  out.notes = [
    '指摘の候補です。抜けが無いことの保証や合否ではありません',
    '下請けの総額は、元請けが直接結んだ下請契約だけで数えます。見出しに「二次」などの次数か「(一次: 会社名)」のような注文者の書き方がある下請けは、総額に入れません。次数を書いていない下請けは、元請けが直接結んだ契約として数えます(二次以降が混じっていれば、総額が変わります)',
    '施工体系図・施工計画書との突き合わせはしていません(台帳だけを点検します)',
    '金額は税込みで比べます(国交省 建設業許可事務ガイドライン【その他】2.)',
    '建築一式工事は建築工事業の許可で請け負うものと読み、施行令 第2条のただし書の金額を使います',
    '技術者の専任(建設業法 第26条第3項・施行令 第27条)は、台帳の「専任・非専任」の欄に「非専任」と書いた技術者だけを点検します。欄が無い・空の技術者は点検していません。金額の境目の工事の種類は、元請けは上の欄の「工事の種類」、下請けはその下請工事で決めます(施行令 第27条第1項の「当該建設工事」)。下請けは台帳の「工事内容」に「建築一式」と書いていなければ建築一式工事でない(4,500万円)として比べ、建築一式なら9,000万円になることを「確かめること」に付けます。第26条第3項ただし書(第1号・第2号)・第4項(現場の数)・施行令 第27条第2項(密接な関係のある工事)に当たるかは台帳から決められないので、候補に「確かめること」として付けます',
    '施行規則 第14条の2 第1項の記載事項は「台帳の記載事項の表」で、欄に値があるか・空か・判断できないかだけを出します。「空」の行は、台帳の文を点検するときは候補にも出します(同じ欄は二重に出しません)。第2項〜第4項と、施行規則のほかの条は取り込んでいません',
  ];
  return out;
}

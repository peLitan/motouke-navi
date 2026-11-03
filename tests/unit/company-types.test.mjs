// F24a: 会社・団体の名前の規則を業界を問わない形に(法人の種類の一覧と略し方・囲み文字・空白・ひらがな/カタカナの名前・法人格の無い団体と施設の語尾)。
// 例はすべて架空。初めて見る書類(fixtures/unseen/)は使わない
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createMasker } from '../../src/mask/core.mjs';
import { CONSTRUCTION_DICT } from '../../src/mask/dict-construction.mjs';
import { MEDICAL_DICT } from '../../src/mask/dict-medical.mjs';
import { ENCLOSED_CHARS, COMPANY_RULES } from '../../src/mask/rules-company.mjs';
import { CORPORATE_TYPES, CORPORATE_ABBREVIATIONS, FACILITY_SUFFIXES_LAW, ORG_SUFFIXES_CUSTOM } from '../../src/mask/company-types.mjs';

const mask = (text, dict = CONSTRUCTION_DICT) => createMasker({ dictionaries: [dict] }).mask(text);
const companies = (r) => r.map.filter((e) => e.kind === 'company').map((e) => e.original).sort();

// 文の中の会社・団体の名前が、ちょうどこの語だけ置き換わる
function expectCompanies(text, want, rule) {
  const r = mask(text);
  assert.deepEqual(companies(r), [...want].sort(), text + ' → ' + r.masked);
  for (const w of want) {
    assert.ok(!r.masked.includes(w), '置き換わっていない: ' + w + ' → ' + r.masked);
    if (rule) assert.equal(r.map.find((e) => e.original === w).rule, rule, w);
  }
  return r;
}

test('法人の種類の一覧: 株式会社のほか、社団・財団・NPO・医療・福祉・学校・組合・士業の法人を名前の前・後ろのどちらでも置き換える', () => {
  expectCompanies('委託先は一般社団法人みほん協議会です。', ['一般社団法人みほん協議会']);
  expectCompanies('公益財団法人ためし振興財団に届けた。', ['公益財団法人ためし振興財団']);
  expectCompanies('特定非営利活動法人みほんネットが運営する。', ['特定非営利活動法人みほんネット']);
  expectCompanies('NPO法人ためしサポートに相談', ['NPO法人ためしサポート']);
  expectCompanies('医療法人社団甲野会の病院', ['医療法人社団甲野会']);
  expectCompanies('社会福祉法人乙川福祉会が発注', ['社会福祉法人乙川福祉会']);
  expectCompanies('学校法人丙山学園と契約', ['学校法人丙山学園']);
  expectCompanies('甲野事業協同組合の組合員', ['甲野事業協同組合']);
  expectCompanies('みほん農業協同組合へ提出', ['みほん農業協同組合']);
  expectCompanies('顧問は乙川税理士法人です。', ['乙川税理士法人']);
  expectCompanies('丙山特許業務法人に依頼', ['丙山特許業務法人']);
  expectCompanies('甲野合同会社が下請', ['甲野合同会社']);
  expectCompanies('ためし生命保険相互会社の担当', ['ためし生命保険相互会社']);
  // 一覧の語は国税庁・法務局の資料にある種類を入れている
  for (const w of ['株式会社', '有限会社', '合名会社', '合資会社', '合同会社', '一般社団法人', '公益財団法人', '特定非営利活動法人', '医療法人',
    '社会福祉法人', '学校法人', '宗教法人', '独立行政法人', '国立大学法人', '農事組合法人', '有限責任事業組合', '弁護士法人', '監査法人', '更生保護法人']) {
    assert.ok(CORPORATE_TYPES.includes(w), w);
  }
});

test('略し方: 括弧(半角・全角)の中の略し方を法人格として扱う', () => {
  expectCompanies('(株)甲野の見積り', ['(株)甲野']);
  expectCompanies('乙川建設(有)に発注', ['乙川建設(有)']);
  expectCompanies('（一社）みほん協会の会員', ['（一社）みほん協会']);
  expectCompanies('（公財）ためし財団と協議', ['（公財）ためし財団']);
  expectCompanies('（ 株 ）丙山', ['（ 株 ）丙山']);
  for (const a of ['株', '有', '一社', '一財', '公社', '公財', '特非']) assert.ok(CORPORATE_ABBREVIATIONS.includes(a), a);
});

test('囲み文字: NFKC で法人の種類になる字を拾い、㈱㈲㊑㍿ などを法人格として扱う(㈹ は入れない)', () => {
  for (const c of ['㈱', '㈲', '㈳', '㈶', '㈻', '㊑', '㊒', '㊩', '㍿']) assert.ok(ENCLOSED_CHARS.includes(c), c);
  assert.ok(!ENCLOSED_CHARS.includes('㈹'), '㈹(代表)は法人の種類ではない');
  for (const c of ENCLOSED_CHARS) assert.notEqual(c.normalize('NFKC'), c, c + ' は NFKC で変わる字');
  expectCompanies('㈱甲野工業と㊑乙川が施工', ['㈱甲野工業', '㊑乙川']);
  expectCompanies('丙山商事㍿の見積り', ['丙山商事㍿']);
  expectCompanies('下請は甲野電設㈲です。', ['甲野電設㈲']);
});

test('法人格と名前のあいだの空白(半角・全角1字)を許し、欄名・役職を名前にしない', () => {
  expectCompanies('甲野建設 株式会社', ['甲野建設 株式会社']);
  expectCompanies('株式会社 甲野建設', ['株式会社 甲野建設']);
  expectCompanies('乙川工業　株式会社', ['乙川工業　株式会社']);
  expectCompanies('社会福祉法人 みほん会 理事長', ['社会福祉法人 みほん会']);
  // 欄名・役職は会社名に含めない
  expectCompanies('代表者 株式会社甲野', ['株式会社甲野']);
  expectCompanies('会社名 株式会社 甲野建設', ['株式会社 甲野建設']);
  const r = expectCompanies('甲野建設 株式会社 代表取締役 乙川 二郎', ['甲野建設 株式会社']);
  assert.ok(r.masked.includes('代表取締役'), r.masked);
  // 戻せる
  const m = createMasker({ dictionaries: [CONSTRUCTION_DICT] });
  const text = '株式会社 甲野建設 と 乙川工業 株式会社';
  assert.equal(m.unmask(m.mask(text).masked), text);
});

test('ひらがな・カタカナの入る名前: 名前の中のひらがなは残さず、文の中のひらがなの所で切る', () => {
  expectCompanies('当社はさくら建設株式会社と契約した', ['さくら建設株式会社']);
  expectCompanies('契約したひまわり工業株式会社', ['ひまわり工業株式会社']);
  expectCompanies('株式会社さくらは下請です', ['株式会社さくら']);
  expectCompanies('発注者: 株式会社ふもと野ロジ', ['株式会社ふもと野ロジ']);
  expectCompanies('株式会社やまと', ['株式会社やまと']);
  expectCompanies('カナデ工業株式会社の工場', ['カナデ工業株式会社']);
  expectCompanies('みほんたばこ産業株式会社に納品', ['みほんたばこ産業株式会社']);
  expectCompanies('株式会社アオバ技研として', ['株式会社アオバ技研']);
  // 2つの会社名が「と」でつながっても別々に置き換える
  expectCompanies('甲野建設株式会社と乙川工業株式会社', ['甲野建設株式会社', '乙川工業株式会社']);
  expectCompanies('下請けは株式会社乙川土工。', ['株式会社乙川土工']);
  expectCompanies('取引のある株式会社甲野', ['株式会社甲野']);
});

test('法人格の無い団体・施設の名前(法令で決まった施設・慣用の語尾)を確信の弱い語として置き換える', () => {
  expectCompanies('ひまわり幼稚園に通う', ['ひまわり幼稚園'], 'org-suffix');
  expectCompanies('みほん市立第一小学校の校長', ['みほん市立第一小学校'], 'org-suffix');
  expectCompanies('入所先は甲野特別養護老人ホームです', ['甲野特別養護老人ホーム'], 'org-suffix');
  expectCompanies('乙川診療所で受診', ['乙川診療所'], 'org-suffix');
  expectCompanies('甲野工務店が施工する', ['甲野工務店'], 'org-suffix');
  expectCompanies('丙山組の現場', ['丙山組'], 'org-suffix');
  expectCompanies('乙川法律事務所に相談', ['乙川法律事務所'], 'org-suffix');
  expectCompanies('さくらクリニックの院長', ['さくらクリニック'], 'org-suffix');
  expectCompanies('みほん町役場の担当', ['みほん町役場'], 'org-suffix');
  expectCompanies('ためし県庁に提出', ['ためし県庁'], 'org-suffix');
  expectCompanies('丙山町内会の会長', ['丙山町内会'], 'org-suffix');
  expectCompanies('甲野商店で購入', ['甲野商店'], 'org-suffix');
  for (const w of ['幼稚園', '小学校', '高等専門学校', '病院', '診療所', '特別養護老人ホーム', '介護医療院']) assert.ok(FACILITY_SUFFIXES_LAW.includes(w), w);
  for (const w of ['組', '工務店', '事務所', 'クリニック', '役場', '町内会']) assert.ok(ORG_SUFFIXES_CUSTOM.includes(w), w);
  // 医療の表では、病院などは医療の施設名の規則が先に取る(業界の表が優先)
  const med = mask('甲野記念病院に紹介', MEDICAL_DICT);
  assert.equal(med.map[0].kind, 'site');
});

test('置き換えすぎの例: 一般の言い方・様式の「有」・法令の文の言い方は置き換えない', () => {
  for (const text of [
    '現場事務所に集合', '県立高等学校', '第一小学校', '取組と番組', '道路の建設', '建設業の許可', '新たな建設を行う', '大学病院に紹介',
    '健康診断 (有)', '当該株式会社', '独立行政法人等の職員', '株式会社と契約する', '市役所に提出', '労働組合の役員', '本組合の規約',
    '地域産業の振興', '自治会', '設計事務所', '総合病院へ行く', '建設工事の請負', '共同企業体',
  ]) {
    const r = mask(text);
    assert.deepEqual(companies(r), [], '置き換えすぎ: ' + text + ' → ' + r.masked);
  }
});

test('語の一覧は src/mask/ の別のファイルで、出典の URL があり、README から見られる', () => {
  const src = fs.readFileSync(new URL('../../src/mask/company-types.mjs', import.meta.url), 'utf8');
  for (const url of [
    'https://www.houjin-bangou.nta.go.jp/documents/k-resource-dl-ver4.pdf',
    'https://houmukyoku.moj.go.jp/homu/COMMERCE_11-1.html',
    'https://www.unicode.org/Public/18.0.0/charts/PDF/U3200.pdf',
    'https://laws.e-gov.go.jp/law/322AC0000000026',
    'https://laws.e-gov.go.jp/law/323AC0000000205',
  ]) assert.ok(src.includes(url), url);
  assert.match(src, /慣用/);
  // 規則のファイルは語の一覧を持たない(一覧は company-types.mjs から読む)
  const rules = fs.readFileSync(new URL('../../src/mask/rules-company.mjs', import.meta.url), 'utf8');
  assert.ok(!rules.includes("'特定非営利活動法人'") && !rules.includes("'工務店'"));
  assert.deepEqual(COMPANY_RULES.map((r) => r.id), ['company-before', 'company-after', 'org-suffix']);
  const readme = fs.readFileSync(new URL('../../README.md', import.meta.url), 'utf8');
  assert.ok(readme.includes('src/mask/company-types.mjs'), 'README から語の一覧のファイルが見られる');
});

// F31b: 括弧の略し方・法人格だけの文・一般の語を会社名に取りすぎない(反証 第2弾の A-1〜A-3)。
// 例はすべて架空(「和歌山県庁」のような一般の呼び方を除く)。初めて見る書類(fixtures/unseen/)は使わない
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMasker } from '../../src/mask/core.mjs';
import { CONSTRUCTION_DICT } from '../../src/mask/dict-construction.mjs';
import { MEDICAL_DICT } from '../../src/mask/dict-medical.mjs';

const DICTS = [['建設', CONSTRUCTION_DICT], ['医療', MEDICAL_DICT]];
const companies = (text, dict) => createMasker({ dictionaries: [dict] }).mask(text).map.filter((e) => e.kind === 'company').map((e) => e.original);

function none(list) {
  for (const [name, dict] of DICTS) for (const text of list) assert.deepEqual(companies(text, dict), [], `${name}: ${text}`);
}
function exactly(text, want) {
  for (const [name, dict] of DICTS) {
    assert.deepEqual(companies(text, dict).sort(), [...want].sort(), `${name}: ${text}`);
    const masked = createMasker({ dictionaries: [dict] }).mask(text).masked;
    for (const w of want) assert.ok(!masked.includes(w), `${name}: 残った ${w} → ${masked}`);
  }
}

test('A-1: 様式の欄の印を会社名にしない', () => {
  none(['資格(有)、免許(有)、健康診断(有)', '| 退職金共済 | 加入(有) |', '安全衛生教育(有)', '健康診断受診（有）', '給食(有) 送迎(有)',
    '既往症(有)高血圧', '指導医(医)の署名', '学籍(学)番号', '手帳(有)・講習(有)・免許(無)']);
});

test('A-1: 再現の入力に無い欄の語でも同じ(語の一覧で決めていない)', () => {
  none(['駐車場(有)', '通勤手当(有)・残業(無)', 'トイレ(有)', '(有)の場合', '合否(合)', '語学(独)', '福祉(福)の欄']);
});

test('A-1: 略し方のある本物の名前は取る', () => {
  exactly('(有)ためし工業に発注', ['(有)ためし工業']);
  exactly('ためし工業(有)に発注', ['ためし工業(有)']);
  exactly('発注先(有)ためし工業', ['(有)ためし工業']);
  exactly('下請は(有)ためしです', ['(有)ためし']);
  exactly('(医)みほん会の病院', ['(医)みほん会']);
  exactly('(学)ためし学園', ['(学)ためし学園']);
  exactly('ためし(有)と契約', ['ためし(有)']);
  exactly('甲野(有) 御中', ['甲野(有)']);
  exactly('会社名: 甲野(有)', ['甲野(有)']);
  exactly('(有)甲野・(有)乙川', ['(有)甲野', '(有)乙川']);
  exactly('(株)みほん建設', ['(株)みほん建設']);
  exactly('資格(株)ためし', ['資格(株)ためし'].map((s) => s.slice(2))); // 「(株)」は様式の印ではない
});

test('A-2: 法人格だけの一般の文を取らない', () => {
  none(['当社は株式会社です。', '株式会社又は合同会社の形態', '株式会社法の改正',
    '株式会社及び合同会社', '株式会社・合同会社', '株式会社若しくは合同会社', '株式会社ですが、', '株式会社である', '株式会社設立の手続', '有限会社法第2条', '株式会社形態で']);
});

test('A-2: 法人格の後ろの本物の名前は取る(「法」で始まる名前も、並んだ名前も)', () => {
  exactly('株式会社法務ためし', ['株式会社法務ためし']);
  exactly('株式会社やまと', ['株式会社やまと']);
  exactly('株式会社甲野及び株式会社乙川', ['株式会社甲野', '株式会社乙川']);
  exactly('株式会社甲野又は合同会社乙川', ['株式会社甲野', '合同会社乙川']);
  exactly('株式会社甲野・株式会社乙川', ['株式会社甲野', '株式会社乙川']);
  exactly('甲野及び乙川株式会社', ['乙川株式会社']);
});

test('A-3: 一般の語を取らない', () => {
  none(['監督員事務所', '振興局事務所', '橋梁建設', '鉄道建設', 'ダム建設', '学校建設', '石油化学工業', '成長産業', '二人組', '矯正歯科', '動物病院', '和歌山県庁']);
});

test('A-3: 一般の語と同じ字を持つ名前は取る(1字の語を除いていない)', () => {
  exactly('高橋建設に発注', ['高橋建設']);
  exactly('さくら動物病院', ['さくら動物病院']);
  exactly('みほん鉄道建設', ['みほん鉄道建設']);
  exactly('ためし県庁に提出', ['ためし県庁']);
  exactly('みほん矯正歯科', ['みほん矯正歯科']);
  exactly('ダム株式会社', ['ダム株式会社']); // 除く語は法人格の無い名前のときだけ
});

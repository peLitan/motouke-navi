// F75a の単体の試験: 語尾「電設サービス」で E2 の二次の会社の名前を置き換え、ほかの語は置き換えない。会社名はすべて架空
// 文は read_masked と同じ入口(readMaskedWithCheck)で読む。別に組んだ置き換えでは、道具の辞書と食い違っても気づけない
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readMaskedWithCheck } from '../../integration/claude-code/mcp/masked-files.mjs';
import { ORG_SUFFIXES_CUSTOM } from '../../src/mask/company-types.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const E1 = path.join(ROOT, 'plugin/evals/cases/E1_しおかぜ町下水道');
const E2 = path.join(ROOT, 'plugin/evals/cases/E2_あおば台共同住宅');
const NAME = '架空電設サービス';
const opts = { mapPath: '', dictPath: '' };
// init.mjs は tmp/ の中だけ書ける形で試験を回す
const TMP = path.join(ROOT, 'tmp');
fs.mkdirSync(TMP, { recursive: true });
const WORK = fs.mkdtempSync(path.join(TMP, 'f75a-'));
fs.mkdirSync(path.join(WORK, 'raw'));
after(() => fs.rmSync(WORK, { recursive: true, force: true }));

const maskedOf = (root, rel) => readMaskedWithCheck(root, rel, opts).masked;

// raw/ の下に1つの文を置いて読む
function maskSentence(text) {
  fs.writeFileSync(path.join(WORK, 'raw', '文.md'), text);
  return maskedOf(WORK, 'raw/文.md');
}

test('E2 の施工体系図: 木の行と表の括弧の中の2か所とも残らず、同じ記号になる', () => {
  const raw = fs.readFileSync(path.join(E2, 'raw/施工体系図.md'), 'utf8');
  assert.equal(raw.split(NAME).length - 1, 2);
  const masked = maskedOf(E2, 'raw/施工体系図.md');
  assert.equal(masked.includes(NAME), false);
  const tree = masked.match(/二次 (〔会社名\d+〕)\(弱電/);
  const table = masked.match(/あり\((〔会社名\d+〕)\)/);
  assert.ok(tree && table, masked);
  assert.equal(tree[1], table[1]);
});

test('E1 の返事の記号の数は 18 のまま', () => {
  const masked = ['raw/施工体制台帳.md', 'raw/施工計画書_抜粋.md'].map((d) => maskedOf(E1, d)).join('\n');
  assert.equal(new Set(masked.match(/〔[^〕]*〕/g)).size, 18);
});

test('語尾を足しても、E2 の見本の名前のほかにも効く', () => {
  for (const [text, want] of [
    ['ためし電設サービスが配線を担当する', '〔会社名1〕が配線を担当する'],
    ['| 二次 | 甲野電設サービス | 配線 |', '| 二次 | 〔会社名1〕 | 配線 |'],
  ]) assert.equal(maskSentence(text), want, text);
});

test('置き換えすぎない: 普通の文は置き換わらない', () => {
  const sentences = [
    '電設資材を搬入する', '情報技術サービスの契約', 'デイサービスの送迎', '訪問介護サービスの事業所',
    '屋内電設の範囲を確かめる', '構内電設は別途', '高圧電設、低圧電設', '第二種電設は',
    '空調設備サービスを受ける', '防災設備サービスの点検', '仮設電気サービスの申込み', '高度な技術サービスの提供',
    '建設サービス業', '電気サービス部門',
  ];
  assert.equal(sentences.length, 14);
  for (const s of sentences) assert.equal(maskSentence(s), s);
});

test('置き換えすぎない: 語尾の語だけの言い方と、語尾の後ろに語が続く形', () => {
  for (const s of ['電設サービスの範囲', '当社の電設サービスを案内する', '総合電設サービスを提供する', '乙川電設サービスセンターへ連絡する']) {
    assert.equal(maskSentence(s), s);
  }
});

// 直すときは manual の限界の行も直す。普通の語が記号になる側の失敗として残すと決めた形
test('知っている限界: 普通の語 + 語尾の5語は置き換わり、manual に書いてある', () => {
  const words = ['屋内', '構内', '高圧', '低圧', '第二種'];
  for (const [w, rest] of [[words[0], 'の範囲を確かめる'], [words[1], 'は別途'], [words[2], 'の提供'], [words[3], 'を受ける'], [words[4], 'は']]) {
    assert.equal(maskSentence(`${w}電設サービス${rest}`), `〔会社名1〕${rest}`, w);
  }
  const line = fs.readFileSync(path.join(ROOT, 'docs/manual.md'), 'utf8').split('\n').find((l) => l.startsWith('- 語尾「電設サービス」の限界'));
  assert.ok(line);
  for (const w of [...words, '14文', '名前が漏れる側ではありません']) assert.ok(line.includes(w), w);
});

test('語尾の一覧: 足したのは長い形だけ', () => {
  assert.ok(ORG_SUFFIXES_CUSTOM.includes('電設サービス'));
  for (const w of ['電設', 'サービス', '設備サービス', '電気サービス', '技術サービス', '建設サービス', '工業サービス']) {
    assert.equal(ORG_SUFFIXES_CUSTOM.includes(w), false, w);
  }
  // 「電設」は辞書に足す候補に回す語のまま
  assert.equal(maskSentence('乙川電設が配線を担当'), '乙川電設が配線を担当');
});

test('文書: 評価.md の 7 は置き換えたことと、率を測り直していないことを書く', () => {
  const doc = fs.readFileSync(path.join(ROOT, 'docs/評価.md'), 'utf8');
  const section = doc.slice(doc.indexOf('## 7. 公式の評価のケース'), doc.indexOf('## 8. 公告から条件を拾う正しさ'));
  const line = section.split('\n').find((l) => l.includes(NAME));
  assert.ok(line);
  for (const w of ['F75a で', '合格はこの直しを含む', '測り直していない']) assert.ok(line.includes(w), w);
  assert.equal(section.includes('分かっている漏れ'), false);
  assert.equal(section.includes('不合格と出る見込み'), false);
});

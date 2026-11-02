// F11a: 置き換えの部品(貼り付けた文)(条件 F11-1・F11-2・F11-4・F11-5・F11-6・F11-8)
import test from 'node:test';
import assert from 'node:assert/strict';
import { load, readText, indexHtml, scriptsOf, withoutScripts, hasId, STORAGE_RE, GUARANTEE_RE, runPage } from './_helpers.mjs';

const TEXT = [
  '架空の文書です。甲山建設株式会社(架空県みほん市さくら町0-0-0)の甲野 一郎が担当します。',
  '連絡先: kono@example.com、電話 03-0000-0000、携帯 090-0000-0000。',
  '許可番号: 架空県知事 許可(特-06)第90001号。現場はひのき台です。',
  '下請けは株式会社乙川土工。甲山建設株式会社として、ひのき台の工程を甲野 一郎が確かめます。',
].join('\n');
const ORIGINALS = { '甲山建設株式会社': 'company', '株式会社乙川土工': 'company', '甲野 一郎': 'person', 'ひのき台': 'site', 'kono@example.com': 'email', '03-0000-0000': 'phone', '090-0000-0000': 'phone', '架空県みほん市さくら町0-0-0': 'address', '架空県知事 許可(特-06)第90001号': 'license' };

async function masker() {
  const { createMasker } = await load('src/mask/core.mjs');
  const { CONSTRUCTION_DICT } = await load('src/mask/dict-construction.mjs');
  const m = createMasker({ dictionaries: [CONSTRUCTION_DICT] });
  m.addTerm('甲野 一郎', 'person');
  m.addTerm('ひのき台', 'site');
  return m;
}
const count = (s, sub) => s.split(sub).length - 1;

test('人名・会社名・現場名・住所・電話・メール・許可番号を記号に置き換え、対応表を返す', async () => {
  const m = await masker();
  const r = m.mask(TEXT);
  for (const [orig, kind] of Object.entries(ORIGINALS)) {
    assert.ok(!r.masked.includes(orig), '置き換わっていない: ' + orig);
    const e = r.map.find((x) => x.original === orig);
    assert.ok(e, '対応表に無い: ' + orig);
    assert.equal(e.kind, kind, orig + ' の種類');
    assert.ok(e.token && !e.token.includes(orig));
  }
  const tokens = r.map.map((x) => x.token);
  assert.equal(new Set(tokens).size, tokens.length, '違う語に同じ記号');
});

test('同じ語はいつも同じ記号。戻ってきた文の記号を元の語に戻せる', async () => {
  const m = await masker();
  const r = m.mask(TEXT);
  const tok = (o) => r.map.find((x) => x.original === o).token;
  assert.equal(count(r.masked, tok('甲山建設株式会社')), 2);
  assert.equal(count(r.masked, tok('甲野 一郎')), 2);
  assert.equal(m.unmask(r.masked), TEXT);
  const r2 = m.mask('甲山建設株式会社に連絡する。');
  assert.ok(r2.masked.includes(tok('甲山建設株式会社')), '2回目に別の記号になった');
  const reply = `${tok('甲山建設株式会社')}の台帳では、${tok('甲野 一郎')}の資格の欄を確かめてください。`;
  assert.equal(m.unmask(reply), '甲山建設株式会社の台帳では、甲野 一郎の資格の欄を確かめてください。');
});

test('金額は、そのままか「境目以上・未満」の形かを選べる', async () => {
  const m = await masker();
  const t = '請負代金額 金 52,000,000円、別の契約 金 41,000,000円。';
  assert.equal(m.mask(t).masked, t, '既定では金額をそのままにする');
  const b = m.mask(t, { amounts: 'band', thresholds: [50_000_000] }).masked;
  assert.ok(!b.includes('52,000,000') && !b.includes('41,000,000'), '金額が残っている');
  assert.ok(/以上/.test(b) && /未満/.test(b), '境目以上・未満の形になっていない: ' + b);
});

test('部品は建設の語に依存しない(建設の語は別の辞書ファイル)。保存しない', () => {
  const core = readText('src/mask/core.mjs');
  for (const w of ['建設', '工事', '施工', '下請', '元請', '許可']) assert.ok(!core.includes(w), '部品に建設の語: ' + w);
  assert.ok(!STORAGE_RE.test(core));
  const dict = readText('src/mask/dict-construction.mjs');
  assert.ok(/許可/.test(dict), '建設の辞書に許可番号の形が無い');
});

test('画面: 貼り付け → 前・後・対応表、戻す、辞書に足す。漏れの注意があり「保証」と書かない。保存しない', () => {
  const html = indexHtml();
  for (const id of ['mask-input', 'mask-run', 'mask-before', 'mask-after', 'mask-map', 'unmask-input', 'unmask-run', 'unmask-output', 'dict-word', 'dict-kind', 'dict-add']) assert.ok(hasId(html, id), 'id が無い: ' + id);
  const code = scriptsOf(html).map((s) => s.code).join('\n');
  assert.ok(code.includes('createMasker'), '画面に置き換えの部品が組み込まれていない');
  assert.ok(!STORAGE_RE.test(code));
  const body = withoutScripts(html).replace(/<[^>]+>/g, '');
  assert.ok(/漏れ/.test(body) && /組み合わせ/.test(body), '漏れと組み合わせの注意が画面に無い');
  assert.ok(!GUARANTEE_RE.test(body), '「保証」と書いている');
});

test('画面を動かす: 辞書に足して置き換えると、後の欄に元の語が無く、対応表の欄に出る。戻すと元に戻る。金額の扱いを選べる', async () => {
  const page = runPage();
  assert.ok(page.el('mask-amounts'), '金額の扱いを選ぶ欄が無い');
  await page.set('dict-word', '甲野 一郎'); await page.set('dict-kind', 'person'); await page.click('dict-add');
  await page.set('mask-input', TEXT);
  await page.click('mask-run');
  const after = page.text('mask-after');
  for (const w of ['甲野 一郎', 'kono@example.com', '03-0000-0000', '甲山建設株式会社']) assert.ok(!after.includes(w), '後の欄に残る: ' + w);
  const map = page.text('mask-map');
  assert.ok(map.includes('kono@example.com') && map.includes('甲野 一郎'), '対応表の欄に出ない');
  assert.ok(page.text('mask-before').includes('kono@example.com'), '前の欄に出ない');
  await page.set('unmask-input', after.trim());
  await page.click('unmask-run');
  assert.ok(page.text('unmask-output').includes('kono@example.com'), '戻せない');
});

test('README に、漏れが0にならないことと、組み合わせから分かるおそれを書いている', () => {
  const md = readText('README.md');
  assert.ok(/漏れ/.test(md) && /組み合わせ/.test(md));
  assert.ok(!GUARANTEE_RE.test(md));
});

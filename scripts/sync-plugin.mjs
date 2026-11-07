// plugin/ の中の写しを、元のファイル(F13 の integration/claude-code/、src/mask/、F20b・F26a の src/quote-check.mjs と data/sources/ の法令の原文)から作り直す(F20a・F20b)
// 使い方: node scripts/sync-plugin.mjs        写しを作り直す
//         node scripts/sync-plugin.mjs --check 写しが元と同じかだけを確かめる(違えば終了コード 1)
//         --help・-h で使い方。知らない引数は何も書かずに終了コード 2(F83b9)
// プラグインは入れたときに別の場所(Claude Code のキャッシュ)へ写されるので、道具が使う src/mask/ も plugin/ の中に置く。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readArgs, handleArgs, runMain } from './cli.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// [元, 写し](リポジトリの直下からのパス)
export const PLUGIN_COPIES = [
  ['integration/claude-code/hooks/guard-raw.mjs', 'plugin/scripts/guard-raw.mjs'],
  ['integration/claude-code/mcp/masked-files.mjs', 'plugin/mcp/masked-files.mjs'],
  ['src/mask/core.mjs', 'plugin/src/mask/core.mjs'],
  ['src/mask/dict-construction.mjs', 'plugin/src/mask/dict-construction.mjs'],
  ['src/mask/rules-person.mjs', 'plugin/src/mask/rules-person.mjs'],
  ['src/mask/rules-site.mjs', 'plugin/src/mask/rules-site.mjs'],
  ['src/mask/suffix-construction.mjs', 'plugin/src/mask/suffix-construction.mjs'],
  // F24a: 会社・団体の名前の規則と語の一覧(core.mjs が読む)
  ['src/mask/rules-company.mjs', 'plugin/src/mask/rules-company.mjs'],
  ['src/mask/company-types.mjs', 'plugin/src/mask/company-types.mjs'],
  // F24b: 住所の規則(core.mjs が読む)
  ['src/mask/rules-address.mjs', 'plugin/src/mask/rules-address.mjs'],
  // F28a: 見本の語を混ぜて見落としを測る部品(masked-files.mjs が読む)
  ['src/mask/decoy.mjs', 'plugin/src/mask/decoy.mjs'],
  // F20b: 点検の Skill の条番号の確かめに使う、項・号の切り出しの部品と、取得した法令の原文
  ['src/quote-check.mjs', 'plugin/skills/construction-check/scripts/lib/quote-check.mjs'],
  ['data/sources/index.json', 'plugin/skills/construction-check/reference/sources/index.json'],
  // F26a: 仕様書から規則表を作る Skill の照合(check-quotes.mjs と同じ部品)
  ['src/quote-check.mjs', 'plugin/skills/spec-to-rules/scripts/lib/quote-check.mjs'],
  // F41a: 公告から条件を拾う Skill の照合
  ['src/quote-check.mjs', 'plugin/skills/bid-intake/scripts/lib/quote-check.mjs'],
  // F82e: 公告の PDF を文にする道具が読む部品(画面と同じもの)
  ['src/pdf-read.mjs', 'plugin/skills/bid-intake/scripts/lib/pdf-read.mjs'],
  // F42b: 参考の積算額の Skill の照合と計算。indirect.mjs が読む率の表は ../../data/ の位置に置く
  ['src/quote-check.mjs', 'plugin/skills/estimate/scripts/lib/quote-check.mjs'],
  ['src/estimate/direct.mjs', 'plugin/skills/estimate/scripts/lib/estimate/direct.mjs'],
  ['src/estimate/indirect.mjs', 'plugin/skills/estimate/scripts/lib/estimate/indirect.mjs'],
  ['src/estimate/estimate.mjs', 'plugin/skills/estimate/scripts/lib/estimate/estimate.mjs'],
  ['data/estimate-rates.json', 'plugin/skills/estimate/scripts/data/estimate-rates.json'],
  // F44e: 建築系の共通費の計算と、原文から読んだ率の表
  ['src/estimate/kyotsuhi.mjs', 'plugin/skills/estimate/scripts/lib/estimate/kyotsuhi.mjs'],
  ['data/kyotsuhi-rates.json', 'plugin/skills/estimate/scripts/data/kyotsuhi-rates.json'],
  // F44a: 工種の一覧(積算の表がある工種か)
  ['src/work-kinds.mjs', 'plugin/skills/estimate/scripts/lib/work-kinds.mjs'],
  // F42b: 標準単価表と労務単価を手元に取る道具(plugin を入れた人も使えるように)
  ['scripts/fetch-estimate-data.mjs', 'plugin/skills/estimate/scripts/fetch-estimate-data.mjs'],
  ['scripts/estimate-tables.mjs', 'plugin/skills/estimate/scripts/estimate-tables.mjs'],
  ['scripts/pdf-text.mjs', 'plugin/skills/estimate/scripts/pdf-text.mjs'],
  ...['kensetsu-3', 'kensetsu-24_8', 'kensetsu-26', 'rei-2', 'rei-7_4', 'rei-27', 'nyukei-15', 'kisoku-14_2']
    .map((id) => [`data/sources/law-${id}.txt`, `plugin/skills/construction-check/reference/sources/law-${id}.txt`]),
];

// 元と違う写し(無いものを含む)の一覧を返す
export function staleCopies(root = ROOT) {
  return PLUGIN_COPIES.filter(([src, dst]) => {
    const d = path.join(root, dst);
    if (!fs.existsSync(d)) return true;
    return !fs.readFileSync(path.join(root, src)).equals(fs.readFileSync(d));
  }).map(([, dst]) => dst);
}

export function syncCopies(root = ROOT) {
  for (const [src, dst] of PLUGIN_COPIES) {
    fs.mkdirSync(path.dirname(path.join(root, dst)), { recursive: true });
    fs.copyFileSync(path.join(root, src), path.join(root, dst));
  }
}

export const USAGE_LINE = '使い方: node scripts/sync-plugin.mjs [--check](くわしくは --help)';
export const USAGE = [
  '使い方: node scripts/sync-plugin.mjs [--check]',
  '',
  'plugin/ の中の写しを、元のファイルから作り直します。プラグインは入れたときに別の場所へ写されるので、道具が使う部品も plugin/ の中に置きます。',
  '読むもの: 写しの元(integration/claude-code/・src/・data/ と scripts/ の一部)',
  '書くもの: plugin/ の中の写し(--check のときは何も書きません)',
  '終わり方: 作り直せば 0。--check は元と同じなら 0、違えば 1。引数の誤りは 2',
  '',
  '引数:',
  '  --check     写しが元と同じかだけを確かめる',
  '  --help, -h  この使い方を出す',
  '',
  '例: node scripts/sync-plugin.mjs --check',
].join('\n');

export function main(argv, io, root = ROOT) {
  const done = handleArgs(readArgs(argv.filter((a) => a !== '--check')), io, { usage: USAGE, usageLine: USAGE_LINE });
  if (done !== null) return done;
  if (argv.includes('--check')) {
    const s = staleCopies(root);
    if (s.length) { io.error('元と違う写し: ' + s.join(', ')); return 1; }
    io.log('plugin の写しは元と同じ(' + PLUGIN_COPIES.length + ' ファイル)');
  } else {
    syncCopies(root);
    io.log('plugin の写しを作り直した(' + PLUGIN_COPIES.length + ' ファイル)');
  }
  return 0;
}

const isMain = Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) runMain(main);

// plugin/ の中の写しを、元のファイル(F13 の integration/claude-code/、src/mask/、F20b・F26a の src/quote-check.mjs と data/sources/ の法令の原文)から作り直す(F20a・F20b)
// 使い方: node scripts/sync-plugin.mjs        写しを作り直す
//         node scripts/sync-plugin.mjs --check 写しが元と同じかだけを確かめる(違えば終了コード 1)
// プラグインは入れたときに別の場所(Claude Code のキャッシュ)へ写されるので、道具が使う src/mask/ も plugin/ の中に置く。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
  // F20b: 点検の Skill の条番号の確かめに使う、項・号の切り出しの部品と、取得した法令の原文
  ['src/quote-check.mjs', 'plugin/skills/construction-check/scripts/lib/quote-check.mjs'],
  ['data/sources/index.json', 'plugin/skills/construction-check/reference/sources/index.json'],
  // F26a: 仕様書から規則表を作る Skill の照合(check-quotes.mjs と同じ部品)
  ['src/quote-check.mjs', 'plugin/skills/spec-to-rules/scripts/lib/quote-check.mjs'],
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

const isMain = Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.includes('--check')) {
    const s = staleCopies();
    if (s.length) { console.error('元と違う写し: ' + s.join(', ')); process.exit(1); }
    console.log('plugin の写しは元と同じ(' + PLUGIN_COPIES.length + ' ファイル)');
  } else {
    syncCopies();
    console.log('plugin の写しを作り直した(' + PLUGIN_COPIES.length + ' ファイル)');
  }
}

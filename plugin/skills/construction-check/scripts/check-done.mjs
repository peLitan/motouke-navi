#!/usr/bin/env node
// 点検の Skill の手順6(check_articles)・手順7(refuter)の結果が最後の返事に見えないとき、Stop で1回催促するフック(F56b・F80a)。
// 使う所: プラグインの hooks/hooks.json の Stop(F80a で SKILL.md の frontmatter から移した)。
// 催促は exit 0 で hookSpecificOutput.additionalContext を返す形にする。誤りとして止める decision: block は使わない。
// 手順の催促なので、入力や記録が読めないときは何もしない(読めないときに止める guard-raw とは逆の向き)。
//
// 限界(docs/manual.md にも書く):
// - 見るのは、記録の read_masked と係(Agent/Task)の呼び出しの有無と、最後の返事の文。記録の遅れで余分に出ることがある
// - 係の呼び出しは、入力に refuter の語がある Agent か Task の呼び出しを数える。係が何を返したか、数がその結果と合うか、手順6 の check_articles を呼んだかは見ない
// - 記録は非同期に書かれるので、Stop の時点で今のターンの分がまだ無いことがある
// - 記録の形は公式に書かれていない。assistant の message.content[].type === 'tool_use'(scripts/claude-headless.mjs と同じ読み方)だけを試す

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 道具の名前はプラグインでは mcp__plugin_motouke-navi-guard_masked-files__read_masked、プロジェクトでは mcp__masked-files__read_masked
const READ_MASKED_SUFFIX = '__read_masked';
// 係を呼ぶ道具の名前。公式の名前は Agent で、Task は別名(道具の一覧に Task の名前で出る版がある)
const AGENT_TOOLS = new Set(['Agent', 'Task']);
const REFUTER = 'refuter';
const NOT_REVIEWED = '反証の見直しをしていない';

export const REMINDER = '手順6(check_articles)と手順7(refuter)の結果が最後の返事に見えません。'
  + '済んでいれば、係の結果の数(残る・崩れた・確かめられない)を添えてそのまま終えてください。'
  + '済んでいなければ道具と係を呼ぶか、『反証の見直しをしていない』と書いてください';

// 3語の数はあるが、記録に係の呼び出しが無いときの文(F80a)
export const REMINDER_NO_AGENT = '係の結果の数は書かれていますが、記録に反証の係(refuter)の呼び出しが見えません。'
  + '係を呼んでいなければ、呼ぶか『反証の見直しをしていない』と書いてください。'
  + '記録の遅れで見えないだけなら、そのまま終えてください';

// 語のあとに数(「残る 15」「崩れた: 2件」)か、数のあとに語(「15件が残る」「2件崩れた」)。3語そろって係の結果の数とみなす。
// 「確かめられない」は check_articles の結果にも出るので、1語だけでは手順7 の結果と読まない
const countOf = (word) => new RegExp(`${word}[^0-9０-９\\n]{0,8}[0-9０-９]|[0-9０-９]\\s*件?\\s*[がは]?\\s*${word}`);
const COUNTS = ['残る', '崩れた', '確かめられない'].map(countOf);

const hasCounts = (message) => COUNTS.every((re) => re.test(message));

// 入力を JSON の文にして refuter の語を探す(係の名前の欄に限らない)
const mentionsRefuter = (input) => JSON.stringify(input ?? null).includes(REFUTER);

// 記録(1行ごとの JSON)の道具の呼び出しを見て、read_masked と係(refuter)の呼び出しがあるかを返す。
// 書きかけの行は飛ばす。読み方が合わない形は「無い」と同じ扱いになる
function scanTranscript(transcript) {
  const found = { readMasked: false, refuter: false };
  for (const line of String(transcript).split('\n')) {
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    if (entry?.type !== 'assistant') continue;
    const content = entry.message?.content;
    if (!Array.isArray(content)) continue;
    for (const b of content) {
      if (b?.type !== 'tool_use') continue;
      const name = String(b.name ?? '');
      if (name.endsWith(READ_MASKED_SUFFIX)) found.readMasked = true;
      if (AGENT_TOOLS.has(name) && mentionsRefuter(b.input)) found.refuter = true;
    }
    if (found.readMasked && found.refuter) break;
  }
  return found;
}

const remind = (text) => ({ hookSpecificOutput: { hookEventName: 'Stop', additionalContext: text } });

// 催促するときは Claude Code へ返す出力を、何もしないときは null を返す
export function decide(input, readTranscript = (file) => fs.readFileSync(file, 'utf8')) {
  if (input === null || typeof input !== 'object') return null;
  if (input.stop_hook_active) return null;
  if (typeof input.transcript_path !== 'string' || typeof input.last_assistant_message !== 'string') return null;
  let transcript;
  try { transcript = readTranscript(input.transcript_path); } catch { return null; }
  const found = scanTranscript(transcript);
  // 起点は最初の呼び出し。読み込みの前の停止(手順1 で聞いたときなど)と、点検をしていない会話では催促しない
  if (!found.readMasked) return null;
  const message = input.last_assistant_message;
  if (message.includes(NOT_REVIEWED)) return null;
  if (!hasCounts(message)) return remind(REMINDER);
  if (found.refuter) return null;
  return remind(REMINDER_NO_AGENT);
}

async function main() {
  process.stdin.setEncoding('utf8');
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  const out = decide(JSON.parse(raw));
  if (out) process.stdout.write(JSON.stringify(out) + '\n');
}

const isMain = Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main().catch(() => {});

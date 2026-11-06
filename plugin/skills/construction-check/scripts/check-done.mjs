#!/usr/bin/env node
// 点検の Skill の手順6(check_articles)・手順7(refuter)の結果が最後の返事に見えないとき、Stop で1回催促するフック(F56b)。
// 使う所: このスキルの SKILL.md の frontmatter の hooks: Stop。
// 催促は exit 0 で hookSpecificOutput.additionalContext を返す形にする。誤りとして止める decision: block は使わない。
// 手順の催促なので、入力や記録が読めないときは何もしない(読めないときに止める guard-raw とは逆の向き)。
//
// 限界(docs/manual.md にも書く):
// - 見るのは最後の返事の文だけ。道具や係を実際に呼んだかは見ない
// - 記録は非同期に書かれるので、Stop の時点で今のターンの分がまだ無いことがある
// - 記録の形は公式に書かれていない。assistant の message.content[].type === 'tool_use'(scripts/claude-headless.mjs と同じ読み方)だけを試す

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 道具の名前はプラグインでは mcp__plugin_motouke-navi-guard_masked-files__read_masked、プロジェクトでは mcp__masked-files__read_masked
const READ_MASKED_SUFFIX = '__read_masked';
const NOT_REVIEWED = '反証の見直しをしていない';

export const REMINDER = '手順6(check_articles)と手順7(refuter)の結果が最後の返事に見えません。'
  + '済んでいれば、係の結果の数(残る・崩れた・確かめられない)を添えてそのまま終えてください。'
  + '済んでいなければ道具と係を呼ぶか、『反証の見直しをしていない』と書いてください';

// 語のあとに数(「残る 15」「崩れた: 2件」)か、数のあとに語(「15件が残る」「2件崩れた」)。3語そろって係の結果の数とみなす。
// 「確かめられない」は check_articles の結果にも出るので、1語だけでは手順7 の結果と読まない
const countOf = (word) => new RegExp(`${word}[^0-9０-９\\n]{0,8}[0-9０-９]|[0-9０-９]\\s*件?\\s*[がは]?\\s*${word}`);
const COUNTS = ['残る', '崩れた', '確かめられない'].map(countOf);

const reportedResults = (message) => message.includes(NOT_REVIEWED) || COUNTS.every((re) => re.test(message));

// 記録(1行ごとの JSON)に read_masked の呼び出しがあるか。書きかけの行は飛ばす。読み方が合わない形は「無い」と同じ扱いになる
function calledReadMasked(transcript) {
  for (const line of String(transcript).split('\n')) {
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    if (entry?.type !== 'assistant') continue;
    const content = entry.message?.content;
    if (!Array.isArray(content)) continue;
    if (content.some((b) => b?.type === 'tool_use' && String(b.name ?? '').endsWith(READ_MASKED_SUFFIX))) return true;
  }
  return false;
}

// 催促するときは Claude Code へ返す出力を、何もしないときは null を返す
export function decide(input, readTranscript = (file) => fs.readFileSync(file, 'utf8')) {
  if (input === null || typeof input !== 'object') return null;
  if (input.stop_hook_active) return null;
  if (typeof input.transcript_path !== 'string' || typeof input.last_assistant_message !== 'string') return null;
  let transcript;
  try { transcript = readTranscript(input.transcript_path); } catch { return null; }
  // 起点は最初の呼び出し。読み込みの前の停止(手順1 で聞いたときなど)では催促しない
  if (!calledReadMasked(transcript)) return null;
  if (reportedResults(input.last_assistant_message)) return null;
  return { hookSpecificOutput: { hookEventName: 'Stop', additionalContext: REMINDER } };
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

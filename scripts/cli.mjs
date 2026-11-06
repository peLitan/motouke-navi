// 画面なしの入口(scripts/run-fixtures.mjs・measure-bid-intake.mjs・check-quotes.mjs と build.mjs)の引数の読み方をそろえる(F83a5)
// - --help・-h があれば、ほかの引数を見ずに使い方を出して 0
// - - で始まる知らない引数、値の無いオプション、多すぎる引数は、何も読まず何も書かずに 2
// - 各道具は main(argv, io) を持ち、終了コードを返す。io は出力の先と、相対のパスの起点(試験が差し替える)
import fs from 'node:fs';
import path from 'node:path';

export const defaultIo = () => ({ log: (s) => console.log(s), error: (s) => console.error(s), cwd: process.cwd() });

// values は値を1つ取るオプションの名前。max は位置の引数の数の上限
export function readArgs(argv, { values = [], max = 0 } = {}) {
  if (argv.some((a) => a === '--help' || a === '-h')) return { help: true };
  const positional = [];
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (values.includes(a)) {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('-')) return { error: '値がありません: ' + a };
      opts[a] = v;
      i++;
    } else if (a.startsWith('-')) return { error: '知らない引数: ' + a };
    else positional.push(a);
  }
  if (positional.length > max) return { error: (max ? '引数が多すぎます: ' : 'この道具は引数を取りません: ') + positional.slice(max).join(' ') };
  return { positional, opts };
}

// readArgs の結果のうち、help と error を片付ける。続けてよければ null、終わるなら終了コードを返す
export function handleArgs(r, io, { usage, usageLine }) {
  if (r.help) { io.log(usage); return 0; }
  if (r.error) { io.error(r.error); io.error(usageLine); return 2; }
  return null;
}

// 無いパスは生のスタックを出さずに1行で知らせる。あれば null、無ければ終了コード 1
export function needPath(p, io, { dir = false } = {}) {
  let st;
  try { st = fs.statSync(p); } catch { io.error((dir ? 'フォルダがありません: ' : 'ファイルがありません: ') + p); return 1; }
  if (dir && !st.isDirectory()) { io.error('フォルダではありません: ' + p); return 1; }
  return null;
}

export const resolveIn = (io, p) => path.resolve(io.cwd ?? process.cwd(), p);

// 道具の最後の行から呼ぶ。終了コードは exitCode に置く(出力を書き切ってから終わる)
export function runMain(main) {
  process.exitCode = main(process.argv.slice(2), defaultIo());
}

// 参考の額をまとめる(F42a)。行の積み上げ(lines)か、人が入れた直接工事費(directCost)から工事価格(税抜き)までを出す
import { directCost as stackDirect } from './direct.mjs';
import { indirectCosts } from './indirect.mjs';

export const NOTICE = '公開の資料の式で出した参考の額です。発注者の積算と同じ額にはなりません。会社の原価(自社の人件費・下請けの見積もり)は含みません';

export function estimate({ lines = null, directCost = null, labor = null, ...conditions }) {
  if ((lines === null) === (directCost === null)) throw new RangeError('lines か directCost のどちらか1つを渡してください');
  const direct = lines ? stackDirect(lines, { labor }) : null;
  const value = direct ? direct.total : directCost;
  const warnings = [];
  if (direct?.excluded.length) warnings.push(`合計に入っていない行が ${direct.excluded.length} 件あります。その分の間接費も入っていません`);
  const indirect = indirectCosts({ ...conditions, directCost: value });
  return { label: '参考の額', notice: NOTICE, direct, indirect, workPrice: indirect.workPrice, warnings: [...warnings, ...indirect.warnings] };
}

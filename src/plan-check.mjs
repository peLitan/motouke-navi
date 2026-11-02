// 施工計画書の目次の点検(F07)。
// 貼った目次の行と、data/plan-items.json の記載項目(土木工事共通仕様書(案)令和8年3月 1-1-1-6 の(1)〜(16))を比べ、
// 目次に見当たらない項目を「抜けの候補」として、根拠(箇所・ページ・原文の抜き書き)つきで出す。
// 目次の見出しの言葉だけで比べる。本文に書いてあるかは見ない(候補であって、抜けの断定ではない)。
import planData from '../data/plan-items.json' with { type: 'json' };
import sourcesData from '../data/sources/index.json' with { type: 'json' };

const source = sourcesData.sources.find((s) => s.id === planData.sourceId);
if (!source) throw new Error('施工計画書の記載項目: 出典が無い: ' + planData.sourceId);

// 比べるための形: 全角・半角をそろえ(NFKC)、空白を取る
export function normalizeLine(s) {
  return String(s ?? '').normalize('NFKC').replace(/\s+/g, '');
}

// 目次の1行から、頭の番号(「1.」「1-2」「(1)」「①」「第1章」など)と、かっこの中の補足を取り除く。
// かっこの中を取るのは、「施工方法(主要機械、…)」の「主要機械」で「主要船舶・機械」を見つけたことにしないため
export function tocHeading(line) {
  let s = normalizeLine(line);
  s = s.replace(/^(第[0-9一二三四五六七八九十]+[章節編項]|[0-9]+(?:[-.][0-9]+)*[.)、]?|\([0-9]+\)|[①-⑳]|[a-zA-Z][.)])/, '');
  let prev;
  do { prev = s; s = s.replace(/\([^()]*\)/g, ''); } while (s !== prev);
  return s.replace(/[.…・\-]+[0-9]*$/, '');
}

const TITLE_RE = /^(施工計画書)?目次/;

function basisOf(it) {
  return {
    doc: planData.doc,
    section: planData.section,
    sectionTitle: planData.sectionTitle,
    page: it.page,
    printedPage: it.printedPage,
    quote: it.quote,
    sourceId: planData.sourceId,
    url: source.pdfUrl ?? source.url,
    fetchedAt: source.fetchedAt,
  };
}

export const PLAN_ITEMS = planData.items;

// text: 施工計画書の目次の文(1行に1つの見出し)
// 返す値: { candidates: [{item, no, message, basis}], found: [{item, no, line, byAlias}], extra: [行], notes: [文] }
export function checkPlanToc(text) {
  const lines = String(text ?? '').split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== '');
  if (lines.length === 0) throw new Error('目次が空です');
  const heads = lines.map((l) => ({ line: l, head: tocHeading(l) }));
  const used = new Set();
  const found = [];
  const candidates = [];
  for (const it of planData.items) {
    const label = normalizeLine(it.label);
    const aliases = (it.aliases ?? []).map(normalizeLine);
    let hit = heads.findIndex((h) => h.head.includes(label));
    let byAlias = false;
    if (hit < 0) {
      hit = heads.findIndex((h) => aliases.some((a) => a && h.head.includes(a)));
      byAlias = hit >= 0;
    }
    if (hit >= 0) {
      used.add(hit);
      found.push({ item: it.label, no: it.no, line: heads[hit].line, byAlias });
    } else {
      candidates.push({
        item: it.label,
        no: it.no,
        message: '目次に「' + it.label + '」の見出しが見当たりません。共通仕様書 ' + planData.section + ' の(' + it.no + ')の記載事項です。別の見出しの中に書いてあるか、本文で確かめてください',
        basis: basisOf(it),
      });
    }
  }
  const extra = heads.filter((h, i) => !used.has(i) && !TITLE_RE.test(h.head)).map((h) => h.line);
  const notes = [
    '目次の見出しの言葉だけで比べています。本文に書いてあるか、書いた中身が足りているかは見ていません',
    '共通仕様書 ' + planData.section + ' には「維持工事等簡易な工事においては監督職員の承諾を得て記載内容の一部を省略することができる」とあり、監督職員が補足を求めた項目は追記します。省略の承諾や追記の求めがあるかは、人が確かめてください',
    '国の直轄の土木工事の例です。自治体・民間の工事は、発注者の仕様書の記載事項で置き換えてください',
  ];
  if (found.some((f) => f.byAlias)) notes.push('「書き方が違う」と出た項目は、原文の項目名と違う言葉で見つけたものです。その見出しが記載事項に当たるかを確かめてください');
  return { candidates, found, extra, notes };
}

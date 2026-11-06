// 施工計画書の目次の点検(F07)。
// 貼った目次の行と、data/plan-items.json の記載項目(土木工事共通仕様書(案)令和8年3月 1-1-1-6 の(1)〜(16))を比べ、
// 目次に見当たらない項目を「抜けの候補」として、根拠(箇所・ページ・原文の抜き書き)つきで出す。
// 目次の見出しの言葉だけで比べる。本文に書いてあるかは見ない(候補であって、抜けの断定ではない)。
import planData from '../data/plan-items.json' with { type: 'json' };
import sourcesData from '../data/sources/index.json' with { type: 'json' };
import { sourceVersion } from './source-version.mjs';
import { tableName } from './rules-load.mjs';
import { NOT_READ, ALWAYS_SHOWN, DEFAULT_WORK_KIND, hasKindTable, workKindLabel } from './work-kinds.mjs';
import { kindTable } from './work-kind-tables.mjs';

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
    version: sourceVersion(source),
  };
}

function loadedBasis(it, table) {
  return {
    doc: tableName(table), section: it.section, sectionTitle: '', quote: it.quote,
    url: table.source.url, fetchedAt: table.source.fetchedAt, version: sourceVersion({ edition: table.source.edition }),
  };
}

export const PLAN_ITEMS = planData.items;

// 建築系の語の有無(F44d)。1.2.2 に記載事項の列挙は無いので、土木の16項目を流用せず、語が目次の行にあるかだけを見る。
// かっこの中も見る(「施工計画書(総合施工計画書)」のように語がかっこに入るため)。目次に無い語は書類が別のこともあるので候補にとどめる
function checkKindWords(data, lines) {
  const source = sourcesData.sources.find((s) => s.id === data.sourceId);
  if (!source) throw new Error('施工計画書の語: 出典が無い: ' + data.sourceId);
  const norm = lines.map(normalizeLine);
  const used = new Set();
  const found = [];
  const candidates = [];
  for (const it of data.items) {
    let hit = norm.findIndex((l) => l.includes(normalizeLine(it.label)));
    const byAlias = hit < 0;
    if (byAlias) hit = norm.findIndex((l) => it.aliases.some((a) => l.includes(normalizeLine(a))));
    if (hit >= 0) {
      used.add(hit);
      found.push({ item: it.label, no: it.no, line: lines[hit], byAlias });
      continue;
    }
    const proviso = it.provisoQuote ? '原文には「' + it.provisoQuote + '」ともあります。' : '';
    candidates.push({
      item: it.label,
      no: it.no,
      message: data.doc + ' ' + it.section + ' に「' + it.label + '」があります。目次にその語が見当たりません。' + proviso + it.hint,
      basis: {
        doc: data.doc, section: it.section, sectionTitle: data.sectionTitle, page: it.page, quote: it.quote,
        sourceId: data.sourceId, url: source.pdfUrl ?? source.url, fetchedAt: source.fetchedAt, version: sourceVersion(source),
      },
    });
  }
  const extra = lines.filter((l, i) => !used.has(i) && !TITLE_RE.test(tocHeading(l)));
  const notes = ['目次の見出しの言葉だけで比べています。本文に書いてあるか、書いた中身が足りているかは見ていません', ...data.notes];
  if (found.some((f) => f.byAlias)) notes.push('「書き方が違う」と出た項目は、原文の語と違う言葉で見つけたものです。その見出しが当たるかを確かめてください');
  return { candidates, found, extra, undecidable: [], notes, wordsOnly: true, scope: data.doc + ' ' + data.section };
}

// 1-1-1-6 は国の直轄の土木工事の共通仕様書の条。建築一式工事の施工計画書には対応する記載項目が無い(critic の指摘4)
export const KENCHIKU_UNDECIDABLE = '建築一式工事なので、国の直轄の土木の共通仕様書 ' + planData.section + ' の記載項目は当てはまりません。対応する記載項目が無いので、目次の抜けは判断できません。発注者の仕様書(公共建築工事標準仕様書など)の記載事項で確かめてください';

// 見出しが語と同じか(F77b)。tocHeading が取り残す番号・ページ番号(「1-1」「p.1」「3頁」「第1部」「■」「一」「ア」)の書き方は多いので、
// 字の形を挙げず、語を除いた残りに語(漢字・かな)が無ければ同じとみる。英字は語に数えない
const OUTLINE_TOKEN = /第[0-9一二三四五六七八九十]+[章節編項部]?|[0-9]+(?:頁|ページ)/g;
function sameHeading(head, word) {
  if (!head.includes(word)) return false;
  const left = head.replace(word, '').replace(OUTLINE_TOKEN, '').replace(/[^\p{sc=Han}\p{sc=Hiragana}\p{sc=Katakana}]/gu, '');
  return left === '' || /^[一二三四五六七八九十]+$/.test(left) || /^[ぁ-んァ-ン章節編項部]$/.test(left);
}

// 1つの項目の見出しを探す(F77b)。同じ見出しを先に探し、無いときだけ含む見出しを探す。
// 言い換えの語を含む見出しは見つけたに数える。項目名だけを含む見出しは found に入れず、partial で返して候補に回す。
// 項目名の中に言い換えの語があるとき(緊急時の体制及び対応と緊急時の体制など)は、項目名を含む見出しも言い換えの語を含むので見つけたに数える。
// byAlias は今までどおり「見つけた見出しに項目名が無い」ときだけ true
function findHeading(heads, label, aliases) {
  const hasLabel = (h) => h.head.includes(label);
  const hasAlias = (h) => aliases.some((a) => h.head.includes(a));
  const order = [(h) => sameHeading(h.head, label), (h) => aliases.some((a) => sameHeading(h.head, a)), (h) => hasLabel(h) && hasAlias(h), hasAlias];
  for (const match of order) {
    const hit = heads.findIndex(match);
    if (hit >= 0) return { hit, byAlias: !hasLabel(heads[hit]) };
  }
  return { hit: -1, partial: heads.find(hasLabel) };
}

// text: 施工計画書の目次の文(1行に1つの見出し)
// opts.workType: 'kenchiku-ikkatsu'(建築一式)|'other'|未指定。建築一式なら照合せず「判断できない」を返す
// opts.table: 読み込んだ表(F26b)。記載項目の行があれば、国の直轄の例の代わりにその行と比べる
// opts.workKind: 工種(F44a。無ければ土木)。読み込んだ表が無く工種の記載項目も無ければ、土木の項目を流用せず notRead: true を返す。建築系は語の有無だけを見て wordsOnly: true を返す(F44d)
// 返す値: { candidates: [{item, no, message, basis, partial?}], found: [{item, no, line, byAlias}], extra: [行], undecidable: [{message}], notes: [文] }
export const OTHER_NOTE = '(16)は受け皿の項目なので、見出しが無くても抜けとは限らない。監督職員が求めた項目があれば書く';

export function checkPlanToc(text, opts = {}) {
  const lines = String(text ?? '').split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== '');
  if (lines.length === 0) throw new Error('目次が空です');
  const table = opts.table?.planItems?.length ? opts.table : null;
  const workKind = opts.workKind ?? DEFAULT_WORK_KIND;
  if (!table && !hasKindTable(workKind, 'plan')) {
    return {
      candidates: [], found: [], extra: [], notes: [], notRead: true, workKind,
      undecidable: [{ message: NOT_READ + '(工種: ' + workKindLabel(workKind) + ')ので、目次を比べていません。発注者の仕様書で確かめてください。' + ALWAYS_SHOWN + '。' }],
    };
  }
  const kindWords = table ? null : kindTable(workKind, 'plan');
  if (kindWords?.wordsOnly) return checkKindWords(kindWords, lines);
  if (opts.workType === 'kenchiku-ikkatsu' && table) {
    return {
      candidates: [], found: [], extra: [], scope: tableName(table),
      undecidable: [{ message: '建築一式工事なので、読み込んだ表(' + tableName(table) + ')の記載項目が当てはまるかを決められません。特記仕様書で確かめてください' }],
      notes: ['工事の種類が「建築一式工事」なので、目次を読み込んだ表と比べていません'],
    };
  }
  if (opts.workType === 'kenchiku-ikkatsu') {
    return {
      candidates: [], found: [], extra: [],
      undecidable: [{ message: KENCHIKU_UNDECIDABLE }],
      notes: ['工事の種類が「建築一式工事」なので、目次を共通仕様書 ' + planData.section + ' と比べていません'],
    };
  }
  const heads = lines.map((l) => ({ line: l, head: tocHeading(l) }));
  const used = new Set();
  const found = [];
  const candidates = [];
  for (const it of table ? table.planItems : planData.items) {
    const label = normalizeLine(it.label);
    const aliases = (it.aliases ?? []).map(normalizeLine).filter(Boolean);
    const { hit, byAlias, partial } = findHeading(heads, label, aliases);
    if (hit >= 0) {
      used.add(hit);
      found.push({ item: it.label, no: it.no, line: heads[hit].line, byAlias });
    } else {
      const why = partial
        ? '見出し『' + partial.head + '』の一部にだけ当たります。その見出しがこの記載事項に当たるか確かめてください'
        : '目次にその見出しが見当たりません。別の見出しの中に書いてあるか、本文と発注者の仕様書で確かめてください';
      candidates.push({
        item: it.label,
        no: it.no,
        message: (table ? tableName(table) + ' ' + it.section : '国の直轄の土木の共通仕様書 ' + planData.section) + ' では(' + it.no + ')「' + it.label + '」が記載事項です。' + why,
        basis: table ? loadedBasis(it, table) : basisOf(it),
        ...(partial ? { partial: true } : {}),
      });
    }
  }
  const extra = heads.filter((h, i) => !used.has(i) && !TITLE_RE.test(h.head)).map((h) => h.line);
  const notes = table ? [
    '目次の見出しの言葉だけで比べています。本文に書いてあるか、書いた中身が足りているかは見ていません',
    '読み込んだ表の行です: ' + tableName(table) + '(' + table.source.edition + ' の版)。言い換えの語を持たないので、書き方が違う見出しは抜けの候補に出ます',
  ] : [
    '目次の見出しの言葉だけで比べています。本文に書いてあるか、書いた中身が足りているかは見ていません',
    '共通仕様書 ' + planData.section + ' には「維持工事等簡易な工事においては監督職員の承諾を得て記載内容の一部を省略することができる」とあり、監督職員が補足を求めた項目は追記します。省略の承諾や追記の求めがあるかは、人が確かめてください',
    '国の直轄の土木工事の例です。自治体・民間の工事は、発注者の仕様書の記載事項で置き換えてください',
  ];
  // (16)その他は受け皿の項目。照合はするが、見出しが無いことは抜けとは限らないと注意に出す(開発中の判断 B)
  if (candidates.some((c) => c.no === 16 && c.item === 'その他')) notes.push(OTHER_NOTE);
  if (found.some((f) => f.byAlias)) notes.push('「書き方が違う」と出た項目は、原文の項目名と違う言葉で見つけたものです。その見出しが記載事項に当たるかを確かめてください');
  if (candidates.some((c) => c.partial)) notes.push('見出しの一部にだけ当たる項目は、見つけたに数えず候補に回しました');
  return { candidates, found, extra, undecidable: [], notes, ...(table ? { scope: tableName(table) } : {}) };
}

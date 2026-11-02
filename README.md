# (作品名は後で決める)

工事の条件から、入札前の確認・施工体制台帳の要否・書類の点検の候補を出す道具(作成中)。

## データと出典

### 法令の原文(e-Gov 法令 API)
`node scripts/fetch-sources.mjs` で e-Gov 法令 API(v2)から取得し、本則の条だけを `data/sources/` に保存した。一覧と取得日は `data/sources/index.json`。

| 法令 | 条 | URL | 取得日 |
|---|---|---|---|
| 建設業法 | 第3条・第24条の8・第26条 | https://laws.e-gov.go.jp/law/324AC0000000100 | 2026-11-02 |
| 建設業法施行令 | 第2条・第7条の4・第27条 | https://laws.e-gov.go.jp/law/331CO0000000273 | 2026-11-02 |
| 公共工事の入札及び契約の適正化の促進に関する法律 | 第15条 | https://laws.e-gov.go.jp/law/412AC0000000127 | 2026-11-02 |

取得に使った API: `https://laws.e-gov.go.jp/api/2/law_data/<法令ID>?response_format=xml`。どの改正の版かは index.json の `revisionId` にある。法令は改正されるので、使う前に e-Gov で原文を確かめ直すこと。

### 国土交通省の資料
- 「建設業許可事務ガイドライン」(国土交通省、令和7年2月1日から適用) https://www.mlit.go.jp/totikensangyo/const/content/001860019.pdf (取得日 2026-11-02)。消費税の扱いの根拠として、44ページの【その他】「２．法等における「請負代金の額」等の内容について」の見出しと本文だけを、PDF の文字のまま `data/sources/mlit-kyoka-guideline-sonota-2.txt` に写した。全文は再配布しない。
  - 出典: 国土交通省「建設業許可事務ガイドライン」(https://www.mlit.go.jp/totikensangyo/const/content/001860019.pdf)。公共データ利用規約(第1.0版)(PDL1.0)に従って利用する(PDF に権利表記が無いので、国土交通省ウェブサイト利用規約 https://www.mlit.go.jp/links/terms-of-use.html による)
  - 加工: 節の一部を抜き出し、規則表(`data/rules.json` の `amountBasis`)の根拠に使った。加工したのはこの作品の作者(開発用のエージェントを含む)。このツールの出力は国土交通省が作成したものではありません

# 受け入れ条件と受け入れテストの対応

受け入れ条件の文書(開始前に書き、利用者が承認したもの。このリポジトリの外に置いている)の各節の箇条を、上から順に番号を付けて引く(例: F03-2 = F03 の節の2つ目の箇条)。条件の文はここに写さず、要点だけを短く書く。

テストはすべて `tests/acceptance/` にある。共通の部品は `_helpers.mjs`(原文との照合、条の漢数字、金額の漢数字、zip・xlsx の組み立て)と `_schedule-common.mjs`(共通仕様書の根拠の照合)。

## 対応表

| 条件 | 要点 | テスト(ファイル: テスト名の要点) |
|---|---|---|
| F02-1 | 7つの条の原文を取得日・URL つきで保存 | sources.test.mjs: 条ごとの行(e-Gov の URL・法令 ID・取得日・条の見出し)、ガイドラインの URL と取得日 |
| F02-2 | 抜き書きは原文と一致(空白だけ許す)。不一致は規則表に入れない | quotes.test.mjs: data/quotes.json の全件照合、verifyQuote、filterVerifiedRules |
| F02-3 | 例外・参照の語があるのに欄が空なら警告 | exceptions-scan.test.mjs: scanExceptions、findExceptionWarnings |
| F03-1 | 公共: 下請契約で台帳、写しの提出、措置があれば提出不要 | rules-public.test.mjs: 下請契約あり・措置あり・下請なし |
| F03-2 | 民間: 特定・直接・総額の境目(4,999万/5,000万、7,999万/8,000万) | rules-private.test.mjs: 2つの境目のテスト(施行令 第7条の4 の抜き書きに金額があることも照合) |
| F03-3 | 直接でなければ元請けとしての対象外 | rules-public.test.mjs・rules-private.test.mjs: 発注者から直接でない |
| F03-4 | 税込み・税抜きを原文で確かめ根拠つきで規則表に。画面の金額欄に明示 | rules-private.test.mjs: amountBasis(国交省ガイドラインの抜き書き)。ui-input.test.mjs: subcontract-total の label |
| F03-5 | 許可の種類を入力に持ち、一般で境目以上は確認が要ると根拠つき | rules-private.test.mjs: 一般建設業者で境目以上 |
| F03-6 | 各行に根拠(法令名・条・項・抜き書き) | rules-public.test.mjs・rules-private.test.mjs: 規則表の行と結果の根拠の照合(basisVerified は項の中に抜き書きがあるかまで見る)。quotes.test.mjs: 法令の抜き書きの項 |
| F04-1 | 台帳から抜け・食い違いの候補を根拠の条つきで | check-taicho.test.mjs: 工事の内容・工期の抜け、主任技術者の抜け、技術者・許可の食い違い。ui-check.test.mjs: 読み取りから表示まで |
| F04-2 | 仕込みの無い書類に候補を出さない | check-taicho.test.mjs: 抜けも食い違いも無い台帳、境目未満、1件だけ出る。fixtures/ の3件での言い過ぎの数は F04b(利用者が受け持つ採点)で測る |
| F04-3 | 判断できないときは「判断できない」 | check-taicho.test.mjs: 金額が分からない。ui-check.test.mjs: 判断できないの表示 |
| F04-4 | 作成例の様式の Excel を読み込み、読めない欄を画面に | excel.test.mjs: 取得した作成例の .xlsx を data/sources に置いてそのまま読み込み、主な欄が読めるか読めない欄に挙がるか。自作の表での読み取りと読めない欄。画面の入力欄 |
| F05-1 | 条件 → 段取り、台帳 → 点検の候補 | schedule-start.test.mjs: 画面を動かす(確認のボタンで段取りも出る)。ui-check.test.mjs: 画面を動かす(台帳を貼って点検) |
| F05-2 | 画面は外部と通信しない(CSP・外部読み込み・通信の API) | no-network.test.mjs |
| F05-3 | 常に出す文と PDL1.0 の表示 | no-network.test.mjs: 常に出す文、PDL1.0 の表示 |
| F05-4 | 入れた書類をブラウザに保存しない | ui-input.test.mjs: 保存の仕組みが無い。mask-text.test.mjs: 部品と画面 |
| F05-5 | 実際の1人に触ってもらう(人の確認・任意) | 受け入れテストでは確かめない(条件のとおり)。F05d で人が扱う |
| F05-6 | 印刷と CSV の書き出し(通信しない) | export.test.mjs(toCsv・入札前の確認・台帳が要るか・画面を動かす)。点検の候補は ui-check.test.mjs の checkRows、段取りは schedule-start.test.mjs の scheduleRows、施工計画書は check-plan.test.mjs の planRows |
| F05-7 | 見本を読み込むボタン | sample.test.mjs: 画面を動かす(押すと欄に入り、そのまま確認できる)。ui-check.test.mjs: 見本の台帳も入り、読める |
| F05-8 | index.html を1つ開くだけで動く。README に開き方・試し方 | ui-input.test.mjs: build.mjs と同じ・別ファイルの import が無い。sample.test.mjs: README |
| F05-9 | 法令・資料の取得日と、確かめ直す旨を画面に | ui-input.test.mjs |
| F05-10 | 機能が通るたびに画面から使える | 画面を持つ機能のテストは、index.html のスクリプトを最小の DOM で動かして確かめる: ui-input・export・sample・mask-text・ui-check・schedule-start・check-plan。ほかに欄と組み込みの確認: mask-map・mask-files・excel・claude-send。画面の無い判定の機能(F03a・F03b・F10・F04a・F06b)との並びの食い違いは、利用者の回答(2026-11-02)で「段ごと」と決まった。段の終わりの画面の機能(F05a・F05b・F06a)で、その段の結果を画面から使えるようにする |
| F06-1 | 着手から完成・引き渡しまで、各行に いつ・何を・誰に・根拠(令和8年3月版) | schedule-start.test.mjs(着手まで)、schedule-work.test.mjs(施工中・完成・順番) |
| F06-2 | 国の直轄の例である断り | schedule-start.test.mjs: 画面の断り |
| F07-1 | 目次から記載項目の抜けの候補を根拠のページつき(1-1-1-6) | check-plan.test.mjs |
| F10-1 | 案件の条件 → 受注したら要るもの(許可・台帳と写し・技術者・体系図)を根拠の条つき | bid-check.test.mjs: 一覧の形、公共、確認が要る点、根拠の条に例外の語があれば項目の例外の欄が空でない |
| F10-2 | 専任の要否を施行令 第27条の原文の金額で | bid-check.test.mjs: 専任(金額は抜き書きから取り、漢数字で照合) |
| F10-3 | 入札・参加の可否を出さず、判断は人がすると出す | bid-check.test.mjs: 一覧の形(禁止の言い方、disclaimer)。ui-input.test.mjs: 表示 |
| F10-4 | 境目で正しく分かれる | bid-check.test.mjs: 4,999万/5,000万、7,999万/8,000万 |
| F11-1 | 文と .txt・.docx・.xlsx の文字を記号に置き換え、前・後・対応表を並べる | mask-text.test.mjs(文と画面)、mask-files.test.mjs(ファイル) |
| F11-2 | 同じ語は同じ記号。戻ってきた文を元に戻せる | mask-text.test.mjs |
| F11-3 | 対応表の書き出し・読み込み、元の名前が入っている旨 | mask-map.test.mjs |
| F11-4 | 辞書に足せる。辞書・対応表・原文を保存しない | mask-text.test.mjs: addTerm、保存の仕組みが無い |
| F11-5 | 金額はそのままか境目以上・未満か選べる | mask-text.test.mjs: 部品の引数と、画面の選ぶ欄(mask-amounts) |
| F11-6 | 建設の語に依存しない(別の辞書)。通信しない | mask-text.test.mjs: 部品の文字の検査。通信は no-network.test.mjs |
| F11-7 | 漏れの率・置き換えすぎの率を docs/ に(正解の表は外) | 受け入れテストでは確かめない。F11b の確かめ方(docs/ の数字と check-publish)で扱う |
| F11-8 | 漏れが0にならない・組み合わせのおそれを画面と README に。「保証」と書かない | mask-text.test.mjs |
| F12-1 | 手元の node が置き換えた後のファイルだけを送る。画面は通信しない | claude-send.test.mjs: 送る中身、画面に送り先が無い |
| F12-2 | AI の候補と付け、法令の判定と分けて表示 | claude-send.test.mjs: aiCandidates の label、画面の別の欄 |
| F12-3 | 送る前に漏れを再検査し止める。中身を全部見せ、人が選んだときだけ送る | claude-send.test.mjs: 漏れで止める、選ばなければ送らない |
| F12-4 | 鍵は環境変数から。記録に鍵・原文・対応表を残さない | claude-send.test.mjs: getApiKey、記録の検査、コードの検査 |
| F12-5 | 返事を模して試験する。本物は人が確かめる | claude-send.test.mjs は send・fetch を模す。本物は F12b で人が扱う |
| F12-6 | README に送った内容の扱いを公式 URL つきで | claude-send.test.mjs: README |
| F13-1 | MCP の道具・permissions.deny・PreToolUse のフックを作品に入れる | claude-code.test.mjs: 設定 |
| F13-2 | Read と @ が止まり、道具からは置き換えた後の中身だけ | claude-code.test.mjs: フック(Read・Grep・Glob、@)、MCP の道具 |
| F13-3 | cat などの限界を README に、「保証」と書かない | claude-code.test.mjs: README |

対応しない条件: 0(F05-5・F11-7・F12-5 の人の確認と測定の部分は、条件の文自体が受け入れテストの外と定めているので、扱う機能を書いた)。

## テストが決めている作りの約束(実装はこれに合わせる)

- 出典: `data/sources/index.json` の `sources` に `{id, kind: 'law'|'document', law, article('24の8' の形), title, url, fetchedAt('YYYY-MM-DD'), file}`。原文は `data/sources/<file>`
- 抜き書き: `data/quotes.json` の `quotes` に `{id, sourceId, article, paragraph, item, text}`
- 規則表: `data/rules.json` の `rules` に `{id, scope: 'public'|'private', condition, action, basis: [{quoteId}], exceptions: []}`、`amountBasis: {tax, basis}`
- 判定の入力(共通): `{orderer: 'public'|'private', direct, workType: 'other'|'kenchiku-ikkatsu', contractAmount, hasSubcontract, subcontractTotal(税込), license: 'tokutei'|'ippan', engineerQualification: 'kanri'|'shunin', ictMeasure}`
- 根拠の形(結果の中): `{law(正式な法令名), article, paragraph, quote}`
- 部品: `src/quote-check.mjs`、`src/exception-scan.mjs`、`src/taicho.mjs`(judgeTaicho)、`src/bid-check.mjs`(bidCheck・dedicatedThreshold)、`src/ui/form.mjs`(readBidForm)、`src/ui/view.mjs`(render の関数)、`src/export.mjs`、`src/sample.mjs`、`src/mask/core.mjs`・`src/mask/dict-construction.mjs`・`src/mask/extract.mjs`、`src/check-taicho.mjs`、`src/ledger-text.mjs`、`src/ledger-xlsx.mjs`、`src/schedule.mjs`、`src/plan-check.mjs`、`data/plan-items.json`、`tools/claude-check.mjs`、`integration/claude-code/`
- 画面: `build.mjs` の `buildHtml()` が src から `index.html` を組み立てる(ファイル1つ)。欄の id は各テストに書いてある
- 原文のファイル: 法令の条は、第2項以降を行の頭の項の番号(「２」など)で始める(e-Gov の表示と同じ)。抜き書きの項はこれで照合する
- 判定の結果の項目に例外・参照があるときは `exceptions`(配列)に書く
- Excel の読み込み(readLedgerXlsx)の返り値: `{ledger, unreadable: [{key('project.contractAmount' の形), field(欄名), reason, cause: 'not_found'|'empty'|'invalid'}], found: {key: {label: 欄名のセル番地, value: 値のセル番地}}}`。取得した作成例では、主な7欄すべての欄名のセル(文字が欄名に当たる)と値のセルを見つける(見つからない欄は0)。試験は値のセルに架空の値をインラインの文字(t="inlineStr")か数で書いて読み直すので、共有文字列とインラインの文字の両方を読む
- 画面のコード(試験は `_helpers.mjs` の runPage が node:vm と最小の DOM で動かす):
  - スクリプトは別ファイルを読まない(import・export を含まない。type="module" でない普通の script か、import・export の無い module)
  - 要素は getElementById か querySelector('#id') で取る(querySelector は `#id` の形だけ。`[name=…]`・id の無い form・委任の中の closest・matches は使わず、e.target.id で振り分ける)
  - 受け方: 要素の addEventListener・onclick、document・window での委任(click は泡立つ)、form の submit(type="submit" のボタンを押すと form に submit が届く)。async の handler も待つ
  - 入力は .value・.checked、結果は innerHTML か textContent。CSV は Blob で作る(中身を試験が読む)
  - 使える物: Event・CustomEvent・requestAnimationFrame・setTimeout(すぐ動く)・FileReader(最小)・getComputedStyle(空)。ほかのブラウザの API は無い
  - 確認のボタン(bid-run)で、入札前の確認・台帳が要るか・段取りの3つの欄を埋める。台帳の点検は画面の orderer の欄から公共・民間を取る。dict-kind の選択肢の値は対応表の種類(person など)

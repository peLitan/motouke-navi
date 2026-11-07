# 開発の記録

Claude Code でこの作品を作った流れを、git の履歴と今の文書から取った数字で書きます。新しく走らせた評価の数字はありません。

コミットを数えた日時: 2026-11-06 23:06(HEAD ed871ab。この記録を足すコミットの前の数)

## 見つけた → 直した → 測り直した

見つけたことが直しになり、測り直しまで届いたかを1行ずつ書きました。「未測」「未」の後ろの(残 n)は、下の[残っていること](#残っていること未測直していない)の番号です。「採点」は、仕込みの行では仕込み表との照らし合わせ、ほかの行では別の係が作品を読み直して点を付けた回です。「数で比べていない」の行は、直した前後を数えた記録がありません。

| 日 | 誰が見つけた | 何 | 再現の試験 | 直したコミット | 前 → 後(版・日時・命令) | 測り直していない所 |
|---|---|---|---|---|---|---|
| 2026-11-02 | critic | 指摘1: 二次の下請けを元請けの下請総額に足していた(工事 B の言い過ぎ) | `tests/unit/ledger-text.test.mjs`「二次の下請け(見出しの「二次」か「(一次: 会社名)」)は、元請けの下請総額に数えない(第26条第2項)」 | 1286953 | 工事 B のこの候補は 0 件になった(`docs/critic.md`) | 仕込みの採点は 7ba4f4f の出力まで(残 7) |
| 2026-11-02 | critic | 指摘2: 台帳の点検で技術者の専任を見ていなかった(工事 A・B の見落とし) | `tests/unit/senin.test.mjs`「公共・境目以上・監理技術者が非専任なら、第26条第3項・施行令 第27条を根拠に候補にし、ただし書は「確かめること」に付ける」 | c76e91f(F04d) | 数で比べていない | 仕込みの採点は 7ba4f4f の出力まで(残 7) |
| 2026-11-02 | critic | 指摘3: 工事 B の発注者が書類どうしで違うのに気づかない | `tests/unit/cross-docs.test.mjs`「3つの食い違いが出る: 片方だけの下請負人・技術者の氏名・発注者(判断できない)」 | 1286953(一部)、ee5d15e(F32a) | 仕込みの行の 7 → 9 に入る | 仕込みの採点は 7ba4f4f の出力まで(残 7) |
| 2026-11-02 | critic | 指摘4: 建築一式の工事に土木の記載項目を当て、16項目のうち13項目が候補になった | `tests/unit/plan-check.test.mjs`「工事の種類が建築一式なら照合せず、「判断できない」を1件出して候補は出さない」 | 856aa1f(F07b) | 工事 B の目次の候補 13 → 0、判断できない 0 → 1(`docs/critic.md` と `docs/評価.md` の 1) | 仕込みの採点は 7ba4f4f の出力まで(残 7) |
| 2026-11-02 | critic | 指摘5: 目次の取り違え。「交通安全管理」を「安全管理」として見つけたことにする | `tests/unit/plan-partial.test.mjs`「「9. 交通安全管理」だけの目次では、安全管理を見つけたに数えず、理由つきで候補に回す」 | 81b5ee8(F77b。2026-11-06 22:16) | `node scripts/run-fixtures.mjs` の差は工事 C の (4)指定機械が候補に回っただけ | 言い換えの語の取り違えは残る(残 13)。採点はし直していない(残 7) |
| 2026-11-03〜11-04 | 採点 | 仕込み 11 件のうち見つけた数が少ない(5→7→9) | `tests/unit/cross-docs.test.mjs`「3つの食い違いが出る: 片方だけの下請負人・技術者の氏名・発注者(判断できない)」(7→9 の分) | 5→7 は 1 つに決められない(a42e2c0 と f3e5a42 の間。第14条の2 の空の候補 ca36cc7 を含む)。7→9 は ee5d15e(F32a) | a42e2c0(2026-11-03)5 → f3e5a42(2026-11-04 10時)7 → 7ba4f4f(2026-11-04 14時)9。`node scripts/run-fixtures.mjs` の出力を採点 | 7ba4f4f の後は採点していない(残 7) |
| 2026-11-04 | 公式の評価 | 古い組で「丁山」が trace に出た。部署の語の後ろの姓と名が置き換わらない | `tests/unit/mask-dept-person.test.mjs`「部署の語の後ろの姓と名を人名として置き換え、部署の語と書き添えは残す(架空の例10件)」 | d5a0458(F36a) | 古い組の あり 7/8(版 6706949、2026-11-04 19:42〜19:58)→ 8/8(版 46c6c2c、2026-11-05 05:17〜05:34)。`claude plugin eval` | 新しい組は未測(残 2) |
| 2026-11-06 | 採点 | E2 の施工体系図の二次の会社「架空電設サービス」が置き換わらない見込み | `tests/unit/mask-e2-leak.test.mjs`「E2 の施工体系図: 木の行と表の括弧の中の2か所とも残らず、同じ記号になる」 | 5fb9475(F75a) | 未測(残 2) | E2 の走らせ(残 2)、漏れの率(残 1) |
| 2026-11-04〜11-06 | 画面なしの入口の記録・採点 | 手順6 の条番号の確かめが Bash のスクリプトで、断られて動かない回があり、公式の評価の中では動かない | `tests/unit/check-articles-tool.test.mjs`「tools/list: read_masked・list_masked・check_articles・check_conditions の4つ。check_articles の引数は text だけ」 | 2a62afc(F36c。手順の文)、5da83f2(F56a。MCP の道具) | 2026-11-04 22時台は動かず、版 156b15c(2026-11-05)で動いた。`node scripts/claude-headless.mjs`。F56a の後は未測(残 5) | F56a の後の画面なしの入口と公式の評価(残 2・残 5) |
| 2026-11-06 | 採点 | 元請けの実績の知らせの見落としと誤報。F60a の後も誤報 5 文・見落とし 1 文 | `tests/unit/prime-false-positives.test.mjs`「誤報の5文は当たらない」 | 8e978f3(F60a)→ a813902(F77a)→ beda711(F77c) | 手元の公告の当たりは a813902 と beda711 で前の版と同じ | 語で探すので取りこぼしと取り違えは残る(残 14) |
| 2026-11-03 | 測り(作る側は書類を見ていない別の担当) | 置き換えの漏れ。初めて見る書類4件で、見本の書類の率が当てにならない | `tests/unit/company-types.test.mjs`「法人の種類の一覧: 株式会社のほか、社団・財団・NPO・医療・福祉・学校・組合・士業の法人を名前の前・後ろのどちらでも置き換える」 | 0e6d82b(F24a)、ecc8ce2(F24b)ほか | 辞書に足さない 58.2% → 37.8%、人名・現場名を足した 29.6% → 14.3%。c7cb8f7(2026-11-03)→ 520ced6(2026-11-04 朝)。`node scripts/mask-rate.mjs` | 以後は未再測(残 1) |
| 2026-11-06 | 採点 | check-done は記録の `read_masked` の呼び出しを見るが、係の呼び出しは見ないので、係を呼ばなくても数を書けば通る | 未(残 12) | 未(F80a はこの版に入っていない。残 12) | 未測(残 9) | 全部(残 9・残 12) |

## 方針を変えた所

走らせて分かったことで、仕組みの形を変えた所です。

| 日付 | コミット | 何が起きた | 何に変えた |
|---|---|---|---|
| 2026-11-03 | 921ae10(F23a) | 評価の「E1 あり 3」が書類のファイル名を知れず、点検を始めずに止まった(hook が一覧も止めるため) | 名前だけを返す道具 `list_masked` を足した |
| 2026-11-04 | d5a0458(F36a) | 「丁山」が trace に残った | 部署の語の後ろの姓と名を置き換える規則を足した |
| 2026-11-06 | 5da83f2(F56a) | 画面なしの入口で Bash の確かめが断られた。手順の文を直しても、公式の評価の中では Bash を許していない | 確かめを MCP の道具 `check_articles` に替えた |
| 2026-11-06 | 8b07fee(F56b) | 手順7 の反証が文で頼むだけで、抜けても気づけない | Stop の hook で1回催促する形にした |
| 2026-11-06 | 5fb9475(F75a) | E2 の二次の会社の名前が残る | 語尾「電設サービス」を1つ足した。限界は `docs/manual.md` にある |
| 未 | 未(F80a。残 12) | Skill の frontmatter の Stop は、Skill を呼ぶまで登録されない | `hooks/hooks.json` へ移す。この版ではまだ frontmatter のまま |

## 評価の推移

公式の評価 `claude plugin eval` の値です。上の2行は `docs/評価.md` の 7 から写しました。あり・なしの数は、調べた元の名前8つのうち trace に出なかった数です。費用は道具の見積もりです。下の4行はまだ走らせていません(残 2・残 3)。

| 版 | 日 | ケース | 検査の数 | あり(3回) | なし(3回) | 判定 | 費用 | 時間 |
|---|---|---|---|---|---|---|---|---|
| 6706949 | 2026-11-04 | E1 古い組 | 9 | 7/8 | 0/8 | 不合格 | 約 $3.54 | 965秒 |
| 46c6c2c | 2026-11-05 | E1 古い組 | 9 | 8/8 | 0/8 | 合格(古い組の判定) | 約 $3.70 | 1042秒 |
| 未測 | 2026-11-07 の予定 | E1 新しい組 | 18(点に入る 15) | 未測 | 未測 | 未測 | 未測 | 未測 |
| 未測 | 2026-11-07 の予定 | E2 | 21(点に入る 18) | 未測 | 未測 | 未測 | 未測 | 未測 |
| 未測 | 2026-11-07 の予定 | E3 | 未測 | 未測 | 未測 | 未測 | 未測 | 未測 |
| 未測 | 2026-11-07 の予定 | E4 | 未測 | 未測 | 未測 | 未測 | 未測 | 未測 |

読み方:

- `runs: 3` は3回とも通ること(pass^3)で読み、1回でも通った数(pass@3)を並べて書きます。どちらも `scored: true` の検査だけを数えます
- E1・E2・E4 は、前にできたことが落ちていないかを見る退行の評価です。E3 は、できることを広げたかを見る能力の評価です
- `partial: true` の回と `skippedPaidGraders` の回は、推移に入れません
- `arm: with-only` の検査と Skill の `tool_used` は手順の印で、Δ に入りません

## 残っていること(未測・直していない)

この記録のほかの表の「未測」「未」は、ここの番号を指します。元の文書の文が正で、ここは集めただけです。

| 番号 | 区分 | 残っていること | 元の文書 |
|---|---|---|---|
| 残 1 | 未測 | 置き換えの漏れの率の測り直し。2026-11-04 朝の 520ced6 の後の直し(F31・F36・F75a)は率に入っていない | `docs/mask-rate.md` |
| 残 2 | 未測 | E1・E2 の新しい組の走らせ。答えの語の組・手順の印・判定役の検査は、本物の判定役をまだ呼んでいない | `docs/評価.md` の 7 |
| 残 3 | 未測 | E3・E4 の走らせ。この版にはケースもまだ無い | `plugin/evals/` |
| 残 4 | 未測 | モデルの比べ。枠だけがある | `docs/評価.md` の 7 |
| 残 5 | 未測 | 画面なしの入口の走らせ。F56a で替えた後の版では走らせていない | `docs/manual.md` の「走らせた記録」 |
| 残 6 | 未確認 | 今の書式のケースは読み込みまでを見ただけで、モデルは呼んでいない。係の呼び出しの名前が `Agent` か `Task` かは走らせた記録で確かめる | `docs/評価.md` の 7 |
| 残 7 | 未測 | 仕込みの採点のし直し。採点は 7ba4f4f の出力までで、7055986 までは出力が同じことだけを確かめた。F77b の後は工事 C の出力が変わった | `docs/評価.md` の 1 |
| 残 8 | 未測 | 反証の第5弾。第4弾の直しの後の版に反証を回した記録は無い。critic は F77b の目次の直しを見た回だけで、表は無い | `docs/critic.md`、コミット 81b5ee8 |
| 残 9 | 未確認 | `check-done` が Claude Code に登録されるか、`${CLAUDE_PLUGIN_ROOT}` が解けるか(`/hooks` の一覧で確かめる) | `docs/manual.md` の「手順の抜けの催促の限界」 |
| 残 10 | 未確認 | ブラウザで画面を操作して通した確かめとスマホの実機。動きは作り物の DOM で見ている | `docs/manual.md`、`docs/critic.md`、README |
| 残 11 | 未確認 | 見張りは文字で探すだけで、抜けを無くしたとは言えない。F31a で足した形が本物の Claude Code で当たったかは確かめておらず、Windows の実機の記録も無い | `docs/critic.md` |
| 残 12 | 直していない | `check-done` は手順6・7 の結果を最後の返事の文で見て、係の呼び出しを見ない。Stop は SKILL.md の frontmatter のまま(F80a はこの版に入っていない) | `docs/manual.md` の「手順の抜けの催促の限界」 |
| 残 13 | 直していない | 目次の点検の、言い換えの語の取り違えと、別の語で書かれた見出しの取りこぼし | `docs/critic.md` |
| 残 14 | 直していない | 元請けの実績の知らせは語で探すので、取りこぼしと取り違えがある | `docs/評価.md` の 8 |
| 残 15 | 直していない | 置き換えの漏れは0にならない。語尾「電設サービス」は普通の語の前でも置き換えすぎる | `docs/mask-rate.md`、`docs/manual.md` |
| 残 16 | 直していない | `read_masked` は ISO-2022-JP のファイルを UTF-8 の文として読み、化けた文のまま返す(7ビットの字なので読めない扱いにならない。判別はしていない) | `plugin/mcp/masked-files.mjs` の `decodeFile` |
| 残 17 | 直していない | 反証の A-2・D-2・D-3 の行の「直さなかった所」 | `docs/critic.md` |
| 残 18 | 未測 | プラグインのあり・なしの見落としの評価(12回)は、`list_masked` を足した後も、ケースの名前を変えた後も走らせ直していない | `docs/評価.md` の 5 |
| 残 19 | 未確認 | 県の仕様書から作った31行の意味を人が確かめた記録は無い。作らなかった行の抜けは測っていない | `docs/評価.md` の 6 |
| 残 20 | 未確認 | 規則表の実務の確認は済んでいない | `docs/評価.md` の 2 |
| 残 21 | 未測 | 公開の公告2件の拾いは1回だけで、回ごとのぶれを測っていない。数字はリポジトリの中だけでは再現できない | `docs/評価.md` の 8 |
| 残 22 | 直していない | 参考の積算額は、参考の額として使える大きさになっていない。数字はリポジトリの中だけでは再現できない | `docs/評価.md` の 9 |
| 残 23 | 未確認 | 実在の1人に画面を触ってもらう確かめ(任意)は、まだ答えが無い | `docs/評価.md` の 4 |

## 検討して選ばなかった仕組み

公式の資料で検討して選ばなかったものです。動かして比べてはいません。

| 検討して選ばなかった仕組み | 理由 | 公式の根拠(題名と URL) |
|---|---|---|
| プラグインの係の frontmatter に `hooks`・`mcpServers`・`permissionMode` を書く | プラグインの係では無視されるので、守りを係の設定に置かない | Create custom subagents https://code.claude.com/docs/en/sub-agents |
| 画面なしの入口を `--bare` で動かす | `--bare` ではプラグインの hooks が走らず、`guard-raw` が動かなくなる | Run Claude Code programmatically https://code.claude.com/docs/en/headless |
| Stop を Skill の frontmatter に置き続ける | Skill の hook は Skill を呼んだときに登録されるので、プラグインが有効な間ずっと登録される既定の置き場 `hooks/hooks.json` を選ぶ(F80a。この版ではまだ移していない。残 12) | Plugin manifest reference https://code.claude.com/docs/en/plugins-reference 、Hooks reference https://code.claude.com/docs/en/hooks |
| SubagentStop で係の停止を exit 2 で止める | 測る直前に「あり」の側を変えないため、今回は使わない | Hooks reference https://code.claude.com/docs/en/hooks |

## 見つけた → 直した → 測り直した

| 日 | 誰が見つけた | 何 | 再現の試験 | 直したコミット | 前 → 後(版・日時・命令) | 測り直していない所 |
|---|---|---|---|---|---|---|
| 2026-11-06〜11-07 | 統括の安全の点検(2026-11-06)・設計の会議(2026-11-07) | MCP の道具で読まない所を読めた形・遅さ・落ちる所 | `tests/unit/` の `mcp-open-then-check`・`masked-files-iso2022`・`mcp-name-rules`・`mcp-bad-name`・`check-conditions-redos`・`mcp-denied-set` | 85a688a・51a5dda・04bcde9・415ba29・48d7c8e・F83b6 のコミット | 先に落ちる試験 → 直した(F83b1〜b6)→ 点検のやり直し(版・日時は統括が入れる) | 未測(点検のやり直しは統括) |

## コミットの数

| 数えたもの | 値 | 数え方 |
|---|---|---|
| すべてのコミット | 205 | `git rev-list --count HEAD` |
| Claude の共著の印があるコミット | 202 | `git rev-list --count --grep='Co-Authored-By: Claude' HEAD` |
| 残り(別の担当が走らせた記録を足したもの) | 3 | cc7f9a5・fc3d069・0bf9ca4 |
| F の id の種類 | 187 | 下の3つ目の命令 |
| 最初のコミット | 2026-11-02 20:48 | `git log` |
| 最後のコミット | 2026-11-06 22:47 | `git log` |

3つの数は、次の命令で数えました。

```
git rev-list --count HEAD
git rev-list --count HEAD --grep='Co-Authored-By: Claude'
git log --format=%s | grep -oE '^F[0-9]+[a-z]?' | sort -u | wc -l
```

日ごとのコミットの数:

| 日 | コミット |
|---|---|
| 2026-11-02 | 29 |
| 2026-11-03 | 52 |
| 2026-11-04 | 36 |
| 2026-11-05 | 34 |
| 2026-11-06 | 54 |

## 機能の番号ごとのコミットの流れ

コミットの題の頭の語(`F08-critic` など)を機能の id とし、`F` の後ろの数字ごとに束ねました。番号は 73 種類で、件数の和は 202 です(上の id の種類は `F00b` のように文字まで分けた数です)。題の頭に番号の無い 3 件は上の「残り」で、この表に入れていません。同じ番号の中の id は、最初のコミットの順に並べました。日時は `git log` の著者の日時です。

| 番号 | 件数 | 最初 | 最後 | 機能の id |
|---|---|---|---|---|
| F00 | 2 | 2026-11-02 20:48 | 2026-11-02 21:18 | `F00-init` `F00b-acceptance` |
| F02 | 3 | 2026-11-02 21:23 | 2026-11-02 21:30 | `F02a-law-fetch` `F02b-law-quote` `F02c-law-exceptions` |
| F03 | 4 | 2026-11-02 21:34 | 2026-11-03 07:13 | `F03a-rule-public` `F03b-rule-private` `F03d-private-notify` `F03c-human-check` |
| F04 | 3 | 2026-11-02 22:24 | 2026-11-02 23:38 | `F04a-check-taicho` `F04c-excel` `F04d-senin` |
| F05 | 5 | 2026-11-02 21:49 | 2026-11-02 22:28 | `F05c-no-network` `F05a-ui-input` `F05e-export` `F05f-sample` `F05b-ui-check` |
| F06 | 2 | 2026-11-02 22:43 | 2026-11-02 23:20 | `F06a-schedule-start` `F06b-schedule-work` |
| F07 | 3 | 2026-11-02 22:49 | 2026-11-03 05:37 | `F07-check-plan` `F07b-plan-scope` |
| F08 | 7 | 2026-11-02 23:31 | 2026-11-03 16:57 | `F08-critic` |
| F09 | 4 | 2026-11-03 06:16 | 2026-11-03 18:51 | `F09-submit` |
| F10 | 1 | 2026-11-02 21:47 | 2026-11-02 21:47 | `F10-bid-check` |
| F11 | 5 | 2026-11-02 22:05 | 2026-11-02 22:57 | `F11a-mask-text` `F11d-mask-map` `F11b-mask-rate` `F11c-mask-files` |
| F12 | 2 | 2026-11-02 22:32 | 2026-11-02 23:04 | `F12a-claude-send` |
| F13 | 1 | 2026-11-02 22:53 | 2026-11-02 22:53 | `F13-claude-code` |
| F14 | 7 | 2026-11-03 07:13 | 2026-11-03 10:25 | `F14a-ui-top` `F14b-ui-summary` `F14c-ui-details` `F14d-ui-type` `F14e-ui-mobile` `F14f-ui-answers` `F14g-ui-firstview` |
| F15 | 4 | 2026-11-03 07:23 | 2026-11-03 07:36 | `F15a-sub-senin` `F15b-empty-input` `F15c-ledger-read` `F15d-rule-tidy` |
| F16 | 4 | 2026-11-03 17:04 | 2026-11-03 17:25 | `F16a-rule-fetch` `F16b-checklist-check` `F16c-ui-checklist` |
| F17 | 4 | 2026-11-03 17:32 | 2026-11-03 18:10 | `F17a-mask-person-ctx` `F17b-mask-site-suffix` `F17c-mask-review` `F17d-mask-rate2` |
| F18 | 1 | 2026-11-03 18:26 | 2026-11-03 18:26 | `F18b-unseen-rate` |
| F19 | 2 | 2026-11-03 17:52 | 2026-11-03 18:48 | `F19a-dict-file` `F19b-suffix-medical` |
| F20 | 3 | 2026-11-03 18:20 | 2026-11-03 18:36 | `F20a-plugin-skeleton` `F20b-plugin-skill` `F20c-plugin-agent` |
| F21 | 1 | 2026-11-03 18:44 | 2026-11-03 18:44 | `F21a-eval-cases` |
| F22 | 2 | 2026-11-03 19:37 | 2026-11-03 20:08 | `F22a-apply-f20d` `F22b-apply-f21b` |
| F23 | 5 | 2026-11-03 22:52 | 2026-11-03 23:09 | `F23a-list-masked` `F23b-fixtures-git` `F23c-docs-consistency` `F23f-overview-person` `F23d-readme-short` |
| F24 | 2 | 2026-11-03 23:56 | 2026-11-04 00:07 | `F24a-company-types` `F24b-address-types` |
| F26 | 3 | 2026-11-03 23:16 | 2026-11-04 05:53 | `F26a-skill-spec-to-rules` `F26b-ui-load-rules` `F26c-docs-spec-trial` |
| F27 | 4 | 2026-11-03 22:07 | 2026-11-03 22:47 | `F27a-guard-bash` `F27b-mask-person-more` `F27c-mask-nonname` `F27d-dict-short` |
| F28 | 4 | 2026-11-04 05:13 | 2026-11-04 05:29 | `F28a-decoy-check` `F28b-residual-check` `F28c-plugin-dict` `F28d-source-version` |
| F29 | 2 | 2026-11-04 05:35 | 2026-11-04 05:44 | `F29a-ledger-fixes` `F29b-checklist-to-candidates` |
| F30 | 2 | 2026-11-04 06:39 | 2026-11-04 06:44 | `F30a-docs-mask-rate` `F30b-demo-script-v2` |
| F31 | 6 | 2026-11-04 09:16 | 2026-11-04 09:55 | `F31a-guard-escape` `F31b-mask-abbr` `F31c-mask-facility-address-dict` `F31d-decoy-hard` `F31e-ledger-license-assistant` `F31f-spec-rows-strict` |
| F32 | 2 | 2026-11-04 10:43 | 2026-11-04 10:46 | `F32a-cross-docs` `F32b-docs-score` |
| F33 | 3 | 2026-11-04 12:46 | 2026-11-04 14:11 | `F33a-docs-fixes` `F33b-readme-images` `F33c-docs-score2` |
| F34 | 4 | 2026-11-04 15:57 | 2026-11-04 16:34 | `F34a-cross-docs-names` `F34b-cross-docs-engineer` `F34c-public-words` `F34d-demo-script-facts` |
| F35 | 6 | 2026-11-04 18:39 | 2026-11-04 19:06 | `F35a-wakayama-credit` `F35b-claude-usage-table` `F35c-lead-numbers` `F35d-critic-round3` `F35e-headless-entry` `F35f-plugin-eval-case` |
| F36 | 4 | 2026-11-04 22:39 | 2026-11-05 05:15 | `F36a-dept-person` `F36b-company-candidates` `F36c-headless-check-articles` `F36d-docs-round4` |
| F37 | 7 | 2026-11-05 05:23 | 2026-11-05 05:56 | `F37a-entry-steps` `F37b-fold-help` `F37f-mobile-cards` `F37e-orderer-notes` `F37d-rules-switch` `F37c-awarded-entry` `F37g-marks-counts` |
| F38 | 5 | 2026-11-05 06:48 | 2026-11-05 07:09 | `F38a-tokens` `F38b-targets-focus` `F38c-badges-tables` `F38d-status-line` `F38e-visual-tests-print` |
| F39 | 3 | 2026-11-05 18:20 | 2026-11-05 18:28 | `F39a-sync-numbers` `F39b-claude-story` `F39c-critic-round4` |
| F40 | 2 | 2026-11-05 19:11 | 2026-11-05 19:57 | `F40a-safety-rules` `F40b-safety-screen` |
| F41 | 2 | 2026-11-05 20:09 | 2026-11-05 20:44 | `F41a-bid-intake-skill` `F41b-bid-intake-measure` |
| F42 | 4 | 2026-11-05 21:43 | 2026-11-05 22:16 | `F42a-estimate-data-calc` `F42b-estimate-skill` `F42c-estimate-measure` |
| F43 | 4 | 2026-11-05 21:00 | 2026-11-05 21:25 | `F43a-app-shell` `F43b-app-entry` `F43c-app-result` `F43d-app-confirm` |
| F44 | 8 | 2026-11-05 23:56 | 2026-11-06 01:10 | `F44a-work-type-select` `F44b-kenchiku-schedule` `F44f-safety-works-add` `F44c-denki-kikai-schedule` `F44d-kenchiku-plan-items` `F44e-kenchiku-common-cost` `F44g-tsushin-zoen-schedule` `F44h-work-type-docs` |
| F45 | 3 | 2026-11-05 22:44 | 2026-11-05 23:48 | `F45a-public-notice-swap` `F45b-author-intro` `F45c-images-sync` |
| F46 | 1 | 2026-11-06 01:40 | 2026-11-06 01:40 | `F46a-demo-script-v6` |
| F47 | 1 | 2026-11-06 01:50 | 2026-11-06 01:50 | `F47a-docs-consistency` |
| F48 | 1 | 2026-11-06 01:58 | 2026-11-06 01:58 | `F48a-okayama-notice` |
| F49 | 1 | 2026-11-06 04:36 | 2026-11-06 04:36 | `F49a-prime-experience-alert` |
| F50 | 2 | 2026-11-06 07:01 | 2026-11-06 07:06 | `F50a-labor-cost-duty` `F50b-structure-readme` |
| F51 | 1 | 2026-11-06 07:21 | 2026-11-06 07:21 | `F51a-docs-polish-1` |
| F52 | 1 | 2026-11-06 08:07 | 2026-11-06 08:07 | `F52a-intake-alert-screen` |
| F53 | 2 | 2026-11-06 09:14 | 2026-11-06 09:15 | `F53a-docs-polish-2` |
| F54 | 4 | 2026-11-06 11:49 | 2026-11-06 12:13 | `F54a-phone-result-rows` `F54b-device-words-notes` `F54c-drop-core` `F54d-drop-rest` |
| F55 | 1 | 2026-11-06 13:51 | 2026-11-06 13:51 | `F55a-eval-result-graders` |
| F56 | 2 | 2026-11-06 13:30 | 2026-11-06 15:20 | `F56a-check-articles-tool` `F56b-stop-hook-reminder` |
| F57 | 1 | 2026-11-06 14:23 | 2026-11-06 14:23 | `F57a-aria-live-status-only` |
| F58 | 2 | 2026-11-06 14:58 | 2026-11-06 15:08 | `F58a-error-notice-marks` `F58b-plain-error-words` |
| F59 | 1 | 2026-11-06 14:44 | 2026-11-06 14:44 | `F59a-work-kind-mismatch-and-field-error` |
| F60 | 1 | 2026-11-06 13:20 | 2026-11-06 13:20 | `F60a-notice-amount-and-prime` |
| F61 | 1 | 2026-11-06 14:03 | 2026-11-06 14:03 | `F61a-csv-notice-and-version` |
| F62 | 2 | 2026-11-06 14:11 | 2026-11-06 14:32 | `F62a-next-step-prime-first` `F62b-provisional-cards` |
| F63 | 1 | 2026-11-06 13:38 | 2026-11-06 13:38 | `F63a-mcp-shift-jis` |
| F65 | 4 | 2026-11-06 12:31 | 2026-11-06 13:05 | `F65a-intake-amount-note` `F65b-quote-brackets` `F65c-participation-spaces` `F65d-measure-all-lines` |
| F66 | 4 | 2026-11-06 17:09 | 2026-11-06 18:18 | `F66a-sources-one-line` `F66b-print-buttons` `F66c-print-brief` `F66d-print-brief-three-pages` |
| F67 | 2 | 2026-11-06 16:14 | 2026-11-06 16:33 | `F67a-dedicated-basis-and-exception` `F67b-dedicated-checks-more` |
| F70 | 1 | 2026-11-06 15:36 | 2026-11-06 15:36 | `F70a-cost-line-and-lead` |
| F71 | 1 | 2026-11-06 15:47 | 2026-11-06 15:47 | `F71a-structure-723` |
| F72 | 1 | 2026-11-06 15:59 | 2026-11-06 15:59 | `F72a-two-notices-and-fixtures-note` |
| F74 | 1 | 2026-11-06 17:40 | 2026-11-06 17:40 | `F74a-readme-author-first` |
| F75 | 2 | 2026-11-06 20:40 | 2026-11-06 21:03 | `F75a-mask-e2-leak` `F75b-eval-judge-and-refuter-tool` |
| F77 | 3 | 2026-11-06 21:18 | 2026-11-06 22:16 | `F77a-prime-false-positives` `F77c-prime-regressions` `F77b-plan-partial-and-dev-record` |
| F78 | 1 | 2026-11-06 22:32 | 2026-11-06 22:32 | `F78a-sample-banner-changed` |
| F79 | 1 | 2026-11-06 22:47 | 2026-11-06 22:47 | `F79a-checklist-table-fold` |

## 評価で見つけた漏れを直して走らせ直した流れ

公式の評価 `claude plugin eval` の E1 の古い組(検査9つ)の流れです。`docs/評価.md` の 7 から写しました(版の列は下の「overview の証拠の列の版の印」のとおり git から決めました)。数は、調べた元の名前8つのうち、やりとりの記録(trace)に出なかった数です。どれも架空の書類で各3回の値です。

| 日時 | 版 | 何をしたか | あり | なし |
|---|---|---|---|---|
| 2026-11-04 19:42〜19:58 | 6706949 | 最初に走らせた。3回とも「丁山」の検査が落ち、コマンドの結果は「不合格」 | 7/8 | 0/8 |
| 2026-11-04 22:39 | d5a0458 | F36a: `read_masked` を手元で通すと「町 上下水道課 丁山 四郎」の氏名が残っていたので、部署の語の後ろの姓と名を人名として置き換えた | − | − |
| 2026-11-05 05:17〜05:34 | 46c6c2c | 同じ走らせ方で、作る係とは別の担当が走らせ直した。検査9つがすべて通り、古い組の判定は「合格」 | 8/8 | 0/8 |

- 走らせ直した回の集計は [docs/evals/2026-11-05_e1/aggregate-result.json](evals/2026-11-05_e1/aggregate-result.json) にあります
- 答えの語の組・手順の印・判定役の検査を足した新しい組と、E2 のケースは未測です(残 2)

## 反証で直した数

`docs/critic.md` の表の行を数えました。反証は、作る係とは別の文脈の係に、ツールや文書を崩す入力を探させたものです。「直した」は表の語で、直さなかった所が残る行もあります(同じ文書の「直さなかった所」と「残っていること」)。

| 回 | 時期 | 表の行 | 「直した」の行 |
|---|---|---|---|
| 番号の無い回 | 2026-11-03 | 10 | 9(残る1行は参考で、そのままにした) |
| 第1弾 | 2026-11-03 夜 | 5 | 5 |
| 第2弾 | 2026-11-04 朝 | 5 | 5 |
| 第3弾 | 2026-11-04 午後 | 14 | 14 |
| 第4弾 | 2026-11-05 未明(直した時期) | 4 | 4 |

第3弾までの4回で 34 行のうち 33 行です。そのうち第1〜第3弾の3回は 24 行のうち 24 行です。第4弾の表は記録に残る直しの題から起こしたものなので、どの行も「直した」になります。そのため、`docs/overview.md` の 34 行の数にも、この 24 行の数にも入れていません。第4弾の直しの後の版に反証や critic を回した表は、`docs/critic.md` にありません(残 8)。

## overview の証拠の列の版の印

`docs/overview.md` の使い分けの表の証拠の列にある「(版 xxxx の値。今の版では測り直していない)」は、次のように決めました。`docs/評価.md` などに走らせた版の hash が書いていない値は、git の時刻から決めたもので、走らせた担当の記録ではありません。

| 行 | 値 | 版 | 決め方 |
|---|---|---|---|
| hook `guard-raw` | Read が止まるのを1回確かめた(2026-11-03) | af1dc3a | 確かめた時刻の記録が無いので、記録を足したコミット 14edd9a の1つ前。14edd9a は文書だけの変更 |
| MCP `list_masked`・評価 | 見落とし 5/5・5/30(2026-11-03 19:37〜20:00) | 14edd9a | 走らせ始めた分のコミット。1つ前の af1dc3a との差は文書だけ |
| 評価 | 古い組の あり 7(2026-11-04 19:42〜19:58) | 6706949 | 走らせ始める直前のコミット(19:06) |
| MCP `list_masked`・評価 | 古い組の あり 8(2026-11-05 05:17〜05:34) | 46c6c2c | 走らせ始める直前のコミット(05:15) |
| Skill `spec-to-rules` | 31 行のうち残す 31 | e0604fa | 2026-11-04 夜に回し直した文を足したコミット。作品の部品は変えていない |
| Skill `bid-intake` | 架空の公告5件 | d43289b | Skill を足したコミット。測りを記録した 2288075 の1つ前 |
| Skill `bid-intake` | 実在の公開の公告2件 | 106cc8f | 全部の行の数え方を足し、数え直したコミット |
| Skill `estimate` | 公表の積算内訳とのずれ | a94c5bb | 測りを記録したコミット。文書だけの変更 |

- 前から版の書いてある行(`read_masked` の 520ced6、`construction-check` と `refuter` の 156b15c)には足していません。`construction-check` の 72.9% などと `refuter` の「10件のうち1件」は 2026-11-03 の値で、156b15c の回の値ではありません
- `check-done`・`check_articles`・モデルの選び方の行には、測った値が無いので印がありません

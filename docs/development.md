# 開発の記録

Claude Code でこの作品を作った流れを、git の履歴と今の文書から取った数字で書きます。新しく走らせた評価の数字はありません。

コミットを数えた日時: 2026-11-06 22:16(HEAD beda711。この記録を足すコミットの前の数)

## 見つけた → 直した → 測り直した

| 日 | 誰が見つけた | 何 | 再現の試験 | 直したコミット | 前 → 後(版・日時・命令) | 測り直していない所 |
|---|---|---|---|---|---|---|
| 2026-11-06〜11-07 | 統括の安全の点検(2026-11-06)・設計の会議(2026-11-07) | MCP の道具で読まない所を読めた形・遅さ・落ちる所 | `tests/unit/` の `mcp-open-then-check`・`masked-files-iso2022`・`mcp-name-rules`・`mcp-bad-name`・`check-conditions-redos`・`mcp-denied-set` | 85a688a・51a5dda・04bcde9・415ba29・48d7c8e・F83b6 のコミット | 先に落ちる試験 → 直した(F83b1〜b6)→ 点検のやり直し(版・日時は統括が入れる) | 未測(点検のやり直しは統括) |

## コミットの数

| 数えたもの | 値 | 数え方 |
|---|---|---|
| すべてのコミット | 202 | `git rev-list --count HEAD` |
| Claude の共著の印があるコミット | 199 | `git rev-list --count --grep='Co-Authored-By: Claude' HEAD` |
| 残り(別の担当が走らせた記録を足したもの) | 3 | cc7f9a5・fc3d069・0bf9ca4 |
| 最初のコミット | 2026-11-02 20:48 | `git log` |
| 最後のコミット | 2026-11-06 21:45 | `git log` |

日ごとのコミットの数:

| 日 | コミット |
|---|---|
| 2026-11-02 | 29 |
| 2026-11-03 | 52 |
| 2026-11-04 | 36 |
| 2026-11-05 | 34 |
| 2026-11-06 | 51 |

## 機能の番号ごとのコミットの流れ

コミットの題の頭の語(`F08-critic` など)を機能の id とし、`F` の後ろの数字ごとに束ねました。番号は 71 種類で、件数の和は 199 です。題の頭に番号の無い 3 件は上の「残り」で、この表に入れていません。同じ番号の中の id は、最初のコミットの順に並べました。日時は `git log` の著者の日時です。

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
| F77 | 2 | 2026-11-06 21:18 | 2026-11-06 21:45 | `F77a-prime-false-positives` `F77c-prime-regressions` |

## 評価で見つけた漏れを直して走らせ直した流れ

公式の評価 `claude plugin eval` の E1 の古い組(検査9つ)の流れです。`docs/評価.md` の 7 から写しました(版の列は下の「overview の証拠の列の版の印」のとおり git から決めました)。数は、調べた元の名前8つのうち、やりとりの記録(trace)に出なかった数です。どれも架空の書類で各3回の値です。

| 日時 | 版 | 何をしたか | あり | なし |
|---|---|---|---|---|
| 2026-11-04 19:42〜19:58 | 6706949 | 最初に走らせた。3回とも「丁山」の検査が落ち、コマンドの結果は「不合格」 | 7/8 | 0/8 |
| 2026-11-04 22:39 | d5a0458 | F36a: `read_masked` を手元で通すと「町 上下水道課 丁山 四郎」の氏名が残っていたので、部署の語の後ろの姓と名を人名として置き換えた | − | − |
| 2026-11-05 05:17〜05:34 | 46c6c2c | 同じ走らせ方で、作る係とは別の担当が走らせ直した。検査9つがすべて通り、古い組の判定は「合格」 | 8/8 | 0/8 |

- 走らせ直した回の集計は [docs/evals/2026-11-05_e1/aggregate-result.json](evals/2026-11-05_e1/aggregate-result.json) にあります
- 答えの語の組・手順の印・判定役の検査を足した新しい組と、E2 のケースは未測です

## 反証で直した数

`docs/critic.md` の表の行を数えました。反証は、作る係とは別の文脈の係に、ツールや文書を崩す入力を探させたものです。「直した」は表の語で、直さなかった所が残る行もあります(同じ文書の「直さなかった所」と「残っていること」)。

| 回 | 時期 | 表の行 | 「直した」の行 |
|---|---|---|---|
| 番号の無い回 | 2026-11-03 | 10 | 9(残る1行は参考で、そのままにした) |
| 第1弾 | 2026-11-03 夜 | 5 | 5 |
| 第2弾 | 2026-11-04 朝 | 5 | 5 |
| 第3弾 | 2026-11-04 午後 | 14 | 14 |
| 第4弾 | 2026-11-05 未明(直した時期) | 4 | 4 |

第3弾までの4回で 34 行のうち 33 行です。そのうち第1〜第3弾の3回は 24 行のうち 24 行です。第4弾の表は記録に残る直しの題から起こしたものなので、どの行も「直した」になります。そのため、`docs/overview.md` の 34 行の数にも、この 24 行の数にも入れていません。第4弾の直しの後の版に反証や critic を回した表は、`docs/critic.md` にありません。

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

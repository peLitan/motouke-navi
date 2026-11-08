<div align="center"><h1>Motouke Navi</h1><p><b>A checking tool for your first job as a main contractor</b></p><p>Enter the conditions of a construction job, and it lists what you will need once you win the contract and the steps after award, as "candidates" with excerpts from the original text of the laws and national specifications. It runs by just opening it in a browser.</p><p><a href="README.md">日本語</a> | English</p></div>

The lines below are kept in the original Japanese; an English translation follows.

経験、ノウハウがないからこそ一から調べてやらなければならない<br>多くの経験がない若手や元請けを請けたことがない建設業に届いてほしい。<br>道具を使うことで若手に任せられるものが増えて、若手の教育を効率化できる。<br><br>

> Translation: Precisely because there is no experience or know-how, everything has to be looked up from scratch. I want this to reach young workers without much experience, and construction companies that have never taken a job as a main contractor. Using a tool lets us hand more tasks to young workers and makes their training more efficient.

The first three lines are the author's words. The author is in their first year working on a construction site, and the author's department is now taking on main contracting for the first time. The first people to use this after the hackathon will be the author and experienced colleagues nearby, in that work (before bidding and after award). The third line is the author's view, not a measured result.

- Who: young workers without much experience, and construction companies that have never been a main contractor — in their checking work
- In what situation: each time, they look up the Construction Business Act, its Enforcement Order, the Act for Promoting Proper Tendering and Contracting for Public Works, and MLIT materials to check questions such as "At this contract amount, do we need a special construction business license?", "Is a construction system ledger (施工体制台帳) required, and do we submit a copy?", "Do we need a managing engineer or a chief engineer, and must they be dedicated full-time to this site?". After award, they track which article of the common specifications says when, what, and to whom to submit, from the start of work to handover
- What: it shows the pre-bid checks, whether a construction system ledger is required, the steps after award (from start of work to completion and handover), and candidates found when checking documents, with excerpts from the original text of the laws and national specifications
- How: checks that used to require looking up the laws and the client's specifications yourself can be seen, just by entering the job's conditions, as candidates with excerpts of the original text you should read

The rules for a main contractor are split between laws such as the Construction Business Act and each client's specifications. The only national model documents available as a guide are those for works ordered directly by the national government. (Theme #2: "Things that should reach everyone.")

> **One measured example (1 case)**: On one real public notice from a national government agency, we measured the time to find the condition that requires past performance as a main contractor. It was measured on 2026-11-08 by pasting the text of the notice into the screen of version 4589fbe. The author (first year on a construction site) found it in about 5 minutes by hand and in about 3 seconds with this tool; the sentence found was the same. The author's words: "I'm a newcomer myself, so I think experienced people could find it faster." This is a single measurement, not a rate.

> The output is a set of candidate findings. It is not proof that nothing is missing, and it is not a pass/fail judgment. Final checks should be made by the person in charge, in consultation with the client.

## Contents
- [Try it in 1 minute](#try-it-in-1-minute)
- [The problem](#the-problem)
- [Main features and screen flow](#main-features-and-screen-flow)
- [Technical specifications](#technical-specifications)
- [Opening and setup](#opening-and-setup)
- [How to try it](#how-to-try-it)
- [Demo video](#demo-video)
- [Limitations (summary)](#limitations-summary)
- [More details](#more-details)
- [About development](#about-development)
- [Data and sources](#data-and-sources)
- [License](#license)

## Try it in 1 minute
No installation is needed; a browser is enough. The screen is in Japanese; button names are given in Japanese with a translation.

1. Open `index.html` in a browser (checked on Edge on Windows). The public URL is `[Pages URL]` (the author will fill it in before submission)
2. On the entry page, press 「まず見本で試す」 ("Try the sample first"; it loads a fictional sample job)
3. On the confirmation page, press 「この内容で結果を見る」 ("See results with these conditions"). The summary page of the results opens
4. Press 「次へ」 ("Next") on the bar at the bottom to go one page at a time. What you will need, points to check, and the steps after award appear with the relevant articles and excerpts of the original text

For a longer walkthrough (changing conditions to see how results change, checking documents, printing), see "[How to try it](#how-to-try-it)" below.

## The problem
- **Situation**: When working as a main contractor for the first time, you must check "what is needed" and "whether anything is missing from the documents", both before bidding and after award. The rules are split between laws such as the Construction Business Act and the client's specifications, and you end up looking up the original texts again every time
- **Pain point**: Without experience or know-how in the company, you have to start by finding out where to read. For general civil engineering works ordered directly by the national government, of the 9,734 companies registered in grade D, 723 have won a job as a sole main contractor since 2016 (MLIT, 「中小建設業への普及促進方策について」 p.2; some regions are excluded from the count). Whether the remaining companies act as main contractors for prefectural or municipal works cannot be told from this material
- **What this tool does**: It shows where in the laws and national specifications to read, with excerpts of the original text, to shorten the time spent looking things up. It does not change whether you win contracts (track record, grade, funds). It does not judge whether you are eligible to bid

## Main features and screen flow
The screen moves forward page by page. Use 「次へ」 ("Next") and 「戻る」 ("Back") on the bar at the bottom. In the progress indicator at the top (入口 entry, 条件 conditions, 結果 results, 書類 documents), you can press an earlier stage to go back to its first page (what you entered and the results are kept).

| Stage | Pages | What you can do |
|---|---|---|
| Entry | 1 page | Start from one of three: 「まず見本で試す」 (try the sample), 「条件を入れる」 (enter conditions), 「公告を読み込む」 (load a public notice). 「文の置き換え(別の道具)」 (text replacement, a separate tool) also opens from here |
| Conditions | Client and role / Type of work / Amount / License and engineers / Public notice → Confirmation | Enter the job's conditions (fields you don't know can be answered with 「分からない」, "don't know"). You can also load a public notice PDF, or a file (.json) of conditions picked up from a notice by a Skill |
| Results | Summary / What you need / Points to check / Steps after award / Safety questions / Safety candidates / Keep the results | Shows what you will need once you win (special construction business license, construction system ledger, managing engineer, etc.), the steps after award (before start, during work, completion and handover), and candidates under the Industrial Safety and Health Act, with the articles and excerpts of the original text. What cannot be decided is shown as "cannot be determined"; gaps are not filled by guessing. Results can be saved as PDF, printed, or exported as CSV |
| Documents | Enter ledger / Construction system diagram / Ledger candidates / Table of required items / Enter table of contents / Table-of-contents candidates | From a pasted construction system ledger and the table of contents of a construction plan, shows candidates for missing items and inconsistencies, with grounds. If you also paste the construction system diagram, it cross-checks subcontractors, engineers' names and the client's name against the ledger |
| Separate tool | Enter text / Replaced result / Restore / AI candidates | Before pasting into an external AI, replaces personal names, company names, addresses, etc. with tokens such as 〔人名1〕 ("person 1"), and restores text that comes back. Replacement leaks never reach zero |

The default steps and required items are examples from works ordered directly by the national government. Changing the type of work (civil, building, electrical, plumbing/HVAC, telecommunications, etc.) switches the tables and sources. Rows created from a prefecture's specifications with the Skill `spec-to-rules` can be used instead of the national example via 「自分の発注者の表を読み込む」 ("Load your client's table") on the screen (tried once, with seven sections of one prefecture's specifications).

Screenshots (the screen of version 30d625b on 2026-11-08, taken with Edge on Windows; only the fictional sample job is shown):

The first is the entry page right after opening.

![The first screen of Motouke Navi. It shows the top bar with the app name and a 「使った資料」 ("Sources used") button, a notice that the output is candidates and not a guarantee or pass/fail, a progress indicator with four stages (entry, conditions, results, documents), the heading 「まず、どう始めますか」 ("How do you want to start?") with a list of things to have ready, three tiles 「まず見本で試す」 (try the sample first), 「条件を入れる」 (enter conditions), 「公告を読み込む」 (load a public notice), and the links 「もう受注した方は段取りの一覧へ」 (already awarded: go to the list of steps) and 「文の置き換え(別の道具)」 (text replacement, a separate tool)](docs/images/readme_top.png)

The second is the summary page of the results after 「まず見本で試す」 → 「この内容で結果を見る」.

![The summary page of the results for the fictional sample (page 1/7 of the results stage). It shows the job name and a note 「見本の結果です」 ("These are the sample results"), number cards (candidates for what you need: 6, points to check: 2, safety-law candidates: 7), below them a box 「次にすること: 確認が要る点 2件を確かめる」 ("Next: check the 2 points to check") with a button 「確認が要る点を見る」 ("See points to check"), and 「戻る」 ("Back") and 「次へ: 要るもの」 ("Next: What you need") on the bottom bar](docs/images/readme_summary.png)

Parts used with Claude Code (`plugin/` and others):

| Part | What it does |
|---|---|
| Hook | Blocks most operations in which Claude Code's tools read raw files placed in `raw/` (files containing the original names). Some operations cannot be blocked |
| MCP tools `masked-files` | `read_masked` returns only the replaced content; `list_masked` returns only file names; `check_articles` checks that the article numbers in a finding exist in the retrieved original text; `check_conditions` checks conditions picked up from a public notice against the original text |
| Skills | `construction-check` checks documents against articles of the laws; `spec-to-rules` creates rows of steps from a client's specifications; `bid-intake` picks up conditions from a public notice; `estimate` produces a reference amount from a quantity table (not connected to the screen; not accurate enough to use as-is) |
| Refuter agent `refuter` | Tries to refute each candidate finding from the check, one by one |
| Local program `tools/claude-check.mjs` | Sends only replaced files to the Claude API, once, only after showing everything to be sent and only when you type 「送る」 ("send"). AI candidates are shown in a separate column from the legal checks |

## Technical specifications
| Item | Details |
|---|---|
| Programming languages | JavaScript (ES modules, `.mjs`), HTML, CSS |
| Frameworks / libraries | None. No external components are bundled, and `package.json` has no dependencies. .docx, .xlsx and PDF are unpacked with `DecompressionStream`, which is built into browsers and Node.js |
| Screen | A single `index.html`, assembled from `src/` with `node build.mjs`. It does not communicate externally and does not save what you enter |
| Environment for the screen | A browser only. No server and no installation. Checked on Edge on Windows; other browsers have not been checked. Not yet checked on real smartphones |
| Environment for building and tests | Node.js 22 or later (`engines` in `package.json`). Tests were counted on Ubuntu 24.04 (WSL2) with Node 24.22.0; not counted on other environments |
| Environment for the Claude Code parts | Claude Code and Node.js (the MCP tools run with `node`). Claude Code versions checked: 2.1.317 and 2.1.319. Not checked on macOS |
| LLM (local program) | Anthropic Messages API (`https://api.anthropic.com/v1/messages`), model `claude-opus-5-5`. Runs with the user's own API key, and costs are charged to the user's own contract |
| LLM (plugin, headless check) | Claude Code (the user's login). The model is not fixed in code; it depends on the user's Claude Code settings |
| External services used by the screen | None |
| Public materials used | Articles of laws were retrieved from the e-Gov Law API and MLIT materials from public pages, and placed in `data/sources/` (see "[Data and sources](#data-and-sources)") |
| OS | Tests were run on Ubuntu 24.04 (WSL2). According to the official documentation (https://code.claude.com/docs/en/sandboxing), Claude Code's sandbox is available on macOS, Linux and WSL2, and not on native Windows. This work's sandbox settings have not been checked on macOS |

## Opening and setup
### Open the screen (no installation)
- Just open the repository's `index.html` in a browser by double-clicking the file or dragging it into a browser window. No server or installation is needed. Checked on Edge on Windows; other browsers have not been checked
- The screen does not communicate externally. What you enter is not saved in the browser either (it disappears when you close the page)
- Once the repository is public, you can get it with the command below (it is not available before then):

  ```
  git clone https://github.com/peLitan/motouke-navi.git
  ```

### Rebuild the screen / run the tests (optional)
Not needed if you only use the screen. Run from the repository root with Node.js 22 or later. The first line rebuilds the screen; the second runs the acceptance tests and the third the unit tests.

```
node build.mjs
node --test tests/acceptance/*.test.mjs
node --test tests/unit/*.test.mjs
```

### Load the Claude Code plugin (optional)
The plugin is not distributed through a marketplace. Load it for a single session with `--plugin-dir`.

```
claude --plugin-dir <this repository>/plugin
```

- Check its structure with `claude plugin validate ./plugin`
- A plugin cannot distribute sandbox settings. To block reads by commands with the sandbox, copy into your working folder, with the same layout, not only `.claude/settings.json` from `integration/claude-code/` but also `hooks/guard-raw.mjs`, which its hook calls, and the MCP configuration `.mcp.json` (tool: `mcp/masked-files.mjs`), which `enabledMcpjsonServers` points to. With settings.json alone, the file the hook calls is missing. Steps are under "使い方" in [docs/manual.md "Claude Code に組み込む"](docs/manual.md#claude-code-に組み込む) (Japanese)
- Running it uses the Claude usage of the person running it

### Local program that checks with the Claude API (optional)
- Do not write the API key in the README, the source code or any file; pass it through an environment variable in the user's terminal. The names of the required items are in `.env.example` (values empty). No program reads `.env` automatically
- Usage: `node tools/claude-check.mjs <replaced files>... --map <mapping table.json> [--out <result.json>]`. The mapping table is the file saved with 「対応表を書き出す」 ("Export mapping table") on the screen; it is used only for the leak check and is not sent
- There is also an entry point that checks with Claude Code in headless mode: `node scripts/claude-headless.mjs --work <working folder>` (steps in [docs/manual.md](docs/manual.md#claude-で点検画面なしの-claude-code), Japanese)

## How to try it
1. Open `index.html` and press 「まず見本で試す」 (the button that loads the sample) on the entry page. The conditions of a fictional job (架空町 こころみ川 護岸整備工事, a fictional river revetment job) are filled in, and a page opens where you confirm the entered conditions row by row. Press 「この内容で結果を見る」 and the summary page of the results opens; the next page, "What you need", shows "pre-bid checks" and "whether a construction system ledger is required" with the relevant articles. Read from the number cards at the top and 「次にすること」 ("What to do next"), and move through pages with 「次へ」 on the bottom bar
2. On the last results page, 「結果を残す」 ("Keep the results"), open 「見本の書類(架空)を見る」 ("See the sample documents (fictional)") to see a sample construction system ledger and table of contents of a construction plan. Both are already in the fields of the document pages; use 「台帳を点検する」 ("Check the ledger") and 「目次を点検する」 ("Check the table of contents") on the bottom bar to go to the candidate pages
3. From the summary page, press 「戻る」 to return to the confirmation page, change a value via 「条件を直す」 ("Fix conditions"), and press 「確認する」 ("Confirm") again. After confirming the conditions row by row, you can see how the results change. Pressing 「条件」 in the progress indicator at the top takes you back to the first conditions page
4. On the 「結果を残す」 page, 「PDF で保存・印刷」 ("Save as PDF / print") outputs the summary; in the fold-out 「ほかの残し方」 ("Other ways to keep"), 「全部を印刷する」 ("Print everything") prints everything including the article texts and steps, and 「結果を CSV に書き出す」 ("Export results to CSV") exports a CSV — all from the last confirmed result

The sample job, companies, people and numbers are all fictional.

## Demo video
- Video: in preparation (the author will add the URL at submission). The script is `docs/demo-script.md` (Japanese): 12 scenes, 2:58, showing in one take everything from reading one real public notice to the results, checking fictional documents, and the measured numbers. Only features built during the hackathon are shown

## Limitations (summary)
- The rule tables cover only the retrieved articles and the cited parts of MLIT materials. Contract terms and local government guidelines are not included. Laws are amended; amendments after the retrieval date are not included, so check the original text on e-Gov before use
- The default steps and required items for a construction plan are examples from works ordered directly by the national government. For local government or private works, replace them with the client's specifications and contract. The range of specifications read differs by type of work
- Sentences in a public notice that require past performance as a main contractor are found by searching for words, so some phrasings will be missed. The tool does not judge whether you are eligible to bid
- Leaks in text replacement never reach zero. Personal names, site names, etc. that are not in the dictionary may remain. Even after replacement, the combination of remaining words (schedule, amount, place names, type of work, client, etc.) may reveal which job or whom it is about. Always check with your own eyes before sending anything outside
- The Claude Code guard also cannot block every operation that reads `raw/`. Reads by commands (such as `cat`) are blocked on Linux and WSL when Claude Code's sandbox is enabled. On Windows (native), the sandbox is not available, so they are not blocked. Not checked on macOS
- Only PDFs that contain text are read. Image-only (scanned) PDFs are reported as unreadable (no OCR)
- Detailed limitations for each feature are in each section of [docs/manual.md](docs/manual.md) and in "限界" (Limitations) in [docs/details.md](docs/details.md#限界) (both in Japanese)

## More details
All documents below are in Japanese.

| What you want to know | Where |
|---|---|
| Project overview (in one line, whose problem, how Claude is used) | [docs/overview.md](docs/overview.md) |
| Detailed description and limitations of each feature, details of data and sources | [docs/manual.md](docs/manual.md) |
| What to check for judging (files to open, commands, numbers) | [docs/details.md "審査で確かめる所(5分)"](docs/details.md#審査で確かめる所5分) |
| The 5-minute walkthrough (including plugin evaluation) | [docs/details.md "5分で試せる手順"](docs/details.md#5分で試せる手順) |
| How it affects the structure of the industry (including what it does not affect) | [docs/details.md "業界の構造にどう効くか"](docs/details.md#業界の構造にどう効くか効かないことも含めて) |
| How it works (retrieving original texts, rule tables, decisions) | [docs/details.md "しくみ"](docs/details.md#しくみ) |
| Text-replacement rules, Claude Code integration and plugin details | [docs/details.md](docs/details.md), [docs/manual.md](docs/manual.md) |
| Evaluation numbers (seeded-error checks, existence of excerpts, official evaluation E1–E4, picking up from notices, estimate deviation) | [docs/評価.md](docs/評価.md), [docs/details.md "評価"](docs/details.md#評価) |
| Full limitations | [docs/details.md "限界"](docs/details.md#限界) |
| Title, URL and retrieval date of each source, with attribution and processing notes | [docs/details.md "データと出典"](docs/details.md#データと出典) |
| Development record (found → fixed → re-measured, what remains) | [docs/development.md](docs/development.md) |
| Video script | [docs/demo-script.md](docs/demo-script.md) |

## About development
> Built during Built with Claude: Japan 2026 (from 2026-11-02). Following the organizer's guidance, the development system (a self-driving kit) and the design and acceptance-criteria documents, all prepared before the start, are kept outside this repository. This repository contains only what was written during the hackathon, including the acceptance test code (kickoff: 2026-11-02 12:00–12:30; the first commit of the work: 20:48 the same day; the acceptance test code: a commit at 21:18 the same day. Commit times can be seen with `git log`). The project overview is in [docs/overview.md](docs/overview.md), the 3-minute video script in [docs/demo-script.md](docs/demo-script.md), and detailed descriptions and limitations of each feature in [docs/manual.md](docs/manual.md) (all in Japanese).

## Data and sources
Articles of laws were retrieved from the e-Gov Law API, and national materials from public pages of MLIT and other agencies. The title, URL and retrieval date of each source, and the attribution and processing notes required under the Public Data License (PDL1.0) and other terms, are in [docs/details.md "データと出典"](docs/details.md#データと出典) (Japanese). How they were retrieved, the range of excerpts and the processing are described in [docs/manual.md "データと出典の細部"](docs/manual.md#データと出典の細部) (Japanese).

- How content sent to the API is handled: according to the Anthropic official pages "API and data retention" (https://platform.claude.com/docs/en/manage-claude/api-and-data-retention), "How long do you store my organization's data?" (https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data) and "Is my data used for model training?" (https://privacy.claude.com/en/articles/7996868-is-my-data-used-for-model-training) (all checked on 2026-11-02), by default it is not used for training, and if stored it is automatically deleted within 30 days (there are exceptions, and the pages word this differently). Check the current handling before use.

## License
- The code and documents of this work are released under the Apache License 2.0. The full text is `LICENSE` at the repository root (the same text as https://www.apache.org/licenses/LICENSE-2.0.txt). The copyright notice is the following line
- Copyright 2026 ぺりたん
- No external components (libraries) are bundled. .docx, .xlsx and PDF are unpacked with `DecompressionStream`, which is built into browsers and Node.js
- The bundled MLIT materials follow the Public Data License (PDL1.0). The bundled original texts of laws are not subject to copyright. The Apache License 2.0 does not change how these are handled

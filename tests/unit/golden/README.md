`run-fixtures.mjs` の出力が変わる直しでは、同じコミットで `run-fixtures.json` を作り直し(出力の `cases` から工事 A・B・C だけを残す)、変わった所を機能の notes に書く。
`need-rows-paper.json` は要るものの紙に出る文(`renderBidResult`)の順と hash。文を変える直しでは、同じコミットで `NEED_ROWS_WRITE=1 node --test tests/unit/need-rows.test.mjs` で作り直し、変わった所を機能の notes に書く。

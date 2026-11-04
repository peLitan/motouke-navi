#!/usr/bin/env bash
# E1 の raw/ だけを作業フォルダへ写す。case.json(仕込みの一覧)は写さない
set -eu
cp -R "$(dirname "$0")/../cases/E1_しおかぜ町下水道/raw" ./raw

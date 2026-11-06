#!/usr/bin/env bash
# E4 の架空の台帳(このフォルダの raw/)だけを作業フォルダの raw/ へ写す。仕込みの一覧の置き場は見ない
set -eu
cp -R "$(dirname "$0")/raw" ./raw

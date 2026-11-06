#!/usr/bin/env bash
# E2 の raw/ だけを作業フォルダへ写す。case.json(仕込みの一覧)は写さない
set -eu
cp -R "$(dirname "$0")/../cases/E2_あおば台共同住宅/raw" ./raw

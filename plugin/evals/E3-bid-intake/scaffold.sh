#!/usr/bin/env bash
# 架空の公告と説明書を作業フォルダの 公告/ へ写す。頼み方が指す名前で置く
set -eu
mkdir -p 公告
cp "$(dirname "$0")/公告.txt" 公告/N3_市の公告.txt
cp "$(dirname "$0")/説明書.txt" 公告/N3_市の説明書.txt

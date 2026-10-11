#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
source ./env.sh
for d in 01-* 02-* 03-* 04-* 05-* 06-*; do
  [ -f "$d/index.html" ] || continue
  name="$(basename "$d")"
  printf '%-14s ' "$name"
  "$HF_BIN" render "./$d" -o "renders/$name.mp4" -f 30 --quality looks --quiet --workers 2 >/tmp/r_$name.log 2>&1 \
    && ffprobe -v error -show_entries format=duration -of csv=p=0 "renders/$name.mp4" | awk '{printf "ok  %.1fs\n",$1}' \
    || { echo "FAILED"; tail -3 /tmp/r_$name.log; }
done

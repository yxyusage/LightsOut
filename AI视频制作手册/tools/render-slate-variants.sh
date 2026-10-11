#!/usr/bin/env bash
# 片头有两个交付版本：
#   00-片头.mp4          带字幕 + 底部说明行（原版）
#   00-片头-无字幕.mp4    纯画面（字幕层与底部说明行都关掉），适合自己配音
# 做法是临时关层重渲再还原源文件，而不是在画面上打补丁。
set -euo pipefail
cd "$(dirname "$0")/.."
source ./env.sh

BAK="$(mktemp)"
cp index.html "$BAK"
restore() { [ -f "$BAK" ] && cp "$BAK" index.html || true; }
trap restore EXIT

echo "== 带字幕版 =="
"$HF_BIN" render . -o renders/00-片头.mp4 -f 30 --quality looks --quiet --workers 2 >/tmp/slate_a.log 2>&1
ffprobe -v error -show_entries format=duration -of csv=p=0 renders/00-片头.mp4 | awk '{printf "   00-片头.mp4          %.1fs\n",$1}'

echo "== 纯画面版（临时关掉字幕层与底部说明行）=="
python3 - <<'PY'
p='index.html'
s=open(p,encoding='utf-8').read()
s=s.replace('  BL.subtitles(tl, [{ t: 0.4, text: "BiliLearn-AI 宣传片。" }]);',
            '  /* 纯画面版：本次渲染临时关闭字幕层 */')
s=s.replace('</style>', '  #foot{opacity:0 !important}   /* 纯画面版：临时隐藏底部说明行 */\n</style>')
open(p,'w',encoding='utf-8').write(s)
PY
"$HF_BIN" render . -o renders/00-片头-无字幕.mp4 -f 30 --quality looks --quiet --workers 2 >/tmp/slate_b.log 2>&1
ffprobe -v error -show_entries format=duration -of csv=p=0 renders/00-片头-无字幕.mp4 | awk '{printf "   00-片头-无字幕.mp4   %.1fs\n",$1}'

restore
echo "已还原 index.html：BL.subtitles=$(grep -c 'BL.subtitles' index.html)  临时样式=$(grep -c 'opacity:0 !important' index.html)"

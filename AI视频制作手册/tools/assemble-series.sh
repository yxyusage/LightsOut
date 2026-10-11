#!/usr/bin/env bash
# 七支短片按序拼成一条总览片，并生成一张全系列对比图。
# 只在所有分片渲染完成后运行。
set -euo pipefail
cd "$(dirname "$0")/.."
FF=${FF:-/opt/homebrew/bin/ffmpeg}

FILES=(
  "renders/00-片头.mp4"
  "renders/01-开场痛点.mp4"
  "renders/02-输入解析.mp4"
  "renders/03-生成机制.mp4"
  "renders/04-笔记成品.mp4"
  "renders/05-自测复习.mp4"
  "renders/06-数据收尾.mp4"
)

missing=0
for f in "${FILES[@]}"; do
  if [ ! -s "$f" ]; then echo "缺少: $f"; missing=1; fi
done
if [ "$missing" = "1" ]; then echo "有分片尚未渲染，先完成再运行。"; exit 1; fi

# 统一参数后无损拼接（同一编码器/分辨率/帧率/像素格式）
: > /tmp/bl_concat.txt
for f in "${FILES[@]}"; do echo "file '$(cd "$(dirname "$f")" && pwd)/$(basename "$f")'" >> /tmp/bl_concat.txt; done

"$FF" -hide_banner -loglevel error -y -f concat -safe 0 -i /tmp/bl_concat.txt \
  -c copy "renders/系列总览-all-in-one.mp4"

# 每支取一帧做对比图
i=0
SHEET_IN=()
for f in "${FILES[@]}"; do
  name=$(basename "$f" .mp4)
  # 取片长 45% 处，通常是最有信息量的一帧
  dur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$f")
  t=$(awk -v d="$dur" 'BEGIN{printf "%.2f", d*0.45}')
  "$FF" -hide_banner -loglevel error -y -ss "$t" -i "$f" -frames:v 1 "/tmp/bl_shot_$i.png"
  SHEET_IN+=("-i" "/tmp/bl_shot_$i.png")
  i=$((i+1))
done
"$FF" -hide_banner -loglevel error -y "${SHEET_IN[@]}" \
  -filter_complex "[0]scale=640:360[a];[1]scale=640:360[b];[2]scale=640:360[c];[3]scale=640:360[d];[4]scale=640:360[e];[5]scale=640:360[f];[6]scale=640:360[g];[a][b][c]hstack=3[r1];[d][e][f]hstack=3[r2];[g]scale=640:360,pad=1920:360:0:0:color=0x111111[r3];[r1][r2][r3]vstack=3" \
  "renders/系列对比图.png"

echo "== 总览 =="
ffprobe -v error -show_entries format=duration -of csv=p=0 "renders/系列总览-all-in-one.mp4" | awk '{printf "  系列总览: %.1f 秒\n", $1}'
ls -lh renders/ | sed 's/^/  /'

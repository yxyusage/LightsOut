#!/usr/bin/env bash
# 每支短片 = 一个独立的 HyperFrames 工程（框架要求一个工程只有一个根合成）。
# 共用资产按片拷贝进各自的 assets/，保证任何一支都能独立打开、独立渲染、独立校验。
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"

# UI 截图：PNG 母版留档，工程内使用高质量 JPEG（体积减半，画质无损感知）
mkdir -p assets/ui-master
for f in assets/ui/*.png; do
  [ -e "$f" ] || continue
  b="$(basename "$f" .png)"
  mv "$f" "assets/ui-master/$b.png"
done
mkdir -p /tmp/uijpg
for f in assets/ui-master/*.png; do
  b="$(basename "$f" .png)"
  ffmpeg -hide_banner -loglevel error -y -i "$f" -q:v 3 "assets/ui/$b.jpg"
done

FILMS=(
  "01-开场痛点"
  "02-输入解析"
  "03-生成机制"
  "04-笔记成品"
  "05-自测复习"
  "06-数据收尾"
)

for name in "${FILMS[@]}"; do
  d="$ROOT/$name"
  mkdir -p "$d/assets/vendor" "$d/assets/ui"
  cp "$ROOT/hyperframes.json" "$d/hyperframes.json"
  printf '{\n  "id": "%s",\n  "name": "%s",\n  "createdAt": "2026-10-08T18:40:00.000Z"\n}\n' "$name" "$name" > "$d/meta.json"
  cp "$ROOT/assets/kit.css" "$ROOT/assets/kit.js" "$d/assets/"
  cp "$ROOT/assets/vendor/gsap.min.js" "$d/assets/vendor/"
  cp "$ROOT/assets/ui/"*.jpg "$d/assets/ui/"
  echo "scaffolded $name"
done

# 把已写好的第一支搬进它自己的工程
if [ -f "$ROOT/01-开场痛点.html" ]; then
  mv "$ROOT/01-开场痛点.html" "$ROOT/01-开场痛点/index.html"
  echo "moved 01 into its project"
fi

rm -f "$ROOT/slate.html"
echo "--- done ---"
ls -d "$ROOT"/0*/ | sed "s|$ROOT/||"

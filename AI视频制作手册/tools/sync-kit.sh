#!/usr/bin/env bash
# 把主 kit 同步到每支短片工程
set -euo pipefail
cd "$(dirname "$0")/.."
for d in 0*/; do
  cp assets/kit.css assets/kit.js "$d/assets/" 2>/dev/null || true
done
echo "kit synced to: $(ls -d 0*/ | tr '\n' ' ')"

#!/usr/bin/env bash
# Environment for HyperFrames inside this sandboxed session.
#   * HOME is relocated into the project so every cache the CLI writes
#     (~/.cache/hyperframes, ~/.hyperframes, ~/.npm) stays inside the writable
#     workspace instead of the host home directory.
#   * The renderer reuses the system Google Chrome build instead of downloading
#     a second copy.
#   * Telemetry is off.
export HF_HOME_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export HOME="$HF_HOME_DIR/.home"
export HYPERFRAMES_BROWSER_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
export HYPERFRAMES_NO_TELEMETRY=1
export HYPERFRAMES_MEDIA_HOME="$HF_HOME_DIR/.media"
export HYPERFRAMES_FONT_CACHE_DIR="$HF_HOME_DIR/.cache/fonts"
mkdir -p "$HOME" "$HYPERFRAMES_MEDIA_HOME" "$HYPERFRAMES_FONT_CACHE_DIR"
HF_BIN="$HF_HOME_DIR/node_modules/.bin/hyperframes"

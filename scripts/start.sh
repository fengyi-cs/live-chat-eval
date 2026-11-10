#!/usr/bin/env bash
# scripts/start.sh
# Linux / macOS 薄入口。需要 Node >= 22 已安装并在 PATH 中。
# 用法：bash scripts/start.sh [--skip-build]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if ! command -v node &>/dev/null; then
  echo "[start.sh] Error: 'node' not found in PATH."
  echo "  Install Node.js 22 LTS from https://nodejs.org/"
  exit 1
fi

exec node "${SCRIPT_DIR}/launcher.mjs" "$@"

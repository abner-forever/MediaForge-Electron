#!/bin/bash
# MediaForge Electron local build.
# The app is now pure Electron/Node; no Python runtime is required.
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"

log() { printf '\033[36m[%s]\033[0m %s\n' "$(date +%H:%M:%S)" "$1"; }
ok()  { printf '  \033[32m✓\033[0m %s\n' "$1"; }
fail() { printf '  \033[31m✗\033[0m %s\n' "$1" >&2; exit 1; }

log "Building MediaForge Electron"

command -v node >/dev/null 2>&1 || fail "Node.js is required"
command -v npm >/dev/null 2>&1 || fail "npm is required"

log "Building frontend"
cd "$PROJECT_ROOT/desktop/web"
if [ ! -d node_modules ]; then
  if command -v pnpm >/dev/null 2>&1; then
    pnpm install --frozen-lockfile
  else
    npm install
  fi
fi

if command -v pnpm >/dev/null 2>&1; then
  pnpm run build
else
  npm run build
fi

log "Installing Electron dependencies"
cd "$PROJECT_ROOT/electron"
npm ci

log "Packaging Electron app"
npx electron-builder --publish never

ok "Build complete"
echo "Artifacts: $PROJECT_ROOT/electron/out"

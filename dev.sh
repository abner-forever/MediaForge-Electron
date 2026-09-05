#!/bin/bash
# MediaForge Electron development startup.
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"

if [ ! -f "$PROJECT_ROOT/desktop/static/index.html" ]; then
  echo "Frontend build not found. Building it first..."
  cd "$PROJECT_ROOT/desktop/web"
  if command -v pnpm >/dev/null 2>&1; then
    pnpm install
    pnpm run build
  else
    npm install
    npm run build
  fi
fi

cd "$PROJECT_ROOT/electron"
if [ ! -d node_modules ]; then
  npm install
fi

exec npm start

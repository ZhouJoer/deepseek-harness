#!/bin/sh
# Git for Windows can expose pnpm only through its .cmd launcher.
set -eu
export PATH="$(dirname "$(command -v node)"):$PATH"
if command -v pnpm >/dev/null 2>&1; then
  exec pnpm run typecheck
fi
exec pnpm.cmd run typecheck

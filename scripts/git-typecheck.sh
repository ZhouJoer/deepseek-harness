#!/bin/sh
# Keep npm and its child scripts on the same Node installation under Git for Windows.
set -eu
export PATH="$(dirname "$(command -v node)"):$PATH"
exec npm run typecheck

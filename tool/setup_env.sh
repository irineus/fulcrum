#!/usr/bin/env bash
# tool/setup_env.sh — idempotent bootstrap for a Fulcrum session (Linux/macOS/WSL).
#
# Guarantees Node >= 22 on PATH (the cloud image ships /opt/node22) and installs the
# gateway's dev dependencies from the lockfile. Nothing here deploys anything.
#
# Usage:  bash tool/setup_env.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
log()  { printf '\n==> %s\n' "$*"; }
fail() { printf '\nERROR: %s\n' "$*" >&2; exit 1; }

log "Node"
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  if [ -x /opt/node22/bin/node ]; then
    export PATH="/opt/node22/bin:$PATH"
  else
    fail "Node >= 22 is required (found: $(node --version 2>/dev/null || echo none))."
  fi
fi
node --version && npm --version

log "gateway dependencies"
cd "$REPO_ROOT/gateway"
if [ -f package-lock.json ]; then npm ci; else npm install; fi

log "ready — next: cd gateway && npm run lint && npm test"

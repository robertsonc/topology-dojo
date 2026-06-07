#!/bin/bash
# SessionStart hook: install dependencies so tests, linters, and the build work
# immediately in Claude Code on the web. Idempotent and non-interactive.
set -euo pipefail

# Only needed in the remote (web) environment; local devs manage their own deps.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

# npm install (not ci) so the cached container state can be reused across runs.
npm install

#!/usr/bin/env bash
# Local "stay current" helper: latest remote main + clean node_modules from lockfile.
# Run from repo root: npm run sync

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
REMOTE="${1:-origin}"

echo "→ Pulling + rebasing $REMOTE/$BRANCH (or current branch)"
git fetch "$REMOTE"
git pull --rebase "$REMOTE" "$BRANCH"

echo "→ npm ci (exact lockfile)"
npm ci

echo "✅ Repo and dependencies are up to date."

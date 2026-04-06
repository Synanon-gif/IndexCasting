#!/usr/bin/env bash
# Deploy all Edge Functions in supabase/functions/ to the linked Supabase project.
# Requires: SUPABASE_ACCESS_TOKEN, SUPABASE_PROJECT_REF
# Usage (local):  export SUPABASE_ACCESS_TOKEN=... SUPABASE_PROJECT_REF=your-ref && bash scripts/deploy-supabase-functions.sh
# CI: secrets are injected by GitHub Actions.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PROJECT_REF="${SUPABASE_PROJECT_REF:?Set SUPABASE_PROJECT_REF}"
export SUPABASE_ACCESS_TOKEN="${SUPABASE_ACCESS_TOKEN:?Set SUPABASE_ACCESS_TOKEN}"

shopt -s nullglob
for dir in "$ROOT"/supabase/functions/*/; do
  name="$(basename "$dir")"
  case "$name" in
    _shared|_templates) continue ;;
  esac
  if [[ ! -f "$dir/index.ts" && ! -f "$dir/index.js" ]]; then
    echo "Skipping $name (no entrypoint)"
    continue
  fi
  echo "▶ Deploying Edge Function: $name"
  npx supabase functions deploy "$name" --no-verify-jwt --project-ref "$PROJECT_REF"
done

echo "✅ All Edge Functions deployed."

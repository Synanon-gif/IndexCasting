#!/usr/bin/env bash
# Deploy all Edge Functions in supabase/functions/ to the linked Supabase project.
#
# Auth (one of):
#   - Supabase CLI login:  npx supabase login
#   - Or set SUPABASE_ACCESS_TOKEN (CI / Dashboard Access Token)
#
# Project ref: set SUPABASE_PROJECT_REF, or rely on comment in supabase/config.toml:
#   # Project ref: your-ref

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ -n "${SUPABASE_PROJECT_REF:-}" ]]; then
  PROJECT_REF="$SUPABASE_PROJECT_REF"
elif [[ -f "$ROOT/supabase/config.toml" ]] && grep -qE '^#[[:space:]]*Project ref:' "$ROOT/supabase/config.toml"; then
  PROJECT_REF="$(grep -m1 -E '^#[[:space:]]*Project ref:' "$ROOT/supabase/config.toml" | sed -E 's/^#[[:space:]]*Project ref:[[:space:]]*//;s/[[:space:]]*$//')"
else
  echo "Set SUPABASE_PROJECT_REF or add to supabase/config.toml: # Project ref: <ref>" >&2
  exit 1
fi

if [[ -z "$PROJECT_REF" ]]; then
  echo "Could not resolve project ref (SUPABASE_PROJECT_REF empty and config.toml has no Project ref line)." >&2
  exit 1
fi

if [[ -n "${SUPABASE_ACCESS_TOKEN:-}" ]]; then
  export SUPABASE_ACCESS_TOKEN
fi

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

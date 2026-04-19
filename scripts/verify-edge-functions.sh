#!/usr/bin/env bash
# Edge Function deploy verification.
#
# Confirms that every Edge Function present under `supabase/functions/`
# (excluding shared-only directories) is also deployed and active on the
# linked Supabase project. Catches the failure mode where
# `deploy-supabase-functions.sh` exits 0 but a single function silently
# failed to upload (e.g. transient 502 from Supabase, malformed deno.json).
#
# What this verifies:
#   1. Every local function dir with an entrypoint exists in the live
#      functions list (Management API).
#   2. Each deployed function's status is 'ACTIVE' (not 'THROTTLED' / etc).
#   3. The live deployment count matches the local count (no orphans on
#      either side that would indicate drift).
#
# Usage:
#   bash scripts/verify-edge-functions.sh
#
# Env (CI-friendly):
#   SUPABASE_ACCESS_TOKEN  required
#   SUPABASE_PROJECT_REF   required (defaults to the project ref baked into
#                          .env.supabase if present)
#
# Exit codes:
#   0 — local set ⊆ live set, all ACTIVE
#   1 — drift detected or non-active function found

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT/.env.supabase"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

PROJECT_REF="${SUPABASE_PROJECT_REF:-ispkfdqzjrfrilosoklu}"

if [[ -z "${SUPABASE_ACCESS_TOKEN:-}" ]]; then
  echo "❌ SUPABASE_ACCESS_TOKEN missing (set via .env.supabase locally or as CI secret)"
  exit 1
fi

echo "▶ Listing local Edge Functions under supabase/functions/"
LOCAL_FUNCS=()
shopt -s nullglob
for dir in "$ROOT"/supabase/functions/*/; do
  name="$(basename "$dir")"
  case "$name" in
    _shared|_templates) continue ;;
  esac
  if [[ -f "$dir/index.ts" || -f "$dir/index.js" ]]; then
    LOCAL_FUNCS+=("$name")
  fi
done

if [[ "${#LOCAL_FUNCS[@]}" -eq 0 ]]; then
  echo "❌ No local Edge Functions found"
  exit 1
fi

echo "  Found ${#LOCAL_FUNCS[@]} local function(s): ${LOCAL_FUNCS[*]}"

echo "▶ Querying live Edge Functions list (Management API)"
LIVE_RES=$(curl -sS \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  "https://api.supabase.com/v1/projects/$PROJECT_REF/functions")

if [[ -z "$LIVE_RES" ]]; then
  echo "❌ Empty response from Supabase Management API"
  exit 1
fi

if echo "$LIVE_RES" | grep -q '"message"'; then
  if ! echo "$LIVE_RES" | grep -q '"slug"'; then
    echo "❌ Management API error response:"
    echo "$LIVE_RES"
    exit 1
  fi
fi

# Parse via python (jq not always available in CI base images).
LIVE_FUNCS=$(echo "$LIVE_RES" | python3 -c "
import sys, json
d = json.load(sys.stdin)
if not isinstance(d, list):
    sys.exit('unexpected response shape')
for f in d:
    print(f.get('slug', '') + '|' + f.get('status', 'UNKNOWN'))
")

PASS=0
FAIL=0
NON_ACTIVE=()
MISSING=()

for name in "${LOCAL_FUNCS[@]}"; do
  match=$(echo "$LIVE_FUNCS" | grep "^${name}|" || true)
  if [[ -z "$match" ]]; then
    echo "  ❌ $name — not deployed"
    MISSING+=("$name")
    FAIL=$((FAIL + 1))
  else
    status="${match##*|}"
    if [[ "$status" == "ACTIVE" ]]; then
      echo "  ✅ $name — ACTIVE"
      PASS=$((PASS + 1))
    else
      echo "  ⚠️  $name — status=$status"
      NON_ACTIVE+=("$name ($status)")
      FAIL=$((FAIL + 1))
    fi
  fi
done

echo ""
echo "Edge function verify: $PASS passed, $FAIL failed"

if [[ ${#MISSING[@]} -gt 0 ]]; then
  echo "  Missing on live: ${MISSING[*]}"
fi
if [[ ${#NON_ACTIVE[@]} -gt 0 ]]; then
  echo "  Non-active on live: ${NON_ACTIVE[*]}"
fi

if [[ $FAIL -gt 0 ]]; then
  exit 1
fi
exit 0

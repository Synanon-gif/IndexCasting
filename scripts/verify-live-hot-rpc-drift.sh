#!/usr/bin/env bash
# Read-only: compare Supabase Postgres live state vs repo migration intents.
#
# Prerequisites: .env.supabase with SUPABASE_ACCESS_TOKEN (see scripts/supabase-push-verify-migration.sh).
#
# Performs:
# 1. MAX(version) from supabase_migrations.schema_migrations vs max YYYYMMDD prefix from supabase/migrations/*.sql
# 2. Substring probes on LIVE pg_get_functiondef for hot SECURITY DEFINER RPCs:
#    agency_remove_model, claim_model_by_token, generate_model_claim_token, delete_option_request_full
#
# Exit codes:
#   0 — all substring checks OK (migration table row count may omit history; interpret WARNING carefully).
#   1 — substring check detected a probable regression pattern on LIVE, or unexpected API/error payload.
#   2 — .env.supabase missing or SUPABASE_ACCESS_TOKEN empty.
#
# Does NOT mutate the database.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT/.env.supabase"
PROJECT_REF="ispkfdqzjrfrilosoklu"
API_URL="https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "❌ Missing $ENV_FILE"
  exit 2
fi

set -a
source "$ENV_FILE"
set +a

if [[ -z "${SUPABASE_ACCESS_TOKEN:-}" ]]; then
  echo "❌ SUPABASE_ACCESS_TOKEN unset"
  exit 2
fi

query() {
  curl -s -X POST "$API_URL" \
    -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -d "$1"
}

REPO_MAX_PREFIX="$(
  for f in "$ROOT/supabase/migrations/"*.sql; do
    base="$(basename "${f%.sql}")"
    [[ "$base" =~ ^([0-9]{8}) ]] && printf '%s\n' "${BASH_REMATCH[1]}"
  done | LC_ALL=C sort | tail -1 || true
)"

LIVE_ROWS_JSON="$(query "$(python3 -c 'import json; print(json.dumps({"query":"SELECT MAX(version)::text AS max_ver, COUNT(*)::int AS cnt FROM supabase_migrations.schema_migrations"}))')")"

LIVE_MAX=""
LIVE_CNT=""
if echo "$LIVE_ROWS_JSON" | python3 -c 'import json,sys; json.load(sys.stdin)' 2>/dev/null; then
  LIVE_MAX="$(echo "$LIVE_ROWS_JSON" | python3 -c 'import json,sys; d=json.load(sys.stdin); print((d[0] or {}).get("max_ver") or "")')" 2>/dev/null || true
  LIVE_CNT="$(echo "$LIVE_ROWS_JSON" | python3 -c 'import json,sys; d=json.load(sys.stdin); print((d[0] or {}).get("cnt",""))')" 2>/dev/null || true
fi

echo "=== Live migration tracking (schema_migrations) ==="
echo "live_max_version=${LIVE_MAX:-?} rows=${LIVE_CNT:-?}"
echo "repo_max_YYYYMMDD_prefix=${REPO_MAX_PREFIX:-?}"

if [[ -n "${REPO_MAX_PREFIX:-}" && -n "${LIVE_MAX:-}" ]]; then
  LM8="${LIVE_MAX:0:8}"
  if [[ "${#LM8}" -eq 8 && "${LM8}" =~ ^[0-9]{8}$ && "${REPO_MAX_PREFIX}" =~ ^[0-9]{8}$ ]]; then
    if [[ "$REPO_MAX_PREFIX" > "$LM8" ]]; then
      echo "⚠️  WARNING: repo migration date prefix (${REPO_MAX_PREFIX}) newer than live version prefix (${LM8}) — possible deploy drift."
    fi
  fi
fi

BAD=0

ensure_array_response() {
  local json="$1"
  if echo "$json" | python3 -c 'import json,sys; j=json.load(sys.stdin); sys.exit(0 if isinstance(j,list) and j else 1)' 2>/dev/null; then
    return 0
  fi
  echo "❌ Unexpected API payload: $json" >&2
  return 1
}

check_agency() {
  AGENCY_JSON="$(query "$(python3 <<'PY'
import json
q = """SELECT POSITION('agency_id = NULL' IN pg_get_functiondef(p.oid)) AS pos_exact_null_assignment
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'agency_remove_model'"""
print(json.dumps({"query": q}))
PY
)")"
  echo ""
  echo "=== LIVE agency_remove_model ==="
  echo "$AGENCY_JSON" | python3 -m json.tool 2>/dev/null || echo "$AGENCY_JSON"
  if ! ensure_array_response "$AGENCY_JSON"; then BAD=1; return; fi
  POS="$(echo "$AGENCY_JSON" | python3 -c 'import json,sys; d=json.load(sys.stdin)[0]; print(int(d.get("pos_exact_null_assignment",-1)))')"
  if [[ "${POS:?}" != "0" ]]; then
    echo "❌ agency_remove_model: body contains substring 'agency_id = NULL'"
    BAD=1
  else
    echo "✓ agency_remove_model: no substring 'agency_id = NULL'"
  fi
}

check_claim() {
  CLAIM_JSON="$(query "$(python3 <<'PY'
import json
q = """SELECT (POSITION('model_already_claimed_by_other_user' IN pg_get_functiondef(p.oid)) > 0) AS has_cross_account_guard
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'claim_model_by_token'"""
print(json.dumps({"query": q}))
PY
)")"
  echo ""
  echo "=== LIVE claim_model_by_token ==="
  echo "$CLAIM_JSON" | python3 -m json.tool 2>/dev/null || echo "$CLAIM_JSON"
  if ! ensure_array_response "$CLAIM_JSON"; then BAD=1; return; fi
  CG="$(echo "$CLAIM_JSON" | python3 -c 'import json,sys; print(str(json.load(sys.stdin)[0].get("has_cross_account_guard")).lower())')"
  if [[ "$CG" != "true" ]]; then
    echo "❌ claim_model_by_token missing model_already_claimed_by_other_user in live definition"
    BAD=1
  else
    echo "✓ claim_model_by_token guard string present"
  fi
}

check_generate() {
  GEN_JSON="$(query "$(python3 <<'PY'
import json
q = """SELECT
  (POSITION('gen_random_bytes' IN pg_get_functiondef(p.oid)) > 0) AS uses_gen_random_bytes,
  (POSITION('digest(' IN pg_get_functiondef(p.oid)) > 0) AS uses_bare_digest_open
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'generate_model_claim_token'"""
print(json.dumps({"query": q}))
PY
)")"
  echo ""
  echo "=== LIVE generate_model_claim_token ==="
  echo "$GEN_JSON" | python3 -m json.tool 2>/dev/null || echo "$GEN_JSON"
  if ! ensure_array_response "$GEN_JSON"; then BAD=1; return; fi
  UG="$(echo "$GEN_JSON" | python3 -c 'import json,sys; print(str(json.load(sys.stdin)[0].get("uses_gen_random_bytes")).lower())')"
  UD="$(echo "$GEN_JSON" | python3 -c 'import json,sys; print(str(json.load(sys.stdin)[0].get("uses_bare_digest_open")).lower())')"
  if [[ "$UG" == "true" || "$UD" == "true" ]]; then
    echo "❌ generate_model_claim_token still references forbidden pgcrypto symbols on live"
    BAD=1
  else
    echo "✓ generate_model_claim_token: no gen_random_bytes / bare digest("
  fi
}

check_delete() {
  DEL_JSON="$(query "$(python3 <<'PY'
import json
q = """SELECT
  (POSITION('jsonb_set' IN pg_get_functiondef(p.oid)) > 0) AS has_jsonb_set,
  (POSITION('UPDATE public.messages' IN pg_get_functiondef(p.oid)) > 0) AS updates_b2b_messages
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'delete_option_request_full'"""
print(json.dumps({"query": q}))
PY
)")"
  echo ""
  echo "=== LIVE delete_option_request_full ==="
  echo "$DEL_JSON" | python3 -m json.tool 2>/dev/null || echo "$DEL_JSON"
  if ! ensure_array_response "$DEL_JSON"; then BAD=1; return; fi
  JS="$(echo "$DEL_JSON" | python3 -c 'import json,sys; print(str(json.load(sys.stdin)[0].get("has_jsonb_set")).lower())')"
  UM="$(echo "$DEL_JSON" | python3 -c 'import json,sys; print(str(json.load(sys.stdin)[0].get("updates_b2b_messages")).lower())')"
  if [[ "$JS" != "true" || "$UM" != "true" ]]; then
    echo "❌ delete_option_request_full missing B2B message cleanup markers on live"
    BAD=1
  else
    echo "✓ delete_option_request_full: jsonb_set + UPDATE public.messages"
  fi
}

check_agency
check_claim
check_generate
check_delete

exit "$BAD"

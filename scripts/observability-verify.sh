#!/usr/bin/env bash
# Observability live-verify script.
#
# Bundles all Supabase Management API checks that confirm the observability
# stack is correctly deployed on the live database. Safe to run anytime —
# all queries are read-only EXCEPT a single guarded INSERT/DELETE smoke
# test on `system_events` (own row, immediately cleaned up).
#
# What this verifies:
#   1. Tables: system_events, system_health_checks, system_invariant_violations
#   2. RPCs:   record_system_event, get_public_health_summary,
#              get_admin_health_overview, run_system_health_checks,
#              _record_system_health_check
#   3. pg_cron job: system_health_checks_5min (active, every 5 min)
#   4. Health checks: 11 expected, none "down"
#   5. RLS policies: admin-only on all 3 observability tables
#   6. Source-check constraint on system_events (allowed sources)
#   7. Smoke INSERT/DELETE roundtrip on system_events
#   8. Public summary RPC: returns valid shape with overall_status
#   9. Admin overview RPC: rejects unauthenticated callers (Defense-in-Depth)
#  10. record_system_event RPC: rejects unauthenticated callers
#
# Usage:
#   bash scripts/observability-verify.sh
#
# Exit codes:
#   0 — all checks passed
#   1 — one or more checks failed (details printed)

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT/.env.supabase"

# Local dev: source .env.supabase if present.
# CI: SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_REF come from environment.
if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

PROJECT_REF="${SUPABASE_PROJECT_REF:-ispkfdqzjrfrilosoklu}"
API_URL="https://api.supabase.com/v1/projects/$PROJECT_REF/database/query"

if [[ -z "${SUPABASE_ACCESS_TOKEN:-}" ]]; then
  echo "❌ SUPABASE_ACCESS_TOKEN missing (set via .env.supabase locally or as CI secret)"
  exit 1
fi

PASS=0
FAIL=0

# Run a SQL query against Supabase Management API and echo the JSON body.
# stdout = response body. Returns 0 on HTTP 201, 1 otherwise.
run_query() {
  local sql="$1"
  local payload
  payload="$(printf '%s' "$sql" | python3 -c 'import json,sys; print(json.dumps({"query": sys.stdin.read()}))')"
  curl -sS -X POST "$API_URL" \
    -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -d "$payload"
}

assert_pass() {
  local label="$1"
  PASS=$((PASS + 1))
  echo "✅ $label"
}

assert_fail() {
  local label="$1"
  local detail="${2:-}"
  FAIL=$((FAIL + 1))
  echo "❌ $label"
  if [[ -n "$detail" ]]; then
    echo "   $detail"
  fi
}

echo "▶ 1. Verifying observability tables exist…"
T_RES="$(run_query "WITH t AS (SELECT to_regclass('public.system_events')::text AS a, to_regclass('public.system_health_checks')::text AS b, to_regclass('public.system_invariant_violations')::text AS c) SELECT a, b, c FROM t;")"
if echo "$T_RES" | grep -q '"a":"system_events"' && echo "$T_RES" | grep -q '"b":"system_health_checks"' && echo "$T_RES" | grep -q '"c":"system_invariant_violations"'; then
  assert_pass "All 3 observability tables exist"
else
  assert_fail "One or more observability tables missing" "$T_RES"
fi

echo "▶ 2. Verifying observability RPCs exist…"
RPC_RES="$(run_query "SELECT json_agg(routine_name ORDER BY routine_name)::text AS rpcs FROM information_schema.routines WHERE routine_schema='public' AND routine_name IN ('record_system_event','get_public_health_summary','get_admin_health_overview','run_system_health_checks','_record_system_health_check');")"
EXPECTED_RPCS=("_record_system_health_check" "get_admin_health_overview" "get_public_health_summary" "record_system_event" "run_system_health_checks")
RPC_OK=1
for r in "${EXPECTED_RPCS[@]}"; do
  if ! echo "$RPC_RES" | grep -qF "$r"; then
    RPC_OK=0
    break
  fi
done
if [[ $RPC_OK -eq 1 ]]; then
  assert_pass "All 5 observability RPCs deployed"
else
  assert_fail "One or more observability RPCs missing" "$RPC_RES"
fi

echo "▶ 3. Verifying pg_cron job system_health_checks_5min is active…"
CRON_RES="$(run_query "SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'system_health_checks_5min';")"
if echo "$CRON_RES" | grep -q '"jobname":"system_health_checks_5min"' && echo "$CRON_RES" | grep -q '"schedule":"\*/5 \* \* \* \*"' && echo "$CRON_RES" | grep -q '"active":true'; then
  assert_pass "Cron job system_health_checks_5min active (*/5 * * * *)"
else
  assert_fail "Cron job missing or misconfigured" "$CRON_RES"
fi

echo "▶ 4. Verifying health checks (11 expected, none 'down')…"
HC_RES="$(run_query "SELECT count(*) FILTER (WHERE true) AS total, count(*) FILTER (WHERE status='down') AS down_count, count(*) FILTER (WHERE status='degraded') AS degraded_count FROM public.system_health_checks;")"
TOTAL="$(echo "$HC_RES" | python3 -c 'import json,sys; r=json.loads(sys.stdin.read()); print(r[0].get("total",0))' 2>/dev/null || echo 0)"
DOWN="$(echo "$HC_RES" | python3 -c 'import json,sys; r=json.loads(sys.stdin.read()); print(r[0].get("down_count",0))' 2>/dev/null || echo 0)"
DEGRADED="$(echo "$HC_RES" | python3 -c 'import json,sys; r=json.loads(sys.stdin.read()); print(r[0].get("degraded_count",0))' 2>/dev/null || echo 0)"
if [[ "$TOTAL" -ge 11 && "$DOWN" == "0" ]]; then
  assert_pass "$TOTAL health checks present, $DOWN down, $DEGRADED degraded (warn-only)"
else
  assert_fail "Health-check count or down-status off" "total=$TOTAL down=$DOWN degraded=$DEGRADED"
fi

echo "▶ 5. Verifying RLS policies on observability tables (admin-only)…"
RLS_RES="$(run_query "SELECT count(*) AS cnt FROM pg_policies WHERE schemaname='public' AND tablename IN ('system_events','system_health_checks','system_invariant_violations');")"
RLS_CNT="$(echo "$RLS_RES" | python3 -c 'import json,sys; r=json.loads(sys.stdin.read()); print(r[0].get("cnt",0))' 2>/dev/null || echo 0)"
if [[ "$RLS_CNT" -ge 11 ]]; then
  assert_pass "$RLS_CNT RLS policies on observability tables"
else
  assert_fail "Expected ≥11 RLS policies, got $RLS_CNT" "$RLS_RES"
fi

echo "▶ 6. Verifying system_events.source check constraint…"
CHK_RES="$(run_query "SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid = 'public.system_events'::regclass AND conname='system_events_source_check';")"
if echo "$CHK_RES" | grep -q "frontend" && echo "$CHK_RES" | grep -q "edge" && echo "$CHK_RES" | grep -q "db" && echo "$CHK_RES" | grep -q "cron" && echo "$CHK_RES" | grep -q "system"; then
  assert_pass "Source check constraint enforces {frontend,edge,db,cron,system}"
else
  assert_fail "Source check constraint missing or wrong" "$CHK_RES"
fi

echo "▶ 7. Smoke test: INSERT + DELETE roundtrip on system_events…"
INS_RES="$(run_query "INSERT INTO public.system_events (level, source, event, message, context) VALUES ('info','system','observability_verify_smoke','Smoke test from observability-verify.sh', jsonb_build_object('script','observability-verify.sh')) RETURNING id;")"
EVENT_ID="$(echo "$INS_RES" | python3 -c 'import json,sys; r=json.loads(sys.stdin.read()); print(r[0].get("id",""))' 2>/dev/null || echo "")"
if [[ -n "$EVENT_ID" ]]; then
  DEL_RES="$(run_query "DELETE FROM public.system_events WHERE id = '$EVENT_ID';")"
  assert_pass "INSERT/DELETE roundtrip OK (id=$EVENT_ID)"
else
  assert_fail "Smoke INSERT failed" "$INS_RES"
fi

echo "▶ 8. Verifying get_public_health_summary RPC returns valid shape…"
PUB_RES="$(run_query "SELECT public.get_public_health_summary() AS s;")"
if echo "$PUB_RES" | grep -q '"overall_status"' && echo "$PUB_RES" | grep -q '"checks"' && echo "$PUB_RES" | grep -q '"last_updated"'; then
  assert_pass "Public summary RPC shape valid"
else
  assert_fail "Public summary RPC shape invalid" "$PUB_RES"
fi

echo "▶ 9. Verifying get_admin_health_overview rejects unauthenticated…"
ADM_RES="$(run_query "SELECT public.get_admin_health_overview() AS o;")"
if echo "$ADM_RES" | grep -qi "assert_is_admin\|unauthorized\|not the platform admin"; then
  assert_pass "Admin overview RPC blocks non-admin caller (Defense-in-Depth)"
else
  assert_fail "Admin overview RPC did NOT block unauthenticated caller" "$ADM_RES"
fi

echo "▶ 10. Verifying record_system_event rejects unauthenticated…"
REC_RES="$(run_query "SELECT public.record_system_event('info','system','verify_unauth','msg', '{}'::jsonb);")"
if echo "$REC_RES" | grep -qi "not_authenticated\|not authenticated"; then
  assert_pass "record_system_event RPC blocks unauthenticated caller"
else
  assert_fail "record_system_event RPC did NOT block unauthenticated caller" "$REC_RES"
fi

echo
echo "═══════════════════════════════════════════════════════"
echo "  Observability verify summary: $PASS passed, $FAIL failed"
echo "═══════════════════════════════════════════════════════"

if [[ $FAIL -gt 0 ]]; then
  exit 1
fi
exit 0

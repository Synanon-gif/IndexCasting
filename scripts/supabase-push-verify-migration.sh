#!/usr/bin/env bash
# Push one Supabase SQL migration via Management API and verify it.
# Usage:
#   bash scripts/supabase-push-verify-migration.sh \
#     supabase/migrations/20260513_organization_profiles_foundation.sql \
#     "select to_regclass('public.organization_profiles') as table_exists"

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIGRATION_PATH="${1:-}"
VERIFY_SQL="${2:-select now() as deployed_at}"
ENV_FILE="$ROOT/.env.supabase"
PROJECT_REF="ispkfdqzjrfrilosoklu"
API_URL="https://api.supabase.com/v1/projects/$PROJECT_REF/database/query"

if [[ -z "$MIGRATION_PATH" ]]; then
  echo "Usage: bash scripts/supabase-push-verify-migration.sh <migration.sql> [verify-sql]"
  exit 1
fi

if [[ ! -f "$ROOT/$MIGRATION_PATH" ]]; then
  echo "Migration file not found: $MIGRATION_PATH"
  exit 1
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo ".env.supabase not found at $ENV_FILE"
  exit 1
fi

set -a
source "$ENV_FILE"
set +a

if [[ -z "${SUPABASE_ACCESS_TOKEN:-}" ]]; then
  echo "SUPABASE_ACCESS_TOKEN missing in .env.supabase"
  exit 1
fi

SQL="$(cat "$ROOT/$MIGRATION_PATH")"
PAYLOAD="$(echo "$SQL" | python3 -c 'import json,sys; print(json.dumps({"query": sys.stdin.read()}))')"

echo "▶ Deploying migration: $MIGRATION_PATH"
DEPLOY_RAW="$(curl -s -w "\nHTTP:%{http_code}\n" -X POST "$API_URL" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD")"

HTTP_CODE="$(echo "$DEPLOY_RAW" | sed -n 's/^HTTP://p' | tail -n 1)"
BODY="$(echo "$DEPLOY_RAW" | sed '$d')"

if [[ "$HTTP_CODE" == "201" ]]; then
  echo "✅ Migration deployed (HTTP:201)"
else
  # Idempotent case: migration already applied in live DB.
  if echo "$BODY" | grep -Eqi "already exists|42710|duplicate_object"; then
    echo "ℹ️ Migration appears already applied (idempotent duplicate: $HTTP_CODE)"
  else
    echo "❌ Migration deploy failed (HTTP:$HTTP_CODE)"
    echo "$BODY"
    exit 1
  fi
fi

echo "▶ Running verify query"
VERIFY_PAYLOAD="$(echo "$VERIFY_SQL" | python3 -c 'import json,sys; print(json.dumps({"query": sys.stdin.read()}))')"
VERIFY_RAW="$(curl -s -w "\nHTTP:%{http_code}\n" -X POST "$API_URL" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d "$VERIFY_PAYLOAD")"

VERIFY_HTTP="$(echo "$VERIFY_RAW" | sed -n 's/^HTTP://p' | tail -n 1)"
VERIFY_BODY="$(echo "$VERIFY_RAW" | sed '$d')"

if [[ "$VERIFY_HTTP" != "201" ]]; then
  echo "❌ Verify failed (HTTP:$VERIFY_HTTP)"
  echo "$VERIFY_BODY"
  exit 1
fi

echo "✅ Verify passed (HTTP:201)"
echo "$VERIFY_BODY"

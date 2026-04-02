#!/bin/bash
# =============================================================================
# Security Hardening Migrations — 2026-04
# Führt alle 4 neuen Migrations der Reihe nach gegen das verlinkte Supabase-
# Projekt aus. Voraussetzung: `npx supabase login` muss abgeschlossen sein.
# =============================================================================

set -e

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

run_migration() {
  local file="$1"
  local name="$(basename "$file")"
  echo ""
  echo "▶  Running: $name"
  npx supabase db query \
    --linked \
    -f "$file" \
    --output table \
    -o json 2>&1 | head -5
  echo "✓  Done: $name"
}

cd "$PROJECT_DIR"

run_migration "supabase/migration_access_gate_enforcement.sql"
run_migration "supabase/migration_rls_collision_fix.sql"
run_migration "supabase/migration_stripe_webhook_idempotency.sql"
run_migration "supabase/migration_guest_link_rate_limit.sql"

echo ""
echo "✅ All 4 migrations applied successfully."

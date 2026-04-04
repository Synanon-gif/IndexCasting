#!/usr/bin/env bash
# Generates docs/LLM_FULL_REVIEW_CONTEXT.md from whitelisted repo sources (no secrets).
# Run from repository root: ./scripts/generate-llm-review-bundle.sh
# Or: npm run review-context

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

OUT_REL="docs/LLM_FULL_REVIEW_CONTEXT.md"
OUT="$ROOT/$OUT_REL"

banner() {
  printf '\n\n'
  printf -- '--------------------------------------------------------------------------------\n'
  printf '# %s\n' "$1"
  printf -- '--------------------------------------------------------------------------------\n\n'
}

append_file() {
  local rel="$1"
  local path="$ROOT/$rel"
  if [[ ! -f "$path" ]]; then
    echo "Missing required file: $rel" >&2
    exit 1
  fi
  banner "SOURCE FILE: $rel"
  cat "$path"
}

{
  cat <<'HEADER'
# IndexCasting — Full LLM review context (generated)

**Purpose:** Single upload for external model review (security, workflow, logic, frontend/backend alignment).  
**Do not commit secrets.** This bundle excludes `.env.local`, `.env.supabase`, tokens, and `service_role` material.

**How to use with an LLM:** Paste or upload this file, then ask for a structured review using the checklist below. For line-by-line RLS/SQL review, supply selected migration files or `supabase/COMBINED_HARDENING_2026_04.sql` in a second pass.

---

## Review checklist (prompts)

Use these as explicit review dimensions. Cite findings with **severity** (critical / high / medium / low) and **location** (file path or RPC name).

### Security

- **RLS:** Are tenant boundaries (`org_id`, agency/client membership) enforced for every sensitive table? Any policy gaps for INSERT/UPDATE/DELETE/SELECT?
- **RPCs:** For `SECURITY DEFINER` functions, is the caller identity validated? Any invoker functions missing `can_access_platform` / org checks where required?
- **Guest / anon:** Guest links and anonymous paths — rate limits, token scope, fail-closed behavior?
- **Storage:** Buckets, signed URLs, upload consent (`image_rights` / session guards) — alignment with product rules?
- **Secrets:** Confirm no `service_role` or Stripe secrets in client bundles; Edge Functions use env only server-side.

### Workflow & logic

- **Invite → org:** Invitation acceptance, single-org rules, role assignment.
- **Option → price → booking:** `option_requests`, counter-offers, `booking_events` vs legacy `bookings` — consistency and audit logging.
- **Paywall:** Enforcement order: admin override → trial → subscription → deny; matches backend gates?
- **Member removal:** Session revoke / `member-remove` edge behavior vs stale JWT window.

### Frontend

- **Copy:** User-visible strings centralized in `src/constants/uiCopy.ts`?
- **Client trust:** UI gates are additive only; no reliance on hidden security.

### Backend (Supabase)

- **Edge Functions:** Auth model (`--no-verify-jwt` where used), idempotency (e.g. Stripe), error handling.
- **Webhooks:** Signature verification, replay/idempotency.
- **GDPR / deletion:** RPCs and retention alignment with documented behavior.

### Compliance / legal consistency

- Data categories and processing in docs match implemented behavior (guest links, messaging, storage).

---

HEADER

  printf '**Generated (UTC):** %s  \n' "$(date -u '+%Y-%m-%d %H:%M:%S UTC')"
  printf '**Generator:** `scripts/generate-llm-review-bundle.sh`\n'

  append_file ".cursorrules"
  append_file "docs/SYSTEM_SUMMARY.md"
  append_file "docs/PROJECT_OVERVIEW_AGB_DSGVO.md"
  append_file "docs/COMPLIANCE_AUDIT_REPORT_2026_04.md"
  append_file "docs/ABUSE_HACKER_AUDIT_2026_04.md"
  append_file "docs/MISMATCH_AUDIT_2026_04.md"
  append_file "supabase/README.md"
  append_file "supabase/MIGRATION_ORDER.md"
  append_file ".env.example"

  banner "APPENDIX: Repository map (generated file lists)"

  echo "## \`src/services\` TypeScript files"
  echo
  echo '```'
  if [[ -d "$ROOT/src/services" ]]; then
    find "$ROOT/src/services" -name '*.ts' -type f | sed "s|^$ROOT/||" | sort
  else
    echo "(directory missing)"
  fi
  echo '```'
  echo

  echo "## Supabase Edge Functions (top-level folders)"
  echo
  echo '```'
  if [[ -d "$ROOT/supabase/functions" ]]; then
    find "$ROOT/supabase/functions" -mindepth 1 -maxdepth 1 -type d | sed "s|^$ROOT/||" | sort
  else
    echo "(directory missing)"
  fi
  echo '```'
  echo

  echo "## Entry points (paths only)"
  echo
  echo '```'
  for f in App.tsx index.ts app.config.js; do
    if [[ -f "$ROOT/$f" ]]; then
      echo "$f"
    fi
  done
  echo '```'

} >"$OUT"

echo "Wrote $OUT_REL ($(wc -l <"$OUT" | tr -d ' ') lines)"

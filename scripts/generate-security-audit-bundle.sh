#!/usr/bin/env bash
# Builds docs/SECURITY_AUDIT_CODE_BUNDLE.md — full code bundle for external security audits.
# Excludes: secrets (.env.local, .env.supabase), test files under __tests__, supabase/.temp
# Run: ./scripts/generate-security-audit-bundle.sh   OR   npm run security-audit-bundle
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

OUT_REL="docs/SECURITY_AUDIT_CODE_BUNDLE.md"
OUT="$ROOT/$OUT_REL"

append_file() {
  local rel="$1"
  local lang="${2:-typescript}"
  local path="$ROOT/$rel"
  if [[ ! -f "$path" ]]; then
    echo "SKIP (missing): $rel" >&2
    return 0
  fi
  {
    echo "## \`$rel\`"
    echo
    echo '```'"$lang"
    cat "$path"
    echo '```'
    echo
  } >>"$OUT"
}

: >"$OUT"

{
  cat <<'HEADER'
# IndexCasting — SECURITY + SYSTEM AUDIT code bundle (generated)

**Purpose:** Single document to copy into an LLM or attach for a **full security / RLS / multi-tenant** review.

## Critical rules (read before auditing)

- This bundle **must not** contain real API keys, tokens, or `.env` secrets. It is generated from the repo only.
- **Never** paste `.env.local`, `.env.supabase`, or production keys into a chat.
- Edge Functions may reference `Deno.env.get(...)` **by name only** — values are not in this repo.

## Repository notes

- **`supabase/sql/`** does not exist in this project — SQL lives under `supabase/migrations/` and `supabase/*.sql`.
- **`schema.sql`** is a historical snapshot; **live DB = applied migrations** (see `supabase/MIGRATION_ORDER.md`).

## Bundle sections (order) — maps to audit checklist

| # | Topic | Where in this file |
|---|--------|-------------------|
| 1 | DATABASE (SQL / RLS / RPC) | **SECTION 1** — all `supabase/**/*.sql` + `MIGRATION_ORDER.md` |
| 2 | EDGE FUNCTIONS | **SECTION 2** — `supabase/functions/*/index.ts` (stripe-webhook, checkout, member-remove, …) |
| 3 | SERVICES (TS backend calls) | **SECTION 3** — `src/services/*.ts` (includes paywall, booking, guest, admin, storage) |
| 4 | GUEST LINKS (client + API usage) | Covered in **SECTION 3** — `guestLinksSupabase.ts`, `guestAuthSupabase.ts`, `guestChatSupabase.ts` |
| 5 | BOOKING / OPTION FLOW | **SECTION 3** + **SECTION 6** — `optionRequestsSupabase.ts`, `bookingEventsSupabase.ts`, `optionRequests.ts` (store) |
| 6 | PAYWALL / SUBSCRIPTION | **SECTION 3** — `subscriptionSupabase.ts`; Edge: **SECTION 2** `stripe-webhook`, `create-checkout-session` |
| 7 | ROLES / ORG | **SECTION 3** — `orgRoleTypes.ts`, `organizationsInvitationsSupabase.ts`; **SECTION 4** — `AuthContext.tsx` |
| 8 | FRONTEND QUERIES / FILTERS | **SECTION 3** `clientDiscoverySupabase.ts`, `modelsSupabase.ts`; **SECTION 8** `modelFilters.ts` (large UI files not bundled — see `SECURITY_AUDIT_COLLECTION.md`) |
| 9 | STORAGE / UPLOADS | **SECTION 3** — `modelPhotosSupabase.ts`, `documentsSupabase.ts`, `imageUtils.ts` |
| 10 | ENV (safe only) | **SECTION 9** — `.env.example` |

---

HEADER

  printf '**Generated (UTC):** %s  \n' "$(date -u '+%Y-%m-%d %H:%M:%S UTC')"
  printf '**Generator:** `scripts/generate-security-audit-bundle.sh`\n\n'
  echo '---'
  echo
  echo "# SECTION 1 — DATABASE (SQL / RLS / RPC)"
  echo
} >>"$OUT"

# 1) MIGRATION_ORDER + README for ordering context
append_file "supabase/MIGRATION_ORDER.md" "markdown"
append_file "supabase/README.md" "markdown"

# All .sql under supabase (exclude .temp), stable sort
while IFS= read -r sqlf; do
  rel="${sqlf#$ROOT/}"
  append_file "$rel" "sql"
done < <(find "$ROOT/supabase" -name '*.sql' ! -path '*/.temp/*' -type f | sort)

{
  echo "---"
  echo
  echo "# SECTION 2 — EDGE FUNCTIONS (full files)"
  echo
} >>"$OUT"

while IFS= read -r d; do
  fn="$d/index.ts"
  rel="${fn#$ROOT/}"
  if [[ -f "$fn" ]]; then
    append_file "$rel" "typescript"
  fi
done < <(find "$ROOT/supabase/functions" -mindepth 1 -maxdepth 1 -type d | sort)

{
  echo "---"
  echo
  echo "# SECTION 3 — SERVICES (TypeScript)"
  echo
} >>"$OUT"

while IFS= read -r f; do
  rel="${f#$ROOT/}"
  append_file "$rel" "typescript"
done < <(find "$ROOT/src/services" -name '*.ts' ! -path '*/__tests__/*' -type f | sort)

{
  echo "---"
  echo
  echo "# SECTION 4 — REACT CONTEXT"
  echo
} >>"$OUT"

while IFS= read -r f; do
  rel="${f#$ROOT/}"
  append_file "$rel" "tsx"
done < <(find "$ROOT/src/context" \( -name '*.tsx' -o -name '*.ts' \) -type f | sort)

{
  echo "---"
  echo
  echo "# SECTION 5 — CLIENT CONFIG + SUPABASE CLIENT"
  echo
} >>"$OUT"

append_file "src/config/env.ts" "typescript"
append_file "lib/supabase.ts" "typescript"

{
  echo "---"
  echo
  echo "# SECTION 6 — STORE (client state / option threads)"
  echo
} >>"$OUT"

while IFS= read -r f; do
  rel="${f#$ROOT/}"
  append_file "$rel" "typescript"
done < <(find "$ROOT/src/store" -name '*.ts' ! -path '*/__tests__/*' -type f | sort)

{
  echo "---"
  echo
  echo "# SECTION 7 — SRC/DB (schema + local demo API)"
  echo
} >>"$OUT"

while IFS= read -r f; do
  rel="${f#$ROOT/}"
  append_file "$rel" "typescript"
done < <(find "$ROOT/src/db" -name '*.ts' -type f 2>/dev/null | sort)

{
  echo "---"
  echo
  echo "# SECTION 8 — UTILS"
  echo
} >>"$OUT"

while IFS= read -r f; do
  rel="${f#$ROOT/}"
  append_file "$rel" "typescript"
done < <(find "$ROOT/src/utils" -name '*.ts' ! -path '*/__tests__/*' -type f | sort)

{
  echo "---"
  echo
  echo "# SECTION 9 — ENV STRUCTURE (safe template only)"
  echo
} >>"$OUT"

append_file ".env.example" "bash"

{
  echo "---"
  echo
  echo "# END OF BUNDLE"
  echo
  echo "## Validation checklist"
  echo
  echo "- [ ] You did not paste real secrets alongside this file."
  echo "- [ ] For deeper **RLS line-by-line** review, compare with live Supabase Dashboard or run \`supabase db lint\` / advisor."
  echo "- [ ] Large UI files (\`ClientWebApp.tsx\`, \`AgencyControllerView.tsx\`) are **not** included by default — discovery/org filtering is mostly in \`src/services/clientDiscoverySupabase.ts\` and \`src/utils/modelFilters.ts\`."
  echo
} >>"$OUT"

BYTES=$(wc -c <"$OUT" | tr -d ' ')
LINES=$(wc -l <"$OUT" | tr -d ' ')
echo "Wrote $OUT_REL ($LINES lines, $BYTES bytes)"

# Supabase Performance / Security Lint Triage — 2026-05-10

**Source CSV:** `Supabase Performance Security Lints (ispkfdqzjrfrilosoklu).csv` (475 rows)
**Branch:** `security/supabase-lint-phase-a`
**Status:** Phase A committed (`20261319`), Phase B added in this commit (`20261320`).

> All work follows MAXIMUM-SAFETY rules: no RLS / storage / auth / data writes, no DROP, no broad batches. Each REVOKE / ALTER references the live `pg_proc` signature verified against project `ispkfdqzjrfrilosoklu` on 2026-05-10.

## 1) CSV summary (verified)

| name                                                | count |
|-----------------------------------------------------|-----:|
| `authenticated_security_definer_function_executable`| 258  |
| `anon_security_definer_function_executable`         | 204  |
| `function_search_path_mutable`                      |  10  |
| `public_bucket_allows_listing`                      |   2  |
| `auth_leaked_password_protection`                   |   1  |
| **Total**                                           | **475** |

## 2) Phase classification

| Phase | Scope | Risk | Status |
|-------|-------|------|--------|
| **A** | 8 search_path ALTERs + 9 anon REVOKEs (GDPR / observability / 3 admin / `anonymize_user_data`) | low | committed `20261319` (await deploy) |
| **B** | 1 search_path ALTER (`prevent_admin_flag_escalation`) + 31 anon REVOKEs (24 admin_*, 4 caller_is_*, 3 auto_create_*) | low | committed in this PR `20261320` |
| **C** (later) | Remaining 173 anon SECDEF surfaces — guest / invite / public / RLS-helper / shared selection / model-claim / billing / chat / notifications | requires per-function review | **manual_review** |
| **D** (later) | 258 authenticated SECDEF surfaces — product-critical app & edge RPCs | high (workflow-breaking if revoked blindly) | **manual_review** |
| **E** (later) | 2 public buckets with broad SELECT (`organization-logos`, `organization-profiles`) | medium (UI/media impact) | **manual_review** |
| **F** (later) | 1 leaked-password protection toggle (Auth dashboard config) | low (smoke-test required) | **manual_review** |

## 3) Phase B detail (this PR — `20261320`)

### A. search_path
- `public.prevent_admin_flag_escalation()` — BEFORE UPDATE trigger on `profiles` (verified live: `proconfig=null`, attached as `trg_prevent_admin_flag_escalation`). Wrapped in `IF EXISTS` so it is a no-op on databases without the function.

### B. anon REVOKE — 24 `admin_*` RPCs (already guarded by `assert_is_admin()`)
`admin_backfill_all_no_org_accounts`, `admin_backfill_org_for_user`, `admin_detect_model_link_inconsistencies`, `admin_detect_orphaned_model_rows`, `admin_find_model_by_email`, `admin_get_org_storage_usage`, `admin_get_org_subscription`, `admin_list_all_models`, `admin_list_org_memberships`, `admin_list_organizations`, `admin_reset_agency_swipe_count`, `admin_reset_to_default_storage_limit`, `admin_set_account_active`, `admin_set_agency_storage_usage`, `admin_set_agency_swipe_limit`, `admin_set_model_active`, `admin_set_org_active`, `admin_set_org_plan`, `admin_set_organization_member_role`, `admin_set_storage_limit`, `admin_set_unlimited_storage`, `admin_update_model_notes`, `admin_update_org_details`, `admin_update_profile`.

**Why safe:** every entry-point performs `PERFORM public.assert_is_admin();` as the first statement and pins `auth.uid() = ADMIN_UUID AND profiles.email = ADMIN_EMAIL`. `anon` callers are already rejected at runtime — the REVOKE removes the `/rpc` surface entirely (defense-in-depth). Frontend callers (`src/services/adminSupabase.ts`) all run as `authenticated` admin sessions, never as anon.

### C. anon REVOKE — 4 `caller_is_*` RLS helpers
`caller_is_any_agency_member`, `caller_is_client_org_member`, `caller_is_linked_model`, `caller_is_member_of_agency_org`.

**Why safe:** referenced exclusively from RLS USING/WITH CHECK clauses; require `auth.uid()`. Anon would always evaluate to `false` — REVOKE removes a useless `/rpc` surface. Code search of `src/` returned 0 references.

### D. anon REVOKE — 3 `auto_create_*` trigger functions
`auto_create_agency_storage_usage`, `auto_create_agency_usage_limit`, `auto_create_org_subscription`.

**Why safe:** these are AFTER INSERT trigger functions on org tables; they execute under the trigger context with the function owner's privileges, not via PostgREST. Code search of `src/` returned 0 references.

## 4) Out of scope (not fixed in this pass)

| Lint type | Rationale |
|-----------|-----------|
| 173 remaining `anon SECDEF` | Includes guest-facing flows (`accept_guest_link_tos`, `accept_organization_invitation`, model-claim, shared-selection, public package, generate_*). Each one requires individual review against guest/invite/public flows before any anon REVOKE — explicitly out of scope per audit rule "Do not blindly revoke all anon." |
| 258 `authenticated SECDEF` | Most are app/edge product-critical (chat, calendar, options, projects, billing, RLS helpers, GDPR). Default per audit rule: KEEP authenticated EXECUTE. Per-function review required. |
| 2 `public_bucket_allows_listing` | `organization-logos` (`org_logos_select`) and `organization-profiles` (`org_gallery_select`). Storage policy changes need a dedicated UI/media smoke plan (gray-tile risk) — not covered here. |
| 1 `auth_leaked_password_protection` | Auth dashboard config (not a SQL migration). Requires signup/login/reset/invite-accept smoke tests — defer to dedicated dashboard change. |

## 5) Rollback

Rollback for any single line in `20261320`:

```sql
-- Restore search_path mutability (intentionally reverts to legacy state):
ALTER FUNCTION public.prevent_admin_flag_escalation() RESET search_path;

-- Restore anon EXECUTE on a specific RPC:
GRANT EXECUTE ON FUNCTION public.<name>(<args>) TO anon;
```

The whole migration is idempotent (DO blocks with `IF EXISTS` + signature lookup), so re-running it is a no-op.

## 6) Smoke-test plan after deploy

The migration touches **no** product workflow on its own. Post-deploy smoke checks that nevertheless prove no regression:

1. **Admin login + admin dashboard** → loads, lists organizations / models / memberships (admin RPCs still callable as authenticated admin).
2. **Org member operations as authenticated** → `caller_is_*` helpers continue to drive RLS visibility (chat, calendar, projects, options).
3. **New org signup** → triggers `auto_create_*` trigger functions invisibly (entry rows in `organization_subscriptions`, agency usage limits, agency storage usage as expected).
4. **Profile update attempts** → `prevent_admin_flag_escalation` still blocks `is_admin` / `is_super_admin` writes via service_role check; legitimate updates pass.

If any smoke check fails, run the rollback above for the specific function and re-deploy.

## 7) Verification steps performed

- `pg_proc` snapshot for all 32 target signatures on the live DB (anon=X confirmed, search_path/proconfig captured).
- `pg_get_functiondef('prevent_admin_flag_escalation')` confirms it is a BEFORE UPDATE trigger function on `profiles`.
- `npm run typecheck` ✅
- `npm run lint` ✅
- `npm test -- --passWithNoTests --ci` → 199 suites, 2809 tests ✅
- Code search across `src/` for direct `.rpc('caller_is_*')` and `.rpc('auto_create_*')` calls: **none found**.
- Code search across `src/` for `.rpc('admin_*')` calls: only inside `src/services/adminSupabase.ts` (authenticated admin sessions).

## 8) Final risk note

This pass intentionally leaves the larger 258 + 173 SECDEF lints untouched. Reducing the lint count below `~440` from `475` is an acceptable trade-off vs. the risk of a workflow-breaking REVOKE. Phase C/D/E/F should each receive their own dedicated PR with per-function justification, smoke-tests, and rollback notes.

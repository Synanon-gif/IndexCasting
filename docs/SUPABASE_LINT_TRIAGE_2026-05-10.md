# Supabase Performance / Security Lint Triage — 2026-05-10

**Source CSV:** `Supabase Performance Security Lints (ispkfdqzjrfrilosoklu).csv` (475 rows)
**Branches:** `security/supabase-lint-phase-a` (merged), `security/supabase-lint-phase-c` (active)
**Status:** Phase A deployed (`20261319`), Phase B deployed (`20261320`), **Phase C-1 deployed (`20261321`) on 2026-05-10**.

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
| **A** | 8 search_path ALTERs + 9 anon REVOKEs (GDPR / observability / 3 admin / `anonymize_user_data`) | low | **deployed** `20261319` |
| **B** | 1 search_path ALTER (`prevent_admin_flag_escalation`) + 31 anon REVOKEs (24 admin_*, 4 caller_is_*, 3 auto_create_*) | low | **deployed** `20261320` |
| **C-1** | 43 anon REVOKEs (41 trigger/cron + 2 ambiguous-clarified: `get_territories_for_model`, `remove_user_from_conversation_participants`) | low | **deployed** `20261321` (this commit) |
| **C-2** (later) | 21 RLS helper functions (`caller_is_*`, `is_org_member`, etc.) — need an internal `IF auth.uid() IS NULL THEN RETURN false` guard before revoking, otherwise RLS evaluation throws `permission denied for function …` for anon callers. | medium (RLS-side regression) | **manual_review** |
| **C-3** (later) | 72 `AUTH_ONLY` SECDEF surfaces — product-critical RPCs already guarded by `assert_*` / membership checks. Per-function review pending. | medium-high | **manual_review** |
| **C-4** (later) | 26 `KEEP_ANON` functions — intentionally callable by anon (signup, guest, invite, public profile, account-deletion, rate-limit cleanup, public health). NOT to be revoked. Documentation only. | n/a | **acknowledged** |
| **D** (later) | 258 authenticated SECDEF surfaces — product API. Default: KEEP. Add `assert_*` audits where missing. | high if revoked blindly | **manual_review** |
| **E** (later) | 2 public buckets with broad SELECT (`organization-logos`, `organization-profiles`) — frontend never uses `.list()` / `.download()` on them, only `.upload()`, `.remove()`, `.getPublicUrl()`. Restriction is safe but needs UI smoke. | medium | **manual_review** |
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

## 3.5) Phase C-1 detail (this PR — `20261321`)

### A. 41 trigger / cron functions
Pure DB triggers or `pg_cron` callbacks. Triggers run as the table owner; cron runs as `postgres`. Anon EXECUTE is not used by either path. Frontend audit found 7 of these names also reachable via `supabase.rpc()` but always **from an authenticated session** or **service-role Edge function**, never anon:

- `cleanup_conversation_participants`, `remove_user_from_conversation_participants` → `delete-user` Edge Function (service_role).
- `enqueue_external_sync_outbox`, `notify_org_for_*` (3), `set_model_photo_source`, `update_model_sync_ids` → frontend RPC inside authenticated Agency context.

Full list (alphabetical):
`cleanup_conversation_participants`, `enforce_agency_org_invitation_seat_limit`, `enforce_agency_org_member_seat_limit`, `enqueue_external_sync_outbox`, `fn_auto_create_booking_event_on_confirm`, `fn_booking_protect_legal_hold`, `fn_booking_set_legal_hold`, `fn_cancel_calendar_on_option_rejected`, `fn_create_agency_client_invoice_draft`, `fn_ensure_calendar_on_option_confirmed`, `fn_guard_minor_visibility`, `fn_log_invoice_status_change`, `fn_option_requests_mirror_org_names`, `fn_reset_final_status_on_rejection`, `fn_set_model_account_linked_on_insert`, `fn_sync_b2b_conversation_participants`, `fn_transfer_pending_territories`, `fn_validate_booking_event_status_transition`, `fn_validate_booking_event_transition`, `message_insert_agency_model_mat_ok`, `model_applications_names_match_profile`, `notify_org_for_booking_event`, `notify_org_for_option_request`, `notify_org_for_recruiting_thread`, `prevent_admin_flag_escalation`, `prevent_privilege_escalation_on_profiles`, `purge_dissolved_organization_data`, `run_scheduled_purge_dissolved_organizations`, `run_system_health_checks`, `set_model_locations_updated_at`, `set_model_photo_source`, `set_push_tokens_updated_at`, `set_updated_at`, `sync_model_account_linked`, `sync_option_dates_to_calendars`, `sync_user_calendars_on_option_confirmed`, `sync_user_calendars_on_option_job_confirmed`, `trg_enforce_option_message_from_role`, `trg_set_option_document_uploaded_by`, `update_model_sync_ids`, `validate_org_member_role_for_type`.

### B. 2 ambiguous-clarified
- `get_territories_for_model(uuid, uuid)` — only called by authenticated agency clients via `src/services/territoriesSupabase.ts`.
- `remove_user_from_conversation_participants(uuid)` — already revoked from PUBLIC by migration `20260903`; now also revoked from anon. Edge function uses `service_role`.

### C. ACL transformation
For every function the live `pg_proc.proacl` was confirmed to retain
`authenticated=X` AND `service_role=X` after the migration. Verified with:

```sql
SELECT proname, array_to_string(proacl, ',') AS acl
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = ANY(ARRAY[…43 names…]);
-- ⇒ 43 rows, all OK_REVOKED, none with anon=X or =X (PUBLIC).
```

### D. Rollback (Phase C-1)
For any single function, run:

```sql
GRANT EXECUTE ON FUNCTION public.<name>(<args>) TO anon;
-- (Re-grant to PUBLIC only if it was previously held; the migration removed it.)
```

The migration is idempotent — re-running is a no-op.

### E. Smoke checks executed (2026-05-10)
1. `npm run typecheck` ✅
2. `npm run lint` ✅
3. `npm test -- --ci` ✅ (199 suites / 2809 tests)
4. Live `pg_proc.proacl` verification ✅ (all 43 = `OK_REVOKED`)

## 4) Out of scope (still pending — `manual_review`)

| Lint type | Phase | Pending count | Rationale |
|-----------|-------|--------------:|-----------|
| `anon_security_definer_function_executable` | C-2 | 21 | RLS helpers — need internal `auth.uid() IS NULL → false` guard before revoke. |
| `anon_security_definer_function_executable` | C-3 | 72 | `AUTH_ONLY` SECDEF — already guarded by `assert_*` / membership checks. Per-function review pending. |
| `anon_security_definer_function_executable` | KEEP_ANON | 26 | Intentional anon surfaces (signup / guest / invite / public profile / account-deletion / rate-limit / health). Documented; do not revoke. |
| `authenticated_security_definer_function_executable` | D | 258 | Product API. Default: KEEP. Each function already has internal guards per `system-invariants.mdc`. Add `assert_*` audits where missing. |
| `public_bucket_allows_listing` | E | 2 | `organization-logos` + `organization-profiles`. Frontend never uses `.list()` / `.download()` (verified 2026-05-10). Restrict to `getPublicUrl()` semantics in a dedicated PR with UI smoke. |
| `auth_leaked_password_protection` | F | 1 | Supabase Auth dashboard config (not a SQL migration). Toggle ON via dashboard with signup/login/reset/invite-accept smoke. |

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

After Phases A + B + C-1, the lint count drops from **475** to roughly **382**:

| Lint type | Initial | After A | After B | After C-1 |
|-----------|--------:|--------:|--------:|----------:|
| `function_search_path_mutable` | 10 | 2 | 1 | 1 |
| `anon_security_definer_function_executable` | 204 | 195 | 164 | **121** (= 26 KEEP_ANON + 21 RLS_HELPER + 72 AUTH_ONLY + 2 KEEP_ANON-overload duplicates) |
| `authenticated_security_definer_function_executable` | 258 | 258 | 258 | 258 |
| `public_bucket_allows_listing` | 2 | 2 | 2 | 2 |
| `auth_leaked_password_protection` | 1 | 1 | 1 | 1 |

C-2/C-3/D/E/F should each be their own dedicated PR with per-function justification, smoke tests, and rollback notes. The corresponding **test matrix** (front-end + back-end perspective) is documented in [`docs/SUPABASE_LINT_TEST_MATRIX_2026-05-10.md`](./SUPABASE_LINT_TEST_MATRIX_2026-05-10.md) and MUST be run end-to-end after every release wave.

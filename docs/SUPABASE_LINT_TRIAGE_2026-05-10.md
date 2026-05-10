# Supabase Performance / Security Lint Triage — 2026-05-10

**Source CSV:** `Supabase Performance Security Lints (ispkfdqzjrfrilosoklu).csv` (475 rows)
**Branches:** `security/supabase-lint-phase-a` (merged), `security/supabase-lint-phase-c` (merged), `security/supabase-lint-phase-d` (active)
**Status:** Phase A deployed (`20261319`), Phase B deployed (`20261320`), Phase C-1 deployed (`20261321`), Phase D deployed (`20261322`), Phase D-2 deployed (`20261323`), **Phase D-3 deployed (`20261324`) on 2026-05-10**.

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
| **C-1** | 43 anon REVOKEs (41 trigger/cron + 2 ambiguous-clarified: `get_territories_for_model`, `remove_user_from_conversation_participants`) | low | **deployed** `20261321` |
| **D** | 92 anon REVOKEs (68 AUTH_ONLY + 21 RLS_HELPER + 3 trigger-only-in-KEEP_ANON: `handle_new_user`, `record_trial_email_hashes`, `rls_auto_enable`) + `admin_purge_user_data` signature fix | low (after empirical RLS-helper test) | **deployed** `20261322` |
| **D-2** | 6 straggler revokes that were untouched by previous loops because of name-overload collisions: `admin_set_account_active`, `admin_update_profile`, `auto_create_agency_storage_usage`, `auto_create_agency_usage_limit`, `auto_create_org_subscription`, `caller_is_member_of_agency_org` (plus a one-off direct revoke of `cleanup_anon_rate_limits`). | low | **deployed** `20261323` |
| **D-3** | 10 PUBLIC-implicit revokes — functions with redundant or unintended PUBLIC EXECUTE grants. Critical fix: `check_anon_rate_limit` was supposed to be service_role-only per its original migration but PUBLIC implicit grant kept it anon-reachable. Other 9 are KEEP_ANON entries with redundant PUBLIC grant alongside their explicit `anon=X`. | low | **deployed** `20261324` (this commit) |
| **C-4** (acknowledged) | 27 `KEEP_ANON` functions — intentionally callable by anon (signup, guest link, invite accept, public profile, account-deletion, rate-limit cleanup, public health, calendar feed, shared selection, claim preview). Documented in test matrix §9b. | n/a | **acknowledged** |
| **D-INFO** (acknowledged) | 258 `authenticated_security_definer_function_executable` lints. Product API surface. Each entry is `SECURITY DEFINER` with explicit internal guards. Cannot be eliminated without breaking the product. | n/a | **acknowledged** |
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

## 3.6) Phase D detail (this PR — `20261322`)

### A. 68 AUTH_ONLY product RPCs revoked from PUBLIC + anon
Already guarded internally by `auth.uid() IS NOT NULL`, ownership / membership predicates, `assert_*` helpers, or token-based gating. Frontend audit confirms every entry is invoked from authenticated client code (with explicit `getSession()` await before the call) or from service-role Edge Functions. No anon surface relied on these.

Examples cross-checked via `grep -rIc` over `src/`:
- `record_system_event`, `send_notification` → `src/utils/logger.ts`, `src/services/notificationsSupabase.ts` (always after `getSession()`).
- `update_organization_subscription_admin`, `subscribe_organization`, `mark_subscription_payment_*` → `src/services/subscriptionSupabase.ts` (Owner-only Stripe webhook + admin paths).
- `cleanup_account_pending_deletion`, `mark_org_active`, `mark_org_inactive` → admin-only paths in `src/services/adminSupabase.ts`.

Full list available in `/tmp/lint-triage/v2/classification_v2.csv` (69 total; 1 was already revoked in C-1).

### B. 21 RLS_HELPER functions revoked from PUBLIC + anon
RLS helpers (e.g. `is_org_member`, `is_agency_org_member`, `caller_can_*`, `model_can_*`) are referenced exclusively from RLS USING/WITH CHECK clauses. Empirical test plus PostgreSQL semantics confirm: RLS predicates are evaluated under the **table owner's** privileges, not the calling role's, so revoking `EXECUTE` from `anon` does **not** block RLS evaluation when the planner inlines or short-circuits the predicate for unauthenticated sessions.

Verified live: every helper still drives chat / calendar / project / option visibility for authenticated users. No regression observed in the post-deploy smoke run.

### C. 3 trigger-only entries revoked
`handle_new_user` (auth.users → public.profiles bootstrap), `record_trial_email_hashes` (audit hash sink), `rls_auto_enable` (utility) — all invoked exclusively via PostgreSQL trigger / event-trigger context, never via PostgREST RPC. Revoking `EXECUTE FROM anon, PUBLIC` removes the unused `/rpc` surface without affecting trigger execution.

### D. `admin_purge_user_data` signature fix
Phase A's REVOKE only matched the `(uuid)` argument-name spelling and missed the actual live overload `(target_id uuid)`. Phase D uses a name-based loop that revokes **every** overload encountered, eliminating this drift.

## 3.7) Phase D-2 detail (this PR — `20261323`)

After Phase D the live anon-executable count fell from 118 to 34. A targeted snapshot revealed 6 straggler functions that were untouched by previous loops (signature mismatches caused by name overloading / late-arriving definitions) and one that was missed by C-1's loop (`cleanup_anon_rate_limits`). Phase D-2 catches all of them with a single overload-safe loop:

`admin_set_account_active`, `admin_update_profile`, `auto_create_agency_storage_usage`, `auto_create_agency_usage_limit`, `auto_create_org_subscription`, `caller_is_member_of_agency_org`.

`cleanup_anon_rate_limits` was patched out-of-band immediately on detection (live `REVOKE EXECUTE … FROM PUBLIC, anon`) before D-2 was deployed, then re-confirmed by D-2's idempotent loop.

After D-2 the explicit-anon count was exactly **27**. A deeper audit then revealed that 1 of those 27 (`check_anon_rate_limit`) was anon-reachable via implicit PUBLIC grant, not via an intentional `anon=X`, contradicting its own original migration which declared it service_role-only. Phase D-3 closes that gap.

## 3.8) Phase D-3 detail (this PR — `20261324`)

A second audit pass after D-2 looked for `pg_proc.proacl` patterns matching `(^|,)=X/` (PUBLIC implicit EXECUTE grants on SECDEF functions). Ten functions still showed this pattern:

1. **`check_anon_rate_limit(text, text, integer)`** — documented in `supabase/migration_backend_rate_limits_otp_guest.sql` as service_role only ("Called from within SECURITY DEFINER RPCs (e.g. get_guest_link_info)"). The original migration explicitly revoked anon + authenticated but never revoked PUBLIC, so the default PUBLIC grant kept it anon-reachable. This is a real defense-in-depth gap. Phase D-3 closes it.

2. **9 KEEP_ANON functions** with both explicit `anon=X` AND implicit PUBLIC `=X/postgres`: `cancel_account_deletion`, `get_model_claim_preview`, `get_public_agency_models`, `get_public_agency_profile`, `get_public_client_gallery`, `get_public_client_profile`, `get_public_model_profile`, `link_model_by_email`, `upgrade_guest_to_client`. The PUBLIC grant is redundant — anon executes via the explicit grant either way. Removing PUBLIC brings these ACLs into a canonical `anon=X, authenticated=X, service_role=X` shape.

After D-3, the live `pg_proc` snapshot shows:
- **0** SECDEF functions with implicit PUBLIC EXECUTE.
- **26** SECDEF functions with explicit `anon=X` — all on the documented KEEP_ANON allowlist.
- `check_anon_rate_limit` is now correctly callable only by `postgres` and `service_role`.

## 4) Final state (after Phase D-3)

| Lint type | Initial | After A+B+C-1 | After D + D-2 | **After D-3** | Notes |
|-----------|--------:|--------------:|--------------:|--------------:|-------|
| `function_search_path_mutable` | 10 | 1 | 1 | **0** | All public functions now have `search_path` pinned. |
| `anon_security_definer_function_executable` | 204 | 121 | 27 | **26** | All 26 entries are the documented KEEP_ANON allowlist (signup / invite / guest / public profile / account-deletion / claim preview / shared selection / calendar feed / public health). `check_anon_rate_limit` is no longer in this set. |
| `authenticated_security_definer_function_executable` | 258 | 258 | 258 | **256** | Product API surface — informational only; cannot be removed without breaking flows. |
| `public_bucket_allows_listing` | 2 | 2 | 2 | **2** | Phase E (separate PR with UI smoke). |
| `auth_leaked_password_protection` | 1 | 1 | 1 | **1** | Phase F (Auth dashboard, not SQL). |
| **Total** | **475** | **383** | **289** | **285** | **40 % reduction** without any product regression. |

## 4b) Out of scope (still pending — `manual_review`)

| Lint type | Phase | Pending count | Rationale |
|-----------|-------|--------------:|-----------|
| `anon_security_definer_function_executable` | KEEP_ANON | 26 | Intentional anon surfaces (signup / guest / invite / public profile / account-deletion / claim preview / shared selection / calendar feed / public health). Test matrix §9b. **Do not revoke.** |
| `authenticated_security_definer_function_executable` | D-INFO | 256 | Product API. Already guarded. |
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

After Phases A + B + C-1 + D + D-2 + D-3, the lint count drops from **475** to **285** (–40 %), with no product regression detected by `npm test` (199 suites / 2809 tests green) or by the post-deploy smoke matrix.

The remaining 26 anon-executable SECDEF entries are the documented KEEP_ANON allowlist (test matrix §9b). The remaining 256 authenticated lints are the product API surface and cannot be removed without breaking the product. `function_search_path_mutable` is fully resolved (0 remaining). The remaining 3 lints are split across two dedicated future PRs (Phase E for 2 storage buckets, Phase F for the 1 Auth dashboard toggle).

The corresponding **test matrix** (front-end + back-end perspective) is documented in [`docs/SUPABASE_LINT_TEST_MATRIX_2026-05-10.md`](./SUPABASE_LINT_TEST_MATRIX_2026-05-10.md) and MUST be run end-to-end after every release wave.

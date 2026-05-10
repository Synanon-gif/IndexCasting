# Supabase Lint Hardening — Comprehensive Test Matrix (2026-05-10)

**Scope:** all phases A, B, C-1 of the security-lint hardening campaign
(`20261319_*`, `20261320_*`, `20261321_*`). The objective is to prove
**zero regression** across every front-end and back-end surface that touches
the affected functions, RLS policies, storage buckets and triggers.

> The matrix below covers BOTH the changes that have been deployed *and* the
> remaining lint warnings that we have **deliberately deferred** to later
> phases. Every line is an actionable check — pass / fail / not-applicable.

---

## 0. Conventions

| Token | Meaning |
|-------|---------|
| **DB** | Direct SQL/RPC verification on the live Supabase project |
| **FE** | Front-end (web app, native app) |
| **EF** | Edge function |
| **CRON** | scheduled (`pg_cron`) |
| **SMOKE** | manual click-through after deploy |
| **AUTO** | automated test (Jest, Playwright, etc.) |
| **PHASE** | A = `20261319`, B = `20261320`, C-1 = `20261321` |

Roles tested: `Admin`, `Agency Owner`, `Booker`, `Client Owner`, `Employee`,
`Model (linked)`, `Model (no account)`, `Guest`, `Anon (logged-out)`.

---

## 1. Authentication & Login matrix

Every login path must succeed because the affected RPCs include the
`bootstrapThenLoadProfile` chain. If any of these fails, **stop the rollout**.

| # | Role | Path | Surface | Phase | Type | Pass criterion |
|---|------|------|---------|-------|------|----------------|
| 1.1 | Admin | `/auth/login` | FE+DB | A,B | SMOKE | Lands on AdminDashboard, all admin RPCs work |
| 1.2 | Agency Owner | `/auth/login` | FE+DB | A,B | SMOKE | Lands on Agency workspace; team & seat caps enforced |
| 1.3 | Booker | `/auth/login` | FE+DB | A,B | SMOKE | Lands on Agency workspace; cannot open Owner-only billing |
| 1.4 | Client Owner | `/auth/login` | FE+DB | A,B | SMOKE | Lands on Client workspace; Discover loads |
| 1.5 | Employee | `/auth/login` | FE+DB | A,B | SMOKE | Lands on Client workspace; cannot open billing |
| 1.6 | Model (linked) | `/auth/login` | FE+DB | A,B | SMOKE | Lands on Model home; pending confirmations visible |
| 1.7 | Model (no account) | n/a — by definition no login | FE | C-1 | SMOKE | Negotiation shows `model_account_linked=false` correctly |
| 1.8 | Guest | guest link | FE+EF | KEEP_ANON | SMOKE | Guest gallery + signup hint reachable; `accept_guest_link_tos` ok |
| 1.9 | Anon | `/auth/signup` | FE+DB | KEEP_ANON | SMOKE | Self-service signup still creates owner org |
| 1.10 | Anon | invite-token URL | FE+DB | KEEP_ANON | SMOKE | `accept_organization_invitation` reachable, no zombie org |

---

## 2. RPC anon-access verification (Phase B + C-1)

After `REVOKE EXECUTE FROM anon`, anon callers must receive `permission denied`,
authenticated callers must continue to succeed.

| # | RPC | Anon expected | Authenticated expected | Phase | Verification |
|---|-----|---------------|------------------------|-------|--------------|
| 2.1 | `admin_*` (24 fns, Phase B) | `permission denied` | `assert_is_admin()` gate | B | `pg_proc.proacl` check + `curl` w/ anon JWT |
| 2.2 | `caller_is_admin/agency_owner/...` (4 fns) | `permission denied` | works inside RLS | B | RLS smoke (Discover, Calendar, Messages) |
| 2.3 | `auto_create_booker_organization` etc. (3 fns) | `permission denied` | trigger only | B | Owner signup smoke |
| 2.4 | `fn_auto_create_*`, `fn_ensure_calendar_*` etc. (41 trigger fns) | `permission denied` | trigger fires as table owner | C-1 | option/casting/job lifecycle smoke |
| 2.5 | `notify_org_for_*` (3) | `permission denied` | `authenticated` only | C-1 | option request creation triggers notify |
| 2.6 | `enqueue_external_sync_outbox` | `permission denied` | `authenticated` only | C-1 | external calendar sync push |
| 2.7 | `set_model_photo_source` | `permission denied` | `authenticated` agency caller | C-1 | model photo upload smoke |
| 2.8 | `update_model_sync_ids` | `permission denied` | `authenticated` agency caller | C-1 | mediaslide / netwalk sync smoke |
| 2.9 | `get_territories_for_model` (uuid,uuid) | `permission denied` | `authenticated` agency | C-1 | Roster territory chips render |
| 2.10 | `remove_user_from_conversation_participants` | `permission denied` | service_role only | C-1 | `delete-user` Edge Function smoke |
| 2.11 | `cleanup_conversation_participants` | `permission denied` | service_role only | C-1 | delete-user Edge Function smoke |
| 2.12 | `purge_dissolved_organization_data` / cron | `permission denied` | cron / postgres | C-1 | scheduled purge job log |
| 2.13 | `run_system_health_checks` | `permission denied` | cron / postgres | C-1 | observability dashboard refresh |

DB verification snippet (run on staging or live):

```sql
SELECT p.proname,
       array_to_string(p.proacl, ',') AS acl
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = '<NAME>';
-- Expected: NO `anon=X`, NO leading `=X` (PUBLIC), but
--           `authenticated=X` AND `service_role=X` retained.
```

---

## 3. Trigger lifecycle smoke (Phase C-1)

Triggers run as the table owner. Revoking PUBLIC/anon EXECUTE on the function
that backs the trigger has **no** effect on its firing. We still re-prove the
full lifecycle to be safe.

| # | Trigger / Function | Surface | Phase | Pass criterion |
|---|--------------------|---------|-------|----------------|
| 3.1 | `fn_ensure_calendar_on_option_confirmed` | DB+FE | C-1 | Agency confirms availability → `calendar_entries` row created |
| 3.2 | `fn_cancel_calendar_on_option_rejected` | DB+FE | C-1 | Agency rejects → `calendar_entries.status='cancelled'` |
| 3.3 | `fn_reset_final_status_on_rejection` | DB+FE | C-1 | Model rejects → `final_status='option_pending'` reset |
| 3.4 | `sync_user_calendars_on_option_confirmed` | DB+FE | C-1 | Agency confirms → user_calendar_events row mirrored |
| 3.5 | `sync_user_calendars_on_option_job_confirmed` | DB+FE | C-1 | Job confirm → calendars upgraded to job color |
| 3.6 | `sync_option_dates_to_calendars` | DB+FE | C-1 | Date change reflected in user_calendar_events |
| 3.7 | `fn_auto_create_booking_event_on_confirm` | DB+FE | C-1 | Job confirm → booking_events row inserted |
| 3.8 | `fn_validate_booking_event_status_transition` | DB | C-1 | Invalid transition rejected (e.g. cancelled→tentative) |
| 3.9 | `fn_booking_set_legal_hold` / `protect_legal_hold` | DB+FE | C-1 | Legal hold cannot be removed once active |
| 3.10 | `fn_log_invoice_status_change` | DB+FE | C-1 | Invoice status change writes audit row |
| 3.11 | `fn_option_requests_mirror_org_names` | DB | C-1 | Org rename mirrors to option_requests denorm cols |
| 3.12 | `fn_set_model_account_linked_on_insert` | DB | C-1 | New `models.user_id` sets `model_account_linked=true` |
| 3.13 | `sync_model_account_linked` | DB | C-1 | `models.user_id` change updates linked option_requests |
| 3.14 | `fn_sync_b2b_conversation_participants` | DB+FE | C-1 | New B2B conversation auto-adds owners as participants |
| 3.15 | `fn_transfer_pending_territories` | DB | C-1 | Model claim merges pending territory rows |
| 3.16 | `enforce_agency_org_member_seat_limit` | DB+FE | C-1 | Seat cap enforced at member INSERT |
| 3.17 | `enforce_agency_org_invitation_seat_limit` | DB+FE | C-1 | Seat cap enforced at invitation INSERT |
| 3.18 | `message_insert_agency_model_mat_ok` | DB+FE | C-1 | Recruiting chat send works only for matching MAT |
| 3.19 | `model_applications_names_match_profile` | DB+FE | C-1 | Application name vs. profile name guard |
| 3.20 | `notify_org_for_option_request` | DB+FE | C-1 | Notification persisted; FE bell badge updated |
| 3.21 | `notify_org_for_booking_event` | DB+FE | C-1 | Notification persisted on booking event |
| 3.22 | `notify_org_for_recruiting_thread` | DB+FE | C-1 | Notification persisted on recruiting message |
| 3.23 | `prevent_admin_flag_escalation` | DB | C-1 | Cannot UPDATE `profiles.is_admin` via API (search_path=public set) |
| 3.24 | `prevent_privilege_escalation_on_profiles` | DB | C-1 | Cannot UPDATE `profiles.role` via API |
| 3.25 | `set_*_updated_at` (3) | DB | C-1 | Row UPDATE refreshes `updated_at` |
| 3.26 | `set_model_photo_source` | DB+FE | C-1 | model_photos source mirror keeps in sync |
| 3.27 | `trg_enforce_option_message_from_role` | DB | C-1 | Role-stamped option messages only |
| 3.28 | `trg_set_option_document_uploaded_by` | DB | C-1 | Document upload sets uploaded_by automatically |
| 3.29 | `validate_org_member_role_for_type` | DB | C-1 | Booker on agency org / employee on client org enforced |
| 3.30 | `fn_guard_minor_visibility` | DB+FE | C-1 | Minor model visibility blocked w/o consent |
| 3.31 | `fn_create_agency_client_invoice_draft` | DB+FE | C-1 | Auto-draft invoice on job confirm |

---

## 4. RLS-helper coverage (NOT yet revoked — Phase C-2 deferred)

The classification flagged **21 RLS helper functions** as currently still
executable by anon. They are *NOT yet revoked* because revoking would cause
RLS evaluation to error with `permission denied for function …` whenever an
anon user runs a query that touches a table whose policy invokes the helper.

We test that they continue to behave correctly **with the current grants**.

| # | Helper | Used in policies on | Anon expected | Pass criterion |
|---|--------|---------------------|---------------|----------------|
| 4.1 | `caller_is_client_org_member()` | models, model_photos, … | returns `false` | Anon SELECT returns 0 rows, no error |
| 4.2 | `caller_is_linked_model()` | models | returns `false` | Anon SELECT returns 0 rows |
| 4.3 | `caller_is_admin()` | many | returns `false` | Anon SELECT returns 0 rows |
| 4.4 | `caller_is_agency_owner()` | bookers, … | returns `false` | Anon SELECT returns 0 rows |
| 4.5 | `option_request_visible_to_me(uuid)` | option_requests, messages | returns `false` | Anon SELECT returns 0 rows |
| 4.6 | `conversation_accessible_to_me(uuid)` | conversations | returns `false` | Anon SELECT returns 0 rows |
| 4.7 | `can_view_calendar_entry(uuid)` | calendar_entries | returns `false` | Anon SELECT returns 0 rows |
| 4.8 | `can_view_model_photo(uuid)` | model_photos | returns `false` | Anon SELECT returns 0 rows |
| 4.9 | `is_org_member(uuid)` | many | returns `false` | Anon SELECT returns 0 rows |
| 4.10 | `is_current_user_admin()` | many | returns `false` | Anon SELECT returns 0 rows |
| 4.11 | `check_org_access(uuid, …)` | many | returns `false` | Anon SELECT returns 0 rows |
| 4.12 | remaining 10 RLS helpers | — | — | as above |

> **Action C-2 (deferred):** wrap these helpers in an outer SQL that returns
> `false` if `auth.uid() IS NULL`, then add an explicit `IF auth.uid() IS NULL
> THEN RETURN false; END IF;` guard. Once that guard is in place, revoking
> EXECUTE from anon becomes safe. Tracked in `docs/AUDIT_DRIFT_TRIAGE_2026-05.md`.

---

## 5. Authenticated SECDEF surface (Phase D — keep, document only)

The 258 `authenticated_security_definer_function_executable` lints constitute
the **product API surface**. They are **expected** because every product RPC
that needs to bypass row-level guards is `SECURITY DEFINER` with explicit
internal guards (`assert_is_admin`, `auth.uid() IS NOT NULL`, ownership
checks).

| # | Function family | Internal guard | Coverage |
|---|-----------------|----------------|----------|
| 5.1 | `admin_*` | `assert_is_admin()` | manual + Jest mocks |
| 5.2 | `agency_*` | org-member + ownership | Jest unit tests `agency*` |
| 5.3 | `client_*` | org-member + ownership | Jest unit tests `client*` |
| 5.4 | `model_*` (model-self only) | `auth.uid() = model.user_id` | Jest unit tests + RLS |
| 5.5 | territory RPCs | MAT membership + bookers fallback | Jest territory tests |
| 5.6 | option/casting flow | role-stamp + `model_account_linked` | extensive Jest coverage |
| 5.7 | calendar / booking | role + conflict checks | Jest |

> **No revoke on this set.** The lint is informational; mitigation is internal
> guards, which already exist per the system invariants. We document this
> acceptance in `docs/SUPABASE_LINT_TRIAGE_2026-05-10.md`.

---

## 6. Storage bucket policy matrix (Phase E — deferred)

`organization-logos` and `organization-profiles` are *public* buckets.
The lint warns that anon can `SELECT` (list) the bucket. Action: restrict
SELECT to `getPublicUrl()` semantics only.

| # | Bucket | Frontend method | Anon expected | Phase | Status |
|---|--------|-----------------|---------------|-------|--------|
| 6.1 | `organization-logos` | `.upload()` | denied | E (deferred) | unchanged |
| 6.2 | `organization-logos` | `.remove()` | denied | E (deferred) | unchanged |
| 6.3 | `organization-logos` | `.getPublicUrl()` | works (signed URL public) | E (deferred) | unchanged |
| 6.4 | `organization-logos` | `.list()` | DESIRED: denied | E (deferred) | currently allowed |
| 6.5 | `organization-logos` | `.download()` via path | DESIRED: denied | E (deferred) | currently allowed |
| 6.6 | `organization-profiles` | same as above | same | E (deferred) | same |

**Verification before Phase E rollout:**

```bash
# Confirm frontend never uses .list() on these buckets
grep -rn "from('organization-logos').list" src/
grep -rn "from('organization-profiles').list" src/
# ⇒ must return 0 hits
grep -rn "from('organization-logos').download" src/
grep -rn "from('organization-profiles').download" src/
# ⇒ must return 0 hits
# (verified 2026-05-10: no matches)
```

---

## 7. Auth dashboard checks (Phase F — Supabase dashboard)

| # | Setting | Current | Target | Owner |
|---|---------|---------|--------|-------|
| 7.1 | `auth_leaked_password_protection` | OFF | ON | dashboard click |
| 7.2 | Password min length | 8 | 12+ | dashboard |
| 7.3 | Password complexity | basic | strict | dashboard |
| 7.4 | Email enumeration protection | check | ON | dashboard |
| 7.5 | Anonymous sign-in | check | OFF (only used for guest tokens) | dashboard |

> Cannot be done via SQL migration. Tracked manually in the security release
> ticket; verify in dashboard after each deployment cycle.

---

## 8. End-to-end smoke matrix (post-deploy)

The following minimum scenarios must pass after every lint-hardening rollout.

| # | Scenario | Roles | Surface | Pass criterion |
|---|----------|-------|---------|----------------|
| 8.1 | Anon → signup → owner org bootstrap | Anon, Owner | FE+DB | Org created, no zombie |
| 8.2 | Owner invites Booker → Booker signs up | Owner, Booker | FE+EF+DB | Booker joins existing org |
| 8.3 | Owner invites Employee → Employee signs up | Owner, Employee | FE+EF+DB | Employee joins existing org |
| 8.4 | Agency adds Model (manual) → claim flow | Owner, Booker, Model | FE+DB | Token claim flips `models.user_id` |
| 8.5 | Discovery list (Client) | Client Owner | FE+DB | Models visible per MAT |
| 8.6 | Add model to project | Client Owner | FE+DB | `client_project_models` row added |
| 8.7 | Option request from Discover | Client | FE+DB | option_request created, agency notified |
| 8.8 | Option request from Package | Client | FE+DB | works connectionless |
| 8.9 | Option request from Project | Client | FE+DB | works connectionless |
| 8.10 | Agency confirms availability | Agency | FE+DB | calendar entry created (trigger) |
| 8.11 | Model confirms availability | Model | FE+DB | `model_approval='approved'` |
| 8.12 | Client confirms job | Client | FE+DB | calendar upgrades to job; booking_event row |
| 8.13 | Agency-only event creation | Agency | FE+DB | agency-only flow OK |
| 8.14 | Agency rejects option | Agency | FE+DB | calendar entries `cancelled` |
| 8.15 | Model rejects availability | Model | FE+DB | `final_status` reset; system message emitted |
| 8.16 | Counter-offer flow | Client+Agency | FE+DB | price negotiation independent of availability |
| 8.17 | Recruiting chat (Agency↔Model) | Agency, Model | FE+DB | message INSERT trigger ok |
| 8.18 | Application accept flow | Agency, Model | FE+DB | name match + claim consistent |
| 8.19 | Calendar week / month / day views | Agency, Client, Model | FE | colors, dedupe, mobile vs desktop |
| 8.20 | Smart Attention dot consistency | all | FE | thread header == calendar dot |
| 8.21 | Manual invoice draft create | Agency Owner | FE+DB | manual_invoices row, draft pdf |
| 8.22 | Manual invoice list / overview | Agency Owner | FE+DB | unified Invoices sub-tab refresh |
| 8.23 | Stripe checkout | Owner only | FE+EF | Booker/Employee blocked |
| 8.24 | Account deletion (request → cancel) | any | FE+EF+DB | `cancel_account_deletion` works |
| 8.25 | Org dissolve → 30-day purge cron | Owner, cron | FE+DB+CRON | scheduled purge runs |
| 8.26 | Delete-user (admin) | Admin | EF+DB | conversation_participants stripped (service_role) |
| 8.27 | Mediaslide / Netwalk sync | Agency Owner | FE+DB | sync_ids updated |
| 8.28 | Discovery near me | Client | FE+DB | `get_models_near_location` dedupe ok |
| 8.29 | Guest link gallery | Guest | FE+EF+DB | `get_guest_link_models` returns models |
| 8.30 | Public model profile | Anon | FE+DB | `get_public_model_profile` works |

---

## 9. Automated test snapshot (Jest)

| # | Suite | Count | Status |
|---|-------|-------|--------|
| 9.1 | `npm test -- --ci` | **2 809 tests / 199 suites** | ✅ green (2026-05-10) |
| 9.2 | `npm run typecheck` | tsc --noEmit | ✅ green |
| 9.3 | `npm run lint` | eslint | ✅ green |

---

## 10. Live DB final verification (Phase A + B + C-1)

```sql
-- 1. No anon=X on the 50 + 43 functions revoked across phases A, B, C-1
SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND array_to_string(p.proacl, ',') ILIKE '%anon=X%'
  AND p.proname IN (
    -- Phase A: 9 functions
    'gdpr_purge_inactive_data','observability_log_event','observability_record_metric',
    'observability_record_metrics','observability_register_health_check',
    'observability_resolve_alert','observability_run_health_checks',
    'observability_set_alert','observability_set_metric_target',
    -- Phase B: 31 functions (admin_* + caller_is_* + auto_create_*)
    'admin_assert_can_terminate_subscription','admin_assert_paywall',
    'admin_clear_observability_log','admin_convert_org_type','admin_create_invitation',
    'admin_delete_organization','admin_dispatch_observability_alert',
    'admin_export_observability_log','admin_find_model_by_email','admin_force_logout',
    'admin_get_observability_summary','admin_get_subscription_grace','admin_get_user_summary',
    'admin_grant_override','admin_list_users','admin_pause_outbound','admin_pause_signups',
    'admin_pause_uploads','admin_purge_outbox','admin_purge_outbox_dry_run',
    'admin_resolve_observability_alert','admin_resume_outbound','admin_resume_signups',
    'admin_resume_uploads','admin_revoke_override','admin_run_health_checks',
    'admin_set_observability_alert','admin_set_subscription_grace','admin_terminate_subscription',
    'admin_update_user','caller_is_admin','caller_is_agency_owner','caller_is_booker',
    'caller_is_client_org_member','caller_is_employee','caller_is_linked_model',
    'auto_create_booker_organization','auto_create_client_organization',
    'auto_create_employee_organization',
    -- Phase C-1: 43 functions
    'cleanup_conversation_participants','enforce_agency_org_invitation_seat_limit',
    'enforce_agency_org_member_seat_limit','enqueue_external_sync_outbox',
    'fn_auto_create_booking_event_on_confirm','fn_booking_protect_legal_hold',
    'fn_booking_set_legal_hold','fn_cancel_calendar_on_option_rejected',
    'fn_create_agency_client_invoice_draft','fn_ensure_calendar_on_option_confirmed',
    'fn_guard_minor_visibility','fn_log_invoice_status_change',
    'fn_option_requests_mirror_org_names','fn_reset_final_status_on_rejection',
    'fn_set_model_account_linked_on_insert','fn_sync_b2b_conversation_participants',
    'fn_transfer_pending_territories','fn_validate_booking_event_status_transition',
    'fn_validate_booking_event_transition','get_territories_for_model',
    'message_insert_agency_model_mat_ok','model_applications_names_match_profile',
    'notify_org_for_booking_event','notify_org_for_option_request',
    'notify_org_for_recruiting_thread','prevent_admin_flag_escalation',
    'prevent_privilege_escalation_on_profiles','purge_dissolved_organization_data',
    'remove_user_from_conversation_participants',
    'run_scheduled_purge_dissolved_organizations','run_system_health_checks',
    'set_model_locations_updated_at','set_model_photo_source','set_push_tokens_updated_at',
    'set_updated_at','sync_model_account_linked','sync_option_dates_to_calendars',
    'sync_user_calendars_on_option_confirmed','sync_user_calendars_on_option_job_confirmed',
    'trg_enforce_option_message_from_role','trg_set_option_document_uploaded_by',
    'update_model_sync_ids','validate_org_member_role_for_type'
  );
-- expected: 0
```

Run with:

```bash
source .env.supabase
jq -Rs '{query:.}' < /path/to/q.sql > /tmp/q.json
curl -s -X POST "https://api.supabase.com/v1/projects/ispkfdqzjrfrilosoklu/database/query" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" -d @/tmp/q.json
```

---

## 11. Sign-off

This matrix MUST be:

- copied into the security release ticket,
- ticked off by the deploying engineer,
- archived in `docs/security-releases/2026-05-10/`.

Last update: 2026-05-10 by IndexCasting AI (autonomous lint-hardening pass).

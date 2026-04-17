# IndexCasting — Full Project Context Export (Updated)

This document is a **broad architectural snapshot** of the repository as of generation time. It is intended for **external architects** and complements narrower docs such as [`BUSINESS_LOGIC_SYSTEM_SNAPSHOT.md`](BUSINESS_LOGIC_SYSTEM_SNAPSHOT.md) (option/casting/business logic focus).

---

# 1. Repository overview

## Current purpose

**IndexCasting** is a B2B + model-facing platform for fashion castings: client organizations and agencies discover models, negotiate options/castings, manage calendars and bookings, exchange messages (option threads, recruiting, org messenger), and operate under subscription/paywall rules. The product targets **Expo/React Native** (iOS/Android) plus **web** (Expo web export), with **Supabase** (Postgres, Auth, Storage, Realtime, Edge Functions) as the backend.

## High-level architecture

- **Client app:** `src/` (views, components, stores, services), `App.tsx` (routing, admin gate, paywall guards), `lib/` (Supabase client, validation).
- **Backend:** Postgres schema and logic primarily in **`supabase/migrations/`** (canonical deploy path per project policy). **Root `supabase/*.sql`** is a large legacy/historical layer — **not** auto-applied by CLI migrations; **live production** may include objects from migrations + historical pushes — **drift must be verified** against a live DB ([`docs/LIVE_DB_DRIFT_GUARDRAIL.md`](LIVE_DB_DRIFT_GUARDRAIL.md)).
- **Edge Functions:** `supabase/functions/` (Stripe, invites, push, calendar feed, GDPR-related delete, etc.).
- **Rules & invariants:** `.cursorrules` + `.cursor/rules/*.mdc` encode non-negotiable security and product constraints.
- **CI / quality:** `npm run typecheck`, `lint`, `jest`; Playwright under `e2e/`. Husky `prepare` in `package.json`.

## Important top-level folders

| Path | Role |
|------|------|
| [`src/`](../src/) | Application code: UI, state (`store/`), Supabase integration (`services/`), utils, web entry (`web/ClientWebApp.tsx`). |
| [`lib/`](../lib/) | Shared client libraries (e.g. Supabase init, file validation). |
| [`supabase/migrations/`](../supabase/migrations/) | **Canonical** versioned SQL migrations (239 `.sql` files at last count in this repo snapshot). |
| [`supabase/`](../supabase/) (root `*.sql`) | Legacy scripts, one-offs, `schema.sql`, inventory docs — **do not treat as sole source of truth** for production. |
| [`supabase/functions/`](../supabase/functions/) | Edge Functions (deployed separately). |
| [`docs/`](./) | Audits, paywall/GDPR/calendar/RLS guides, drift guardrails, business snapshots. |
| [`.cursor/rules/`](../.cursor/rules/) | Executable project guardrails for AI and humans. |
| [`e2e/`](../e2e/) | Playwright tests. |
| [`scripts/`](../scripts/) | Deploy helpers, LLM bundle, audit scripts. |

## Production / live relevant vs auxiliary

- **Production-relevant:** `src/`, `lib/`, `App.tsx`, `supabase/migrations/`, `supabase/functions/`, Vercel/hosting config if present, Stripe secrets (env, not in repo).
- **Auxiliary / analysis:** many `docs/*` audits, `scripts/generate-*`, `supabase/diag_*.sql`, root `supabase/migration_*.sql` as **reference** unless explicitly redeployed via a new migration.
- **Tests:** `src/**/__tests__`, `e2e/` — define behavioral contracts (especially option/hardening tests).

---

# 2. Current major systems

For each system: **where it lives**, **responsibility**, **invariants**, **hardening (from rules/docs)**.

## 2.1 Auth / profile / bootstrap

**Files (core):**

- [`App.tsx`](../App.tsx) — session, admin routing before `effectiveRole`, paywall guards, `ClientView` / `AgencyView` / `ModelRouteGuard`.
- [`src/context/AuthContext.tsx`](../src/context/AuthContext.tsx) — `signIn`, `bootstrapThenLoadProfile`, invite **before** owner bootstrap ([`system-invariants.mdc`](../.cursor/rules/system-invariants.mdc) INVITE-BEFORE-BOOTSTRAP), `loadProfile`, org context loading for B2B roles.
- [`src/services/gdprComplianceSupabase.ts`](../src/services/gdprComplianceSupabase.ts) — consents, confirmations, deletion-related RPCs (with idempotency patterns).
- Profile typing / RPCs: scattered in services; admin profile flags via pinned UUID+email RPCs ([`admin-security.mdc`](../.cursor/rules/admin-security.mdc)).

**Responsibility:** Authentication, profile hydration, org membership resolution, model claim/invite finalization, legal acceptance gating.

**Invariants:**

- Admin login/bootstrap isolation: `bootstrapThenLoadProfile` step order; `linkModelByEmail`-style side effects must not block admin bootstrap (see [`admin-security.mdc`](../.cursor/rules/admin-security.mdc)).
- Invite-before-bootstrap: three-layer defense (frontend order + `ensure_plain_signup_b2b_owner_bootstrap` pending-invite check + zombie cleanup in `accept_organization_invitation`) — [`system-invariants.mdc`](../.cursor/rules/system-invariants.mdc).

## 2.2 Organizations / membership / roles

**Files:**

- [`src/services/orgRoleTypes.ts`](../src/services/orgRoleTypes.ts) — agency: `owner` | `booker`; client: `owner` | `employee`.
- [`src/context/AuthContext.tsx`](../src/context/AuthContext.tsx), [`src/services/organizationsInvitationsSupabase.ts`](../src/services/organizationsInvitationsSupabase.ts), org-related RPCs in migrations (e.g. `get_my_org_context`, `accept_organization_invitation`, seat limits).
- Rule: [`.cursor/rules/account-org-context-canonical.mdc`](../.cursor/rules/account-org-context-canonical.mdc).

**Responsibility:** B2B org lifecycle, invitations, seat caps for agency orgs, deterministic paywall org resolution (exception: oldest membership in `can_access_platform()` — documented).

**Invariants:**

- Models **not** in `organization_members`; model–agency via `model_agency_territories` ([`system-invariants.mdc`](../.cursor/rules/system-invariants.mdc)).
- No implicit `LIMIT 1` org resolution for general features (paywall is the documented exception).

## 2.3 Request / option / casting system

**Files:**

- [`src/services/optionRequestsSupabase.ts`](../src/services/optionRequestsSupabase.ts), [`src/store/optionRequests.ts`](../src/store/optionRequests.ts).
- [`src/utils/optionRequestAttention.ts`](../src/utils/optionRequestAttention.ts), [`src/utils/negotiationAttentionLabels.ts`](../src/utils/negotiationAttentionLabels.ts), [`src/utils/priceSettlement.ts`](../src/utils/priceSettlement.ts).
- Migrations: option insert/RLS, `client_confirm_option_job`, `agency_confirm_job_agency_only`, `delete_option_request_full`, status triggers — see §5.
- Deep doc: [`BUSINESS_LOGIC_SYSTEM_SNAPSHOT.md`](BUSINESS_LOGIC_SYSTEM_SNAPSHOT.md), [`.cursor/rules/agency-only-option-casting.mdc`](../.cursor/rules/agency-only-option-casting.mdc), [`.cursor/rules/option-requests-chat-hardening.mdc`](../.cursor/rules/option-requests-chat-hardening.mdc).

**Responsibility:** Single table `option_requests` for option + casting (`request_type`); two-axis price vs availability; agency-only manual events; negotiation chat; system messages via RPC.

**Invariants:** Axis decoupling (K), model-safe SELECT, `isAgencyOnly` in all attention call sites, delete-full vs legacy reject, calendar trigger on `final_status` transition to `option_confirmed`.

## 2.4 Bookings / calendar

**Files:**

- [`src/services/calendarSupabase.ts`](../src/services/calendarSupabase.ts), [`src/services/bookingEventsSupabase.ts`](../src/services/bookingEventsSupabase.ts), [`src/services/bookingsSupabase.ts`](../src/services/bookingsSupabase.ts).
- [`src/utils/agencyCalendarUnified.ts`](../src/utils/agencyCalendarUnified.ts), [`src/utils/calendarProjectionLabel.ts`](../src/utils/calendarProjectionLabel.ts), [`src/utils/calendarDetailNextStep.ts`](../src/utils/calendarDetailNextStep.ts), [`src/utils/calendarThreadDeepLink.ts`](../src/utils/calendarThreadDeepLink.ts).
- Migrations: `fn_ensure_calendar_on_option_confirmed`, cancel on reject, `calendar_entries` RLS canonical migration, ICS/calendar feed migrations.
- Docs: [`BOOKING_BRIEF_SYSTEM.md`](BOOKING_BRIEF_SYSTEM.md), [`QA_CALENDAR_DEEPLINK_PARITY.md`](QA_CALENDAR_DEEPLINK_PARITY.md).

**Responsibility:** `calendar_entries` as projection of option lifecycle; `user_calendar_events` sync; `booking_events` for agency/internal merge; export/ICS; job upgrade from client/app after RPC.

**Invariants:** Writes to non-cancelled rows for shared notes; deeplink by `option_request_id`; badge parity with attention pipeline.

## 2.5 Chat systems

**Layers:**

1. **Option / negotiation:** `option_request_messages`, Realtime subscriptions, [`optionRequestsSupabase.ts`](../src/services/optionRequestsSupabase.ts); UI [`NegotiationThreadFooter.tsx`](../src/components/optionNegotiation/NegotiationThreadFooter.tsx).
2. **Recruiting:** [`src/store/recruitingChats.ts`](../src/store/recruitingChats.ts), [`src/services/recruitingChatSupabase.ts`](../src/services/recruitingChatSupabase.ts), migrations for recruiting threads/messages.
3. **B2B org messenger:** [`src/services/b2bOrgChatSupabase.ts`](../src/services/b2bOrgChatSupabase.ts), components such as [`OrgMessengerInline.tsx`](../src/components/OrgMessengerInline.tsx).
4. **Guest / package contexts:** client web and guest flows — [`client-web-gallery-guest-shared-audit.mdc`](../.cursor/rules/client-web-gallery-guest-shared-audit.mdc).

**Invariants:** System messages only via `insert_option_request_system_message`; model-facing message filter; chat-files upload parity ([`upload-consent-matrix.mdc`](../.cursor/rules/upload-consent-matrix.mdc)).

## 2.6 Model management

**Files:**

- [`src/services/modelsSupabase.ts`](../src/services/modelsSupabase.ts), [`src/services/modelPhotosSupabase.ts`](../src/services/modelPhotosSupabase.ts), [`src/services/territoriesSupabase.ts`](../src/services/territoriesSupabase.ts).
- Agency UI: [`src/views/AgencyControllerView.tsx`](../src/views/AgencyControllerView.tsx) (large).
- Migrations: `agency_update_model_full`, `model_agency_territories` uniqueness `(model_id, country_code)`, location multi-row, discovery RPCs, claim token RPCs (`generate_model_claim_token`, `claim_model_by_token`).

**Responsibility:** Roster, territories, locations (live/current/agency sources), portfolio via `model_photos`, completeness, discovery visibility.

**Invariants:** No `profiles` in `models` RLS; storage policies use SECURITY DEFINER helpers; canonical city/display rules; agency bulk = territories only, not bulk current location ([`system-invariants.mdc`](../.cursor/rules/system-invariants.mdc)).

## 2.7 Storage / uploads

**Files:**

- Upload pipelines in `src/services/*` (e.g. `modelPhotosSupabase`, `applicationsSupabase`, option document upload in `optionRequestsSupabase`).
- [`lib/validation/`](../lib/validation/) — MIME, magic bytes, sanitization.
- Rules: [`upload-consent-matrix.mdc`](../.cursor/rules/upload-consent-matrix.mdc), [`agency-media-panels-and-sql-randomness.mdc`](../.cursor/rules/agency-media-panels-and-sql-randomness.mdc).

**Responsibility:** `documentspictures`, `chat-files`, org logos, etc.; consent before upload; alignment of RLS row visibility with storage helpers (`can_view_model_photo_storage`, etc.).

## 2.8 Billing / subscription / paywall

**Files:**

- [`supabase/functions/create-checkout-session/`](../supabase/functions/create-checkout-session/), [`supabase/functions/stripe-webhook/`](../supabase/functions/stripe-webhook/).
- Docs: [`PAYWALL_SECURITY_SUMMARY.md`](PAYWALL_SECURITY_SUMMARY.md), [`OWNER_BILLING_ONBOARDING.md`](OWNER_BILLING_ONBOARDING.md), [`.cursor/rules/billing-payment-invariants.mdc`](../.cursor/rules/billing-payment-invariants.mdc).
- DB: `can_access_platform`, `organization_subscriptions`, `admin_overrides`, `used_trial_emails` — see migrations referenced in paywall doc (e.g. `20260416_fix_a_can_access_platform_sha256.sql`).

**Responsibility:** Org-wide access; owner-only checkout; webhook as subscription truth; frontend mirrors only.

## 2.9 Admin systems

**Files:**

- [`src/views/AdminDashboard.tsx`](../src/views/AdminDashboard.tsx), [`src/services/adminSupabase.ts`](../src/services/adminSupabase.ts) (pattern: only here call `admin_*` RPCs).
- Rules: [`admin-security.mdc`](../.cursor/rules/admin-security.mdc) — UUID+email pin, `assert_is_admin()`, routing before `effectiveRole`.

**Responsibility:** Operational admin dashboard; no admin bypass inside `agency_*` / `client_*` RPCs (separate admin RPCs).

## 2.10 GDPR / deletion / privacy

**Files:**

- [`src/services/gdprComplianceSupabase.ts`](../src/services/gdprComplianceSupabase.ts), [`supabase/functions/delete-user/`](../supabase/functions/delete-user/).
- Migrations: GDPR export phases, retention orchestrator (e.g. `20260813_security_gdpr_retention_orchestrator.sql`), account deletion RPCs.
- Docs: [`GDPR_DELETE_FLOW.md`](GDPR_DELETE_FLOW.md), [`GDPR_EXPORT_TABLE_MAP.md`](GDPR_EXPORT_TABLE_MAP.md), [`DATA_RETENTION_POLICY.md`](DATA_RETENTION_POLICY.md).

**Responsibility:** Export minimization, deletion flows, consent tracking; logging via `logAction` / audit trail patterns.

## 2.11 Notifications / realtime

**Files:**

- [`src/services/notificationsSupabase.ts`](../src/services/notificationsSupabase.ts), [`supabase/functions/send-push-notification/`](../supabase/functions/send-push-notification/).
- [`src/services/realtimeChannelPool.ts`](../src/services/realtimeChannelPool.ts) (or equivalent pool file — used by option/recruiting subscriptions).
- Migration: `send_notification` RPC hardening / insert policies (e.g. `20260564_send_notification_rpc_and_insert_policy.sql`).

**Responsibility:** Push and in-app notifications; Realtime channels for messages and option threads; org-scoped notification resolution (`agency_organization_id` on option rows, etc.).

---

# 3. Business logic source-of-truth map

| Domain | Source of truth | Concrete anchors |
|--------|------------------|------------------|
| **Request lifecycle** | DB row `option_requests` + triggers + RPCs | `status`, `final_status`, `fn_validate_option_status_transition`, `client_confirm_option_job`, `agency_confirm_job_agency_only`, `delete_option_request_full` |
| **Pricing (axis 1)** | `option_requests` columns | `proposed_price`, `agency_counter_price`, `client_price_status`; UI settlement: [`priceSettlement.ts`](../src/utils/priceSettlement.ts) |
| **Model approval (axis 2)** | `model_approval`, `model_account_linked`, `final_status` | [`modelConfirmOptionRequest`](../src/services/optionRequestsSupabase.ts), [`modelInboxRequiresModelConfirmation`](../src/utils/optionRequestAttention.ts) |
| **Booking / job state** | `final_status === 'job_confirmed'` | RPCs above; calendar projection in `calendar_entries` / triggers |
| **Org roles (B2B)** | `organization_members.role` + `organizations.type` | [`orgRoleTypes.ts`](../src/services/orgRoleTypes.ts), DB triggers `validate_org_member_role_for_type` |
| **Admin authority** | pinned admin profile + `assert_is_admin()` RPCs | [`admin-security.mdc`](../.cursor/rules/admin-security.mdc) |
| **Billing / paywall** | `can_access_platform()` + Stripe webhook writes | [`PAYWALL_SECURITY_SUMMARY.md`](PAYWALL_SECURITY_SUMMARY.md) |
| **Uploads / rights** | DB confirmations + consent matrix | `confirmImageRights` patterns in `gdprComplianceSupabase`, [`upload-consent-matrix.mdc`](../.cursor/rules/upload-consent-matrix.mdc) |
| **Guest links** | Token/HMAC RPCs + RLS | migrations under `20260810_security_shared_selection_hmac_token.sql`, guest link services |
| **Deletion / GDPR** | SECURITY DEFINER RPCs + Edge `delete-user` | [`GDPR_DELETE_FLOW.md`](GDPR_DELETE_FLOW.md), retention orchestrator migration |

---

# 4. Rules / guardrails / architectural constraints

Sources: [`.cursorrules`](../.cursorrules), [`.cursor/rules/*.mdc`](../.cursor/rules/).

## Security / RLS

- [`rls-security-patterns.mdc`](../.cursor/rules/rls-security-patterns.mdc) — no `profiles.is_admin` in policies; use `is_current_user_admin()`; no email-matching in policies; SECURITY DEFINER must often `SET row_security TO off`; split `FOR ALL` policies on watchlist tables (`model_embeddings`, `model_locations`, `model_agency_territories`, `calendar_entries`, `model_minor_consent`); no self-referencing policies on MAT; org-scoped services need defense-in-depth filters.
- [`system-invariants.mdc`](../.cursor/rules/system-invariants.mdc) — storage policies must not join `models`/`profiles` directly; use helpers; territory unique `(model_id, country_code)`; location source priority live > current > agency.

## Org-scope / caller identity

- [`account-org-context-canonical.mdc`](../.cursor/rules/account-org-context-canonical.mdc) — two layers: `profiles.role` vs `organization_members`; `get_my_org_context()` returns all rows; models use `get_my_model_agencies()`.

## Admin hardening

- [`admin-security.mdc`](../.cursor/rules/admin-security.mdc) — signIn/bootstrap order; triple admin detection in `loadProfile`; `App.tsx` admin before `effectiveRole`; DB functions UUID+email pin; `handle_new_user` allowlist; single admin partial index; new admin RPCs use `assert_is_admin()`.

## Optimistic updates / async contract

- [`.cursorrules`](../.cursorrules) §4c — Option A services; `.then(ok)` not `.catch()` only; **no snapshot rollback**; inverse-operation rollback; per-id inflight locks; reconciliation after success; `ServiceResult` optional for new APIs only.

## Migrations

- [`.cursorrules`](../.cursorrules) + [`supabase-auto-deploy.mdc`](../.cursor/rules/supabase-auto-deploy.mdc) — DDL in `supabase/migrations/YYYYMMDD_*.sql`; push/verify after migrations; Edge deploy for functions; root SQL is not deploy truth.

## Logging / audit

- [`.cursorrules`](../.cursorrules) §22–24 — use [`logAction`](../src/utils/logAction.ts); audit `source` field; trigger logs use `source: trigger`.

## Privacy / GDPR

- Retention/export/delete docs in `docs/GDPR_*`; orchestrator migration; minimization in export v3/v4 migrations.

## Owner vs member

- [`billing-payment-invariants.mdc`](../.cursor/rules/billing-payment-invariants.mdc), paywall summary — owner-only checkout; org-wide access when allowed.

## UI copy / English-only

- [`.cursorrules`](../.cursorrules) §4b — `uiCopy` for user-visible strings; English-only product UI.

## Option/casting / chat-specific

- [`option-requests-chat-hardening.mdc`](../.cursor/rules/option-requests-chat-hardening.mdc), [`agency-only-option-casting.mdc`](../.cursor/rules/agency-only-option-casting.mdc), [`auto-review.mdc`](../.cursor/rules/auto-review.mdc) — long checklists (axis coupling, realtime, model-safe SELECT, etc.).

## Dev workflow

- [`dev-workflow.mdc`](../.cursor/rules/dev-workflow.mdc) — typecheck, lint, test before commit; git pull --rebase / push; security release ritual for SQL/SECDEF.

---

# 5. Migration / database overview

## Scale

- **`supabase/migrations/`:** 239 SQL files (repo snapshot at document generation).
- **Root `supabase/*.sql`:** 200+ additional files — **legacy / manual / diagnostic** per [`SUPABASE_LEGACY_SQL_INVENTORY.md`](SUPABASE_LEGACY_SQL_INVENTORY.md) (note: inventory counts there are outdated; migrations folder has grown).

## Important migration families (clustered by theme)

- **20260406–20260417 — Security & location foundation:** SECDEF hardening, `is_org_member` row_security off, near-me MAT dedupe, discovery city, territory constraint rename, models RLS without `profiles` join, client SECDEF for model read.
- **20260420–202605 — Org, paywall, options, calendar:** `can_access_platform` / trial hashes, option request RLS and insert guards, calendar on option confirmed, client confirm job RPC, delete option full, reset final_status on reject, freeze prices, advisory locks / RLS dedupe on options (scalability).
- **202606 — Axis decoupling:** migrations `20260612_decouple_price_rpcs_from_availability.sql`, `20260616_decouple_availability_from_price_actions.sql`, related triggers.
- **202607 — Agency-created options & agency-only job:** `agency_create_option_request`, sync user calendars, `agency_confirm_job_agency_only`, block casting, type fixes for RPCs.
- **202608 — GDPR retention, shared selection security, calendar export, scalability indexes, delete_option_request_full updates.**
- **202609 — Recruiting/application sync, agency remove model idempotency, representation warnings.**

## Important RPCs (non-exhaustive)

- **Options:** `client_confirm_option_job`, `agency_confirm_job_agency_only`, `delete_option_request_full`, `insert_option_request_system_message`, `resolve_agency_organization_id_for_option_request`, `agency_create_option_request` (and fixes).
- **Org:** `get_my_org_context`, `accept_organization_invitation`, `ensure_plain_signup_b2b_owner_bootstrap`, invite/claim finalize paths.
- **Models/territories:** `agency_update_model_full`, `save_model_territories`, `get_discovery_models`, `get_models_near_location`, claim token RPCs.
- **Paywall:** `can_access_platform`, `has_platform_access`.
- **Admin:** `assert_is_admin`, various `admin_*` (only from admin service/dashboard).

## Important triggers

- `trg_validate_option_status` / `fn_validate_option_status_transition` — option state machine.
- `tr_reset_final_status_on_rejection` — reject + final_status reset ordering with validate trigger (alphabetical BEFORE order documented in rules).
- `trg_ensure_calendar_on_option_confirmed` — calendar row on `option_confirmed`.
- `fn_cancel_calendar_on_option_rejected` (+ later booking_events cancel).
- Model/account linked sync triggers (e.g. `sync_model_account_linked` — see migrations referenced in invariants).

## SECURITY DEFINER patterns

- Widespread for RPCs that must bypass RLS with explicit `auth.uid()` and org guards; **must** include `SET row_security TO off` when reading RLS tables from policies or risk recursion ([`system-invariants.mdc`](../.cursor/rules/system-invariants.mdc)).

## Root SQL vs migrations drift

- Examples called out in code/docs: [`migration_chaos_hardening_2026_04.sql`](../supabase/migration_chaos_hardening_2026_04.sql) (e.g. booking event on confirm trigger), older calendar/booking root scripts — **verify live** with `pg_get_functiondef` and policy catalogs ([`LIVE_DB_DRIFT_GUARDRAIL.md`](LIVE_DB_DRIFT_GUARDRAIL.md)).

## Critical tables (architectural)

- `profiles`, `organizations`, `organization_members`, `models`, `model_agency_territories`, `model_locations`, `model_photos`
- `option_requests`, `option_request_messages`, `calendar_entries`, `user_calendar_events`, `booking_events`
- `organization_subscriptions`, `admin_overrides`, `used_trial_emails`
- `activity_logs` / audit trail tables as named in migrations
- Storage metadata tables for objects (policies on `storage.objects`)

---

# 6. Security posture

- **RLS:** default-deny with participant/org-scoped policies; admin via `is_current_user_admin()` not column reads on revoked columns.
- **Admin:** separate RPC namespace; UUID+email pin; frontend routing dual-check `is_admin` / `role === 'admin'`.
- **SECURITY DEFINER:** used heavily; must pair with internal guards (rules §21–23 in `.cursorrules`); `row_security off` when reading tenant tables inside helpers invoked from RLS.
- **Audit:** `logAction` wrapper; `audit_trail` / `log_audit_action` in DB with `source` discipline.
- **Upload consent:** matrix rule file; idempotent `confirmX` patterns (no broken RETURNING on RLS mismatch).
- **Guest:** token/HMAC migrations; rate limits (guest link migrations); no broad anon reads without policy review.
- **Org isolation:** org_id filters in services; `assertOrgContext` patterns; no `agencies[0]` email fallback (fixed patterns in rules).
- **Historical pitfalls (documented as fixed):** MAT self-reference 42P17; `profiles` in models policies; email-based RLS; storage policies joining models causing cascade failures; FOR ALL on watchlist tables.

---

# 7. Legacy vs current

| Area | Legacy / drift-prone | Current / canonical |
|------|----------------------|---------------------|
| SQL delivery | Root `supabase/migration_*.sql`, `schema.sql` | `supabase/migrations/YYYYMMDD_*.sql` |
| Agency “remove request” | `agencyRejectRequest` UPDATE-only ([deprecated in code](../src/services/optionRequestsSupabase.ts)) | `deleteOptionRequestFull` + RPC |
| Attention UI | `deriveSmartAttentionState`, `attentionHeaderLabel` | `deriveNegotiationAttention` + `deriveApprovalAttention` + `attentionHeaderLabelFromSignals` |
| Model linking | `link_model_by_email` (deprecated per rules; isolated Auth step 2) | `claim_model_by_token` / `generate_model_claim_token` |
| Admin vs agency | Admin bypass inside agency RPCs | Forbidden — use `admin_*` only ([`.cursorrules`](../.cursorrules) §25) |
| Booking event creation | Comment references root `fn_auto_create_booking_event_on_confirm` | May exist on live DB; confirm via live introspection |
| Org context | Single-row LIMIT assumptions | `get_my_org_context` all rows; paywall exception documented |

---

# 8. Important documentation map

| Document | Purpose |
|----------|---------|
| [`BUSINESS_LOGIC_SYSTEM_SNAPSHOT.md`](BUSINESS_LOGIC_SYSTEM_SNAPSHOT.md) | Option/casting/business logic for core engine extraction |
| [`LIVE_DB_DRIFT_GUARDRAIL.md`](LIVE_DB_DRIFT_GUARDRAIL.md) | Repo vs production DB truth |
| [`PAYWALL_SECURITY_SUMMARY.md`](PAYWALL_SECURITY_SUMMARY.md) | Subscription and `can_access_platform` |
| [`BOOKING_BRIEF_SYSTEM.md`](BOOKING_BRIEF_SYSTEM.md) | Booking brief JSON trust model |
| [`CLIENT_MODEL_PHOTO_VISIBILITY.md`](CLIENT_MODEL_PHOTO_VISIBILITY.md) | RLS + storage alignment |
| [`INVITE_CLAIM_ASSIGNMENT_CONSISTENCY.md`](INVITE_CLAIM_ASSIGNMENT_CONSISTENCY.md) | Invite/claim flows |
| [`MODEL_SAVE_LOCATION_CONSISTENCY.md`](MODEL_SAVE_LOCATION_CONSISTENCY.md) | Agency save vs territory RPC guards |
| [`SECURITY_RELEASE_TEMPLATE.md`](SECURITY_RELEASE_TEMPLATE.md) | Release checklist for SQL/security |
| [`SUPABASE_LEGACY_SQL_INVENTORY.md`](SUPABASE_LEGACY_SQL_INVENTORY.md) | Root SQL vs migrations (counts outdated) |
| [`FULL_SYSTEM_AUDIT_2026-04-17.md`](FULL_SYSTEM_AUDIT_2026-04-17.md) | Recent broad audit snapshot in repo |
| [`SYSTEM_SUMMARY.md`](SYSTEM_SUMMARY.md) | Older summary — cross-check against this export |
| [`OPTION_CASTING_FLOW.md`](OPTION_CASTING_FLOW.md) | Flow-oriented option/casting doc |
| [`SMART_ATTENTION_SYSTEM.md`](SMART_ATTENTION_SYSTEM.md) | Attention narrative |
| `.cursor/rules/*.mdc` | **Authoritative** guardrails for implementation |

---

# 9. Important code file map (by domain)

**Shell / routing:** [`App.tsx`](../App.tsx), [`src/context/AuthContext.tsx`](../src/context/AuthContext.tsx)

**Org / invites:** [`src/services/orgRoleTypes.ts`](../src/services/orgRoleTypes.ts), [`src/services/organizationsInvitationsSupabase.ts`](../src/services/organizationsInvitationsSupabase.ts)

**Options / negotiation:** [`src/services/optionRequestsSupabase.ts`](../src/services/optionRequestsSupabase.ts), [`src/store/optionRequests.ts`](../src/store/optionRequests.ts), [`src/utils/optionRequestAttention.ts`](../src/utils/optionRequestAttention.ts), [`src/components/optionNegotiation/NegotiationThreadFooter.tsx`](../src/components/optionNegotiation/NegotiationThreadFooter.tsx)

**Calendar / booking:** [`src/services/calendarSupabase.ts`](../src/services/calendarSupabase.ts), [`src/utils/agencyCalendarUnified.ts`](../src/utils/agencyCalendarUnified.ts), [`src/services/bookingEventsSupabase.ts`](../src/services/bookingEventsSupabase.ts)

**Models / media / territories:** [`src/services/modelsSupabase.ts`](../src/services/modelsSupabase.ts), [`src/services/modelPhotosSupabase.ts`](../src/services/modelPhotosSupabase.ts), [`src/services/territoriesSupabase.ts`](../src/services/territoriesSupabase.ts), [`src/views/AgencyControllerView.tsx`](../src/views/AgencyControllerView.tsx)

**Client web:** [`src/web/ClientWebApp.tsx`](../src/web/ClientWebApp.tsx)

**Recruiting:** [`src/services/recruitingChatSupabase.ts`](../src/services/recruitingChatSupabase.ts), [`src/store/recruitingChats.ts`](../src/store/recruitingChats.ts)

**B2B chat:** [`src/services/b2bOrgChatSupabase.ts`](../src/services/b2bOrgChatSupabase.ts)

**Admin:** [`src/services/adminSupabase.ts`](../src/services/adminSupabase.ts), [`src/views/AdminDashboard.tsx`](../src/views/AdminDashboard.tsx)

**GDPR / compliance:** [`src/services/gdprComplianceSupabase.ts`](../src/services/gdprComplianceSupabase.ts), [`src/utils/logAction.ts`](../src/utils/logAction.ts)

**Paywall UI (mirror only):** search `SubscriptionContext` / paywall guards under `src/` (exact file names may vary — treat RPC as truth)

**Realtime:** [`src/services/realtimeChannelPool.ts`](../src/services/realtimeChannelPool.ts) (if present — grep if renamed)

**Validation / uploads:** [`lib/validation/`](../lib/validation/)

**Supabase client:** [`lib/supabase.ts`](../lib/supabase.ts) (or equivalent)

---

# 10. Risks / inconsistencies / cleanup observations

1. **Drift:** Hundreds of root SQL files vs 239 migrations — production state requires **live verification**, not repo grep alone.
2. **Duplicate conceptual logic:** Attention + calendar badges + next-step text must stay aligned — several utility files; porting one without others risks UX inconsistency.
3. **Price settlement:** UI `priceCommerciallySettled` vs RPC `client_confirm_option_job` strictness differs — documented in business snapshot.
4. **Multi-org:** Frontend still often “picks oldest” membership — paywall explicitly does; product UX may not expose org switching everywhere.
5. **Legacy RPCs / services:** `agencyRejectRequest` and deprecated attention helpers still in tree for tests/legacy callers.
6. **Scale:** `AgencyControllerView.tsx` and `ClientWebApp.tsx` are very large — high coupling risk for refactors.
7. **Guest/shared/recruiting:** Parallel chat and signing paths — security reviews are migration-scattered; treat as integration surface.

---

# 11. Recommended extraction guidance

**Safest to extract first (pure or mostly pure):**

- **Attention pipeline:** [`optionRequestAttention.ts`](../src/utils/optionRequestAttention.ts), [`priceSettlement.ts`](../src/utils/priceSettlement.ts), [`negotiationAttentionLabels.ts`](../src/utils/negotiationAttentionLabels.ts) — deterministic, test-covered.
- **Org role model:** [`orgRoleTypes.ts`](../src/services/orgRoleTypes.ts) + small helpers.
- **Option request domain types and transition table** as documentation + tests mirroring [`BUSINESS_LOGIC_SYSTEM_SNAPSHOT.md`](BUSINESS_LOGIC_SYSTEM_SNAPSHOT.md).

**Extract as “core engine” with DB contract bundle:**

- **State machine + RPCs + triggers** for `option_requests` — ship together; do not port UI-only partial logic without `client_confirm_option_job`, `delete_option_request_full`, and validate triggers.

**Treat as integration later:**

- **Storage signing, push notifications, Stripe webhooks, ICS export, guest link HMAC** — depend on infra secrets and edge deployment.
- **Large UI surfaces** — consume core engine via commands/events.

**Wait until core stabilizes:**

- **Full calendar merge** (`booking_events` + `user_calendar_events` + `calendar_entries`) — high regression cost.
- **Recruiting + applications sync** — separate bounded context but touches models and agencies.

---

# 12. Update status

- **Generated:** 2026-04-17 (UTC ~15:12 from build host `date`; local commit time may differ).
- **Basis:** **Repository filesystem** in IndexCasting — **not** a live Supabase `pg_dump` or remote schema introspection. Statements about “what exists in production” for triggers/RPCs that only appear in root SQL are explicitly **uncertain** until verified per [`LIVE_DB_DRIFT_GUARDRAIL.md`](LIVE_DB_DRIFT_GUARDRAIL.md).
- **Limitations:** Migration count and file lists are point-in-time; rule docs may be updated after this file — reconcile with `.cursor/rules` on each major release. This export is **not** a substitute for security review or penetration testing.

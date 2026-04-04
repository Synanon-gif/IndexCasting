# Index Casting — System Summary

> **Last updated:** April 2026  
> **Note:** `supabase/schema.sql` is **deprecated** (historical snapshot only). The live database state follows **applied migrations** in `supabase/`, not `schema.sql`.

---

## 1. Product & Tech Stack

| Aspect | Details |
|--------|---------|
| **Product** | B2B fashion casting platform: model discovery (swipe), options/bookings, chats (agency↔client, agency↔model, guest links), recruiting, multi-tenant orgs with paywall |
| **Client** | React Native + Expo (iOS / Android / Web), Reanimated, etc. |
| **Backend** | Supabase: Auth, Postgres + RLS, Storage, Realtime, Edge Functions |
| **Payments** | Stripe (webhooks, checkout), org-level subscriptions |
| **UI language** | English (`src/constants/uiCopy.ts`) |

---

## 2. Roles & Tenancy

- **Profile roles:** `model`, `agent` (agency), `client`; plus admin flags, guest (magic link) accounts.
- **Organizations:** `organizations` with type **agency** / **client**; members in `organization_members` (e.g. owner, booker, employee).
- **Owner-only:** billing, invite/remove members, delete org; operational parity: owner ≈ booker / owner ≈ employee for day-to-day features (per product rules).
- **Multi-tenant:** data access is org- and participant-scoped; RLS + RPCs aim to prevent cross-org leakage.

---

## 3. Major Feature Areas

### Agency

- Model roster, CRUD, filters, media (portfolio / polaroids / private), territories, Mediaslide/Netwalk sync hooks.
- **Recruiting:** applications, shortlist, chat threads, booking chats after acceptance, invites/onboarding.
- **Calendar / bookings:** `booking_events`, options → calendar sync (DB triggers/RPCs).
- Team settings, storage limits, swipe limits, usage metrics.

### Client

- **Discovery** (web `ClientWebApp` + native): model cards, filters, projects, options, negotiation / option chat.
- Agency connections, org team, paywall.

### Model

- Portfolio / option requests, calendar, applications, chats (including booking chat, `?booking=` deep link).

### Guest

- **Guest links** (`?guest=`): package view, chat, rate limits, TOS acceptance RPCs, revoke via RPC.

### Platform-wide

- Auth (login/signup/invite), legal gates (`TermsScreen` / `PrivacyScreen`), web public routes `/terms` / `/privacy` when logged out.
- **Compliance:** `gdprComplianceSupabase` — deletion, export, audit (`log_audit_action` RPC), image rights, minors helpers, security events.
- **Consent:** `consentSupabase`, `withdraw_consent` / `anonymize_user_data` RPCs.
- **Admin dashboard:** broad `admin_*` RPC surface (profiles, orgs, models, storage, paywall bypass, plans).
- Push (`push_tokens`, Edge `send-push-notification`), activity logs.

---

## 4. Core Workflows

1. **Registration / invite:** `?invite=` → preview → signup/login → `accept_organization_invitation` → org context.
2. **Apply (model → agency):** form + images → `model_applications` → agency accept/reject → e.g. `create_model_from_accepted_application` → territories/thread.
3. **Recruiting chat:** thread per application, messages, file uploads (storage + validation), booking chat after acceptance.
4. **Client discovery → project → option:** add model to project, create option request, status/price/schedule.
5. **Option / price:** negotiation; `agency_confirm_client_price` / `client_accept_counter_offer` (SECURITY DEFINER), counter/reject, model approval where applicable.
6. **Booking lifecycle:** `booking_events`: pending → agency_accepted → model_confirmed → completed / cancelled. Legacy **`bookings`** table still used for some history/revenue paths.
7. **Paywall:** `can_access_platform` (and related); UI gates **plus** backend enforcement.
8. **Guest link:** open link → models in package → optional chat; `revoke_guest_access`, access logging (compliance migrations).
9. **Remove org member:** `removeOrganizationMember` → Edge **`member-remove`** (global sign-out of target user).
10. **Account / GDPR:** deletion requests, `delete_organization_data`, export, retention jobs (cron), anonymization.

---

## 5. Services (`src/services/`)

| Service | Purpose |
|---------|---------|
| **optionRequestsSupabase** | Option requests: CRUD/status, price RPCs, schedule RPCs, messages, documents, booking-event linkage, audit (`logOptionAction` / `logBookingAction`) |
| **bookingEventsSupabase** | Calendar bookings: create, status transitions, notifications |
| **bookingsSupabase** | **Legacy** `bookings` table; revenue via `get_agency_revenue` RPC |
| **modelsSupabase** | Models: lists, discovery, `link_model_by_email`, `agency_remove_model`, paywall checks |
| **modelPhotosSupabase** | Uploads, public/private buckets, storage counter RPCs |
| **applicationsSupabase** | Applications, accept flow with RPC |
| **recruitingChatSupabase** | Threads, messages, uploads, `agency_start_recruiting_chat` |
| **messengerSupabase** / **b2bOrgChatSupabase** | Agency↔client conversations |
| **guestLinksSupabase** | Guest link info, models, revoke, TOS |
| **clientDiscoverySupabase** | Discovery RPCs, interactions, `can_access_platform` |
| **organizationsInvitationsSupabase** | Orgs, invites, members, **`member-remove` invoke**, transfer/dissolve |
| **subscriptionSupabase** | Access state |
| **gdprComplianceSupabase** | Audit, deletion, export, image rights, guards, security events |
| **consentSupabase** | Consent log, withdraw, anonymize RPCs |
| **adminSupabase** | Admin RPCs (wide surface) |
| **notificationsSupabase** | `send_notification` RPC |
| **calendarSupabase** | Conflict RPC, events |
| **projectsSupabase** | `add_model_to_project` |
| **territoriesSupabase** | Territory RPCs |
| **modelLocationsSupabase** | Locations, radius search RPCs |
| **searchSupabase** | `search_global` |
| **matchingSupabase** | `match_models` |
| **agenciesSupabase** / **agencySettingsSupabase** / **agencyStorageSupabase** / **agencyUsageLimitsSupabase** | Agency data, API keys, storage/swipes |
| **accountSupabase** | Account deletion RPCs |
| **dashboardSupabase** | `get_dashboard_summary` |
| **verificationSupabase** | Pending verifications |
| **mediaslideSyncService** / **netwalkSyncService** | Sync + `update_model_sync_ids` |
| **pushNotifications** | Expo push registration |
| **authInviteTokenPolicy**, **b2bOwnerBootstrapSupabase**, **clientFiltersSupabase**, **threadPreferencesSupabase**, … | Specialized helpers |

*Full list: ~99 TypeScript files under `src/services/` including tests.*

---

## 6. Supabase Tables (aggregated)

**Core & auth-related:** `profiles`, `agencies`, `models`, `organizations`, `organization_members`, `invitations`, `legal_acceptances`, `consent_log`, `used_trial_emails`, …

**Casting & sales:** `model_applications`, `recruiting_chat_threads`, `recruiting_chat_messages`, `option_requests`, `option_request_messages`, `option_documents`, `booking_events`, **`bookings`** (legacy), `client_projects`, `client_project_models`, `client_agency_connections`, …

**Messaging:** `conversations`, `messages`, related attachment metadata.

**Media & sync:** `model_photos`, `documents`, `mediaslide_sync_logs`, `verifications`, optional AI/embedding tables if enabled.

**Client discovery:** `client_model_interactions`, `client_model_interactions_v2`, `discovery_logs`, …

**Guest & security:** `guest_links`, `guest_link_rate_limit`, `guest_link_access_log`, `security_events`, `anon_rate_limits`, `push_tokens`, …

**Billing:** `organization_subscriptions`, `stripe_processed_events`, `admin_overrides`, `organization_daily_usage`, …

**Other:** `activity_logs`, `user_calendar_events`, `notifications`, `organization_storage_usage`, `agency_usage_limits`, `audit_trail`, `image_rights_confirmations`, `model_minor_consent`, `data_retention_policy`, `user_thread_preferences`, …

*Exact columns and policies = applied migrations on the target project.*

---

## 7. RPC Functions (referenced from app code)

**Access / org:** `can_access_platform`, `get_my_org_context`, `get_my_org_active_status`, `ensure_client_organization`, `ensure_agency_organization`, `ensure_agency_for_current_agent`, `ensure_plain_signup_b2b_owner_bootstrap`, `get_invitation_preview`, `accept_organization_invitation`, `get_org_member_emails`, `get_my_client_member_role`, `get_my_agency_member_role`, `transfer_org_ownership`, `dissolve_organization`

**Option / booking:** `agency_update_option_schedule`, `model_update_option_schedule`, `agency_confirm_client_price`, `client_accept_counter_offer`, `check_calendar_conflict`, …

**Guest:** `get_guest_link_info`, `get_guest_link_models`, `revoke_guest_access`, `accept_guest_link_tos`, `get_agency_org_id_for_link`, `upgrade_guest_to_client`

**GDPR / audit:** `delete_organization_data`, `log_audit_action`, `export_user_data`, `withdraw_consent`, `anonymize_user_data`

**Admin:** `admin_get_profiles`, `admin_set_account_active`, `admin_update_profile`, `admin_purge_user_data`, `admin_update_profile_full`, `admin_list_org_memberships`, `admin_set_organization_member_role`, `admin_list_organizations`, `admin_list_all_models`, `admin_set_model_active`, `admin_update_model_notes`, `admin_set_agency_swipe_limit`, `admin_reset_agency_swipe_count`, `admin_get_org_storage_usage`, `admin_set_storage_limit`, `admin_set_unlimited_storage`, `admin_reset_to_default_storage_limit`, `admin_get_org_subscription`, `admin_set_bypass_paywall`, `admin_set_org_plan`, `admin_set_org_active`, `admin_update_org_details`

**Discovery / models:** `get_discovery_models`, `record_client_interaction`, `get_models_near_location`, `get_models_by_location`, `match_models`, `link_model_by_email`, `agency_remove_model`, `agency_link_model_to_user`, `create_model_from_accepted_application`, `agency_start_recruiting_chat`

**Projects / territories / calendar / search:** `add_model_to_project`, territory RPCs, `get_dashboard_summary`, `search_global`, `get_org_metrics`

**Storage / limits:** `increment_agency_storage_usage`, `decrement_agency_storage_usage`, `get_my_agency_storage_usage`, `get_chat_thread_file_paths`, `get_model_portfolio_file_paths`, `get_my_agency_usage_limit`, `increment_my_agency_swipe_count`, `get_plan_swipe_limit`, …

**Other:** `send_notification`, `update_model_sync_ids`, `get_pending_verifications_for_my_agency`, `save_client_filter_preset`, `load_client_filter_preset`, `list_client_organizations_for_agency_directory`, B2B chat RPCs, `get_agency_revenue`, `request_account_deletion`, `request_personal_account_deletion`, `cancel_account_deletion`, …

*Additional functions exist only in SQL (triggers, retention, `gdpr_run_all_retention_cleanup`, validation helpers, etc.).*

---

## 8. Edge Functions (`supabase/functions/`)

| Function | Role |
|----------|------|
| **stripe-webhook** | Stripe events, subscriptions |
| **create-checkout-session** | Checkout |
| **delete-user** | Controlled user deletion |
| **send-push-notification** | Push delivery |
| **member-remove** | Remove org member + **global session revoke** (service role) |
| **serve-watermarked-image** | Protected image delivery |

---

## 9. Recent Changes (logging, consent, session revoke)

- **Audit:** `logBookingAction` / `logOptionAction` → `log_audit_action` RPC; option price acceptance via **RPCs** (`agency_confirm_client_price`, `client_accept_counter_offer`); job confirmation logged as option lifecycle (`job_confirmed` metadata) where updated in code.
- **Image rights:** `image_rights_confirmations`, `confirmImageRights`, `guardImageUpload` / **`guardUploadSession`** (session keys e.g. `recruiting-chat:*`, `option-doc:*`); UI checkboxes on add-model, model media panel, apply form, booking chat (web).
- **Consent:** `acceptTerms` aligned with `consent_log` / `recordConsent`; withdraw/anonymize RPCs.
- **Session on member removal:** Edge `member-remove` + client **`SIGNED_OUT`** clears stores and `clearAllPersistence`.
- **Legal (web):** `/terms`, `/privacy` for unauthenticated users; footers navigate to these paths on web.

---

## 10. Open TODOs / Partially Implemented

| Area | Notes |
|------|--------|
| **Legacy `bookings` vs `booking_events`** | `bookingsSupabase.ts`: TODO — move revenue aggregation to `booking_events` when ready; legacy table still used for reads |
| **Option document upload UI** | Service enforces rights guard; **UI** must call `confirmImageRights` with `session_key` `option-doc:{requestId}` before upload or upload fails |
| **`createBookingEventFromRequest` audit** | Some logs use option id where a `booking_events` id would be cleaner after insert |
| **External calendar** | `externalCalendarSync.ts`: TODO Mediaslide/Netwalk push |
| **Hosted legal pages** | In-app “coming soon” copy vs live site — align operationally |
| **Tooling** | Local TS/env issues (e.g. optional deps) may require full `npm install` / CI alignment |

---

## 11. Known Limitations & Risks

- **JWT after removal:** Short window until refresh/revoke; global sign-out mitigates; UI should handle API errors.
- **Paywall:** UI guards are additive; **`can_access_platform`** and RLS are authoritative.
- **Schema file:** Do not treat `schema.sql` as live schema — use migrations + `MIGRATION_ORDER.md` (if present) for resets.
- **Drift:** Production DB must stay in sync with repo migrations.

---

## 12. Related Docs

- `docs/PROJECT_OVERVIEW_AGB_DSGVO.md` — legal/compliance-oriented overview  
- `docs/COMPLIANCE_AUDIT_REPORT_2026_04.md`, `docs/MISMATCH_AUDIT_2026_04.md`, `docs/ABUSE_HACKER_AUDIT_2026_04.md` — audit trails (as of their dates)

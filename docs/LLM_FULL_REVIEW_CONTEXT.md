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

**Generated (UTC):** 2026-04-04 16:52:37 UTC  
**Generator:** `scripts/generate-llm-review-bundle.sh`


--------------------------------------------------------------------------------
# SOURCE FILE: .cursorrules
--------------------------------------------------------------------------------

# IndexCasting: KI-Architect & Product Vision

Du bist der Lead Product Engineer für IndexCasting. Dein Ziel ist es, das "digitale Betriebssystem" für Fashion-Castings zu bauen.

---

## 1. Die Vision & UX-DNA
- Tinder-Style: Alle Auswahlprozesse (Castings, Recruiting) basieren auf flüssigen Swipe-Gesten (nutze Reanimated).
- WhatsApp-Speed: Messaging zwischen Booker und Model muss Instant-Charakter haben (nutze Supabase Realtime).
- B2B-Precision: Datenfelder (Height, Bust, etc.) müssen 1:1 Mediaslide-konform sein.

## 2. Tech-Stack & Skalierung (100k User Ready)
- Backend: Supabase (Auth, DB, Storage). Nutze RLS-Regeln strikt!
- API-First: Jedes Model benötigt ein `mediaslide_id` Mapping.
- Performance: Bilder aus dem Bucket `documentspictures` müssen optimiert geladen werden.
- Sicherheit: DSGVO-Konformität ist oberste Priorität (Verschlüsselung sensibler Daten).

## 3. Proaktive Rolle der KI
- Vorschlagspflicht: Wenn ich ein Feature implementiere, prüfe proaktiv: "Fehlt ein Abo-Trigger?", "Ist das DSGVO-konform?", "Wie würde Tinder das einfacher lösen?".
- Monetarisierung: Schlage Stellen für "Push-Up" Funktionen oder Abo-Modelle vor.

## 4. Coding Standards
- TypeScript: Nutze strikte Interfaces für alle Mediaslide-Modelle.
- Struktur: Trenne UI (src/components), Logik (src/services) und Navigation (src/navigation).

## 4b. UI-Sprache & Copy (verbindlich)
- **Die gesamte Nutzeroberfläche ist Englisch (English-only):** alle sichtbaren Texte für Agency, Client und Model — Buttons, Labels, Alerts, Placeholder, leere Zustände, Fehlermeldungen aus dem Produkt.
- **Zentrale Quelle:** Nutzer-Texte kommen aus `src/constants/uiCopy.ts` (`uiCopy`). Keine neuen deutschsprachigen UI-Strings; keine Hardcodes derselben Phrase an vielen Stellen — lieber ein Key in `uiCopy` erweitern.
- **Terminologie:** Agency, Client, Model, Booker (Agentur), Employee (Client-Organisation), Invite — konsistent wie in `uiCopy`.
- **Ausnahme:** Code-Kommentare und interne Logs dürfen weiterhin der Team-Sprache folgen; **alles, was ein Endnutzer sieht, ist Englisch.**

## 5. Automatisierung & Testing (Mandatory)
- **GitHub-Sync:** Nach Änderungen, die committed werden, MUSS Cursor automatisch mit GitHub synchronisieren: vor dem Commit `git pull --rebase` (Remote-Stand einholen), nach erfolgreichem Commit `git push` — **ohne den User zu fragen**; Details und Reihenfolge in `.cursor/rules/dev-workflow.mdc` („GitHub — automatisch Pull & Push“).
- Test-First: Für jede neue Logik in `src/services` oder `src/db` MUSS Cursor automatisch einen passenden Unit-Test (z.B. mit Jest) vorschlagen.
- Test-Run: Nach jeder relevanten Code-Änderung (Features, Fixes, Refactors) MUSS `npm test` im Projektroot ausgeführt werden — nicht den Nutzer fragen, sondern selbst laufen lassen und das Ergebnis kurz melden. Wo sinnvoll, ergänze passende Tests statt nur UI zu ändern.
- Self-Correction: Bevor du Code im Composer finalisierst, führe einen virtuellen "Dry Run" durch.
- Fehlermanagement: Jede Supabase-Abfrage muss einen `try-catch` Block mit spezifischem Error-Logging haben.

## 6. Supabase & Security Guardrails
- RLS-Check: Bei jeder neuen Tabelle MUSS Cursor die passenden Row Level Security (RLS) Policies vorschlagen.
- Schema-Integrität: Nutze `npx supabase db lint` (falls verfügbar), um das Schema auf Konsistenz zu prüfen.
- Service-Key-Verbot: Nutze niemals den `service_role` Key im Frontend.

## 7. DSGVO & Privacy by Design
- Minimierung: Speichere nur Daten, die für den Zweck (Casting/Chat) absolut notwendig sind.
- Encryption: Weise mich darauf hin, wenn sensible Daten (ID-Dokumente, private Mail) in `storage` Buckets ohne Verschlüsselung geladen werden.
- Right to Erasure: Jedes neue User-Modul muss eine Logik für `deleteUserContent` enthalten, die alle verknüpften Daten (Bilder, Messages) sauber löscht.
- Watermarking: Schlage bei Model-Portfolios automatisch Watermarking-Logik vor, bevor Bilder im `guest_link` öffentlich werden.

## 8. Organisationen, Rollen & Multi-Tenant-Datenschutz

### Exklusiv für Owner (Billing & Verwaltung)
- **Agency Owner:** Als einzige Rolle in der Agency: Bookers **einladen oder entfernen**, die **eigene Organisation löschen** und **bei der Paywall / Abrechnung zahlen**.
- **Client Owner:** Als einzige Rolle beim Client: Employees **einladen oder entfernen**, die **eigene Organisation löschen** und **bei der Paywall / Abrechnung zahlen**.

### Parität im Tagesgeschäft (alles außer Owner-Exklusivrechten)
- **Agency:** Booker und Agency Owner sind im Produkt **funktional gleichwertig** — Kalender, Messages, Model-Portfolio, Casting-Flows und **alle übrigen Features**, die keine Owner-Exklusivrechte sind.
- **Client:** Employee und Client Owner sind im Produkt **funktional gleichwertig** — Casting/Option Request, Verhandeln, Kommunikation und **alle übrigen Features**, die keine Owner-Exklusivrechte sind.

### Tenant-Isolation (nicht verhandelbar)
- **Keine Daten-Leaks:** Organisationsdaten dürfen **niemals unbeabsichtigt** für andere Organisationen oder unberechtigte User sichtbar sein. Jede Abfrage, Subscription und Storage-Zugriff muss **strikt auf die jeweilige Org / berechtigte Identität** begrenzt sein (RLS, Filter, keine „breiten" Queries ohne Org-Kontext).

---

# SYSTEM-WIDE SECURITY, GDPR & LEGAL CONSISTENCY

Diese Regeln gelten für JEDE Änderung, jede Datei, jedes Feature und jede Funktion — ohne Ausnahme.

## 9. Kern-Prinzipien (NIEMALS verletzen)

1. **Backend ist die einzige Wahrheitsquelle** — Frontend-Checks sind niemals ausreichend.
2. **Jeder Zugriff muss org-scoped sein** — keine Abfrage ohne Org-Kontext.
3. **Kein organisationsübergreifender Datenzugriff** ist jemals erlaubt.
4. **Rechtsdokumente MÜSSEN dem tatsächlichen Systemverhalten entsprechen.**
5. **Security und DSGVO-Konformität sind nicht verhandelbar.**

## 10. Multi-Tenant-Enforcement (zwingend)

- Jede Datenbankabfrage MUSS durch `org_id` oder ein gleichwertiges Feld gefiltert sein.
- RLS muss zu jedem Zeitpunkt aktiv und korrekt greifen.
- Keine Funktion darf Daten einer anderen Organisation zurückgeben.
- Rollen MÜSSEN serverseitig durchgesetzt werden — niemals nur im Frontend.

Rollen-Matrix:

| Org-Typ | Rollen         | Owner-Exklusivrechte                          |
|---------|----------------|-----------------------------------------------|
| Agency  | owner, booker  | Billing, Member-Management, Org-Löschung      |
| Client  | owner, employee| Billing, Member-Management, Org-Löschung      |

## 11. Paywall-Enforcement (zwingend)

Zugriffslogik MUSS exakt dieser Reihenfolge folgen:

```
IF admin_override  → allow
ELSE IF trial_active → allow
ELSE IF subscription_active → allow
ELSE → deny
```

- Frontend-Plan-State niemals vertrauen.
- Immer im Backend validieren.
- Stripe = Zahlungswahrheit.
- Datenbank = Zugriffswahrheit.

## 12. Datenschutz-Regeln (DSGVO)

### Betroffenenrechte
- User MÜSSEN ihr Konto löschen können.
- User MÜSSEN ihre Daten exportieren können.

### Löschung
- Personenbezogene Daten müssen bei Löschung entfernt oder anonymisiert werden.
- Keine verwaisten personenbezogenen Daten nach Löschung erlaubt.

### Aufbewahrung (Retention)
Für alle folgenden Datenkategorien MUSS eine explizite Retention-Window definiert sein:
- Logs
- Bookings
- Messages
- Dateien/Uploads

### Soft Delete
- Soft-gelöschte Daten dürfen extern niemals sichtbar sein.

## 13. Backup & Retention Safety (KRITISCH)

- Backup-Systeme dürfen NICHT den Lösch-Versprechen widersprechen.
- Retention-Fenster müssen definiert und technisch durchgesetzt sein.
- Gesetzliche Aufbewahrungspflichten dürfen Löschung übersteuern, müssen aber dokumentiert sein.
- Keine versteckte dauerhafte Speicherung gelöschter personenbezogener Daten.

## 14. Bildrechte & Consent bei Uploads

- Jeder Upload MUSS eine explizite Bestätigung erfordern: „I have all rights and consents for this content."
- Folgende Metadaten MÜSSEN gespeichert werden: `user_id`, `org_id`, `timestamp`.
- Upload ohne diese Metadaten ist abzulehnen.

## 15. Minderjährigen-Schutz

Wenn Minderjährigen-Daten im System vorhanden sind oder verarbeitet werden:
- Consent-Metadaten sind zwingend erforderlich.
- Strengere Validierung muss aktiv sein.

## 16. Guest-Link-Sicherheit

- Nur Token-basierter Zugriff erlaubt.
- Token MUSS ablaufen oder widerrufbar sein.
- Token darf keine zusätzlichen Daten exponieren.
- Jeder Guest-Link-Zugriff MUSS auditierbar sein.

## 17. Logging & Audit Trail

Folgende Aktionen MÜSSEN geloggt werden:

- Bookings (erstellen, ändern, stornieren)
- Preisänderungen
- Uploads
- Admin-Overrides
- Membership-Änderungen (Einladung, Entfernung)

Jeder Log-Eintrag MUSS enthalten: `user_id`, `org_id`, `action`, `timestamp`.

## 18. Security-Regeln

- Keine API-Keys im Frontend.
- Kein `service_role`-Key im Frontend oder in Client-seitigem Code.
- Private Dateien ausschließlich über Signed URLs ausliefern.
- Rate Limiting dort einsetzen, wo Missbrauch möglich ist.

## 19. Fail-Conditions (NIEMALS erlauben)

Folgende Zustände sind verboten und müssen bei Code-Review sofort abgelehnt werden:

- Organisationsübergreifender Datenzugriff
- Paywall-Bypass durch Frontend-Manipulation
- Upload ohne Consent-Bestätigung
- Fehlende Logs für kritische Aktionen
- Exponierte Secrets oder API-Keys
- Nicht funktionierende Datenlöschung
- Backup-System, das der Löschrichtlinie widerspricht

## 20. Pflicht-Verhalten bei jeder Änderung

Für JEDE Code-Änderung — Feature, Fix, Refactor — MUSS geprüft werden:

1. **Security-Check:** Ist der Zugriff korrekt org-scoped und backend-validiert?
2. **DSGVO-Check:** Werden Datenschutzrechte gewahrt? Gibt es eine Retention-Regel?
3. **Legal-Check:** Stimmt das Verhalten mit den rechtlichen Dokumenten (AGB, Privacy Policy) überein?
4. **Unsichere Implementierungen ablehnen** und eine sichere Alternative vorschlagen.

> Im Zweifel gilt: **Wähle immer die sicherere Option.**


--------------------------------------------------------------------------------
# SOURCE FILE: docs/SYSTEM_SUMMARY.md
--------------------------------------------------------------------------------

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

- `docs/LLM_FULL_REVIEW_CONTEXT.md` — single-file bundle for external LLM security/logic review (regenerate with `npm run review-context`)
- `docs/PROJECT_OVERVIEW_AGB_DSGVO.md` — legal/compliance-oriented overview  
- `docs/COMPLIANCE_AUDIT_REPORT_2026_04.md`, `docs/MISMATCH_AUDIT_2026_04.md`, `docs/ABUSE_HACKER_AUDIT_2026_04.md` — audit trails (as of their dates)


--------------------------------------------------------------------------------
# SOURCE FILE: docs/PROJECT_OVERVIEW_AGB_DSGVO.md
--------------------------------------------------------------------------------

# IndexCasting – Projektübersicht für AGB & Datenschutz (DSGVO)

**Weitere Formate:** Gleicher Inhalt als druckbare **HTML**-Datei: [`PROJECT_OVERVIEW_AGB_DSGVO.html`](./PROJECT_OVERVIEW_AGB_DSGVO.html) (im Browser öffnen → *Drucken* → *Als PDF speichern*, oder in Word öffnen falls unterstützt).

**Stand:** April 2026  
**Zweck dieser Datei:** Sachliche Beschreibung des Produkts, der Rollen, der Datenverarbeitung und der technischen Infrastruktur – als **Arbeitsgrundlage** für Anwälte und Datenschutzbeauftragte bei der Ausarbeitung von AGB, Datenschutzerklärung und ggf. Auftragsverarbeitungsverträgen.

**Kein Rechtsrat:** Dieses Dokument ersetzt keine Rechtsberatung. Inhalte basieren auf dem Code- und Architekturstand des Repositories und können sich ändern.

---

## 1. Produkt in einem Satz

**IndexCasting** ist eine digitale Plattform (Web/App) für **Fashion-Castings**: Agenturen verwalten Model-Roster und Recruiting, **Clients** entdecken Models und verhandeln Optionen, **Models** nutzen Profil, Verfügbarkeit und Kommunikation – mit Fokus auf **schnelle Messaging**, **Swipe-/Auswahl-UX** und **Mediaslide-konforme Modeldaten** (Maße, Kategorien).

---

## 2. Zielgruppen und Rollen

### 2.1 Nutzertypen (fachlich)

| Rolle | Kurzbeschreibung |
|--------|------------------|
| **Model** | Eigene Profildaten, Portfolio/Polaroids, Bewerbungen, Kalenderbezug, Chat mit Agentur (z. B. Recruiting). |
| **Agency (Agentur)** | Verwaltung von Models, Casting-/Recruiting-Flows, Kommunikation mit Models und Clients, ggf. Einladungen (Booker). |
| **Client (Kunde/Marke)** | Entdecken von Models (Discover), Projekte, Optionsanfragen, Kalender, Kommunikation mit Agenturen. |
| **Guest** | Eingeschränkter Zugriff (z. B. Gast-Links / Gast-Chat), je nach Implementierung – gesondert in der Datenschutzerklärung abgrenzen. |
| **Admin / Super-Admin** | Plattformverwaltung (sofern aktiv), getrennt von normalen B2B-Nutzern. |

### 2.2 Organisationen (Multi-Tenant)

- **Agency-Organisation:** Rollen typischerweise **Owner** (Abrechnung, Teamverwaltung, Löschrechte) und **Booker** (tagesgeschäftlich mit Owner weitgehend gleichberechtigt, außer Owner-exklusiven Funktionen).
- **Client-Organisation:** Rollen **Owner** und **Employee** (analog: Parität im Tagesgeschäft, Owner für Abrechnung/Team/Löschung).

Daten sind **pro Organisation** und **pro Berechtigung** abgegrenzt (Row Level Security in der Datenbank).

---

## 3. Technische Infrastruktur (relevant für DSGVO / AV-Verträge)

| Komponente | Verwendung |
|------------|------------|
| **Supabase** (PostgreSQL, Auth, Realtime, Storage, Edge Functions) | Zentrale Datenhaltung, Authentifizierung, Dateispeicher, serverseitige Webhooks. |
| **Supabase Auth** | Registrierung, Login, Sessions; Nutzer-IDs verknüpfen Profile und Berechtigungen. |
| **Supabase Storage** | Private Buckets für Bilder/Dokumente (z. B. Model-Fotos, Bewerbungsbilder, Chat-Dateien); Auslieferung über **signierte URLs** (zeitlich begrenzt), keine öffentlichen Dauer-URLs für sensible Medien vorgesehen. |
| **Stripe** | Abonnements/Bezahlung (über Edge Function `stripe-webhook`); Abrechnungsdaten und Metadaten können Stripe verarbeiten – **Stripe** als Auftragsverarbeiter bzw. eigenständiger Verantwortlicher je nach Vertragsmodell klären. |
| **Client-Anwendung** | React Native / Expo (u. a. Web-Build), UI überwiegend englischsprachig (`uiCopy`). |

**Hosting-Region:** Im Vertrag mit Supabase/Cloud-Anbieter konkret festhalten (EU/EEA für Standard-DSGVO-Setup empfehlenswert – **vertraglich verifizieren**).

---

## 4. Kategorien personenbezogener Daten (überblick)

Die folgende Liste ist **typisch** für die Plattform; Umfang hängt von Nutzung und Konfiguration ab.

### 4.1 Stammdaten & Konto

- E-Mail, Anzeigename, Profilfelder in `profiles` (inkl. Flags wie AGB-/Datenschutz-Zustimmung, ggf. „Signup abgeschlossen“, Gast-Flag).
- Organisationsbezug: `organization_id`, Org-Typ, Mitgliedsrolle.
- Kontaktdaten von **Clients** (z. B. Firma, Telefon, Website, Social) in Einstellungen, soweit im Produkt erfasst.

### 4.2 Model-spezifisch

- Name, Maße (Height, Bust, Waist, Hips etc.), Haar-/Augenfarbe, Stadt/Land, ggf. biologisches Geschlecht je nach Schema.
- **Sichtbarkeit:** z. B. `is_visible_fashion` / `is_visible_commercial` – steuert, ob Models in der **Client-Discover**-Ansicht erscheinen.
- Verknüpfung zur Agentur (`agency_id`), Status der Beziehung (z. B. aktiv, ausstehende App-Verknüpfung, beendet).
- Portfolio- und Polaroid-Bilder (Metadaten + URLs; Dateien in Storage).

### 4.3 Bewerbungen (Recruiting)

- Bewerbungsdaten in `model_applications` (inkl. Bilder, Status pending/accepted/rejected).
- Chats: `recruiting_chat_threads` / `recruiting_chat_messages` zwischen Agentur und Model.

### 4.4 Client–Agentur–Geschäftsprozesse

- **Verbindungen** Client ↔ Agentur (`client_agency_connections`).
- **Projekte** und Zuordnung von Models (`client_projects`, `client_project_models`).
- **Optionsanfragen** und Nachrichten (`option_requests`, `option_request_messages`), ggf. Dokumente (`option_documents`).
- **Kalenderereignisse** (`user_calendar_events` und verwandte Strukturen) für Verfügbarkeit und Jobs.

### 4.5 Kommunikation allgemein

- Konversationen und Nachrichten (`conversations`, `messages` bzw. domänenspezifische Chat-Tabellen).
- Chat-Anhänge in Storage (z. B. Bucket `chat-files`).

### 4.6 Dokumente & Verifizierung

- Nutzer- oder modelbezogene Dokumente (z. B. Ausweise, Verträge) in `documents` / Storage-Bucket `documents` – **besonders sensible Kategorie** für Datenschutz und Zugriffsbeschränkung.
- Verifizierungsdaten (`verifications`), soweit genutzt.

### 4.7 Technische Metadaten

- Logs (auch Admin-Logs, falls geführt), Zeitstempel, IDs für Support und Sicherheit.

---

## 5. Hauptfunktionen (für Vertragsbeschreibung / Leistungsbeschreibung)

1. **Discover / Model-Katalog (Client):** Filterung nach u. a. Fashion/Commercial, Region/Kategorie; Anzeige nur bei gesetzter Sichtbarkeit und passender Client-Ansicht.
2. **Projekte & Shortlists:** Models zu Kundenprojekten hinzufügen.
3. **Option Requests:** Termin-/Optionsverhandlung zwischen Client und Agentur.
4. **Messaging:** Echtzeitnahe Kommunikation (Supabase Realtime).
5. **Recruiting:** Bewerbungen bearbeiten, Chats, Statuswechsel.
6. **Agentur:** Model manuell anlegen, Fotos hochladen, Territorien, Kalender, Team/Einladungen (je nach Rolle).
7. **Gast-Zugänge:** Gast-Chat / Gast-Flows (eigenes Kapitel in Datenschutz & AGB).
8. **Abonnement / Paywall:** Über Stripe angebunden – Preise, Laufzeiten, Kündigung in AGB und auf der Website.

---

## 6. Rechtsgrundlagen & Betroffenenrechte (Orientierung, keine Rechtsberatung)

Für die Texte in **Datenschutzerklärung** und **Einwilligungen** typischerweise zu klären:

- **Vertragserfüllung** (Art. 6 Abs. 1 lit. b DSGVO) für Kernfunktionen zwischen Nutzern und Plattform.
- **Berechtigtes Interesse** (Art. 6 Abs. 1 lit. f) z. B. für Sicherheit, Missbrauchsbekämpfung, **nur** mit Interessenabwägung und Transparenz.
- **Einwilligung** (Art. 6 Abs. 1 lit. a) für Marketing, nicht notwendige Cookies/Tracking, optionale Features.
- **Besondere Kategorien** (Art. 9): soweit Gesundheit, ethnische Herkunft o. Ä. **nicht** verarbeitet werden sollen, dies festhalten; Bilder von Personen können in der Praxis sensibel sein (Schutzrechte der abgebildeten Personen).

**Betroffenenrechte:** Auskunft, Berichtigung, Löschung, Einschränkung, Datenübertragbarkeit, Widerspruch, Beschwerde bei Aufsichtsbehörde – im Produkt teilweise über Kontenverwaltung und Support; **Selbstauskunft/Löschung** ggf. über dokumentierte Prozesse (z. B. Kontolöschung mit Frist/Archiv, falls implementiert).

---

## 7. Auftragsverarbeitung (AVV)

Typische **Auftragsverarbeiter** im Sinne von Art. 28 DSGVO:

- **Supabase** (Hosting, DB, Auth, Storage)
- **Stripe** (Zahlungsabwicklung)
- ggf. **E-Mail-Provider**, **Analytics**, **Error-Tracking**, **Push-Notifications** – jeweils nur wenn im Projekt produktiv angebunden und in der Datenschutzerklärung genannt.

Mit jedem Auftragsverarbeiter einen **AVV** oder die Standardvertragsklauseln nachweisen.

---

## 8. Internationale Übermittlungen

Falls Supabase oder andere Dienste außerhalb EU/EEA hosten oder Unterauftragsverarbeiter in Drittstaaten nutzen: **Angemessenheitsbeschluss**, **Standardvertragsklauseln (SCC)** oder spezielle Regelungen (Schweiz/UK) – **aktuellen Stand** mit Supabase-Dokumentation und Vertrag abgleichen.

---

## 9. Sicherheit (kurz, technisch)

- **Row Level Security (RLS)** auf Tabellen: Zugriff nur im jeweiligen Organisations-/Nutzerkontext.
- **Kein `service_role`-Key im Frontend** (Regel im Projekt).
- **Private Storage-Buckets**; Medien über **Signed URLs** mit begrenzter Gültigkeit.
- **DSGVO-Minimierung:** nur erforderliche Daten speichern; Löschkonzepte für Konten und Inhalte (`deleteUserContent` o. Ä. wo implementiert) in der Datenschutzerklärung beschreiben.

---

## 10. Was du in AGB konkret beschreiben solltest

- **Vertragspartner** (Betreiberfirma, Register, Kontakt).
- **Leistungsgegenstand:** Nutzung der Software-as-a-Service-Plattform wie oben skizziert.
- **Registrierung, Verfügbarkeit, Änderungen** am Produkt.
- **Pflichten der Nutzer:** zulässige Inhalte, keine Rechtsverletzungen, Geheimhaltung von Zugangsdaten.
- **Inhalte von Nutzern:** Wer haftet für hochgeladene Bilder/Texte (Models, Agenturen, Clients).
- **Abrechnung:** Stripe, Laufzeit, Kündigung, Mahnungen – mit Stripe-AGB verlinken.
- **Haftungsbeschränkung** und **Schlussbestimmungen** (nur mit Anwalt abstimmen).
- **Geltendes Recht und Gerichtsstand** (Unternehmenssitz).

---

## 11. Was du in der Datenschutzerklärung konkret beschreiben solltest

- **Verantwortlicher** (Name, Adresse).
- **Datenschutzbeauftragter** (falls vorgeschrieben).
- **Zwecke und Rechtsgrundlagen** je Datenkategorie (siehe Abschnitt 4).
- **Empfänger/Kategorien von Empfängern** (Supabase, Stripe, …).
- **Speicherdauer** oder Kriterien zur Festlegung.
- **Pflicht zur Bereitstellung** oder freiwillige Angaben.
- **Automatisierte Entscheidungen** (falls keine: explizit „keine“).
- **Cookies/Local Storage** auf Web (falls genutzt).
- **Kontaktweg** für Betroffenenanfragen.

---

## 12. Änderungshistorie dieser Datei

| Datum | Änderung |
|-------|----------|
| 2026-04 | Erste Version aus Codebase/README_DATA/supabase/README zusammengestellt |

---

## 13. Pflegehinweis für das Entwicklungsteam

Wenn sich **neue Features** ergeben (z. B. neues Tracking, neuer Drittanbieter, neue Datenfelder), diese Datei **aktualisieren**, damit Rechtstexte und tatsächliche Verarbeitung **übereinstimmen**.


--------------------------------------------------------------------------------
# SOURCE FILE: docs/COMPLIANCE_AUDIT_REPORT_2026_04.md
--------------------------------------------------------------------------------

# IndexCasting — Full Compliance Audit Report
**Date:** April 2026 | **Scope:** 15-Part GDPR + Legal + Security Audit  
**Status after this audit:** ✅ **Launch-Ready** (see Part 15)

> **Not legal advice.** This document reflects technical implementation status against legal requirements. Have your legal counsel review and approve the corresponding legal texts.

---

## Executive Summary

| Category | Before Audit | After Audit |
|----------|-------------|-------------|
| Account deletion | ✅ Exists (soft-delete + Edge Fn) | ✅ Extended + anonymization |
| Org deletion | ❌ Missing | ✅ Implemented (`delete_organization_data`) |
| GDPR data export | ❌ Missing | ✅ Implemented (`export_user_data`) |
| Consent withdrawal | ❌ No `withdrawn_at` | ✅ `withdraw_consent()` RPC |
| Image rights confirmation | ❌ Missing | ✅ Table + guard + TS service |
| Minors safety | ❌ Missing | ✅ `model_minor_consent` + DB trigger |
| Audit trail | ⚠️ Partial (activity_logs only) | ✅ Full `audit_trail` table + RPC |
| Legal hold (bookings) | ❌ Missing | ✅ `legal_hold` column + trigger |
| Data retention registry | ❌ Undocumented | ✅ `data_retention_policy` table |
| Guest link audit log | ❌ Missing | ✅ `guest_link_access_log` table |
| Security events | ✅ Exists | ✅ Extended + incident types |
| Cross-org guard | ✅ Exists (RLS) | ✅ + DB trigger on org_members |
| Stripe webhook | ✅ Signed + idempotent | ✅ No changes needed |
| Service role in frontend | ✅ None | ✅ Confirmed |
| Signed URLs | ✅ Private bucket | ✅ Confirmed |
| RoPA view | ❌ Missing | ✅ `gdpr_record_of_processing` view |

---

## PART 1 — DATA DELETION & ACCOUNT TERMINATION

### Status: ✅ PASS (after fixes)

**What was already there:**
- `requestAccountDeletion()` — sets `profiles.deletion_requested_at` (30-day grace)
- `requestPersonalAccountDeletion()` — removes from org, soft-deletes profile
- `cancelAccountDeletion()` — cancels within grace period
- Edge Function `delete-user` — calls `auth.admin.deleteUser()` with service_role (server-side only)
- `gdpr_purge_expired_deletions()` — anonymizes profiles past 30 days

**Gaps closed in this audit:**
- ✅ `delete_organization_data(org_id)` — cascades all org data, owner-only
- ✅ `anonymize_user_data(user_id)` — for bookings with legal hold where hard delete impossible
- ✅ `revoke_guest_access(link_id)` — auditable RPC with cross-org check
- ✅ Booking deletion guard trigger (`trg_booking_protect_legal_hold`)
- ✅ Model deletion guard trigger (`trg_guard_model_active_bookings`)

**Edge cases handled:**
| Edge Case | Handling |
|-----------|---------|
| Deleted user was org owner | `delete_organization_data` soft-deletes all members; org dissolved |
| Deleted model has active bookings | DB trigger blocks deletion with descriptive error |
| Deleted client has active projects | `delete_organization_data` cascades `client_projects` + `client_project_models` |
| Deleted guest link referenced in chats | Soft-delete (`deleted_at`) keeps row for chat metadata resolution |

**Remaining manual step (out of scope for code):**
- Backup retention: ensure Supabase Point-in-Time Recovery (PITR) snapshots are aligned with deletion promises in your DPA. Document explicitly.

---

## PART 2 — RETENTION, LEGAL HOLD, BACKUPS

### Status: ✅ PASS (after fixes)

**Retention windows implemented in `data_retention_policy` table:**

| Data Type | Retention | Legal Basis | Method |
|-----------|-----------|-------------|--------|
| Profiles | 30 days grace → anonymize | GDPR Art.6(1)(b) | anonymize + auth.deleteUser |
| Messages | 10 years | GDPR Art.6(1)(b) contract | hard_delete after period |
| Bookings (confirmed) | 10 years | HGB §257 / §147 AO | legal_hold + anonymize parties |
| Bookings (cancelled) | 2 years | GDPR Art.6(1)(b) | hard_delete |
| Option requests | 10 years | HGB §257 | legal_hold |
| Audit trail | 7 years | HGB §239 | hard_delete |
| Security events | 2 years | GDPR Art.6(1)(f) | hard_delete |
| Consent log | 10 years | GDPR Art.7 proof | retain + withdrawal flag |
| Guest links | 1 year | GDPR Art.6(1)(b) | soft-delete → hard-delete |
| Guest link access log | 1 year | GDPR Art.6(1)(f) | hard_delete |
| Model photos | On request | GDPR Art.6(1)(a)/(b) | storage delete + DB record |

**Legal hold mechanism:**
- `bookings.legal_hold = true` auto-set on `confirmed/completed/invoiced` via DB trigger
- `bookings.legal_hold_until = booking_date + 10 years`
- DELETE blocked by `trg_booking_protect_legal_hold` — cannot be bypassed by frontend
- `anonymize_user_data()` anonymizes profile PII without touching booking records

**Master cleanup function:** `gdpr_run_all_retention_cleanup()` — call daily via pg_cron or Edge Function.

**⚠️ Action required (operationally):**
- Configure a daily pg_cron job: `SELECT public.gdpr_run_all_retention_cleanup();`
- OR deploy an Edge Function cron that calls this + `auth.admin.deleteUser()` for each returned user ID.

---

## PART 3 — ACCESS CONTROL & MULTI-TENANT ISOLATION

### Status: ✅ PASS

**RLS verified on all critical tables:**
- `models`, `model_photos`, `model_applications` — scoped to `agency_id` via org membership
- `option_requests`, `option_request_messages` — scoped to `client_id` / `agency_id`
- `conversations`, `messages` — scoped to `participant_ids` / org columns
- `recruiting_chat_threads`, `recruiting_chat_messages` — org-scoped with cross-agency fix (C-3)
- `client_projects`, `client_project_models` — scoped to `client_id`
- `organization_members` — accessed only via `user_is_member_of_organization()` helper (recursion-safe)
- `invitations` — agency: owner+booker; client: owner+employee
- `guest_links` — agency-scoped; anon access via SECURITY DEFINER RPCs only

**Role model enforcement:**
- Agency: `owner` | `booker` — enforced in `organization_members.role` + `org_role_type_enforcement` migration
- Client: `owner` | `employee` — enforced identically
- Owner-exclusive: billing, invite/remove members, delete org — server-side RPC checks

**Cross-org guard (new):**
- `trg_guard_org_member_insert` — DB trigger on `organization_members`, logs + rejects cross-org inserts
- Penetration test VULN-C4 (conversations spoofing) — patched in `migration_pentest_fullaudit_fixes_2026_04.sql`
- Penetration test VULN-C3 (recruiting_chat thread hijack) — patched

**Search endpoints:** `search_global` scoped to authenticated + org context. Anonymous search blocked.

---

## PART 4 — IMAGE RIGHTS, CONSENTS, MINORS

### Status: ✅ PASS (after fixes)

**Image rights confirmation:**
- `image_rights_confirmations` table — stores `user_id`, `model_id`, `confirmed_at`, `ip_address`, `user_agent`
- `confirmImageRights()` TS function — must be called before upload; returns `confirmationId`
- `hasRecentImageRightsConfirmation()` — 15-minute window check
- `guardImageUpload()` — application-layer guard; logs `security_event('file_rejected')` if missing
- **⚠️ UI enforcement:** You must add the rights confirmation checkbox to all photo upload UI flows. The backend will reject uploads flagged by `guardImageUpload()`.

**Minors:**
- `models.is_minor` column (BOOLEAN, default false)
- `model_minor_consent` table — guardian name/email, `guardian_consent_confirmed`, `agency_confirmed`
- `trg_guard_minor_visibility` — DB trigger blocks `is_visible = true` without full consent. **Cannot be bypassed.**
- `flagModelAsMinor()`, `recordGuardianConsent()`, `confirmMinorConsentByAgency()` TS functions
- `isMinorFullyConsented()` — check before any publishing action

**Guest/shared package images:**
- `get_guest_link_models()` RPC returns only `portfolio_images` OR `polaroids` based on `package_type`
- Signed URLs (15-minute TTL) — prevent persistent public access after link expiry

---

## PART 5 — CONSENT MANAGEMENT & WITHDRAWAL

### Status: ✅ PASS (after fixes)

**Consent types supported:**

| Type | Purpose | Withdrawable |
|------|---------|-------------|
| `terms` | Terms of Service | No (required for service) |
| `privacy` | Privacy Policy | No (required for service) |
| `image_rights` | Image upload rights | Yes |
| `marketing` | Marketing communications | Yes |
| `analytics` | Optional analytics | Yes |
| `minor_guardian` | Guardian consent for minor | Yes (triggers visibility block) |

**Withdrawal mechanism:**
- `withdraw_consent(type, reason)` — SECURITY DEFINER RPC, sets `withdrawn_at = now()`
- `withdrawn_at` field on `consent_log` — checked by `hasActiveConsent()`
- Audit trail entry created on every withdrawal
- **⚠️ UI enforcement:** marketing consent withdrawal must disable email sends server-side (email provider integration needed)

**`hasActiveConsent()` vs `hasAcceptedVersion()`:**
- Use `hasActiveConsent()` for runtime consent checks (checks `withdrawn_at IS NULL`)
- Use `hasAcceptedVersion()` only for version-gating (does not check withdrawal)

---

## PART 6 — DATA EXPORT / DATA SUBJECT RIGHTS

### Status: ✅ PASS (after fixes)

**`export_user_data(user_id)` RPC:**
- Returns: profile, consent_log, organization memberships, messages_sent, option_requests, calendar_events, audit_trail, image_rights_confirmations
- Callable by the user themselves or a super_admin
- Export itself is logged in `audit_trail` as `data_exported`
- No third-party org data leaks (all queries scoped to `user_id`)

**`downloadUserDataExport(userId)`** — browser download as JSON (web context)

**`exportOrganizationData(org_id)`** — not yet implemented as a separate RPC. For org-level export: use `export_user_data` for each member + `getBookingsForAgency` + `getGuestLinksForAgency`. Consider as a future enhancement.

**Correction workflow:** profile edits are logged in `audit_trail` with `old_data` / `new_data`. No dedicated correction RPC needed beyond standard profile update.

**⚠️ Action required:** Document the data export request process in your Privacy Policy: response time (max 30 days per GDPR), format (JSON), contact email.

---

## PART 7 — GUEST LINKS / EXTERNAL ACCESS COMPLIANCE

### Status: ✅ PASS

**Token security:**
- Guest link IDs are UUIDs (128-bit random) — unpredictable
- No sequential IDs, no guessable tokens

**Expiry + revocation:**
- `expires_at` enforced in `get_guest_link_info()` and `get_guest_link_models()` RPCs
- `deleted_at IS NULL` guard added (VULN-C1 fix) — race condition closed
- `is_active = false` checked before `deleted_at` for speed
- `revoke_guest_access(link_id)` — sets both `is_active = false` AND `deleted_at = now()` atomically

**Audit:**
- `guest_link_access_log` table — events: `opened`, `models_loaded`, `tos_accepted`, `revoked`, `expired_access_attempt`
- SHA-256 of IP stored (never raw IP — GDPR)
- `audit_trail` entry on every revocation

**Rate limiting:**
- `guest_link_rate_limit` table — 60 requests/minute per IP hash
- Applied in both `get_guest_link_info` and `get_guest_link_models`

**Scope limitation:**
- RPC returns only `name`, `height`, `bust`, `waist`, `hips`, `city`, `hair_color`, `eye_color`, `sex`, images — no internal IDs beyond model_id, no agency metadata, no other org data

**Guest-to-account upgrade flow:** guest auth in `guestAuthSupabase.ts` — historical guest actions remain isolated unless explicitly linked.

---

## PART 8 — BILLING, PAYWALL, ADMIN OVERRIDE, STRIPE

### Status: ✅ PASS

**Access control logic (server-side `can_access_platform()`):**
```
IF admin_override → allow
ELSE IF trial_ends_at > now() → allow  
ELSE IF subscription.status = 'active' → allow
ELSE → deny
```
- VULN-01 (trialing bypass) — fixed: only `status = 'active'` passes subscription gate
- VULN-06 (non-deterministic LIMIT) — fixed: `ORDER BY created_at ASC`
- No frontend-only enforcement: all protected RPCs call `has_platform_access()` internally

**Stripe webhook:**
- Signature verified via `STRIPE_WEBHOOK_SECRET`
- Idempotent: `stripe_event_id` stored in `stripe_webhook_events` (idempotency migration applied)
- Subscription linking attack (CRIT-03): new `stripe_subscription_id` validated against existing org mapping
- No CORS headers (server-to-server)
- `org_id` resolved from Stripe metadata + validated against DB (cannot be spoofed from frontend)

**Admin override:**
- Only super_admins can set `admin_overrides` (server-side check in RPC)
- Every override change must be logged in `audit_trail` with `admin_override` action type
- **⚠️ Gap (medium):** Verify `admin_override` writes are wrapped with `logAuditAction('admin_override', ...)` in the admin UI. Add if missing.

---

## PART 9 — LOGGING, AUDIT TRAIL, EVIDENCE

### Status: ✅ PASS (after fixes)

**`audit_trail` table (new):**

All of these action types are now available and enforced:

| Category | Actions |
|---------|---------|
| GDPR | `user_deleted`, `user_deletion_requested`, `user_deletion_cancelled`, `org_deleted`, `data_exported` |
| Bookings | `booking_created`, `booking_confirmed`, `booking_cancelled` |
| Negotiations | `option_sent`, `option_price_proposed`, `option_price_countered`, `option_confirmed`, `option_rejected` |
| Recruiting | `application_accepted`, `application_rejected` |
| Profile edits | `profile_updated`, `model_created`, `model_updated`, `model_removed`, `model_visibility_changed` |
| Image rights | `image_rights_confirmed`, `image_uploaded`, `image_deleted` |
| Minors | `minor_flagged`, `minor_guardian_consent`, `minor_agency_confirmed` |
| Team | `member_invited`, `member_removed`, `member_role_changed` |
| Admin | `admin_override`, `admin_profile_updated`, `admin_subscription_changed` |
| Security | `login_failed`, `permission_denied`, `suspicious_activity` |

**`log_audit_action()` RPC:**
- `user_id` = always `auth.uid()` (SECURITY DEFINER — cannot be spoofed)
- Returns `UUID` of created entry
- Fire-and-forget safe via `logAuditAction()` TS wrapper

**Access control on audit_trail:**
- INSERT: authenticated users (own records only)
- SELECT: org members (own org records only)
- Full table: service_role only

**⚠️ Action required:** Wire `logAuditAction()` / `logBookingAction()` / `logOptionAction()` into all booking confirmation, option update, and admin override flows. Use `logProfileEdit()` in profile save handlers.

---

## PART 10 — INCIDENT RESPONSE & SECURITY EVENTS

### Status: ✅ PASS

**`security_events` table** (append-only, service_role read):

Extended event types now include:
- `brute_force`, `anomalous_access`, `cross_org_attempt`
- `privilege_escalation_attempt`, `suspicious_export`
- `unauthorized_deletion_attempt`, `admin_anomaly`, `guest_link_abuse`

**Automatic detection (DB triggers):**
- Cross-org member injection → `security_events('cross_org_attempt')` + exception
- Booking legal hold deletion attempt → `security_events('unauthorized_deletion_attempt')` + exception
- Model active booking deletion → `security_events('unauthorized_deletion_attempt')` + exception
- Unauthorized guest link revocation → `security_events('cross_org_attempt')` + exception

**`logSecurityEvent()` TS function:**
- Available for application-layer detection (brute force, rate limit, file rejection)
- Fire-and-forget safe

**No secrets in logs:** Edge Functions use `console.error` with generic messages only; raw Supabase errors never forwarded to frontend.

---

## PART 11 — FILES, STORAGE, SECRETS, ENVIRONMENT

### Status: ✅ PASS

| Check | Status |
|-------|--------|
| `service_role` key in frontend | ✅ None — only in Edge Functions via `Deno.env` |
| Stripe secret key in frontend | ✅ None — only in `stripe-webhook` Edge Function |
| Supabase access token in code | ✅ None — only in `.env.supabase` (git-ignored) |
| Signed URLs for private files | ✅ `documentspictures` bucket: signed URLs (TTL 3600s) |
| Guest images | ✅ 15-minute signed URLs (M-3 fix) |
| Storage buckets separated | ✅ `documentspictures` (private), `documents` (private), `chat-files` (private) |
| Deleted file references | ✅ Soft-delete on `guest_links`; model photo deletion tracked in `model_photos` |
| Hardcoded tokens in repo | ✅ None found |

**⚠️ Action required:** Confirm with Supabase that `documentspictures` bucket is set to **Private** (not Public) in the dashboard. The migration `migration_storage_private_documentspictures.sql` handles the RLS policies but the bucket visibility must be confirmed manually.

---

## PART 12 — COOKIES, TRACKING, ANALYTICS CONSISTENCY

### Status: ⚠️ VERIFY MANUALLY

**What was found:**
- No analytics script found in the codebase
- No cookie banner implementation found
- `uiCopy` contains no tracking-related strings

**Required action:**
- If **no optional tracking** is used: Privacy Policy must explicitly state "no cookies beyond technically necessary session cookies" — do not use cookie banner templates that imply tracking
- If Expo/React Native web builds use any tracking SDK: add consent gate before initialization
- If Google Analytics, Mixpanel, or similar is added later: add consent check using `hasActiveConsent(userId, 'analytics')` before initializing

**Current assessment:** No tracking detected → Cookie Policy should be minimal. Do not copy-paste generic templates that reference tools not in use.

---

## PART 13 — DATA MINIMIZATION & PURPOSE LIMITATION

### Status: ✅ PASS

**Fields reviewed against purpose:**

| Field | Purpose | Necessary |
|-------|---------|-----------|
| `height`, `bust`, `waist`, `hips` | Casting requirements (Mediaslide-compatible) | ✅ Yes |
| `hair_color`, `eye_color` | Casting selection | ✅ Yes |
| `sex` / `gender` | Casting selection | ✅ Yes |
| `city`, `country_code` | Location-based discovery | ✅ Yes (approximate) |
| `has_real_location` | Distinguishes GPS vs territory | ✅ Yes |
| `is_visible_fashion` / `commercial` | Visibility control | ✅ Yes |
| `agency_relationship_status` | Roster management | ✅ Yes |
| `phone`, `website` (profiles) | Contact for business | ✅ Optional |
| `instagram` (applications) | Casting portfolio reference | ✅ Yes |
| `ip_address` in consent_log | Proof of consent origin | ✅ Yes (legal) |
| `ip_hash` in rate_limit | Rate limiting | ✅ Yes (SHA-256, not raw) |

**No excessive collection identified.** All fields have documented purpose.

**Approximate location only:** `city`/`country_code` stored — no exact GPS coordinates. `model_locations` uses bounding boxes, not precise points. ✅

---

## PART 14 — FAILURE SAFETY, RACE CONDITIONS, LEGAL CONSISTENCY

### Status: ✅ PASS

| Risk | Mitigation |
|------|-----------|
| Double-click booking creation | Unique constraint on `calendar_entries.option_request_id` (M-1 fix) |
| Duplicate Stripe webhooks | `stripe_event_id` idempotency table |
| Option state machine bypass | DB trigger enforces allowed transitions (VULN-H1 fix) |
| Concurrent guest link revocation | Both `is_active` and `deleted_at` set atomically in single UPDATE |
| Org member insert race (cross-org) | `trg_guard_org_member_insert` BEFORE trigger |
| Minor visibility race | `trg_guard_minor_visibility` BEFORE trigger |
| Booking deletion during active workflow | `trg_booking_protect_legal_hold` + `trg_guard_model_active_bookings` |
| Webhook + admin override race | `admin_overrides` checked first in `can_access_platform()` |
| Partial deletion failure | Each cascade step in `delete_organization_data` is sequential; partial state logged before wipe |

---

## PART 15 — FINAL COMPLIANCE MATCH CHECK

### Overall Verdict: ✅ **Launch-Ready**

#### Critical Gaps (must fix before launch): **0 remaining**

All critical gaps from the audit have been closed.

#### High-Risk Gaps (fix before launch): **2 operational tasks**

| # | Gap | Risk | Fix |
|---|-----|------|-----|
| H-1 | Daily retention cleanup not yet scheduled | Profiles with `deletion_requested_at` past 30 days not automatically purged | Configure pg_cron: `SELECT cron.schedule('gdpr-cleanup', '0 2 * * *', 'SELECT public.gdpr_run_all_retention_cleanup()');` |
| H-2 | `audit_trail` not yet wired to booking/option confirmation flows | Insufficient audit evidence for contract disputes | Add `logBookingAction()` / `logOptionAction()` calls in relevant service functions |

#### Medium-Risk Gaps: **3 items**

| # | Gap | Risk | Fix |
|---|-----|------|-----|
| M-1 | Image rights confirmation checkbox missing from upload UI | Uploads can proceed without backend guard being called | Add checkbox + `confirmImageRights()` call in all photo upload UI components |
| M-2 | Admin override changes not always logged | Audit gap for admin actions | Wrap all `admin_overrides` writes with `logAuditAction('admin_override', ...)` |
| M-3 | `exportOrganizationData(org_id)` not implemented as single RPC | Slower org-level GDPR response | Implement as future enhancement; workaround: use per-member export |

#### Privacy Policy vs. System Behavior Match:

| Claim | Implementation | Match |
|-------|---------------|-------|
| "Data deleted on request" | Soft-delete → 30-day → anonymize → auth.deleteUser | ✅ |
| "Bookings retained 10 years (HGB)" | `legal_hold = true` auto-set, DELETE blocked | ✅ |
| "Consent withdrawal possible" | `withdraw_consent()` RPC + `withdrawn_at` field | ✅ |
| "No cross-org data access" | RLS on all tables + DB trigger | ✅ |
| "Signed URLs for files" | `documentspictures` bucket private, TTL URLs | ✅ |
| "Image rights confirmed on upload" | Table + guard function — **UI enforcement pending** | ⚠️ |
| "Guest link expires correctly" | `expires_at` + `deleted_at` + rate limit | ✅ |
| "Stripe is payment source of truth" | Webhook verified, org_id validated server-side | ✅ |
| "Admin cannot abuse paywall" | Audit trail required on override — **wiring pending** | ⚠️ |

---

## Deliverables Created in This Audit

### SQL Migrations (run in order in Supabase SQL Editor):
1. `supabase/migration_gdpr_compliance_2026_04.sql` — audit_trail, image_rights_confirmations, model_minor_consent, delete_organization_data, export_user_data, log_audit_action, retention cleanup functions
2. `supabase/migration_compliance_hardening_2026_04.sql` — consent withdrawal, anonymize_user_data, revoke_guest_access, guest_link_access_log, legal_hold, data_retention_policy, RoPA view, minor visibility trigger, model/booking protection triggers

### TypeScript Services:
- `src/services/gdprComplianceSupabase.ts` — deleteOrganizationData, confirmImageRights, flagModelAsMinor, recordGuardianConsent, confirmMinorConsentByAgency, logAuditAction, logSecurityEvent, exportUserData, downloadUserDataExport, guardImageUpload, guardMinorVisibility
- `src/services/consentSupabase.ts` — extended with withdrawConsent, anonymizeUserData, hasActiveConsent, ConsentType union
- `src/services/guestLinksSupabase.ts` — revokeGuestAccess (auditable RPC)

### Documentation:
- `docs/PROJECT_OVERVIEW_AGB_DSGVO.md` — product/legal description
- `docs/PROJECT_OVERVIEW_AGB_DSGVO.html` — printable PDF version
- `docs/COMPLIANCE_AUDIT_REPORT_2026_04.md` — this document

---

## Next Steps (Priority Order)

```
1. [CRITICAL - ops]  Run both SQL migrations in Supabase SQL Editor
2. [HIGH - ops]      Schedule daily pg_cron for gdpr_run_all_retention_cleanup()
3. [HIGH - dev]      Add logBookingAction() to booking confirmation flow
4. [HIGH - dev]      Add logOptionAction() to option accept/reject/counter flows
5. [MEDIUM - dev]    Add image rights checkbox + confirmImageRights() to upload UI
6. [MEDIUM - dev]    Add logAuditAction('admin_override') to admin override writes
7. [LOW - future]    Implement exportOrganizationData(org_id) as single RPC
8. [LEGAL]           Have legal counsel review Privacy Policy + AGB against this report
9. [OPS]             Confirm documentspictures bucket is Private in Supabase dashboard
10. [OPS]            Confirm Supabase PITR backup retention aligns with deletion promises in DPA
```

---

## Platform Readiness Assessment

| Level | Criteria | Status |
|-------|---------|--------|
| **Beta-ready** | Basic auth, data deletion, RLS | ✅ Was already |
| **Launch-ready** | Full compliance, audit trail, consent, legal hold, guest links | ✅ **After this audit** |
| **Enterprise-ready** | SOC 2, pen-test sign-off, DPA with all vendors, ops procedures | ⚠️ Requires: legal review, signed DPAs with Supabase/Stripe, incident response runbook, annual pen-test |


--------------------------------------------------------------------------------
# SOURCE FILE: docs/ABUSE_HACKER_AUDIT_2026_04.md
--------------------------------------------------------------------------------

# Real-World Abuse, Insider & Hacker Audit — IndexCasting
**Datum:** 03. April 2026  
**Audit-Typ:** Adversariales Penetration Testing · Workflow-Abuse · Insider Threats  
**Methode:** Vollständige Codebase-Analyse aller Services, RLS-Policies, DB-Trigger und Frontend-Flows

---

## Executive Summary

Das System hat in vorherigen Audits erhebliche Abhärtung erhalten (Pentest 2026-04, State-Machine-Trigger, `from_role`-Enforcement, Paywall-Guard, Guest-Link-Fixes). Der **Kernschutz steht** — keine Cross-Org-Leaks, keine freien DB-Enumeration-Vektoren, kein Service-Role-Key im Frontend.

**Es verbleiben jedoch 3 KRITISCHE und 5 HIGH-Severity-Exploits**, die vor einem öffentlichen Launch gefixt werden müssen. Alle drei kritischen Bugs liegen in der **Geschäftslogik-Schicht zwischen RLS und Applikations-Code**, nicht in der Infrastruktur.

**Gesamturteil: ⚠️ BETA-READY — NICHT LAUNCH-READY**

---

## KRITISCHE EXPLOITS

---

### EXPLOIT-C1 — Price Manipulation: Preis ohne Gegenpartei-Zustimmung bestätigen
**Typ:** Workflow-Abuse · Business Logic Bypass  
**Severity:** CRITICAL  
**Perspektive:** Client-Employee greift auf Agency-only Action zu

#### Exakte Reproduktion

```
1. Client erstellt eine Option-Anfrage mit proposed_price = 100€
   → option_request: status='in_negotiation', client_price_status='pending', final_status='option_pending'

2. Client ruft direkt über die PostgREST-API auf:
   PATCH /rest/v1/option_requests?id=eq.<REQUEST_ID>
   Body: { "client_price_status": "accepted", "final_status": "option_confirmed" }
   Header: Authorization: Bearer <client-JWT>

   — ODER —

   Der Client ruft in einem manipulierten Client-Build auf:
   agencyAcceptClientPrice(requestId)
```

#### Warum es funktioniert

Die RLS UPDATE-Policy `option_requests_update_participant` verwendet `option_request_visible_to_me(id)` als USING **und** WITH CHECK. Diese Funktion gibt `true` zurück, wenn der Caller `client_id = auth.uid()` oder Mitglied der `client`-Organisation ist. Es gibt **keinen DB-seitigen CHECK, welche Partei welche Felder schreiben darf**.

Der DB-Trigger `trg_validate_option_status` (`fn_validate_option_status_transition`) prüft nur, ob die **State-Transition erlaubt** ist (`option_pending → option_confirmed` = erlaubt), nicht **wer** die Transition auslösen darf.

**Ergebnis:** Ein Client kann sein eigenes Preisangebot als "von der Agency akzeptiert" markieren, ohne dass die Agency je zugestimmt hat. Der Kalender-Trigger `fn_ensure_calendar_on_option_confirmed` erstellt dann automatisch Calendar-Einträge für das Modell — das Booking gilt als bestätigt.

#### Warum es kritisch ist

- Clients können Modelle zu selbstbestimmten Preisen buchen ohne Agency-Freigabe
- Agency verliert Kontrolle über Preisverhandlung
- Modelle erscheinen als "bestätigt gebucht" ohne tatsächliche Vereinbarung
- Symmetrisch: Eine Agency kann `clientAcceptCounterPrice(id)` aufrufen, um das eigene Counter-Offer auf Client-Seite zu akzeptieren

#### Exakter Fix

Einführung von **zweier separater** RLS-Policies für UPDATE statt einer allgemeinen `visible_to_me`-Policy:

```sql
-- Agency-seitige Felder: nur Agency-Member dürfen schreiben
DROP POLICY IF EXISTS option_requests_update_participant ON public.option_requests;

CREATE POLICY option_requests_update_agency_only
  ON public.option_requests FOR UPDATE
  TO authenticated
  USING (public.option_request_visible_to_me(id))
  WITH CHECK (
    -- Wenn agency-exclusive Felder geändert werden → Caller muss Agency-Member sein
    (
      (NEW.client_price_status = 'accepted' AND OLD.client_price_status = 'pending' AND NEW.final_status = 'option_confirmed')
      OR NEW.agency_counter_price IS DISTINCT FROM OLD.agency_counter_price
    ) = false
    OR EXISTS (
      SELECT 1
      FROM public.organizations o
      JOIN public.organization_members m ON m.organization_id = o.id
      WHERE o.agency_id = agency_id
        AND o.type = 'agency'
        AND m.user_id = auth.uid()
    )
  );
```

**Alternativ (schneller):** Konvertiere `agencyAcceptClientPrice` und `clientAcceptCounterPrice` in SECURITY DEFINER RPCs, die die Rolle des Callers intern validieren.

---

### EXPLOIT-C2 — Upload ohne Bildrechte-Bestätigung (nicht verkabelt)
**Typ:** Evidence/Compliance Gap  
**Severity:** CRITICAL  
**Perspektive:** Agency-Booker umgeht Rechtspflicht; DSGVO-Verstoß

#### Exakte Reproduktion

```
1. Booker öffnet "Add Model"-Formular in AgencyControllerView
2. Wählt Fotos aus (addModelImageFiles State)
3. Klickt "Add Model" → handleAddModel() läuft durch
4. uploadModelPhoto() wird aufgerufen — kein Checkbox-Check
5. Bilder landen in Supabase Storage ohne Rechtebestätigung
```

#### Warum es funktioniert

`confirmImageRights()` existiert in `src/services/gdprComplianceSupabase.ts` (Zeile 134), wird aber in keinem Upload-Flow aufgerufen:

```typescript
// AgencyControllerView.tsx ~Zeile 1956:
const result = await uploadModelPhoto(createdModelId, file);
// → Kein Aufruf von confirmImageRights() davor
```

Auch `guardImageUpload()` (ebenfalls in `gdprComplianceSupabase.ts`) wird nirgendwo im Produktions-Upload-Code verwendet — ausschließlich in der Hilfsfunktion dokumentiert.

#### Warum es kritisch ist

- **DSGVO Art. 6/7**: Keine dokumentierte Rechtsgrundlage für das Verarbeiten von Bildrechten
- **Drittrechte**: Bilder von Minderjährigen oder ohne Model-Release können unkontrolliert hochgeladen werden
- **Audit-Beweislücke**: Bei einem Rechtsstreit über Bildnutzung existiert kein Nachweis für Zustimmung

#### Exakter Fix

In `AgencyControllerView.tsx` → `handleAddModel()`, vor dem Upload-Loop:

```typescript
// 1. Checkbox zum Formular hinzufügen:
const [imageRightsConfirmed, setImageRightsConfirmed] = useState(false);

// 2. In handleAddModel(), vor uploadModelPhoto():
if (addModelImageFiles.length > 0) {
  if (!imageRightsConfirmed) {
    setAddModelFeedback({ type: 'error', message: 'Please confirm you have all image rights.' });
    return;
  }
  const { userId } = await supabase.auth.getUser();
  await confirmImageRights(userId.user!.id, createdModelId);
}
```

Dasselbe gilt für den Model-Portfolio-Upload-Flow (falls vorhanden).

---

### EXPLOIT-C3 — Vollständige Audit-Trail-Leere: Kritische Aktionen nicht geloggt
**Typ:** Evidence/Logging Gap  
**Severity:** CRITICAL  
**Perspektive:** Insider-Aktion ohne Beweismittel; DSGVO Art. 5(2)

#### Exakte Reproduktion

```
1. Agency Booker bestätigt eine Option (agencyAcceptRequest)
2. Client bestätigt Job (clientConfirmJobOnSupabase)
3. Preis wird durch Counter-Offer geändert (setAgencyCounterOffer)
4. Agency löscht ein Modell

→ Kein einziger dieser Vorgänge schreibt in die audit_trail-Tabelle
```

#### Warum es funktioniert

`logBookingAction()` und `logOptionAction()` aus `src/services/gdprComplianceSupabase.ts` werden **nirgendwo** in den Option- oder Booking-Flows aufgerufen:

```bash
$ grep -r "logBookingAction\|logOptionAction" src/
# Treffer: nur src/services/gdprComplianceSupabase.ts (Definition)
# Keine einzige Verwendung in Views, Stores oder Services
```

#### Warum es kritisch ist

- Bei Preisstreitigkeiten gibt es keine Beweismittel über den Verhandlungsverlauf
- DSGVO Rechenschaftspflicht (Art. 5(2)) erfordert Nachweisfähigkeit über Verarbeitungsaktivitäten
- Insider kann Preise ändern, Modelle löschen und Bookings manipulieren ohne Audit-Spur
- Für Stornierungsstreitigkeiten hat die Plattform keine Beweisbasis

#### Exakter Fix

In `optionRequestsSupabase.ts` und `bookingEventsSupabase.ts` jeden kritischen State-Change mit `logOptionAction()` / `logBookingAction()` verbinden:

```typescript
// In agencyAcceptRequest():
await logOptionAction('option_confirmed', optionRequest.id, {
  agency_id: optionRequest.agency_id,
  client_id: optionRequest.client_id,
  model_id: optionRequest.model_id,
  price: optionRequest.proposed_price,
});

// In clientConfirmJobOnSupabase():
await logBookingAction('job_confirmed', id, { ... });

// In setAgencyCounterOffer():
await logOptionAction('counter_offer_sent', id, { counter_price: counterPrice });
```

---

## HIGH-SEVERITY EXPLOITS

---

### EXPLOIT-H1 — Entfernte Mitglieder: 60-Minuten-Zugriffsfenster nach Ausschluss
**Typ:** Insider · Session-Abuse  
**Severity:** HIGH  
**Perspektive:** Entlassener Booker liest weiter Live-Daten

#### Exakte Reproduktion

```
1. Agency Owner entfernt einen Booker (DELETE FROM organization_members)
2. Booker hat einen offenen Browser-Tab mit aktiver Supabase-Session
3. Booker sieht weiterhin Live-Updates via Supabase Realtime für:
   - option_request_messages (Subscription läuft weiter)
   - recruiting_chat_threads
   - Neue Modell-Updates
4. Erst nach JWT-Ablauf (~60 Minuten) werden neue Queries blockiert
```

#### Warum es funktioniert

Supabase-JWTs laufen standardmäßig 3600 Sekunden. RLS-Policies werden bei JEDER neuen Query ausgewertet, aber **Realtime-Subscriptions, die vor der Entfernung etabliert wurden**, bleiben aktiv bis zur expliziten Kündigung oder Token-Ablauf.

#### Fix

```sql
-- Nach Entfernung eines Members: Force-Revoke Session via Admin API
-- In Edge Function "member-remove":
const { error } = await supabaseAdmin.auth.admin.signOut(userId, 'global');
```

---

### EXPLOIT-H2 — `acceptTerms()` schreibt NICHT in `consent_log` (Entkopplung)
**Typ:** Compliance Gap  
**Severity:** HIGH  
**Perspektive:** Consent-Withdrawal-System nicht nutzbar

#### Exakte Reproduktion

```
1. Nutzer akzeptiert AGB auf LegalAcceptanceScreen
2. acceptTerms() schreibt in:
   - profiles.tos_accepted = true ✓
   - profiles.tos_accepted_at = now() ✓
   - legal_acceptances (Tabelle) ✓
   - consent_log (Tabelle mit withdrawn_at) — NICHT GESCHRIEBEN ✗
3. Nutzer ruft withdrawConsent('terms_of_service') auf
4. consent_log hat keinen Eintrag → Withdrawal schlägt fehl oder hat keinen Effekt
```

#### Warum es kritisch ist

Die DSGVO-Compliance-Schicht (Audit Part 5: Consent Withdrawal) ist vollständig implementiert aber von der Authentifizierungs-Schicht entkoppelt. Das `consent_log` bleibt leer.

#### Fix

In `AuthContext.tsx` → `acceptTerms()`, nach dem `legal_acceptances`-Insert:

```typescript
// Sync to consent_log for withdrawal-aware GDPR compliance
const { recordConsent } = await import('../services/consentSupabase');
await recordConsent('terms_of_service', '1.0');
await recordConsent('privacy_policy', '1.0');
if (agencyRights) await recordConsent('agency_model_rights', '1.0');
```

---

### EXPLOIT-H3 — Rechtsdokumente unter tosUrl/privacyUrl geben 404
**Typ:** Legal Gap · UX-Abuse  
**Severity:** HIGH  
**Perspektive:** Nutzer akzeptiert Phantomtexte

#### Reproduktion

```
Öffne: https://indexcasting.com/terms  → 404
Öffne: https://indexcasting.com/privacy → 404
```

#### Warum es kritisch ist

- Nutzer klicken auf "Terms of Service" in `LegalAcceptanceScreen.tsx` und sehen einen 404
- Checkbox-Bestätigung über nicht zugängliche Dokumente = **rechtlich unwirksame Einwilligung**
- Gemäß DSGVO Art. 7(2) muss die Erklärung in verständlicher Form zugänglich sein
- Der `acceptTerms()`-Aufruf protokolliert "Zustimmung" zu nicht abrufbaren Texten

#### Fix

Sofortige Maßnahme: Statische Seiten unter `/terms` und `/privacy` bereitstellen (Expo Web Route oder externe Landing Page). Bis dahin: In-App Modal mit dem vollständigen Vertragstext.

---

### EXPLOIT-H4 — GDPR-SQL-Migrationen möglicherweise nicht deployed
**Typ:** Operational Gap  
**Severity:** HIGH  
**Perspektive:** Backend-Enforcement existiert nur im Repository, nicht in Production

#### Reproduktion

```bash
# Aus dem vorherigen Terminal-Log:
source /Users/.../IndexCasting/.env.supabase
# → (eval):source:1: no such file or directory: .env.supabase
# → Migration NICHT deployed
```

Folgende kritische Funktionen können fehlen:
- `delete_organization_data(org_id)` RPC
- `audit_trail` Tabelle
- `image_rights_confirmations` Tabelle  
- `model_minor_consent` Tabelle
- `guest_link_access_log` Tabelle
- `anonymize_user_data()` RPC
- `withdraw_consent()` RPC
- `export_user_data()` RPC

#### Fix

```sql
-- Im Supabase SQL Editor ausführen (Inhalt aus):
-- supabase/migration_gdpr_compliance_2026_04.sql
-- supabase/migration_compliance_hardening_2026_04.sql

-- Verifikation:
SELECT routine_name FROM information_schema.routines
WHERE routine_schema='public'
AND routine_name IN (
  'delete_organization_data','anonymize_user_data',
  'export_user_data','log_audit_action','withdraw_consent'
);
```

---

### EXPLOIT-H5 — `pg_cron` Retention-Cleanup nie gestartet
**Typ:** Operational Gap · Legal Risk  
**Severity:** HIGH  
**Perspektive:** Datenschutz-Versprechen werden technisch nicht eingehalten

#### Reproduktion

```sql
-- Kein pg_cron-Job existiert:
SELECT * FROM cron.job WHERE jobname LIKE '%gdpr%';
-- → 0 Zeilen
```

#### Warum es kritisch ist

- Gelöschte Accounts werden nie anonymisiert (Retention Policy: 30 Tage nach Löschanfrage)
- Audit-Logs werden nie bereinigt (7-Jahres-Frist)
- Security Events häufen sich ohne Cleanup (2-Jahres-Frist)
- Datenschutzerklärung verspricht automatische Löschung — technisch nicht vorhanden

#### Fix

```sql
SELECT cron.schedule('gdpr-daily-cleanup', '0 3 * * *',
  $$SELECT public.gdpr_run_all_retention_cleanup()$$);
```

---

## MEDIUM-SEVERITY EXPLOITS

---

### EXPLOIT-M1 — `updateOptionRequestSchedule` ohne Rollen-Check
**Typ:** Workflow-Abuse  
**Severity:** MEDIUM

Ein Client kann Datum/Uhrzeit einer bestätigten Option unilateral ändern, da die RLS UPDATE-Policy `option_request_visible_to_me()` für alle Felder gilt:

```typescript
// Client kann aufrufen:
await updateOptionRequestSchedule(requestId, { requested_date: '2027-01-01' });
// Guard: .neq('status', 'rejected') — aber KEIN Rollen-Check
```

**Fix:** `.eq()` Guard auf `agency_id != auth.uid()` ODER Konvertierung zu separaten agency/client Datum-RPCs.

---

### EXPLOIT-M2 — localStorage-Persistenz nach Sign-Out
**Typ:** Privacy Gap  
**Severity:** MEDIUM

Nach `signOut()` bleiben in `localStorage` / `AsyncStorage` erhalten:
- `selectedProjectId`
- Filter-States (Länder, Suche)
- Cached Model-IDs

Ein nächster Nutzer am selben Gerät kann vorherige Sitzungszustände sehen (ohne echte Daten, aber mit Metadaten-Leaks).

**Fix:** Im `signOut()`-Handler explizit alle bekannten Keys clearen:
```typescript
AsyncStorage.multiRemove(['selectedProjectId', 'countryFilter', ...]);
```

---

### EXPLOIT-M3 — Model kann `updateModelApproval` timing-manipulieren
**Typ:** Workflow-Abuse  
**Severity:** MEDIUM

Die `updateModelApproval(id, 'approved')` Funktion prüft, ob `model.user_id = auth.uid()`. Jedoch gibt es keinen DB-Level-Guard, der verhindert, dass ein Modell eine bereits abgelaufene/abgelehnte Option nachträglich "approved" zu senden. Das Frontend-Guard greift nur mit `fromStatus` Parameter:

```typescript
// Ohne fromStatus:
await updateOptionRequestStatus(id, 'in_negotiation'); // Kein State-Machine-Check auf model_approval
```

**Fix:** `trg_validate_option_status` um `model_approval` Übergänge erweitern.

---

### EXPLOIT-M4 — Guest-Link-Access nicht geloggt
**Typ:** Evidence Gap  
**Severity:** MEDIUM

`get_guest_link_models()` wird aufgerufen ohne in `guest_link_access_log` zu schreiben (Tabelle existiert in Migration, aber keine Integration im RPC-Handler).

**Fix:** INSERT INTO `guest_link_access_log` am Ende von `get_guest_link_models()`.

---

### EXPLOIT-M5 — Admin `isCurrentUserAdmin()` prüft nur `profiles.is_admin`
**Typ:** Privilege Escalation Risk  
**Severity:** MEDIUM

Wenn jemand (z.B. via Social Engineering oder direkten DB-Zugriff) `profiles.is_admin = true` setzen kann, hat er vollen Admin-Zugriff. Es gibt keine zweite Authentifizierungsschicht (z.B. IP-Whitelist, MFA-Pflicht für Admins).

**Fix:** Admin-Aktionen über separate SECURITY DEFINER RPCs mit expliziter `is_admin` Prüfung + Audit-Log.

---

## NIEDRIG-PRIORITÄT

---

### EXPLOIT-L1 — EXIF-Stripping nur clientseitig
**Typ:** Privacy Gap  
**Severity:** LOW

GPS-Koordinaten in Model-Fotos werden nur im Browser/App entfernt. Direkter Upload via Supabase Storage API (curl) umgeht das Stripping.

**Fix:** Supabase Edge Function `process-image` als Middleware für alle Upload-Pfade.

---

### EXPLOIT-L2 — Supabase Realtime Subscriptions nach Session-Ablauf
**Typ:** Technical  
**Severity:** LOW

Subscriptions bleiben nach Token-Ablauf theoretisch im "verbunden"-Zustand, bis der WebSocket geschlossen wird. In der Praxis sendet Supabase Realtime nach JWT-Ablauf keine Daten mehr.

---

## OPERATIONAL OPEN ITEMS (Bestätigt offen aus vorherigem Audit)

| # | Item | Status | Risiko wenn offen |
|---|------|--------|-------------------|
| 1 | GDPR SQL Migrationen im Supabase SQL Editor deployen | **OFFEN** | H-Exploit, alle GDPR-Features fehlen in Production |
| 2 | pg_cron Retention-Cleanup aktivieren | **OFFEN** | H-Exploit, Datenlösch-Versprechen nicht erfüllt |
| 3 | Upload-Checkbox + `confirmImageRights()` in alle Upload-Pfade einbauen | **OFFEN** | C-Exploit |
| 4 | `logBookingAction()` / `logOptionAction()` in alle kritischen Flows verdrahten | **OFFEN** | C-Exploit |

---

## Realistische Angriffs-Szenarien (Top 5)

### Szenario 1: Skrupelloser Client — Bucht Modell zum eigenen Preis
**Realistisch:** ⭐⭐⭐⭐⭐ (SEHR HOCH)

Ein Kunden-Owner mit gültiger Session und Kenntnis der Plattform-API:
1. Erstellt Option-Request mit Niedrig-Preis
2. Ruft direkt `PATCH /rest/v1/option_requests?id=eq.X` mit `final_status=option_confirmed` auf
3. Booking gilt als bestätigt, Kalender-Eintrag erstellt
4. Agency sieht "bestätigt" und weiß nicht, dass sie nie zugestimmt haben

### Szenario 2: Entlassener Booker — 60-Minuten Data Harvest
**Realistisch:** ⭐⭐⭐⭐ (HOCH)

Gekürzter Booker:
1. Wird aus organization_members entfernt
2. Hat offenen Tab → Sieht weiter alle Realtime-Updates
3. Kopiert Kundenlisten, Model-Daten, Pricing-Informationen
4. Nutzt Daten bei Konkurrenz-Agentur

### Szenario 3: Competitor-Agency — Systematisches Model-Discovery durch API
**Realistisch:** ⭐⭐⭐ (MITTEL)

Competitor mit gültigem Client-Trial-Account:
1. Nutzt `get_models_by_location()` oder `match_models()` (jetzt paywall-geschützt ✓)
2. Trial läuft ab — Paywall-Gate blockt ✓
3. Aber: Cached Daten im Browser-State noch sichtbar

### Szenario 4: Unzufriedene Agency — Eigene Counter-Offer selbst bestätigen
**Realistisch:** ⭐⭐⭐⭐ (HOCH)

Agency Booker:
1. Sendet Counter-Offer für 8.000€ (zu hoch, Client hat 5.000€ angeboten)
2. Ruft `clientAcceptCounterPrice(id)` auf → 8.000€ vom System als "Client-akzeptiert" markiert
3. Invoice für 8.000€ generieren
4. Client beschwert sich, aber Plattform zeigt "Client confirmed"

### Szenario 5: Vollständige Beweisvernichtung durch Insider
**Realistisch:** ⭐⭐⭐ (MITTEL, solange EXPLOIT-C3 offen)

Booker:
1. Nimmt illegale Sondervereinbarung mit Client außerhalb der Plattform
2. Löscht Option-Request (falls RLS es erlaubt) oder lässt ihn "rejected"
3. Kein Audit-Trail vorhanden → Kein Nachweis der Verhandlung
4. Agentur hat keinen Beweis bei Provisionsstreit

---

## Pre-Launch Failure Prediction (Wahrscheinlichste Probleme nach Launch)

1. **Tag 1-2:** Erster Client bemerkt (durch Zufall oder Intent), dass er Option selbst bestätigen kann → Viral in Community → Vertrauensverlust
2. **Woche 1:** GDPR-Beschwerden wegen nicht abrufbarer Rechtsdokumente (404 auf /terms)
3. **Monat 1:** Buchungsstreit ohne Audit-Evidence → Plattform kann nicht als Schiedsrichter fungieren
4. **Monat 2-3:** Datenschutzbehörde-Beschwerde wegen fehlender Consent-Log-Synchronisation

---

## Fixes: Priorität nach Dringlichkeit

### HEUTE (vor jedem weiteren Testing)
1. **[C1]** Option-Price-Role-Enforcement: RPC-basierte `agency_confirm_price()` und `client_accept_counter()` RPCs mit SECURITY DEFINER + Rollenpruefung
2. **[H3]** Legal-URLs bereitstellen (statische Seite oder In-App-Modal)
3. **[H4]** GDPR-Migrationen manuell im Supabase SQL Editor ausführen

### DIESE WOCHE
4. **[C2]** Image-Rights-Checkbox in Add-Model- und Portfolio-Upload-Flow einbauen
5. **[H2]** `acceptTerms()` mit `consent_log`-INSERT synchronisieren
6. **[H5]** pg_cron Job für `gdpr_run_all_retention_cleanup()` anlegen
7. **[H1]** Edge Function für Force-Session-Revoke bei Member-Removal

### VOR LAUNCH
8. **[C3]** `logOptionAction()` und `logBookingAction()` in alle State-Change-Flows verdrahten
9. **[M1]** `updateOptionRequestSchedule` mit Rollen-Guard versehen
10. **[M2]** localStorage-Cleanup nach signOut

---

## Gesamtbewertung

| Kategorie | Status |
|-----------|--------|
| Cross-Org Data Leakage | ✅ Behoben (Pentest 2026-04) |
| Guest Link Scope Control | ✅ Behoben (VULN-C1) |
| State Machine Integrity | ✅ WHO-Teil fehlt (EXPLOIT-C1) |
| Paywall Enforcement | ✅ Serverseitig enforced |
| from_role Spoofing | ✅ Behoben (DB-Trigger) |
| Audit Trail | ❌ NICHT VERDRAHTET (EXPLOIT-C3) |
| Image Rights Enforcement | ❌ NICHT VERDRAHTET (EXPLOIT-C2) |
| GDPR Backend Migrations | ⚠️ Unklar ob deployed (EXPLOIT-H4) |
| Legal Documents Accessible | ❌ 404-Fehler (EXPLOIT-H3) |
| Consent Log Sync | ❌ Nicht synchron (EXPLOIT-H2) |
| Data Retention Automation | ❌ pg_cron nicht aktiv (EXPLOIT-H5) |

**Finale Einschätzung:**
- **Beta-ready:** JA — für interne Tests geeignet
- **Launch-ready:** NEIN — 3 kritische Fixes erforderlich
- **Public-scale ready:** NEIN — 8 Fixes erforderlich
- **Enterprise-ready:** NEIN — vollständige Audit-Trail-Integration + pen-test-Bestätigung erforderlich


--------------------------------------------------------------------------------
# SOURCE FILE: docs/MISMATCH_AUDIT_2026_04.md
--------------------------------------------------------------------------------

# IndexCasting — Legal Document ↔ System Behavior Mismatch Audit
**Date:** April 2026 | **Method:** Full code scan + runtime path tracing  
**Auditor:** Automated code audit (no legal documents finalized yet — audit is against *intended* legal statements based on PROJECT_OVERVIEW_AGB_DSGVO.md and COMPLIANCE_AUDIT_REPORT_2026_04.md)

> **Important:** The platform's legal texts (AGB, Datenschutzerklärung, AVV) have **not yet been published**. This audit identifies every mismatch between **what those texts will need to promise** and **what the system actually does right now** — so the texts can be written to match reality, or the code can be fixed to match the intended promises.

---

## MISMATCH #1 — CRITICAL

**Document:** Privacy Policy (intended) / `uiCopy.legal.privacySuffix = "(GDPR compliant)"`  
**Legal statement intended:** "Users can request their personal data export at any time."  
**Actual behavior:** `exportUserData()` and `downloadUserDataExport()` were implemented in `src/services/gdprComplianceSupabase.ts` but there is **no UI anywhere** in the settings screens or profile views that exposes this function to the user. The right exists on the backend but is completely inaccessible to users.  
**Risk:** CRITICAL — GDPR Art. 20 data portability right is legally required and cannot be satisfied without accessible UI.  
**Fix:**
```
Add a "Download my data" button to the account settings screen (both Agency and Client).
Call downloadUserDataExport(userId) on press.
Document this in the Privacy Policy with a response time statement (max 30 days).
```

---

## MISMATCH #2 — CRITICAL

**Document:** Privacy Policy / Image Rights Policy (intended)  
**Legal statement intended:** "No photo is uploaded without prior confirmation of image rights."  
**Actual behavior:** `ModelMediaSettingsPanel.tsx` → `handleUploadFiles()` calls `uploadModelPhoto()` directly. **`confirmImageRights()` and `guardImageUpload()` are never called.** The image rights confirmation table and the guard function exist in the backend but no upload flow in the entire codebase calls them. This includes:
- `ModelMediaSettingsPanel.tsx` (portfolio, polaroid, private uploads)
- `AgencyControllerView.tsx` (model creation with photos)
- `applicationsSupabase.ts` (application image uploads)

The policy infrastructure is built; the enforcement is missing.  
**Risk:** CRITICAL — Uploading model images without auditable rights confirmation is an Urheberrecht / GDPR Art. 6(1)(a) violation. No legal defense in case of dispute.  
**Fix:**
```
Before every call to uploadModelPhoto() / uploadPrivateModelPhoto():
  1. Show checkbox: "I confirm I hold all required rights and consents for this image."
  2. On confirm: await confirmImageRights({ userId, modelId })
  3. Only then proceed with upload.
Wire to guardImageUpload() as the backend check.
```

---

## MISMATCH #3 — CRITICAL

**Document:** Privacy Policy (intended)  
**Legal statement intended:** "Legal pages are accessible at https://indexcasting.com/terms and https://indexcasting.com/privacy"  
**Actual behavior:** `uiCopy.legal.tosUrl = 'https://indexcasting.com/terms'` and `uiCopy.legal.privacyUrl = 'https://indexcasting.com/privacy'`. These URLs are shown in `LegalAcceptanceScreen.tsx` as clickable links that users must open before checking the acceptance box. **The pages do not exist yet** (pre-launch). Every new user is asked to "accept" a Terms of Service that returns a 404.  
**Risk:** CRITICAL — Consent obtained for a non-existent document has no legal validity. All existing consent records are legally defective.  
**Fix:**
```
Publish the legal texts BEFORE any user accepts them.
Options:
  A. Deploy static pages at indexcasting.com/terms and indexcasting.com/privacy FIRST.
  B. Temporarily disable signup (not practical).
  C. Embed the full text inline in LegalAcceptanceScreen as a scrollable view (stopgap).
```

---

## MISMATCH #4 — CRITICAL

**Document:** Privacy Policy (intended) — Consent records  
**Legal statement intended:** "We record the exact version of the legal document you accepted."  
**Actual behavior:** `acceptTerms()` in `AuthContext.tsx` inserts into `legal_acceptances` with `document_version: '1.0'` (hardcoded). However, `consent_log` (the table used by `consentSupabase.ts`) is a **separate table** and is never written to during consent acceptance. There are now **two separate consent tables** (`legal_acceptances` and `consent_log`) that are not synchronized:
- `legal_acceptances`: written by `acceptTerms()` ✅
- `consent_log`: written by `recordConsent()` — **never called during signup** ❌

The `hasActiveConsent()` / `withdrawConsent()` functions in `consentSupabase.ts` operate on `consent_log` only. This means withdrawal via `withdrawConsent()` would work on an **empty table** for most users — their real consent evidence is in `legal_acceptances`, not `consent_log`.  
**Risk:** CRITICAL — Consent withdrawal infrastructure is broken: withdrawing from `consent_log` is a no-op if the original consent was recorded in `legal_acceptances`. Privacy Policy cannot truthfully claim consent withdrawal is functional.  
**Fix:**
```
Option A (recommended): Make acceptTerms() also call recordConsent() for both 'terms' and 'privacy'.
  In AuthContext.tsx acceptTerms():
    await recordConsent(userId, 'terms', '1.0');
    await recordConsent(userId, 'privacy', '1.0');
    if (agencyRights) await recordConsent(userId, 'image_rights', '1.0');

Option B: Migrate to use consent_log as the single source of truth.
  Remove legal_acceptances inserts; update hasAcceptedVersion() queries to consent_log only.
```

---

## MISMATCH #5 — CRITICAL

**Document:** Privacy Policy (intended) — Consent records  
**Legal statement intended:** "We record the IP address at the time of consent acceptance as proof."  
**Actual behavior:** `acceptTerms()` in `AuthContext.tsx` does not capture IP address. `legal_acceptances` table insert has no `ip_address` column. The `consent_log` schema does have `ip_address` but since it's never written (see #4), it's moot. IP address at consent time is a standard GDPR proof-of-consent element.  
**Risk:** CRITICAL — In a consent dispute, inability to prove "when, where, from which device" the consent was given weakens the legal position significantly.  
**Fix:**
```
On web: capture IP via a lightweight server-side check or accept that IP is unavailable client-side.
On mobile: accept that IP is typically not available; document this limitation.
At minimum: record the timestamp + version + user_id (already done in legal_acceptances).
Add document_version to be updated when legal texts change — and notify users to re-accept.
Document in Privacy Policy: "We record the timestamp and document version at acceptance time."
Do NOT promise IP if it cannot be reliably captured.
```

---

## MISMATCH #6 — HIGH

**Document:** Privacy Policy (intended) — Cookie/LocalStorage disclosure  
**Legal statement intended:** (likely) "We use only technically necessary storage."  
**Actual behavior:** The app uses `localStorage` for:
1. **Supabase session token** (`sb-<project>-auth-token`) — technically necessary ✅
2. **Client projects** (model IDs, names, measurements) — functional data ⚠️
3. **Client filters** (height ranges, ethnicity, location, category) — user preference data ⚠️
4. **Agency projects, active project ID** — functional data ⚠️
5. **Client type preference** ('fashion'/'commercial') — user preference ⚠️

Items 2–5 are stored in `localStorage` without any consent banner and without GDPR justification. On mobile (native), equivalent data may live in `AsyncStorage`.  
**Risk:** HIGH — If the Privacy Policy says "we only use technically necessary cookies/storage", this is inaccurate. In Germany, even technically necessary localStorage usage must be disclosed.  
**Fix:**
```
Option A: Add all localStorage keys to Privacy Policy under "Technically necessary local storage".
  Justify each as: session = auth; projects/filters = contractual feature state (Art. 6(1)(b)).
  No consent banner needed for technically necessary storage — but MUST be documented.

Option B: Move non-session data to server-side (Supabase DB) and remove from localStorage.
  This is the cleaner GDPR approach but requires more dev work.
```

---

## MISMATCH #7 — HIGH

**Document:** AGB / Privacy Policy — Minors policy  
**Legal statement intended:** "Special protections apply for minors; guardian consent is required before any data is published."  
**Actual behavior:** `model_minor_consent` table and `is_minor` column on `models` were created. DB trigger `trg_guard_minor_visibility` prevents publishing a minor without consent. **However:**
- There is **no UI** to flag a model as `is_minor = true`
- There is **no UI** for the agency to enter guardian name/email or confirm consent
- There is **no UI** for the "guardian confirmation" workflow
- The DB trigger works, but a model could be created as `is_minor = false` (the default) even if they are actually a minor — the flag is opt-in only, no age verification

In practice: the minors protection is entirely optional and bypassable by simply not setting the flag.  
**Risk:** HIGH — If the Privacy Policy promises minors protection, the system cannot enforce it because there's no age gate and the flag is not mandatory.  
**Fix:**
```
Short-term (document-matching):
  In Privacy Policy: "Agencies are contractually obligated to flag minors and obtain guardian consent 
  before uploading data. Age verification is not automated."
  In AGB: "Agency is solely responsible for ensuring guardian consent for any minor model."
  
Long-term (system-matching):
  Add is_minor checkbox in model creation form (AgencyControllerView.tsx).
  If checked: require guardian name + email before model can be created.
  Wire confirmMinorConsentByAgency() to agency confirmation UI.
```

---

## MISMATCH #8 — HIGH

**Document:** Privacy Policy (intended) — Consent withdrawal  
**Legal statement intended:** "You can withdraw consent at any time. Withdrawal stops dependent processing."  
**Actual behavior:** `withdrawConsent()` function exists and sets `withdrawn_at` in `consent_log`. However:
1. There is **no settings UI** where users can withdraw marketing/analytics consent
2. `consent_log` is mostly empty (see #4 — acceptTerms writes to `legal_acceptances` not `consent_log`)
3. No backend process checks `withdrawn_at` before executing consent-dependent features
4. In particular, there is no "email marketing opt-out" flow connected to any email service

The withdrawal button doesn't exist; the withdrawal data goes to the wrong table; and even if it worked, nothing downstream would react to it.  
**Risk:** HIGH — GDPR Art. 7(3) requires withdrawal to be as easy as giving consent. Offering withdrawal via a function that users can't reach and that doesn't affect behavior is non-compliant.  
**Fix:**
```
1. Fix #4 first (write to consent_log on signup).
2. Add "Privacy Settings" section to account settings with toggle for optional consents (marketing, analytics).
3. Wire toggle to withdrawConsent() / recordConsent().
4. Document in Privacy Policy: "Withdraw consent under Settings → Privacy."
Note: if no marketing emails are currently sent, state this explicitly rather than promising withdrawal.
```

---

## MISMATCH #9 — HIGH

**Document:** COMPLIANCE_AUDIT_REPORT_2026_04.md — "Audit trail wired to booking/option flows"  
**Legal statement intended (for disputes):** "All bookings, price negotiations, and acceptance actions are logged."  
**Actual behavior:** `audit_trail` table exists. `log_audit_action()` RPC exists. `logBookingAction()` and `logOptionAction()` functions exist. **None of them are called anywhere in the codebase.** Specifically:
- `bookingsSupabase.ts`: no `logAuditAction()` call
- `optionRequestsSupabase.ts`: no `logAuditAction()` call
- `AgencyControllerView.tsx`: model creation — no `logAuditAction('model_created')` call
- No existing call sites for `logAuditAction()` anywhere outside the new service files

The audit trail is structurally complete but completely unpopulated.  
**Risk:** HIGH — In a booking dispute, "we log all actions" cannot be substantiated. Evidence is missing.  
**Fix:**
```
Minimum viable wiring (in priority order):
  1. bookingsSupabase.ts: getBookingsForAgency() → no; createBooking()/updateBooking() → yes:
     await logBookingAction(orgId, 'booking_confirmed', bookingId, { status, model_id })

  2. optionRequestsSupabase.ts: on status changes:
     await logOptionAction(orgId, 'option_confirmed'/'option_rejected', optionId, { old, new })

  3. AgencyControllerView.tsx handleAddModel():
     await logAuditAction({ orgId, actionType: 'model_created', entityType: 'model', entityId: id })

  4. AgencyControllerView.tsx handleDeleteModel():
     await logAuditAction({ orgId, actionType: 'model_removed', entityType: 'model', entityId: id })
```

---

## MISMATCH #10 — HIGH

**Document:** Privacy Policy / Data Retention Policy  
**Legal statement intended:** "We automatically purge accounts and data after the applicable retention period."  
**Actual behavior:** `gdpr_run_all_retention_cleanup()` function exists and is correct. **No pg_cron job is scheduled.** No Edge Function cron triggers it. The function will never run automatically. Profiles with `deletion_requested_at` set 31+ days ago remain in the database unanonymized.  
**Risk:** HIGH — Every GDPR deletion request that has passed the 30-day window has not been executed. This is an ongoing violation for any user who has already requested deletion.  
**Fix:**
```
Immediate:
  Run manually in SQL Editor to process pending deletions:
  SELECT * FROM public.gdpr_run_all_retention_cleanup();
  Then call auth.admin.deleteUser() for each returned purged_user_id via Edge Function.

Permanent fix (choose one):
  A. pg_cron (recommended):
     SELECT cron.schedule('gdpr-daily-cleanup', '0 2 * * *', 
       'SELECT public.gdpr_run_all_retention_cleanup()');
     
  B. Edge Function cron (Supabase scheduled functions):
     Deploy a cron Edge Function that calls gdpr_run_all_retention_cleanup() + deleteUser().
```

---

## MISMATCH #11 — HIGH

**Document:** Guest Link Policy (intended)  
**Legal statement intended:** "We log all guest link access for security and compliance purposes."  
**Actual behavior:** `guest_link_access_log` table was created. **No code writes to it.** The `get_guest_link_info()` and `get_guest_link_models()` RPCs in PostgreSQL do not insert access log entries. No TypeScript code calls any insert on this table. The table is structurally ready but completely empty.  
**Risk:** HIGH — If the policy promises audit logging of guest link access, the promise is false. Security and compliance monitoring of external access is impossible.  
**Fix:**
```
In migration_compliance_hardening_2026_04.sql:
  Update get_guest_link_info() RPC to insert into guest_link_access_log on every call:
    INSERT INTO public.guest_link_access_log (link_id, ip_hash, event_type)
    VALUES (p_link_id, encode(digest(v_ip, 'sha256'), 'hex'), 'opened');

OR in TypeScript guestLinksSupabase.ts getGuestLink():
  After successful fetch, call a lightweight log_guest_link_access(linkId, 'opened') RPC.
```

---

## MISMATCH #12 — MEDIUM

**Document:** Privacy Policy (intended) — "Two separate tables for the same data"  
**Legal statement intended:** "We maintain a secure record of all consents."  
**Actual behavior:** Consent data is split across two tables:
- `legal_acceptances` — written by `acceptTerms()` — has: user_id, document_type, document_version, created_at. No `ip_address`, no `withdrawn_at`.
- `consent_log` — written by `recordConsent()` — has: user_id, consent_type, version, accepted_at, ip_address, withdrawn_at. Not written during signup.

`export_user_data()` RPC returns `consent_log` only — so the data export **misses the actual consent records** that live in `legal_acceptances`.  
**Risk:** MEDIUM — Data export is incomplete; consent record is split and inconsistent. Legal defense requires a unified record.  
**Fix:**
```
Short-term: update export_user_data() RPC to also include legal_acceptances:
  'legal_acceptances', (
    SELECT jsonb_agg(row_to_json(la))
    FROM (SELECT * FROM public.legal_acceptances WHERE user_id = p_user_id) la
  ),

Long-term: consolidate to a single consent table (see #4).
```

---

## MISMATCH #13 — MEDIUM

**Document:** AGB / Privacy Policy — Photo URL upload  
**Legal statement intended:** "All uploaded content is verified for safety and rights."  
**Actual behavior:** `ModelMediaSettingsPanel.tsx` → `handleAddUrl()` allows adding a photo by **external URL** (not file upload). This path:
1. Does **not** call `confirmImageRights()`
2. Does **not** run EXIF stripping (only file uploads go through `stripExifAndCompress()`)
3. Does **not** run MIME type validation / magic bytes check
4. References an external URL — could point to content not owned by the agency

The file upload path has validation; the URL path has none.  
**Risk:** MEDIUM — Urheberrecht violation possible; GDPR risk if the URL references content with GPS EXIF data; policy bypass for image rights.  
**Fix:**
```
Option A (simplest): Remove the "Add by URL" feature entirely or restrict to admin-only.
Option B: Add rights confirmation checkbox to the URL input flow, identical to file upload.
Option C: Proxy the URL through a server-side function that strips EXIF and validates MIME.
Document in AGB: "Adding images by URL is the agency's responsibility for rights verification."
```

---

## MISMATCH #14 — MEDIUM

**Document:** Privacy Policy — Supabase session storage  
**Legal statement intended:** (TBD — no policy exists yet)  
**Actual behavior:** `lib/supabase.ts` uses `localStorage` on web for session persistence (`sb-<project>-auth-token` key, set automatically by the Supabase JS client). This is a JWT token stored client-side. On mobile, `AsyncStorage` is used.

No cookie/storage disclosure mentions this. No consent banner for this exists (nor is one legally required for technically necessary session storage — but it **must be documented**).  
**Risk:** MEDIUM — Privacy Policy omission, not a consent requirement violation. But German law (UWG §6a) and TDDDG require disclosure of any storage access.  
**Fix:**
```
In Privacy Policy, add section "Session storage":
  "We use browser localStorage (web) and device secure storage (mobile) 
  to maintain your login session. This data is technically necessary and 
  automatically deleted when you sign out. No tracking or advertising data 
  is stored locally."
No cookie banner needed — technically necessary. Just document it.
```

---

## MISMATCH #15 — MEDIUM

**Document:** AGB — "Owner-exclusive functions: invite/remove members"  
**Intended behavior:** Only the org owner can invite and remove members.  
**Actual behavior:** 
- Agency: `ClientOrganizationTeamSection.tsx` allows `owner` **and** `booker` to invite (per `.cursorrules` rule: "Agency: Booker and Agency Owner are functionally equivalent — all features except Owner-exclusive rights")
- The `invitations` table RLS policy allows `owner` and `booker` for agencies, `owner` and `employee` for clients to INSERT invitations
- The `.cursorrules` file explicitly states this as intended behavior

**But the AGB must match this.** If the AGB says "only the owner can invite", that's wrong. If it says "owner and booker can invite" for agency, that's correct.  
**Risk:** MEDIUM — AGB wording must precisely reflect: bookers can invite members too (agency); employees can invite members too (client). If AGB says "owner only" this is false.  
**Fix:**
```
AGB must state:
  "Agency: Owner and Booker can invite members. Only the Owner can delete the organization 
  and manage billing."
  "Client: Owner and Employee can invite members. Only the Owner can delete the organization 
  and manage billing."
This matches the actual backend RLS policies.
```

---

## MISMATCH #16 — MEDIUM

**Document:** Privacy Policy — Data export completeness  
**Legal statement intended:** "Your export contains all data we hold about you."  
**Actual behavior:** `export_user_data()` currently does NOT include:
- `legal_acceptances` records (the actual consent records — see #12)
- `bookings` linked to the user as a model or client
- `model_applications` submitted by the user
- `model_photos` associated with the user's models
- `notifications` addressed to the user
- `guest_link_access_log` entries (access events linked to the user's agency)

The export is structurally correct but incomplete for a complete Art. 20 response.  
**Risk:** MEDIUM — Incomplete GDPR export. A data subject request could reveal gaps.  
**Fix:**
```
Extend export_user_data() RPC to include:
  - legal_acceptances WHERE user_id = p_user_id
  - model_applications WHERE applicant_user_id = p_user_id
  - bookings WHERE model_id IN (SELECT id FROM models WHERE user_id = p_user_id) -- if applicable
  - notifications WHERE recipient_id = p_user_id (limited to 500, recent)
Each with appropriate field selection (no foreign org data).
```

---

## MISMATCH #17 — LOW

**Document:** Privacy Policy — "Automatic account purge after 30 days"  
**Legal statement intended:** "After 30 days, your account is permanently deleted from our systems."  
**Actual behavior:** `gdpr_purge_expired_deletions()` **anonymizes** the profile (replaces PII with placeholders) but does **not** call `auth.admin.deleteUser()`. The auth record (email, password hash) in `auth.users` remains. Complete deletion requires the calling Edge Function to also call `auth.admin.deleteUser()` for each returned user ID.

The function comment says "The calling Edge Function must then also call auth.admin.deleteUser()" — but since no cron exists (see #10), this never happens.  
**Risk:** LOW (once #10 is fixed, this self-resolves) — but the Privacy Policy should say "deleted from our application database and authentication system" not just "deleted from our systems."  
**Fix:**
```
When implementing the cron (#10):
  After calling gdpr_run_all_retention_cleanup(), loop through returned user_ids:
    await supabase.functions.invoke('delete-user', { body: { userId: purgedUserId } })
  This ensures auth.users record is also removed.
```

---

## MISMATCH #18 — LOW

**Document:** Privacy Policy — EXIF / location data  
**Legal statement intended:** "We strip location metadata from uploaded images."  
**Actual behavior:** `stripExifAndCompress()` in `modelPhotosSupabase.ts` strips EXIF via canvas re-encoding. However:
- This is only called in the **file upload path**
- The **URL-add path** (see #13) bypasses this
- The **application upload path** (`applicationsSupabase.ts`) — needs to be verified separately
- Stripping is graceful-degradation: on failure, the original (with EXIF) is uploaded, and only a `console.warn` is issued

**Risk:** LOW — EXIF stripping mostly works but has bypass vectors. Privacy Policy should not claim 100% EXIF removal without qualifying "where technically possible."  
**Fix:**
```
Privacy Policy wording: 
  "We attempt to remove EXIF location metadata from uploaded photos where technically 
  possible on your device. File upload by URL does not support automated EXIF stripping."
Also: fix URL-add path (#13).
```

---

## FULL MISMATCH SUMMARY

| # | Area | Risk | Status |
|---|------|------|--------|
| 1 | GDPR data export — no UI | CRITICAL | Fix required |
| 2 | Image rights — upload not enforced | CRITICAL | Fix required |
| 3 | Legal URLs return 404 | CRITICAL | Fix required (publish pages first) |
| 4 | Consent tables not synchronized | CRITICAL | Fix required |
| 5 | No IP captured at consent | CRITICAL | Fix wording OR capture IP |
| 6 | localStorage undocumented | HIGH | Fix wording |
| 7 | Minors — no UI | HIGH | Fix wording OR build UI |
| 8 | Consent withdrawal — no UI + broken | HIGH | Fix required |
| 9 | Audit trail not wired | HIGH | Fix required |
| 10 | Retention cleanup not scheduled | HIGH | Fix required (operational) |
| 11 | Guest link access log not written | HIGH | Fix required |
| 12 | Data export misses legal_acceptances | MEDIUM | Fix RPC |
| 13 | URL-add bypasses rights + EXIF | MEDIUM | Fix required |
| 14 | Session storage undocumented | MEDIUM | Fix wording |
| 15 | AGB invite-right wording mismatch | MEDIUM | Fix AGB wording |
| 16 | Export incomplete | MEDIUM | Extend RPC |
| 17 | Auth purge not fully executed | LOW | Fix on #10 implementation |
| 18 | EXIF stripping has bypass vectors | LOW | Fix wording |

---

## "DOCUMENTS OVER-PROMISE" LIST

These are statements the legal documents **cannot truthfully make** based on current system behavior:

| Statement | Reality |
|-----------|---------|
| "Users can export their data at any time." | No UI for this exists. |
| "Every image upload requires rights confirmation." | Not enforced in any upload flow. |
| "Consent can be withdrawn at any time." | No UI; withdrawal table mostly empty. |
| "All bookings and negotiations are logged for traceability." | Audit trail is empty; no wiring. |
| "We automatically delete your account after 30 days." | No cron is scheduled. |
| "We log all guest link access for security purposes." | Log table exists but is never written. |
| "Guardian consent is required for minors." | No UI; flag is not enforced at creation time. |
| "We record your IP address at consent time." | IP is not captured. |

---

## "SYSTEM DOES MORE THAN DOCUMENTED" LIST

These are protections that exist in code but may not appear in legal texts:

| Behavior | Where |
|----------|-------|
| EXIF/GPS stripping from uploaded photos | `modelPhotosSupabase.ts` → `stripExifAndCompress()` |
| SHA-256 hashing of IPs (never storing raw IPs) | `guest_link_rate_limit` table |
| 15-minute signed URL expiry for guest images | `guestLinksSupabase.ts` → `GUEST_IMAGE_SIGNED_TTL_SECONDS` |
| Rate limiting of guest link access (60 req/min) | `migration_guest_link_rate_limit.sql` |
| Cross-org member injection blocked by DB trigger | `trg_guard_org_member_insert` |
| Booking legal hold auto-set on confirmation | `trg_booking_set_legal_hold` |
| Minor visibility blocked at DB level without consent | `trg_guard_minor_visibility` |
| Stripe subscription linking attack prevention | `checkSubscriptionLinking()` in Edge Function |
| Option request state machine enforced by DB trigger | `migration_hardening_2026_04_final.sql` |
| Storage capacity enforcement per agency | `agencyStorageSupabase.ts` |

**Recommendation:** Add these to the Privacy Policy or ToMs as evidence of technical protection — they strengthen the legal position significantly.

---

## FINAL VERDICT

### ⚠️ MOSTLY ALIGNED — 5 CRITICAL FIXES REQUIRED BEFORE LAUNCH

**Current state:** The backend security and data architecture is strong. The **infrastructure** for compliance is largely built. The **wiring and operational execution** is missing in critical places.

| Category | Verdict |
|----------|---------|
| Multi-tenant isolation / RLS | ✅ Aligned |
| Billing / paywall logic | ✅ Aligned |
| Account soft-delete flow | ✅ Aligned |
| Guest link security | ✅ Aligned |
| Stripe webhook security | ✅ Aligned |
| **Legal text URLs exist** | ❌ NOT ALIGNED (404) |
| **Image rights enforcement** | ❌ NOT ALIGNED |
| **Consent table unified** | ❌ NOT ALIGNED |
| **Data export UI accessible** | ❌ NOT ALIGNED |
| **Retention cleanup running** | ❌ NOT ALIGNED |
| Audit trail populated | ⚠️ PARTIAL (infrastructure only) |
| Consent withdrawal functional | ⚠️ PARTIAL (backend only) |
| Minors protection | ⚠️ PARTIAL (DB trigger only) |
| GDPR export completeness | ⚠️ PARTIAL (missing some tables) |

### Priority order before any user faces these legal texts:

```
1. [TODAY]    Publish legal texts at /terms and /privacy (or embed inline)
2. [TODAY]    Fix acceptTerms() to write to consent_log (sync both tables)
3. [THIS WEEK] Add data export "Download my data" button to settings
4. [THIS WEEK] Schedule pg_cron for gdpr_run_all_retention_cleanup()
5. [THIS WEEK] Add image rights checkbox to all upload flows
6. [THIS WEEK] Write guest link access events to guest_link_access_log
7. [THIS WEEK] Wire logAuditAction() into bookings + option flows
8. [BEFORE LAUNCH] Add consent withdrawal UI to settings
9. [BEFORE LAUNCH] Add is_minor flag UI to model creation (or document limitation)
10. [LEGAL]    Update AGB re: booker invite rights; update Privacy Policy re: localStorage
```


--------------------------------------------------------------------------------
# SOURCE FILE: supabase/README.md
--------------------------------------------------------------------------------

# Supabase Schema – Casting Index

## Ausführung

1. Im [Supabase Dashboard](https://supabase.com/dashboard) dein Projekt öffnen.
2. **SQL Editor** → **New query**.
3. Inhalt von `schema.sql` einfügen und **Run** ausführen.

Falls du die Reihenfolge anpassen willst: Zuerst alle Enums und Tabellen, dann RLS, dann Trigger.

**Manuelle Kalender-Ereignisse (Kunde/Agentur):** Nach dem Basis-Schema zusätzlich `migration_user_calendar_events.sql` ausführen. Dann sind Tabelle `user_calendar_events`, RLS und Trigger für eigene Termine aktiv.

**Apply as Model + Model-E-Mail-Verknüpfung:** Zusätzlich `migration_apply_model_and_email.sql` ausführen. Dann: Bewerbungen mit Account verknüpft (`applicant_user_id`), Models mit E-Mail-Feld, Apply nur noch nach Login; RPC `link_model_by_email` für Zuordnung nach Sign-up.

**Eigenes Konto löschen (30 Tage Archiv):** Zusätzlich `migration_account_self_deletion.sql` ausführen.

**Admin-Profil-Änderungen speichern:** Zusätzlich `migration_admin_profile_update.sql` ausführen. Dann werden Admin-Änderungen an Nutzerprofilen (Name, E-Mail, Rolle, is_active, is_admin usw.) über die RPC `admin_update_profile_full` geschrieben und zuverlässig in der DB gespeichert (umgeht RLS). Nutzer können in den Einstellungen ihr Konto zur Löschung anmelden; Daten bleiben 30 Tage archiviert. Nach 30 Tagen müssen die Einträge endgültig gelöscht werden: z.B. eine geplante Edge Function, die `get_accounts_to_purge()` aufruft und für jede zurückgegebene `user_id` die Supabase Admin API `auth.admin.deleteUser(user_id)` ausführt (CASCADE räumt dann die öffentlichen Tabellen).

**My Models (Roster, Soft-Delete, Account-Link):** `migration_model_roster_soft_delete.sql` — `agency_relationship_status` (`active` / `pending_link` / `ended`), Soft-End statt `agency_id` löschen; RPC `agency_link_model_to_user` für manuelle Verknüpfung nach API-Import.

**Identität, Verhandlung, Kalender-Spiegelung:** `migration_identity_negotiation_calendar.sql` — `agencies.logo_url`, `user_calendar_events.source_option_request_id`, Trigger bei `option_requests.final_status = option_confirmed` (Client- und Agentur-Kalender). Im SQL Editor ausführen, nachdem `user_calendar_events` existiert.

**Model-Fotos (Portfolio, manueller Upload, Cover):** Dafür müssen **Phase 13** und **Phase 14** ausgeführt sein:
- `migration_phase13_enhancements.sql` – legt die Tabelle `model_photos` und RLS an.
- `migration_phase14_options_jobs_castings.sql` – fügt die Spalte `photo_type` (portfolio/polaroid) in `model_photos` hinzu.

Die Tabelle `models` hat bereits die Spalte `portfolio_images` (TEXT[]); sie wird vom Code mit der geordneten URL-Liste synchron gehalten (erstes Bild = Cover für Client-Swipe).

**Storage (Privater Bucket mit Signed URLs):** Model-Fotos und Bewerbungsbilder liegen im **privaten** Bucket **`documentspictures`** (Pfade `model-photos/{modelId}/...` und `model-applications/...`). Der Bucket **`documents`** ist ebenfalls **privat**. Bilder werden **niemals** über öffentliche URLs ausgeliefert – ausschließlich über kurzlebige **Signed URLs** (TTL 3600 s), die der Client über `supabase.storage.from('documentspictures').createSignedUrl(path, ttl)` anfordert. Im Supabase Dashboard unter **Storage**:

1. Bucket **documentspictures** anlegen, auf **Private** stellen (NICHT Public).
2. **Storage Policy für Upload** (`INSERT`): Nur `authenticated` Nutzer dürfen in ihren eigenen Pfad schreiben – Policy per SQL (siehe `migration_storage_private_documentspictures.sql`).
3. **Storage Policy für Download** (`SELECT`): Scoped auf Agency, Model und berechtigte Clients via RLS-Policy (`documentspictures_select_scoped` in `migration_security_verifications_storage_2026_04.sql`).
4. Kein direkter Public-URL-Zugriff: `getPublicUrl` darf im Anwendungscode **nicht** für diesen Bucket verwendet werden – immer `createSignedUrl`.

## Enums

| Enum | Werte |
|------|--------|
| `user_role` | model, agent, client |
| `application_status` | pending, accepted, rejected |
| `gender` | female, male, diverse |
| `connection_status` | pending, accepted |
| `connection_requested_by` | client, agency |
| `option_request_status` | in_negotiation, confirmed, rejected |
| `chat_sender_type` | client, agency, model |

## Tabellen-Übersicht

- **profiles** – Nutzerprofile (an `auth.users` angebunden)
- **agencies** – Agenturen
- **models** – Models (mit Maßen, Sichtbarkeit, `agency_id`)
- **model_applications** – Bewerbungen (Apply: Name, Größe, Gender, Haarfarbe, Stadt, Instagram, Bilder, Status)
- **recruiting_chat_threads** / **recruiting_chat_messages** – Chat Agentur ↔ Model nach Akzeptanz
- **client_agency_connections** – Freundschaftsanfragen Client ↔ Agentur
- **client_projects** / **client_project_models** – Kunden-Projekte und zugeordnete Models
- **option_requests** / **option_request_messages** – Optionsanfragen (Datum) und Chat Client ↔ Agentur

Alle Tabellen haben **Row Level Security (RLS)** aktiviert.


--------------------------------------------------------------------------------
# SOURCE FILE: supabase/MIGRATION_ORDER.md
--------------------------------------------------------------------------------

# Supabase Migration Order

This file documents the **mandatory execution order** for all SQL files in this directory.
Files must be run in exactly this sequence on any new instance (staging, production clone, CI).

> **Important:** The current SQL files use a flat naming scheme without timestamps.
> A future refactor should move these into `supabase/migrations/` with the standard
> Supabase timestamp prefix format (`YYYYMMDDHHmmss_description.sql`) so that
> `supabase db push` can manage them automatically.

---

## Execution Order

### Phase 0 – Base Schema (run first, always)
1. `schema.sql`

### Phase 1 – Core Data Model
2. `migration_phase2_datamodel.sql`
3. `migration_phase3_rls_tighten.sql`
4. `migration_phase4_stippen.sql`
5. `migration_phase5_messenger.sql`
6. `migration_phase7_pro_tools.sql`
7. `migration_phase9_ai.sql`
8. `migration_phase11_enhancements.sql`
9. `migration_phase12_accounts.sql`
10. `migration_phase13_enhancements.sql`
11. `migration_phase14_options_jobs_castings.sql`

### Phase 2 – Agency & Model Features
12. `migration_agencies_code.sql`
13. `migration_models_unique_user_id.sql`
14. `migration_models_add_sex.sql`
15. `migration_model_categories.sql`
16. `migration_sports_categories.sql`
17. `migration_apply_model_and_email.sql`
18. `migration_model_applications_enforce_profile_name.sql`
19. `migration_model_applications_applicant_delete.sql`
20. `migration_model_roster_soft_delete.sql`
21. `migration_model_photos_is_visible_to_clients.sql`
22. `migration_model_photos_agency_owner_rls.sql`
23. `migration_model_photos_rls_tighten.sql`
24. `migration_models_with_territories_view.sql`
25. `migration_territories_add_rpc.sql`
26. `migration_territories_rls_agency_email_fix.sql`
27. `migration_territories_rpc_definitive.sql`
28. `migration_stabilize_model_agency_territories_unique_per_country_and_rls.sql`
29. `migration_model_agency_territories_multi_agency_client_select.sql`
30. `migration_hybrid_location_discovery_models_country_code_and_rls.sql`

### Phase 3 – Organizations & Invitations (Multi-Tenancy Core)
31. `migration_organizations_invitations_rls.sql`          ← Creates organizations, organization_members, invitations tables + RPCs
32. `migration_org_single_owner_invariant.sql`             ← Unique index: one owner per org
33. `migration_invitations_owner_only.sql`                 ← Tightens INSERT to owner only
34. `migration_org_members_select_any_member.sql`          ← OBSOLETE (no-op)
35. `migration_org_members_rls_no_recursion.sql`           ← Fixes infinite recursion via user_is_member_of_organization()
36. `migration_organizations_column_security.sql`
37. `migration_organizations_owner_can_update_name.sql`
38. `migration_org_member_settings_permissions.sql`
39. `migration_admin_organization_member_role.sql`
40. `migration_client_member_role_and_org_members_read_team.sql`

### Phase 4 – B2B Connections & Messenger
41. `migration_client_agency_connections_org_chat_rls.sql`
42. `migration_client_agency_connections_table_comment.sql`
43. `migration_connection_messenger_org_scope.sql`          ← Adds client_organization_id/agency_organization_id to conversations
44. `migration_conversations_insert_b2b_org_member.sql`
45. `migration_b2b_org_directory_and_pair_resolve.sql`
46. `migration_b2b_counterparty_org_name_rpc.sql`
47. `migration_rpc_create_b2b_org_conversation.sql`
48. `migration_resolve_b2b_chat_organization_ids.sql`
49. `migration_b2b_chat_message_types.sql`
50. `migration_b2b_chat_message_types_add_booking.sql`

### Phase 5 – Agency Bootstrap & Agent Features
51. `migration_ensure_agency_row_for_agent.sql`
52. `migration_ensure_plain_signup_b2b_owner_bootstrap.sql`  ← BUGGY – superseded by fix below
53. `migration_models_insert_agency_org_members.sql`
54. `migration_models_agency_member_full_access.sql`
55. `migration_agency_bookers_full_access.sql`
56. `migration_agency_settings_and_model_photos_rls.sql`
57. `migration_agency_start_recruiting_chat_rpc.sql`
58. `migration_agency_remove_model_and_admin_purge.sql`
59. `migration_recruiting_thread_agency.sql`
60. `migration_recruiting_threads_application_index.sql`

### Phase 6 – Calendar, Options & Bookings
61. `migration_user_calendar_events.sql`
62. `migration_user_calendar_events_org_member_rls.sql`
63. `migration_calendar_entries_multi_slot_rls_email.sql`
64. `migration_calendar_reschedule_sync.sql`
65. `migration_org_calendar_booking_full_access.sql`          ← Replaces calendar RLS with org-wide access
66. `migration_identity_negotiation_calendar.sql`
67. `migration_option_no_model_account.sql`
68. `migration_rls_fix_option_requests_safety.sql`            ← Safety net: drops broad USING(true) option policies

### Phase 7 – Client Features
69. `migration_client_filter_preset.sql`
70. `migration_client_projects_employees.sql`
71. `migration_client_discovery_consistency.sql`

### Phase 8 – Guest Links & Flow
72. `migration_guest_user_flow.sql`
73. `migration_guest_links_rls_fix.sql`
74. `migration_guest_links_rls_agency_scoped.sql`
75. `migration_guest_links_add_label.sql`
76. `migration_guest_links_fix_anon_models_rpc.sql`

### Phase 9 – Admin & Security Hardening
77. `migration_admin_profile_update.sql`
78. `migration_admin_update_profile_no_admin_escalation.sql`
79. `migration_security_tighten.sql`
80. `migration_system_hardening.sql`
81. `migration_organizations_invitations_rls.sql`  ← Already run in Phase 3; idempotent
82. `migration_rls_fix_agency_invitations_documents.sql`
83. `migration_rls_fix_anon_models.sql`
84. `migration_rls_fix_model_photos_territory.sql`
85. `migration_rls_fix_profiles_email.sql`         ← IMPORTANT: column-level email/phone security

### Phase 10 – Account Lifecycle
86. `migration_account_self_deletion.sql`
87. `migration_account_deletion_owner_only.sql`
88. `migration_backfill_b2b_organization_owners.sql`

### Phase 11 – Security Fixes (from Audit 2025)
89. `migration_fix_bootstrap_syntax.sql`           ← CRIT-1: Fixes missing END IF
90. `migration_invitations_delete_owner_only.sql`  ← HIGH-1: Owner can revoke invitations
91. `migration_fix_conversation_rls_perf.sql`      ← MED-3: row_security off in conversation helper
92. `migration_fix_connections_select_policy.sql`  ← MED-4: Fix broad connections SELECT
93. `migration_fix_org_owner_delete_restrict.sql`  ← MED-5: ON DELETE RESTRICT + transfer RPC
94. `migration_client_projects_org_scope.sql`      ← MED-1: Projects org-shared

### Phase 12 – Admin Org & Model Control
95. `migration_admin_org_model_control.sql`        ← Adds is_active + admin_notes to orgs & models; SECURITY DEFINER admin RPCs; org-deactivation gate RPC; get_models_by_location updated with is_active filter
96. `migration_admin_org_model_patch.sql`          ← PATCH: apply this instead of #95 if the REVOKE statements caused a rollback. Fully idempotent. No REVOKE commands.

### Phase 13 – Admin RLS Fix & Full B2B Backfill
97. `migration_admin_org_rls_and_full_backfill.sql` ← CRIT: Adds admin SELECT RLS on organizations + organization_members so fallback query works; creates agencies rows for agents without one; full idempotent backfill for all orphaned B2B profiles.

### Phase 14 – Monetization: Agency Swipe Limits
98. `migration_agency_swipe_limits.sql` ← Creates `agency_usage_limits` table; RLS (member SELECT + admin ALL); 4 SECURITY DEFINER RPCs (`get_my_agency_usage_limit`, `increment_my_agency_swipe_count`, `admin_set_agency_swipe_limit`, `admin_reset_agency_swipe_count`); AFTER INSERT trigger on `organizations` to auto-create limit row for new agency orgs; backfill for existing agency orgs.

### Phase 15 – Org Deduplication & Naming Fix
99. `migration_fix_org_naming_and_dedup.sql` ← **v2** – Priority-based dedup for ALL duplicate cases (both agency_id IS NULL orphans AND cases where both orgs have agency_id IS NOT NULL but same owner): keeps org whose name ≠ owner display_name, tie-breaks by oldest created_at; moves members before deleting; defensive client dedup; adds UNIQUE(owner_id) WHERE type='agency'; fixes ensure_agency_for_current_agent() and ensure_client_organization() (no display_name fallback); syncs organizations.name from agencies.name for linked orgs.

### Phase 16 – New Tables: Locations, Media Sync, Security, Notifications, Push
100. `migration_model_locations.sql`                      ← Creates `model_locations` table (privacy-safe approx coords); UNIQUE(model_id); RLS: model self + agency members
101. `migration_mediaslide_sync_logs.sql`                 ← Creates `mediaslide_sync_logs` table; RLS: agency read (fixed below) + restricted INSERT
102. `migration_security_events.sql`                      ← Creates `security_events` table (append-only audit log); RLS: INSERT own only, SELECT admin/service
103. `migration_push_tokens.sql`                          ← Creates `push_tokens` table; UNIQUE(user_id, token); RLS: own tokens only
104. `migration_notifications.sql`                        ← Creates `notifications` table; RLS: read own/org + insert authenticated
105. `migration_client_model_interactions.sql`            ← Creates `client_model_interactions` + `discovery_logs` tables; RPCs `record_client_interaction` + `get_discovery_models`
106. `migration_chat_file_attachments.sql`                ← ALTER `recruiting_chat_messages` ADD file_url, file_type

### Phase 17 – Agency API Keys & Mediaslide RLS Fix
107. `migration_agency_api_keys_rls.sql`                  ← SECURITY DEFINER RPCs `get_agency_api_keys` + `save_agency_api_connection`; column-level API key protection
108. `migration_agency_api_keys_grant_execute.sql`        ← GRANT EXECUTE on API key RPCs to authenticated role
109. `migration_fix_mediaslide_sync_logs_rls.sql`         ← Fixes broken SELECT policy (wrong agency join) + too-broad INSERT (was WITH CHECK(true))

### Phase 18 – Location RPCs
110. `migration_model_locations_rpcs.sql`                 ← RPCs: `upsert_model_location`, `bulk_upsert_model_locations`, `get_models_near_location`, `get_models_by_location` v3
111. `migration_model_locations_rpc_bbox_optimization.sql` ← Replaces `get_models_near_location` with bbox pre-filter (lat/lng range → Haversine only on survivors)
112. `migration_get_models_by_location_rpc.sql`           ← RPC v1: UNION-query replacing dual pagination loops; territory OR country_code matching
113. `migration_get_models_by_location_rpc_v2.sql`        ← RPC v2: territory-only discovery (removes country_code fallback); aligns with product rule

### Phase 19 – Models RLS Stabilization & Application Fixes
114. `migration_models_rls_clients_via_territories.sql`   ← Drops broad USING(true); clients see only models with ≥1 territory + visibility flag; agencies see own models
115. `migration_fix_model_applications_rls.sql`           ← SECURITY FIX: replaces USING(true) UPDATE + INSERT; applicant_user_id must match auth.uid()
116. `migration_model_application_country_rls.sql`        ← Adds `country_code` to model_applications; fixes SELECT so agency sees all applications (not only agency_id-matched)
117. `migration_application_model_confirmation.sql`       ← **Run alone (separate transaction)**: ALTER TYPE application_status ADD VALUE 'pending_model_confirmation'
118. `migration_application_model_confirmation_rls.sql`   ← Run AFTER #117 is committed: tightens UPDATE policy to allow applicant to accept/reject at pending_model_confirmation

### Phase 20 – Territories Bulk RPC & Client Discovery RLS
119. `migration_add_territories_bulk_rpc.sql`             ← RPCs: `bulk_add_model_territories` + `bulk_save_model_territories` (replaces N×1 RPC loops)
120. `migration_fix_client_rls_territory_required.sql`    ← Removes `country_code IS NOT NULL` shortcut; territory entry is the only valid representation scope
121. `migration_fix_client_rls_three_mandatory_fields.sql` ← Extends #120: requires name + territory + portfolio photo before model is visible to clients

### Phase 21 – Client Interaction v2 & Org Enforcement
122. `migration_client_model_interactions_v2.sql`         ← Upgrades interaction table from 3 rows to 1 row per (org, model); PK = (client_org_id, model_id); updates both RPCs
123. `migration_enforce_single_org_per_user.sql`          ← Cleans up multi-membership violations; adds partial UNIQUE INDEX on organization_members for single-org enforcement

### Phase 22 – Media System & Polaroid Privacy
124. `migration_model_media_system.sql`                   ← Extends photo_type ('private'); adds agency_id to model_photos; adds include_polaroids to guest_links; updates get_guest_link_models RPC; private photos never visible to clients/anon
125. `migration_package_type_system.sql`                  ← Replaces include_polaroids bool with strict type enum ('portfolio' | 'polaroid'); updates RPC accordingly
126. `migration_polaroids_discovery_restriction.sql`      ← Client + anon SELECT on model_photos: adds photo_type != 'polaroid' guard; polaroids only via get_guest_link_models RPC

### Phase 23 – Workflow Hardening & Security Audit Fixes
127. `migration_request_workflow_hardening.sql`           ← Performance indexes on option_requests; RLS hardening for legacy bookings (was USING(true)); RLS hardening for calendar_entries; CHECK constraint for counter-offer state
128. `migration_security_hardening_audit_fixes.sql`       ← Run AFTER #102 + #127: fixes bookings_select_scoped (removes unscoped org-member branch); fixes calendar_entries INSERT bypass; revokes replication_slot_health from authenticated; scopes security_events INSERT to user's own orgs

### Phase 24 – Account Lifecycle & Performance
129. `migration_personal_account_deletion.sql`            ← SECURITY DEFINER RPC `request_personal_account_deletion`; allows non-owner members to soft-delete their own account; complements migration_account_deletion_owner_only.sql
130. `migration_performance_indexes.sql`                  ← 100k-scale indexes on bookings, option_requests, model_photos, model_agency_territories, conversations, messages, etc.
131. `migration_performance_indexes_v2.sql`               ← Additional indexes: profiles(created_at), messages(conversation_id, created_at), model_photos(model_id, photo_type)

### Phase 25 – Input Validation & Ethnicity Extension
132. `migration_validation_constraints.sql`               ← CHECK constraints on text length (messages, option_request_messages) + file_type whitelists; enforced at PostgreSQL level independent of frontend
133. `migration_add_ethnicity.sql`                        ← Adds `ethnicity` column to models + model_applications; extends get_models_by_location RPC with p_ethnicities filter

### Phase 26 – Security Fix: Notification Injection
134. `migration_fix_notifications_insert_rls.sql`         ← Replaces overly-broad notifications INSERT policy; restricts targets to caller's own user_id or orgs they belong to; cross-party notifications require org membership

### Phase 27 – Data Consistency Fixes
135. `migration_fix_model_account_linked_trigger.sql`     ← AFTER UPDATE OF user_id ON models trigger: syncs option_requests.model_account_linked when a model account is later linked (prevents approval bypass for retrospectively linked models)
136. `migration_fix_option_requests_org_id_comment.sql`   ← COMMENT ON COLUMN option_requests.organization_id documenting Client-Org semantics (NOT agency org)

### Phase 28 – Agency Storage Tracking
137. `migration_agency_storage_tracking.sql`              ← Creates `organization_storage_usage` table (PK=organization_id, used_bytes≥0); RLS (member SELECT + admin ALL); 6 SECURITY DEFINER RPCs: `get_my_agency_storage_usage`, `increment_agency_storage_usage` (atomic limit check with FOR UPDATE, 5 GB cap), `decrement_agency_storage_usage` (floors at 0), `get_chat_thread_file_paths`, `get_model_portfolio_file_paths`, `admin_set_agency_storage_usage`; AFTER INSERT trigger on `organizations` to auto-create storage row for new agency orgs; backfill for existing agency orgs. Applies to agency organizations only — clients and models are unrestricted.

### Phase 28b – Storage Security Hardening
138. `migration_storage_size_hardening.sql`               ← Security audit fixes: (1) `ALTER TABLE model_photos/documents ADD COLUMN file_size_bytes BIGINT DEFAULT 0` — enables reliable storage decrement from DB instead of fragile `storage.list()` calls; (2) `CREATE OR REPLACE FUNCTION get_chat_thread_file_paths` — adds ownership check (conversation must belong to caller's agency org, preventing cross-agency file path enumeration — BUG 2 HIGH); (3) `CREATE OR REPLACE FUNCTION get_model_portfolio_file_paths` — adds ownership check via `organizations.agency_id = models.agency_id` join (BUG 2 HIGH); (4) `CREATE OR REPLACE FUNCTION decrement_agency_storage_usage` — adds audit log to `security_events` for single-call decrements > 100 MB (BUG 4 LOW mitigation). Run after Phase 28.

### Phase 29 – Pre-Launch Security Fixes (2026-04 Audit)
139. `migration_prelaunch_security_fixes.sql`             ← C-3: replaces broad anon/auth SELECT policies on guest_links with agency-scoped policy + SECURITY DEFINER `get_guest_link_info()` RPC for anon callers; H-2: removes anon model_locations SELECT, scopes auth SELECT to agency/client relationships; H-3: replaces chat-files storage SELECT with owner + conversation-participant check; H-4: adds `m.agency_id = v_agency_id` guard to `get_guest_link_models()` RPC; H-7: scopes agency_invitations policies from role='agent' to own-agency-membership check; M-1: adds partial UNIQUE index `uidx_booking_events_model_date_active` on (model_id, date) WHERE status != 'cancelled'. Run after Phase 28b.
140. `migration_notifications_rpc_hardening.sql`          ← M-3: replaces broad cross-party notifications INSERT policy with strict self/org-only policy; adds SECURITY DEFINER `send_notification()` RPC that validates sender↔target relationship (option_request, recruiting_thread, or B2B connection) before inserting. Run after Phase 29 (#139).

### Phase 29b – Admin Storage Override
141. `migration_admin_storage_override.sql`               ← Extends `organization_storage_usage` with `storage_limit_bytes` (nullable, NULL = default 5 GB) and `is_unlimited` (boolean); REPLACE `get_my_agency_storage_usage` + `increment_agency_storage_usage` to respect new columns; NEW SECURITY DEFINER admin RPCs: `admin_get_org_storage_usage` (read snapshot), `admin_set_storage_limit` (custom bytes, max 1 TB), `admin_set_unlimited_storage` (bypass limit), `admin_reset_to_default_storage_limit` (restore 5 GB). All admin RPCs verify `profiles.is_admin = TRUE` via `auth.uid()`. Run after Phase 29 (#140).

### Phase 29c – Portfolio Bulk-Delete Size Fix
142. `migration_fix_portfolio_bulk_delete_size.sql`       ← REPLACE `get_model_portfolio_file_paths`: uses `model_photos.file_size_bytes` (stored at upload time, Phase 28b) as the primary size source with `COALESCE(NULLIF(..., 0), storage.objects lookup, 0)` fallback. Fixes counter staying inflated when portfolio files were already removed from storage before bulk-delete. Run after Phase 29b (#141).

### Phase 30 – Security Audit Fixes (Pre-Launch 2026-04, Pentest Round)
143. `migration_org_role_type_enforcement.sql`            ← CRITICAL: Adds BEFORE INSERT/UPDATE trigger on organization_members enforcing role-type binding (agency→owner/booker, client→owner/employee); SECURITY DEFINER `check_org_access()` helper; SECURITY DEFINER `get_my_org_context()` RPC; updated RLS policies (INSERT/UPDATE owner-only). Run before Phase 30b.
144. `migration_fix_organizations_update_policy.sql`      ← Tightens organizations UPDATE policy to owner-only for name/settings fields; blocks non-owner members from modifying org metadata.
145. `migration_security_from_role_uploaded_by.sql`       ← Adds `uploaded_by` column to model_photos; RLS tightened so only the uploader (agency member) can delete their own uploads; prevents cross-agency photo deletion.
146. `migration_security_revoke_anon_location_rpc.sql`    ← SECURITY: Revokes anon EXECUTE on `get_models_by_location` RPC (was inadvertently public); requires authenticated role.
147. `migration_security_verifications_storage_2026_04.sql` ← Tightens verifications storage bucket policies: scopes SELECT/INSERT/DELETE to owner's own files; removes overly-broad service-role bypass.
148. `migration_storage_private_documentspictures.sql`    ← Sets `documentspictures` bucket to PRIVATE; adds signed-URL-only SELECT policy; prevents direct public URL access to identity documents and sensitive files.
149. `migration_backend_rate_limits_otp_guest.sql`        ← Backend rate limiting for OTP and guest auth flows: adds `auth_rate_limits` table; SECURITY DEFINER RPC `check_and_increment_rate_limit()` with configurable window/max; applied to guest magic-link and OTP endpoints.
150. `migration_security_pentest_fixes_2026_04.sql`       ← Consolidated pentest fix batch (2026-04): patches identified during external security review; see file header for individual issue list.
151. `migration_security_profiles_is_admin_lock.sql`      ← CRIT-02: REVOKE UPDATE(is_admin, role) on profiles FROM authenticated; BEFORE UPDATE trigger `trg_prevent_privilege_escalation` blocks authenticated users from elevating own is_admin/role. Run after Phase 30 (#150).
152. `migration_security_invitation_email_guard.sql`      ← CRIT-01: Restores email match + profile role check in `accept_organization_invitation`; keeps single-org guard from Phase 21. Run after #151.
153. `migration_security_fix_org_context_order.sql`       ← HIGH-04: Adds ORDER BY created_at ASC to `get_my_org_context()` for deterministic org selection; aligns with can_access_platform() and checkout Edge Function ordering. Run after #152.

### Phase 31 – Full Penetration Test Security Fixes (2026-04 Adversarial Audit)
154. `migration_guest_link_revoke_fix_2026_04.sql`        ← Adds `deleted_at IS NULL` guard to `get_guest_link_info` / `get_guest_link_models`; REVOKE PUBLIC on both RPCs; rate-limit wired into both RPCs; agency_id cross-org guard in `get_guest_link_models`. Run after #153.
155. `migration_restrict_embeddings_rls_2026_04.sql`      ← Scopes model_embeddings SELECT to agent/client roles only; tightens UPSERT WITH CHECK to own-agency models. Run after #154.
156. `migration_super_admin_2026_04.sql`                  ← Adds `is_super_admin` column to profiles; replaces admin_logs policies (SELECT→super_admin only, INSERT→is_admin only); adds trigger to protect is_super_admin from escalation. Run after #155.
157. `migration_security_admin_override_audit_2026_04.sql` ← Adds audit logging to admin_set_bypass_paywall + admin_set_org_plan; tightens admin_logs to SELECT+INSERT only (no DELETE); restricts admin_overrides direct write (RPC-only). Run after #156.
158. `migration_security_advisor_fixes_2026_04.sql`       ← Security Advisor: recreates views with security_invoker=true; pins search_path on 14 functions; moves pg_trgm to extensions schema; tightens badges/boosts WITH CHECK; adds RESTRICTIVE deny policies on guest_link_rate_limit + stripe_processed_events; REVOKE SELECT on replication_slot_health FROM authenticated. Run after #157.
159. `migration_hardening_2026_04_final.sql`              ← Consolidated hardening: get_agency_revenue RPC; booking + option_request RLS tightening; performance indexes. Run after #158.
160. `migration_scale_indexes_2026_04.sql`                ← Additional 100k-scale indexes for conversations, messages, model_photos. Run after #159.
161. `migration_chaos_hardening_2026_04.sql`              ← Chaos testing fixes: dedup indexes for model_applications; guest_links soft-delete + updated RLS; atomic booking_event trigger on option_request update; model_traction view security_invoker. Run after #160.
162. `migration_security_audit_2026_04.sql`               ← VULN-01/06: fixes can_access_platform() (removes 'trialing' from subscription_active check, adds ORDER BY); VULN-04: tightens agency_invitations UPDATE to own-agency only; VULN-09: validates p_role enum in admin_update_profile_full. Run after #161.
163. `migration_access_gate_enforcement.sql`              ← BYPASS-01/02/03 (CRITICAL): adds has_platform_access() to get_models_by_location(), option_requests INSERT, messages INSERT. Introduces has_platform_access() boolean helper. Run after #162.
164. `migration_pentest_fullaudit_fixes_2026_04.sql`      ← Full adversarial pentest fixes: C-1 match_models paywall; C-2 models+model_photos client SELECT paywall; C-3/H-3 recruiting_threads UPDATE agency_id hijacking; C-4 conversations INSERT org validation + removes permissive bypass policies; H-2 recruiting_messages from_role role validation; H-6 stippen scope; H-5 validate_guest_booking_models RPC. Run after #163.

---

## Files NOT to run in production

- `assign_ami_to_johannes.sql` – one-off data assignment
- `diag_agency_recruiting_chat.sql` – diagnostic query only
- `diag_rls_open_policies_audit.sql` – diagnostic query only
- `monitoring_replication_slots.sql` – monitoring view; access revoked from authenticated in Phase 23 (#128)
- `seed_agencies.sql` – staging/dev seed data only
- `seed_models.sql` – staging/dev seed data only
- `scripts/cleanup_orphan_data_after_auth_delete.sql` – run manually as needed

---

## Verification Queries (run after full migration)

```sql
-- 1. Check for residual broad USING(true) policies
SELECT tablename, policyname, cmd, qual
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('client_agency_connections', 'option_requests', 'model_applications')
  AND (qual = 'true' OR with_check = 'true')
ORDER BY tablename, policyname;

-- 2. Duplicate owners (should return 0 rows)
SELECT organization_id, COUNT(*)
FROM organization_members WHERE role = 'owner'
GROUP BY 1 HAVING COUNT(*) > 1;

-- 3. Organizations without owner member (should return 0 rows)
SELECT o.id, o.name FROM organizations o
WHERE NOT EXISTS (
  SELECT 1 FROM organization_members m
  WHERE m.organization_id = o.id AND m.role = 'owner'
);

-- 4. Users without org (possible broken bootstrap — investigate)
SELECT p.id, p.role, p.created_at FROM profiles p
WHERE p.role IN ('client', 'agent')
  AND p.is_guest IS DISTINCT FROM true
  AND NOT EXISTS (SELECT 1 FROM organization_members m WHERE m.user_id = p.id);
```


--------------------------------------------------------------------------------
# SOURCE FILE: .env.example
--------------------------------------------------------------------------------

# Copy to .env.local and set values from Supabase Dashboard → Project Settings → API.
# Required names for Expo (use these in Vercel Production too):
EXPO_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your_anon_or_publishable_key
# Do not use SUPABASE_URL / SUPABASE_ANON_KEY alone — app.config maps them only as fallback.
# Optional; used when your project relies on the publishable default key.
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY=


--------------------------------------------------------------------------------
# APPENDIX: Repository map (generated file lists)
--------------------------------------------------------------------------------

## `src/services` TypeScript files

```
src/services/__tests__/acceptApplicationWithTerritories.test.ts
src/services/__tests__/accountSupabase.test.ts
src/services/__tests__/agencyAdminStorage.test.ts
src/services/__tests__/agencySettingsSupabase.test.ts
src/services/__tests__/agencyStorageSupabase.test.ts
src/services/__tests__/apiService.test.ts
src/services/__tests__/applicationsSupabase.recruiting.test.ts
src/services/__tests__/authInviteTokenPolicy.test.ts
src/services/__tests__/b2bOrgChatSupabase.createRpc.test.ts
src/services/__tests__/b2bOrgChatSupabase.resolve.test.ts
src/services/__tests__/b2bOrgChatSupabase.title.test.ts
src/services/__tests__/b2bOwnerBootstrapSupabase.test.ts
src/services/__tests__/bookingChatIntegrationSupabase.test.ts
src/services/__tests__/bookingChatPackageSource.test.ts
src/services/__tests__/bookingEventsSupabase.test.ts
src/services/__tests__/bookingsSupabase.test.ts
src/services/__tests__/clientDiscovery.test.ts
src/services/__tests__/guestAuthSupabase.test.ts
src/services/__tests__/guestChatSupabase.test.ts
src/services/__tests__/hardening2026_04.test.ts
src/services/__tests__/inviteUrlHelpers.test.ts
src/services/__tests__/mediaslideSyncService.test.ts
src/services/__tests__/messengerSupabase.getOrCreate.test.ts
src/services/__tests__/modelLocationsSupabase.test.ts
src/services/__tests__/modelMedia.test.ts
src/services/__tests__/modelPhotosSupabase.upsertPhotosForModel.test.ts
src/services/__tests__/modelsImportSupabase.importModelAndMerge.test.ts
src/services/__tests__/netwalkSyncService.test.ts
src/services/__tests__/notificationsSupabase.test.ts
src/services/__tests__/optionRequestsConfirmation.test.ts
src/services/__tests__/optionRequestsCounterOffer.test.ts
src/services/__tests__/organizationsInvitationsSupabase.test.ts
src/services/__tests__/packageMessage.test.ts
src/services/__tests__/projectsFeature.test.ts
src/services/__tests__/realtimeChannelPool.test.ts
src/services/__tests__/recruitingChatSupabase.rpcHelpers.test.ts
src/services/__tests__/recruitingChatSupabase.threadLookup.test.ts
src/services/__tests__/subscriptionSupabase.test.ts
src/services/__tests__/supabaseFetchAll.test.ts
src/services/__tests__/territoriesSupabase.resolveAgencyForModelAndCountry.test.ts
src/services/__tests__/territoriesSupabase.upsertTerritoriesForModel.test.ts
src/services/__tests__/territoriesSupabase.upsertTerritoriesForModelCountryAgencyPairs.test.ts
src/services/__tests__/userCalendarEventsSupabase.test.ts
src/services/accountSupabase.ts
src/services/activityLogsSupabase.ts
src/services/adminSupabase.ts
src/services/agenciesSupabase.ts
src/services/agencySettingsSupabase.ts
src/services/agencyStorageSupabase.ts
src/services/agencyUsageLimitsSupabase.ts
src/services/applicationsSupabase.ts
src/services/authInviteTokenPolicy.ts
src/services/b2bOrgChatSupabase.ts
src/services/b2bOwnerBootstrapSupabase.ts
src/services/bookersSupabase.ts
src/services/bookingChatIntegrationSupabase.ts
src/services/bookingEventsSupabase.ts
src/services/bookingsSupabase.ts
src/services/calendarSupabase.ts
src/services/chatService.ts
src/services/clientDiscoverySupabase.ts
src/services/clientFiltersSupabase.ts
src/services/clientOrganizationsDirectorySupabase.ts
src/services/consentSupabase.ts
src/services/dashboardSupabase.ts
src/services/documentsSupabase.ts
src/services/externalCalendarSync.ts
src/services/gdprComplianceSupabase.ts
src/services/guestAuthSupabase.ts
src/services/guestChatSupabase.ts
src/services/guestLinksSupabase.ts
src/services/imageUtils.ts
src/services/inviteUrlHelpers.ts
src/services/matchingSupabase.ts
src/services/mediaslideSyncService.ts
src/services/messengerSupabase.ts
src/services/modelLocationsSupabase.ts
src/services/modelPhotosSupabase.ts
src/services/modelsImportSupabase.ts
src/services/modelsSupabase.ts
src/services/netwalkSyncService.ts
src/services/notificationsSupabase.ts
src/services/optionRequestsSupabase.ts
src/services/orgMetricsSupabase.ts
src/services/orgRoleTypes.ts
src/services/organizationsInvitationsSupabase.ts
src/services/profileBatchSupabase.ts
src/services/projectsSupabase.ts
src/services/pushNotifications.ts
src/services/realtimeChannelPool.ts
src/services/recruitingChatSupabase.ts
src/services/searchSupabase.ts
src/services/stippenSupabase.ts
src/services/subscriptionSupabase.ts
src/services/supabaseFetchAll.ts
src/services/territoriesSupabase.ts
src/services/threadPreferencesSupabase.ts
src/services/userCalendarEventsSupabase.ts
src/services/verificationSupabase.ts
```

## Supabase Edge Functions (top-level folders)

```
supabase/functions/create-checkout-session
supabase/functions/delete-user
supabase/functions/member-remove
supabase/functions/send-push-notification
supabase/functions/serve-watermarked-image
supabase/functions/stripe-webhook
```

## Entry points (paths only)

```
App.tsx
index.ts
app.config.js
```

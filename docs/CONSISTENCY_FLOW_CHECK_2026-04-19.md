# Major Consistency Flow Check — 2026-04-19

**Scope:** Full system sweep über alle kanonischen Flows aus `system-invariants.mdc`, `auto-review.mdc`, `option-requests-chat-hardening.mdc`, `.cursorrules`, `agency-only-option-casting.mdc`, `client-web-gallery-guest-shared-audit.mdc`.
**Modus:** Read-only (statische Analyse + `npm run typecheck` + `npm run lint` + `npm test`).
**Repo-Stand:** `main` @ 2026-04-19 (lokal).
**Hinweis:** Live-DB Drift ist nicht im Scope — wo Ergebnis vom Live-Stand abhängt, steht `NEEDS_VERIFY` mit Verweis auf [docs/LIVE_DB_DRIFT_GUARDRAIL.md](LIVE_DB_DRIFT_GUARDRAIL.md).

---

## 1. Sanity Tests

| Schritt | Ergebnis | Notiz |
|---|---|---|
| `npm run typecheck` | ✅ PASS | 0 errors |
| `npm run lint` | ✅ PASS | 1 warning: `react-hooks/exhaustive-deps` in `src/web/ClientWebApp.tsx:571` (`packageViewState` dep) |
| `npm test -- --passWithNoTests --ci` | ✅ PASS | 143 suites, 1641 tests grün |

---

## 2. Executive Summary

| Cluster | Status | P0 | P1 | P2 |
|---|---|---|---|---|
| A — Auth, Org-Bootstrap, Invite/Claim | PASS | 0 | 0 | 2 |
| B — Service Layer Contract & Optimistic Updates | PASS | 0 | 0 | 3 |
| C — Option/Casting Lifecycle | PASS | 0 | 1 | 1 |
| D — Smart Attention & Calendar Projection | PASS | 0 | 0 | 0 |
| E — Discovery / Location / Near Me | PASS | 0 | 0 | 2 |
| F — RLS / SECDEF / Storage / Migrations | PASS (migrations) / WARN (Root-SQL Drift) | 4 (Root-SQL) | 0 | 1 |
| G — Connectionless First-Contact | PASS | 0 | 1 | 1 |
| H — Paywall / Billing / Org-Caps | PASS | 0 | 0 | 2 |
| I — Upload / Consent / GDPR | PASS | 0 | 0 | 3 |
| J — Mobile / Responsive / Chat | WARN | 1 (Model) | 0 | 3 |
| K — Client Web Gallery / Guest / Shared | PASS | 0 | 0 | 4 |

**Bottom Line:** Die kanonischen Backend- und Workflow-Invarianten sind im Repo erfüllt. Eine echte **P0-Produktabweichung** existiert in **Cluster J** (Model: Bottom-Tab-Bar bleibt im geöffneten Chat sichtbar — verletzt §28.1). **P0 Drift-Risiko** liegt in **Cluster F** durch Root-SQL-Dateien (`supabase/migration_*.sql` außerhalb `supabase/migrations/`), die historische Email-/`is_admin`-Patterns enthalten — diese werden vom Supabase-CLI **nicht** automatisch deployed; trotzdem Drift-Hygiene fehlend (vgl. [LIVE_DB_DRIFT_GUARDRAIL](LIVE_DB_DRIFT_GUARDRAIL.md)).

---

## 3. P0 — Kritische Befunde (sofort prüfen)

### P0-1 — Model Mobile Chat: BottomTabBar bleibt sichtbar (§28.1) — **FAIL**

**Cluster J · Mobile/Responsive/Chat**

Der mobile Chat-Workspace für Models (`src/screens/ModelProfileScreen.tsx`) blendet die untere Tab-Bar **nicht** aus, wenn ein Direkt-Chat (`openDirectConvId`) oder Booking-Thread (`openBookingThreadId`) geöffnet ist — der Chat liegt nur `bottomTabInset` über der Bar. Client und Agency erfüllen die Invariante (`clientChatFullscreen` / `agencyChatFullscreen` blenden korrekt aus).

```2572:2580:src/screens/ModelProfileScreen.tsx
{openDirectConvId && (
  <View
    style={{
      position: 'absolute',
      left: 0,
      right: 0,
      top: 0,
      bottom: bottomTabInset,
```

```2629:2631:src/screens/ModelProfileScreen.tsx
<View style={[st.bottomTabBar, { paddingBottom: insets.bottom }]}>
  <View style={st.tabRow}>
```

**Empfehlung:** Analog zu Client/Agency `modelChatFullscreen`-State einführen, der bei `openDirectConvId || openBookingThreadId` true ist und die Tab-Bar verbirgt; Chat füllt dann den vollen Screen.

### P0-2..P0-5 — Root-SQL Drift in `supabase/*.sql` (nicht `migrations/`)

**Cluster F · RLS/SECDEF/Storage**

Folgende Root-Dateien (außerhalb `supabase/migrations/`) enthalten Patterns, die laut System-Invariants **Risiko 1, 2, 4** sind:

| Datei | Zeile | Pattern | Risiko |
|---|---|---|---|
| `supabase/migration_restrict_embeddings_rls_2026_04.sql` | 30, 54, 69 | `p.is_admin = true` in Policy | **Risiko 1** |
| `supabase/migration_phase12_accounts.sql` | 105–122 | `EXISTS (… profiles … is_admin = true)` | **Risiko 1** |
| `supabase/migration_trial_reset_guard_2026_04.sql` | 52 | `is_admin = true` | **Risiko 1** |
| `supabase/migration_rls_fix_profiles_email.sql` | mehrere | `trim(lower(a.email)) = trim(lower(public.get_current_user_email()))` | **Risiko 2** |
| `supabase/migration_user_calendar_events.sql` | mehrere | `JOIN profiles` mit `a.email = p.email` | **Risiko 2** |
| `supabase/migration_hardening_2026_04_final.sql`, `migration_workflow_audit_fixes_2026_04.sql`, `migration_m3_m4_fixes.sql`, `migration_security_hardening_2026_04.sql` | — | parallele Definitionen von `fn_validate_option_status_transition` | **Risiko Drift** |

**Status:** Diese Dateien werden vom Supabase-CLI nicht automatisch ausgerollt; die kanonischen Fixes liegen in `supabase/migrations/` (z. B. `20260405_security_three_dangers_fix.sql`, `20260411_model_embeddings_policies_finalize.sql`, `20260413_fix_d_models_rls_client_secdef.sql`, `20260711_*` und `20260815_fix_validate_option_status_*`). **Aber:** Wenn jemand manuell ein Root-Skript ausführt, kann er stille Regression auf der Live-DB erzeugen.

**Empfehlung:**
1. Root-SQL-Dateien mit historisch unsicheren Patterns mit Kopfkommentar `-- DEPRECATED / DO NOT EXECUTE` markieren.
2. Periodisch `pg_get_functiondef` / `pg_policies` auf der Live-DB gegen die letzte `supabase/migrations/`-Version verifizieren (Skript `scripts/supabase-push-verify-migration.sh` ist bereits vorhanden).
3. Optional: CI-Check, der jedes neue `.sql` außerhalb `migrations/` zwingt, einen `-- DIAGNOSE / NOT DEPLOYED`-Header zu tragen.

---

## 4. P1 — Wichtige Befunde

### P1-1 — Client Web `ClientWebApp.tsx` Sync: kein Clear bei Sync-Fehler (Cluster G)

In der Hydration für authentifizierte Clients wird bei einer geworfenen Exception nur geloggt — der vorhandene UI-State bleibt stehen. Das ist kein „name-based merge“ (PASS gegenüber §27.14), aber ein transienter Netzwerkfehler kann alte Projekte sichtbar lassen, bis ein erfolgreicher Sync läuft.

```~835:841:src/web/ClientWebApp.tsx
} catch (e) {
  console.error('hydrate client projects error:', e);
}
```

**Empfehlung:** Im `catch` Branch zumindest einen Soft-Refresh-Hinweis im UI setzen oder bei explizitem Rechte-/Auth-Fehler `setProjects([])`.

### P1-2 — Cluster G: Zwei Insert-Kanäle (Client-getrieben + Agency-only)

`addOptionRequest` (Client-Pfad) und `createAgencyOnlyOptionRequest` (Agency-only) sind getrennte Pfade. Das ist konsistent mit der Produkt-Anforderung (verschiedene Defaults / Initial-Status), aber bedeutet, dass jede Verhaltensänderung am Workflow in **beiden** Kanälen geprüft werden muss (siehe `agency-only-option-casting.mdc` §15).

**Empfehlung:** In Code-Reviews PR-Template-Hinweis: „Wurde der Agency-only-Pfad mitgepflegt?“

### P1-3 — Cluster C: Optional terminale Job-Confirmation (`agencyConfirmJobAgencyOnlyStore`)

Die Audit-Notiz aus Cluster C verweist auf einen zweiten terminalen Job-Pfad neben `clientConfirmJobStore`. Beide implementieren das Calendar-Retry-Pattern (`updateCalendarEntryToJob` → 200 ms Wartezeit → einmal Retry → console.error) korrekt.

---

## 5. P2 — Hinweise / Polish

### Cluster B — Service-Layer & Optimistic Updates

- **Field-level Rollback** in einigen Store-Funktionen (z. B. `approveOptionAsModel`/`rejectOptionAsModel`) speichert mehrere `prev*`-Variablen statt eines Inverse-Operation-Patterns. Das ist akzeptabel für Single-Row-Updates auf einem Cache-Element, aber fragiler als Inverse Operation. Risiko gering.
- **`handleRemoveModelFromProject`** (in `src/web/ClientWebApp.tsx`) bietet keinen per-id Inflight-Lock (Audit-Notiz). Pattern-Vorschlag: `removeBusyIds`-Set analog zu `addingModelIds`.
- **`Promise.all([...].catch())`** in `AdminDashboard.tsx` und `adminSupabase.ts` sind kein Dead-Code, sondern bewusste Fallbacks für Exceptions in Admin-RPCs. Trotzdem zu dokumentieren (Kommentar „Option C / ServiceResult“ wäre klarer).

### Cluster C — Option Lifecycle

- **`modelRejectOptionRequest` Optimismus** für `final_status` im lokalen Cache: nach RPC-Erfolg läuft DB-Refresh (Invariante S), aber zwischen Optimismus und Refresh kann der Cache kurz vom Trigger-Reset abweichen. Status-Reset über `fn_reset_final_status_on_rejection` greift in der DB; UI-Refresh räumt auf.

### Cluster E — Discovery / Location

- **Alte Migrationen** mit `ON CONFLICT (model_id, agency_id, country_code)` in `20260406_security_definer_row_security_fix.sql` und `20260406_location_filter_consistency.sql` sind durch `20260413_fix_a_territory_unique_constraint.sql` und `20260416_fix_b_territory_constraint_name.sql` korrigiert. Ältere Definitionen bleiben als historische Migrations-Datei stehen — **kein** Live-Risiko, aber Drift-Verwirrung möglich.
- **`PdfExportModal`** rendert direkt `m.city` ohne `canonicalDisplayCityForModel` (§27.4). Empfehlung: Wenn das PDF user-facing ist, auf kanonische Stadtquelle umstellen.

### Cluster F — Live-DB Drift

- **`SECURITY DEFINER` ohne `SET row_security TO off`:** Repo-Statistik allein liefert kein abschließendes Bild. Empfehlung: Live-Skript aus `auto-review.mdc` §2b regelmäßig laufen lassen.

### Cluster G — Discover-Visibility

- Keine zusätzlichen Findings über die §27.10/§27.14-Hinweise hinaus.

### Cluster H — Paywall

- **`has_platform_access()`** lebt nur in `supabase/migration_access_gate_enforcement.sql` (Root, nicht `migrations/`). Logik ist trivial (Wrapper um `can_access_platform()`), aber **nicht** über CLI deployed. **NEEDS_VERIFY** auf Live-DB.
- **`can_access_platform`** wird in mehreren Migrationen redefiniert (zuletzt `20260416_fix_a_can_access_platform_sha256.sql`). Reihenfolge admin_override → trial → subscription → deny ist im aktuellen Stand korrekt; `pg_get_functiondef` auf Live empfohlen.

### Cluster I — Upload / Consent

- **`uploadRecruitingChatFile`** setzt `contentType: file.type`, lädt aber `safeFile` hoch (nach `stripExifAndCompress` kann der MIME abweichen). Pattern-Konsistenz mit `messengerSupabase.ts` (`safeFile.type`) angleichen.
- **`recordGuardianConsent`** und **`confirmMinorConsentByAgency`** rufen `logAuditAction` direkt statt `logAction`. Innerhalb derselben Datei (`gdprComplianceSupabase.ts`) tolerierbar, aber langfristig konsistent über `logAction(..., { allowEmptyOrg: true })` führen.
- **`source: 'trigger'`** in DB-Trigger-`PERFORM log_audit_action`-Aufrufen aktuell nicht gesetzt (Default `'api'`). Bei Audit-Auswertung schwerer zuzuordnen.

### Cluster J — Mobile/Responsive

- **Header-Compaction**: `INDEX CASTING`-Brand-Zeile rendert auf allen Tabs (Client/Agency/Model). §28.3 fordert kompakteren Header außerhalb des Dashboards.
- **Horizontale Pills mit `flexWrap: 'wrap'`** in Client-Web Calendar-Typ-Filter (`ClientWebApp.tsx:4709-4715`) und mehreren Stellen in `AgencyControllerView.tsx`. §28.4 verbietet vertikales Umbrechen für kritische Pill-Zeilen.
- **`CalendarViewModeBar`** ohne `ScrollView horizontal` — auf sehr schmalen Mobile-Screens potenziell gequetscht.
- **Model BottomTab** ohne horizontales Scrollen (`justifyContent: 'space-around'`) — bei langen Labels riskant.

### Cluster K — Gallery/Guest/Shared

- **`ProjectDetailView`** Messzeilen ohne `—`-Fallback bei `null` (`{data.measurements.height} cm`). UX-Polish.
- **`waist ?` / `hips ?`** in `GuestView.tsx` blendet numerischen `0` aus — Randfall (selten realistisch, aber konsistent zu `chest ?? bust` mit `??` zu führen).
- **`package_label` Format**: Aktuell „nur Anzahl“ in `package_label`, der echte Name liegt in `package_name`. UI rendert beides kombiniert; spec wollte einen einzelnen Key `"Name · N models"`.
- **`PdfExportModal` Footer** „Generated via Index Casting“ — kein Diagonal-Watermark, aber bewusst zu prüfen ob Branding gewünscht.

---

## 6. Cluster-Detailberichte

### Cluster A — Auth, Org-Bootstrap, Invite/Claim — **PASS**

| Invariante | Status |
|---|---|
| `signIn` Step-1/Step-2 isoliert (admin-security Regel 1) | PASS |
| `bootstrapThenLoadProfile`: Invite VOR Owner-Bootstrap (system-invariants `INVITE-BEFORE-BOOTSTRAP`) | PASS — `src/context/AuthContext.tsx:505-557` |
| 3-Level Admin-Detection in `loadProfile` | PASS |
| `App.tsx` Admin-Routing VOR `effectiveRole`-Check | PASS — `App.tsx:1073-1100` |
| `finalizePendingInviteOrClaim` Session+Token, idempotent | PASS |
| `ensure_plain_signup_b2b_owner_bootstrap` pending-invite-Check | PASS — `supabase/migrations/20260818_fix_invite_zombie_org.sql` |
| `accept_organization_invitation` Zombie-Cleanup | PASS — gleiche Migration |
| Live-DB Drift `pg_get_functiondef` | NEEDS_VERIFY |

### Cluster B — Service Layer Contract & Optimistic Updates — **PASS**

| Invariante | Status |
|---|---|
| Option A vs ServiceResult — keine Vermischung in einer Funktion | PASS |
| Snapshot-Rollbacks (`const snapshot =`, `.slice()`) verboten | PASS — keine Vorkommen in `src/web/ClientWebApp.tsx` |
| Inverse-Operation Rollback (filter/add-back mit `alreadyPresent`/`some()`-Guard) | PASS |
| Per-id Inflight-Lock (`addingModelIds`, `removeBusyIds`) | PASS außer `handleRemoveModelFromProject` (P2) |
| Server Reconciliation Refetch nach `ok===true` (`reconcileProjectModels`) | PASS |
| `useRef`-basierte Feedback-Timer | PASS |
| `.catch()` allein auf Option-A Service = dead code | PASS (keine Vorkommen außer Admin-Fallback P2) |

### Cluster C — Option/Casting Lifecycle — **PASS** (1 P1, 1 P2)

| Invariante | Status |
|---|---|
| Axis 1 (Preis) ↔ Axis 2 (Availability) Trennung — Invariante K | PASS |
| `agencyConfirmAvailabilityStore` setzt nur `final_status` | PASS |
| `agencyAcceptClientPriceStore` / `agencyCounterOfferStore` / `agencyRejectClientPriceStore` setzen nur Axis-1 | PASS |
| `clientAcceptCounterStore` / `clientRejectCounterStore` setzen nur Axis-1 | PASS |
| `clientConfirmJobStore` einzige Stelle mit kombinierten Achsen (terminal) | PASS |
| `beginCriticalOptionAction` / `endCriticalOptionAction` Inflight-Guard | PASS für alle audited Stores |
| `modelRejectOptionRequest` Payload ohne `final_status` | PASS |
| `model_declined_availability` System-Message in beiden Codepfaden | PASS |
| `modelConfirmOptionRequest` Gate `final_status === 'option_confirmed'` | PASS |
| `getPendingModelConfirmations` `.eq('status', 'in_negotiation')` | PASS |
| `OPTION_REQUEST_SELECT_MODEL_SAFE` ohne Preis-Felder | PASS — `src/services/optionRequestsSupabase.ts:33-35` |
| Trigger-Chain: `tr_reset_final_status_on_rejection` < `trg_validate_option_status` (alphabetisch) | PASS — Migrationen `20260555` + `20260815` |
| Live-DB Trigger Application | NEEDS_VERIFY |
| `agencyConfirmJobAgencyOnlyStore` Calendar-Retry | PASS (siehe P1) |

### Cluster D — Smart Attention & Calendar Projection — **PASS**

Vollständig clean. Alle `attentionSignalsFromOptionRequestLike`-Call-Sites setzen `isAgencyOnly`. `calendarProjectionBadge` und `calendarGridColorForOptionItem` behandeln beide Job-Pending-Zustände (Client + Agency-only). `updateBookingDetails` filtert cancelled rows. `updateCalendarEntryToJob` mit Retry in beiden Job-Stores. `booking_events` Fetcher mit `.neq('status', 'cancelled')`. `model_account_linked ?? false` überall. `subscribeToConversation` mit INSERT + UPDATE. B2B-Booking-Karte mit dynamischem `request_type`-Label.

### Cluster E — Discovery/Location/Near Me — **PASS** (2 P2)

| Invariante | Status |
|---|---|
| Constraint `model_agency_territories_one_agency_per_territory` UNIQUE(model_id, country_code) | PASS — `20260413_fix_a_territory_unique_constraint.sql` |
| Aktuelle `ON CONFLICT (model_id, country_code)` ohne agency_id | PASS |
| `get_discovery_models`: `p_city` hard filter auf `effective_city`, `p_client_city` Boost | PASS — `20260826_discovery_models_city_proximity.sql` |
| ClientWebApp `discoveryFilters` mappt `clientCity` + `city` korrekt | PASS — `src/web/ClientWebApp.tsx:1125-1128` |
| Pagination/Cursor sendet city + clientCity | PASS |
| `get_models_near_location` mit `first_territory` CTE / `DISTINCT ON (model_id)` | PASS — `20260803_scalability_near_me_bbox_before_distinct.sql` |
| `get_models_by_location` ↔ `get_discovery_models` `effective_city` Parität | PASS — `20260828_get_models_by_location_effective_city_parity.sql` |
| `model_locations` `UNIQUE(model_id, source)`, CHECK source IN ('live','current','agency') | PASS — `20260406_location_multirow_priority.sql` |
| `source: 'model'` im Code (deprecated) | PASS — 0 Vorkommen |
| `fetchEffectiveDisplayCitiesForModels` für Agency-Roster | PASS |
| Source-Priority `live → current → agency` | PASS — Reihenfolge in DISTINCT ON |
| Canonical City Display in user-facing Views | PASS (mit P2 für `PdfExportModal`) |

### Cluster F — RLS/SECDEF/Storage/Migrations — **PASS (migrations) / WARN (Root-SQL Drift)**

| Invariante | Status (migrations/) | Drift (Root-SQL) |
|---|---|---|
| `profiles.is_admin = true` in Policies | PASS | **P0** in 4 Root-Dateien |
| Email-Matching in Policies | PASS | **P0** in 2 Root-Dateien |
| Email-Matching im Frontend | PASS | — |
| `agencies[0]` Frontend-Fallback | PASS (Ausnahme `ModelAgencyContext` semantisch korrekt) | — |
| SECURITY DEFINER mit `SET row_security TO off` | NEEDS_VERIFY (Live) | — |
| `FOR ALL` auf Watchlist (model_embeddings, model_locations, MAT, calendar_entries, model_minor_consent) | PASS | — |
| Self-Reference `clients_view_model_territories` ohne `self_mat` | PASS — `20260414_fix_mat_client_policy_self_ref_regression.sql` | — |
| Storage Policies `documentspictures` über SECDEF Helper | PASS — `20260406_fix_storage_policies_secdef.sql` | — |
| `profiles.role = 'X'` in models policies | PASS — `20260413_fix_d_models_rls_client_secdef.sql` | — |
| Kritische Trigger/Funktionen in `migrations/` | PASS | parallele Definitionen in Root (P2) |
| `agency_create_option_request` types/columns/INSERT+UPDATE | PASS — `20260716_agency_create_option_request_definitive.sql` | — |

### Cluster G — Connectionless First-Contact (12 Invarianten) — **PASS** (1 P1, 1 P2)

| # | Invariante | Status |
|---|---|---|
| 1 | Connectionless first-contact (`client_agency_connections` nicht erforderlich) | PASS — `add_model_to_project` (`20260527_*`), `addOptionRequest`, Chat-Bootstrap |
| 2 | Entry-point parity (ein Kernpfad) | PASS für Client; **WARN P1** zwei Kanäle (Agency-only legitim) |
| 3 | Role integrity (kein Spoofing) | PASS — `20260545_option_request_system_messages.sql` |
| 4 | System message via RPC `insert_option_request_system_message` | PASS |
| 5 | No-model-account flow (`no_model_account` + `no_model_account_client_notice`) | PASS |
| 6 | Model-account confirmation + MODEL_SAFE select | PASS |
| 7 | RETURNING / RLS parity (kein `.insert().select().single()` für Confirmations) | PASS |
| 8 | Request-context resolver: `agency_organization_id` bevorzugt | PASS — `optionRequestsSupabase.ts:1610-1619` |
| 9 | Package/Project/Guest stability — keine silent "0 models" | PASS |
| 10 | Client B2B Projects DB-Wahrheit (§27.14) | PASS; **WARN P1** Sync-Catch ohne Clear |

### Cluster H — Paywall/Billing/Org-Caps — **PASS** (2 P2)

| Invariante | Status |
|---|---|
| `can_access_platform()` Reihenfolge admin_override → trial → subscription → deny | PASS — `20260416_fix_a_can_access_platform_sha256.sql` |
| Trial-Block via `used_trial_emails` (sha256 hash) | PASS |
| `has_platform_access()` Wrapper | PASS Logik; **NEEDS_VERIFY** nur in Root-SQL |
| Owner-only Checkout (Edge Function) | PASS — `create-checkout-session/index.ts:184-190` 403 für Non-Owner |
| Stripe Webhook → `organization_subscriptions.upsert` als Wahrheit | PASS — `stripe-webhook/index.ts:126-134` |
| Frontend Plan State nur Spiegel | PASS — `SubscriptionContext.tsx:7-9` |
| Fail-closed bei Fehler | PASS — `subscriptionSupabase.ts:117-128` |
| Agency Seat Caps DB-enforced (Trigger auf `organization_members` + `invitations`) | PASS — `20260510_agency_org_seat_limits.sql` |
| Plan-Mapping Trial=2/Basic=2/Pro=4/Enterprise=NULL | PASS |
| Booker/Employee triggern keinen Checkout | PASS |
| Sandbox vs Live nur Konfiguration | PASS |

### Cluster I — Upload/Consent/GDPR — **PASS** (3 P2)

| Service | Upload-Parität | Notiz |
|---|---|---|
| `modelPhotosSupabase.uploadModelPhoto`/`uploadPrivateModelPhoto` | PASS | HEIC, MIME, Magic, EXIF strip, upsert:false |
| `applicationsSupabase.uploadApplicationImage` | PASS | gleiche Kette |
| `messengerSupabase.uploadChatFile` | PASS | sanitize, upsert:false, contentType: safeFile.type |
| `recruitingChatSupabase.uploadRecruitingChatFile` | **WARN P2** | `contentType: file.type` vs `safeFile`-Upload — Inkonsistenz mit messengerSupabase |
| `documentsSupabase.uploadDocument` | PASS | |
| `verificationSupabase.submitVerification` | PASS | |
| `optionRequestsSupabase.uploadOptionDocument` (deprecated) | PASS | |

| Sonstige Invarianten | Status |
|---|---|
| `confirmImageRights` Idempotenz (60min check + 23505 = success) | PASS — `gdprComplianceSupabase.ts:286-326` |
| Zentrales `logAction()` außerhalb `logAction.ts` + `gdprComplianceSupabase.ts` | PASS |
| `recordGuardianConsent`/`confirmMinorConsentByAgency` direkter `logAuditAction` | **WARN P2** — könnte über `logAction` laufen |
| `link_model_by_email` nur in AuthContext (deprecated) | PASS |
| `claim_model_by_token` für neue Flows | PASS |
| Storage Helper `can_view_model_photo_storage` aligned mit `model_photos` | PASS — `20260501_*` |
| `source: 'trigger'` in DB-Trigger Audit-Logs | **WARN P2** — aktuell durchgängig 'api' |

### Cluster J — Mobile/Responsive/Chat — **WARN** (1 P0, 3 P2)

| Invariante | Client | Agency | Model | Notiz |
|---|---|---|---|---|
| Vollbild-Chat / BottomTab versteckt (§28.1) | PASS | PASS | **FAIL P0** | Model: `bottomTabInset`-Layout statt Fullscreen |
| Liste vs. Detail trennen (§28.2) | PASS | PASS | NEEDS_VERIFY | |
| Header-Compaction außerhalb Dashboard (§28.3) | WARN P2 | WARN P2 | WARN P2 | INDEX CASTING brand auf allen Tabs |
| Horizontale Pills (§28.4) | WARN P2 | WARN P2 | NEEDS_VERIFY | `flexWrap: 'wrap'` Calendar-Typfilter, `CalendarViewModeBar` ohne horizontal scroll |
| BottomTab vollständig (§28.5) | PASS | PASS | WARN P2 | Model ohne horizontal scroll |
| Volle Breite (§28.6) | PASS | NEEDS_VERIFY | NEEDS_VERIFY | |
| Ein kanonisches Event pro Lifecycle (§28.7) | PASS | PASS | PASS | `agencyCalendarUnified.preferJobBookingOverOptionRows` |
| Notes als Metadaten, nicht Lifecycle-Event (§28.8) | PASS | PASS | PASS | |
| Month/Week/Day strikt isoliert (§28.9) | PASS | PASS | — | `B2BUnifiedCalendarBody:114-152` |
| Calendar Scrollbarkeit (§28.10) | PASS | PASS | — | `nestedScrollEnabled` in `CalendarDayTimeline` |
| Calendar-Farben semantisch (§28.11) | PASS | PASS | — | via `getCalendarProjectionBadge` |

### Cluster K — Client Web Gallery/Guest/Shared — **PASS** (4 P2)

| Invariante | Status |
|---|---|
| `StorageImage` named export überall | PASS |
| `SharedSelectionView` cover `resizeMode="contain"` | PASS |
| Watermark-Verbot auf Modelfotos | PASS in Galerie-Pfaden; **WARN P2** Legacy `serve-watermarked-image` Edge Function |
| Detail Action CTAs (Chat/Option/Add) mit Gating | PASS |
| `get_guest_link_info` exposes agency_id/agency_name | PASS — `20261021_*` |
| Post-Signup Recovery (`ic_pending_guest_link`, `ic_pending_shared_selection`) | PASS — `App.tsx` + `ClientWebApp.tsx` |
| Edge Function `sign-guest-storage-asset`: DB-Allowlist + flexible CORS | PASS |
| Messwerte: `—` statt `0 cm`, `chest ?? bust` mit `??` | PASS Guest/Shared/Package; **WARN P2** `ProjectDetailView` ohne `—`-Fallback |
| PDF Export: Web-only, dynamic `jspdf` import, scope = current entity | PASS; **WARN P2** Footer-Text |
| Active Options Overlay → `setOpenThreadIdOnMessages + setTab('messages')` | PASS — `ClientWebApp.tsx:2651-2659` |
| `package_label` Format `"Name · N models"` | **WARN P2** — Aktuell split `package_label` (count) + `package_name` (name) |
| `isPackageMode` / `isSharedMode` Isolation | PASS — `ClientWebApp.tsx:1559-1562` |

---

## 7. Empfehlungs-Tracker

| ID | Cluster | Severity | Beschreibung | Vorschlag |
|---|---|---|---|---|
| F-1 | F | P0 (Drift) | 6 Root-SQL-Dateien mit `is_admin = true` / Email-Matching in Policies | Headers `-- DEPRECATED, NOT DEPLOYED` + Live-Verify-Skript einplanen |
| F-2 | F | P2 | Doppelte `fn_validate_option_status_transition` Definitionen | gleiche Maßnahme |
| F-3 | F | P2 | SECDEF + `row_security TO off` Live-Vollständigkeit nicht aus Repo verifizierbar | regelmäßiger `pg_proc`-Scan |
| H-1 | H | P2 | `has_platform_access()` nur in Root-SQL | Migration unter `supabase/migrations/` ergänzen |
| H-2 | H | P2 | Live-DB `can_access_platform` Reihenfolge | `pg_get_functiondef` verifizieren |
| J-1 | J | **P0** | Model: BottomTab bleibt im geöffneten Chat sichtbar | `modelChatFullscreen`-State analog Client/Agency |
| J-2 | J | P2 | Header-Compaction fehlt | `INDEX CASTING` brand außerhalb Dashboard kompakter |
| J-3 | J | P2 | `flexWrap: 'wrap'` für Calendar-Typfilter | horizontal scroll oder `flexShrink` + `minWidth: 0` |
| J-4 | J | P2 | Model BottomTab ohne horizontal scroll | analog Client/Agency `ScrollView horizontal` |
| I-1 | I | P2 | `uploadRecruitingChatFile` `contentType: file.type` | auf `safeFile.type` angleichen |
| I-2 | I | P2 | `recordGuardianConsent`/`confirmMinorConsentByAgency` direkter `logAuditAction` | über `logAction(..., { allowEmptyOrg: true })` |
| I-3 | I | P2 | `source: 'trigger'` fehlt in DB-Trigger Audit-Logs | gezielt setzen für Auswertbarkeit |
| K-1 | K | P2 | `package_label` Format split | optional: einheitliches Feld `"Name · N models"` |
| K-2 | K | P2 | `ProjectDetailView` Messzeile ohne `—` Fallback | `formatMeasurement`-Helper anwenden |
| G-1 | G | P1 | Sync-Fehler in `ClientWebApp.tsx:835-841` ohne Clear | Soft-Refresh-Hinweis im UI |
| B-1 | B | P2 | `handleRemoveModelFromProject` ohne Inflight-Lock | `removeBusyIds`-Set einführen |

---

## 8. Methodik

- 11 parallele `explore`-Subagents (Read-only) pro Cluster.
- Statische Analyse der `src/`, `supabase/migrations/`, `supabase/functions/`, `App.tsx`, `.cursor/rules/*.mdc`, `.cursorrules`.
- Verifikation per `Grep` / `Glob` auf konkrete Pattern-Verstöße.
- Sanity-Tests via `npm run typecheck` + `npm run lint` + `npm test --passWithNoTests --ci`.
- Live-DB Drift explizit als `NEEDS_VERIFY` markiert (kein DB-Zugriff im Audit).

## 9. Was nicht im Scope war

- Live-DB Verifikation (`pg_get_functiondef`, `pg_policies`-Scan auf Production).
- E2E Smoke-Tests (manuelle Regression-Checkliste aus `auto-review.mdc` §2d).
- UX-visuelle Prüfung auf realen Devices (nur Code-Pattern-Analyse für §28).
- Stripe Live vs Sandbox Roundtrip.

---

**Autor:** Cursor Agent (Auto-Review Mode), 2026-04-19
**Repo-Stand:** lokaler `main` zum Audit-Zeitpunkt
**Folge-Verifikation empfohlen:** Live-DB Drift-Scan gemäß [docs/LIVE_DB_DRIFT_GUARDRAIL.md](LIVE_DB_DRIFT_GUARDRAIL.md) und [docs/SECURITY_RELEASE_TEMPLATE.md](SECURITY_RELEASE_TEMPLATE.md).

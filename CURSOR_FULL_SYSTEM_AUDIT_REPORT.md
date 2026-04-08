# CURSOR_FULL_SYSTEM_AUDIT_REPORT

**Scope:** Repository-weiter System-, Security-, Workflow- und Rollen-Audit (Frontend, Services, Supabase-Migrations, Doku).  
**Do-not-touch (eingehalten):** `AuthContext.tsx`, `App.tsx` (keine Änderungen), `signIn` / `bootstrapThenLoadProfile` / `loadProfile`, Admin-RPCs (`get_own_admin_flags`, `is_current_user_admin`, `assert_is_admin`), `get_my_org_context`, Paywall-Kern (`can_access_platform` / Migrations-Logik), Admin-Routing-Reihenfolge — nur **gelesen** und dokumentiert.

**Closeout:** `FULL SYSTEM AUDIT COMPLETED` (keine Produktcode-Änderungen in P6).

---

## 1. Executive Summary

Die Architektur ist **überwiegend konsistent** mit den Cursor-Rules und den technischen Referenz-Dokumenten unter `docs/`. Zentrale Trust Boundaries (Paywall in der DB, Model-Schreibwege über `agency_update_model_full`, Multi-Row-Locations mit Priorität live → current → agency, Option/Casting mit drei Kommunikationsflächen) sind **im Code und in der Doku abgebildet**.

**Keine CRITICAL-Fundstelle** im Stichproben-Umfang dieses Audits (ohne Live-DB-SQL gegen `pg_policies` / `pg_get_functiondef`). **HIGH** bleibt wie bisher: jede Produktänderung an JSONB-Notizen/Brief muss das **UI-Trust-Modell** kennen (siehe Booking Brief). **MEDIUM/LOW** betreffen vor allem **intentionale** Teil-Pfade (Sync-Connectors schreiben Teilmengen von Modelfeldern, Legacy-Org-Brücken bei `option_requests`) und **Observability** (Netwalk-Fehlerlogs nutzen den Schlüssel `mediaslideId` aus dem gemeinsamen Logger).

**Empfehlung nächster Schritt:** Wenn keine neuen Security-Blocker aus Live-DB-Verifikation kommen, ist ein **Discovery-Algorithmus-/Ranking-Audit** der sinnvollere zweite Gang (dieses Audit hat Algorithmen nur klassifiziert, nicht neu designt). Ein **UI-Audit** lohnt sich parallel, wenn viele MEDIUM-Findings UX-Inkonsistenzen betreffen.

---

## 2. Trust Boundaries / Source-of-Truth Map

| Bereich | Source of Truth | UI / Workflow-Layer | Security Boundary |
|--------|-----------------|---------------------|-------------------|
| Session / Identität | Supabase Auth (`session.user`) | Loading-Gates in `App.tsx` | JWT, RLS als `auth.uid()` |
| Profil / Rolle | `profiles` + Lade-Pipeline (nicht geändert) | `effectiveRole`, `isAdmin(profile)` für Routing | Admin: UUID+Email-Pin in DB-RPCs |
| B2B-Org-Kontext | `organization_members` + `organizations` | `profile.agency_id` / Org aus `get_my_org_context` (Multi-Row) | RLS + SECDEF-RPCs |
| Paywall | `can_access_platform()` (Reihenfolge fix) | `SubscriptionContext`, `PaywallScreen`, Guards | RPC/RLS; UI nur Spiegel |
| Models (Felder) | `public.models` via RLS; Agency-Writes **SECDEF** `agency_update_model_full` | Agency/Model Screens | RPC-Guards (model-scoped agency) |
| Territories | `model_agency_territories` | Bulk-Modal nur Territories | UNIQUE (model_id, country_code) |
| Location (Near Me) | `model_locations` + `DISTINCT ON` Priorität live > current > agency | Badges, Single-Save | `upsert_model_location` Auth-Split |
| Option/Casting | `option_requests` + Trigger/DB für Calendar | Store + drei Kanäle (Thread, B2B, Calendar) | Org-gefilterte Services + RLS |
| Booking / Kalender | `calendar_entries`, `booking_events` | Merge/Dedupe in Client/Agency Views | RLS auf Tabellen |
| Booking Brief | `booking_details.booking_brief` (JSONB) | `filterBriefForRole` / Editor | **Kein** separates RLS pro Feld — gleiches Modell wie Notes |
| Assignment / Attention | `client_assignment_flags`, abgeleitete Attention | Filter/Sort, Badges | **Explizit nicht** ACL |
| Discovery | RPCs z. B. `get_models_by_location`, Client-Discovery-Services | Filter-UI | `has_platform_access` / RLS je nach Pfad |
| Uploads | Storage + Service-Pipelines (Matrix-Doku) | Consent-UI | Policies + SECDEF-Helper wo vorgesehen |
| Audit | `log_audit_action` RPC | `logAction()` (Regel), GDPR-intern `logAuditAction` | Org-Pflicht wo vorgesehen |

**Hinweis Live-DB:** Kanonisch für deployten Stand bleibt die **Live-Datenbank** bei Abweichungen Repo ↔ Production (`docs/LIVE_DB_DRIFT_GUARDRAIL.md`). Dieses Audit hat **keine** Management-API-Queries ausgeführt.

---

## 3. Role-by-Role Findings

| Rolle | Einstieg (App-Routing, nur Beobachtung) | Sicht / Schreiben (kurz) | Klassifikation |
|-------|----------------------------------------|---------------------------|----------------|
| **Admin** | Nach Password-Recovery: `isAdmin(profile)` **vor** `effectiveRole`-Gate → `AdminDashboard` | Admin-RPCs mit `assert_is_admin()` | NO_ISSUE — entspricht `admin-security.mdc` |
| **Agency** | `effectiveRole === 'agency'` + `AgencyPaywallGuard` | `AgencyView` / `AgencyControllerView`; Model-Save, Territories, Sync, Options | NO_ISSUE |
| **Client** | `effectiveRole === 'client'` + `ClientPaywallGuard` | `ClientView` / Web Discover, Options, Calendar | NO_ISSUE |
| **Model** | `effectiveRole === 'model'` (ohne Org-Paywall-Guard wie B2B) | Eigenes Profil, Location live/current, Option-Inbox | NO_ISSUE (Paywall für B2B dokumentiert) |
| **Guest / Magic** | `profile.is_guest` → `GuestChatView` | Eingeschränkter Chat | NO_ISSUE |
| **Guest Link** | `?guest=` nur ohne „authenticated non-guest“ | `GuestView` | NO_ISSUE |
| **Package** | In-App Discover mit `packageViewState` | Option mit `source: 'package'` (Doku) | NO_ISSUE |

**Owner-only Billing:** Wie in `docs/PAYWALL_SECURITY_SUMMARY.md` — Checkout über Edge Function mit Owner-Rolle; nicht im Code dieses Audits geändert.

---

## 4. Save / Update / Sync Parity

| Pfad | RPC / API | Beobachtung | Klassifikation |
|------|-----------|-------------|----------------|
| Agency My Models Single Save | `agency_update_model_full` + `upsert_model_location` agency | Vollständiger Feldsatz inkl. sports, email, `current_location` | NO_ISSUE — kanonisch laut `MODEL_SAVE_LOCATION_CONSISTENCY.md` |
| Add Model / Import merge | `importModelAndMerge` + ggf. `agency_claim_unowned_model` / `agency_update_model_full` | Portfolio/Polaroids, viele Felder | NO_ISSUE |
| Mediaslide sync | `agency_update_model_full` Teilmenge + `update_model_sync_ids` + Territory-Paar | Kein `p_email` / `p_current_location` / sports in diesem RPC-Call | **ACCEPTED_ARCHITECTURAL_LIMIT** — Connector deckt nur Fremdsystem-Felder ab; manuelles Edit bleibt SoT für restliche Felder |
| Netwalk sync | Wie Mediaslide; zusätzlich `p_country` | Gleiche Teilmengen-Logik | ACCEPTED_ARCHITECTURAL_LIMIT |
| Visibility-only | `updateModelVisibilityInSupabase` → `agency_update_model_full` | Minimal-RPC | NO_ISSUE |
| Model Photos | `agency_update_model_full` für Cover etc. (Stichprobe) | SECDEF-Pfad | NO_ISSUE |
| Bulk Agency | Territories nur (kein Bulk Current Location) | Entspricht Produktregel | NO_ISSUE |

**Location-Priorität:** Doku + Invarianten: **live > current > agency** — keine Code-Stelle gefunden, die diese Reihenfolge für Near Me umkehrt (kein Deep-Review jeder SQL-Zeile ohne Live-DB).

---

## 5. Security / Visibility Findings

| Thema | Ergebnis | Klassifikation |
|-------|----------|----------------|
| Email-Matching in `src` Queries | `rg` **keine** Treffer für `.eq('email', ...)` unter `src/` | NO_ISSUE (Stichprobe) |
| `LIMIT 1` / `maybeSingle` für Org | u. a. `subscriptionSupabase`, `calendarSupabase` — Paywall/überschaubare Lookups; Paywall-„älteste Membership“ dokumentiert als Ausnahme | NO_ISSUE / dokumentiert |
| SECDEF / Migrations | Viele Härtungs-Migrationen (FOR ALL-Split, MAT self-ref, models RLS) | NO_ISSUE im Repo-Stand; **MANUAL_REVIEW_REQUIRED** für Live-Policy-Queries |
| Workflow als Security | Assignment, Attention, Contextual Chat laut Doku nicht ACL | NO_ISSUE |

---

## 6. Workflow Consistency Findings

| Thema | Klassifikation |
|-------|----------------|
| Option Thread + B2B Booking Card + Calendar | **ACCEPTED_ARCHITECTURAL_LIMIT** — drei Kanäle by design (`OPTION_CASTING_FLOW.md`) |
| Kalender-Konflikt bei Option-Submit | Fail-open Warnung | NO_ISSUE — dokumentiert |
| Legacy `agency_organization_id` / `client_organization_id` null | OR-Filter in Agency-Reads | MEDIUM — technische Schuld, bekannt in Doku |
| Global Search → Option Thread | `searchOptionId` / Messages-Tab | NO_ISSUE — dokumentiert |
| Status-Farben Thread vs. Inbox | Unterschiedliche Abstraktionen | LOW — dokumentiert als Non-Goal |

---

## 7. Booking Brief Privacy-Boundary Assessment

- **Implementierung:** Strukturierte Felder in `calendar_entries.booking_details.booking_brief`; Sichtbarkeit über **UI-Filter** (`filterBriefForRole`, Merge im Editor), **nicht** über getrennte JSONB-Spalten oder RLS pro Feld.
- **Bewertung:** Entspricht dem **expliziten Produktvertrag** in [`docs/BOOKING_BRIEF_SYSTEM.md`](docs/BOOKING_BRIEF_SYSTEM.md) und derselben Trust-Grenze wie `agency_notes` / `client_notes` / `model_notes`: Wer die Zeile lesen darf, erhält das JSON.
- **Klassifikation:** **ACCEPTED_ARCHITECTURAL_LIMIT** für die aktuelle Architektur.
- **Future Hardening (nur Konzept):** Serverseitiges Filtern in einer SECDEF-Read-RPC, oder Aufteilung sensibler Felder in geschützte Spalten — **erfordert separates Security/Product Review** und wäre kein „kleiner Fix“.

---

## 8. Small Fixes Applied Now

**Keine.** Es gab keinen glasklar lokalen Fix ohne Nebenwirkungen (z. B. Umbenennung der Netwalk-Log-Felder würde den gemeinsamen `logMediaslideError`-Typ/Verbraucher anfassen).

---

## 9. Rules Decision (P7)

- **`.cursorrules`**, **`system-invariants.mdc`**, **`auto-review.mdc`:** **Keine Änderung** — keine neue globale Invariante über die bereits dokumentierten hinaus bestätigt.
- **`docs/*`:** **Keine Änderung** — bestehende Referenzen decken Booking Brief, Option Flow, Location, Paywall ab.

---

## 10. Top Priorities Next

1. **Live-DB-Verifikation** (wenn Token verfügbar): Queries aus `auto-review.mdc` §2b (FOR ALL Watchlist, MAT self-ref, `profiles.is_admin` in Policies).
2. **Discovery/Ranking-Audit:** Inkonsistenzen klassifizieren (ohne Redesign), Abgleich Service ↔ RPC ↔ UX.
3. **Observability:** Optional gemeinsamer Log-Typ für Mediaslide/Netwalk mit neutralem Feld `external_sync_id` statt `mediaslideId` für Netwalk — **kleines** Refactoring, eigenes Ticket.

---

`FULL SYSTEM AUDIT COMPLETED`

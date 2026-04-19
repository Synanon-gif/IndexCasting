# Security Audit — 2026-04-19

**Scope:** Major Security Check, vollständig — Repo-Audit (RLS, SECURITY DEFINER, Service-Layer, Storage, Frontend-Leaks, Uploads, Admin, Paywall, GDPR) + Live-DB Verifikation gegen Production (`ispkfdqzjrfrilosoklu`).

**Baseline:** [`docs/FULL_SYSTEM_AUDIT_2026-04-17.md`](FULL_SYSTEM_AUDIT_2026-04-17.md). Delta-Surface: 25 Migrations seit 2026-04-17 (15 neue; 10 ältere zur Konsolidierung) + 40 commits, davon 5 große Feature-Bündel (Agency-to-Agency Roster Share, Two-Stage Org Dissolution, Guest Link Mixed Packages, Edge Function Signed-URLs, Co-Agency Model Claim Token).

**Methodology:** §2b Live-Queries (`pg_policies`, `pg_get_functiondef`, `pg_trigger`, `information_schema`), gezielte Anti-Pattern-Greps (Risiken 9, 12, 16, 18, 20, 21, 34, 39, 43, 49, 51 + JSON.stringify, eq('email'), Snapshot-Rollbacks, ON CONFLICT (model_id) only, supabase.rpc('admin_*) leak), 33 Pflicht-Fragen Q1–Q33.

---

## TL;DR

| | Count |
|---|---|
| **CRITICAL** | 0 |
| **HIGH** | 0 |
| **MEDIUM** | 0 *(F1 false positive — siehe §2.F1)* |
| **LOW** | 1 *(F2 fixed)* |
| **Informational / Defensive** | 3 |

**Login & Admin-Always-Access:** ✅ Unverändert sicher.
**Multi-Tenant-Isolation:** ✅ Keine RLS-Lücken; alle neuen RPCs org-scoped.
**Payment / Paywall:** ✅ Keine Änderungen am Paywall-Pfad in dieser Periode.
**GDPR / Dissolve:** ✅ Two-Stage-Dissolve solide; Hard-Purge admin-only mit 30-Tage-Window.
**Storage / Edge Function:** ✅ DB-derived Path-Allowlist; kein Service-Role-Leak.

Alle Findings unten werden in dieser Session gefixt.

**Final-Status (Session-Ende):**
- F1 → false positive (alle 13 Call-Sites korrekt, keine Code-Änderung nötig)
- F2 → SQL-Fix deployed via `20260419_generate_model_claim_token_drop_pgcrypto.sql` (Live-verified: `uses_pgcrypto: false`, `uses_sha256: true`)
- `npm run typecheck` → **0 Fehler**
- `npm run lint` → **0 Fehler** (1 pre-existing warning in `ClientWebApp.tsx`, nicht audit-relevant)
- `npm test --ci` → **1641/1641 passed** (143 Suites)

---

## 1. Live-DB §2b Verifikation (alle PASS)

### 1.1 RLS Watchlist

```sql
-- FOR ALL Policies auf Risiko-Tabellen (Erwartung: 0)
SELECT tablename, policyname FROM pg_policies
WHERE schemaname='public' AND cmd='ALL'
  AND tablename IN ('model_embeddings','model_locations',
                    'model_agency_territories','calendar_entries','model_minor_consent');
```
→ **0 rows** ✅ (kein Rekursionsrisiko durch FOR ALL auf profiles/models-Pfad)

### 1.2 `profiles.is_admin` in Policy-qual

```sql
SELECT count(*) FROM pg_policies
WHERE schemaname='public' AND (qual ILIKE '%is_admin = true%' OR qual ILIKE '%is_admin=true%');
```
→ **0 rows** ✅ (Risiko 1 weiter geschlossen — alle Admin-Checks via `is_current_user_admin()`)

### 1.3 MAT Self-Reference (Risiko 11)

```sql
SELECT count(*) FROM pg_policies WHERE tablename='model_agency_territories'
  AND (qual ILIKE '%self_mat%' OR qual ILIKE '%from public.model_agency_territories %');
```
→ **0 rows** ✅

### 1.4 SECURITY DEFINER + `row_security TO off` (Risiko 4)

Stichprobe der kanonischen Helper:
- `is_org_member` ✅
- `caller_is_client_org_member` ✅
- `caller_is_linked_model` ✅
- `is_current_user_admin` ✅
- `can_view_model_photo_storage` ✅
- `can_agency_manage_model_photo` ✅
- Alle neuen Agency-Share / Dissolve / Guest-Link RPCs: ✅ `SET row_security TO off` mit internen 3-Layer-Guards (auth + membership + ownership).

### 1.5 Trigger-Reihenfolge auf `option_requests` (Risiko 49)

```
tr_reset_final_status_on_rejection           BEFORE UPDATE OF status
trg_validate_option_status                   BEFORE UPDATE OF status, final_status, model_approval
```
→ alphabetisch: `tr_reset_…` **vor** `trg_validate_…` ✅ (Reset läuft zuerst, Validate-Trigger sieht den modifizierten NEW-Record und kennt die `option_confirmed → option_pending`-Ausnahme bei `status → rejected`).

### 1.6 pgcrypto-Verfügbarkeit

```sql
SELECT extname, extversion FROM pg_extension WHERE extname='pgcrypto';
```
→ `pgcrypto 1.3` installiert ✅ (functional safe für `gen_random_bytes`, **aber** Drift-Risiko — siehe Finding F2).

---

## 2. Findings

### F1 — RESOLVED (False Positive) — `attentionSignalsFromOptionRequestLike` mit `isAgencyOnly`

**Status (2026-04-19, Re-Verifikation):** Bei der detaillierten Verifikation aller 13 produktiven Call-Sites von `attentionSignalsFromOptionRequestLike` wurde festgestellt, dass **alle** bereits korrekt `isAgencyOnly: ... ?? false` mitsenden. Die ursprünglich im Sweep gemeldeten 5 Stellen waren basierend auf veralteter Pfad-/Zeilen-Information (z. B. `src/components/UnifiedCalendarAgenda.tsx` existiert nicht; an den realen Zeilen in `agencyCalendarUnified.ts:128`, `calendarDetailNextStep.ts:98+119`, `attentionParity.test.ts:90` ist `isAgencyOnly` korrekt gesetzt).

**Verifizierte Call-Sites (alle ✅):**

| Datei | Zeilen | Status |
|---|---|---|
| `src/utils/agencyCalendarUnified.ts` | 119 → 128 | ✅ `isAgencyOnly: opt.is_agency_only ?? false` |
| `src/utils/calendarDetailNextStep.ts` | 89 → 98 | ✅ `isAgencyOnly: option.is_agency_only ?? false` |
| `src/utils/calendarDetailNextStep.ts` | 110 → 119 | ✅ `isAgencyOnly: opt.isAgencyOnly ?? false` |
| `src/utils/__tests__/agencyCalendarUnified.attentionParity.test.ts` | 81 → 90 | ✅ |
| `src/utils/calendarProjectionLabel.ts` | 101, 211 | ✅ (2 Sites) |
| `src/components/optionNegotiation/NegotiationThreadFooter.tsx` | 116 → 124 | ✅ |
| `src/views/AgencyControllerView.tsx` | 6633, 6655, 7936 | ✅ (3 Sites) |
| `src/web/ClientWebApp.tsx` | 5883, 5915, 6458 | ✅ (3 Sites) |
| `src/utils/optionRequestAttention.ts` (`optionRequestNeedsMessagesTabAttention`) | 231 → 250 | ✅ Akzeptiert + propagiert `isAgencyOnly` |

**Konsumenten:** `OptionRequest`-Cache-Type (`src/store/optionRequests.ts:135`) führt `isAgencyOnly?: boolean` und `toLocalRequest` mappt `r.is_agency_only ?? false` (Zeile 179) — `optionRequestNeedsMessagesTabAttention(req)` erhält damit immer den korrekten Wert.

**Schlussfolgerung:** Risiko 34 / Invariante ### T sind in der aktuellen Codebasis vollständig erfüllt. Keine Code-Änderungen erforderlich.

---

### F2 — LOW — `gen_random_bytes` (pgcrypto) in `generate_model_claim_token`

**Datei:** [`supabase/migrations/20261023_generate_model_claim_token_co_agency_branch.sql`](../supabase/migrations/20261023_generate_model_claim_token_co_agency_branch.sql) Zeile 178.

**Code:**
```sql
v_token := encode(gen_random_bytes(32), 'hex');
```

**Verstoß:** `system-invariants.mdc` **KEIN pgcrypto / digest() — PFLICHT** verbietet pgcrypto-Reliance in SECURITY DEFINER Funktionen, weil `pgcrypto` auf Supabase-Projekten **nicht universell garantiert** ist → bei Drift / Restore in einem anderen Projekt **42883 → PostgREST 404** → **Co-Agency-Token-Generierung bricht**.

**Mildernd:** `pgcrypto 1.3` ist auf der **aktuellen** Live-DB (`ispkfdqzjrfrilosoklu`) installiert → die existierende Funktion läuft korrekt.

**Severity:** LOW — kein aktueller Failure, aber latentes Drift-Risiko + Verstoß gegen explizite System-Invariante. Prio: in dieser Session fixen, da der Pattern explizit verboten ist.

**Fix:** Token via `encode(sha256((gen_random_uuid()::text || gen_random_uuid()::text)::bytea), 'hex')` — 64-Zeichen Hex, 256 Bit Entropie, **ohne** pgcrypto-Reliance. PostgreSQL 13+ built-in `sha256()` und `gen_random_uuid()` (pgcrypto-freie UUID-v4 seit PG13).

---

## 3. Reviews — Neue Migrations & Features (alle PASS)

### 3.1 Agency-to-Agency Roster Share (`20261024–20261026`)

| RPC | Guards | Verdict |
|---|---|---|
| `create_agency_share_package` | auth.uid() + Sender-Org-Membership + Models gehören Sender-Agentur | ✅ |
| `import_models_from_agency_share` | auth.uid() + Recipient-Org-Membership + Link-Validität (purpose='agency_share', active, not expired) + Model im Share | ✅ |
| `get_agency_share_inbox` | auth.uid() + Recipient-Membership + Link-Validität | ✅ |
| `get_agency_share_models` | wie inbox + Model-Whitelist aus `guest_links.model_ids` | ✅ |

- `model_agency_territories` Insert via `ON CONFLICT (model_id, country_code) DO NOTHING` ✅ (Konflikt-Target korrekt, Risiko 15 vermieden)
- `models.agency_id` (Heimat-Agentur) bleibt unverändert ✅ (Co-Agency-Modell)
- RLS auf `guest_links`: neue Policy `guest_links_select_target_agency` (`20261022`) — Agentur sieht eigene eingehende Shares ✅

### 3.2 Two-Stage Organization Dissolution (`20260418_*`)

- `dissolve_organization` (SECURITY DEFINER, owner-only): Soft-Delete via `dissolved_at`, `dissolved_by`, `scheduled_purge_at = now() + 30 days`. Mitgliedschaften werden entfernt. ✅
- `purge_dissolved_organization_data` + `run_scheduled_purge_dissolved_organizations`: **admin-only** via `assert_is_admin()` ✅. Hard-Purge greift erst **nach** `scheduled_purge_at` ≤ `now()`.
- RLS: neue **RESTRICTIVE** Policy `organizations_select_hide_dissolved_restrictive` blendet dissolved Orgs für Nicht-Admin aus ✅
- `request_account_deletion` aktualisiert (`20260418`): Owner-Pfad wird **nicht** mehr blockiert wenn die Org bereits dissolved ist + Membership entfernt ist — kanonisch und konsistent mit Two-Stage-Modell ✅

### 3.3 Guest Links — Mixed Type & Agency-Share-Purpose (`20261019–20261022`)

- `'mixed'` Package-Type: `get_guest_link_models` liefert sowohl `portfolio_images` als auch `polaroids` — Daten-Contract sauber ✅
- `revoke_guest_access` (`20261019`): Auth-Gate jetzt mit Owner-OR-Booker-Branch + Admin-Bypass — konsistent mit RLS auf `guest_links` ✅
- `get_guest_link_info` (`20261021`): exposiert `agency_id` zusätzlich zu `agency_name` → ermöglicht „Chat with agency" CTA in Galerien. **Kein PII-Leak** (Agency-IDs sind ohnehin via Discovery sichtbar) ✅

### 3.4 Edge Function `sign-guest-storage-asset`

- Verwendet `SUPABASE_SERVICE_ROLE_KEY` **nur server-side** in der Edge Function, **niemals** an den Client geleakt ✅
- **Path-Allowlist:** Aufgelöst aus DB (`models.cover_image_url`, `portfolio_images`, `polaroids`, **`model_photos.url`**) für Modelle der Guest-Link-Whitelist (`guest_links.model_ids`) **oder** für Modelle aus einer signed `shared_selection` (HMAC-Validierung). ✅
- Strikte Pfad-Shape mit DB-Validierung — keine Path-Traversal-Vektoren möglich (kein `../` und kein freier Pfad ohne DB-Anker) ✅
- Signed URL TTL = 1 h ✅
- CORS: Allowlist + Pattern (Vercel-Previews + localhost), `Max-Age: 86400` — funktional korrekt ✅

### 3.5 Co-Agency Model Claim Token (`20261023`)

- Auth-Branches: (1) Heimat-Agentur (`models.agency_id = caller_agency`), (2) **NEU**: Co-Agency mit aktiver MAT-Zeile (`model_agency_territories.agency_id = caller_agency`) ✅
- `REVOKE ALL FROM PUBLIC, anon` + `GRANT EXECUTE TO authenticated` ✅
- Token-Cleanup vor Insert (alte unbenutzte Tokens) ✅
- **Drift-Risiko:** siehe Finding F2.

### 3.6 Calendar / Org-Names / Application Mirror (`20260920–20261018`)

- `calendar_entries.updated_at`-Spalte + Trigger zur Optimistic-Lock-Wiederherstellung ✅
- `option_requests` Org-Name-Mirror-Trigger: schreibt `client_organization_name` / `agency_organization_name` automatisch — vermeidet leere Strings / „Client" / „Agency" Placeholder ✅
- `agency_remove_model_*` (`20260831, 20260902, 20260903, 20260916`): idempotent, MAT/Application-Sync, Status-Übergang `representation_ended` ✅
- `create_model_from_accepted_application` Mirror Portfolio Photos (`20261018`): füllt `models.portfolio_images` + `model_photos` aus `model_applications.photos` wenn leer ✅

---

## 4. Anti-Pattern Sweeps (`src/`) — alle CLEAN

| Pattern | Risiko | Befund |
|---|---|---|
| `model_account_linked ?? true` | Risiko 20 | **0 matches** ✅ |
| Snapshot-basierter Rollback (`const snapshot = state`, `.slice()`) | Risiko 12 | **0 matches** in Mutations-Handlern ✅ |
| `.eq('email', ...)` für Auth/Lookup | Gefahr 2 | **0 matches** ✅ |
| `link_model_by_email()` für neue Flows | Risiko 9 | Nur Legacy-Wrapper in `modelsSupabase.ts:702` (deprecated, Auth-Bootstrap-Fallback erlaubt) ✅ |
| `supabase.rpc('admin_*', ...)` außerhalb `adminSupabase.ts` | Risiko 18 | Nur in `adminSupabase.ts` + `AdminDashboard.tsx` ✅ |
| `OPTION_REQUEST_SELECT` für Model-Reads | Risiko 21 | Model-facing Reads nutzen `OPTION_REQUEST_SELECT_MODEL_SAFE` ✅ |
| `JSON.stringify(array)` vor Supabase JSONB-Insert | Risiko-Listenpunkt | Nur in `mediaslideConnector.js`/`netwalkConnector.js` für externe REST-Header — **kein** Supabase-JSONB-Misuse ✅ |
| `ON CONFLICT (model_id)` ohne `, source` / `, country_code` | Risiko 15/16 | Alle aktuellen Conflicts korrekt: MAT `(model_id, country_code)`, Locations `(model_id, source)` ✅ |
| `subscribeToConversation` ohne UPDATE-Event | Risiko 51 | `messengerSupabase.ts:653,663` abonniert **INSERT** und **UPDATE** ✅ |
| Phantom-Spalten (`models.first_name`, `last_name`) | Risiko 43 | **0 matches** ✅ |
| `digest('sha256')` / pgcrypto in SECDEF | System-Invariant | **1 match** in `20261023` → siehe F2 |
| `attentionSignalsFromOptionRequestLike` ohne `isAgencyOnly` | Risiko 34/39 | **0 matches** nach Re-Verifikation (ursprünglich 5 false positives — siehe F1) ✅ |
| `final_status: 'option_pending'` in client-side Update | Risiko 49 | **0 matches** in Service-Layer ✅ |

---

## 5. 33 Pflicht-Fragen — Q1–Q33

| | Antwort |
|---|---|
| Q1: Bricht Login? | **Nein.** AuthContext / `bootstrapThenLoadProfile` unverändert. |
| Q2: Bricht Org-Zuweisung? | **Nein.** Kein `LIMIT 1` in Org-Kontext-Resolution; neue RPCs nehmen `p_organization_id`/`p_agency_id` explizit entgegen. |
| Q3: Bricht Admin-Sichtbarkeit? | **Nein.** Admin-Pfade unverändert; `is_current_user_admin()` bleibt UUID+Email-pinned. |
| Q4: Führt RLS-Rekursion ein? | **Nein.** Live-Watchlist 0 Zeilen (§1.1–1.3). Neue Agency-Share-Policies nutzen direkte Column-Refs ohne profiles/models-Self-Joins. |
| Q5: Verletzt Territory-Constraint `UNIQUE(model_id, country_code)`? | **Nein.** `import_models_from_agency_share` nutzt `ON CONFLICT (model_id, country_code) DO NOTHING`. |
| Q6: Fügt Model zu `organization_members`? | **Nein.** Models bleiben in `models`/`model_agency_territories`. |
| Q7: `LIMIT 1` zur Caller-Identifikation? | **Nein** (außer dokumentierten Sub-Resource-Lookups nach verifiziertem Guard). |
| Q8: Snapshot-basierter Rollback? | **Nein.** §4 Sweep clean. |
| Q9: Verstecktes „Connect first" für Erstkontakt? | **Nein.** Kein Connection-Gate in den neuen RPCs. |
| Q10: Leakt Verhandlungsfelder an Model-Queries? | **Nein.** Model-Pfade nutzen `OPTION_REQUEST_SELECT_MODEL_SAFE`. |
| Q11: Koppelt Preis (Axis 1) und Availability (Axis 2)? | **Nein.** Keine neuen Negotiation-RPCs in dieser Periode. |
| Q12: Erlaubt Model-Bestätigung vor Agency? | **Nein.** Dreischichtiges Enforcement unverändert. |
| Q13: Axis-1 Aktion verändert Axis-2 Felder? | **Nein.** |
| Q14: Eigene Attention-Heuristik? | **Nein** (alle prüfen via `attentionSignalsFromOptionRequestLike`). |
| Q15: Inflight-Guard fehlt? | **Nein** für neue Mutations. |
| Q16: Fehlt `isAgencyOnly` in attention-Aufrufen? | **Nein.** Alle 13 produktiven Call-Sites verifiziert (siehe F1 Re-Verifikation). |
| Q17: `updateBookingDetails` schreibt cancelled Rows? | **Nein.** Keine Änderung in dieser Periode. |
| Q18: Store-Funktion ohne DB-Refresh? | **Nein** für neue Stores. |
| Q19: Preis-UI bei `isAgencyOnly`? | **Nein.** |
| Q20: Store-Funktion ohne DB-Refresh? | **Nein.** |
| Q21: Discovery/Near-Me ohne MAT-Dedupe? | **Nein.** Keine neuen Discovery-RPCs. |
| Q22: `filters.city` als clientCity statt p_city? | **Nein.** Keine Änderung. |
| Q23: Phantom-Spalten in RPC? | **Nein.** §4 Sweep. |
| Q24: Agency-only RPC mit `option_pending`? | **Nein.** Keine neue agency-only RPC in dieser Periode. |
| Q25: `model_approval='pending'` bei No-Account? | **Nein.** |
| Q26: Direkter INSERT mit `option_confirmed` ohne UPDATE? | **Nein.** |
| Q27: `bootstrapThenLoadProfile` Reihenfolge umgestellt? | **Nein.** Invite-vor-Bootstrap-Invariante intakt. |
| Q28: Pending-invite-Check entfernt? | **Nein.** |
| Q29: Neuer BEFORE UPDATE Validate-Trigger ohne Reset-Berücksichtigung? | **Nein.** Keine neuen Validate-Trigger auf `option_requests`. |
| Q30: Trigger-Namen umbenannt (alphabet. Reihenfolge)? | **Nein.** |
| Q31: `booking_events`-Fetch ohne `cancelled`-Filter? | **Nein.** |
| Q32: `subscribeToConversation` nur INSERT ohne UPDATE? | **Nein.** §4 Sweep. |
| Q33: B2B-Booking-Karte mit fixem „Booking"-Label? | **Nein.** |

---

## 6. Fixes (in dieser Session)

| Finding | Datei | Typ | Status |
|---|---|---|---|
| F1 | — (false positive) | Re-Verifikation | ✅ keine Änderung nötig |
| F2 | `supabase/migrations/20260419_generate_model_claim_token_drop_pgcrypto.sql` (NEU) | Migration | ✅ Deployed + Live-verified (`uses_pgcrypto: false`, `uses_sha256: true`) |

---

## 7. Residual Risks / Recommendations

1. **Multi-Org-UI:** Frontend wählt weiterhin „älteste Membership", warnt aber. Entwicklung eines echten Multi-Org-Switchers bleibt offen (nicht in dieser Audit-Periode).
2. **Stripe-Live-Verify-Matrix:** Letzte dokumentierte Stripe-Verify war im April. Vor jeder neuen Billing-Änderung (auch reine Konfig-Diffs) muss die Verify-Matrix erneut laufen — siehe `auto-review.mdc` §2c „STRIPE GO-LIVE REQUIREMENT".
3. **Edge-Function pgcrypto:** Für die Edge Function `sign-guest-storage-asset` wird HMAC selbst gerechnet — kein pgcrypto-Reliance dort.
4. **Agency-Share Purpose Validation:** `import_models_from_agency_share` erlaubt nur `purpose='agency_share'` — wenn künftig weitere Purposes hinzukommen, sollte ein zentraler Allowlist-Helper genutzt werden statt String-Vergleich.
5. **Watchlist bei Hinzufügen einer 4. Location-Source:** Sollte irgendeine Migration eine zusätzliche `model_locations.source` einführen (`'imported'`, etc.), sind alle 6 Punkte aus Risiko 17 (CHECK + RPC Auth-Split + delete RPC + TS Union + DISTINCT-ON + Tests) gleichzeitig zu liefern.

---

## 8. Verify-Queries (zum erneuten Live-Run)

```sql
-- 1. Watchlist
SELECT count(*) FROM pg_policies WHERE schemaname='public' AND cmd='ALL'
  AND tablename IN ('model_embeddings','model_locations','model_agency_territories',
                    'calendar_entries','model_minor_consent');
-- Erwartet: 0

-- 2. is_admin in qual
SELECT count(*) FROM pg_policies WHERE schemaname='public'
  AND (qual ILIKE '%is_admin = true%' OR qual ILIKE '%is_admin=true%');
-- Erwartet: 0

-- 3. MAT self-ref
SELECT count(*) FROM pg_policies WHERE tablename='model_agency_territories'
  AND (qual ILIKE '%self_mat%' OR qual ILIKE '%from public.model_agency_territories %');
-- Erwartet: 0

-- 4. Trigger order
SELECT tgname, tgtype FROM pg_trigger
WHERE tgrelid = 'public.option_requests'::regclass
  AND tgname IN ('tr_reset_final_status_on_rejection','trg_validate_option_status')
ORDER BY tgname;
-- Erwartet: tr_reset_… vor trg_validate_… (alphabetisch)

-- 5. Drop pgcrypto reliance verified
SELECT pg_get_functiondef(oid) ILIKE '%gen_random_bytes%' AS uses_pgcrypto
FROM pg_proc WHERE proname='generate_model_claim_token' AND prokind='f';
-- Erwartet (nach Fix): false
```

---

**Auditor:** AI Lead Product Engineer (Cursor agent, Opus 4.7)
**Date:** 2026-04-19
**Branch:** `main`

# Security & Data Integrity Audit A (Reset) — Report

> **Update (Fix Sprint):** H1 und H2 sind mit Migration `20260502_calendar_entries_rls_canonical_client_update.sql` behoben — siehe [`CURSOR_SECURITY_AUDIT_A_FIX_REPORT.md`](CURSOR_SECURITY_AUDIT_A_FIX_REPORT.md).

## Executive Summary

Dieser Audit prüft logische Konsistenz, Sicherheit und Einhaltung der genannten System-Invarianten (P1–P8) auf Basis von **Repo-Code**, **Supabase-Migrationen** und **Live-DB-Abfragen** (Projekt `ispkfdqzjrfrilosoklu`, Stand Ausführung des Audits).

**Ergebnis:** Keine **CRITICAL**-Befunde (kein nachgewiesener massenhafter Datenleck-Pfad wie `calendar_entries` SELECT `USING (true)` auf Live). Es bestehen **HIGH**-Punkte zu **RLS/App-Parität** (Client-Updates auf `calendar_entries`) und **Governance/Drift** (Kalender-Policies nicht vollständig in `supabase/migrations/` abgebildet). **MEDIUM/LOW** betreffen dokumentierte Produktgrenzen (Booking Brief UI-only) und bekannte Edge Cases (Invite vor Claim).

**Abschlusszeile:** `SECURITY AUDIT A COMPLETE — ISSUES FOUND` (keine **CRITICAL**-Befunde; **HIGH** siehe unten)

---

## P1 — Auth / Session / Invite / Claim

| IST | Risiko | Klasse |
|-----|--------|--------|
| [`src/services/finalizePendingInviteOrClaim.ts`](src/services/finalizePendingInviteOrClaim.ts): globale Kette (`finalizeChain`), Invite-Token hat Vorrang; bei Invite wird kein Claim-Token eingelesen; nach Invite-Zweig `return`. | Gleichzeitig Invite + Claim: Claim verzögert bis Invite abgearbeitet/gelöscht. | **MEDIUM** |
| Fatal errors clearen Token (`isFatalInviteError` / `isFatalClaimError`); non-fatal behalten Token. | Multi-Tab serialisiert — erwartetes Verhalten. | **LOW** |
| Tests in [`src/services/__tests__/finalizePendingInviteOrClaim.test.ts`](src/services/__tests__/finalizePendingInviteOrClaim.test.ts). | — | **SAFE** |
| [`src/utils/inviteClaimRouting.ts`](src/utils/inviteClaimRouting.ts) spiegelt Invite-first. | — | **SAFE** |
| [`src/context/AuthContext.tsx`](src/context/AuthContext.tsx): `linkModelByEmail()` weiterhin isoliert nach Bootstrap (Step 2). | Deprecated Pfad; kein Ersatz für Token-Claim bei neuen Flows. | **LOW** |

**Invariante 3 (Session + Token, idempotent):** Eingehalten im zentralen Finalize-Modul.

---

## P2 — Org / Membership / Roles

| IST | Risiko | Klasse |
|-----|--------|--------|
| [`src/services/b2bOrgChatSupabase.ts`](src/services/b2bOrgChatSupabase.ts): `ensureClientAgencyChat` verlangt `actingUserId === auth.uid()`, Org-Paar über Resolve-RPCs/Membership. | Kein offensichtlicher Cross-Org-Bypass in gelesenem Pfad. | **SAFE** |
| Agency-Dashboard: Kommentare zu `profile.agency_id` ohne `agencies[0]` / Email-Match. | Neue Dateien weiterhin gegen Email-Fallback prüfen. | **LOW** |

**Invariante 4 (Org-Mitgliedschaft, nicht Chat/Assignment):** In Stichprobe konsistent.

---

## P3 — Model System

| IST | Risiko | Klasse |
|-----|--------|--------|
| `agency_update_model_full` mehrfach in `supabase/migrations/` (u. a. `20260430_agency_update_model_full_remove_models_phone.sql`, `20260412_agency_rpcs_definitive.sql`). | Bei Schema-Änderungen an `models` weiterhin Live-`pg_get_functiondef` + Spaltenkatalog. | **VERIFY** (laufend) |

**Invariante 9 (RPC nur existierende Spalten):** Repo zeigt aktive Migrations-Härtung; Live-Drift separat verifizieren.

---

## P4 — Location

| IST | Risiko | Klasse |
|-----|--------|--------|
| `models.current_location` weiter in UI/Services ([`ModelEditDetailsPanel.tsx`](src/components/ModelEditDetailsPanel.tsx), [`modelsSupabase.ts`](src/services/modelsSupabase.ts)); kanonisch Near-Me über `model_locations` / RPC (Invarianten-Doku). | Zwei Darstellungsquellen — solange Discovery/RPC Priorität `live → current → agency` einhält, akzeptabel. | **MEDIUM** (Konsistenz, kein Security-Exploit) |

---

## P5 — Storage / Photos

| IST | Risiko | Klasse |
|-----|--------|--------|
| [`supabase/migrations/20260501_can_view_model_photo_storage_client_row_alignment.sql`](supabase/migrations/20260501_can_view_model_photo_storage_client_row_alignment.sql): `can_view_model_photo_storage(p_object_name)` mit `row_security off`, Client-Pfad an `model_photos` + `has_platform_access`. | Nach Deploy Live-Abgleich wie in Projektregeln. | **SAFE** (Repo) |

**Invariante 6:** Architektur im Repo nachvollziehbar; operative Verifikation über Signed URLs.

---

## P6 — Booking / Calendar / Brief

| IST | Risiko | Klasse |
|-----|--------|--------|
| **Live-DB** (`pg_policies`): `calendar_entries_select_scoped` aktiv — **kein** `USING (true)` auf SELECT; Policies für Agency INSERT/UPDATE/DELETE + `calendar_entries_model_self_*`. | Kein Competitor-wide Calendar Read auf Live. | **SAFE** |
| **Live-DB:** UPDATE auf `calendar_entries` nur **Agency**-Pfad und **Model-Self** — **keine** Policy für **Client-Org-Mitglied** mit gültiger Option. | [`src/services/calendarSupabase.ts`](src/services/calendarSupabase.ts) `updateBookingDetails` merged `booking_details` für alle Rollen; Client-Speichern kann **RLS blockieren** (Inkonsistenz App vs DB). | **HIGH** |
| [`src/utils/bookingBrief.ts`](src/utils/bookingBrief.ts): Sichtbarkeit UI-gefiltert (`filterBriefForRole`); volles JSON in Row wenn SELECT erlaubt. | API-Client mit Zugriff sieht ggf. alle Felder im JSON — dokumentierte Grenze (Invariant 7). | **MEDIUM** |
| Repo: `supabase/migrations/20260406_fix_for_all_calendar_mmc.sql` legt nur `model_self_*` an; verweist im Kommentar auf Policies, die **nicht** in derselben Migrations-Baum-Datei erstellt werden. | Neuaufsetzung/Review ohne Root-SQL fehleranfällig; Live kann von „Migrations-only“-Erwartung abweichen. | **HIGH** (Governance) |

**Invariante 7:** Bewusst UI-gefiltert; kein RLS-Feld-Split — wie spezifiziert, mit Vertraulichkeits-Restrisiko innerhalb derer, die die Zeile lesen dürfen.

---

## P7 — Chat / Context Layers

| IST | Risiko | Klasse |
|-----|--------|--------|
| `ensureClientAgencyChat`, `messengerSupabase` mit `conversation_id`. | Metadata-/Navigationsrisiken: punktuelle Code-Reviews bei neuen Features. | **LOW** |

---

## P8 — Assignment + Smart Attention

| IST | Risiko | Klasse |
|-----|--------|--------|
| `option_requests` auf Live: `option_request_visible_to_me(id)` für SELECT/UPDATE (Stichprobe); Definition in Root-SQL ohne `client_assignment_flags` als Gate. | Assignment nicht als Security-Layer genutzt. | **SAFE** |
| Smart Attention: [`src/utils/optionRequestAttention.ts`](src/utils/optionRequestAttention.ts) + Filter in [`ClientWebApp.tsx`](src/web/ClientWebApp.tsx) / [`AgencyControllerView.tsx`](src/views/AgencyControllerView.tsx). | Nur Priorisierung/UI. | **SAFE** |

**Invarianten 1–2:** In Stichprobe eingehalten.

---

## Zusammenfassung der wichtigsten Risiken

1. **HIGH:** Client-seitiges Schreiben von `calendar_entries.booking_details` (z. B. Booking Brief) kann auf **Live** an RLS scheitern — Policy-Lücke vs. App-Code.
2. **HIGH:** **Governance:** Vollständige `calendar_entries`-RLS-Definitionen fehlen als kanonische, datierte Migration unter `supabase/migrations/` (trotz korrektem Live-Stand).
3. **MEDIUM:** Booking-Brief / `booking_details`: volles JSON für jeden mit SELECT-Recht; UI filtert nur.
4. **MEDIUM:** Invite blockiert Claim im selben Finalize-Lauf (UX/Edge Case).

**Empfehlung:** HIGH-H1 zuerst beheben (Client-UPDATE-Policy oder SECDEF-Patch-RPC nach Security-Review), danach H2 (kanonische Migration). Audit B sinnvoll nach Fix und erneuter Live-Verifikation.

---

## Abschluss (Pflichtzeile)

**SECURITY AUDIT A COMPLETE — ISSUES FOUND**

---

## Referenzen

- [docs/LIVE_DB_DRIFT_GUARDRAIL.md](docs/LIVE_DB_DRIFT_GUARDRAIL.md)
- [supabase/migration_security_hardening_audit_fixes.sql](supabase/migration_security_hardening_audit_fixes.sql) (`calendar_entries_select_scoped`)
- [supabase/migration_request_workflow_hardening.sql](supabase/migration_request_workflow_hardening.sql) (historischer Kontext)

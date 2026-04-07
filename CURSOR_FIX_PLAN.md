# CURSOR_FIX_PLAN.md

**Erzeugt:** 2026-04-07  
**Basis:** [`CURSOR_AUTO_AUDIT_REPORT.md`](CURSOR_AUTO_AUDIT_REPORT.md), [`CURSOR_AUTO_AUDIT_LOGIN_SAFETY.md`](CURSOR_AUTO_AUDIT_LOGIN_SAFETY.md), [`CURSOR_AUTO_AUDIT_FINDINGS.json`](CURSOR_AUTO_AUDIT_FINDINGS.json), [`CURSOR_AUTO_AUDIT_SQL_CHECKS.sql`](CURSOR_AUTO_AUDIT_SQL_CHECKS.sql), [`CURSOR_AUTO_AUDIT_GREP_CHECKS.txt`](CURSOR_AUTO_AUDIT_GREP_CHECKS.txt)  
**Regel:** Bei Konflikt gewinnen **Login-Stabilität**, **Admin-Always-Access** und **konservative Einstufung** gegenüber theoretischer Härtung.

**Datei `CURSOR_FIX_PLAN.json`:** Liegt im Repo-Root (aus Anhang A extrahiert). Bei Abweichung ist **Anhang A** die Quelle der Wahrheit.

---

## 1. Executive Summary

- Das **statische Audit** sieht **login-stabil** aus: `signIn` trennt `bootstrapThenLoadProfile` (Step 1) von Nebeneffekten (Step 2); Admin-Routing in `App.tsx` steht **vor** `effectiveRole`; Admin-Erkennung in `loadProfile` ist **mehrstufig**.
- **Kein bestätigter Produktions-Blocker** im Repo-Audit; **Heuristiken** (16 SECDEF-Funktionen `risk_level: high`) und **Live-DB-Drift** sind die größten **Unbekannten**.
- **Sofort sinnvoll und risikoarm:** rein **lesende** Live-Verifikation (`CURSOR_AUTO_AUDIT_SQL_CHECKS.sql`, optional `fetch-live-db-state.mjs`) und **Dokumentation** der Ergebnisse — **ohne** Schemaänderung.
- **Nicht als Sofortmaßnahme:** Vereinheitlichung von `get_own_admin_flags` / `is_current_user_admin` / `assert_is_admin`, Entfernen von `link_model_by_email`, pauschales SECDEF-Hardening, Änderungen an Org-RPC-`LIMIT`-Semantik ohne Multi-Org-UI.

---

## 2. Klassen (verbindlich)

| Klasse | Bedeutung |
|--------|-----------|
| **1 — SAFE NOW** | Minimal-invasiv, kein Login-/Admin-/RLS-Hochrisiko (oft operational, lesend). |
| **2 — SAFE AFTER LIVE-DB CHECK** | Erst nach SQL-/Metadaten-Abgleich auf Ziel-DB. |
| **3 — SAFE ONLY WITH TARGETED TESTS** | Erst nach gezielten Tests auf betroffenen Flows. |
| **4 — ARCHITECTURALLY GOOD BUT RISKY NOW** | Richtige Richtung, derzeit zu heikel. |
| **5 — DO NOT TOUCH YET** | Risiko > Nutzen oder Beleg zu schwach. |

---

## 3. Was könnte (relativ) sofort sicher angegangen werden?

| ID | Maßnahme | Klasse | Warum Login sicher bleibt |
|----|-----------|--------|----------------------------|
| **M-017** | Audit-/Drift-Dokumentation nach erstem Live-Lauf aktualisieren | 1 | Kein Produktcode. |
| **M-001** | `CURSOR_AUTO_AUDIT_SQL_CHECKS.sql` **lesend** auf Staging/Replika | 2 | Keine DDL/DML; reine Diagnose. |
| **M-002** | `node scripts/fetch-live-db-state.mjs` (mit Token) | 2 | Überschreibt nur Export-Textdatei; keine App-DB-Logik-Änderung. |

Alles Weitere (SECDEF-Body-Änderungen, Policy-Fixes) ist **erst nach Beweis** aus M-001/M-002/M-005 sinnvoll.

---

## 4. Was erst nach Live-DB-Abgleich?

| ID | Thema | Klasse |
|----|--------|--------|
| **M-003** | 16 heuristisch „high“ SECDEF-Funktionen — **menschlicher** Final-Body-Check vs. Regel 21–23 | 2 |
| **M-004** | Mehrfach redefinierte RPCs (`bulk_*`, `has_platform_access`, …): **letzte Migration** vs. **Live** `pg_proc` | 2 |
| **M-005** | FOR ALL auf Watchlist-Tabellen, `profiles`-Spalten in Policies, MAT self-ref | 2 |
| **M-010** | `model_agency_territories` / Anti-`self_mat` | 2 |
| **M-011** | Storage-Policies vs. SECDEF-Helper-Pattern | 2 |
| **M-012** | Location-Constraints + `DISTINCT ON` / Near Me | 2 |

---

## 5. Was aktuell nicht angefasst werden sollte (ohne neuen Plan)

| ID | Thema | Klasse | Kurzgrund |
|----|--------|--------|-----------|
| **M-006** | Admin-Helper vereinheitlichen / Fallbacks reduzieren | 5 | Hohes Admin-Login-Risiko (LOGIN_SAFETY C5). |
| **M-009** | `get_my_org_context` / implizite Org-Auflösung ändern | 5 | Verbot LIMIT 1 in RPC; UI fehlt. |
| **M-016** | Struktur von `signIn` / `bootstrapThenLoadProfile` / `loadProfile` / `App.tsx` Admin-Branch | 5 | Kleinste Verschiebung = Admin oder Rollen-Regression. |

---

## 6. Reihenfolgeplan

### Phase 1 — Nur Nachweis, keine Produktänderung

1. **M-017** — Prozess/Doku  
2. **M-001** + **M-002** — Live-Metadaten + SQL_CHECKS  
3. **M-005**, **M-010**, **M-011**, **M-012** — kritische SQL-Checks (lesend)

### Phase 2 — Analyse nach Phase-1-Ergebnissen

4. **M-003** — SECDEF high-Liste: nur wo **Lücke belegt** ist, **einzelne** Migrations-Tasks planen (nicht pauschal)  
5. **M-004** — Drift-Liste RPC/Policy

### Phase 3 — Nur mit Tests und kleinem Scope

6. **M-007** — Optional: einzelne `admin_*` auf `assert_is_admin()` (eine Funktion pro Release)  
7. **M-008** — `link_model_by_email` nur nach Operations-Freigabe  
8. **M-013** / **M-014** — Frontend/Service-Contract punktuell  
9. **M-015** — GDPR-Regression bei jeder nahen SECDEF/RLS-Änderung

**Deferred (explizit nicht starten):** M-006, M-009, M-016

---

## 7. Maßnahmen im Detail (Pflichtfragen)

Die folgenden Maßnahmen entsprechen den Einträgen in [`CURSOR_FIX_PLAN.json`](CURSOR_FIX_PLAN.json) (bzw. Anhang A).

### M-001 — Live SQL_CHECKS (lesend)

1. **Problem:** Unbekannter Drift Live vs. Repo-Migrationsende.  
2. **Beleg:** Audit ohne Token — **potenziell**, nicht bestätigt.  
3. **Betroffen:** Datenbank-Metadaten nur.  
4. **Admin-Login?** Nein bei rein lesenden Queries.  
5. **Andere Rollen?** Nein.  
6. **RLS/Rekursion/Leak?** Nein (Lesen).  
7. **Live nötig?** Ja.  
8. **Tests:** SQL-Verification + manueller Smoke nach fremden DBA-Aktionen nicht nötig für reines SELECT auf Systemkatalogen.  
9. **Minimal:** Queries aus `CURSOR_AUTO_AUDIT_SQL_CHECKS.sql` ausführen, Ergebnisse archivieren.  
10. **Reihenfolge:** Phase 1 zuerst.

### M-002 — fetch-live-db-state

1. **Problem:** Kein maschineller Live-Snapshot im Repo.  
2. **Beleg:** `CHATGPT_LIVE_DB_STATE.txt` war Stub.  
3. **Betroffen:** Nur Export-Datei.  
4.–6. **Login/RLS:** Nein (API lesend).  
7. **Live:** Ja (Token).  
8. **Tests:** Optional Diff-Review.  
9. **Minimal:** Skript laufen lassen, nicht committen wenn Secrets enthalten.  
10. **Reihenfolge:** Parallel zu M-001.

### M-003 — 16 SECDEF „high“ (Heuristik)

1. **Problem:** Parser markierte `row_security=off` ohne erkannte Caller-Guards — **kann falsch positiv** sein.  
2. **Beleg:** **Heuristisch** (JSON).  
3. **Betroffen:** Siehe Liste unten + letzte definierende Migration.  
4. **Admin-Login?** Nur wenn jemand fälschlich `get_own_admin_flags`-Pfad ändert — **hier nicht empfohlen**.  
5. **Andere Rollen?** Ja, wenn Guards fehlen — **Org-Leak** möglich.  
6. **RLS/Rekursion?** Indirekt (falsche SECDEF).  
7. **Live:** Ja, `pg_get_functiondef` sinnvoll.  
8. **Tests:** Integration Chat/B2B/Roster + Org-Isolation.  
9. **Minimal:** Nur dokumentierte Lücken schließen, **eine Funktion pro Change**.  
10. **Reihenfolge:** Nach Phase 1.

**16 Namen (aus Audit-JSON):**  
`add_model_assignments`, `bulk_add_model_territories`, `bulk_save_model_territories`, `conversation_accessible_to_me`, `create_b2b_org_conversation`, `get_assignments_for_agency_roster`, `get_assignments_for_model`, `get_b2b_counterparty_org_name`, `get_model_claim_preview`, `get_my_organization_ids`, `has_platform_access`, `list_client_organizations_for_agency_directory`, `model_belongs_to_current_user`, `resolve_b2b_org_pair_for_chat`, `save_model_assignments`, `user_is_member_of_organization`

### M-004 — Redefinition-Drift

1. **Problem:** Mehrere `CREATE OR REPLACE` über April-Migrations — letzte Datei muss Live entsprechen.  
2. **Beleg:** **Repo-only** + Drift **potenziell**.  
3. **Betroffen:** `defined_in_files` im JSON pro Funktion.  
4.–5. **Login:** Nur wenn falsche Version live (selten).  
6. **Leak:** Möglich bei alter, unsicherer Version.  
7. **Live:** Ja.  
8. **Tests:** Paywall/Platform-Zugriff wo `has_platform_access` betroffen.  
9. **Minimal:** Vergleich Live vs. erwartete letzte Migration; **eine** Nachzieh-Migration wenn nötig.  
10. **Reihenfolge:** Phase 2.

### M-005 — RLS-Watchlist / Policy-Checks

1. **Problem:** FOR ALL, `profiles.is_admin` in Qual, MAT self-ref.  
2. **Beleg:** Regeln + Migrationen **bestätigen** gutes Zielbild; Live **unbekannt**.  
3. **Betroffen:** `pg_policies`.  
4. **Admin-Login?** **Ja** bei 42P17 auf profiles/models-Pfad.  
5. **Alle Rollen?** Ja.  
6. **Rekursion:** Ja, Kernrisiko.  
7. **Live:** Ja.  
8. **Tests:** Vollständige LOGIN-Matrix + profiles SELECT.  
9. **Minimal:** Erst lesend; Fix nur dedizierte Migration.  
10. **Reihenfolge:** Phase 1.

### M-006 — Admin-Helper nicht vereinheitlichen (jetzt)

1. **Problem:** Wahrgenommene Redundanz drei Admin-RPCs.  
2. **Beleg:** **Theoretischer** Nutzen; **hohes** Login-Risiko.  
3. **Betroffen:** DB + `AuthContext.loadProfile`.  
4. **Admin-Login?** **Hoch** bei Fehlern.  
5. **Andere:** Niedrig.  
6. **RLS:** Mittel.  
7. **Live:** Ja vor jeder Änderung.  
8. **Tests:** Admin E2E + RPC-Failure-Mocks.  
9. **Minimal:** **Keine** Sofortmaßnahme.  
10. **Klasse 5.**

### M-007 — `assert_is_admin()` statt Legacy-Guard in `admin_*`

1. **Problem:** Inkonsistente Guard-Styles.  
2. **Beleg:** **Heuristisch** (Audit).  
3. **Betroffen:** Einzelne `admin_*` Migrationen.  
4. **Admin-Login?** Mittel — falsch = Dashboard-RPC 400.  
5. **Andere:** Gering.  
6. **RLS:** Gering direkt.  
7. **Live:** Ja.  
8. **Tests:** Admin Dashboard + `admin_get_profiles`.  
9. **Minimal:** Eine RPC pro Release, erste Zeile `PERFORM assert_is_admin()`.  
10. **Phase 3.**

### M-008 — `link_model_by_email` entfernen

1. **Problem:** Gefahr 9 (Email-Matching).  
2. **Beleg:** **Confirmed** deprecated; noch in Step 2.  
3. **Betroffen:** `AuthContext`, `modelsSupabase`.  
4. **Admin-Login?** Nein wenn Step 1 unberührt.  
5. **Model/Legacy:** **Hoch** wenn zu früh.  
6. **Leak/Takeover:** Thematisch ja.  
7. **Live:** Operations-Entscheid.  
8. **Tests:** Claim + Model-Login + Legacy-Konten.  
9. **Minimal:** Nur nach Token-Coverage; **nie** Step 1.  
10. **Klasse 4.**

### M-009 — Org / LIMIT 1

1. **Problem:** Multi-Org-Produktlücke.  
2. **Beleg:** **Confirmed** Regel account-org-context-canonical.  
3. **Betroffen:** RPC + Frontend-Auswahl.  
4.–6. **Tenant-Leak** bei falscher „first row“.  
7. **Live:** Situativ.  
8. **Tests:** Multi-Membership-Konto.  
9. **Minimal:** Kein Rückschritt zu LIMIT 1 in Org-RPC.  
10. **Klasse 5.**

### M-010 — MAT Rekursion

1. **Problem:** Self-join Policies → 42P17.  
2. **Beleg:** **Confirmed** historischer Incident + Fix-Migrationen.  
3. **Betroffen:** `model_agency_territories` Policies.  
4. **Admin-Login?** **Ja** (Kette zu profiles/models).  
5. **Alle:** Ja.  
6. **Rekursion:** Ja.  
7. **Live:** Ja.  
8. **Tests:** LOGIN-ALL + SQL self_mat query.  
9. **Minimal:** Lesend prüfen; Fix nur 20260414-ähnliches Pattern.  
10. **Phase 1 Checks.**

### M-011 — Storage

1. **Problem:** Direkte Joins in `storage.objects` Policies.  
2. **Beleg:** Migrations zeigen Helper-Pattern; Live unbekannt.  
3. **Betroffen:** storage policies.  
4. **Login:** Nein direkt.  
5. **Upload/Chat:** Ja.  
6. **Koppelung models-RLS:** Ja.  
7. **Live:** Ja.  
8. **Tests:** Upload consent, chat file.  
9. **Minimal:** Lesend; Fix nur mit Helper-Funktionen.  
10. **Phase 1.**

### M-012 — Location / Near Me

1. **Problem:** Risk 16 (CONFLICT, DISTINCT ON).  
2. **Beleg:** Migrations vorhanden; Live unbekannt.  
3. **Betroffen:** `model_locations`, `get_models_near_location`.  
4. **Login:** Nein.  
5. **Feature:** Ja.  
6. **RLS:** Sekundär.  
7. **Live:** Ja.  
8. **Tests:** Near Me, Agency location save.  
9. **Minimal:** Constraint-Query + Funktionsdef vergleichen.  
10. **Phase 1.**

### M-013 / M-014 — Frontend Async / Service-Vertrag

1. **Problem:** `.catch` auf Option-A; gemischte Return-Typen über Dateien.  
2. **Beleg:** **Heuristisch** (GREP).  
3. **Betroffen:** Ausgewählte Components/Services.  
4. **Login:** Nein typischerweise.  
5. **UI-State:** Ja.  
6. **RLS:** Nein.  
7. **Live:** Nein.  
8. **Tests:** Unit + kritische E2E.  
9. **Minimal:** Ein Callsite pro PR.  
10. **Phase 3.**

### M-015 — GDPR nahe SECDEF

1. **Problem:** Regression bei Membership-Löschung.  
2. **Beleg:** Regeln + Migrationen.  
3. **Betroffen:** GDPR-RPCs.  
4. **Login:** Session/Profil nach Delete.  
5. **User:** Hoch.  
6. **Isolation:** Ja.  
7. **Live:** Staging.  
8. **Tests:** Export, deletion request, withdraw.  
9. **Minimal:** Keine bundled Releases mit großen RLS-Refactors.  
10. **Phase 3 guardrail.**

### M-016 — Auth-Pfade tabu

1. **Problem:** Refactor-Verlockung.  
2. **Beleg:** **Confirmed** kritisch.  
3. **Betroffen:** `AuthContext`, `App.tsx`, `roles.ts`.  
4. **Admin:** **Kritisch**.  
5. **Alle Rollen:** Ja.  
6. **RLS:** Indirekt.  
7. **Live:** n/a.  
8. **Tests:** Volle Matrix bei jeder Änderung.  
9. **Minimal:** **Nicht anfassen** ohne Security-Review.  
10. **Klasse 5.**

### M-017 — Doku

1. **Problem:** Wissenslücke nach Live-Lauf.  
2. **Beleg:** Prozess.  
3. **Betroffen:** Nur Docs/Artefakte.  
4.–6. **Nein.**  
7. **Live:** Ergebnis abhängig.  
8. **Tests:** Review.  
9. **Minimal:** Appendix aktualisieren.  
10. **Klasse 1.**

---

## 8. Schlussurteil

- **Repo wirkt statisch login-stabil** (Bootstrap, Admin-Routing, Claim/Invite-Isolation).  
- **Weitere Härtung nur schrittweise:** zuerst **lesende** Live-Verifikation, dann **punktuelle** SECDEF/RLS-Fixes mit **vollständiger** Testmatrix — **keine** pauschale Härtung und **keine** Admin-Helper-Vereinheitlichung als Sofortmaßnahme.

---

## Anhang A — Vollständiger Inhalt für `CURSOR_FIX_PLAN.json`

Speichern als Datei `CURSOR_FIX_PLAN.json` im Projektroot (reiner JSON, ohne Kommentare):

```json
{
  "version": 1,
  "generated": "2026-04-07",
  "based_on_artifacts": [
    "CURSOR_AUTO_AUDIT_REPORT.md",
    "CURSOR_AUTO_AUDIT_LOGIN_SAFETY.md",
    "CURSOR_AUTO_AUDIT_FINDINGS.json",
    "CURSOR_AUTO_AUDIT_SQL_CHECKS.sql",
    "CURSOR_AUTO_AUDIT_GREP_CHECKS.txt"
  ],
  "context_rules": [
    ".cursor/rules/admin-security.mdc",
    ".cursor/rules/account-org-context-canonical.mdc",
    ".cursor/rules/auto-review.mdc",
    ".cursor/rules/rls-security-patterns.mdc",
    ".cursor/rules/system-invariants.mdc"
  ],
  "decision_rule": "Bei Konflikt gewinnen Login-Stabilität, Admin-Always-Access und konservative Einstufung über theoretische Härtung.",
  "classification_legend": {
    "1": "SAFE_NOW",
    "2": "SAFE_AFTER_LIVE_DB_CHECK",
    "3": "SAFE_ONLY_WITH_TARGETED_TESTS",
    "4": "ARCHITECTURALLY_GOOD_BUT_RISKY_NOW",
    "5": "DO_NOT_TOUCH_YET"
  },
  "measures": [
    {"id": "M-001", "title": "Live-DB: CURSOR_AUTO_AUDIT_SQL_CHECKS.sql lesend ausführen", "class": 2, "severity": "low", "evidence_type": "needs_live_db", "affects_login": false, "affects_admin": false, "affects_rls": false, "affects_org_isolation": false, "requires_live_db": true, "recommended_now": false, "minimal_safe_action": "Nur SELECT auf Kataloge; Ergebnisse dokumentieren.", "required_tests": ["T-SQL-001", "T-MANUAL-001"], "rationale": "Drift-Nachweis ohne Codeänderung."},
    {"id": "M-002", "title": "fetch-live-db-state.mjs mit Token", "class": 2, "severity": "low", "evidence_type": "needs_live_db", "affects_login": false, "affects_admin": false, "affects_rls": false, "affects_org_isolation": false, "requires_live_db": true, "recommended_now": false, "minimal_safe_action": "Skriptlauf; CHATGPT_LIVE_DB_STATE aktualisieren.", "required_tests": ["T-STATIC-001"], "rationale": "Metadaten-Export für Drift-Vergleich."},
    {"id": "M-003", "title": "16 SECDEF high (Heuristik) Final-Body-Review", "class": 2, "severity": "high", "evidence_type": "heuristic", "affects_login": false, "affects_admin": false, "affects_rls": true, "affects_org_isolation": true, "requires_live_db": true, "recommended_now": false, "minimal_safe_action": "Pro Funktion menschlich prüfen; nur bei echter Lücke eine Migration.", "required_tests": ["T-SQL-002", "T-SQL-003", "T-INT-ORG-001", "T-INT-CHAT-001"], "rationale": "row_security=off braucht verifizierte Guards; Parser kann falsch positiv sein."},
    {"id": "M-004", "title": "Mehrfach redefinierte SECDEF vs Live pg_proc", "class": 2, "severity": "medium", "evidence_type": "repo_only", "affects_login": false, "affects_admin": false, "affects_rls": true, "affects_org_isolation": true, "requires_live_db": true, "recommended_now": false, "minimal_safe_action": "Letzte Migration als Erwartung; bei Drift eine Nachzieh-Migration.", "required_tests": ["T-SQL-004", "T-FEAT-PAYWALL-001"], "rationale": "Letzte Datei muss deployed sein."},
    {"id": "M-005", "title": "RLS FOR ALL Watchlist + profiles in policies + MAT self-ref", "class": 2, "severity": "high", "evidence_type": "needs_live_db", "affects_login": true, "affects_admin": true, "affects_rls": true, "affects_org_isolation": true, "requires_live_db": true, "recommended_now": false, "minimal_safe_action": "SQL_CHECKS A–C lesend; Fix nur dedizierte Migration.", "required_tests": ["T-SQL-001", "T-SQL-005", "T-LOGIN-ALL"], "rationale": "42P17 betrifft Login-Pfad."},
    {"id": "M-006", "title": "Admin-Helper vereinheitlichen / Fallbacks streichen", "class": 5, "severity": "high", "evidence_type": "repo_only", "affects_login": true, "affects_admin": true, "affects_rls": true, "affects_org_isolation": false, "requires_live_db": true, "recommended_now": false, "minimal_safe_action": "Nicht ohne Live-Beweis und E2E.", "required_tests": ["T-LOGIN-ADMIN", "T-AUTH-ADMIN-RPC", "T-SQL-006"], "rationale": "Triple-Fallback schützt Admin bei transienten RPC-Fehlern."},
    {"id": "M-007", "title": "admin_* Legacy-Guard zu PERFORM assert_is_admin()", "class": 4, "severity": "medium", "evidence_type": "heuristic", "affects_login": true, "affects_admin": true, "affects_rls": false, "affects_org_isolation": false, "requires_live_db": true, "recommended_now": false, "minimal_safe_action": "Eine RPC pro Release; erste wirksame Zeile assert.", "required_tests": ["T-LOGIN-ADMIN", "T-FEAT-ADMIN-RPC-001", "T-SQL-006"], "rationale": "Konsistenz mit UUID+Email-Pin; falsch = Dashboard aus."},
    {"id": "M-008", "title": "link_model_by_email aus Step 2 entfernen", "class": 4, "severity": "medium", "evidence_type": "confirmed", "affects_login": false, "affects_admin": false, "affects_rls": false, "affects_org_isolation": true, "requires_live_db": false, "recommended_now": false, "minimal_safe_action": "Nur nach Token-Coverage; nie Step 1.", "required_tests": ["T-LOGIN-MODEL", "T-CLAIM-001", "T-INVITE-001"], "rationale": "Gefahr 9; vorzeitig = Legacy-Modelle brechen."},
    {"id": "M-009", "title": "Org-RPC LIMIT 1 / implizite Org nicht verschärfen ohne UI", "class": 5, "severity": "high", "evidence_type": "confirmed", "affects_login": false, "affects_admin": false, "affects_rls": false, "affects_org_isolation": true, "requires_live_db": false, "recommended_now": false, "minimal_safe_action": "Kein Rückschritt zu LIMIT 1 in get_my_org_context.", "required_tests": ["T-ORG-001", "T-ORG-002"], "rationale": "account-org-context-canonical."},
    {"id": "M-010", "title": "model_agency_territories keine Self-Join-Policies", "class": 2, "severity": "critical", "evidence_type": "confirmed", "affects_login": true, "affects_admin": true, "affects_rls": true, "affects_org_isolation": true, "requires_live_db": true, "recommended_now": false, "minimal_safe_action": "self_mat SQL check; Fix wie 20260414.", "required_tests": ["T-SQL-005", "T-LOGIN-ALL", "T-RLS-MAT-001"], "rationale": "Bekannte 42P17-Kette."},
    {"id": "M-011", "title": "Storage policies SECDEF-Helper", "class": 2, "severity": "high", "evidence_type": "needs_live_db", "affects_login": false, "affects_admin": false, "affects_rls": true, "affects_org_isolation": true, "requires_live_db": true, "recommended_now": false, "minimal_safe_action": "Lesend prüfen; kein models-JOIN in Policy.", "required_tests": ["T-SQL-007", "T-FEAT-UPLOAD-001", "T-FEAT-CHATFILE-001"], "rationale": "Upload bricht bei models-RLS-Kopplung."},
    {"id": "M-012", "title": "Location CONSTRAINT + DISTINCT ON Near Me", "class": 2, "severity": "high", "evidence_type": "needs_live_db", "affects_login": false, "affects_admin": false, "affects_rls": false, "affects_org_isolation": false, "requires_live_db": true, "recommended_now": false, "minimal_safe_action": "Live mit Risk-16-Liste abgleichen.", "required_tests": ["T-SQL-008", "T-FEAT-NEARME-001"], "rationale": "Falsches ON CONFLICT / fehlendes DISTINCT ON."},
    {"id": "M-013", "title": "Frontend .catch auf Option-A audit", "class": 3, "severity": "low", "evidence_type": "heuristic", "affects_login": false, "affects_admin": false, "affects_rls": false, "affects_org_isolation": false, "requires_live_db": false, "recommended_now": false, "minimal_safe_action": "Ein Callsite pro PR.", "required_tests": ["T-UNIT-SVC-001", "T-E2E-CRITICAL-001"], "rationale": "Massenrefactor ohne Tests riskant."},
    {"id": "M-014", "title": "ServiceResult vs Option A nur bewusst pro Modul", "class": 3, "severity": "low", "evidence_type": "heuristic", "affects_login": false, "affects_admin": false, "affects_rls": false, "affects_org_isolation": false, "requires_live_db": false, "recommended_now": false, "minimal_safe_action": "Kein stiller globaler Wechsel.", "required_tests": ["T-UNIT-SVC-001"], "rationale": "Invariante: nicht pro Funktion mischen."},
    {"id": "M-015", "title": "GDPR-RPC Regression bei nahen SECDEF-Änderungen", "class": 3, "severity": "medium", "evidence_type": "confirmed", "affects_login": true, "affects_admin": false, "affects_rls": true, "affects_org_isolation": true, "requires_live_db": true, "recommended_now": false, "minimal_safe_action": "Isolierte Testreleases.", "required_tests": ["T-GDPR-001", "T-GDPR-002", "T-AUTH-PROFILE-001"], "rationale": "Löschung/Membership sensibel."},
    {"id": "M-016", "title": "signIn/bootstrap/loadProfile/App Admin-Branch strukturell unverändert lassen", "class": 5, "severity": "critical", "evidence_type": "confirmed", "affects_login": true, "affects_admin": true, "affects_rls": false, "affects_org_isolation": false, "requires_live_db": false, "recommended_now": false, "minimal_safe_action": "Kein Refactor ohne Security-Review.", "required_tests": ["T-LOGIN-ALL", "T-AUTH-BOOTSTRAP-001"], "rationale": "admin-security invariant."},
    {"id": "M-017", "title": "Audit-/Drift-Dokumentation nach Live-Lauf", "class": 1, "severity": "low", "evidence_type": "repo_only", "affects_login": false, "affects_admin": false, "affects_rls": false, "affects_org_isolation": false, "requires_live_db": true, "recommended_now": true, "minimal_safe_action": "Artefakte/Appendix aktualisieren.", "required_tests": ["T-STATIC-001"], "rationale": "Null Produkt-Risiko."}
  ],
  "high_heuristic_secdef_names": [
    "add_model_assignments",
    "bulk_add_model_territories",
    "bulk_save_model_territories",
    "conversation_accessible_to_me",
    "create_b2b_org_conversation",
    "get_assignments_for_agency_roster",
    "get_assignments_for_model",
    "get_b2b_counterparty_org_name",
    "get_model_claim_preview",
    "get_my_organization_ids",
    "has_platform_access",
    "list_client_organizations_for_agency_directory",
    "model_belongs_to_current_user",
    "resolve_b2b_org_pair_for_chat",
    "save_model_assignments",
    "user_is_member_of_organization"
  ],
  "phases": {
    "phase_1": ["M-017", "M-001", "M-002", "M-005", "M-010", "M-011", "M-012"],
    "phase_2": ["M-003", "M-004"],
    "phase_3": ["M-007", "M-008", "M-013", "M-014", "M-015"],
    "deferred": ["M-006", "M-009", "M-016"]
  }
}
```

---

*Ende CURSOR_FIX_PLAN.md*

# CURSOR_OPTION_E2E_VERIFY_RESULTS

Stand: 2026-04-08  
Modus: Agent-seitige Verifikation in dieser Umgebung, ohne Änderungen an Auth/Admin/Paywall/Core-Option-Serverlogik.

## Ergebnis-Matrix

| # | Flow | Status | Rollen-Kontext | Repro (kurz) | Erwartung | Ergebnis |
|---|---|---|---|---|---|---|
| 1 | Global discovery (Client erstellt Option/Casting, Agency sieht Request, Thread erscheint) | NOT_EXECUTED | Client Owner, Client Employee, Agency Owner, Agency Booker | Echte Multi-Session-Staging-Ausführung war hier nicht startbar | Request + Thread in beiden Sichten | Nicht live ausgeführt |
| 2 | Shared project mode (`project_id` korrekt, kein falscher Projektbezug) | UNSURE | Client Owner, Client Employee | Codepfad aus `ClientWebApp` geprüft; kein echter Multi-Role-Live-Run | Request in Shared-Project nutzt korrektes `project_id` | Potenzieller Edge-Case bleibt offen, live nicht bestätigt |
| 3 | Package context (Request aus Package, Metadaten plausibel) | PASS (static) | Client Owner/Employee, Package-Kontext | Review von `handleOptionRequest` + Booking-Metadata-Pfad | `source/package` Metadaten plausibel im B2B-Card-Pfad | Statisch bestätigt |
| 4 | Read-only shared link (kein Request möglich) | PASS (static) | Read-only shared link | Review `SharedSelectionView` (nur Anzeige) | Keine write-Aktion/kein Option-CTA | Statisch bestätigt |
| 5 | Territory / agency resolution (richtige Agency, fehlender Territory-Fall kontrolliert) | NOT_EXECUTED | Client Owner, Client Employee | Kein Live-Staging-Run mit echten Territory-Daten | Richtige Agency oder kontrollierter Fallback/Alert | Nicht live ausgeführt |
| 6 | Org columns / row semantics (Org-Bezüge auf neuen Requests) | PASS (static) | Client Owner, Client Employee | Payload-Path in Store/Service geprüft | `organization_id`, `client_organization_id`, `agency_organization_id` werden gesetzt (wenn auflösbar) | Statisch bestätigt |
| 7 | B2B booking card landet im richtigen org-pair chat | PASS (static) | Client + Agency | Service-Call-Pfad nach erfolgreichem Submit geprüft | Booking-Message mit Kontext-Metadata im B2B-Chat | Statisch bestätigt |
| 8 | Option thread Client↔Agency plausibel/synchron | NOT_EXECUTED | Client + Agency | Kein paralleler Live-Session-Test | Gleicher Thread-Kontext, konsistente Sicht | Nicht live ausgeführt |
| 9 | Counter offer (Agency counter; Client sieht/akzeptiert/lehnt) | NOT_EXECUTED | Agency + Client | Nur Unit-Tests/Codepfade, kein reales Multi-Session-UI | Counter-Lifecycle funktioniert end-to-end | Nicht live ausgeführt |
| 10 | Agency accept / model approval (linked/unlinked, keine Race-Inkonsistenz) | NOT_EXECUTED | Agency, Model | Nur bestehende Tests/Flow-Review, kein realer Rollenlauf | linked/unlinked verhalten sich wie spezifiziert | Nicht live ausgeführt |
| 11 | Option -> calendar / booking mirror (inkl. keine offensichtliche Doppelung) | NOT_EXECUTED | Client + Agency | Kein Live-Confirm->Calendar-Lauf | Spiegelung korrekt, keine Dubletten | Nicht live ausgeführt |
| 12 | Job confirm aktualisiert Kalender korrekt | NOT_EXECUTED | Client | Kein echter Job-confirm-Live-Run | Kalender spiegelt Job-Confirm korrekt | Nicht live ausgeführt |
| 13 | Agency search deep-link öffnet richtigen Thread | PASS (static) | Agency Owner, Agency Booker | `GlobalSearchBar`/`AgencyControllerView` Verkabelung geprüft | Auswahl aus Suche öffnet richtigen Option-Thread | Statisch bestätigt |
| 14 | Shared vs private notes (shared sichtbar, private getrennt) | NOT_EXECUTED | Client, Agency, Model | Kein Live-Rollenlauf mit Notes-Schreib-/Lesepfaden | Sichtbarkeit entspricht Rollentrennung | Nicht live ausgeführt |
| 15 | Conflict warning (warn-only) | PASS (static) | Client | Conflict-Check und Weiterlauf im Store geprüft | Warning, aber Submit bleibt erlaubt | Statisch bestätigt |
| 16 | Security sanity (keine offensichtlichen Org-Leaks/Email-Matching/scoping) | UNSURE | Alle Produktrollen | Kein Live-Tenant-Isolationstest mit mehreren Orgs/Sessions | Keine Leaks, kein falsches Routing | Ohne echtes Multi-Tenant-E2E nicht final belegbar |
| 17 | Regression sanity (Admin/Login/Auth/Paywall unberührt) | PASS (scope) | Admin/Auth/Paywall-Kontext | Scope-Check gegen Do-not-touch + keine Änderungen dort | Keine unbeabsichtigte Regression durch diese Welle | Bestätigt (Scope-basiert) |

## Automatisierte Läufe in dieser Welle

- `npm run typecheck`: PASS  
- `npm run lint`: PASS  
- `npm test -- --passWithNoTests --ci`: PASS  
- `npx playwright test`: FAIL (infrastrukturell)  
  - Grund: fehlendes Playwright-Chromium-Binary im Sandbox-Kontext
  - Nachinstallationsversuch `npx playwright install chromium`: blockiert durch Network-Policy (`cdn.playwright.dev` nicht erlaubt)

## Klassifikation pro Befund

- **NO_ISSUE:** 3, 4, 6, 7, 13, 15, 17  
- **UNSURE:** 2, 16  
- **NOT_EXECUTED:** 1, 5, 8, 9, 10, 11, 12, 14  
- **CONFIRMED_HIGH / CONFIRMED_MEDIUM / LOW:** keine neu reproduzierten Produktfehler in dieser Welle

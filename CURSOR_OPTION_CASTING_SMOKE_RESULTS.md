# CURSOR_OPTION_CASTING_SMOKE_RESULTS

Smoke / verify wave for the Option–Casting request workflow. **No product fixes were implemented** in this activity; results combine **CI (automated)** and **static code review** where live multi-role E2E was not executed.

---

## 1. Executive Summary

- **Automated:** `npm run typecheck`, `npm run lint`, and `npm test -- --passWithNoTests --ci` completed successfully (60 suites, 705 tests). Included: `optionRequestsConfirmation.test.ts`, `optionRequestsCounterOffer.test.ts`.
- **Static verification:** Several items are **PASS** based on reading control flow in `ClientWebApp`, `optionRequests` store, `bookingChatIntegrationSupabase`, `AgencyControllerView`, and `SharedSelectionView`.
- **Not executed:** Full browser workflows (Discover → submit → agency inbox, negotiation, calendar mirrors, cross-tenant isolation) were **not** run against staging/production in this session.
- **UNSURE:** Shared-project mode may not always send the intended `project_id` because `handleOptionRequest` uses `activeProjectId` when no explicit `projectId` is passed, while project Discover uses `sharedProjectId` — **needs manual confirmation** on staging.

**Auth / Admin / Login:** No files under the forbidden list were modified during this smoke-documentation task (`auth_admin_login_untouched: true`).

**Paywall:** No paywall core code was changed in this task; live paywall behavior was not re-tested (`paywall_appears_unchanged: true` at scope level).

---

## 2. Test Coverage

| Spur | Was lief | Abdeckung |
|------|----------|-----------|
| A — CI | typecheck, lint, full Jest | Gesamtprojekt grün; Option-Services nur mit **Mocks** in dedizierten Tests |
| B — Statisch | Greps / Lesen der genannten Dateien | Items 3, 4, 6, 7, 14, 16, 18 (teilweise) |
| C — Manuell E2E | Nicht durchgeführt | Items 1, 5, 8–13, 15, 17 |

Detaillierte Zählung siehe `CURSOR_OPTION_CASTING_SMOKE_RESULTS.json` → `summary`.

---

## 3. Einzelresultate 1–18

### 1 — Global discovery

| Feld | Inhalt |
|------|--------|
| **Status** | NOT_TESTED |
| **Rolle / Kontext** | Client Owner, Client Employee |
| **Getestet** | Keine Live-Session (Discover → Detail → Option/Casting Submit). |
| **Erwartet** | Thread in Messages; Agency sieht Request. |
| **Tatsächlich** | Nicht ausgeführt. |
| **Bei FAIL/UNSURE** | — |

### 2 — Shared project mode

| Feld | Inhalt |
|------|--------|
| **Status** | UNSURE |
| **Rolle / Kontext** | Client Owner, Client Employee |
| **Getestet** | Code-Review: `openProjectDiscovery` setzt nur `sharedProjectId`. `handleOptionRequest` übergibt `projectId ?? activeProjectId ?? undefined` an `addOptionRequest`. Discover ruft `onOptionRequest(name, id, date)` **ohne** Projekt-Argument. |
| **Erwartet** | `project_id` korrekt; kein ungewollter Read-only-Konflikt mit `isSharedMode`. |
| **Tatsächlich** | Wenn `activeProjectId` ≠ geöffnetes Shared-Project oder `null`, kann `project_id` falsch oder leer sein — **manuelle Verifikation nötig**. |
| **Betroffene Dateien** | `src/web/ClientWebApp.tsx` |
| **Hypothese** | Explizit `sharedProjectId` (oder Projekt-ID) an `handleOptionRequest`/`addOptionRequest` koppeln, wenn `isSharedMode`. |
| **Schweregrad** | MEDIUM (falls bestätigt) |

### 3 — Package context

| Feld | Inhalt |
|------|--------|
| **Status** | PASS (statisch) |
| **Rolle / Kontext** | Client Owner/Employee, Guest/Package-Kontext |
| **Getestet** | `packageViewState` → `extra.source === 'package'`, `packageId`; `createBookingMessageInClientAgencyChat` schreibt `source` / `package_id` in Metadaten. |
| **Erwartet** | Booking-Card-Metadaten mit Package-Herkunft wo vorgesehen. |
| **Tatsächlich** | Pfad im Code vorhanden; Guest-Link-UI nicht im Browser durchgespielt. |

### 4 — Read-only shared link

| Feld | Inhalt |
|------|--------|
| **Status** | PASS (statisch) |
| **Rolle / Kontext** | Gast / externer Link |
| **Getestet** | `SharedSelectionView`: nur Anzeige, kein Option-CTA, kein Store-Call. |
| **Erwartet** | Kein Option Request, kein versteckter Schreibpfad. |
| **Tatsächlich** | Entspricht dem erwarteten Read-only-UI. |

### 5 — Territory / agency resolution

| Feld | Inhalt |
|------|--------|
| **Status** | NOT_TESTED |
| **Rolle / Kontext** | Client Owner, Client Employee |
| **Getestet** | Keine Live-Modelle/Territories; nur Kenntnis des Codes (`resolveAgencyForModelAndCountry`, Fallback `model.agency_id`, Alert bei fehlendem Land ohne Fallback). |
| **Erwartet** | Richtige Agency; kontrollierte Reaktion ohne stilles Fehlrouting. |
| **Tatsächlich** | Nicht mit echten Daten verifiziert. |

### 6 — Org columns on insert

| Feld | Inhalt |
|------|--------|
| **Status** | PASS (statisch) |
| **Rolle / Kontext** | Client Owner, Client Employee |
| **Getestet** | `addOptionRequest` → `insertOptionRequest` mit `organization_id`, `client_organization_id`, `agency_organization_id` (Resolver über `organizations.agency_id`). |
| **Erwartet** | Erwartete Org-Spalten auf neue Zeilen. |
| **Tatsächlich** | Payload im Client-Pfad gesetzt; kein direkter SQL-Row-Check. |

### 7 — B2B booking card

| Feld | Inhalt |
|------|--------|
| **Status** | PASS (statisch) |
| **Rolle / Kontext** | Client, Agency (B2B-Chat) |
| **Getestet** | Nach erfolgreichem Insert: Aufruf `createBookingMessageInClientAgencyChat` unter Bedingungen (User, `organizationId`, `bookingCountryCode`). |
| **Erwartet** | Booking-typed Message mit Datum/Model/Land. |
| **Tatsächlich** | Implementiert; Inhalt im echten Chat nicht geprüft. |

### 8 — Option thread

| Feld | Inhalt |
|------|--------|
| **Status** | NOT_TESTED |
| **Rolle / Kontext** | Client, Agency |
| **Getestet** | Kein Realtime-Zwei-User-Test. |
| **Erwartet** | Sync, `threadId` konsistent mit `option_requests.id`. |
| **Tatsächlich** | Nicht ausgeführt. |

### 9 — Counter offer

| Feld | Inhalt |
|------|--------|
| **Status** | NOT_TESTED (Unit-Tests grün) |
| **Rolle / Kontext** | Agency, Client |
| **Getestet** | Jest `optionRequestsCounterOffer.test.ts` (gemockt). |
| **Erwartet** | Client sieht Counter; Verlauf plausibel. |
| **Tatsächlich** | Kein UI-/Cross-User-Test. |

### 10 — Client accept counter

| Feld | Inhalt |
|------|--------|
| **Status** | NOT_TESTED (Unit-Tests grün) |
| **Rolle / Kontext** | Client |
| **Getestet** | Jest für `clientAcceptCounterPrice` (RPC-Pfad, mocks). |
| **Erwartet** | Confirmed path; Thread/Status konsistent. |
| **Tatsächlich** | Nicht live verifiziert. |

### 11 — Agency accept / model approval

| Feld | Inhalt |
|------|--------|
| **Status** | NOT_TESTED (Unit-Tests grün) |
| **Rolle / Kontext** | Agency, Model |
| **Getestet** | Jest `optionRequestsConfirmation.test.ts` (mocks). |
| **Erwartet** | Linked vs. unlinked Pfade wie dokumentiert. |
| **Tatsächlich** | Nicht live verifiziert. |

### 12 — Option → calendar entry / booking event

| Feld | Inhalt |
|------|--------|
| **Status** | NOT_TESTED |
| **Rolle / Kontext** | Client, Agency |
| **Getestet** | Kein Post-Confirm Kalender-Check. |
| **Erwartet** | Plausible Kalender-/Booking-Daten, keine offensichtliche Doppelung. |
| **Tatsächlich** | Nicht ausgeführt. |

### 13 — Job confirm

| Feld | Inhalt |
|------|--------|
| **Status** | NOT_TESTED |
| **Rolle / Kontext** | Client |
| **Getestet** | Nur Code-Referenz (`clientConfirmJobStore` / `clientConfirmJobOnSupabase`). |
| **Erwartet** | Kalender-Update; keine Phantom-Duplikate. |
| **Tatsächlich** | Nicht ausgeführt. |

### 14 — Search deep-link

| Feld | Inhalt |
|------|--------|
| **Status** | PASS (statisch) |
| **Rolle / Kontext** | Agency Owner, Agency Booker |
| **Getestet** | `onSelectOption` → `searchOptionId` + Tab `messages`; `pendingOptionRequestId` → Effect setzt `optionRequests` + `selectedThreadId`. |
| **Erwartet** | Korrekter Option-Thread aus Suche. |
| **Tatsächlich** | Verdrahtung schlüssig; Klickpfad nicht im UI getestet. |

### 15 — Shared vs private notes

| Feld | Inhalt |
|------|--------|
| **Status** | NOT_TESTED |
| **Rolle / Kontext** | Client, Agency, Model |
| **Getestet** | Typen/Helper in `calendarSupabase` (`shared_notes` vs. Rollenfelder) nur gelesen. |
| **Erwartet** | Rollengetrennte private Felder; geteilte Notizen sichtbar wie vorgesehen. |
| **Tatsächlich** | Kein RLS-/Zwei-Org-Test. |

### 16 — Conflict warning

| Feld | Inhalt |
|------|--------|
| **Status** | PASS (statisch) |
| **Rolle / Kontext** | Client |
| **Getestet** | `checkCalendarConflict` → bei Konflikt nur Alert, danach normaler Insert. |
| **Erwartet** | Warn-only, Submit weiter möglich (fail-open). |
| **Tatsächlich** | Entspricht `docs/OPTION_CASTING_FLOW.md` / Store-Kommentar. |

### 17 — Security sanity

| Feld | Inhalt |
|------|--------|
| **Status** | NOT_TESTED |
| **Rolle / Kontext** | Agency, Client |
| **Getestet** | Stichprobe: kein Email-Matching im Option-Store-Pfad; keine Zwei-Agentur-Live-Abfrage. |
| **Erwartet** | Keine Org-Leaks; Scope org-zentriert. |
| **Tatsächlich** | Isolation ohne echte Mandanten-Session nicht belegbar. |

### 18 — Paywall / admin / login regression

| Feld | Inhalt |
|------|--------|
| **Status** | PASS (Scope) |
| **Rolle / Kontext** | Admin, Owner |
| **Getestet** | Diese Welle: keine Änderungen an Auth-, Admin-, Login- oder Paywall-Kernpfaden. |
| **Erwartet** | Keine Regression durch **diese** Aktivität; Live-Admin-Login nicht erneut ausgeführt. |
| **Tatsächlich** | Verifiziert nur als „keine Code-Änderung in verbotenen Bereichen“ für diesen Task. |

---

## 4. Confirmed Failures

**Keine.** Es wurde kein reproduzierbarer Produktfehler in einer Live-Session bestätigt.

---

## 5. Unclear / Needs Manual Follow-up

- **Item 2 (Shared project / `project_id`):** Abgleich `sharedProjectId` vs. `activeProjectId` im echten Flow auf Staging.
- **Alle NOT_TESTED-Items:** Abarbeitung gemäß [CURSOR_OPTION_CASTING_VERIFY.md](CURSOR_OPTION_CASTING_VERIFY.md) mit echten Accounts.

---

## 6. Safe Next Fix Candidates

1. **Staging-E2E:** Gesamte Verify-Matrix mit Client-, Agency- und Model-User durchspielen (schließt die meisten NOT_TESTED-Punkte).
2. **Mini-Fix-Kandidat (nach QA-Bestätigung):** Wenn `project_id` im Shared-Project-Modus fehlt/falsch ist — `handleOptionRequest` / Discover-Callback so erweitern, dass im `isSharedMode` die aktive Projekt-ID aus `sharedProjectId` fließt (nur nach Nachweis, kein Blind-Fix).
3. **Audit-Follow-up (niedrig priorisiert):** Upload-Audit und `hasNewMessages`-Semantik aus [CURSOR_OPTION_CASTING_AUDIT_REPORT.md](CURSOR_OPTION_CASTING_AUDIT_REPORT.md) — getrennte kleine Tasks.

---

## 7. Explizite Aussagen

- **Auth / Admin / Login:** In dieser Smoke-Dokumentationsrunde **unberührt** (keine Edits an `AuthContext.tsx`, `App.tsx`, Sign-in/Bootstrap/loadProfile, Admin-RPCs).
- **Paywall:** Keine Änderung an Paywall-Kernlogik in dieser Runde; **Live-Verhalten** der Paywall wurde hier **nicht** erneut gemessen.

---

## Abschluss

**OPTION CASTING VERIFY COMPLETED**

*(Alle 18 Punkte sind mit begründetem Status dokumentiert; Spur A+B abgeschlossen. Vollständige Produkt-PASS/FAIL-Aussagen für Negotiation/Kalender erfordern weiterhin manuelles E2E.)*

Dateien: [CURSOR_OPTION_CASTING_SMOKE_RESULTS.md](CURSOR_OPTION_CASTING_SMOKE_RESULTS.md), [CURSOR_OPTION_CASTING_SMOKE_RESULTS.json](CURSOR_OPTION_CASTING_SMOKE_RESULTS.json).

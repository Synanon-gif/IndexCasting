# CURSOR_SHARED_PROJECT_ID_DIFF_SUMMARY

## Geänderte Dateien

- `src/web/ClientWebApp.tsx`
- `CURSOR_SHARED_PROJECT_ID_AUDIT.md`
- `CURSOR_SHARED_PROJECT_ID_DIFF_SUMMARY.md`
- `CURSOR_SHARED_PROJECT_ID_VERIFY.md`
- `CURSOR_SHARED_PROJECT_ID_RESULT.json`

## Zweck

- `src/web/ClientWebApp.tsx`:
  - Minimalfix für Shared-Project-`project_id`-Fallback.
  - Shared-Mode priorisiert jetzt `sharedProjectId`, bevor `activeProjectId` verwendet wird.
- Report-Dateien:
  - Fehlerbeweis, Verify-Checkliste und Ergebnisstatus dokumentieren.

## Risiko

- Niedrig:
  - Ein einzelner Fallback-Ausdruck wurde angepasst.
  - Keine Refactors, keine Auth/Admin/Paywall/DB-Migration/RLS/RPC-Massenänderungen.
- Erwartetes Verhalten:
  - Shared-Project-Submit wird deterministischer.
  - Global-Discovery-Submit bleibt über `activeProjectId`/explizites `projectId` wie zuvor.

## Testbezug

Ausgeführt nach der Codeänderung:
- `npm run typecheck` (grün)
- `npm run lint` (grün)
- `npm test -- --passWithNoTests --ci` (grün)
  - `Test Suites: 60 passed, 60 total`
  - `Tests: 705 passed, 705 total`
  - Relevante Option-Suites weiterhin grün:
    - `src/services/__tests__/optionRequestsCounterOffer.test.ts`
    - `src/services/__tests__/optionRequestsConfirmation.test.ts`

# CURSOR_SHARED_PROJECT_ID_VERIFY

Verify-Fokus: nur Shared-Project-`project_id` im Option/Casting-Request-Flow.

## Prüfpunkte

- [x] Shared project mode nutzt richtige `project_id`
  - Statisch bestätigt: `handleOptionRequest` nutzt jetzt `projectId ?? sharedProjectId ?? activeProjectId ?? undefined`.
  - Damit wird im Shared-Mode die geöffnete Projekt-ID deterministisch priorisiert.

- [x] Global discovery Verhalten unverändert
  - Wenn kein `sharedProjectId` gesetzt ist, bleibt der Fallback auf explizites `projectId` bzw. `activeProjectId` unverändert.

- [x] Package flow unverändert
  - Package-spezifische `extra`-Metadaten (`source`, `packageId`) bleiben unverändert; Fix betrifft nur Projekt-ID-Fallback.

- [x] Read-only shared link unverändert
  - `SharedSelectionView` wurde nicht verändert.

- [x] Keine Regression in `addOptionRequest`
  - Store/Service-Code (`src/store/optionRequests.ts`, `src/services/optionRequestsSupabase.ts`) blieb unverändert; nur Input-Fallback aus UI wurde korrigiert.

- [x] Kein Einfluss auf Auth/Admin/Login
  - Keine Änderungen an den Do-not-touch-Bereichen.

## Qualitätschecks

- [x] `npm run typecheck`
- [x] `npm run lint`
- [x] `npm test -- --passWithNoTests --ci`

Ergebnis: alle Checks grün.

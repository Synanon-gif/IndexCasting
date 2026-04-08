# CURSOR_SHARED_PROJECT_ID_AUDIT

## 1. Executive Summary

Status: **CONFIRMED_SHARED_PROJECT_ID_BUG**.

Der Shared-Project-Flow konnte `project_id` im Option/Casting-Request inkonsistent setzen.  
Minimaler, sicherer Fix wurde umgesetzt: Im `handleOptionRequest`-Fallback wird jetzt im Shared-Mode zuerst `sharedProjectId` verwendet, erst danach `activeProjectId`.

## 2. Exakter Flow

1. Shared-Discover wird über `openProjectDiscovery(projectId)` geöffnet und setzt nur `sharedProjectId`.
2. `isSharedMode` wird aus `sharedProject` abgeleitet (`sharedProject = projects.find(...sharedProjectId...)`).
3. Option-Submit geht über `handleOptionRequest(...)`.
4. `handleOptionRequest` ruft `addOptionRequest(...)` mit Projekt-ID-Fallback auf.
5. `addOptionRequest` reicht `project_id` an `insertOptionRequest` weiter.
6. `insertOptionRequest` schreibt `project_id` in `option_requests` (oder `null`).

Codepfad:
- `src/web/ClientWebApp.tsx` (`openProjectDiscovery`, `isSharedMode`, `handleOptionRequest`, `onOptionRequest`-Aufrufe)
- `src/store/optionRequests.ts` (`addOptionRequest` → `insertOptionRequest`)
- `src/services/optionRequestsSupabase.ts` (`project_id: req.project_id || null`)

## 3. Bestätigt oder nicht bestätigt

**Bestätigt.**

Harter Nachweis (statische Pfadanalyse):
- `openProjectDiscovery` setzt `sharedProjectId`, nicht `activeProjectId`.
- Relevante Option-Aufrufe im Discover-Kontext übergeben kein explizites `projectId` (z. B. DatePicker mit `undefined`).
- Vor Fix nutzte `handleOptionRequest` den Fallback `projectId ?? activeProjectId ?? undefined`.
- Dadurch sind reale Inkonsistenzpfade möglich:
  - Fall A: `activeProjectId = null` → `project_id` wird `null`.
  - Fall B: `activeProjectId != sharedProjectId` → Request landet auf falschem Projekt.

Marker: `CONFIRMED_SHARED_PROJECT_ID_BUG`.

## 4. Kleinster sicherer Fix

Nur eine kleine Änderung in `src/web/ClientWebApp.tsx`:

- Vorher: `projectId ?? activeProjectId ?? undefined`
- Nachher: `projectId ?? sharedProjectId ?? activeProjectId ?? undefined`

Wirkung:
- Shared-Project-Mode verwendet deterministisch die geöffnete Shared-Projekt-ID.
- Global Discovery und andere Flows behalten ihr bestehendes Fallback-Verhalten.

## 5. Warum Auth/Admin/Login unberührt blieb

- Keine Änderungen an:
  - `src/context/AuthContext.tsx`
  - `App.tsx`
  - `signIn` / `bootstrapThenLoadProfile` / `loadProfile`
  - Admin-RPCs (`get_own_admin_flags`, `is_current_user_admin`, `assert_is_admin`)
  - `get_my_org_context`
  - Paywall-Kernlogik
- Änderung ist auf einen einzigen Fallback-Ausdruck im Client-Discover-Flow begrenzt.

## 6. Nächste sinnvolle Schritte

1. Kurzer manueller UI-Check (Shared-Project geöffnet, Option senden, DB-Row prüfen), um den Fix im echten Pfad zu bestätigen.
2. Optional ein kleiner, gezielter Regressionstest für `handleOptionRequest`-Fallback (Shared-ID vor Active-ID), wenn Test-Harness für diesen UI-Pfad leichtgewichtig möglich ist.
3. Danach kann UX-1 (Statussprache angleichen) separat bewertet werden.

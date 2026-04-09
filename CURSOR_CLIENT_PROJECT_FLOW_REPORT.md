# CURSOR_CLIENT_PROJECT_FLOW_REPORT

## 1. Executive Summary

Der Client-Organisations-Project-Flow wurde gehärtet: **Projekt-Modelle** kommen für eingeloggte Nutzer mit `clientOrgId` nun aus der Datenbank (`client_project_models` + sichtbare `models`-Zeilen via `getModelByIdForClientFromSupabase`), nicht mehr aus einem veralteten localStorage-Merge. Leere Projektlisten aus der DB leeren den UI-State. **Projekt-Erstellung** ohne erfolgreiche Supabase-Antwort erzeugt keine Ghost-Projekte mit numerischer ID. **Projekt-Löschen** in der UI entspricht der RLS-Regel (`owner_id`). Doppeltes Bestätigungs-Dialog beim Entfernen eines Models aus dem Projekt wurde entfernt.

## 2. Bestätigte Root Causes

1. **Sync-Effekt in `ClientWebApp.tsx`:** Kommentar und Logik behaupteten, Modelle lägen „nicht in Supabase“ — faktisch existiert `client_project_models`; der Merge aus localStorage ließ Owner/Employee auf neuem Gerät leere Projektlisten sehen trotz DB-Daten.
2. **Kein `setProjects([])` bei `remote.length === 0`:** Verwaiste localStorage-Projekte blieben sichtbar.
3. **`createProjectInternal`:** Fallback auf `Date.now()`-ID bei fehlgeschlagenem API-Create führte zu nicht-UUID-IDs und scheiterndem `add_model_to_project`.
4. **Delete-Button:** Für alle sichtbar, RLS erlaubt DELETE nur für `client_projects.owner_id`.
5. **Doppeltes `window.confirm`:** `ProjectOverviewView` und `handleRemoveModelFromProject`.

## 3. Was konkret gefixt wurde

- `fetchHydratedClientProjectsForOrg` in `projectsSupabase.ts` + Mapper `mapSupabaseModelToClientProjectSummary` in `clientProjectHydration.ts`.
- Sync-`useEffect`: Hydration, leere Liste → `[]`, `activeProjectId` bereinigen; `realClientId` vor dem Effect verschoben.
- `Project.ownerId` aus DB; `canDeleteProject` / Handler-Guard.
- `createProjectInternal` + `clearFeedbackLater`-Reihenfolge.
- Ein Confirm bei Remove-from-project entfernt (nur Parent).

## 4. Geänderte / neue Dateien

- `src/services/projectsSupabase.ts`
- `src/utils/clientProjectHydration.ts` (neu)
- `src/utils/__tests__/clientProjectHydration.test.ts` (neu)
- `src/web/ClientWebApp.tsx`
- `.cursor/rules/system-invariants.mdc`
- `.cursor/rules/auto-review.mdc`
- `.cursorrules`
- `CURSOR_CLIENT_PROJECT_FLOW_*.md` / `.json` (Deliverables)

## 5. Rules angepasst

Ja — `system-invariants.mdc` (**CLIENT B2B PROJECTS**), `auto-review.mdc` (zwei Blocker-Zeilen), `.cursorrules` (**§27.14**).

## 6. Migrationen / Live-Verify

**Keine** neue SQL-Migration: bestehende Tabellen/RPCs reichen. Kein Pflicht-Live-Verify für Schema; funktionaler Check über UI/Matrix in `CURSOR_CLIENT_PROJECT_FLOW_VERIFY.md`.

## 7. CI-Ergebnis

`npm run typecheck`, `npm run lint`, `npm test -- --passWithNoTests --ci` — **grün** (lokal ausgeführt).

## 8. Verbleibende Restrisiken

- **`add_model_to_project`** löst Caller-Org mit `LIMIT 1` auf — bei Multi-Org-Client-Usern theoretisch falscher Org-Kontext (bestehendes DB-Design).
- **N+1-Fetches** bei Hydration (viele Projekte × viele Models): mittelfristig Batch-RPC möglich.

---

**Finale Abschlusszeile:** CLIENT PROJECT FLOW HARDENING COMPLETE — MINOR RISKS REMAIN

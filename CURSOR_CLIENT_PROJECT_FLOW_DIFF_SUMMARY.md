# CURSOR_CLIENT_PROJECT_FLOW_DIFF_SUMMARY

| Bereich | Änderung |
|---------|-----------|
| DB-Hydration | `fetchHydratedClientProjectsForOrg(orgId)` lädt `client_projects` + pro Projekt `getProjectModels` + `getModelByIdForClientFromSupabase` |
| Mapper | `mapSupabaseModelToClientProjectSummary` in `src/utils/clientProjectHydration.ts` |
| ClientWebApp | Sync-Effect ersetzt; `Project.ownerId`; `createProjectInternal` strict; `feedbackTimerRef` vor Create; `canDeleteProject`; `ProjectsView` Delete-Gate |
| UX | Doppel-Confirm bei „Remove from project“ im Overview entfernt |
| Tests | `clientProjectHydration.test.ts` |
| Governance | `system-invariants`, `auto-review`, `.cursorrules` §27.14 |

Keine Schema-Migration.

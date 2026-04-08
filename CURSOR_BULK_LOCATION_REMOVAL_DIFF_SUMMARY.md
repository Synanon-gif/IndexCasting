# Agency bulk current location removal — diff summary

| File | Purpose | Risk | Tests |
|------|---------|------|--------|
| `src/views/AgencyControllerView.tsx` | Remove bulk location UI/state/handler/modal; territories-only bulk footer; selection hint from uiCopy; extra scroll padding when bulk bar visible | Low — single tab (`MyModelsTab`) | `npm test` |
| `src/services/modelLocationsSupabase.ts` | Remove `bulkUpsertModelLocations` | Low — no remaining callers | `modelLocationsSupabase.test.ts` updated |
| `src/services/__tests__/modelLocationsSupabase.test.ts` | Drop bulk tests | None | Jest |
| `src/constants/uiCopy.ts` | Remove bulk location strings; add `selectForTerritoriesHint` | Low | — |
| `docs/MODEL_SAVE_LOCATION_CONSISTENCY.md` | Document territories-only bulk; note unused RPC | Doc | — |
| `.cursor/rules/system-invariants.mdc` | Product invariants for agency bulk | Doc | — |
| `.cursor/rules/auto-review.mdc` | Blocker + stop condition | Doc | — |
| `.cursorrules` | Guardrail subsection | Doc | — |
| `CURSOR_MODEL_SAVE_*` | Align verify/incident/plan with removal | Doc | — |
| `CURSOR_BULK_LOCATION_REMOVAL_*` | This release artefacts | None | — |

**Delta pass (priority guardrails, no app logic change):** `.cursorrules`, `docs/MODEL_SAVE_LOCATION_CONSISTENCY.md`, `.cursor/rules/system-invariants.mdc`, `.cursor/rules/auto-review.mdc`, refreshed `CURSOR_BULK_LOCATION_REMOVAL_*` verify/report text.

**Not changed:** Auth, admin login path, `get_my_org_context`, paywall, SQL migrations (no new migration), discovery RPC implementation (verified only).

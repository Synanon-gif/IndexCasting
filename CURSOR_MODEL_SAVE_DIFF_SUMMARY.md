# Model save incident — diff summary

| File | Purpose | Risk | Tests |
|------|---------|------|--------|
| `supabase/migrations/20260429_agency_update_model_full_model_scoped_guard.sql` | Model-scoped membership + admin bypass for `agency_update_model_full` | Low — aligns with `save_model_territories`; live-deployed | Manual / verify query on Live DB |
| `src/views/AgencyControllerView.tsx` | RPC error logging; `sex` sanitization; uiCopy for save UI | Low | `npm test` (existing suites) |
| `src/constants/uiCopy.ts` | `modelRoster.modelSave*` strings | Low | — |
| `docs/MODEL_SAVE_LOCATION_CONSISTENCY.md` | Canonical notes: single save vs territories-only agency bulk; unused `bulk_upsert` RPC note | None | — |
| `.cursor/rules/system-invariants.mdc` | Guardrail text for `agency_update_model_full` | Doc only | — |
| `.cursor/rules/auto-review.mdc` | Stop condition: membership parity | Doc only | — |
| `.cursorrules` | Clarify allowed admin membership gate on writes | Doc only | — |
| `CURSOR_MODEL_SAVE_*.md/json` | Incident artefacts | None | — |

**Not changed:** Auth, paywall core, `get_my_org_context`, admin RPC definitions.

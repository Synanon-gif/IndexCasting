# Location Consumer Sweep — Diff Summary

## Code

| File | Change |
|------|--------|
| `src/services/apiService.js` | `getModelsForClient` map: `city: m.effective_city ?? m.city ?? ''` |
| `src/services/modelLocationsSupabase.ts` | Added `mergeEffectiveDisplayCitiesFromRows`, `fetchEffectiveDisplayCitiesForModels` (batch `.in`, priority live>current>agency) |
| `src/services/projectsSupabase.ts` | `fetchHydratedClientProjectsForOrg`: collect all model IDs → batch cities → pass `effectiveDisplayCity` into mapper |
| `src/utils/clientProjectHydration.ts` | `mapSupabaseModelToClientProjectSummary(m, opts?)`; city = override \|\| `m.effective_city` \|\| `m.city` |
| `src/services/__tests__/modelLocationsSupabase.test.ts` | Tests for `mergeEffectiveDisplayCitiesFromRows` |
| `src/utils/__tests__/clientProjectHydration.test.ts` | Tests for override and `effective_city` on model |
| `.cursor/rules/auto-review.mdc` | Review-flag: models-only user-facing city without merge/docs |

## Deliverables (new)

- `CURSOR_LOCATION_CONSUMER_SWEEP_REPORT.md`
- `CURSOR_LOCATION_CONSUMER_SWEEP_DIFF_SUMMARY.md`
- `CURSOR_LOCATION_CONSUMER_SWEEP_VERIFY.md`
- `CURSOR_LOCATION_CONSUMER_SWEEP_PLAN.json`

## Not changed

- AuthContext, paywall, admin core, booking_brief, calendar RLS, invite/claim
- `get_models_near_location`
- SQL migrations / Edge deploy
- Agency roster line (`models.city`)

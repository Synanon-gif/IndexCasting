# Discovery Audit C — Diff Summary

## Changed files

| File | Purpose | Risk |
|------|---------|------|
| `supabase/migrations/20260408_get_models_near_location_dedupe_territory_join.sql` | Near Me: max. eine Resultatzeile pro Model trotz Multi-Territory-JOIN | Low–medium: nur Ergebnismenge/Pagination; Guards unverändert |
| `src/web/ClientWebApp.tsx` | `chest ?? bust` in Discovery-Summary, Legacy-Map; Package `chest` aus `bust` | Low: Display/Summary only |
| `src/services/apiService.js` | `getModelsForClient` mapped `chest` coalesced with `bust` | Low |
| `src/utils/modelFilters.ts` | Agency-side `filterModels` chest range uses `chest ?? bust` | Low |
| `src/services/__tests__/apiService.test.ts` | Regression: chest aus bust wenn chest null | None |
| `src/utils/__tests__/modelFilters.test.ts` | Regression: chest filter mit bust-only row | None |

## Test linkage

- `npm run typecheck`
- `npm run lint`
- `npm test -- --passWithNoTests --ci`

## Deploy

- Migration per Supabase Management API ausgeführt (HTTP 201); Live-Check: `pg_get_functiondef` enthält CTE `deduped`.

## Not changed (explicit)

- AuthContext, Paywall, Admin, Invite/Claim, `calendar_entries` RLS, Booking Brief, sichtbare Bust-Copy.

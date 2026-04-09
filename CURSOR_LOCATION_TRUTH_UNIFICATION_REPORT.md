# Location Truth Unification — Report

## Executive Summary

All user-facing city/location display and scoring now resolve from a single canonical source:
`effective_city = COALESCE(model_locations.city [highest priority: live > current > agency], models.city)`.

Previously, Discovery used `models.city` while Near Me used `model_locations.city` — these could diverge when a model's self-set city differed from the legacy `models.city` value. This is now unified.

## What Was Inconsistent

| Surface | Before | After |
|---|---|---|
| Discovery RPC (`get_discovery_models`) | `models.city` only | `effective_city` via model_locations CTE |
| Discovery city-score (+30) | `models.city` vs `p_client_city` | `COALESCE(effective_city, models.city)` |
| Legacy Discovery (`get_models_by_location`) | Filter: both; Return: `models.city` | Return: `effective_city` added |
| Guest/Package RPC (`get_guest_link_models`) | `models.city` only | `effective_city` column added |
| Near Me RPC (`get_models_near_location`) | Already canonical (model_locations) | Unchanged (already correct) |
| `mapDiscoveryModelToSummary` (ClientWebApp) | `m.city` | `m.effective_city ?? m.city` |
| Package mapper (ClientWebApp) | `m.city` | `m.effective_city ?? m.city` |
| Legacy mapper (ClientWebApp) | `m.city` | `m.effective_city ?? m.city` |
| CustomerSwipeScreen mappers | `m.city` | `m.effective_city ?? m.city` |
| GuestView meta line | `m.city` | `m.effective_city ?? m.city` |
| Agency roster cards | `m.city` | `m.city` (unchanged — agency writes this value) |
| `filterModels` (modelFilters.ts) | `loc?.city \|\| m.city` | Unchanged (already correct) |

## Changed Files

### SQL Migration
- `supabase/migrations/20260409_location_truth_unification.sql` — new
  - `get_discovery_models`: added `effective_locations` CTE + `effective_city` field + city-score uses COALESCE
  - `get_models_by_location`: added `effective_locations` CTE + `effective_city` field
  - `get_guest_link_models`: DROP/CREATE with `effective_city TEXT` in RETURNS TABLE

### TypeScript Types
- `src/services/clientDiscoverySupabase.ts` — `DiscoveryModel.effective_city` added
- `src/services/guestLinksSupabase.ts` — `GuestLinkModel.effective_city` added

### Frontend Mappers
- `src/web/ClientWebApp.tsx` — 3 mappers updated (discovery, legacy, package)
- `src/screens/CustomerSwipeScreen.tsx` — 3 mappers updated (discovery, 2x legacy)
- `src/views/GuestView.tsx` — meta line updated

### Rules/Docs
- `.cursorrules` — §27.4 updated: effective_city as canonical product truth
- `.cursor/rules/system-invariants.mdc` — Display-City-Priorität updated
- `.cursor/rules/auto-review.mdc` — new blocker: effective_city ignored

## Rules/Cursorrules Adjusted

Yes — three files updated:
1. `.cursorrules` §27.4: `effective_city` defined as canonical display city
2. `system-invariants.mdc`: LOCATION SOURCE SYSTEM Display-City-Priorität
3. `auto-review.mdc`: new blocker for mappers ignoring `effective_city`

## Migration/Live-Verify

- Migration deployed: HTTP 201
- Live verified via `pg_get_functiondef` for all 3 RPCs — `effective_city` confirmed present

## Remaining Risks

1. **Agency roster cards**: Still show `models.city` (not `effective_city`). Acceptable because agencies write this value themselves. If a model self-sets a different city via `model_locations`, the agency roster will show the agency-set value, not the model's preferred city. Low-priority enhancement for future.

2. **models.city sync gap**: When a model sets their city via `handleSetCurrentCity` (writes `model_locations` source='current'), `models.city` is NOT updated. This means `models.city` can become stale. With `effective_city`, this is no longer a display issue, but `models.city` remains stale data in the database. Future consideration: trigger or sync mechanism.

3. **Performance**: The `effective_locations` CTE adds a LEFT JOIN to `model_locations` in discovery queries. With the existing index on `(model_id, source)` and at most 3 rows per model, this is lightweight. Monitor via EXPLAIN ANALYZE if needed.

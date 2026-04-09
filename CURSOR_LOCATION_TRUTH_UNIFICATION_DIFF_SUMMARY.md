# Location Truth Unification — Diff Summary

## New Files
- `supabase/migrations/20260409_location_truth_unification.sql`

## Modified Files

### SQL (via migration)
- `get_discovery_models` — effective_locations CTE added; city-score uses COALESCE(effective_city, m.city); effective_city in JSON output
- `get_models_by_location` — effective_locations CTE added; effective_city in JSON output
- `get_guest_link_models` — DROP/CREATE with effective_city TEXT column; correlated subquery for priority resolution

### TypeScript Types
- `src/services/clientDiscoverySupabase.ts` — `effective_city?: string | null` added to `DiscoveryModel`
- `src/services/guestLinksSupabase.ts` — `effective_city?: string | null` added to `GuestLinkModel`

### Frontend Mappers
- `src/web/ClientWebApp.tsx`
  - `mapDiscoveryModelToSummary`: `m.city` → `m.effective_city ?? m.city ?? ''`
  - Legacy mapper (~L866): `m.city` → `m.effective_city ?? m.city ?? ''`
  - Package mapper (~L1555): `m.city` → `m.effective_city ?? m.city ?? ''`
- `src/screens/CustomerSwipeScreen.tsx`
  - `mapDiscoveryModel`: `m.city` → `m.effective_city ?? m.city ?? ''`
  - 2x legacy inline mappers: `m.city` → `(m as any).effective_city ?? m.city ?? ''`
- `src/views/GuestView.tsx`
  - Meta line: `m.city` → `m.effective_city ?? m.city`

### Rules
- `.cursorrules` §27.4 — effective_city defined as canonical product truth
- `.cursor/rules/system-invariants.mdc` — Display-City-Priorität updated
- `.cursor/rules/auto-review.mdc` — new blocker for ignoring effective_city

## Unchanged (by design)
- `get_models_near_location` — already canonical
- `modelFilters.ts` — already uses `loc?.city || m.city`
- `AgencyControllerView.tsx` roster cards — agency sees own `models.city`
- Near Me mapper in ClientWebApp — already uses `m.location_city ?? m.city`
- AuthContext, bootstrapThenLoadProfile, paywall, admin core
- Discovery ranking weights (only city-score source changed, not weight value)

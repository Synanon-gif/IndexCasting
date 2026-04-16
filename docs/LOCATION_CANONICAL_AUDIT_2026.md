# Location canonical audit — frozen inventory (2026)

Single source of truth for product semantics: **live GPS (when shared) > model manual current > agency fallback**, then **`models.city`** for display/filter fallback when no `model_locations` city.

## Tables

| Artifact | Purpose |
|----------|---------|
| `model_locations` (`source` ∈ live, current, agency) | Canonical multi-row location; coords only when `share_approximate_location` and geocoded/GPS |
| `models.city`, `models.country_code`, `models.current_location` | Legacy / mirror; not authoritative for user-facing city when RPCs expose `effective_city` |

## Read RPCs (priority in SQL / DISTINCT ON)

| RPC | Effective city | Near Me / coords |
|-----|----------------|------------------|
| `get_discovery_models` | `DISTINCT ON (model_id)` by source order + `COALESCE(..., m.city)` | N/A |
| `get_models_near_location` | Winning row’s `location_city` | Bbox + haversine; requires lat/lng + share |
| `get_models_by_location` | Legacy list; `p_city` tightened in migration `20260825` | N/A |
| `get_guest_link_models` / shared selection | `effective_city` in payload | N/A |

## Frontend

| Module | Role |
|--------|------|
| [`modelLocationsSupabase.ts`](../src/services/modelLocationsSupabase.ts) | Writes, `fetchEffectiveDisplayCitiesForModels`, `fetchEffectiveApproxLocationsForModels` |
| [`canonicalModelCity.ts`](../src/utils/canonicalModelCity.ts) | Display: `effective_city` → `location_city` → `city` |
| [`modelFilters.ts`](../src/utils/modelFilters.ts) | Agency-side `filterModels` + haversine when model + user coords present |
| [`ClientWebApp.tsx`](../src/web/ClientWebApp.tsx) | Ranked discovery, Near Me RPC, `summaryDisplayCity` |
| [`AgencyControllerView.tsx`](../src/views/AgencyControllerView.tsx) | Roster + package list filters; Near Me user geo + batch model coords |
| [`ModelProfileScreen.tsx`](../src/screens/ModelProfileScreen.tsx) | Canonical `upsertModelLocation`; legacy mirror warn-only |
| [`GuestView.tsx`](../src/views/GuestView.tsx) / [`SharedSelectionView.tsx`](../src/views/SharedSelectionView.tsx) | `canonicalDisplayCityForModel` for display |

## Guest / package parity

- **GuestView:** Uses `canonicalDisplayCityForModel(m)` on guest link models (includes `effective_city` from RPC).
- **SharedSelectionView:** Uses `canonicalDisplayCityForModel({ effective_city, city })` for `cityLine`.

## Residual / intentional limits

- **PostgREST-only discovery** (`getModelsPagedFromSupabase` / swipe legacy): `models.city` best-effort; not upgraded in this pass.
- **Near Me RPC:** Models without shared approximate coordinates do not appear in radius results (privacy).

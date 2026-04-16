# Canonical location system — final audit (April 2026)

## Executive summary

- **Live DB (pre-fix):** `get_models_by_location` matched `20260827` but **did not return `effective_city`** in the JSON row — regression vs `20260409` / `get_discovery_models`. **`p_city` substring** used a subquery over rows with **non-empty city only**, diverging from `COALESCE(el.effective_city, m.city)` when the winning row was GPS-only.
- **Fixes applied:**
  1. Migration **`20260828_get_models_by_location_effective_city_parity.sql`** — deployed and verified (`has_effective_city` in `pg_get_functiondef`).
  2. **`mergeEffectiveDisplayCitiesFromRows`** — winning-row eligibility aligned with SQL `effective_locations` (city **or** shared approx coords); no map entry when winning row has no city (caller uses `models.city`).
  3. **`fetchEffectiveDisplayCitiesForModels`** — selects `lat_approx`, `lng_approx`, `share_approximate_location` for that merge.
- **Tests:** Extended `modelLocationsSupabase.test.ts`, `clientDiscovery.test.ts` (load-more geo parity).
- **Rules:** `.cursor/rules/system-invariants.mdc`, `auto-review.mdc` — minimal parity bullets.

**Final statement:** The canonical location system **IS** consistent and safe across the audited paths **after** `20260828` and the TS merge fix, for **writes**, **ranked discovery**, **hybrid/legacy list RPC**, **Near Me RPC**, **agency roster batch helpers**, and **display helpers** — subject to **residual risks** below.

---

## Phase 1 — Inventory (path → source → artifact)

| Area | Read/write | Source / priority | Artifact |
|------|------------|-------------------|----------|
| DB table | Write/read | live / current / agency rows | `model_locations` |
| DB column fallback | Read | `models.city` | `models` |
| Ranked discovery | Read | `effective_locations` CTE + `COALESCE(..., m.city)` | `get_discovery_models` (`20260826`) |
| Hybrid legacy list | Read | Same + JSON `effective_city` | `get_models_by_location` (`20260828`) |
| Near Me | Read | DISTINCT ON + MAT dedupe | `get_models_near_location` |
| Guest / package | Read | `effective_city` in RPC | `get_guest_link_models` (see migrations) |
| Client service | Read | wraps RPC params | `clientDiscoverySupabase.ts` |
| Client web | Read | ranked + legacy branches | `ClientWebApp.tsx` |
| Agency roster | Read batch | `fetchEffectiveDisplayCitiesForModels`, `fetchEffectiveApproxLocationsForModels` | `AgencyControllerView.tsx` |
| Filters | Client-side | `canonicalDisplayCityForModel`, Haversine | `modelFilters.ts` |
| Display helper | — | `effective_city` → `location_city` → `city` | `canonicalModelCity.ts` |
| Consent + GPS | Agency Near Me | AsyncStorage / localStorage + `navigator.geolocation` | `useNearMeClientLocation.ts` |
| Model self-serve | Write | `upsert_model_location` RPC | `modelLocationsSupabase.upsertModelLocation` |
| Model profile | Read after write | `getModelLocation` | `ModelProfileScreen.tsx` |

---

## Phase 2 — Last-change audit (A–E)

### A. `get_models_by_location`

- **Before:** No `effective_city` in SELECT; substring branch used “best row with non-empty city”.
- **After 20260828:** `effective_locations` CTE matches discovery; output includes `effective_city`; substring uses `COALESCE(el.effective_city, m.city, '')`.

### B. Discovery load more

- **Code:** `ClientWebApp` passes the same `city`, `clientCity` (`userCity`), and geocode spread on initial load and in the load-more effect.
- **Risk:** Session `p_exclude_ids` + cursor can still produce sparse pages — product expectation, not a location bug.

### C. Agency Nearby + `mergeEffectiveApproxCoordsFromRows`

- Priority matches server ordering; synthetic `model_location` in `modelsWithLocPin` feeds `filterModels`.

### D. `canonicalDisplayCityForModel`

- Unchanged contract; roster relies on batch map + `m.city` fallback when GPS-only wins.

### E. `useNearMeClientLocation`

- `consentHydrated` gates prompt; no race with immediate geolocation before storage read.
- **Residual:** Position fetched once per mount while coords non-null; no continuous tracking (by design).

---

## Phase 3–6 — Priority, UI, backend, ranking

- **Canonical order:** live → current → agency → `models.city` for display when winning row has no city label.
- **Ranking:** Discovery SQL applies label tier (+1000) vs proximity tier (+500); agency `filterModels` does not sort by distance (subset filter only) — intentional difference vs client Near Me RPC.

---

## Phase 8 — Staleness

- **ModelProfileScreen:** After `upsertModelLocation`, calls `getModelLocation` and updates local state.
- **Agency roster:** `useEffect([models])` refetches display cities; Near Me coords refetch when `filters.nearby` and booker lat/lng set. In-place mutation of `models` without reference change could skip effects — standard React; roster loads typically replace array.
- **Discovery:** Cursor reset when filters change (`setDiscoveryCursor(null)` in main load effect).

---

## Phase 9 — Tests added/updated

- `mergeEffectiveDisplayCitiesFromRows`: GPS-only winner → no map entry; empty live + current city → current wins.
- `getDiscoveryModels`: cursor page preserves `p_search_lat` / `p_search_lng` / `p_city_radius_km`.

---

## Phase 10 — Manual QA checklist

Each row: **Steps** | **Source of truth** | **Display** | **Filter** | **Ranking**

1. **Model + GPS live (shared)**  
   Set live location with share on. | `model_locations.live` | Card shows city from live row or `models.city` if empty. | City filter uses effective + `m.city` fallback; Near Me uses lat/lng. | N/A on roster; discovery uses distance tier when geocoded city search.

2. **Model + manual current, no GPS**  
   | `current` row | Same | Substring on COALESCE effective, m.city | —

3. **Model + agency fallback only**  
   | `agency` row | Same | — | —

4. **No-account model**  
   Agency sets agency row. | `agency` | Same | —

5. **Stale `models.city`**  
   Live/current has different city. | Winning row wins for label where set; else `m.city`. | Must not show only stale `m.city` when RPC returns `effective_city`.

6. **Client exact city search**  
   Ranked path: country + city + optional pin. | `get_discovery_models` | Labels from RPC `effective_city`. | `p_city` substring + optional radius OR.

7. **Client Near Me**  
   | `get_models_near_location` | `location_city` / distance | Radius server-side | Sorted by distance.

8. **Discovery page 1 vs load more**  
   Scroll to trigger load more. | Same filters as page 1 | No duplicate semantics change | Keyset consistent.

9. **Agency roster Nearby**  
   Enable Nearby, accept consent. | Batch approx coords | Haversine in `filterModels` | Not distance-sorted list.

10. **Guest / package**  
    Open guest link. | Guest RPC | `canonicalDisplayCityForModel` | Guest rules unchanged.

11. **Consent denied → granted**  
    Deny Nearby → toggle on again. | Hook re-prompts after decline path | Coords only after accept.

12. **After location update**  
    Model saves city/GPS. | DB row | Profile badge + roster after reload/refetch | Discovery on next fetch.

---

## Phase 11 — Rule updates

See `system-invariants.mdc` (UI-Pflichten) and `auto-review.mdc` (Location: `get_models_by_location` JSON drift).

---

## Residual risks

- **Agency roster** does not sort by distance (filter-only).
- **Legacy PostgREST** swipe path (`getModelsPagedFromSupabase`) may still use `models.city` for filter — documented as legacy in rules.
- **Multi-org / cache** edge cases outside location scope.

---

## Files touched (implementation)

- `supabase/migrations/20260828_get_models_by_location_effective_city_parity.sql` (new, deployed)
- `src/services/modelLocationsSupabase.ts`
- `src/services/__tests__/modelLocationsSupabase.test.ts`
- `src/services/__tests__/clientDiscovery.test.ts`
- `.cursor/rules/system-invariants.mdc`
- `.cursor/rules/auto-review.mdc`
- `docs/CANONICAL_LOCATION_FINAL_AUDIT_2026.md` (this file)

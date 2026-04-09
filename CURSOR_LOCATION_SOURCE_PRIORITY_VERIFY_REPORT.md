# Location Source Priority Verify — Report

**Date:** 2026-05-18
**Status:** LOCATION SOURCE PRIORITY DRIFT FIXED

---

## Executive Summary

End-to-end verification of the canonical location source priority `live > current > agency` across all relevant SQL RPCs, TypeScript services, UI components, and filter/display paths. One display-level drift was found and fixed; all critical database-layer paths were confirmed correct via live-DB verification.

---

## 1. Live-DB Verification

### `upsert_model_location` — CORRECT
- `ON CONFLICT (model_id, source)` — structural isolation per source
- Auth-Split: `live`/`current` → model user only; `agency` → agency org member/booker only; Admin bypass in both
- `SET row_security TO off` with 3-layer internal guards
- GPS preservation: agency writes use geocoded coords directly; model writes respect `p_share_approximate_location`

### `get_models_near_location` — CORRECT
- `DISTINCT ON (ml.model_id)` with `ORDER BY ... CASE ml.source WHEN 'live' THEN 0 WHEN 'current' THEN 1 WHEN 'agency' THEN 2 END ASC`
- Auth guards: `auth.uid()` + `can_access_platform()`
- Returns `location_source` in result set for transparency

### `delete_model_location_source` — CORRECT
- `p_source IS NULL` deletes only `live` + `current`; agency row preserved
- Auth-Split: `live`/`current` → model user; `agency` → agency member
- Admin bypass via `is_current_user_admin()`

---

## 2. TypeScript Service Verification

### `modelLocationsSupabase.ts` — CORRECT
- `locationSourcePriority`: live=2, current=1, agency=0
- `getAllModelLocations`: sorts descending by priority → live first
- `getModelLocation`: returns `all[0]` → highest priority
- `upsertModelLocation`: defaults to `'current'`, passes `p_source` correctly

---

## 3. Scenario Verification (P2)

| # | Scenario | Expected | Verified |
|---|----------|----------|----------|
| 1 | Model has live + current + agency | Effective = live | ✅ `DISTINCT ON` picks live (priority 0=lowest sort) |
| 2 | Model has current + agency, no live | Effective = current | ✅ current (1) sorts before agency (2) |
| 3 | Model has only agency | Effective = agency | ✅ Only row, returned as-is |
| 4 | Agency updates city while live/current exist | Agency row updates, effective remains live/current | ✅ `ON CONFLICT (model_id, source)` — agency write goes to `(model_id, 'agency')`, never touches live/current rows |
| 5 | Removing live | Fallback = current if present, else agency | ✅ `delete_model_location_source('live')` removes only live row; `getModelLocation` re-sorts remaining |
| 6 | Removing current (no live) | Fallback = agency | ✅ Same mechanism as scenario 5 |
| 7 | Nearby / city filtering | Must not prefer agency when live/current exists | ✅ `get_models_near_location` DISTINCT ON guarantees; `filterModels` uses `haversineKm` on `loc.lat_approx/lng_approx` from highest-priority source |

---

## 4. Drift Found & Fixed

### D3: `modelFilters.ts` displayCity — FIXED

**Before:** `(m.city || loc?.city || '').trim()` — `models.city` took priority over `model_locations.city`
**After:** `(loc?.city || m.city || '').trim()` — `model_locations.city` (highest source priority) now takes precedence

**Impact:** Display-only. The GPS-based filtering was always correct (uses `loc.lat_approx/lng_approx`). Only the text-based city substring fallback and city display label were affected.

### D2: ClientWebApp City-Fallback — NO FIX NEEDED

Discovery models from `get_discovery_models` don't carry `model_locations` data. The text fallback `(m.city || '').includes(userCity)` is the only available option. GPS-based Near-Me filtering correctly uses `get_models_near_location` with full priority resolution.

### D4: `get_discovery_models` m.city Score-Boost — NO FIX NEEDED

`m.city` is used for a lightweight same-city heuristic boost in discovery ranking. This is intentional flavor, not a priority violation — Near-Me geo-filtering uses the authoritative `model_locations`-based RPC.

### D1: Conflicting `upsert_model_location` definitions in repo — NO FIX NEEDED

Multiple SQL files define `upsert_model_location` (`20260406_location_multirow_priority.sql` vs `20260406_location_source_v2.sql`). Live-DB verification confirms the correct multirow version is deployed. Root SQL files are historical references; migrations run alphabetically and the correct version won.

---

## 5. Rules & Guardrails Added

1. **`.cursorrules` §27.4:** Updated "Stadt" bullet to specify `loc?.city || m.city` priority when `model_locations` data is available
2. **`auto-review.mdc`:** Added stop-condition for Display-City-Priority drift (`m.city || loc?.city` where `model_locations` available → Blocker)
3. **`system-invariants.mdc`:** Added Display-City-Priorität rule in UI-Pflichten section

---

## 6. Components Verified (No Changes Needed)

| Component | Status |
|-----------|--------|
| `get_models_near_location` (Live) | ✅ DISTINCT ON + source priority |
| `upsert_model_location` (Live) | ✅ ON CONFLICT (model_id, source) + Auth-Split |
| `delete_model_location_source` (Live) | ✅ Auth-Split + agency preservation |
| `getModelLocation` / `getAllModelLocations` (TS) | ✅ Sort by priority |
| `ModelProfileScreen` badges | ✅ Uses `getModelLocation` (highest priority) |
| `AgencyControllerView` save | ✅ Uses `upsertModelLocation(..., 'agency')` |
| `ClientWebApp` Near-Me mapping | ✅ `location_city ?? m.city` |
| `ClientWebApp` city text fallback | ✅ Acceptable: no `model_locations` in discovery data |
| `get_discovery_models` city boost | ✅ Intentional heuristic, not priority violation |

---

## 7. Explicitly NOT Changed

- No SQL migrations created (live-DB already correct)
- No changes to `get_models_near_location`, `upsert_model_location`, or `delete_model_location_source`
- No changes to `ClientWebApp.tsx`
- No changes to `ModelProfileScreen.tsx` or `AgencyControllerView.tsx`
- No changes to AuthContext, Login, Admin, Paywall, or Booking flows

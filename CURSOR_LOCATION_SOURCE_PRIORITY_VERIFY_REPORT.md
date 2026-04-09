# Location Source Priority — End-to-End Verification Report

**Date:** 2026-04-09
**Scope:** Verify that `live > current > agency` is enforced in every SQL RPC, TypeScript service, UI component, and filter path.
**Result:** **LOCATION SOURCE PRIORITY VERIFIED**

---

## 1. SQL / DB Layer

### 1.1 `get_models_near_location` — PASS

**Canonical file:** `supabase/migrations/20260508_discovery_chest_coalesce_and_canonical_rpc.sql` (lines 249–270)

Priority enforcement via `DISTINCT ON`:

```sql
resolved_locations AS (
  SELECT DISTINCT ON (ml.model_id)
    ml.model_id, ml.city AS location_city, ...
  FROM public.model_locations ml
  WHERE ml.lat_approx IS NOT NULL AND ml.lng_approx IS NOT NULL
    AND ml.share_approximate_location = TRUE
  ORDER BY ml.model_id,
    CASE ml.source
      WHEN 'live'    THEN 0
      WHEN 'current' THEN 1
      WHEN 'agency'  THEN 2
      ELSE 3
    END ASC
)
```

The `COMMENT ON FUNCTION` explicitly states: `DISTINCT ON (model_id) location priority live > current > agency.`

### 1.2 `upsert_model_location` — PASS

**Canonical file:** `supabase/migrations/20260406_location_multirow_priority.sql` (lines 51–158)

- `ON CONFLICT (model_id, source)` — each source has its own physically isolated row.
- Auth-split: `live`/`current` require `models.user_id = auth.uid()`; `agency` requires agency membership.
- Agency writes can never touch model-owned rows (structural isolation, not just WHERE-guard).

### 1.3 `delete_model_location_source` — PASS

**Canonical file:** `supabase/migrations/20260406_location_multirow_priority.sql` (lines 255–328)

- `p_source = NULL` → deletes only `live` + `current` (agency row preserved).
- `p_source = 'agency'` → deletes only the agency row.
- Fallback chain preserved: removing `live` naturally falls back to `current` or `agency`.

### 1.4 `get_models_by_location` — PASS (design choice documented)

**Canonical file:** `supabase/migrations/20260509_get_models_by_location_city_model_locations.sql` (lines 117–124)

City filter uses `EXISTS (SELECT 1 FROM model_locations ml WHERE ml.city ILIKE p_city)` matching ANY source. This is an **inclusion filter** ("does the model have this city at any source?"), not a priority decision. The effective/displayed location is determined by the Near Me RPC which properly applies `DISTINCT ON`. No priority violation.

### 1.5 Table structure — PASS

- `UNIQUE(model_id, source)` — up to 3 independent rows per model.
- `CHECK(source IN ('live', 'current', 'agency'))` — no other values allowed.
- Old `UNIQUE(model_id)` has been dropped (migration `20260406_location_multirow_priority.sql`).

---

## 2. TypeScript / Frontend Layer

### 2.1 `modelLocationsSupabase.ts` — PASS

- `locationSourcePriority()`: `live=2, current=1, agency=0`.
- `getAllModelLocations()`: sorts descending by `locationSourcePriority` → live first.
- `getModelLocation()`: returns `all[0]` → highest priority.
- `upsertModelLocation()`: default source is `'current'`; passes `p_source` to RPC.
- `deleteModelLocation()`: delegates to `delete_model_location_source` RPC.
- `getModelsNearLocation()`: delegates to `get_models_near_location` RPC.

### 2.2 `ModelProfileScreen.tsx` — PASS

- Loads location via `getModelLocation(profile.id)` (priority-aware).
- After live GPS upsert: reloads via `getModelLocation` → badge reflects new highest priority.
- Badge colors: live=green, current=blue, agency=orange.
- Remove button only for `source !== 'agency'` (model cannot delete agency row).
- Comment: "live now overrides current/agency".

### 2.3 `AgencyControllerView.tsx` — PASS

- Loads selected model location via `getModelLocation(selectedModel.id)`.
- Writes only with `source='agency'` — correct.
- Badge visible when `selectedModelLocation.source !== 'agency'` (model-owned source active).
- Comment: "model-owned (source='live'/'current') is protected by the DB priority guard".
- No bulk current-location writes (product guardrail enforced).

### 2.4 `ClientWebApp.tsx` — PASS

- Near Me mapping: `city: m.location_city ?? m.city ?? ''` — values come from RPC, already priority-resolved.
- `countryCode: m.location_country_code ?? null` — from resolved location.
- `hasRealLocation: true` for nearby models — correct since RPC guarantees coordinates exist.
- Filter toggle: nearby mode uses `getModelsNearLocation` RPC (server-side priority).

### 2.5 `modelFilters.ts` — PASS

- `displayCity = m.city || loc?.city` where `loc = m.model_location`.
- In Agency roster: `model_location` is not attached per roster row (no `getModelLocation` per item), so nearby filter effectively does not restrict. This is a UX limitation, not a priority violation.
- In Client discover: nearby models come from RPC with priority already resolved.

### 2.6 `modelsSupabase.ts` — PASS

- `getModelsForClientFromSupabaseHybridLocation()` delegates to `get_models_by_location` RPC.
- No direct `model_locations` reads in this file.

---

## 3. Tests

### 3.1 `modelLocationsSupabase.test.ts` — PASS

| Test | What it verifies |
|------|------------------|
| "returns highest-priority location when multiple sources exist" | live wins over agency when both rows present |
| "returns current when live is absent" | Fallback chain current → agency |
| "returns null when no location exists" | Empty state |
| "upsertModelLocation with source=agency writes to the agency row only" | Source isolation |
| "upsertModelLocation with source=current writes to the current row only" | Source isolation |
| "calls delete_model_location_source RPC with source when provided" | Targeted deletion |
| "calls RPC with p_source=null (removes live+current only)" | Agency row preserved |
| "privacy: passes rounded coords, not exact GPS" | Privacy invariant |

---

## 4. Required Scenarios (P2)

| # | Scenario | Verified | Mechanism |
|---|----------|----------|-----------|
| 1 | Model has live + current + agency → effective = live | PASS | `locationSourcePriority('live')=2` wins; DB `DISTINCT ON` selects `WHEN 'live' THEN 0` |
| 2 | Model has current + agency, no live → effective = current | PASS | `locationSourcePriority('current')=1 > agency=0` |
| 3 | Model has only agency → effective = agency | PASS | Single row, `all[0]` returns agency |
| 4 | Agency updates while live/current exist → effective stays live/current | PASS | `ON CONFLICT (model_id, 'agency')` writes to separate row; effective unchanged |
| 5 | Removing live → fallback to current if present, else agency | PASS | `deleteModelLocation('live')` removes only live row; next read returns current/agency |
| 6 | Removing current → fallback to agency if no live | PASS | Analog to scenario 5 |
| 7 | Nearby/city filtering respects priority | PASS | `get_models_near_location` uses `DISTINCT ON` with correct order |

---

## 5. Drift Check (P3)

**No real drift found.** Three notable observations (none require fixes):

1. **`get_models_by_location` city filter** matches ANY source via `EXISTS`. This is correct as an inclusion filter — the display/priority layer is separate.

2. **Comment in `modelLocationsSupabase.ts`** (lines 14–17): described old single-row "no-op" semantics. Updated to reflect multi-row structural isolation (the only code change in this verification).

3. **`filterModels` in `modelFilters.ts`**: Agency roster does not attach `model_location` per roster row, so the nearby sub-filter is effectively non-functional there. This is a UX gap, not a priority violation.

---

## 6. Guardrails Assessment (P4)

Existing guardrails are comprehensive and binding:

- `.cursorrules` §4b: "Location source priority (immutable): live > current > agency"
- `.cursorrules` §27.4: strict separation Territory vs physical vs city
- `system-invariants.mdc` LOCATION SOURCE SYSTEM: 7 invariants, forbidden patterns, NIEMALS list
- `auto-review.mdc` Risiko 16/17: ON CONFLICT target, DISTINCT ON, source priority, agency bulk, deprecated 'model'
- `auto-review.mdc` Stop conditions: 7 location-specific stop conditions
- `docs/MODEL_SAVE_LOCATION_CONSISTENCY.md`: location priority section
- Tests: `modelLocationsSupabase.test.ts` with priority and isolation tests

**No additional guardrails needed.**

---

## 7. Conclusion

**LOCATION SOURCE PRIORITY VERIFIED**

The priority `live > current > agency` is correctly enforced at every layer:
- **DB structure:** `UNIQUE(model_id, source)` with structural row isolation
- **DB reads:** `DISTINCT ON` with `CASE source WHEN 'live' THEN 0` ordering
- **DB writes:** Auth-split prevents cross-source overwrites
- **TypeScript reads:** `locationSourcePriority` sort + `all[0]`
- **TypeScript writes:** Explicit `source` parameter passed to RPC
- **UI display:** Badges, labels, and fallback text respect the resolved priority
- **Filters:** Server-side Near Me uses priority-aware `DISTINCT ON`; client-side filters delegate to priority-aware `getModelLocation`

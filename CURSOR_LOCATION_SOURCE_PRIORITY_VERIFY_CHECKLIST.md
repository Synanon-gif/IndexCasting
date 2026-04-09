# Location Source Priority — Verification Checklist

**Date:** 2026-04-09
**Invariant:** `live > current > agency` (immutable)

---

## Scenario Verification

| # | Scenario | Expected | Actual | Status |
|---|----------|----------|--------|--------|
| S1 | Model has live + current + agency | effective = live | `locationSourcePriority('live')=2` wins sort; DB `DISTINCT ON` selects `WHEN 'live' THEN 0` | PASS |
| S2 | Model has current + agency, no live | effective = current | `locationSourcePriority('current')=1 > agency=0` | PASS |
| S3 | Model has only agency | effective = agency | Single row, `all[0]` returns agency | PASS |
| S4 | Agency updates city while live/current exist | effective stays live/current | `ON CONFLICT (model_id, 'agency')` writes separate row; live/current untouched | PASS |
| S5 | Removing live | fallback to current, then agency | `deleteModelLocation('live')` removes only live row; priority re-resolves | PASS |
| S6 | Removing current (no live) | fallback to agency | Analog to S5 | PASS |
| S7 | Nearby/city filtering | must not prefer agency over live/current | `get_models_near_location` uses `DISTINCT ON` with `CASE source WHEN 'live' THEN 0` | PASS |

---

## SQL Layer Checks

| Check | File | Status |
|-------|------|--------|
| `get_models_near_location` has `DISTINCT ON (model_id)` with source priority ORDER BY | `20260508_discovery_chest_coalesce_and_canonical_rpc.sql:249-270` | PASS |
| `upsert_model_location` uses `ON CONFLICT (model_id, source)` | `20260406_location_multirow_priority.sql:51-158` | PASS |
| `upsert_model_location` has auth-split (live/current=model, agency=agency-member) | `20260406_location_multirow_priority.sql:80-110` | PASS |
| `delete_model_location_source` preserves agency row on `p_source=NULL` | `20260406_location_multirow_priority.sql:255-328` | PASS |
| `model_locations` has `UNIQUE(model_id, source)` | `20260406_location_multirow_priority.sql:35-40` | PASS |
| `model_locations` has `CHECK(source IN ('live','current','agency'))` | `20260406_location_source_v2.sql:29-41` | PASS |
| `get_models_by_location` city filter is inclusion-only (no priority) | `20260509_get_models_by_location_city_model_locations.sql:117-124` | PASS (documented) |
| No SQL path inverts priority order | Global search | PASS |

---

## TypeScript Layer Checks

| Check | File | Status |
|-------|------|--------|
| `locationSourcePriority`: live=2, current=1, agency=0 | `modelLocationsSupabase.ts:42-45` | PASS |
| `getAllModelLocations` sorts descending by priority | `modelLocationsSupabase.ts:170-171` | PASS |
| `getModelLocation` returns `all[0]` (highest priority) | `modelLocationsSupabase.ts:183-185` | PASS |
| `upsertModelLocation` default source is `'current'` | `modelLocationsSupabase.ts:123` | PASS |
| `deleteModelLocation` delegates to RPC with source param | `modelLocationsSupabase.ts:197-216` | PASS |
| `getModelsNearLocation` delegates to priority-aware RPC | `modelLocationsSupabase.ts:234-280` | PASS |

---

## UI Layer Checks

| Check | File | Status |
|-------|------|--------|
| ModelProfileScreen badge uses `getModelLocation` (priority-aware) | `ModelProfileScreen.tsx:424-426, 659-688` | PASS |
| ModelProfileScreen reload after upsert uses `getModelLocation` | `ModelProfileScreen.tsx:197-200` | PASS |
| AgencyControllerView loads via `getModelLocation` | `AgencyControllerView.tsx:2079-2080` | PASS |
| AgencyControllerView writes only `source='agency'` | `AgencyControllerView.tsx:2554, 2912` | PASS |
| AgencyControllerView badge shows when model-owned source active | `AgencyControllerView.tsx:2999-3016` | PASS |
| ClientWebApp Near Me uses `getModelsNearLocation` RPC | `ClientWebApp.tsx:1000-1009` | PASS |
| ClientWebApp Near Me mapping uses RPC-resolved city | `ClientWebApp.tsx:1013, 1027-1028` | PASS |
| No UI path prefers agency over live/current | Global search | PASS |

---

## Test Checks

| Check | File | Status |
|-------|------|--------|
| Priority test: live wins over agency | `modelLocationsSupabase.test.ts:129-150` | PASS |
| Fallback test: current when live absent | `modelLocationsSupabase.test.ts:152-166` | PASS |
| Source isolation: agency write to own row | `modelLocationsSupabase.test.ts:298-308` | PASS |
| Source isolation: current write to own row | `modelLocationsSupabase.test.ts:310-319` | PASS |
| Delete: p_source=null removes only live+current | `modelLocationsSupabase.test.ts:209-216` | PASS |

---

## Guardrail Checks

| Check | File | Status |
|-------|------|--------|
| `.cursorrules` §4b states immutable priority | `.cursorrules:124-129` | PASS |
| `.cursorrules` §27.4 separates Territory vs physical vs city | `.cursorrules:574-579` | PASS |
| `system-invariants.mdc` LOCATION SOURCE SYSTEM has 7 invariants | `system-invariants.mdc:497-605` | PASS |
| `auto-review.mdc` has Risiko 16/17 + Stop conditions | `auto-review.mdc:51-59, 169-175` | PASS |
| `docs/MODEL_SAVE_LOCATION_CONSISTENCY.md` documents priority | `docs/MODEL_SAVE_LOCATION_CONSISTENCY.md:25-32` | PASS |

---

## Summary

- **Total checks:** 35
- **Passed:** 35
- **Failed:** 0
- **Result:** LOCATION SOURCE PRIORITY VERIFIED

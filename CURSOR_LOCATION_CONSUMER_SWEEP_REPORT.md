# Location Consumer Sweep — Report

## 1. Executive Summary

After the canonical `effective_city` migration, a system-wide consumer audit was performed. **Two product-facing drift paths** were fixed: `getModelsForClient` in `apiService.js` (hybrid RPC already returned `effective_city` but the mapper used `m.city` only), and **client project hydration** (`fetchHydratedClientProjectsForOrg`), which loaded models from `models` only and showed legacy `city` in project lists. **GDPR export, Edge Functions, and Admin** do not require city alignment changes; several paths are **documented as intentional raw/legacy**.

## 2. Consumer Categories (Inventory)

### A. User-facing UI

| Location | Source | Canonical? | Notes |
|----------|--------|------------|--------|
| ClientWebApp Discover/Near Me/Package | `effective_city` / `location_city` | Yes | Prior work |
| CustomerSwipeScreen | `effective_city ?? city` | Yes | Prior work |
| GuestView | `effective_city ?? city` | Yes | Prior work |
| ModelProfileScreen | `getModelLocation` + `models.city` (base) | Mixed | Model settings — documented |
| AgencyControllerView roster | `models.city` | Legacy | Agency mirror — **Leave** |
| AgencyControllerView badge | `getModelLocation` | Yes | — |
| **apiService.getModelsForClient** | Was `m.city` only | **Fixed** | Now `effective_city ?? city` |
| **Client project lists** (`fetchHydratedClientProjectsForOrg`) | Was `models.city` only | **Fixed** | Batch `model_locations` + mapper opts |

### B. Export / CSV / Download

| Location | Finding |
|----------|---------|
| `dataExportService.ts` | No city logic; shapes `export_user_data` RPC JSON. |
| `gdprComplianceSupabase.ts` | Export is server RPC raw payload. |

**Policy (Document):** GDPR export may contain separate `models` and `model_locations` rows. Do not silently merge to a synthetic `effective_city` without product/legal review. UI consistency is not guaranteed in raw ZIP/JSON.

### C. Admin / internal

| Location | Finding |
|----------|---------|
| `adminSupabase.ts` | No model-city display fields in scan. |
| `AdminDashboard.tsx` | Org/account focus; no model city column identified. |

**Policy:** Future admin model tables should prefer `effective_city` or joined locations for ops parity.

### D. Analytics / tracking / logs

| Location | Finding |
|----------|---------|
| `logAction` | Org-scoped; no standard model-city dimension. |

**Policy:** If future events include city, name field `effective_city` or `legacy_models_city` explicitly.

### E. Edge Functions

All `supabase/functions/**/*.ts`: **no `city` string usage** (grep). No deploy for this sweep.

### F. Mobile / alternate screens

SharedSelectionView: no city on cards (OK). App.tsx: `window.location` only (irrelevant).

### G. Legacy / hidden

| Location | Decision |
|----------|----------|
| `mockData.js` | Demo data — **Leave** |
| `localApi.ts` | Legacy local API `city: m.city` — **Document** as non-canonical path |

### H. Helpers / mappers

| Location | Decision |
|----------|----------|
| `mapDiscoveryModelToSummary` etc. | Already canonical from prior work |
| `mapSupabaseModelToClientProjectSummary` | **Fixed** — opts + `m.effective_city` |
| `filterModels` (`modelFilters.ts`) | **Leave** — `loc?.city \|\| m.city` correct when pin present |

## 3. What Still Drifted (before fixes)

1. **apiService.js**: Hybrid list from `get_models_by_location` included `effective_city` in JSON but UI consumers got `city: m.city` only.
2. **Project hydration**: Same model could show different city in Discover vs project overview.

## 4. What Was Fixed

- `apiService.js`: `city: m.effective_city ?? m.city ?? ''`
- `modelLocationsSupabase.ts`: `mergeEffectiveDisplayCitiesFromRows`, `fetchEffectiveDisplayCitiesForModels` (chunked `.in()`)
- `clientProjectHydration.ts`: `mapSupabaseModelToClientProjectSummary(m, opts?)` with priority override + `m.effective_city`
- `projectsSupabase.ts`: one batch city map for all project model IDs per org fetch

## 5. What Was Documented Only (no code change)

- GDPR / raw export semantics
- Agency roster `models.city` as agency-written mirror
- `localApi.ts` legacy path
- mockData

## 6. Files Changed

- `src/services/modelLocationsSupabase.ts`
- `src/services/projectsSupabase.ts`
- `src/utils/clientProjectHydration.ts`
- `src/services/apiService.js`
- `src/services/__tests__/modelLocationsSupabase.test.ts`
- `src/utils/__tests__/clientProjectHydration.test.ts`
- `.cursor/rules/auto-review.mdc`
- Root: `CURSOR_LOCATION_CONSUMER_SWEEP_*.md` + `.json`

## 7. Rules Adjusted

Yes — one **review-flag** line in `auto-review.mdc` (models-only product city without merge/documentation).

## 8. Migrations / Deploy

**None.** Batch read uses existing `model_locations` + RLS.

## 9. Quality Gates

Run: `npm run typecheck`, `npm run lint`, `npm test -- --passWithNoTests --ci` (record results in VERIFY).

## 10. Remaining Risks

- **Agency roster** still shows `models.city` (intentional).
- **Very large orgs** with huge project membership: multiple chunked `model_locations` queries — acceptable vs N× `getModelLocation`.
- **RLS**: If a client cannot read a model’s `model_locations` row, fallback remains `models.city` (correct degrade).

---

**LOCATION CONSUMER SWEEP COMPLETE — MINOR RISKS REMAIN**

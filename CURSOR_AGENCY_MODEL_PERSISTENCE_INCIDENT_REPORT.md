# Agency Model Persistence Incident — Report

**Date:** 2026-04-09
**Status:** AGENCY MODEL PERSISTENCE INCIDENT FIXED SAFELY

## Executive Summary

Five root causes were identified and fixed for the Agency-Model-Persistence-Incident. All fixes are conservative, minimal-invasive, and verified through automated testing (typecheck, lint, 904 tests). The send-invite Edge Function CORS fix was deployed and verified on production. No SQL migrations were required — the live DB schema is correct.

## Root Causes Found

### RC-1: `models.organization_id` Column Does Not Exist (HIGH — Console Noise + Audit Gap)

**Evidence:** Live DB query confirmed `models.organization_id` does not exist. Two fire-and-forget audit queries in `modelPhotosSupabase.ts` (uploadModelPhoto line 486, uploadPrivateModelPhoto line 611) selected this non-existent column, producing PostgREST 400 errors. `logAction` received `undefined` as orgId, `assertOrgContext` logged errors, and audit entries were silently skipped.

**Fix:** Added `resolveOrgIdForModel()` helper that resolves org via `models.agency_id` -> `organizations` JOIN (type='agency'). Both audit blocks now use this helper.

### RC-2: send-invite CORS Headers Missing on POST Responses (BLOCKER)

**Evidence:** Edge Function returned CORS headers only on OPTIONS preflight (`*`), but all POST/error responses lacked `Access-Control-Allow-Origin`. Browser blocked response body, making all invite operations appear as CORS errors.

**Fix:** Added `getCorsHeaders(req)` with origin allowlist (index-casting.com, www.index-casting.com, indexcasting.com) and `jsonResponse()` helper. Every response now includes CORS headers. Deployed and verified: preflight returns 200 with echoed origin, POST error 401 includes full CORS headers.

### RC-3: buildEditState Stale Dependency (MEDIUM — Location Persistence)

**Evidence:** `useEffect` in AgencyControllerView.tsx watched only `[selectedModel?.id]`. After saving the same model (ID unchanged), `buildEditState` was not re-invoked. Form showed pre-save values for city, country_code, and other fields.

**Fix:** Added `selectedModel?.updated_at` to the dependency array. After save, `updated_at` changes trigger fresh `buildEditState`.

### RC-4: importModelAndMerge INSERT `.single()` — 406 Risk (MEDIUM — Defensive)

**Evidence:** `supabase.from('models').insert(payload).select('*').single()` can return PGRST116/406 if RLS blocks the SELECT after a successful INSERT. When this happens, `importModelAndMerge` returns `null`, and `handleAddModel` aborts — photos are never uploaded.

**Fix:** Changed to `.select('id').maybeSingle()` with explicit null guard and error message. The model ID is still correctly extracted for subsequent operations.

### RC-5: file_size_bytes Missing in upsertPhotosForModel (LOW — Storage Accounting)

**Evidence:** `handleAddModel` collected only URLs from `uploadModelPhoto` results, discarding `fileSizeBytes`. `upsertPhotosForModel` payload omitted `file_size_bytes`, resulting in DB default `0`. `deletePhoto` → `decrementStorage` would then undercount freed space.

**Fix:** `upsertPhotosForModel` now includes `file_size_bytes` in payload. `handleAddModel` passes full `{ url, fileSizeBytes }` objects instead of just URL strings.

## False Alarms

| Symptom | Assessment |
|---|---|
| `can_access_platform 401` before login | Expected startup noise — no fix needed |
| `agency_find_model_by_email 406` | RPC uses `.maybeSingle()` correctly; likely misattributed to INSERT `.single()` (RC-4) |
| Checkbox unchecked after reopen | Intentionally transient; 60-min audit window handles re-upload; does NOT hide saved images |

## Live Schema Verification

| Item | Status |
|---|---|
| `models.organization_id` | DOES NOT EXIST — confirmed |
| `model_photos` (13 columns) | All expected columns present |
| `model_locations` unique constraint | `UNIQUE(model_id, source)` — correct multi-row |
| `upsert_model_location` | Correct: `ON CONFLICT(model_id, source)`, auth-split |
| `agency_find_model_by_email` | Correct: SETOF + LIMIT 1 |
| `model_photos` RLS | Agency INSERT/SELECT via `models.agency_id` -> org membership |

## No Regressions

- AuthContext / bootstrapThenLoadProfile: NOT TOUCHED
- Paywall / can_access_platform: NOT TOUCHED
- Admin routing: NOT TOUCHED
- Discovery / Near-Me / Location priority: NOT TOUCHED
- Package / Shared / Client-Project flows: NOT TOUCHED
- Booking / Calendar: NOT TOUCHED
- RLS architecture: NOT TOUCHED

## Quality Gates

- `npm run typecheck`: 0 errors
- `npm run lint`: 0 errors (4 pre-existing warnings)
- `npm test -- --passWithNoTests --ci`: 82 suites, 904 tests passed
- send-invite CORS: deployed + preflight verified + POST error verified

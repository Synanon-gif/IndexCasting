# Agency Model Remaining Blockers — Fix Report

## Status: REMAINING BLOCKERS FIXED

## Executive Summary

Three confirmed root causes from live console evidence have been fixed with minimal,
conservative TypeScript changes. No DB migration required. No architecture rewrite.

---

## P1 — model_photos HTTP 400 (FIXED)

**Root Cause:** `upsertPhotosForModel` in `src/services/modelPhotosSupabase.ts` built payload
objects with `{id: undefined, ...}`. postgrest-js uses `Object.keys()` to generate the
`?columns=` query parameter, so `id` appeared in the URL columns list. `JSON.stringify`
strips `undefined` values, so the body lacked `id`. PostgREST returned HTTP 400 because
`columns=id` was declared but `id` was missing from the JSON body.

**Fix:** Conditionally include `id` key only when a value is present. Error logging now
surfaces `message`, `code`, `details`, `hint` for faster future debugging.

**Files:** `src/services/modelPhotosSupabase.ts`

---

## P2 — "Current Location" UI Misleading (FIXED)

**Root Cause:** `ModelEditDetailsPanel.tsx` displayed a "Current Location" text field
(`models.current_location`) that is completely independent from `model_locations` (the
Near Me system). The add-model flow never populated this field, so it appeared empty
after reopen, creating the false impression that location persistence failed.

**Fix:** Removed the `current_location` TextInput from the panel. The TypeScript type
and `buildEditState` retain the field for backward compatibility. City/Country (the
actually persisted values) remain clearly visible.

**Files:** `src/components/ModelEditDetailsPanel.tsx`

---

## P3 — agency_find_model_by_email HTTP 406 (FIXED)

**Root Cause:** The RPC is `RETURNS SETOF public.models`. `.maybeSingle()` sends
`Accept: application/vnd.pgrst.object+json`. PostgREST returns 406 when 0 rows match
(cannot represent empty set as single object). This is normal for new model creation
(no email match), but the 406 error polluted the console and could cause the 23505
retry path to return `null` instead of retrying.

**Fix:** Replaced `.maybeSingle()` with direct array handling (`[0] ?? null`) at both
callsites. Semantically identical for 0-1 row results.

**Files:** `src/services/modelsImportSupabase.ts`

---

## Safety Assessment

- No DB migration needed
- No RLS changes
- No changes to AuthContext, bootstrapThenLoadProfile, paywall, admin routing,
  discovery, package, shared, client-project, calendar, invite finalization,
  or location priority (live > current > agency)
- All 82 test suites pass (904 tests)
- TypeScript: 0 errors
- ESLint: 0 errors (4 pre-existing warnings in unrelated files)

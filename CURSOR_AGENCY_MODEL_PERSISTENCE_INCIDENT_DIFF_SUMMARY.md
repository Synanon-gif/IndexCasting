# Agency Model Persistence Incident — Diff Summary

## Files Changed

### 1. `src/services/modelPhotosSupabase.ts`

**RC-1 Fix: Org-context audit query**

- **Added** `resolveOrgIdForModel(modelId)` helper function (lines ~27-45)
  - Resolves org via `models.agency_id` -> `organizations` (type='agency') JOIN
  - Returns `organizations.id` or `null`
  - Replaces broken `.select('organization_id')` query (column does not exist on live DB)
- **Replaced** fire-and-forget audit block in `uploadModelPhoto` (~line 497)
  - Old: `.from('models').select('organization_id')` -> 400 error
  - New: `resolveOrgIdForModel(modelId)` -> correct org_id
- **Replaced** fire-and-forget audit block in `uploadPrivateModelPhoto` (~line 623)
  - Same pattern as above

**RC-5 Fix: file_size_bytes in upsert payload**

- **Added** `file_size_bytes: p.file_size_bytes ?? 0` to `upsertPhotosForModel` payload (~line 162)

### 2. `supabase/functions/send-invite/index.ts`

**RC-2 Fix: CORS headers on all responses**

- **Added** `ALLOWED_ORIGINS` array: `index-casting.com`, `www.index-casting.com`, `indexcasting.com`
- **Added** `getCorsHeaders(req)` function: echo matching origin, `Vary: Origin`
- **Added** `jsonResponse()` helper: combines JSON body + CORS headers + Content-Type
- **Replaced** all `new Response(JSON.stringify(...), { headers: { 'Content-Type': ... } })` with `jsonResponse(..., corsHeaders)`
- **Replaced** OPTIONS handler: uses `getCorsHeaders(req)` instead of hardcoded `*`
- **Result:** Every response (200, 400, 401, 403, 404, 405, 409, 500, 502, 503) now includes CORS headers

### 3. `src/views/AgencyControllerView.tsx`

**RC-3 Fix: buildEditState stale dependency**

- **Changed** `useEffect` dependency from `[selectedModel?.id]` to `[selectedModel?.id, selectedModel?.updated_at]` (~line 2103)
- After save, `updated_at` changes trigger `buildEditState` re-run with fresh data

**RC-5 Fix: file_size_bytes passthrough**

- **Portfolio uploads** (~line 2521): Changed `uploadedUrls: string[]` to `uploadedItems: { url, fileSizeBytes }[]`; passes `file_size_bytes` to `upsertPhotosForModel`
- **Polaroid uploads** (~line 2559): Same pattern with `uploadedPolaroidItems`

### 4. `src/services/modelsImportSupabase.ts`

**RC-4 Fix: .single() -> .maybeSingle()**

- **Changed** INSERT query from `.select('*').single()` to `.select('id').maybeSingle()` (~line 289)
- **Added** null guard: `if (!data?.id)` with explicit error message before proceeding

## Deployment

- `send-invite` Edge Function deployed and verified:
  - Preflight (OPTIONS): 200 with `Access-Control-Allow-Origin: https://www.index-casting.com`
  - POST error (401): includes full CORS headers
  - `Vary: Origin` present

## No Migrations Required

All fixes are TypeScript/Edge Function changes. No SQL schema changes needed — the live DB schema is correct.

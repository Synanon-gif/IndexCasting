# Agency Model Remaining Blockers — Diff Summary

## Files Changed (3 total)

### 1. `src/services/modelPhotosSupabase.ts`
- **Function:** `upsertPhotosForModel`
- **Change:** Payload construction now conditionally includes `id` key only when defined
  (was: `id: p.id ?? undefined` which left `id` in Object.keys). Error logging now
  surfaces structured fields (message, code, details, hint).
- **Lines affected:** ~147-185 (replaced payload map + error log)

### 2. `src/components/ModelEditDetailsPanel.tsx`
- **Change:** Removed the "Current Location" TextInput block (10 lines: View + Text + TextInput).
  City and Country fields remain unchanged.
- **Lines affected:** ~443-452 removed
- **Not changed:** `ModelEditState` type, `buildEditState` (field retained for compat)

### 3. `src/services/modelsImportSupabase.ts`
- **Function:** `importModelAndMerge`
- **Change:** Two `.maybeSingle()` calls on `agency_find_model_by_email` RPC replaced with
  direct array handling. Both callsites: email lookup (line ~113) and 23505 retry (line ~299).
- **Lines affected:** ~109-118 and ~298-302

## Not Changed
- No DB migrations
- No RLS policies
- No storage policies
- No uiCopy constants (labels kept for possible future use)
- No AgencyControllerView.tsx
- No AuthContext / login / admin routing
- No location priority / model_locations architecture

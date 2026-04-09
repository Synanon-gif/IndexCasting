# Agency Model Remaining Blockers — Verification Checklist

## Automated Checks (PASSED)

- [x] `npm run typecheck` — 0 errors
- [x] `npm run lint` — 0 errors (4 pre-existing warnings, none in changed files)
- [x] `npm test -- --passWithNoTests --ci` — 82 suites, 904 tests passed

## Manual Verification (post-deploy)

### P1: model_photos persistence
- [ ] Add model with Name, Email, City, Country, 1 portfolio image, image rights confirmed
- [ ] Console: NO 400 on `POST /rest/v1/model_photos`
- [ ] Console: `upsertPhotosForModel` returns non-empty array
- [ ] Reopen same model: portfolio image visible
- [ ] Completeness banner reflects actual persisted `model_photos`

### P2: Current Location field removed
- [ ] Add model form: no "Current Location" text field visible
- [ ] Edit model form: no "Current Location" text field visible
- [ ] City field still visible and functional
- [ ] Country picker still visible and functional
- [ ] After save + reopen: City/Country show saved values, no empty misleading field

### P3: agency_find_model_by_email no 406
- [ ] Add model with email that does NOT exist in DB
- [ ] Console: NO 406 on `agency_find_model_by_email`
- [ ] Model created successfully (not blocked by lookup error)
- [ ] Add model with email that DOES exist in DB
- [ ] Merge flow works correctly (no 406, model merged)

### Cross-checks (must NOT regress)
- [ ] Client discovery: portfolio images visible for models with photos
- [ ] Polaroids: NOT visible in normal discovery
- [ ] Near Me badge: shows "Set by agency" when no model-owned location
- [ ] Location priority: live > current > agency unchanged
- [ ] Agency model save (existing model): still works without 400
- [ ] ModelMediaSettingsPanel: addPhoto() still works (uses separate code path)

## DB Migration Status
- **No migration required** — all fixes are client-side TypeScript only

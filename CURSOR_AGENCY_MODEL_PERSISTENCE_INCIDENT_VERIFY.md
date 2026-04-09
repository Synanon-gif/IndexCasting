# Agency Model Persistence Incident — Verification Checklist

## Pre-Verification (Automated — PASSED)

- [x] `npm run typecheck` — 0 errors
- [x] `npm run lint` — 0 errors (4 pre-existing warnings, unchanged)
- [x] `npm test -- --passWithNoTests --ci` — 82 suites, 904 tests passed
- [x] `send-invite` Edge Function deployed successfully
- [x] CORS preflight from `www.index-casting.com` returns 200 with correct headers
- [x] CORS on POST error (401) includes `Access-Control-Allow-Origin`

## Manual Verification Checklist

### V1: Image Persistence (RC-1, RC-4, RC-5)

- [ ] Add a new model with portfolio images via AgencyControllerView
- [ ] Verify: images appear in roster card after add
- [ ] Close model profile, reopen same model
- [ ] Verify: images still visible in ModelMediaSettingsPanel
- [ ] Check browser console: NO `models?select=organization_id 400` errors
- [ ] Check browser console: NO `[assertOrgContext] org context missing` errors

### V2: Location Persistence (RC-3)

- [ ] Open an existing model, change city/country_code
- [ ] Click Save
- [ ] Verify: form fields show the saved values immediately (no stale data)
- [ ] Navigate away from model, reopen
- [ ] Verify: city/country_code still show saved values

### V3: Completeness Check

- [ ] Add model with portfolio images
- [ ] Verify completeness indicator reflects actual visible portfolio count
- [ ] Match `model_photos` rows (portfolio, is_visible_to_clients=true) with completeness state

### V4: Invite Delivery (RC-2)

- [ ] Add model with email, trigger invite
- [ ] Verify: no CORS error in browser console
- [ ] Verify: invite email received OR structured error displayed (not generic CORS failure)
- [ ] Test resend: click resend on existing pending invite
- [ ] Verify: resend works without CORS block

### V5: Checkbox / Rights UX

- [ ] Open model media panel, confirm image rights checkbox
- [ ] Upload an image
- [ ] Close and reopen model profile
- [ ] Verify: checkbox is unchecked (expected — intentionally transient)
- [ ] Verify: previously uploaded images are STILL VISIBLE (not hidden by checkbox state)
- [ ] If within 60-min window: verify green hint text appears ("rights recently confirmed")

### V6: No Regression — Package/Shared/Client

- [ ] Open a client discover view — models load correctly
- [ ] Open a package view — models display with images
- [ ] Shared project view — models accessible

### V7: No Regression — Auth/Paywall/Admin

- [ ] Admin login works
- [ ] Agency owner login works
- [ ] Booker login works
- [ ] Paywall check does not change behavior

### V8: Console Noise Reduction

- [ ] After login as agency user, check console for:
  - `models?select=organization_id` → should be GONE
  - `[assertOrgContext] org context missing` in photo context → should be GONE
  - `send-invite` CORS errors → should be GONE
  - `can_access_platform 401` before login → EXPECTED (startup noise, not fixed)

## Root Cause Confirmation

| RC | Symptom | Fix | Status |
|---|---|---|---|
| RC-1 | `models.organization_id` 400 | `resolveOrgIdForModel` via agency_id | FIXED |
| RC-2 | send-invite CORS blocked | CORS headers on all responses | FIXED + DEPLOYED + VERIFIED |
| RC-3 | Stale form after save | `updated_at` in useEffect deps | FIXED |
| RC-4 | INSERT .single() 406 risk | .maybeSingle() + null guard | FIXED |
| RC-5 | file_size_bytes = 0 | Passthrough from upload result | FIXED |

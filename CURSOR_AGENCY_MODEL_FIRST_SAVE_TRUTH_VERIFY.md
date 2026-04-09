# First-Save Truth — Verify Matrix

## Automated (run before merge)

- [ ] `npm run typecheck` — 0 errors
- [ ] `npm run lint` — 0 errors
- [ ] `npm test -- --passWithNoTests --ci` — all green

## Manual — core flows

### 1. Agency adds model with 1 portfolio image

- [ ] After add: roster shows thumb when persistence succeeded
- [ ] Reopen model: image visible in `ModelMediaSettingsPanel`
- [ ] Completeness matches visible portfolio rows in `model_photos`

### 2. Agency adds model with 2 portfolio + 1 polaroid

- [ ] Portfolio mirror (`models.portfolio_images`) consistent after rebuild when portfolio persisted
- [ ] Polaroid stored under polaroid type; client discover still portfolio-only (no regression)

### 3. Agency sets location in add flow (country + city)

- [ ] After add: city/country visible on profile as saved
- [ ] Reopen: same values
- [ ] If map row fails: user sees location `Alert` + warning suffix on add feedback

### 4. Agency edits existing model — save — reopen

- [ ] Latest field values visible immediately after save (existing `updated_at` dependency)
- [ ] If location row fails on save: `Alert` shown; profile fields may still be saved

### 5. No false success

- [ ] Simulate or force photo DB mismatch: user gets photo persist `Alert`, feedback includes persistence warning suffix
- [ ] Location failure: user gets location `Alert` + suffix on add when applicable

## Notes

- Checkbox remains transient; saved images must remain visible regardless (unchanged panel logic).

# Verify — client Chest + images

Automated (run in repo root):

- [x] `npm run typecheck` — green
- [x] `npm run lint` — green
- [x] `npm test -- --passWithNoTests --ci` — green

Manual / staging:

- [ ] No user-facing **“Bust”** on client Discover detail modal — labels show **Chest**
- [ ] Discover card / package grid images load (no `ERR_UNKNOWN_URL_SCHEME` in console)
- [ ] Detail portfolio strip + lightbox load for `supabase-storage://` and legacy bare filenames (when file exists under `model-photos/{modelId}/`)
- [ ] Standard discovery shows **portfolio only** (no polaroids)
- [ ] Package / guest flows unchanged for polaroid vs portfolio **type**
- [ ] Shared selection still renders cover + **Chest** line
- [ ] No layout regressions (placeholder gray blocks only when URL missing/invalid)

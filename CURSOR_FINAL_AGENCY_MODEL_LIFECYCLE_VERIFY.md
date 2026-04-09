# Final Agency Model Lifecycle — Verify Matrix

## A. New manual add with portfolio image
- [x] Photo upload calls use skipConsentCheck after confirmImageRights succeeds
- [x] rebuildPortfolioImagesFromModelPhotos syncs full mirror (not just uploaded URLs)
- [x] onRefresh() runs after photos AND location
- [x] setSelectedModel(fresh) runs with full DB data
- [x] Form closes AFTER all persistence steps complete

## B. New manual add with location
- [x] upsertModelLocation('agency') runs BEFORE photo block (RC-3)
- [x] Location persists even if photo rights check fails
- [x] model_locations row created with geocoded coordinates if available
- [x] models.city + country_code set via importModelAndMerge INSERT

## C. Existing model merge by email
- [x] importModelAndMerge → agency_find_model_by_email → existing model found
- [x] rebuildPortfolioImagesFromModelPhotos handles merge case (reads ALL model_photos)
- [x] 23505 defense-in-depth retry in importModelAndMerge preserved

## D. Soft delete + re-add
- [x] agency_relationship_ended_at cleared on reactivation (20260518 migration)
- [x] agency_update_model_full sets status to 'active' or 'pending_link'
- [x] Territories preserved or reassigned via upsertTerritoriesForModelCountryAgencyPairs

## E. Invite / claim / resend
- [x] generateModelClaimToken called in handleAddModel when email set + no user_id
- [x] send-invite edge function called with token
- [x] Resend auto-regenerates expired tokens (RC-6)
- [x] Manual fallback link shown when delivery fails
- [x] Success alert only after body.ok === true

## F. Location priority
- [x] live > current > agency: enforced in upsert_model_location RPC (unchanged)
- [x] Agency writes only source='agency' — cannot overwrite live/current

## G. Portfolio vs polaroid
- [x] Portfolio: is_visible_to_clients=true, synced to models.portfolio_images
- [x] Polaroids: is_visible_to_clients=false default, no mirror sync at create
- [x] Private: never client-visible

## H. Upload parity
- [x] MIME allowlist, Magic Bytes, Extension check, HEIC conversion: all preserved
- [x] skipConsentCheck only skips DB round-trip, not validation checks

## Quality Gates
- [x] npm run typecheck: PASS
- [x] npm run lint: PASS (0 errors)
- [x] npm test: PASS (894/894)
- [x] git push origin main: SUCCESS

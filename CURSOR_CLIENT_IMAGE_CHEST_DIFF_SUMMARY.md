# Diff summary — client Chest + images

## New

- `src/utils/normalizeModelPortfolioUrl.ts` — `normalizeDocumentspicturesModelImageRef`
- `src/utils/__tests__/normalizeModelPortfolioUrl.test.ts`
- `docs/DISCOVERY_IMAGE_AND_MEASUREMENT_CONSISTENCY.md`
- `CURSOR_CLIENT_IMAGE_CHEST_*` (this report family)

## Modified

- `src/services/apiService.js` — measurements `chest`; portfolio normalize
- `src/services/__tests__/apiService.test.ts` — expectations + bare-filename test
- `src/services/guestLinksSupabase.ts` — `signImageUrls(..., modelId)` + normalize
- `src/web/ClientWebApp.tsx` — MediaslideModel `chest`; detail labels; fallbacks; `StorageImage`; cover URL normalize; remove `Image` import
- `src/views/SharedSelectionView.tsx` — `measurements.chest`
- `src/constants/uiCopy.ts` — `discover.detailMeasurement*`
- `src/storage/storageUrl.ts` — removed normalize (moved to util to avoid Jest pulling `expo-constants` via `apiService`)
- `.cursorrules`, `.cursor/rules/auto-review.mdc`, `.cursor/rules/system-invariants.mdc`
- `docs/CLIENT_MODEL_PHOTO_VISIBILITY.md`

## Removed

- `src/storage/__tests__/normalizeDocumentspicturesModelImageRef.test.ts` (replaced by utils test)

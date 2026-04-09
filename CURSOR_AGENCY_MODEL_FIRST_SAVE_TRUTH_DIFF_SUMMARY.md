# First-Save Truth — Diff Summary

## `src/constants/uiCopy.ts`

New `modelMedia` strings:

- `photoPersistFailedTitle`, `photoPersistPortfolioFailedBody`, `photoPersistPolaroidFailedBody`
- `agencyLocationPersistFailedTitle`, `agencyLocationPersistFailedBody`, `agencyLocationPersistFailedShort`
- `addModelPersistenceWarningSuffix`
- `addModelNoPortfolioUploadedBody` (replaces prior inline English string in add flow)

## `src/views/AgencyControllerView.tsx`

### `handleAddModel`

- `locationPersistFailed` + `Alert` when `upsertModelLocation` fails (country set).
- Replaced undifferentiated `anyPhotosUploaded` with `portfolioPersisted` / `polaroidPersisted` after upsert + `getPhotosForModel` verification.
- `portfolioRowsExpected` / `polaroidRowsExpected` for feedback suffix calculation.
- Rebuild: sequential per-type only when that type persisted.
- `persistenceSuffix` appended to `setAddModelFeedback` when location or photo DB persistence incomplete.

### `handleSaveModel`

- `Alert.alert` when `upsertModelLocation` returns false (in addition to existing `console.warn`).

## No migrations, no Edge Functions, no service contract change

`upsertPhotosForModel` signature unchanged; callers now interpret return value and verify with `getPhotosForModel`.

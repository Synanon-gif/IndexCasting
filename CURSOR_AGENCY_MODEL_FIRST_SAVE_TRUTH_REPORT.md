# Agency Model First-Save / Reopen — Report

**Date:** 2026-04-09  
**Status:** AGENCY MODEL FIRST-SAVE TRUTH FIXED

## Root cause (short)

The add-model flow treated storage upload success as database persistence success. `upsertPhotosForModel` can return fewer rows than uploads (or empty on error) without throwing; the UI still advanced `anyPhotosUploaded`, ran mirror rebuilds for both portfolio and polaroid, and showed a full success message. Location writes via `upsertModelLocation` could fail with only `console.warn`, leaving Near Me / `model_locations` out of sync without user-visible signal.

## What we changed

1. **Portfolio / polaroid:** After each `upsertPhotosForModel`, require `inserted.length === expected` and `getPhotosForModel(..., type).length >= expected` before setting `portfolioPersisted` / `polaroidPersisted`. On mismatch, show `Alert` with `uiCopy.modelMedia.photoPersistFailed*` strings.

2. **Rebuild:** Call `rebuildPortfolioImagesFromModelPhotos` only if `portfolioPersisted`; `rebuildPolaroidsFromModelPhotos` only if `polaroidPersisted` (no longer rebuild both when only one side persisted).

3. **Location:** On add, if `upsertModelLocation` returns false, set `locationPersistFailed` and show `Alert` with `agencyLocationPersistFailedTitle` / `Body`. On save, same `Alert` when location upsert fails (model RPC may still succeed).

4. **Feedback:** If `locationPersistFailed` or expected photo rows did not persist (`portfolioRowsExpected` / `polaroidRowsExpected` vs persisted flags), append `uiCopy.modelMedia.addModelPersistenceWarningSuffix` to add-model feedback so the inline message is not falsely “complete”.

5. **Copy:** Replaced hardcoded “No portfolio photos…” with `addModelNoPortfolioUploadedBody` in `uiCopy`.

## Out of scope (unchanged)

- AuthContext, paywall, discovery, package/shared/project, calendar, RLS
- Location source priority `live > current > agency`
- Checkbox persistence (remains session-local per product rules)

## Quality gates

Run locally: `npm run typecheck`, `npm run lint`, `npm test -- --passWithNoTests --ci`.

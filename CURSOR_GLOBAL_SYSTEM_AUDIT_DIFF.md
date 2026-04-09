# CURSOR_GLOBAL_SYSTEM_AUDIT_DIFF.md

Summary of code changes from the Global System Audit pass (2026-04-09).

## `src/views/AgencyControllerView.tsx`

1. **Import** — Added `rebuildPolaroidsFromModelPhotos` alongside existing portfolio rebuild helper.

2. **`handleAddModel` (merge reactivate path)** — After `agency_claim_unowned_model` fails, the fallback `agency_update_model_full` call now captures `error`; on failure logs and throws so the outer `catch` shows a user-visible error instead of continuing as if the merge completed cleanly.

3. **`handleAddModel` (post-upload mirrors)** — When any photos were uploaded, the code now runs `rebuildPortfolioImagesFromModelPhotos` and `rebuildPolaroidsFromModelPhotos` in parallel (matching the media panel’s SoT→mirror contract) and alerts separately if either rebuild fails.

4. **`refreshAgencyModelLists` (roster heal)** — For models with empty `portfolio_images` mirror, the background heal now runs both portfolio and polaroid rebuilds from `model_photos` before optionally refetching the agency model list.

No database migrations, Edge Functions, or rule files were changed in this audit pass.

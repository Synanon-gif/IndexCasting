# Model profile persistence and visibility (Agency)

## Two layers for portfolio images

| Layer | Table / column | Role |
|--------|----------------|------|
| **Rows** | `model_photos` (`photo_type`, `sort_order`, `is_visible_to_clients`, `url`) | Source of truth for uploads, visibility toggles, agency media panel |
| **Denormalized array** | `models.portfolio_images` | Ordered URLs for client discovery, cover image, agency roster list, `getModelData` |

Upload flows write `model_photos` first, then call `syncPortfolioToModel` (RPC `agency_update_model_full` with `p_portfolio_images`). If that RPC fails, photos still exist in `model_photos` but the roster may show “no photos” and clients may miss covers until sync succeeds.

## Reconcile

`rebuildPortfolioImagesFromModelPhotos` and `rebuildPolaroidsFromModelPhotos` rebuild the denormalized arrays from visible rows in `model_photos`. The agency **Model media** panel runs these after load so roster and discovery realign after any drift.
Additionally, the agency roster refresh pass attempts a one-time background rebuild for models with empty `portfolio_images` so upload/save/reload is less likely to show stale “no thumbnail” states.

## Completeness (agency)

“No visible portfolio photo” for mandatory completeness uses **client-visible portfolio rows** in `model_photos`, not `portfolio_images` alone (`getPhotosForModel` in `AgencyControllerView`).

## Image rights checkbox (UI)

The checkbox in the media panel is **per session / visit**. The server still requires a recent row in `image_rights_confirmations` within the configured window. If a confirmation was just recorded, uploads can proceed even after the checkbox is unchecked (see panel copy).

## Location

`city` and `current_location` are stored on `models` via `agency_update_model_full`. Writing **`model_locations`** with `source = 'agency'` (map / Near Me) additionally requires a **country** selection so geocoding can run; see `uiCopy.modelEdit.countryNearMeHint` in the agency edit form.

# Client-visible model photos — DB vs storage

## Product rule

If a client may **read** a `model_photos` row (RLS), they must be able to **load** the bytes in `documentspictures` for that same object (signed URL / storage SELECT).

## RLS (reference)

Policy **Clients see visible model photos** (see migration `20260426_remediation_three_policies_no_profiles_rls.sql`):

- `is_visible_to_clients = true`
- `has_platform_access()`
- `caller_is_client_org_member()`

## Storage helper

`public.can_view_model_photo_storage(p_object_name text)` — argument is the **bucket-relative object path** (`storage.objects.name`), e.g. `model-photos/{model_id}/{filename}`.

- **Agency / legacy booker / linked model user**: same as before — folder prefix + `model_id` segment; full access to objects under that model’s prefixes (including `model-private-photos` for agency/model where applicable).
- **Client**: only under `model-photos/` (not `model-private-photos/`), and only if a `model_photos` row exists with:
  - same `model_id`,
  - `is_visible_to_clients = true`,
  - `url` matching that storage path (canonical `supabase-storage://documentspictures/…` or legacy URL pattern),
  - plus `has_platform_access()` and `caller_is_client_org_member()`.

This removes the old mismatch where clients were gated on `models.is_visible_commercial/fashion` for storage while `model_photos` used per-photo visibility.

## Not the same as

- `can_view_model_photo(uuid)` — still used by edge/watermark flows; different contract.
- Discovery visibility on `models` — orthogonal to per-photo client visibility unless product explicitly ties them.

## Migration

- `supabase/migrations/20260501_can_view_model_photo_storage_client_row_alignment.sql`

## Client discovery / `portfolio_images` string shapes

Row visibility (above) is necessary but not sufficient for UX: `models.portfolio_images` may store **canonical storage URIs**, **HTTPS URLs**, or **legacy bare filenames**. Client web surfaces must **normalize** (`normalizeDocumentspicturesModelImageRef` in `src/utils/normalizeModelPortfolioUrl.ts`) and render through **`StorageImage`** so private-bucket assets resolve to signed HTTPS. See **`docs/DISCOVERY_IMAGE_AND_MEASUREMENT_CONSISTENCY.md`**.

## Agency UI parity

- **Canonical media rows** live in `model_photos` (per-type, `is_visible_to_clients`).
- **`models.portfolio_images`** is a denormalized ordered list for discovery, swipe cover, and agency roster thumbnails; it is kept in sync via `agency_update_model_full` (`syncPortfolioToModel` / `rebuildPortfolioImagesFromModelPhotos` in `src/services/modelPhotosSupabase.ts`).
- **Agency roster thumbnails** must normalize each `portfolio_images[]` entry with `normalizeDocumentspicturesModelImageRef` before `StorageImage`, same as client web. See **`docs/MODEL_PROFILE_PERSISTENCE_AND_VISIBILITY.md`**.

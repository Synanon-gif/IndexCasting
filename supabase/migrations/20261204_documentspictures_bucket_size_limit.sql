-- ============================================================================
-- documentspictures bucket — explicit per-object file_size_limit + MIME allowlist
-- 2026-12-04
--
-- Why:
--   The Package-Import flow (Phase 2 image mirror) downloads model photos
--   from the MediaSlide / Netwalk CDN, validates them client-side and uploads
--   them to the `documentspictures` bucket. The Edge Function
--   `package-image-proxy` already caps responses at 25 MB and the client
--   `validateFile` allows up to 200 MB for generic uploads, but the BUCKET
--   itself had no `file_size_limit` set in any prior migration — meaning a
--   compromised JWT or a future code path could push arbitrarily large
--   objects directly into Supabase Storage and burn the agency's plan-tier
--   quota in a single request.
--
--   This migration sets the bucket-side cap to 25 MB (matching the proxy)
--   AND restricts allowed MIME types to the same set the persistence
--   pipeline already enforces in code (`ALLOWED_DOWNLOAD_CONTENT_TYPES` in
--   `packageImagePersistence.ts` and `ALLOWED_MIME_TYPES` in
--   `lib/validation/file.ts`). Defense-in-depth: even a buggy uploader
--   cannot push a 1 GB PDF into a model's portfolio bucket.
--
--   100-model batches are the trigger: one rogue 25 MB image × 30 photos ×
--   100 models = 75 GB — without a per-object cap that pile-up could blow
--   through an Enterprise plan in a single import. The cap stops each
--   individual object before it lands.
--
-- Idempotent: uses INSERT … ON CONFLICT … DO UPDATE so re-running on a
-- bucket created by an older migration just patches the limits in place.
--
-- Verification query:
--   SELECT id, file_size_limit, allowed_mime_types
--     FROM storage.buckets
--    WHERE id = 'documentspictures';
-- ============================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'documentspictures',
  'documentspictures',
  true,
  26214400, -- 25 MB — matches package-image-proxy MAX_BODY_BYTES exactly.
  ARRAY[
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/webp',
    'image/heic',
    'image/heif'
  ]
)
ON CONFLICT (id) DO UPDATE
SET
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

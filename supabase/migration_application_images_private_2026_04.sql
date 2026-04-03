-- =============================================================================
-- Fix Application Images: Normalise stored public URLs to supabase-storage://
--
-- Security finding (Attack Simulation 2026-04): uploadApplicationImage stored
-- full public URLs (getPublicUrl) in model_applications.images JSONB. Since
-- the documentspictures bucket is now PRIVATE, those URLs are inaccessible AND
-- they bypass the signed-URL pattern used for model_photos.
--
-- Fix:
--   Convert any remaining full public URLs in model_applications.images
--   (a JSONB Record<string, string>) to the canonical supabase-storage:// URI
--   scheme so resolveStorageUrl() can resolve them with a signed URL.
--
-- Idempotent: CASE expression is a no-op for rows already in the new format.
-- =============================================================================

UPDATE public.model_applications
SET images = (
  SELECT jsonb_object_agg(
    kv.key,
    CASE
      WHEN kv.value #>> '{}' LIKE '%/storage/v1/object/public/documentspictures/%'
        AND kv.value #>> '{}' NOT LIKE 'supabase-%'
      THEN
        to_jsonb(
          'supabase-storage://documentspictures/' ||
          (regexp_match(kv.value #>> '{}', '/storage/v1/object/public/documentspictures/([^?"]+)'))[1]
        )
      ELSE
        kv.value
    END
  )
  FROM jsonb_each(images) AS kv(key, value)
)
WHERE images IS NOT NULL
  AND images::text LIKE '%/storage/v1/object/public/documentspictures/%';

-- ─── Verification ─────────────────────────────────────────────────────────────
-- SELECT COUNT(*) FROM public.model_applications
-- WHERE images::text LIKE '%/storage/v1/object/public/documentspictures/%';
-- Expected: 0

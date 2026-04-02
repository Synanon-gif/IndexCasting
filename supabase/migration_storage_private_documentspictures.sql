-- =============================================================================
-- M-3 Full Fix: Private documentspictures Bucket + URL Normalisation
--
-- Security Audit 2026-04 — full resolution of the portfolio image exposure:
--
--   Previously: documentspictures bucket was PUBLIC. Full public URLs were
--   stored in model_photos.url, models.portfolio_images, models.polaroids.
--   Anyone who obtained a URL could access it permanently, even after a guest
--   link expired or was revoked.
--
--   Fix:
--   1. Normalise all stored full-public-URL strings to the canonical
--      supabase-storage://documentspictures/<path> URI scheme.
--      The application layer (storageUrl.ts) resolves these to short-lived
--      signed URLs at render time.
--
--   2. The documentspictures bucket is set to PRIVATE via the Supabase
--      Management API (not SQL — see run_hardening_migrations.sh or deploy
--      instructions below). This migration handles only DB data.
--
-- Safe to run multiple times (idempotent): the CASE expressions are no-ops
-- for rows already in supabase-storage:// format.
--
-- Run BEFORE setting the bucket to private to ensure no broken URLs exist
-- in the application between deploy and migration.
-- =============================================================================

-- ─── Helper: extract path suffix from a documentspictures public URL ─────────

-- Pattern: https://<host>/storage/v1/object/public/documentspictures/<path>
-- We capture everything after the bucket name, stripping any query string.
-- Example:
--   IN:  https://ispkfdqzjrfrilosoklu.supabase.co/storage/v1/object/public/documentspictures/model-photos/abc/img.jpg
--   OUT: supabase-storage://documentspictures/model-photos/abc/img.jpg

-- ─── 1. model_photos.url ─────────────────────────────────────────────────────

UPDATE public.model_photos
SET    url = 'supabase-storage://documentspictures/' ||
             (regexp_match(url, '/storage/v1/object/public/documentspictures/([^?]+)'))[1]
WHERE  url LIKE '%/storage/v1/object/public/documentspictures/%'
  AND  url NOT LIKE 'supabase-%';

-- ─── 2. models.portfolio_images (text[]) ─────────────────────────────────────

UPDATE public.models
SET    portfolio_images = ARRAY(
         SELECT
           CASE
             WHEN elem LIKE '%/storage/v1/object/public/documentspictures/%'
                  AND elem NOT LIKE 'supabase-%'
             THEN
               'supabase-storage://documentspictures/' ||
               (regexp_match(elem, '/storage/v1/object/public/documentspictures/([^?]+)'))[1]
             ELSE elem
           END
         FROM unnest(portfolio_images) AS elem
       )
WHERE  portfolio_images IS NOT NULL
  AND  array_to_string(portfolio_images, ',')
         LIKE '%/storage/v1/object/public/documentspictures/%';

-- ─── 3. models.polaroids (text[]) ────────────────────────────────────────────

UPDATE public.models
SET    polaroids = ARRAY(
         SELECT
           CASE
             WHEN elem LIKE '%/storage/v1/object/public/documentspictures/%'
                  AND elem NOT LIKE 'supabase-%'
             THEN
               'supabase-storage://documentspictures/' ||
               (regexp_match(elem, '/storage/v1/object/public/documentspictures/([^?]+)'))[1]
             ELSE elem
           END
         FROM unnest(polaroids) AS elem
       )
WHERE  polaroids IS NOT NULL
  AND  array_to_string(polaroids, ',')
         LIKE '%/storage/v1/object/public/documentspictures/%';

-- ─── 4. Verification ─────────────────────────────────────────────────────────

SELECT
  'model_photos'  AS source,
  COUNT(*)        AS remaining_public_urls
FROM   public.model_photos
WHERE  url LIKE '%/storage/v1/object/public/documentspictures/%'

UNION ALL

SELECT
  'portfolio_images',
  COUNT(*)
FROM   public.models
WHERE  array_to_string(portfolio_images, ',') LIKE '%/storage/v1/object/public/documentspictures/%'

UNION ALL

SELECT
  'polaroids',
  COUNT(*)
FROM   public.models
WHERE  array_to_string(polaroids, ',') LIKE '%/storage/v1/object/public/documentspictures/%';

-- Expected result: all three rows show remaining_public_urls = 0.
-- Once confirmed, set the bucket to private:
--
--   curl -s -X PUT \
--     "https://api.supabase.com/v1/projects/ispkfdqzjrfrilosoklu/storage/buckets/documentspictures" \
--     -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
--     -H "Content-Type: application/json" \
--     -d '{"public": false}'

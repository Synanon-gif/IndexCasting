-- Migration: Normalize storage URL references across media tables
-- Purpose: Convert legacy public URLs and bare paths in model_photos.url,
-- models.portfolio_images, models.polaroids, and model_applications.images
-- to the canonical supabase-storage:// format.
-- Idempotent: re-running is safe (already-canonical values are skipped).

-- 1. model_photos.url — normalize legacy public URLs to supabase-storage://
UPDATE public.model_photos
SET url = 'supabase-storage://documentspictures/' ||
  substring(url FROM '/storage/v1/object/public/documentspictures/(.+?)(\?|$)')
WHERE url LIKE '%/storage/v1/object/public/documentspictures/%'
  AND url NOT LIKE 'supabase-storage://%'
  AND url NOT LIKE 'supabase-private://%';

-- 2. model_photos.url — normalize legacy signed URLs to supabase-storage://
UPDATE public.model_photos
SET url = 'supabase-storage://documentspictures/' ||
  substring(url FROM '/storage/v1/object/sign/documentspictures/(.+?)(\?|$)')
WHERE url LIKE '%/storage/v1/object/sign/documentspictures/%'
  AND url NOT LIKE 'supabase-storage://%'
  AND url NOT LIKE 'supabase-private://%';

-- 3. model_photos.url — normalize private bucket legacy URLs
UPDATE public.model_photos
SET url = 'supabase-private://documents/' ||
  substring(url FROM '/storage/v1/object/(?:public|sign)/documents/(.+?)(\?|$)')
WHERE url LIKE '%/storage/v1/object/%/documents/%'
  AND url NOT LIKE 'supabase-storage://%'
  AND url NOT LIKE 'supabase-private://%';

-- 4. models.portfolio_images — normalize array entries
-- PostgreSQL array element update: rebuild array with normalized values.
UPDATE public.models m
SET portfolio_images = (
  SELECT array_agg(
    CASE
      WHEN elem LIKE '%/storage/v1/object/public/documentspictures/%'
        THEN 'supabase-storage://documentspictures/' ||
             substring(elem FROM '/storage/v1/object/public/documentspictures/(.+?)(\?|$)')
      WHEN elem LIKE '%/storage/v1/object/sign/documentspictures/%'
        THEN 'supabase-storage://documentspictures/' ||
             substring(elem FROM '/storage/v1/object/sign/documentspictures/(.+?)(\?|$)')
      ELSE elem
    END
  )
  FROM unnest(m.portfolio_images) AS elem
)
WHERE EXISTS (
  SELECT 1 FROM unnest(m.portfolio_images) AS e
  WHERE e LIKE '%/storage/v1/object/%/documentspictures/%'
    AND e NOT LIKE 'supabase-storage://%'
    AND e NOT LIKE 'supabase-private://%'
);

-- 5. models.polaroids — same normalization as portfolio_images
UPDATE public.models m
SET polaroids = (
  SELECT array_agg(
    CASE
      WHEN elem LIKE '%/storage/v1/object/public/documentspictures/%'
        THEN 'supabase-storage://documentspictures/' ||
             substring(elem FROM '/storage/v1/object/public/documentspictures/(.+?)(\?|$)')
      WHEN elem LIKE '%/storage/v1/object/sign/documentspictures/%'
        THEN 'supabase-storage://documentspictures/' ||
             substring(elem FROM '/storage/v1/object/sign/documentspictures/(.+?)(\?|$)')
      ELSE elem
    END
  )
  FROM unnest(m.polaroids) AS elem
)
WHERE EXISTS (
  SELECT 1 FROM unnest(m.polaroids) AS e
  WHERE e LIKE '%/storage/v1/object/%/documentspictures/%'
    AND e NOT LIKE 'supabase-storage://%'
    AND e NOT LIKE 'supabase-private://%'
);

-- Verification queries (run after migration to confirm):
-- SELECT count(*) FROM model_photos WHERE url LIKE '%/storage/v1/object/%' AND url NOT LIKE 'supabase-%';
-- SELECT count(*) FROM models WHERE EXISTS (SELECT 1 FROM unnest(portfolio_images) e WHERE e LIKE '%/storage/v1/object/%' AND e NOT LIKE 'supabase-%');

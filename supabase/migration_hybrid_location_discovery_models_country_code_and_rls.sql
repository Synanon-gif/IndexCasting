-- =============================================================================
-- Hybrid Location Discovery
-- - Add models.country_code (backfill from legacy models.country)
-- - Update models_with_territories to expose territory_country_code alias
-- - Update RLS for clients: clients may read visible models if
--   (a) they have a real location (models.country_code is not null) OR
--   (b) they are represented via at least one territory row
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) Add + backfill models.country_code
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'models'
      AND column_name = 'country_code'
  ) THEN
    ALTER TABLE public.models ADD COLUMN country_code TEXT;
  END IF;
END $$;

-- Backfill from legacy `country` into `country_code`
UPDATE public.models
SET country_code = UPPER(TRIM(country))
WHERE (country_code IS NULL OR TRIM(country_code) = '')
  AND country IS NOT NULL
  AND TRIM(country) <> '';

-- Normalize empty strings to NULL
UPDATE public.models
SET country_code = NULL
WHERE country_code IS NOT NULL
  AND TRIM(country_code) = '';

-- ---------------------------------------------------------------------------
-- 2) View: territory country alias (avoid colliding with models.country_code)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.models_with_territories AS
SELECT
  m.*,
  mat.country_code AS territory_country_code,
  mat.agency_id AS territory_agency_id,
  a.name AS agency_name
FROM public.model_agency_territories mat
JOIN public.models m
  ON m.id = mat.model_id
JOIN public.agencies a
  ON a.id = mat.agency_id;

-- ---------------------------------------------------------------------------
-- 3) RLS: clients can read visible models when either:
--    - real location exists (country_code not null) OR
--    - at least one territory row exists
-- ---------------------------------------------------------------------------
ALTER TABLE public.models ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Clients can read represented visible models" ON public.models;

CREATE POLICY "Clients can read represented visible models"
  ON public.models FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role = 'client'
    )
    AND (models.is_visible_commercial = true OR models.is_visible_fashion = true)
    AND (
      (models.country_code IS NOT NULL)
      OR EXISTS (
        SELECT 1
        FROM public.model_agency_territories mat
        WHERE mat.model_id = models.id
      )
    )
  );


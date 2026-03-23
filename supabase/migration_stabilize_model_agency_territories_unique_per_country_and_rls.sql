-- =============================================================================
-- Stabilization: exactly one agency per model per country (model_id,country_code)
-- - Cleans duplicates (keeps latest row by created_at)
-- - Enforces UNIQUE(model_id, country_code)
-- - RLS:
--   - Clients can SELECT territories
--   - Agencies can INSERT/UPDATE/DELETE only if they are a member of the matching agency organization
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0) Ensure `country_code` exists + backfill from legacy `territory`
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'model_agency_territories'
      AND column_name = 'country_code'
  ) THEN
    ALTER TABLE public.model_agency_territories ADD COLUMN country_code TEXT;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'model_agency_territories'
      AND column_name = 'territory'
  ) THEN
    UPDATE public.model_agency_territories
    SET country_code = UPPER(TRIM(territory))
    WHERE (country_code IS NULL OR TRIM(country_code) = '');
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'model_agency_territories'
      AND column_name = 'country_code'
  ) THEN
    ALTER TABLE public.model_agency_territories
      ALTER COLUMN country_code SET NOT NULL;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1) Cleanup duplicates: keep latest row per (model_id, country_code)
-- ---------------------------------------------------------------------------
WITH ranked AS (
  SELECT
    id,
    model_id,
    country_code,
    created_at,
    row_number() OVER (
      PARTITION BY model_id, country_code
      ORDER BY created_at DESC NULLS LAST, id DESC
    ) AS rn
  FROM public.model_agency_territories
)
DELETE FROM public.model_agency_territories mat
USING ranked r
WHERE mat.id = r.id
  AND r.rn > 1;

-- ---------------------------------------------------------------------------
-- 2) Enforce UNIQUE(model_id, country_code)
-- ---------------------------------------------------------------------------
ALTER TABLE public.model_agency_territories
  DROP CONSTRAINT IF EXISTS model_agency_territories_unique_model_country_agency;

ALTER TABLE public.model_agency_territories
  DROP CONSTRAINT IF EXISTS model_agency_territories_unique_model_country;

ALTER TABLE public.model_agency_territories
  ADD CONSTRAINT model_agency_territories_unique_model_country
  UNIQUE (model_id, country_code);

CREATE INDEX IF NOT EXISTS idx_model_agency_territories_country
  ON public.model_agency_territories(country_code);

-- ---------------------------------------------------------------------------
-- 3) RLS policies
-- ---------------------------------------------------------------------------
ALTER TABLE public.model_agency_territories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Clients can view model territories" ON public.model_agency_territories;
CREATE POLICY "Clients can view model territories"
  ON public.model_agency_territories
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role = 'client'
    )
  );

DROP POLICY IF EXISTS "Agencies can view their territories" ON public.model_agency_territories;
DROP POLICY IF EXISTS "Agencies can manage their territories" ON public.model_agency_territories;

CREATE POLICY "Agencies can manage their territories"
  ON public.model_agency_territories
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.organizations o
      JOIN public.organization_members om ON om.organization_id = o.id
      WHERE o.type = 'agency'
        AND o.agency_id = model_agency_territories.agency_id
        AND om.user_id = auth.uid()
        AND om.role IN ('owner', 'booker')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.organizations o
      JOIN public.organization_members om ON om.organization_id = o.id
      WHERE o.type = 'agency'
        AND o.agency_id = model_agency_territories.agency_id
        AND om.user_id = auth.uid()
        AND om.role IN ('owner', 'booker')
    )
  );


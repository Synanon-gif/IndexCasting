-- Fix: allow multiple agencies per model+country and allow clients to read territories
-- for discovery and booking routing.

-- Run after: table model_agency_territories exists.
-- IMPORTANT: support legacy schema from migration_phase2_datamodel.sql where the column is `territory`
-- instead of `country_code`. We add `country_code` and backfill from `territory`.

-- ---------------------------------------------------------------------------
-- 0) Ensure `country_code` column exists and is backfilled
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

-- Backfill from legacy `territory`
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

-- Enforce not-null once backfilled (legacy `territory` is NOT NULL)
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
-- 1) Unique constraint: (model_id, territory|country_code) -> (model_id, country_code, agency_id)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_conname text;
BEGIN
  -- Drop legacy UNIQUE (model_id, territory)
  SELECT con.conname
  INTO v_conname
  FROM pg_constraint con
  WHERE con.conrelid = 'public.model_agency_territories'::regclass
    AND con.contype = 'u'
    AND pg_get_constraintdef(con.oid) ILIKE '%UNIQUE (model_id, territory)%';

  IF v_conname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.model_agency_territories DROP CONSTRAINT %I', v_conname);
  END IF;

  -- Drop old UNIQUE (model_id, country_code) (if it exists)
  SELECT con.conname
  INTO v_conname
  FROM pg_constraint con
  WHERE con.conrelid = 'public.model_agency_territories'::regclass
    AND con.contype = 'u'
    AND pg_get_constraintdef(con.oid) ILIKE '%UNIQUE (model_id, country_code)%';

  IF v_conname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.model_agency_territories DROP CONSTRAINT %I', v_conname);
  END IF;
END $$;

-- If a partial run already created the new constraint, drop it before re-adding.
ALTER TABLE public.model_agency_territories
  DROP CONSTRAINT IF EXISTS model_agency_territories_unique_model_country_agency;

ALTER TABLE public.model_agency_territories
  ADD CONSTRAINT model_agency_territories_unique_model_country_agency
  UNIQUE (model_id, country_code, agency_id);

CREATE INDEX IF NOT EXISTS idx_model_agency_territories_country
  ON public.model_agency_territories(country_code);

-- ---------------------------------------------------------------------------
-- 2) RLS: clients can SELECT territories for discovery/booking routing
-- ---------------------------------------------------------------------------
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


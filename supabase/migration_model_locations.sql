-- =============================================================================
-- Model Locations
--
-- Privacy-safe, filterable location system for models.
-- NEVER stores exact GPS coordinates — only rounded approx values (~5 km).
--
-- Rules:
--   - One active location per model (UNIQUE on model_id → UPSERT semantics)
--   - source: 'model' (self-managed) | 'agency' (bulk-assigned)
--   - lat_approx / lng_approx are NULL when share_approximate_location = false
--   - Priority: most recent updated_at wins (single row via UNIQUE constraint)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) Table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.model_locations (
  id                          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id                    UUID        NOT NULL
                                REFERENCES public.models(id) ON DELETE CASCADE,
  city                        TEXT,                          -- display label only
  country_code                TEXT        NOT NULL,          -- ISO alpha-2 (e.g. 'DE')
  lat_approx                  FLOAT,                         -- rounded ~5 km; NULL if not sharing
  lng_approx                  FLOAT,
  share_approximate_location  BOOLEAN     NOT NULL DEFAULT TRUE,
  source                      TEXT        NOT NULL
                                CHECK (source IN ('model', 'agency')),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (model_id)
);

-- ---------------------------------------------------------------------------
-- 2) Indexes
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_model_locations_model_id
  ON public.model_locations (model_id);

CREATE INDEX IF NOT EXISTS idx_model_locations_country_code
  ON public.model_locations (country_code);

-- Composite index for bbox radius queries
CREATE INDEX IF NOT EXISTS idx_model_locations_lat_lng
  ON public.model_locations (lat_approx, lng_approx)
  WHERE lat_approx IS NOT NULL AND lng_approx IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3) Auto-update updated_at
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_model_locations_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_model_locations_updated_at ON public.model_locations;
CREATE TRIGGER trg_model_locations_updated_at
  BEFORE UPDATE ON public.model_locations
  FOR EACH ROW EXECUTE FUNCTION public.set_model_locations_updated_at();

-- ---------------------------------------------------------------------------
-- 4) Row Level Security
-- ---------------------------------------------------------------------------
ALTER TABLE public.model_locations ENABLE ROW LEVEL SECURITY;

-- Authenticated users (clients, agency members, models) can read all locations.
-- Model visibility is already enforced by the models table RLS.
DROP POLICY IF EXISTS "Clients can read model locations" ON public.model_locations;
CREATE POLICY "Clients can read model locations"
  ON public.model_locations FOR SELECT
  TO authenticated
  USING (true);

-- Anon users (guest links) can also read model locations
DROP POLICY IF EXISTS "Anon can read model locations" ON public.model_locations;
CREATE POLICY "Anon can read model locations"
  ON public.model_locations FOR SELECT
  TO anon
  USING (true);

-- Model user (the model itself) can upsert their own location
DROP POLICY IF EXISTS "Model can upsert own location" ON public.model_locations;
CREATE POLICY "Model can upsert own location"
  ON public.model_locations FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.models m
      WHERE m.id = model_locations.model_id
        AND m.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.models m
      WHERE m.id = model_locations.model_id
        AND m.user_id = auth.uid()
    )
  );

-- Agency org members can upsert locations for models in their agency.
-- Uses organizations.agency_id (correct FK — agencies has NO organization_id column).
-- Also covers legacy bookers table (same pattern as models RLS policies).
DROP POLICY IF EXISTS "Agency members can upsert model locations" ON public.model_locations;
CREATE POLICY "Agency members can upsert model locations"
  ON public.model_locations FOR ALL
  TO authenticated
  USING (
    -- Path A: organization_members (invited bookers / owners)
    EXISTS (
      SELECT 1
      FROM   public.models m
      JOIN   public.organizations o
               ON  o.agency_id = m.agency_id
               AND o.type      = 'agency'
      JOIN   public.organization_members om
               ON  om.organization_id = o.id
      WHERE  m.id         = model_locations.model_id
        AND  om.user_id   = auth.uid()
    )
    OR
    -- Path B: legacy bookers table
    EXISTS (
      SELECT 1
      FROM   public.models m
      JOIN   public.bookers b
               ON  b.agency_id = m.agency_id
      WHERE  m.id       = model_locations.model_id
        AND  b.user_id  = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM   public.models m
      JOIN   public.organizations o
               ON  o.agency_id = m.agency_id
               AND o.type      = 'agency'
      JOIN   public.organization_members om
               ON  om.organization_id = o.id
      WHERE  m.id         = model_locations.model_id
        AND  om.user_id   = auth.uid()
    )
    OR
    EXISTS (
      SELECT 1
      FROM   public.models m
      JOIN   public.bookers b
               ON  b.agency_id = m.agency_id
      WHERE  m.id       = model_locations.model_id
        AND  b.user_id  = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- 5) Grants
-- ---------------------------------------------------------------------------
GRANT SELECT ON public.model_locations TO authenticated, anon;
GRANT INSERT, UPDATE, DELETE ON public.model_locations TO authenticated;

-- =============================================================================
-- Location Source Priority System — Phase 1 DB Migration
-- Date: 2026-04-06
--
-- Refactor model_locations.source from 2 values ('model', 'agency') to 3:
--   'live'    — model's browser GPS (highest precision, model controls)
--   'current' — model-typed city (geocoded approximate, model controls)
--   'agency'  — agency-set city/country (fallback when model has no account)
--
-- Priority:  live > current > agency
--
-- Enforcement strategy: write-time priority via ON CONFLICT ... WHERE
--   Agency writes: DO UPDATE ... WHERE model_locations.source = 'agency'
--   → if model owns the row (source='live' or 'current'): WHERE is false
--     → entire UPDATE is skipped → model data fully preserved
--   Model writes: always update (no WHERE restriction — model switches
--   between 'live' and 'current' explicitly, no third-party blocking needed)
--
-- Changes:
--   1. ALTER CHECK constraint: add 'live', 'current'; remove 'model'
--   2. Data migration: rename 'model' → 'current' (all existing GPS rows
--      from handleShareLocation are functionally equivalent to 'current')
--   3. upsert_model_location: two explicit code paths (agency / model-owned)
--   4. bulk_upsert_model_locations: add WHERE priority guard
-- =============================================================================

-- ─── 1. Update CHECK constraint ───────────────────────────────────────────────

ALTER TABLE public.model_locations
  DROP CONSTRAINT IF EXISTS model_locations_source_check;

-- Rename existing 'model' rows before adding the new constraint.
-- All previous 'model'-sourced rows were set via handleShareLocation (GPS or
-- equivalent); 'current' is the correct semantic for model-controlled location.
UPDATE public.model_locations
  SET source = 'current'
  WHERE source = 'model';

ALTER TABLE public.model_locations
  ADD CONSTRAINT model_locations_source_check
  CHECK (source IN ('live', 'current', 'agency'));

COMMENT ON COLUMN public.model_locations.source IS
  'Location data ownership: ''live'' = model browser GPS (highest priority), '
  '''current'' = model-typed city with optional geocoded lat/lng (medium priority), '
  '''agency'' = agency-set fallback when model has no account (lowest priority). '
  'Priority enforced at write time: agency writes are a no-op when source IN (''live'',''current'').';


-- ─── 2. upsert_model_location — source-aware priority enforcement ─────────────

CREATE OR REPLACE FUNCTION public.upsert_model_location(
  p_model_id                    uuid,
  p_country_code                text,
  p_city                        text        DEFAULT NULL,
  p_lat_approx                  float       DEFAULT NULL,
  p_lng_approx                  float       DEFAULT NULL,
  p_share_approximate_location  boolean     DEFAULT TRUE,
  p_source                      text        DEFAULT 'current'   -- changed from 'model'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
DECLARE
  v_lat float := CASE WHEN p_lat_approx IS NOT NULL
                      THEN ROUND(p_lat_approx::numeric, 2)::float
                      ELSE NULL END;
  v_lng float := CASE WHEN p_lng_approx IS NOT NULL
                      THEN ROUND(p_lng_approx::numeric, 2)::float
                      ELSE NULL END;
BEGIN
  -- GUARD 1: Must be authenticated
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  -- GUARD 2: Source validation (3-value enum)
  IF p_source NOT IN ('live', 'current', 'agency') THEN
    RAISE EXCEPTION 'Invalid source value: %. Must be live, current, or agency.', p_source;
  END IF;

  -- GUARD 3: Caller must own the model (model user) OR be an agency member / booker
  IF NOT (
    -- The model's own user
    EXISTS (
      SELECT 1 FROM public.models m
      WHERE m.id = p_model_id AND m.user_id = auth.uid()
    )
    -- Agency org member managing this model
    OR EXISTS (
      SELECT 1
      FROM public.models m
      JOIN public.organizations o ON o.agency_id = m.agency_id AND o.type = 'agency'
      JOIN public.organization_members om ON om.organization_id = o.id
      WHERE m.id = p_model_id AND om.user_id = auth.uid()
    )
    -- Legacy booker managing this model
    OR EXISTS (
      SELECT 1
      FROM public.models m
      JOIN public.bookers b ON b.agency_id = m.agency_id
      WHERE m.id = p_model_id AND b.user_id = auth.uid()
    )
    -- Admin override
    OR public.is_current_user_admin()
  ) THEN
    RAISE EXCEPTION 'access_denied: caller does not manage model %', p_model_id;
  END IF;

  -- ── PATH A: Agency write ────────────────────────────────────────────────────
  -- Agency sets city/country for a model with no account (fallback location).
  -- Priority enforcement: if model already owns the row (source='live' or
  -- 'current'), the ON CONFLICT WHERE is FALSE → entire UPDATE is skipped →
  -- model's lat/lng, source, share_approximate_location are fully preserved.
  IF p_source = 'agency' THEN
    INSERT INTO public.model_locations (
      model_id, country_code, city,
      lat_approx, lng_approx,
      share_approximate_location, source, updated_at
    )
    VALUES (
      p_model_id,
      UPPER(TRIM(p_country_code)),
      NULLIF(TRIM(COALESCE(p_city, '')), ''),
      NULL,   -- agencies never provide GPS coordinates
      NULL,
      FALSE,  -- agency never controls model's GPS consent
      'agency',
      now()
    )
    ON CONFLICT (model_id) DO UPDATE SET
      city         = EXCLUDED.city,
      country_code = EXCLUDED.country_code,
      updated_at   = now()
    -- PRIORITY GUARD: only update if the row is still agency-owned.
    -- If model has taken over (source='live' or 'current'): this WHERE is FALSE
    -- → the entire DO UPDATE is skipped → model data is preserved intact.
    WHERE model_locations.source = 'agency';

  -- ── PATH B: Model-owned write ('live' or 'current') ────────────────────────
  -- Model updates their own location. Always overwrites (no priority guard
  -- between 'live' and 'current' — model switches modes explicitly).
  ELSE
    INSERT INTO public.model_locations (
      model_id, country_code, city,
      lat_approx, lng_approx,
      share_approximate_location, source, updated_at
    )
    VALUES (
      p_model_id,
      UPPER(TRIM(p_country_code)),
      NULLIF(TRIM(COALESCE(p_city, '')), ''),
      CASE WHEN p_share_approximate_location THEN v_lat ELSE NULL END,
      CASE WHEN p_share_approximate_location THEN v_lng ELSE NULL END,
      p_share_approximate_location,
      p_source,
      now()
    )
    ON CONFLICT (model_id) DO UPDATE SET
      city                       = EXCLUDED.city,
      country_code               = EXCLUDED.country_code,
      lat_approx                 = EXCLUDED.lat_approx,
      lng_approx                 = EXCLUDED.lng_approx,
      share_approximate_location = EXCLUDED.share_approximate_location,
      source                     = EXCLUDED.source,
      updated_at                 = now();
    -- No WHERE: model-owned writes always win. The model is in control.
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_model_location(
  uuid, text, text, float, float, boolean, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_model_location(
  uuid, text, text, float, float, boolean, text
) TO authenticated;

COMMENT ON FUNCTION public.upsert_model_location IS
  'UPDATED (20260406-v2): 3-source priority system. '
  'source=''agency'': ON CONFLICT WHERE source=''agency'' ensures agency writes are a '
  'complete no-op if model already owns the row (source=live/current). '
  'source=''live''|''current'': model-owned writes always succeed. '
  'Default source changed from ''model'' to ''current''.';


-- ─── 3. bulk_upsert_model_locations — priority guard ─────────────────────────

CREATE OR REPLACE FUNCTION public.bulk_upsert_model_locations(
  p_model_ids    uuid[],
  p_country_code text,
  p_city         text    DEFAULT NULL,
  p_lat_approx   float   DEFAULT NULL,
  p_lng_approx   float   DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
DECLARE
  v_model_id  uuid;
  v_count     integer := 0;
  v_lat       float := CASE WHEN p_lat_approx IS NOT NULL
                            THEN ROUND(p_lat_approx::numeric, 2)::float
                            ELSE NULL END;
  v_lng       float := CASE WHEN p_lng_approx IS NOT NULL
                            THEN ROUND(p_lng_approx::numeric, 2)::float
                            ELSE NULL END;
BEGIN
  FOREACH v_model_id IN ARRAY p_model_ids
  LOOP
    -- Verify caller is an agency org member OR legacy booker for this model.
    IF NOT (
      EXISTS (
        SELECT 1
        FROM   public.models m
        JOIN   public.organizations o
                 ON  o.agency_id = m.agency_id
                 AND o.type      = 'agency'
        JOIN   public.organization_members om
                 ON  om.organization_id = o.id
        WHERE  m.id       = v_model_id
          AND  om.user_id = auth.uid()
      )
      OR EXISTS (
        SELECT 1
        FROM   public.models m
        JOIN   public.bookers b ON b.agency_id = m.agency_id
        WHERE  m.id      = v_model_id
          AND  b.user_id = auth.uid()
      )
      OR public.is_current_user_admin()
    ) THEN
      CONTINUE;  -- skip models the caller doesn't manage
    END IF;

    INSERT INTO public.model_locations (
      model_id, country_code, city, lat_approx, lng_approx,
      share_approximate_location, source, updated_at
    )
    VALUES (
      v_model_id,
      UPPER(TRIM(p_country_code)),
      NULLIF(TRIM(COALESCE(p_city, '')), ''),
      v_lat,
      v_lng,
      FALSE,      -- agency never has GPS consent; share is model-owned
      'agency',
      now()
    )
    ON CONFLICT (model_id) DO UPDATE SET
      country_code               = UPPER(TRIM(p_country_code)),
      city                       = NULLIF(TRIM(COALESCE(p_city, '')), ''),
      lat_approx                 = v_lat,
      lng_approx                 = v_lng,
      share_approximate_location = model_locations.share_approximate_location,
      source                     = 'agency',
      updated_at                 = now()
    -- PRIORITY GUARD: skip update if model owns the location.
    -- Model data (lat/lng, source, share_approximate_location) is fully preserved.
    WHERE model_locations.source = 'agency';

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.bulk_upsert_model_locations(
  uuid[], text, text, float, float
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bulk_upsert_model_locations(
  uuid[], text, text, float, float
) TO authenticated;

COMMENT ON FUNCTION public.bulk_upsert_model_locations IS
  'UPDATED (20260406-v2): agency bulk write — ON CONFLICT WHERE source=''agency'' '
  'ensures model-owned locations (live/current) are never overwritten. '
  'Agency data only written/updated when the row has no model-owned source.';


-- ─── Verification ─────────────────────────────────────────────────────────────
DO $$
BEGIN
  -- Verify constraint exists with correct values
  ASSERT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_schema = 'public'
      AND constraint_name   = 'model_locations_source_check'
      AND check_clause ILIKE '%live%'
      AND check_clause ILIKE '%current%'
      AND check_clause ILIKE '%agency%'
  ), 'model_locations_source_check must include live, current, agency';

  -- Verify no 'model' rows remain
  ASSERT NOT EXISTS (
    SELECT 1 FROM public.model_locations WHERE source = 'model'
  ), 'All model_locations rows must have source migrated away from ''model''';

  -- Verify functions updated
  ASSERT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'upsert_model_location' AND p.prosecdef = true
  ), 'upsert_model_location must be SECURITY DEFINER';

  ASSERT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'bulk_upsert_model_locations' AND p.prosecdef = true
  ), 'bulk_upsert_model_locations must be SECURITY DEFINER';

  RAISE NOTICE '20260406_location_source_v2: 3-source priority system deployed OK';
END $$;

-- =============================================================================
-- Location — Agency writes support geocoded coordinates for Near Me
-- Date: 2026-04-06 (after 20260406_location_source_v2.sql)
--
-- Problem: The previous migration hardcoded lat_approx=NULL, lng_approx=NULL,
-- share_approximate_location=FALSE for all agency writes. This means agency-
-- managed models (those without their own accounts) NEVER appear in the Near Me
-- radius filter, even though they have a known city/country.
--
-- Fix: When the frontend geocodes the agency's city+country via Nominatim and
-- passes lat/lng to the RPC, those coordinates SHOULD be stored and
-- share_approximate_location SHOULD be set to TRUE. This makes agency-managed
-- models visible in Near Me — consistent with the requirement that all three
-- location sources (live, current, agency) can be used for global filter logic.
--
-- Priority invariant is preserved: agency writes are still blocked by
-- "WHERE model_locations.source = 'agency'" — model-owned rows are untouched.
--
-- Changes vs 20260406_location_source_v2.sql:
--   upsert_model_location agency path:
--     BEFORE: lat_approx = NULL, lng_approx = NULL, share = FALSE (hardcoded)
--     AFTER:  lat_approx = v_lat, lng_approx = v_lng, share = (v_lat IS NOT NULL)
--
--   bulk_upsert_model_locations:
--     BEFORE: share_approximate_location = FALSE (INSERT), preserved on UPDATE
--     AFTER:  share_approximate_location = (v_lat IS NOT NULL) on both INSERT + UPDATE
-- =============================================================================

-- ─── 1. upsert_model_location — agency path now accepts geocoded coordinates ──

CREATE OR REPLACE FUNCTION public.upsert_model_location(
  p_model_id                    uuid,
  p_country_code                text,
  p_city                        text        DEFAULT NULL,
  p_lat_approx                  float       DEFAULT NULL,
  p_lng_approx                  float       DEFAULT NULL,
  p_share_approximate_location  boolean     DEFAULT TRUE,
  p_source                      text        DEFAULT 'current'
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

  -- GUARD 3: Caller must own the model OR be an agency member / booker
  IF NOT (
    EXISTS (
      SELECT 1 FROM public.models m
      WHERE m.id = p_model_id AND m.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1
      FROM public.models m
      JOIN public.organizations o ON o.agency_id = m.agency_id AND o.type = 'agency'
      JOIN public.organization_members om ON om.organization_id = o.id
      WHERE m.id = p_model_id AND om.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1
      FROM public.models m
      JOIN public.bookers b ON b.agency_id = m.agency_id
      WHERE m.id = p_model_id AND b.user_id = auth.uid()
    )
    OR public.is_current_user_admin()
  ) THEN
    RAISE EXCEPTION 'access_denied: caller does not manage model %', p_model_id;
  END IF;

  -- ── PATH A: Agency write ────────────────────────────────────────────────────
  -- Agency sets city/country (with optional geocoded lat/lng from Nominatim).
  -- share_approximate_location = TRUE only when geocoded coordinates are available,
  -- so agency models without coordinates still stay hidden from Near Me.
  --
  -- PRIORITY GUARD: ON CONFLICT WHERE model_locations.source = 'agency'
  -- → if model owns the row (source='live' or 'current'): WHERE is FALSE
  -- → entire UPDATE is skipped → model data is fully preserved.
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
      v_lat,                          -- use geocoded coordinates if provided
      v_lng,
      (v_lat IS NOT NULL),            -- enable Near Me only when geocoded
      'agency',
      now()
    )
    ON CONFLICT (model_id) DO UPDATE SET
      city                       = EXCLUDED.city,
      country_code               = EXCLUDED.country_code,
      lat_approx                 = EXCLUDED.lat_approx,
      lng_approx                 = EXCLUDED.lng_approx,
      share_approximate_location = EXCLUDED.share_approximate_location,
      updated_at                 = now()
    -- PRIORITY GUARD: agency writes are a no-op when model owns the row.
    WHERE model_locations.source = 'agency';

  -- ── PATH B: Model-owned write ('live' or 'current') ────────────────────────
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
  'UPDATED (20260406-agency-nearme): agency path now stores geocoded lat/lng when provided '
  'and sets share_approximate_location = (lat IS NOT NULL), enabling agency-managed models '
  'to appear in Near Me when the frontend geocodes their city. Priority invariant preserved.';


-- ─── 2. bulk_upsert_model_locations — share flag based on lat/lng availability ─

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
  -- Enable Near Me for agency models when geocoded coordinates are provided.
  -- Without lat/lng the model stays hidden from radius queries (no false positives).
  v_share     boolean := (v_lat IS NOT NULL);
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
      CONTINUE;
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
      v_share,   -- TRUE when geocoded coordinates are available (enables Near Me)
      'agency',
      now()
    )
    ON CONFLICT (model_id) DO UPDATE SET
      country_code               = UPPER(TRIM(p_country_code)),
      city                       = NULLIF(TRIM(COALESCE(p_city, '')), ''),
      lat_approx                 = v_lat,
      lng_approx                 = v_lng,
      share_approximate_location = v_share,   -- update share flag based on new lat/lng
      source                     = 'agency',
      updated_at                 = now()
    -- PRIORITY GUARD: no-op if model owns the row (source=live/current).
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
  'UPDATED (20260406-agency-nearme): share_approximate_location = (lat IS NOT NULL) — '
  'agency models with geocoded city appear in Near Me, those without coordinates do not. '
  'Priority invariant preserved via WHERE model_locations.source = ''agency''.';


-- ─── Verification ─────────────────────────────────────────────────────────────
DO $$
BEGIN
  -- Both functions must exist and be SECURITY DEFINER
  ASSERT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'upsert_model_location' AND p.prosecdef = true
  ), 'upsert_model_location must be SECURITY DEFINER';

  ASSERT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'bulk_upsert_model_locations' AND p.prosecdef = true
  ), 'bulk_upsert_model_locations must be SECURITY DEFINER';

  RAISE NOTICE '20260406_location_source_agency_nearme: agency Near Me support deployed OK';
END $$;

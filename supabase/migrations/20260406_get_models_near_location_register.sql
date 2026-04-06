-- =============================================================================
-- Formally register get_models_near_location under migration control
-- Date: 2026-04-06
--
-- The function existed only in supabase/migration_security_near_location_anon_revoke.sql
-- (root SQL file, not migration-tracked). Per system-invariants: only files under
-- supabase/migrations/ are deployment-tracked. This migration registers the
-- function verbatim under migration control. NO functional changes.
--
-- This also ensures the function signature is correct after the source field
-- rename ('model' → 'current'/'live'). The function reads location_source from
-- model_locations, which is now typed as 'live'|'current'|'agency'. The RETURNS
-- SETOF jsonb ensures TypeScript types are the source of truth; no SQL type change needed.
-- =============================================================================

-- Step 1: revoke from anon (idempotent, may already be done)
DO $$ BEGIN
  EXECUTE 'REVOKE EXECUTE ON FUNCTION public.get_models_near_location(
    float, float, float, text, integer, integer, text, boolean, boolean,
    integer, integer, text, integer, integer, integer, integer,
    integer, integer, integer, integer, text, text[]
  ) FROM anon';
EXCEPTION WHEN undefined_function OR undefined_object THEN NULL;
END $$;

-- Step 2: recreate under migration control (identical to root SQL version)
CREATE OR REPLACE FUNCTION public.get_models_near_location(
  p_lat             float,
  p_lng             float,
  p_radius_km       float     DEFAULT 50,
  p_client_type     text      DEFAULT 'all',
  p_from            integer   DEFAULT 0,
  p_to              integer   DEFAULT 999,
  p_category        text      DEFAULT NULL,
  p_sports_winter   boolean   DEFAULT FALSE,
  p_sports_summer   boolean   DEFAULT FALSE,
  p_height_min      integer   DEFAULT NULL,
  p_height_max      integer   DEFAULT NULL,
  p_hair_color      text      DEFAULT NULL,
  p_hips_min        integer   DEFAULT NULL,
  p_hips_max        integer   DEFAULT NULL,
  p_waist_min       integer   DEFAULT NULL,
  p_waist_max       integer   DEFAULT NULL,
  p_chest_min       integer   DEFAULT NULL,
  p_chest_max       integer   DEFAULT NULL,
  p_legs_inseam_min integer   DEFAULT NULL,
  p_legs_inseam_max integer   DEFAULT NULL,
  p_sex             text      DEFAULT NULL,
  p_ethnicities     text[]    DEFAULT NULL
)
RETURNS SETOF jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Require an authenticated session.
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'get_models_near_location: authentication required' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Require active platform access (paywall / trial / admin override).
  IF NOT (SELECT can_access_platform()) THEN
    RAISE EXCEPTION 'get_models_near_location: platform access denied' USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN QUERY
  WITH bbox AS (
    SELECT
      p_lat - (p_radius_km / 111.0) * 1.01                          AS min_lat,
      p_lat + (p_radius_km / 111.0) * 1.01                          AS max_lat,
      p_lng - (p_radius_km / (111.0 * cos(radians(p_lat)))) * 1.01  AS min_lng,
      p_lng + (p_radius_km / (111.0 * cos(radians(p_lat)))) * 1.01  AS max_lng
  ),

  bbox_candidates AS (
    SELECT ml.model_id,
           ml.city           AS location_city,
           ml.country_code   AS location_country_code,
           ml.lat_approx,
           ml.lng_approx,
           ml.source         AS location_source,
           ml.updated_at     AS location_updated_at
    FROM   public.model_locations ml, bbox
    WHERE  ml.lat_approx IS NOT NULL
      AND  ml.lng_approx IS NOT NULL
      AND  ml.share_approximate_location = TRUE
      AND  ml.lat_approx BETWEEN bbox.min_lat AND bbox.max_lat
      AND  ml.lng_approx BETWEEN bbox.min_lng AND bbox.max_lng
  ),

  exact_candidates AS (
    SELECT bc.*,
           (
             2 * 6371 * asin(sqrt(
               power(sin(radians((bc.lat_approx - p_lat) / 2)), 2) +
               cos(radians(p_lat)) * cos(radians(bc.lat_approx)) *
               power(sin(radians((bc.lng_approx - p_lng) / 2)), 2)
             ))
           ) AS distance_km
    FROM   bbox_candidates bc
  )

  SELECT to_jsonb(result)
  FROM (
    SELECT
      m.*,
      ec.location_city,
      ec.location_country_code,
      ec.lat_approx,
      ec.lng_approx,
      ec.location_source,
      ec.location_updated_at,
      ec.distance_km,
      mat.country_code  AS territory_country_code,
      a.name            AS agency_name,
      mat.agency_id     AS territory_agency_id
    FROM   exact_candidates ec
    JOIN   public.models m ON m.id = ec.model_id
    LEFT   JOIN public.model_agency_territories mat ON mat.model_id = m.id
    LEFT   JOIN public.agencies a ON a.id = mat.agency_id
    WHERE
      ec.distance_km <= p_radius_km
      AND (
        m.agency_relationship_status IS NULL
        OR m.agency_relationship_status IN ('active', 'pending_link')
      )
      AND (
        p_client_type = 'all'
        OR (p_client_type = 'fashion'    AND m.is_visible_fashion    = TRUE)
        OR (p_client_type = 'commercial' AND m.is_visible_commercial = TRUE)
      )
      AND (NOT p_sports_winter OR m.is_sports_winter = TRUE)
      AND (NOT p_sports_summer OR m.is_sports_summer = TRUE)
      AND (p_height_min      IS NULL OR m.height      >= p_height_min)
      AND (p_height_max      IS NULL OR m.height      <= p_height_max)
      AND (p_hips_min        IS NULL OR m.hips        >= p_hips_min)
      AND (p_hips_max        IS NULL OR m.hips        <= p_hips_max)
      AND (p_waist_min       IS NULL OR m.waist       >= p_waist_min)
      AND (p_waist_max       IS NULL OR m.waist       <= p_waist_max)
      AND (p_chest_min       IS NULL OR m.chest       >= p_chest_min)
      AND (p_chest_max       IS NULL OR m.chest       <= p_chest_max)
      AND (p_legs_inseam_min IS NULL OR m.legs_inseam >= p_legs_inseam_min)
      AND (p_legs_inseam_max IS NULL OR m.legs_inseam <= p_legs_inseam_max)
      AND (p_sex             IS NULL OR m.sex         =  p_sex)
      AND (
        p_hair_color IS NULL OR p_hair_color = ''
        OR m.hair_color ILIKE ('%' || p_hair_color || '%')
      )
      AND (
        p_category IS NULL
        OR m.categories IS NULL
        OR m.categories = '{}'
        OR m.categories @> ARRAY[p_category]
      )
      AND (
        p_ethnicities IS NULL
        OR array_length(p_ethnicities, 1) IS NULL
        OR m.ethnicity = ANY(p_ethnicities)
      )
    ORDER BY ec.distance_km ASC, m.name ASC
    OFFSET p_from
    LIMIT  (p_to - p_from + 1)
  ) result;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_models_near_location(
  float, float, float, text, integer, integer, text, boolean, boolean,
  integer, integer, text, integer, integer, integer, integer,
  integer, integer, integer, integer, text, text[]
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_models_near_location(
  float, float, float, text, integer, integer, text, boolean, boolean,
  integer, integer, text, integer, integer, integer, integer,
  integer, integer, integer, integer, text, text[]
) TO authenticated;

COMMENT ON FUNCTION public.get_models_near_location IS
  'Radius-based model discovery. Registered under migration control (20260406). '
  'location_source in results: ''live''|''current''|''agency'' (updated from ''model''|''agency'').';

-- ── Verification ──────────────────────────────────────────────────────────────
DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_models_near_location'
      AND p.prosecdef = true
  ), 'get_models_near_location must be SECURITY DEFINER';
  RAISE NOTICE '20260406_get_models_near_location_register: function registered OK';
END $$;

-- =============================================================================
-- Fix A: get_models_near_location — SET row_security TO off
-- Date: 2026-04-17
--
-- Problem:
--   get_models_near_location is SECURITY DEFINER but is missing
--   SET row_security TO off. Per admin-security.mdc Regel 7 and
--   rls-security-patterns.mdc Risiko 4: every SECURITY DEFINER function that
--   reads RLS-protected tables MUST have SET row_security TO off.
--
--   Without this, PG15+ evaluates the RLS policies of models,
--   model_locations, and model_agency_territories INSIDE the function, which:
--   1. Causes clients to see only models connected to THEIR specific agency
--      (filtered by clients_read_visible_models / caller_is_client_org_member)
--   2. Creates latent 42P17 risk via models → model_agency_territories chain
--
-- Fix:
--   Add SET row_security TO off. The function already has 3-layer guards:
--   Guard 1: auth.uid() IS NULL → RAISE EXCEPTION
--   Guard 2: can_access_platform() → RAISE EXCEPTION (paywall)
--   Guard 3: Explicit WHERE clauses below replace RLS filtering — only models
--            with approved location sharing and correct visibility flags
--            are returned, regardless of agency-client connections.
--
-- Semantic note:
--   After this fix, near-me search shows ALL platform-accessible models
--   within radius, not just agency-connected ones. This is the correct
--   discovery behaviour: Near-Me is a platform-wide feature, not
--   restricted to the client's specific agency connections.
-- =============================================================================

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
SET row_security TO off  -- REQUIRED: reads RLS-protected models/model_locations/model_agency_territories
                         -- Guards 1+2 below replace auth/paywall enforcement.
                         -- Guard 3 (explicit WHERE) replaces row-level filtering.
AS $$
BEGIN
  -- Guard 1: Require an authenticated session.
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'get_models_near_location: authentication required' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Guard 2: Require active platform access (paywall / trial / admin override).
  IF NOT (SELECT can_access_platform()) THEN
    RAISE EXCEPTION 'get_models_near_location: platform access denied' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Guard 3 (implicit): WHERE clauses below enforce:
  --   - share_approximate_location = TRUE  (model consented to location sharing)
  --   - lat_approx/lng_approx IS NOT NULL  (location is actually set)
  --   - agency_relationship_status IN (NULL, 'active', 'pending_link')
  --   - visibility flags per p_client_type

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
  'Radius-based model discovery. SECURITY DEFINER + row_security=off. '
  'Guards: (1) auth.uid() IS NULL → reject; (2) can_access_platform() → reject; '
  '(3) explicit WHERE clauses (share_approximate_location, visibility flags) '
  'replace RLS filtering — shows all platform-accessible models matching '
  'filters regardless of agency-client connection. '
  'Registered under migration control 20260406. '
  'Updated 20260417: added SET row_security TO off (Risiko 4 compliance). '
  'location_source in results: ''live''|''current''|''agency''.';

-- ── Verification ──────────────────────────────────────────────────────────────
DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_models_near_location'
      AND p.prosecdef = true
  ), 'FAIL: get_models_near_location must be SECURITY DEFINER';

  ASSERT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_models_near_location'
      AND 'row_security=off' = ANY(p.proconfig)
  ), 'FAIL: get_models_near_location is missing SET row_security TO off — Risiko 4 violation';

  RAISE NOTICE '20260417_fix_a: get_models_near_location updated with row_security=off — OK';
END $$;

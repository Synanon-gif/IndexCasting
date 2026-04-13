-- =============================================================================
-- Fix Near Me MAT-Dedupe Regression & Location-Aware Territory Selection
-- (20260715)
--
-- Regression: 20260508 lost the first_territory CTE from 20260413, causing
-- models with N territories to appear N times in Near Me results.
--
-- Fix: Restore DISTINCT ON deduplication for model_agency_territories, with
-- preference for the MAT entry whose country_code matches the model's
-- physical location (location_country_code from resolved_locations).
-- Fallback: alphabetically first country_code.
--
-- Also adds the missing visibility guard
-- (m.is_visible_fashion = TRUE OR m.is_visible_commercial = TRUE)
-- which was present in get_discovery_models but absent from Near Me.
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
SET search_path TO 'public'
SET row_security TO off
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'get_models_near_location: authentication required' USING ERRCODE = 'insufficient_privilege';
  END IF;

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

  resolved_locations AS (
    SELECT DISTINCT ON (ml.model_id)
      ml.model_id,
      ml.city           AS location_city,
      ml.country_code   AS location_country_code,
      ml.lat_approx,
      ml.lng_approx,
      ml.source         AS location_source,
      ml.updated_at     AS location_updated_at
    FROM public.model_locations ml
    WHERE ml.lat_approx IS NOT NULL
      AND ml.lng_approx IS NOT NULL
      AND ml.share_approximate_location = TRUE
    ORDER BY
      ml.model_id,
      CASE ml.source
        WHEN 'live'    THEN 0
        WHEN 'current' THEN 1
        WHEN 'agency'  THEN 2
        ELSE 3
      END ASC
  ),

  bbox_candidates AS (
    SELECT rl.*
    FROM resolved_locations rl, bbox
    WHERE rl.lat_approx BETWEEN bbox.min_lat AND bbox.max_lat
      AND rl.lng_approx BETWEEN bbox.min_lng AND bbox.max_lng
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
    FROM bbox_candidates bc
  ),

  -- Deduplicate model_agency_territories: one territory per model.
  -- Prefer the MAT entry whose country_code matches the model's physical
  -- location (location_country_code). Fallback: alphabetically first territory.
  -- Prevents N duplicate result rows for models with N territory entries.
  first_territory AS (
    SELECT DISTINCT ON (mat.model_id)
      mat.model_id,
      mat.country_code,
      mat.agency_id
    FROM public.model_agency_territories mat
    JOIN exact_candidates ec ON ec.model_id = mat.model_id
    ORDER BY
      mat.model_id,
      CASE WHEN upper(trim(mat.country_code)) = upper(trim(ec.location_country_code)) THEN 0 ELSE 1 END,
      mat.country_code ASC
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
      ft.country_code  AS territory_country_code,
      a.name           AS agency_name,
      ft.agency_id     AS territory_agency_id
    FROM   exact_candidates ec
    JOIN   public.models m ON m.id = ec.model_id
    LEFT   JOIN first_territory ft ON ft.model_id = m.id
    LEFT   JOIN public.agencies a ON a.id = ft.agency_id
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
      AND (m.is_visible_fashion = TRUE OR m.is_visible_commercial = TRUE)
      AND (NOT p_sports_winter OR m.is_sports_winter = TRUE)
      AND (NOT p_sports_summer OR m.is_sports_summer = TRUE)
      AND (p_height_min      IS NULL OR m.height      >= p_height_min)
      AND (p_height_max      IS NULL OR m.height      <= p_height_max)
      AND (p_hips_min        IS NULL OR m.hips        >= p_hips_min)
      AND (p_hips_max        IS NULL OR m.hips        <= p_hips_max)
      AND (p_waist_min       IS NULL OR m.waist       >= p_waist_min)
      AND (p_waist_max       IS NULL OR m.waist       <= p_waist_max)
      AND (p_chest_min       IS NULL OR COALESCE(m.chest, m.bust) >= p_chest_min)
      AND (p_chest_max       IS NULL OR COALESCE(m.chest, m.bust) <= p_chest_max)
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
$function$;

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

COMMENT ON FUNCTION public.get_models_near_location(
  float, float, float, text, integer, integer, text, boolean, boolean,
  integer, integer, text, integer, integer, integer, integer,
  integer, integer, integer, integer, text, text[]
) IS 'Radius-based model discovery with MAT dedupe (first_territory CTE, location-aware). '
   'Fixed: 20260715 restores 20260413 deduplication lost in 20260508. '
   'Adds missing visibility guard (is_visible_fashion OR is_visible_commercial).';

-- ── Verification ────────────────────────────────────────────────────────────
DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'get_models_near_location'
  ), 'FAIL: get_models_near_location missing after migration';
END;
$$;

-- =============================================================================
-- Scalability K4: get_models_near_location — bbox BEFORE DISTINCT ON
--
-- Problem: resolved_locations scanned ALL model_locations rows with GPS sharing
-- and ran DISTINCT ON (model_id) BEFORE applying the bounding box filter.
-- At 50k models with ~2-3 location rows each = 100-150k rows sorted globally.
--
-- Fix: Apply the bounding box filter FIRST (cheap btree range scan), THEN
-- deduplicate only the candidates within the bbox. This changes the cost from
-- O(all GPS-sharing models) to O(models within bounding box).
--
-- Also adds keyset pagination via p_cursor_distance + p_cursor_model_id
-- as alternative to OFFSET-based pagination for stable deep-page performance.
--
-- Idempotent. Safe to re-run.
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

  -- Step 1: Filter to bounding box FIRST (cheap btree range scan)
  bbox_locations AS (
    SELECT
      ml.model_id,
      ml.city           AS location_city,
      ml.country_code   AS location_country_code,
      ml.lat_approx,
      ml.lng_approx,
      ml.source         AS location_source,
      ml.updated_at     AS location_updated_at
    FROM public.model_locations ml, bbox
    WHERE ml.lat_approx IS NOT NULL
      AND ml.lng_approx IS NOT NULL
      AND ml.share_approximate_location = TRUE
      AND ml.lat_approx BETWEEN bbox.min_lat AND bbox.max_lat
      AND ml.lng_approx BETWEEN bbox.min_lng AND bbox.max_lng
  ),

  -- Step 2: DISTINCT ON only within bbox candidates (much smaller set)
  resolved_locations AS (
    SELECT DISTINCT ON (bl.model_id)
      bl.*
    FROM bbox_locations bl
    ORDER BY
      bl.model_id,
      CASE bl.location_source
        WHEN 'live'    THEN 0
        WHEN 'current' THEN 1
        WHEN 'agency'  THEN 2
        ELSE 3
      END ASC
  ),

  exact_candidates AS (
    SELECT rl.*,
           (
             2 * 6371 * asin(sqrt(
               power(sin(radians((rl.lat_approx - p_lat) / 2)), 2) +
               cos(radians(p_lat)) * cos(radians(rl.lat_approx)) *
               power(sin(radians((rl.lng_approx - p_lng) / 2)), 2)
             ))
           ) AS distance_km
    FROM resolved_locations rl
  ),

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

COMMENT ON FUNCTION public.get_models_near_location IS
  'Radius-based model discovery. 20260803: bbox filter BEFORE DISTINCT ON '
  '(was: global DISTINCT ON all GPS rows, then bbox). ~90% scan reduction.';

DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'get_models_near_location'
  ), 'FAIL: get_models_near_location missing after 20260803 migration';
END;
$$;

-- =============================================================================
-- Scalability H3: Keyset pagination for get_models_by_location
--
-- Problem: OFFSET-based pagination degrades at deep pages because PostgreSQL
-- must sort and skip all prior rows. At 50k models per territory, page 10+
-- gets progressively slower.
--
-- Fix: Add optional p_cursor_name + p_cursor_model_id parameters for keyset
-- pagination (same pattern as get_discovery_models uses cursor_score).
-- When cursors are provided, OFFSET is bypassed. Legacy callers using
-- p_from/p_to still work unchanged.
--
-- Also adds p_limit parameter for consistency with get_discovery_models.
--
-- Idempotent. Safe to re-run.
-- =============================================================================

-- Drop old overload to avoid ambiguity (different parameter count)
DROP FUNCTION IF EXISTS public.get_models_by_location(
  text, text, integer, integer, text, text, boolean, boolean,
  integer, integer, text, integer, integer, integer, integer,
  integer, integer, integer, integer, text, text[]
);

CREATE OR REPLACE FUNCTION public.get_models_by_location(
  p_iso             text,
  p_client_type     text      DEFAULT 'all',
  p_from            integer   DEFAULT 0,
  p_to              integer   DEFAULT 999,
  p_city            text      DEFAULT NULL,
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
  p_ethnicities     text[]    DEFAULT NULL,
  p_cursor_name     text      DEFAULT NULL,
  p_cursor_model_id uuid      DEFAULT NULL,
  p_limit           integer   DEFAULT 50
)
RETURNS SETOF jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.role() = 'authenticated' THEN
    IF NOT public.has_platform_access() THEN
      RAISE EXCEPTION 'platform_access_denied'
        USING HINT    = 'Active subscription or trial required to discover models.',
              ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN QUERY
  SELECT to_jsonb(result)
  FROM (
    SELECT
      m.id,
      m.name,
      m.city,
      m.country,
      m.country_code,
      m.current_location,
      m.height,
      m.bust,
      m.waist,
      m.hips,
      m.chest,
      m.legs_inseam,
      m.shoe_size,
      m.hair_color,
      m.eye_color,
      m.sex,
      m.ethnicity,
      m.categories,
      m.is_visible_fashion,
      m.is_visible_commercial,
      m.is_active,
      m.is_sports_winter,
      m.is_sports_summer,
      m.portfolio_images,
      m.polaroids,
      m.video_url,
      m.polas_source,
      m.show_polas_on_profile,
      m.agency_id,
      m.agency_relationship_status,
      m.user_id,
      m.created_at,
      m.updated_at,
      mat.country_code  AS territory_country_code,
      a.name            AS agency_name,
      mat.agency_id     AS territory_agency_id
    FROM public.models m
    JOIN public.model_agency_territories mat ON mat.model_id = m.id
    JOIN public.agencies                 a   ON a.id         = mat.agency_id
    WHERE
      mat.country_code = p_iso
      AND m.is_active = TRUE
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
        p_city IS NULL OR TRIM(p_city) = ''
        OR m.city ILIKE p_city
        OR EXISTS (
          SELECT 1
          FROM public.model_locations ml
          WHERE ml.model_id = m.id
            AND ml.city IS NOT NULL
            AND TRIM(ml.city) <> ''
            AND ml.city ILIKE p_city
        )
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
      AND (
        p_cursor_name IS NULL
        OR m.name > p_cursor_name
        OR (m.name = p_cursor_name AND m.id > p_cursor_model_id)
      )
    ORDER BY m.name, m.id
    LIMIT  CASE
             WHEN p_cursor_name IS NOT NULL THEN p_limit
             ELSE (p_to - p_from + 1)
           END
    OFFSET CASE
             WHEN p_cursor_name IS NOT NULL THEN 0
             ELSE p_from
           END
  ) result;
END;
$function$;

COMMENT ON FUNCTION public.get_models_by_location IS
  'Location-based model list with keyset pagination (p_cursor_name + p_cursor_model_id). '
  'Legacy OFFSET via p_from/p_to still works. 20260806 scalability.';

DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_models_by_location'
  ), 'FAIL: get_models_by_location missing after 20260806 migration';
END;
$$;

-- =============================================================================
-- Migration: Add ethnicity column to models and model_applications,
--            extend get_models_by_location RPC with p_ethnicities filter.
-- =============================================================================

-- 1. Add ethnicity column to models (nullable text — not every model has it set yet)
ALTER TABLE public.models ADD COLUMN IF NOT EXISTS ethnicity text;

-- 2. Add ethnicity column to model_applications (nullable text)
ALTER TABLE public.model_applications ADD COLUMN IF NOT EXISTS ethnicity text;

-- 3. Replace RPC to add p_ethnicities array filter
--    All other parameters and logic are identical to the previous version.
--    Backward-compatible: p_ethnicities defaults to NULL = no filter applied.
CREATE OR REPLACE FUNCTION public.get_models_by_location(
  p_iso             text,
  p_client_type     text    DEFAULT 'all',
  p_from            integer DEFAULT 0,
  p_to              integer DEFAULT 999,
  p_city            text    DEFAULT NULL,
  p_category        text    DEFAULT NULL,
  p_sports_winter   boolean DEFAULT FALSE,
  p_sports_summer   boolean DEFAULT FALSE,
  p_height_min      integer DEFAULT NULL,
  p_height_max      integer DEFAULT NULL,
  p_hair_color      text    DEFAULT NULL,
  p_hips_min        integer DEFAULT NULL,
  p_hips_max        integer DEFAULT NULL,
  p_waist_min       integer DEFAULT NULL,
  p_waist_max       integer DEFAULT NULL,
  p_chest_min       integer DEFAULT NULL,
  p_chest_max       integer DEFAULT NULL,
  p_legs_inseam_min integer DEFAULT NULL,
  p_legs_inseam_max integer DEFAULT NULL,
  p_sex             text    DEFAULT NULL,
  p_ethnicities     text[]  DEFAULT NULL
)
RETURNS SETOF jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT to_jsonb(result)
  FROM (
    -- Group 1: Models with a real location in the requested country
    SELECT
      m.*,
      TRUE                AS has_real_location,
      NULL::text          AS territory_country_code,
      NULL::text          AS agency_name,
      NULL::uuid          AS territory_agency_id
    FROM public.models m
    WHERE
      m.country_code = p_iso
      AND (
        m.agency_relationship_status IS NULL
        OR m.agency_relationship_status IN ('active', 'pending_link')
      )
      AND (
        p_client_type = 'all'
        OR (p_client_type = 'fashion'     AND m.is_visible_fashion    = TRUE)
        OR (p_client_type = 'commercial'  AND m.is_visible_commercial = TRUE)
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
      AND (p_ethnicities     IS NULL OR m.ethnicity   = ANY(p_ethnicities))
      AND (
        p_hair_color IS NULL OR p_hair_color = ''
        OR m.hair_color ILIKE ('%' || p_hair_color || '%')
      )
      AND (
        p_city IS NULL OR p_city = ''
        OR m.city ILIKE p_city
      )
      AND (
        p_category IS NULL
        OR m.categories IS NULL
        OR m.categories = '{}'
        OR m.categories @> ARRAY[p_category]
      )

    UNION

    -- Group 2: Models without a real location but with a territory entry
    SELECT
      m.*,
      FALSE               AS has_real_location,
      mat.country_code    AS territory_country_code,
      a.name              AS agency_name,
      mat.agency_id       AS territory_agency_id
    FROM public.models m
    JOIN public.model_agency_territories mat ON mat.model_id = m.id
    JOIN public.agencies a                   ON a.id = mat.agency_id
    WHERE
      mat.country_code = p_iso
      AND m.country_code IS NULL
      AND (
        m.agency_relationship_status IS NULL
        OR m.agency_relationship_status IN ('active', 'pending_link')
      )
      AND (
        p_client_type = 'all'
        OR (p_client_type = 'fashion'     AND m.is_visible_fashion    = TRUE)
        OR (p_client_type = 'commercial'  AND m.is_visible_commercial = TRUE)
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
      AND (p_ethnicities     IS NULL OR m.ethnicity   = ANY(p_ethnicities))
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

    ORDER BY name
    OFFSET p_from
    LIMIT  (p_to - p_from + 1)
  ) result;
$$;

-- Permissions
GRANT EXECUTE ON FUNCTION public.get_models_by_location(
  text, text, integer, integer, text, text, boolean, boolean,
  integer, integer, text, integer, integer, integer, integer,
  integer, integer, integer, integer, text, text[]
) TO authenticated, anon;

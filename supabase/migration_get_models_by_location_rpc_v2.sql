-- =============================================================================
-- RPC v2: get_models_by_location
--
-- Breaking change from v1:
--   Territory of representation is now the SOLE criterion for a model to
--   appear in location-based client discovery. The v1 "Gruppe 1" that matched
--   models by home country_code alone (without a territory entry) has been
--   removed. A model must have at least one model_agency_territories row for
--   the searched ISO code to appear.
--
-- This aligns with the product rule:
--   "A model appears to clients ONLY if the agency has assigned at least one
--    territory of representation."
--
-- Changes vs v1:
--   - Single SELECT branch (UNION removed) — territory join is now mandatory.
--   - Added p_ethnicities parameter for ethnicity multi-select filter.
--   - has_real_location column replaced by territory_country_code for clarity.
--   - GRANT updated to include new parameter signature.
--
-- Performance: all measurement/filter conditions are still optional (IS NULL
-- short-circuits), so partial indexes on territory + visibility remain useful.
-- =============================================================================

-- Drop old signature(s) to avoid overload conflicts.
DROP FUNCTION IF EXISTS public.get_models_by_location(
  text, text, integer, integer, text, text, boolean, boolean,
  integer, integer, text, integer, integer, integer, integer,
  integer, integer, integer, integer, text
);
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
  p_ethnicities     text[]    DEFAULT NULL
)
RETURNS SETOF jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER  -- RLS of the calling session applies (clients only see permitted rows)
AS $$
  SELECT to_jsonb(result)
  FROM (
    SELECT
      m.*,
      mat.country_code  AS territory_country_code,
      a.name            AS agency_name,
      mat.agency_id     AS territory_agency_id
    FROM public.models m
    JOIN public.model_agency_territories mat ON mat.model_id   = m.id
    JOIN public.agencies                 a   ON a.id           = mat.agency_id
    WHERE
      -- Location: model must be represented in the searched territory
      mat.country_code = p_iso

      -- Representation status
      AND (
        m.agency_relationship_status IS NULL
        OR m.agency_relationship_status IN ('active', 'pending_link')
      )

      -- Client type visibility
      AND (
        p_client_type = 'all'
        OR (p_client_type = 'fashion'    AND m.is_visible_fashion    = TRUE)
        OR (p_client_type = 'commercial' AND m.is_visible_commercial = TRUE)
      )

      -- Optional attribute filters (all short-circuit when parameter is NULL)
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
        p_city IS NULL OR p_city = ''
        OR m.city ILIKE p_city
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

    ORDER BY m.name
    OFFSET p_from
    LIMIT  (p_to - p_from + 1)
  ) result;
$$;

-- Grant execute to authenticated users and anon (guests via guest-link).
GRANT EXECUTE ON FUNCTION public.get_models_by_location(
  text, text, integer, integer, text, text, boolean, boolean,
  integer, integer, text, integer, integer, integer, integer,
  integer, integer, integer, integer, text, text[]
) TO authenticated, anon;

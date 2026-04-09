-- =============================================================================
-- Migration: 20260519_get_discovery_models_restore_effective_city.sql
--
-- BUG FIX: Migration 20260508 replaced get_discovery_models without the
-- effective_locations CTE that was introduced in 20260409_location_truth_unification.
-- Its comment stated "logic unchanged" but effective_city was silently dropped:
--   - effective_city was missing from the SELECT → returned NULL to frontend
--   - City-Boost used m.city (models table) instead of canonical model_locations city
--   - canonicalDisplayCityForModel() fell back to models.city, ignoring model_locations
--
-- This migration restores:
--   1. effective_locations CTE (DISTINCT ON model_id, live>current>agency priority)
--   2. LEFT JOIN effective_locations el ON el.model_id = m.id
--   3. COALESCE(el.effective_city, m.city) AS effective_city in SELECT
--   4. City-Boost uses COALESCE(el.effective_city, m.city) instead of m.city
--
-- All other predicates, filters, ranking formula, and guards are
-- unchanged from 20260508.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_discovery_models(
  p_client_org_id   uuid,
  p_iso             text,
  p_client_type     text      DEFAULT 'all',
  p_from            integer   DEFAULT 0,
  p_to              integer   DEFAULT 49,
  p_client_city     text      DEFAULT NULL,
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
  p_exclude_ids     uuid[]    DEFAULT NULL,
  p_reject_hours    integer   DEFAULT 24,
  p_book_days       integer   DEFAULT 7,
  p_cursor_score    integer   DEFAULT NULL,
  p_cursor_model_id uuid      DEFAULT NULL,
  p_limit           integer   DEFAULT 50
)
RETURNS SETOF jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_org_id uuid;
BEGIN
  -- GUARD: Verify the caller is a member of the given client org
  -- (identical to 20260508 guard)
  SELECT om.organization_id INTO v_caller_org_id
  FROM   organization_members om
  JOIN   organizations o ON o.id = om.organization_id
  WHERE  om.user_id       = auth.uid()
    AND  o.type           = 'client'
    AND  om.organization_id = p_client_org_id
  LIMIT 1;

  IF v_caller_org_id IS NULL THEN
    SELECT o.id INTO v_caller_org_id
    FROM   organizations o
    WHERE  o.id       = p_client_org_id
      AND  o.type     = 'client'
      AND  o.owner_id = auth.uid()
    LIMIT 1;
  END IF;

  IF v_caller_org_id IS NULL THEN
    RAISE EXCEPTION 'get_discovery_models: unauthorized';
  END IF;

  RETURN QUERY
  WITH org_interactions AS (
    SELECT
      cmi.model_id,
      cmi.last_viewed_at   IS NOT NULL                                        AS was_viewed,
      cmi.last_rejected_at IS NOT NULL                                        AS was_rejected,
      cmi.last_rejected_at IS NOT NULL
        AND cmi.last_rejected_at >= NOW() - (p_reject_hours || ' hours')::INTERVAL AS rejected_recent,
      cmi.last_booked_at IS NOT NULL
        AND cmi.last_booked_at   >= NOW() - (p_book_days   || ' days' )::INTERVAL AS booked_recent
    FROM client_model_interactions cmi
    WHERE cmi.client_org_id = p_client_org_id
  ),

  -- Canonical effective location: highest-priority model_locations city per model.
  -- Priority: live (0) > current (1) > agency (2). Identical to resolved_locations
  -- in get_models_near_location. Restored from 20260409_location_truth_unification.
  effective_locations AS (
    SELECT DISTINCT ON (ml.model_id)
      ml.model_id,
      ml.city AS effective_city
    FROM public.model_locations ml
    WHERE ml.city IS NOT NULL AND TRIM(ml.city) <> ''
    ORDER BY ml.model_id,
      CASE ml.source
        WHEN 'live'    THEN 0
        WHEN 'current' THEN 1
        WHEN 'agency'  THEN 2
        ELSE 3
      END ASC
  ),

  scored AS (
    SELECT
      m.*,
      mat.country_code                        AS territory_country_code,
      a.name                                  AS agency_name,
      mat.agency_id                           AS territory_agency_id,
      COALESCE(el.effective_city, m.city)     AS effective_city,
      (
        CASE WHEN oi.model_id IS NULL THEN 50 ELSE 0 END
        + CASE WHEN p_client_city IS NOT NULL
                 AND COALESCE(el.effective_city, m.city) IS NOT NULL
                 AND lower(trim(COALESCE(el.effective_city, m.city))) = lower(trim(p_client_city))
               THEN 30 ELSE 0 END
        + CASE WHEN m.created_at >= NOW() - INTERVAL '30 days'
                 OR  m.updated_at >= NOW() - INTERVAL '30 days'
               THEN 20 ELSE 0 END
        - CASE WHEN oi.was_viewed  IS TRUE THEN 10 ELSE 0 END
        - CASE WHEN oi.was_rejected IS TRUE THEN 40 ELSE 0 END
      ) AS discovery_score
    FROM public.models m
    JOIN public.model_agency_territories mat
      ON mat.model_id    = m.id
     AND mat.country_code = p_iso
    JOIN public.agencies a
      ON a.id = mat.agency_id
    LEFT JOIN org_interactions oi
      ON oi.model_id = m.id
    LEFT JOIN effective_locations el
      ON el.model_id = m.id
    WHERE
      (oi.rejected_recent IS NULL OR oi.rejected_recent = FALSE)
      AND (oi.booked_recent   IS NULL OR oi.booked_recent   = FALSE)
      AND (p_exclude_ids IS NULL OR NOT (m.id = ANY(p_exclude_ids)))
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
      AND (p_sex             IS NULL OR m.sex          = p_sex)
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
  )
  SELECT to_jsonb(s)
  FROM   scored s
  WHERE  (
    p_cursor_score IS NULL
    OR s.discovery_score < p_cursor_score
    OR (s.discovery_score = p_cursor_score AND s.id > p_cursor_model_id)
  )
  ORDER  BY s.discovery_score DESC, s.id
  LIMIT  CASE
           WHEN p_cursor_score IS NOT NULL THEN p_limit
           ELSE (p_to - p_from + 1)
         END
  OFFSET CASE
           WHEN p_cursor_score IS NOT NULL THEN 0
           ELSE p_from
         END;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_discovery_models(
  uuid, text, text, integer, integer, text, text, boolean, boolean,
  integer, integer, text, integer, integer, integer, integer,
  integer, integer, integer, integer, text, text[], uuid[], integer, integer,
  integer, uuid, integer
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.get_discovery_models(
  uuid, text, text, integer, integer, text, text, boolean, boolean,
  integer, integer, text, integer, integer, integer, integer,
  integer, integer, integer, integer, text, text[], uuid[], integer, integer,
  integer, uuid, integer
) TO authenticated;

COMMENT ON FUNCTION public.get_discovery_models(
  uuid, text, text, integer, integer, text, text, boolean, boolean,
  integer, integer, text, integer, integer, integer, integer,
  integer, integer, integer, integer, text, text[], uuid[], integer, integer,
  integer, uuid, integer
) IS
  'Ranked client discovery (v3). '
  '20260519: Restores effective_locations CTE (live>current>agency from model_locations) '
  'and COALESCE(effective_city, models.city) AS effective_city. '
  'City-Boost also uses COALESCE so model_locations takes precedence over models.city. '
  'Chest min/max use COALESCE(chest,bust) for parity with UI (from 20260508).';

-- Verify the function exists after migration
DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_discovery_models'
  ), 'get_discovery_models missing after 20260519 migration';
END;
$$;

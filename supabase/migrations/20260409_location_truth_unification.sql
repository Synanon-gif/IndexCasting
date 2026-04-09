-- =============================================================================
-- Migration: 20260409_location_truth_unification.sql
--
-- GOAL: Establish model_locations (priority: live > current > agency) as the
-- canonical product truth for user-facing city display and scoring.
-- models.city becomes a legacy fallback only.
--
-- Changes:
--   1. get_discovery_models — adds effective_locations CTE + effective_city field;
--      city-score (+30) now uses COALESCE(effective_city, models.city).
--   2. get_models_by_location — adds effective_city to output via LEFT JOIN.
--   3. get_guest_link_models — adds effective_city column to RETURNS TABLE.
--
-- DO-NOT-TOUCH: get_models_near_location (already canonical via resolved_locations).
-- =============================================================================


-- ─── 1. get_discovery_models — effective_city + canonical city-score ──────────

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
  -- in get_models_near_location.
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
      mat.country_code   AS territory_country_code,
      a.name             AS agency_name,
      mat.agency_id      AS territory_agency_id,
      COALESCE(el.effective_city, m.city) AS effective_city,
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
) FROM PUBLIC, anon;

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
  'Ranked client discovery. 20260409: effective_city from model_locations '
  '(live>current>agency) as canonical display city; city-score uses effective_city.';


-- ─── 2. get_models_by_location — adds effective_city to output ───────────────

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
  WITH effective_locations AS (
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
  )
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
      mat.agency_id     AS territory_agency_id,
      COALESCE(el.effective_city, m.city) AS effective_city
    FROM public.models m
    JOIN public.model_agency_territories mat ON mat.model_id = m.id
    JOIN public.agencies                 a   ON a.id         = mat.agency_id
    LEFT JOIN effective_locations         el  ON el.model_id  = m.id
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
    ORDER BY m.name
    OFFSET p_from
    LIMIT  (p_to - p_from + 1)
  ) result;
END;
$function$;

COMMENT ON FUNCTION public.get_models_by_location(
  text, text, integer, integer, text, text, boolean, boolean,
  integer, integer, text, integer, integer, integer, integer,
  integer, integer, integer, integer, text, text[]
) IS
  'Legacy location-based discovery. 20260509: city filter matches model_locations. '
  '20260409: adds effective_city (canonical model_locations priority).';


-- ─── 3. get_guest_link_models — adds effective_city column ───────────────────
-- RETURNS TABLE must be dropped and recreated to add a column.

DROP FUNCTION IF EXISTS public.get_guest_link_models(UUID);

CREATE FUNCTION public.get_guest_link_models(p_link_id UUID)
RETURNS TABLE (
  id               UUID,
  name             TEXT,
  height           INTEGER,
  bust             INTEGER,
  waist            INTEGER,
  hips             INTEGER,
  city             TEXT,
  hair_color       TEXT,
  eye_color        TEXT,
  sex              TEXT,
  portfolio_images TEXT[],
  polaroids        TEXT[],
  effective_city   TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
DECLARE
  v_model_ids       UUID[];
  v_type            TEXT;
  v_agency_id       UUID;
  v_already_accessed BOOLEAN;
BEGIN
  IF NOT public.enforce_guest_link_rate_limit(30) THEN
    RAISE EXCEPTION 'rate_limit_exceeded'
      USING HINT = 'Too many requests. Please wait before retrying.',
            ERRCODE = 'P0001';
  END IF;

  SELECT
    gl.model_ids,
    gl.type,
    gl.agency_id,
    (gl.first_accessed_at IS NOT NULL)
  INTO v_model_ids, v_type, v_agency_id, v_already_accessed
  FROM public.guest_links gl
  WHERE gl.id        = p_link_id
    AND gl.is_active = true
    AND gl.deleted_at IS NULL
    AND (
      (gl.first_accessed_at IS NULL
        AND (gl.expires_at IS NULL OR gl.expires_at > now()))
      OR
      (gl.first_accessed_at IS NOT NULL
        AND gl.first_accessed_at + INTERVAL '7 days' > now())
    );

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF NOT v_already_accessed THEN
    UPDATE public.guest_links
    SET first_accessed_at = now()
    WHERE id = p_link_id
      AND first_accessed_at IS NULL;
  END IF;

  BEGIN
    INSERT INTO public.guest_link_access_log (link_id, event_type, created_at)
    VALUES (p_link_id, 'models_loaded', now());
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN QUERY
  SELECT
    m.id,
    m.name,
    m.height,
    m.bust,
    m.waist,
    m.hips,
    m.city,
    m.hair_color,
    m.eye_color,
    m.sex::TEXT,
    CASE WHEN v_type = 'portfolio' THEN COALESCE(m.portfolio_images, '{}') ELSE '{}' END,
    CASE WHEN v_type = 'polaroid'  THEN COALESCE(m.polaroids, '{}')        ELSE '{}' END,
    (
      SELECT ml.city
      FROM public.model_locations ml
      WHERE ml.model_id = m.id
        AND ml.city IS NOT NULL
        AND TRIM(ml.city) <> ''
      ORDER BY CASE ml.source
        WHEN 'live'    THEN 0
        WHEN 'current' THEN 1
        WHEN 'agency'  THEN 2
        ELSE 3
      END ASC
      LIMIT 1
    )
  FROM public.models m
  WHERE m.id        = ANY(v_model_ids)
    AND m.agency_id = v_agency_id;
END;
$$;

REVOKE ALL    ON FUNCTION public.get_guest_link_models(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_guest_link_models(UUID) TO anon;
GRANT EXECUTE ON FUNCTION public.get_guest_link_models(UUID) TO authenticated;

COMMENT ON FUNCTION public.get_guest_link_models(UUID) IS
  'Returns model fields for an active guest link. '
  'H-4: m.agency_id = link.agency_id prevents cross-agency leakage. '
  'SECURITY DEFINER, row_security=off, rate-limited. '
  '20260409: adds effective_city (canonical model_locations priority).';


-- ─── Verification ────────────────────────────────────────────────────────────

DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_discovery_models'
  ), 'get_discovery_models missing after location truth unification';

  ASSERT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_models_by_location'
  ), 'get_models_by_location missing after location truth unification';

  ASSERT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_guest_link_models'
  ), 'get_guest_link_models missing after location truth unification';

  RAISE NOTICE '20260409_location_truth_unification: all 3 RPCs verified OK';
END $$;

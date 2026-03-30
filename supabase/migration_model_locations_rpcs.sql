-- =============================================================================
-- Model Location RPCs
--
-- 1. upsert_model_location       — single model, by model-user or agency member
-- 2. bulk_upsert_model_locations — agency-only, multiple models at once
-- 3. get_models_near_location    — radius-based discovery (Haversine, no territory)
--    NOTE: superseded by migration_model_locations_rpc_bbox_optimization.sql
-- 4. get_models_by_location v3   — territory-based with city-priority sort
--
-- Schema note:
--   agencies has NO organization_id column.
--   The correct join is: organizations.agency_id = models.agency_id
--   Legacy bookers table is also supported (Path B in all ownership checks).
--
-- City vs lat/lng:
--   city    = display label only (never used as a filter predicate).
--   lat/lng = sole criterion for radius-based Near Me filtering.
--
-- Source priority:
--   UNIQUE(model_id) means one row per model. Latest updated_at wins.
--   No source comparison needed — UPSERT handles it automatically.
-- =============================================================================


-- ---------------------------------------------------------------------------
-- 1) upsert_model_location
--    Callable by the model's own user OR by any agency member / booker.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.upsert_model_location(
  uuid, text, text, float, float, boolean, text
);

CREATE OR REPLACE FUNCTION public.upsert_model_location(
  p_model_id                    uuid,
  p_country_code                text,
  p_city                        text        DEFAULT NULL,
  p_lat_approx                  float       DEFAULT NULL,
  p_lng_approx                  float       DEFAULT NULL,
  p_share_approximate_location  boolean     DEFAULT TRUE,
  p_source                      text        DEFAULT 'model'
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER  -- RLS enforced: caller must own the model or be an agency member
AS $$
DECLARE
  v_lat float := CASE WHEN p_lat_approx IS NOT NULL
                      THEN ROUND(p_lat_approx::numeric, 2)::float
                      ELSE NULL END;
  v_lng float := CASE WHEN p_lng_approx IS NOT NULL
                      THEN ROUND(p_lng_approx::numeric, 2)::float
                      ELSE NULL END;
BEGIN
  IF p_source NOT IN ('model', 'agency') THEN
    RAISE EXCEPTION 'Invalid source value: %', p_source;
  END IF;

  INSERT INTO public.model_locations (
    model_id, country_code, city, lat_approx, lng_approx,
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
    country_code               = UPPER(TRIM(p_country_code)),
    city                       = NULLIF(TRIM(COALESCE(p_city, '')), ''),
    lat_approx                 = CASE WHEN p_share_approximate_location
                                      THEN ROUND(COALESCE(p_lat_approx, 0)::numeric, 2)::float
                                      ELSE NULL END,
    lng_approx                 = CASE WHEN p_share_approximate_location
                                      THEN ROUND(COALESCE(p_lng_approx, 0)::numeric, 2)::float
                                      ELSE NULL END,
    share_approximate_location = p_share_approximate_location,
    source                     = p_source,
    updated_at                 = now();
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_model_location(
  uuid, text, text, float, float, boolean, text
) TO authenticated;


-- ---------------------------------------------------------------------------
-- 2) bulk_upsert_model_locations
--    Agency-only: loops over p_model_ids and upserts for each.
--    Ownership check uses organizations.agency_id (correct FK) + bookers fallback.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.bulk_upsert_model_locations(
  uuid[], text, text, float, float
);

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
BEGIN
  FOREACH v_model_id IN ARRAY p_model_ids
  LOOP
    -- Verify caller is an agency org member OR legacy booker for this model.
    -- organizations.agency_id = models.agency_id (agencies has no organization_id).
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
    ) THEN
      CONTINUE;  -- skip models the caller doesn't manage
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
      TRUE,
      'agency',
      now()
    )
    ON CONFLICT (model_id) DO UPDATE SET
      country_code               = UPPER(TRIM(p_country_code)),
      city                       = NULLIF(TRIM(COALESCE(p_city, '')), ''),
      lat_approx                 = v_lat,
      lng_approx                 = v_lng,
      share_approximate_location = TRUE,
      source                     = 'agency',
      updated_at                 = now();

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.bulk_upsert_model_locations(
  uuid[], text, text, float, float
) TO authenticated;


-- ---------------------------------------------------------------------------
-- 3) get_models_near_location  (v1 — superseded by bbox optimization migration)
--    Kept here so this file is self-contained for fresh deployments.
--    City is NOT used as a filter — lat/lng only.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_models_near_location(
  float, float, float, text, integer, integer, text, boolean, boolean,
  integer, integer, text, integer, integer, integer, integer,
  integer, integer, integer, integer, text, text[]
);

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
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT to_jsonb(result)
  FROM (
    SELECT
      m.*,
      ml.city                       AS location_city,
      ml.country_code               AS location_country_code,
      ml.lat_approx,
      ml.lng_approx,
      ml.source                     AS location_source,
      ml.updated_at                 AS location_updated_at,
      (
        2 * 6371 * asin(sqrt(
          power(sin(radians((ml.lat_approx - p_lat) / 2)), 2) +
          cos(radians(p_lat)) * cos(radians(ml.lat_approx)) *
          power(sin(radians((ml.lng_approx - p_lng) / 2)), 2)
        ))
      ) AS distance_km,
      mat.country_code  AS territory_country_code,
      a.name            AS agency_name,
      mat.agency_id     AS territory_agency_id
    FROM public.models m
    JOIN public.model_locations ml
      ON ml.model_id = m.id
     AND ml.lat_approx IS NOT NULL
     AND ml.lng_approx IS NOT NULL
     AND ml.share_approximate_location = TRUE
    LEFT JOIN public.model_agency_territories mat ON mat.model_id = m.id
    LEFT JOIN public.agencies a ON a.id = mat.agency_id
    WHERE
      (
        m.agency_relationship_status IS NULL
        OR m.agency_relationship_status IN ('active', 'pending_link')
      )
      AND (
        p_client_type = 'all'
        OR (p_client_type = 'fashion'    AND m.is_visible_fashion    = TRUE)
        OR (p_client_type = 'commercial' AND m.is_visible_commercial = TRUE)
      )
      AND (
        2 * 6371 * asin(sqrt(
          power(sin(radians((ml.lat_approx - p_lat) / 2)), 2) +
          cos(radians(p_lat)) * cos(radians(ml.lat_approx)) *
          power(sin(radians((ml.lng_approx - p_lng) / 2)), 2)
        ))
      ) <= p_radius_km
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
    ORDER BY distance_km ASC, m.name ASC
    OFFSET p_from
    LIMIT  (p_to - p_from + 1)
  ) result;
$$;

GRANT EXECUTE ON FUNCTION public.get_models_near_location(
  float, float, float, text, integer, integer, text, boolean, boolean,
  integer, integer, text, integer, integer, integer, integer,
  integer, integer, integer, integer, text, text[]
) TO authenticated, anon;


-- ---------------------------------------------------------------------------
-- 4) get_models_by_location v3
--    Territory-based discovery. City = priority sort, NOT hard filter.
--    All models in the territory country are returned; city-matches appear first.
-- ---------------------------------------------------------------------------
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
SECURITY INVOKER
AS $$
  SELECT to_jsonb(result)
  FROM (
    SELECT
      m.*,
      mat.country_code  AS territory_country_code,
      a.name            AS agency_name,
      mat.agency_id     AS territory_agency_id,
      -- City-priority sort: 0 = city match first, 1 = rest of country
      CASE
        WHEN p_city IS NOT NULL AND p_city <> '' AND m.city ILIKE p_city
        THEN 0
        ELSE 1
      END AS city_match_rank
    FROM public.models m
    JOIN public.model_agency_territories mat ON mat.model_id   = m.id
    JOIN public.agencies                 a   ON a.id           = mat.agency_id
    WHERE
      mat.country_code = p_iso
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
    ORDER BY city_match_rank ASC, m.name ASC
    OFFSET p_from
    LIMIT  (p_to - p_from + 1)
  ) result;
$$;

GRANT EXECUTE ON FUNCTION public.get_models_by_location(
  text, text, integer, integer, text, text, boolean, boolean,
  integer, integer, text, integer, integer, integer, integer,
  integer, integer, integer, integer, text, text[]
) TO authenticated, anon;

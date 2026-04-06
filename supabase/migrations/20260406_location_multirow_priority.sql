-- =============================================================================
-- Location System Final Hardening — Multi-Row Architecture
-- Date: 2026-04-06 (must run after all previous 20260406_location_* migrations)
--
-- ARCHITECTURAL CHANGE: UNIQUE(model_id) → UNIQUE(model_id, source)
--
-- Previous: ONE row per model — "last write wins" with soft priority guard.
--   Problem: removing 'live' source deletes the entire row; no fallback to
--   'current' or 'agency'. Agency writes could corrupt model data under race.
--
-- New: UP TO THREE rows per model — one per source, fully isolated by design.
--   live   → model browser GPS
--   current → model-typed city (geocoded)
--   agency  → agency-set fallback
--
-- Priority enforced by DISTINCT ON in get_models_near_location — the highest-
-- priority source WITH coordinates is used for Near Me. The structural
-- isolation (UNIQUE model_id, source) means no source can ever overwrite another.
--
-- Points resolved:
--   2:  UNIQUE(model_id, source) added
--   3:  No-overwrite guaranteed structurally (not just by WHERE guard)
--   4:  DISTINCT ON priority ordering in get_models_near_location
--   5:  bulk and single upsert use identical ON CONFLICT (model_id, source)
--   6:  GPS preserved — agency row never touches live/current row
--   7:  Near Me uses DISTINCT ON with live>current>agency ordering
--   8:  Removing 'live' leaves 'current'/'agency' rows intact → natural fallback
--   10: Race condition safe — concurrent writes go to isolated rows
-- =============================================================================


-- ─── 1. Constraint migration ──────────────────────────────────────────────────

-- Drop the old single-row constraint
ALTER TABLE public.model_locations
  DROP CONSTRAINT IF EXISTS model_locations_model_id_key;

-- Add the new multi-row constraint (one row per source per model)
ALTER TABLE public.model_locations
  ADD CONSTRAINT unique_model_source UNIQUE (model_id, source);


-- ─── 2. upsert_model_location — clean multi-row upsert ───────────────────────
-- No WHERE guard needed on ON CONFLICT: structural isolation is guaranteed by
-- UNIQUE(model_id, source). Agency writes touch only (model_id, 'agency'),
-- model writes touch only (model_id, 'live') or (model_id, 'current').
--
-- Auth split: live/current → only model's own user (or admin)
--             agency       → only agency org member / legacy booker (or admin)

CREATE OR REPLACE FUNCTION public.upsert_model_location(
  p_model_id                    uuid,
  p_country_code                text,
  p_city                        text        DEFAULT NULL,
  p_lat_approx                  float       DEFAULT NULL,
  p_lng_approx                  float       DEFAULT NULL,
  p_share_approximate_location  boolean     DEFAULT TRUE,
  p_source                      text        DEFAULT 'current'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
DECLARE
  v_lat float := CASE WHEN p_lat_approx IS NOT NULL
                      THEN ROUND(p_lat_approx::numeric, 2)::float
                      ELSE NULL END;
  v_lng float := CASE WHEN p_lng_approx IS NOT NULL
                      THEN ROUND(p_lng_approx::numeric, 2)::float
                      ELSE NULL END;
BEGIN
  -- GUARD 1: Authentication
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  -- GUARD 2: Source validation
  IF p_source NOT IN ('live', 'current', 'agency') THEN
    RAISE EXCEPTION 'invalid_source: must be live, current, or agency — got %', p_source;
  END IF;

  -- GUARD 3: Authorization split by source
  -- live/current: only the model's own user account (agency must not write model-owned sources)
  IF p_source IN ('live', 'current') THEN
    IF NOT (
      EXISTS (
        SELECT 1 FROM public.models m
        WHERE m.id = p_model_id AND m.user_id = auth.uid()
      )
      OR public.is_current_user_admin()
    ) THEN
      RAISE EXCEPTION 'access_denied: source=% can only be written by the model user', p_source;
    END IF;

  -- agency: only an agency org member or legacy booker managing this model
  ELSIF p_source = 'agency' THEN
    IF NOT (
      EXISTS (
        SELECT 1
        FROM public.models m
        JOIN public.organizations o ON o.agency_id = m.agency_id AND o.type = 'agency'
        JOIN public.organization_members om ON om.organization_id = o.id
        WHERE m.id = p_model_id AND om.user_id = auth.uid()
      )
      OR EXISTS (
        SELECT 1
        FROM public.models m
        JOIN public.bookers b ON b.agency_id = m.agency_id
        WHERE m.id = p_model_id AND b.user_id = auth.uid()
      )
      OR public.is_current_user_admin()
    ) THEN
      RAISE EXCEPTION 'access_denied: source=agency requires agency membership for model %', p_model_id;
    END IF;
  END IF;

  -- ── Upsert — single path, source-isolated by UNIQUE(model_id, source) ──────
  -- No WHERE guard needed on ON CONFLICT: structural isolation guarantees that
  -- (model_id, 'agency') conflicts ONLY with (model_id, 'agency'), never with live/current.
  INSERT INTO public.model_locations (
    model_id, country_code, city,
    lat_approx, lng_approx,
    share_approximate_location, source, updated_at
  )
  VALUES (
    p_model_id,
    UPPER(TRIM(p_country_code)),
    NULLIF(TRIM(COALESCE(p_city, '')), ''),
    CASE
      WHEN p_source IN ('live', 'current') AND p_share_approximate_location THEN v_lat
      WHEN p_source = 'agency' THEN v_lat  -- agencies pass geocoded coords (may be null)
      ELSE NULL
    END,
    CASE
      WHEN p_source IN ('live', 'current') AND p_share_approximate_location THEN v_lng
      WHEN p_source = 'agency' THEN v_lng
      ELSE NULL
    END,
    CASE
      WHEN p_source IN ('live', 'current') THEN p_share_approximate_location
      WHEN p_source = 'agency' THEN (v_lat IS NOT NULL)  -- Near Me only when geocoded
      ELSE FALSE
    END,
    p_source,
    now()
  )
  ON CONFLICT (model_id, source) DO UPDATE SET
    city                       = EXCLUDED.city,
    country_code               = EXCLUDED.country_code,
    lat_approx                 = EXCLUDED.lat_approx,
    lng_approx                 = EXCLUDED.lng_approx,
    share_approximate_location = EXCLUDED.share_approximate_location,
    updated_at                 = now();
  -- source is part of the conflict target and never changes within a row.
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_model_location(
  uuid, text, text, float, float, boolean, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_model_location(
  uuid, text, text, float, float, boolean, text
) TO authenticated;


-- ─── 3. bulk_upsert_model_locations — identical ON CONFLICT target ────────────
-- Uses ON CONFLICT (model_id, source) — no WHERE guard, same as single upsert.

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
SET row_security TO off
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
  v_share     boolean := (v_lat IS NOT NULL);  -- Near Me only when geocoded
BEGIN
  FOREACH v_model_id IN ARRAY p_model_ids
  LOOP
    -- Verify caller manages this model (agency member or legacy booker)
    IF NOT (
      EXISTS (
        SELECT 1
        FROM   public.models m
        JOIN   public.organizations o ON o.agency_id = m.agency_id AND o.type = 'agency'
        JOIN   public.organization_members om ON om.organization_id = o.id
        WHERE  m.id = v_model_id AND om.user_id = auth.uid()
      )
      OR EXISTS (
        SELECT 1
        FROM   public.models m
        JOIN   public.bookers b ON b.agency_id = m.agency_id
        WHERE  m.id = v_model_id AND b.user_id = auth.uid()
      )
      OR public.is_current_user_admin()
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
      v_share,
      'agency',
      now()
    )
    ON CONFLICT (model_id, source) DO UPDATE SET
      country_code               = UPPER(TRIM(p_country_code)),
      city                       = NULLIF(TRIM(COALESCE(p_city, '')), ''),
      lat_approx                 = v_lat,
      lng_approx                 = v_lng,
      share_approximate_location = v_share,
      updated_at                 = now();
    -- source='agency' is the conflict target — can only update its own row.

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.bulk_upsert_model_locations(
  uuid[], text, text, float, float
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bulk_upsert_model_locations(
  uuid[], text, text, float, float
) TO authenticated;


-- ─── 4. delete_model_location_source — source-aware deletion RPC ─────────────
-- Allows deleting a specific source row without affecting others.
-- live/current: only the model's own user can delete.
-- agency: only agency members can delete.
-- If p_source is NULL, deletes only model-owned rows (live + current), never agency.

CREATE OR REPLACE FUNCTION public.delete_model_location_source(
  p_model_id uuid,
  p_source   text DEFAULT NULL  -- NULL = delete all model-owned (live + current)
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
DECLARE
  v_is_model_user boolean;
  v_is_agency_member boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF p_source IS NOT NULL AND p_source NOT IN ('live', 'current', 'agency') THEN
    RAISE EXCEPTION 'invalid_source: %', p_source;
  END IF;

  v_is_model_user := EXISTS (
    SELECT 1 FROM public.models WHERE id = p_model_id AND user_id = auth.uid()
  );

  v_is_agency_member := EXISTS (
    SELECT 1
    FROM public.models m
    JOIN public.organizations o ON o.agency_id = m.agency_id AND o.type = 'agency'
    JOIN public.organization_members om ON om.organization_id = o.id
    WHERE m.id = p_model_id AND om.user_id = auth.uid()
  ) OR EXISTS (
    SELECT 1
    FROM public.models m
    JOIN public.bookers b ON b.agency_id = m.agency_id
    WHERE m.id = p_model_id AND b.user_id = auth.uid()
  );

  -- Delete specific source with authorization check
  IF p_source IS NOT NULL THEN
    IF p_source IN ('live', 'current') AND NOT (v_is_model_user OR public.is_current_user_admin()) THEN
      RAISE EXCEPTION 'access_denied: only model user can delete live/current source';
    END IF;
    IF p_source = 'agency' AND NOT (v_is_agency_member OR public.is_current_user_admin()) THEN
      RAISE EXCEPTION 'access_denied: only agency member can delete agency source';
    END IF;

    DELETE FROM public.model_locations
    WHERE model_id = p_model_id AND source = p_source;

  ELSE
    -- NULL source: delete all model-owned sources (live + current).
    -- Agency source is intentionally preserved (agency manages their own data).
    IF NOT (v_is_model_user OR public.is_current_user_admin()) THEN
      RAISE EXCEPTION 'access_denied: only model user can delete location sources';
    END IF;

    DELETE FROM public.model_locations
    WHERE model_id = p_model_id AND source IN ('live', 'current');
  END IF;

  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_model_location_source(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_model_location_source(uuid, text) TO authenticated;


-- ─── 5. get_models_near_location — DISTINCT ON priority resolution ────────────
-- Uses DISTINCT ON (model_id) ordered by source priority (live=0, current=1, agency=2).
-- This ensures the highest-priority source WITH valid coordinates is used for Near Me.
-- A model with both 'live' and 'agency' coordinates will always show via 'live'.

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
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'get_models_near_location: authentication required'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NOT (SELECT can_access_platform()) THEN
    RAISE EXCEPTION 'get_models_near_location: platform access denied'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN QUERY
  WITH bbox AS (
    SELECT
      p_lat - (p_radius_km / 111.0) * 1.01                          AS min_lat,
      p_lat + (p_radius_km / 111.0) * 1.01                          AS max_lat,
      p_lng - (p_radius_km / (111.0 * cos(radians(p_lat)))) * 1.01  AS min_lng,
      p_lng + (p_radius_km / (111.0 * cos(radians(p_lat)))) * 1.01  AS max_lng
  ),

  -- ── PRIORITY RESOLUTION: DISTINCT ON (model_id) ordered by source priority ──
  -- Per model, selects the single highest-priority location row that has valid
  -- coordinates and share_approximate_location = TRUE.
  -- Priority: live (0) > current (1) > agency (2)
  -- A model with both 'live' GPS and 'agency' city always resolves to 'live'.
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
        WHEN 'live'    THEN 0  -- highest priority
        WHEN 'current' THEN 1
        WHEN 'agency'  THEN 2  -- lowest priority
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


-- ─── Verification ─────────────────────────────────────────────────────────────
DO $$
BEGIN
  -- Constraint: old UNIQUE(model_id) must be gone
  ASSERT NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.model_locations'::regclass
      AND conname = 'model_locations_model_id_key'
  ), 'Old UNIQUE(model_id) constraint must be dropped';

  -- Constraint: new UNIQUE(model_id, source) must exist
  ASSERT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.model_locations'::regclass
      AND conname = 'unique_model_source'
  ), 'UNIQUE(model_id, source) constraint must exist';

  -- No 'model' source values remain
  ASSERT NOT EXISTS (
    SELECT 1 FROM public.model_locations WHERE source = 'model'
  ), 'No source=model rows allowed';

  -- GPS preservation: live/current rows with share=true must have both coords
  ASSERT NOT EXISTS (
    SELECT 1 FROM public.model_locations
    WHERE source IN ('live', 'current')
      AND share_approximate_location = TRUE
      AND (lat_approx IS NULL OR lng_approx IS NULL)
  ), 'live/current rows with share=true must have both lat and lng';

  -- All RPCs exist
  ASSERT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'upsert_model_location'
  ), 'upsert_model_location must exist';

  ASSERT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'delete_model_location_source'
  ), 'delete_model_location_source must exist';

  RAISE NOTICE '20260406_location_multirow_priority: all checks passed — multi-row architecture live';
END $$;

-- =============================================================================
-- Discovery Ranking: Client–Model Interaction Tracking
--
-- Adds:
--   1. Table  `client_model_interactions`  — records viewed / rejected / booked
--      per client organisation. One row per (org, model, action), UPSERT on
--      every event so created_at always reflects the MOST RECENT occurrence.
--   2. RLS    — org members can SELECT their own rows; no direct INSERT/UPDATE.
--   3. RPC    `record_client_interaction`  — SECURITY DEFINER upsert used by
--      all clients. Resolves client_org_id from auth.uid() automatically.
--   4. RPC    `get_discovery_models`       — SECURITY DEFINER discovery query
--      with scoring, hard exclusions, and session dedup. Requires p_iso
--      (territory filter, same constraint as get_models_by_location v2).
--
-- Run after migration_hybrid_location_discovery_models_country_code_and_rls.sql
-- and migration_get_models_by_location_rpc_v2.sql.
-- =============================================================================


-- ─── 1. Table ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.client_model_interactions (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_org_id  UUID        NOT NULL
                               REFERENCES public.organizations(id) ON DELETE CASCADE,
  model_id       UUID        NOT NULL
                               REFERENCES public.models(id)        ON DELETE CASCADE,
  action         TEXT        NOT NULL
                               CHECK (action IN ('viewed', 'rejected', 'booked')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Unique: one row per (org, model, action) — UPSERT keeps latest timestamp.
CREATE UNIQUE INDEX IF NOT EXISTS idx_cmi_org_model_action
  ON public.client_model_interactions (client_org_id, model_id, action);

-- Index for scoring JOIN (looks up all interactions for a single org quickly).
CREATE INDEX IF NOT EXISTS idx_cmi_org_model
  ON public.client_model_interactions (client_org_id, model_id);

-- Index for time-based exclusion queries (recent reject / book checks).
CREATE INDEX IF NOT EXISTS idx_cmi_org_created
  ON public.client_model_interactions (client_org_id, created_at DESC);


-- ─── 2. RLS ───────────────────────────────────────────────────────────────────

ALTER TABLE public.client_model_interactions ENABLE ROW LEVEL SECURITY;

-- Org members can read their own interaction rows (e.g. for analytics).
DROP POLICY IF EXISTS "client_org_members_select_own_interactions" ON public.client_model_interactions;
CREATE POLICY "client_org_members_select_own_interactions"
  ON public.client_model_interactions FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.organization_members om
      WHERE om.organization_id = client_model_interactions.client_org_id
        AND om.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.organizations o
      WHERE o.id = client_model_interactions.client_org_id
        AND o.owner_id = auth.uid()
    )
  );

-- No direct INSERT / UPDATE / DELETE — all writes go through SECURITY DEFINER RPCs.


-- ─── 3. RPC: record_client_interaction ────────────────────────────────────────
--
-- Records a client interaction (viewed / rejected / booked) for the current
-- user's client organisation. UPSERT on (org, model, action) so created_at
-- always reflects the latest occurrence of that action.
--
-- Parameters:
--   p_model_id  – UUID of the model
--   p_action    – 'viewed' | 'rejected' | 'booked'

CREATE OR REPLACE FUNCTION public.record_client_interaction(
  p_model_id UUID,
  p_action   TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id UUID;
BEGIN
  IF p_action NOT IN ('viewed', 'rejected', 'booked') THEN
    RAISE EXCEPTION 'record_client_interaction: invalid action "%"', p_action;
  END IF;

  -- Resolve caller's client organisation (member or owner).
  SELECT om.organization_id INTO v_org_id
  FROM   organization_members om
  JOIN   organizations o ON o.id = om.organization_id
  WHERE  om.user_id = auth.uid()
    AND  o.type    = 'client'
  LIMIT 1;

  IF v_org_id IS NULL THEN
    SELECT o.id INTO v_org_id
    FROM   organizations o
    WHERE  o.type     = 'client'
      AND  o.owner_id = auth.uid()
    LIMIT 1;
  END IF;

  IF v_org_id IS NULL THEN
    -- Not a client org member — silently return to avoid breaking non-client flows.
    RETURN;
  END IF;

  INSERT INTO client_model_interactions (client_org_id, model_id, action, created_at)
  VALUES (v_org_id, p_model_id, p_action, now())
  ON CONFLICT (client_org_id, model_id, action)
  DO UPDATE SET created_at = now();
END;
$$;

REVOKE ALL    ON FUNCTION public.record_client_interaction(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_client_interaction(UUID, TEXT) TO authenticated;


-- ─── 4. RPC: get_discovery_models ─────────────────────────────────────────────
--
-- Ranked discovery query for a client organisation. Extends the v2
-- get_models_by_location logic with:
--   • Hard exclusions: recently rejected (< p_reject_hours) and recently
--     booked (< p_book_days) models are hidden.
--   • Session dedup: models in p_exclude_ids are skipped.
--   • Scoring:
--       +50  never seen by this client org
--       +30  model city matches p_client_city (case-insensitive)
--       +20  model created or updated within last 30 days
--       -10  already viewed (but not rejected)
--       -40  previously rejected (after cooldown window)
--   • Results are ORDER BY score DESC, then by name for stable pagination.
--
-- Security: SECURITY DEFINER; verifies the caller belongs to p_client_org_id
-- before proceeding. Replicates all visibility conditions explicitly so no
-- model is accidentally exposed.
--
-- Parameters (all optional except p_client_org_id and p_iso):
--   p_client_org_id   – UUID of the calling client organisation
--   p_iso             – ISO-2 territory country code (mandatory, same as v2)
--   p_client_type     – 'all' | 'fashion' | 'commercial'
--   p_from / p_to     – pagination range (inclusive)
--   p_client_city     – client's resolved city for location boost
--   p_category        – category filter string
--   p_sports_*        – sports filter flags
--   p_height_* / measurement filters (identical to v2)
--   p_sex             – biological sex filter
--   p_ethnicities     – multi-select ethnicity filter
--   p_exclude_ids     – session-seen model IDs to skip (dedup)
--   p_reject_hours    – cooldown for rejected (default 24h)
--   p_book_days       – cooldown for booked (default 7 days)

DROP FUNCTION IF EXISTS public.get_discovery_models(
  uuid, text, text, integer, integer, text, text, boolean, boolean,
  integer, integer, text, integer, integer, integer, integer,
  integer, integer, integer, integer, text, text[], uuid[], integer, integer
);

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
  p_book_days       integer   DEFAULT 7
)
RETURNS SETOF jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_org_id uuid;
BEGIN
  -- Security: verify caller belongs to the requested client organisation.
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
    -- Aggregate all interactions for this client org into per-model flags.
    -- One scan of client_model_interactions, filtered by org.
    SELECT
      cmi.model_id,
      bool_or(cmi.action = 'viewed')                                                                       AS was_viewed,
      bool_or(cmi.action = 'rejected')                                                                     AS was_rejected,
      bool_or(cmi.action = 'rejected'
        AND cmi.created_at >= NOW() - (p_reject_hours || ' hours')::INTERVAL)                              AS rejected_recent,
      bool_or(cmi.action = 'booked'
        AND cmi.created_at >= NOW() - (p_book_days || ' days')::INTERVAL)                                  AS booked_recent
    FROM client_model_interactions cmi
    WHERE cmi.client_org_id = p_client_org_id
    GROUP BY cmi.model_id
  ),
  scored AS (
    SELECT
      m.*,
      mat.country_code   AS territory_country_code,
      a.name             AS agency_name,
      mat.agency_id      AS territory_agency_id,
      -- Score computation (see function header for weights).
      (
        -- Never seen by this client (no interaction row at all)
        CASE WHEN oi.model_id IS NULL THEN 50 ELSE 0 END
        -- City match: model's city equals client's resolved city
        + CASE WHEN p_client_city IS NOT NULL
                 AND m.city IS NOT NULL
                 AND lower(trim(m.city)) = lower(trim(p_client_city))
               THEN 30 ELSE 0 END
        -- Freshness: created or updated within last 30 days
        + CASE WHEN m.created_at >= NOW() - INTERVAL '30 days'
                 OR  m.updated_at >= NOW() - INTERVAL '30 days'
               THEN 20 ELSE 0 END
        -- Viewed penalty
        - CASE WHEN oi.was_viewed  IS TRUE THEN 10 ELSE 0 END
        -- Previously rejected penalty (present after cooldown window)
        - CASE WHEN oi.was_rejected IS TRUE THEN 40 ELSE 0 END
      ) AS discovery_score
    FROM public.models m
    JOIN public.model_agency_territories mat
      ON mat.model_id   = m.id
     AND mat.country_code = p_iso
    JOIN public.agencies a
      ON a.id = mat.agency_id
    LEFT JOIN org_interactions oi
      ON oi.model_id = m.id
    WHERE
      -- Hard exclusion: recently rejected (within cooldown)
      (oi.rejected_recent IS NULL OR oi.rejected_recent = FALSE)
      -- Hard exclusion: recently booked (within cooldown)
      AND (oi.booked_recent IS NULL OR oi.booked_recent = FALSE)
      -- Session dedup: skip IDs already seen in this session
      AND (p_exclude_ids IS NULL OR NOT (m.id = ANY(p_exclude_ids)))
      -- Representation status
      AND (
        m.agency_relationship_status IS NULL
        OR m.agency_relationship_status IN ('active', 'pending_link')
      )
      -- Client type visibility (replicates RLS conditions explicitly)
      AND (
        p_client_type = 'all'
        OR (p_client_type = 'fashion'    AND m.is_visible_fashion    = TRUE)
        OR (p_client_type = 'commercial' AND m.is_visible_commercial = TRUE)
      )
      AND (m.is_visible_fashion = TRUE OR m.is_visible_commercial = TRUE)
      -- Optional attribute filters (identical to v2 get_models_by_location)
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
  SELECT to_jsonb(scored)
  FROM   scored
  ORDER  BY scored.discovery_score DESC, scored.name
  OFFSET p_from
  LIMIT  (p_to - p_from + 1);
END;
$$;

REVOKE ALL ON FUNCTION public.get_discovery_models(
  uuid, text, text, integer, integer, text, text, boolean, boolean,
  integer, integer, text, integer, integer, integer, integer,
  integer, integer, integer, integer, text, text[], uuid[], integer, integer
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.get_discovery_models(
  uuid, text, text, integer, integer, text, text, boolean, boolean,
  integer, integer, text, integer, integer, integer, integer,
  integer, integer, integer, integer, text, text[], uuid[], integer, integer
) TO authenticated;

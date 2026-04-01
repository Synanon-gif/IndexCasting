-- =============================================================================
-- Discovery: client_model_interactions v2
--
-- Upgrades the interaction table from 3 rows per (org, model) to 1 row
-- (Option A). Adds an append-only discovery_logs analytics table.
-- Updates both RPCs to use the new schema.
--
-- Changes vs v1:
--   1. Table: drops (id, action, created_at); adds (last_viewed_at,
--      last_rejected_at, last_booked_at, updated_at); PK is now the
--      composite (client_org_id, model_id).
--   2. record_client_interaction: single UPSERT + analytics log insert.
--   3. get_discovery_models: org_interactions CTE no longer needs GROUP BY;
--      adds optional cursor parameters alongside existing OFFSET fallback.
--
-- Run after migration_client_model_interactions.sql.
-- =============================================================================


-- ─── 1. Create new Option-A table ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.client_model_interactions_v2 (
  client_org_id    UUID        NOT NULL
                                 REFERENCES public.organizations(id) ON DELETE CASCADE,
  model_id         UUID        NOT NULL
                                 REFERENCES public.models(id)        ON DELETE CASCADE,
  last_viewed_at   TIMESTAMPTZ,
  last_rejected_at TIMESTAMPTZ,
  last_booked_at   TIMESTAMPTZ,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (client_org_id, model_id)
);


-- ─── 2. Migrate existing data ────────────────────────────────────────────────

INSERT INTO public.client_model_interactions_v2 (
  client_org_id,
  model_id,
  last_viewed_at,
  last_rejected_at,
  last_booked_at,
  updated_at
)
SELECT
  client_org_id,
  model_id,
  MAX(CASE WHEN action = 'viewed'   THEN created_at END),
  MAX(CASE WHEN action = 'rejected' THEN created_at END),
  MAX(CASE WHEN action = 'booked'   THEN created_at END),
  MAX(created_at)
FROM public.client_model_interactions
GROUP BY client_org_id, model_id
ON CONFLICT (client_org_id, model_id) DO NOTHING;


-- ─── 3. Swap tables ──────────────────────────────────────────────────────────

DROP TABLE IF EXISTS public.client_model_interactions;
ALTER TABLE public.client_model_interactions_v2 RENAME TO client_model_interactions;


-- ─── 4. RLS on new table ─────────────────────────────────────────────────────

ALTER TABLE public.client_model_interactions ENABLE ROW LEVEL SECURITY;

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
      WHERE o.id     = client_model_interactions.client_org_id
        AND o.owner_id = auth.uid()
    )
  );

-- No direct INSERT / UPDATE / DELETE — all writes through SECURITY DEFINER RPCs.


-- ─── 5. Indexes on new table ─────────────────────────────────────────────────

-- Partial index for recent-rejected exclusion (scans only rows that have a value).
CREATE INDEX IF NOT EXISTS idx_cmi_rejected
  ON public.client_model_interactions (client_org_id, last_rejected_at DESC)
  WHERE last_rejected_at IS NOT NULL;

-- Partial index for recent-booked exclusion.
CREATE INDEX IF NOT EXISTS idx_cmi_booked
  ON public.client_model_interactions (client_org_id, last_booked_at DESC)
  WHERE last_booked_at IS NOT NULL;


-- ─── 6. discovery_logs — append-only analytics table ─────────────────────────
--
-- Records every interaction event for analytics / history.
-- No FK on models / orgs so logs survive deletes.
-- Writes only through SECURITY DEFINER RPCs.

CREATE TABLE IF NOT EXISTS public.discovery_logs (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_org_id UUID        NOT NULL,
  model_id      UUID        NOT NULL,
  action        TEXT        NOT NULL CHECK (action IN ('viewed', 'rejected', 'booked')),
  occurred_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dlogs_org_ts
  ON public.discovery_logs (client_org_id, occurred_at DESC);

ALTER TABLE public.discovery_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "client_org_members_select_own_logs" ON public.discovery_logs;
CREATE POLICY "client_org_members_select_own_logs"
  ON public.discovery_logs FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.organization_members om
      WHERE om.organization_id = discovery_logs.client_org_id
        AND om.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.organizations o
      WHERE o.id       = discovery_logs.client_org_id
        AND o.owner_id = auth.uid()
    )
  );


-- ─── 7. RPC: record_client_interaction (v2) ───────────────────────────────────
--
-- Single UPSERT on (client_org_id, model_id) — only the relevant timestamp
-- column is updated for each action. Also inserts a row into discovery_logs
-- for append-only analytics.

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
    -- Not a client org member — silently return.
    RETURN;
  END IF;

  -- Single UPSERT: one row per (org, model), only the relevant column updated.
  INSERT INTO client_model_interactions (
    client_org_id,
    model_id,
    last_viewed_at,
    last_rejected_at,
    last_booked_at,
    updated_at
  )
  VALUES (
    v_org_id,
    p_model_id,
    CASE WHEN p_action = 'viewed'   THEN now() ELSE NULL END,
    CASE WHEN p_action = 'rejected' THEN now() ELSE NULL END,
    CASE WHEN p_action = 'booked'   THEN now() ELSE NULL END,
    now()
  )
  ON CONFLICT (client_org_id, model_id) DO UPDATE SET
    last_viewed_at   = CASE WHEN p_action = 'viewed'
                            THEN now()
                            ELSE client_model_interactions.last_viewed_at END,
    last_rejected_at = CASE WHEN p_action = 'rejected'
                            THEN now()
                            ELSE client_model_interactions.last_rejected_at END,
    last_booked_at   = CASE WHEN p_action = 'booked'
                            THEN now()
                            ELSE client_model_interactions.last_booked_at END,
    updated_at       = now();

  -- Analytics log (append-only, never blocks the caller).
  INSERT INTO discovery_logs (client_org_id, model_id, action)
  VALUES (v_org_id, p_model_id, p_action);
END;
$$;

REVOKE ALL    ON FUNCTION public.record_client_interaction(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_client_interaction(UUID, TEXT) TO authenticated;


-- ─── 8. RPC: get_discovery_models (v2) ────────────────────────────────────────
--
-- Upgrades from v1:
--   • org_interactions CTE reads the new single-row-per-(org,model) schema —
--     no GROUP BY needed, reads directly from indexed columns.
--   • Cursor pagination: if p_cursor_score + p_cursor_model_id are provided,
--     the query pages via keyset instead of OFFSET. Both modes coexist so
--     existing callers using p_from / p_to continue to work unchanged.
--   • p_limit replaces the p_to - p_from arithmetic; defaults to 50.

DROP FUNCTION IF EXISTS public.get_discovery_models(
  uuid, text, text, integer, integer, text, text, boolean, boolean,
  integer, integer, text, integer, integer, integer, integer,
  integer, integer, integer, integer, text, text[], uuid[], integer, integer
);

CREATE OR REPLACE FUNCTION public.get_discovery_models(
  -- Mandatory
  p_client_org_id   uuid,
  p_iso             text,
  -- Client type + pagination (legacy OFFSET kept for backward compat)
  p_client_type     text      DEFAULT 'all',
  p_from            integer   DEFAULT 0,
  p_to              integer   DEFAULT 49,
  -- Location + category
  p_client_city     text      DEFAULT NULL,
  p_category        text      DEFAULT NULL,
  -- Sports
  p_sports_winter   boolean   DEFAULT FALSE,
  p_sports_summer   boolean   DEFAULT FALSE,
  -- Measurements
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
  -- Demographic filters
  p_sex             text      DEFAULT NULL,
  p_ethnicities     text[]    DEFAULT NULL,
  -- Session dedup
  p_exclude_ids     uuid[]    DEFAULT NULL,
  -- Cooldown config
  p_reject_hours    integer   DEFAULT 24,
  p_book_days       integer   DEFAULT 7,
  -- Cursor pagination (optional — takes priority over p_from/p_to when set)
  p_cursor_score    integer   DEFAULT NULL,
  p_cursor_model_id uuid      DEFAULT NULL,
  p_limit           integer   DEFAULT 50
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
    -- v2: single row per (org, model) — no GROUP BY, direct column reads.
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
  scored AS (
    SELECT
      m.*,
      mat.country_code   AS territory_country_code,
      a.name             AS agency_name,
      mat.agency_id      AS territory_agency_id,
      (
        CASE WHEN oi.model_id IS NULL THEN 50 ELSE 0 END
        + CASE WHEN p_client_city IS NOT NULL
                 AND m.city IS NOT NULL
                 AND lower(trim(m.city)) = lower(trim(p_client_city))
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
  -- Cursor mode: keyset pagination via (score, model_id).
  -- Falls back to OFFSET when cursor params are not provided.
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
$$;

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

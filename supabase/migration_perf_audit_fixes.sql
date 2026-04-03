-- =============================================================================
-- Performance & Consistency Audit Fixes
--
-- 1. pg_trgm extension safety (ensures extension exists before any index uses it)
-- 2. Missing indexes (calendar_entries, option_requests, conversations)
-- 3. Dashboard RPC column-name corrections (organisation_id → organization_id,
--    start_date / end_date → date)
-- 4. check_calendar_conflict: refined NULL-time handling (less false positives)
-- 5. search_global: accepts optional p_limit parameter
-- =============================================================================

-- ─── 1. Extension (idempotent, safe to re-run) ────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ─── 2. Missing indexes ───────────────────────────────────────────────────────

-- Fast calendar lookups per model + date (used by check_calendar_conflict).
CREATE INDEX IF NOT EXISTS idx_calendar_entries_model_date
  ON public.calendar_entries (model_id, date);

-- GIN trigram on option_requests.model_name (search_global ILIKE query).
CREATE INDEX IF NOT EXISTS idx_option_requests_model_name_trgm
  ON public.option_requests USING gin (model_name gin_trgm_ops);

-- GIN trigram on conversations.title (search_global ILIKE query).
CREATE INDEX IF NOT EXISTS idx_conversations_title_trgm
  ON public.conversations USING gin (title gin_trgm_ops);

-- Partial index: fast read-status lookup for unread-thread counts.
CREATE INDEX IF NOT EXISTS idx_messages_unread
  ON public.messages (conversation_id)
  WHERE read_at IS NULL;

-- ─── 3. Dashboard RPC — corrected column names ───────────────────────────────
-- The previous version used uce.organisation_id (wrong spelling) and
-- uce.start_date / uce.end_date (columns that do not exist).
-- The actual table has: organization_id  and  date (DATE column).

CREATE OR REPLACE FUNCTION public.get_dashboard_summary(
  p_org_id  uuid,
  p_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_member      boolean;
  v_org_type       text;
  v_agency_id      uuid;
  v_open_options   integer := 0;
  v_unread_threads integer := 0;
  v_today_events   integer := 0;
BEGIN
  -- ── Security: verify the caller is actually a member of p_org_id ──────────
  SELECT EXISTS (
    SELECT 1
    FROM organization_members om
    WHERE om.organization_id = p_org_id
      AND om.user_id = p_user_id
      AND p_user_id = auth.uid()
  ) INTO v_is_member;

  IF NOT v_is_member THEN
    RAISE EXCEPTION 'Access denied: not a member of this organization';
  END IF;

  -- ── Detect org type ───────────────────────────────────────────────────────
  SELECT o.type::text, o.agency_id
  INTO   v_org_type, v_agency_id
  FROM   organizations o
  WHERE  o.id = p_org_id;

  -- ── 1. Open option requests (status = in_negotiation) ────────────────────
  IF v_org_type = 'agency' AND v_agency_id IS NOT NULL THEN
    SELECT COUNT(*)
    INTO   v_open_options
    FROM   option_requests r
    WHERE  r.agency_id = v_agency_id
      AND  r.status = 'in_negotiation';
  ELSIF v_org_type = 'client' THEN
    SELECT COUNT(*)
    INTO   v_open_options
    FROM   option_requests r
    WHERE  r.organization_id = p_org_id
      AND  r.status = 'in_negotiation';
  END IF;

  -- ── 2. Unread threads ─────────────────────────────────────────────────────
  SELECT COUNT(DISTINCT c.id)
  INTO   v_unread_threads
  FROM   conversations c
  JOIN   messages      m ON m.conversation_id = c.id
  WHERE  (
           p_user_id = ANY(c.participant_ids)
           OR c.client_organization_id = p_org_id
           OR c.agency_organization_id = p_org_id
         )
    AND  m.sender_id != p_user_id
    AND  m.read_at IS NULL;

  -- ── 3. Today's calendar events — uses correct column: date (DATE) ─────────
  SELECT COUNT(*)
  INTO   v_today_events
  FROM   user_calendar_events uce
  WHERE  uce.organization_id = p_org_id          -- correct spelling
    AND  uce.date = CURRENT_DATE;                -- correct column

  RETURN jsonb_build_object(
    'open_option_requests', v_open_options,
    'unread_threads',       v_unread_threads,
    'today_events',         v_today_events
  );
END;
$$;

ALTER FUNCTION public.get_dashboard_summary(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_dashboard_summary(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_dashboard_summary(uuid, uuid) TO authenticated;

-- ─── 4. check_calendar_conflict — refined NULL handling ───────────────────────
-- Previous version treated any entry with start_time IS NULL OR end_time IS NULL
-- as a conflict, producing false positives for partial-time entries.
-- New logic:
--   · Both times NULL   → entry is all-day: conflicts only if new entry is also
--                         all-day (both p_start and p_end are NULL).
--   · Partial times     → use COALESCE with generous defaults (00:00 / 23:59)
--                         for a proper overlap check.

CREATE OR REPLACE FUNCTION public.check_calendar_conflict(
  p_model_id uuid,
  p_date     date,
  p_start    time,
  p_end      time
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entries jsonb;
  v_count   integer;
BEGIN
  SELECT
    COUNT(*),
    jsonb_agg(jsonb_build_object(
      'id',         ce.id,
      'entry_type', ce.entry_type,
      'start_time', ce.start_time,
      'end_time',   ce.end_time,
      'title',      ce.title
    ))
  INTO v_count, v_entries
  FROM public.calendar_entries ce
  WHERE ce.model_id  = p_model_id
    AND ce.date      = p_date
    AND ce.entry_type IN ('option', 'casting', 'job')
    AND (
      CASE
        -- Existing entry has no time window (all-day).
        -- Treat as conflict only when the new entry is also all-day.
        WHEN ce.start_time IS NULL AND ce.end_time IS NULL
          THEN p_start IS NULL AND p_end IS NULL

        -- Existing entry has at least one bound: use generous defaults
        -- to check a proper half-open interval overlap.
        ELSE
          COALESCE(ce.start_time, '00:00:00'::time)
            < COALESCE(p_end,   '23:59:59'::time)
          AND
          COALESCE(ce.end_time, '23:59:59'::time)
            > COALESCE(p_start, '00:00:00'::time)
      END
    );

  RETURN jsonb_build_object(
    'has_conflict',        v_count > 0,
    'conflicting_entries', COALESCE(v_entries, '[]'::jsonb)
  );
END;
$$;

ALTER FUNCTION public.check_calendar_conflict(uuid, date, time, time) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.check_calendar_conflict(uuid, date, time, time) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_calendar_conflict(uuid, date, time, time) TO authenticated;

-- ─── 5. search_global — optional p_limit parameter ───────────────────────────
-- Adds a p_limit parameter (default 5) so callers can request fewer or more
-- results per category without changing the RPC signature for existing callers.

CREATE OR REPLACE FUNCTION public.search_global(
  p_query  text,
  p_org_id uuid,
  p_limit  integer DEFAULT 5
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_member   boolean;
  v_org_type    text;
  v_agency_id   uuid;
  v_pattern     text;
  v_models      jsonb;
  v_options     jsonb;
  v_convs       jsonb;
  v_limit       integer;
BEGIN
  -- Clamp limit: min 1, max 20.
  v_limit := GREATEST(1, LEAST(COALESCE(p_limit, 5), 20));

  -- ── Security guard ─────────────────────────────────────────────────────────
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_members om
    WHERE om.organization_id = p_org_id
      AND om.user_id = auth.uid()
  ) INTO v_is_member;

  IF NOT v_is_member THEN
    RAISE EXCEPTION 'Access denied: not a member of this organization';
  END IF;

  p_query := trim(p_query);
  IF length(p_query) < 2 THEN
    RETURN jsonb_build_object('models', '[]'::jsonb, 'option_requests', '[]'::jsonb, 'conversations', '[]'::jsonb);
  END IF;

  v_pattern := '%' || p_query || '%';

  SELECT o.type::text, o.agency_id
  INTO   v_org_type, v_agency_id
  FROM   public.organizations o
  WHERE  o.id = p_org_id;

  -- ── 1. Models ──────────────────────────────────────────────────────────────
  IF v_org_type = 'agency' AND v_agency_id IS NOT NULL THEN
    SELECT jsonb_agg(row_to_json(r))
    INTO   v_models
    FROM (
      SELECT m.id, m.name, m.mediaslide_sync_id AS mediaslide_id, m.city, m.country
      FROM   public.models m
      WHERE  m.agency_id = v_agency_id
        AND  (m.name ILIKE v_pattern OR m.mediaslide_sync_id ILIKE v_pattern)
      ORDER  BY m.name
      LIMIT  v_limit
    ) r;
  ELSE
    SELECT jsonb_agg(row_to_json(r))
    INTO   v_models
    FROM (
      SELECT DISTINCT ON (m.id) m.id, m.name, m.mediaslide_sync_id AS mediaslide_id, m.city, m.country
      FROM   public.models m
      JOIN   public.option_requests op ON op.model_id = m.id
      WHERE  op.organization_id = p_org_id
        AND  (m.name ILIKE v_pattern OR m.mediaslide_sync_id ILIKE v_pattern)
      ORDER  BY m.id, m.name
      LIMIT  v_limit
    ) r;
  END IF;

  -- ── 2. Option Requests ─────────────────────────────────────────────────────
  IF v_org_type = 'agency' AND v_agency_id IS NOT NULL THEN
    SELECT jsonb_agg(row_to_json(r))
    INTO   v_options
    FROM (
      SELECT op.id, op.model_name AS model_name, op.status, op.final_status,
             op.requested_date, op.request_type AS role
      FROM   public.option_requests op
      WHERE  op.agency_id = v_agency_id
        AND  (op.model_name ILIKE v_pattern OR op.request_type ILIKE v_pattern OR op.client_name ILIKE v_pattern)
      ORDER  BY op.created_at DESC
      LIMIT  v_limit
    ) r;
  ELSE
    SELECT jsonb_agg(row_to_json(r))
    INTO   v_options
    FROM (
      SELECT op.id, op.model_name AS model_name, op.status, op.final_status,
             op.requested_date, op.request_type AS role
      FROM   public.option_requests op
      WHERE  op.organization_id = p_org_id
        AND  (op.model_name ILIKE v_pattern OR op.request_type ILIKE v_pattern)
      ORDER  BY op.created_at DESC
      LIMIT  v_limit
    ) r;
  END IF;

  -- ── 3. Conversations ───────────────────────────────────────────────────────
  SELECT jsonb_agg(row_to_json(r))
  INTO   v_convs
  FROM (
    SELECT c.id, c.title,
           (SELECT m2.text FROM public.messages m2
            WHERE m2.conversation_id = c.id
            ORDER BY m2.created_at DESC LIMIT 1) AS last_message
    FROM   public.conversations c
    WHERE  (
             auth.uid() = ANY(c.participant_ids)
             OR c.client_organization_id = p_org_id
             OR c.agency_organization_id = p_org_id
           )
      AND  (
             c.title ILIKE v_pattern
             OR EXISTS (
               SELECT 1 FROM public.messages mx
               WHERE mx.conversation_id = c.id
                 AND mx.text ILIKE v_pattern
             )
           )
    ORDER  BY c.updated_at DESC
    LIMIT  v_limit
  ) r;

  RETURN jsonb_build_object(
    'models',          COALESCE(v_models,  '[]'::jsonb),
    'option_requests', COALESCE(v_options, '[]'::jsonb),
    'conversations',   COALESCE(v_convs,   '[]'::jsonb)
  );
END;
$$;

ALTER FUNCTION public.search_global(text, uuid, integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.search_global(text, uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_global(text, uuid, integer) TO authenticated;

-- =============================================================================
-- Dashboard Summary RPC
--
-- get_dashboard_summary(p_org_id, p_user_id):
--   Returns { open_option_requests, unread_threads, today_events }
--   Scoped strictly to the caller's organization.
--   Security: verifies caller is a member of p_org_id before any data access.
-- =============================================================================

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
      AND p_user_id = auth.uid()  -- caller can only query for themselves
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

  -- ── 2. Unread threads (conversations with at least one unread message) ────
  --    A message is unread when: read_at IS NULL AND sender_id != p_user_id
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

  -- ── 3. Today's calendar events for this org ───────────────────────────────
  SELECT COUNT(*)
  INTO   v_today_events
  FROM   user_calendar_events uce
  WHERE  uce.organisation_id = p_org_id
    AND  uce.start_date::date <= CURRENT_DATE
    AND  (uce.end_date IS NULL OR uce.end_date::date >= CURRENT_DATE);

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

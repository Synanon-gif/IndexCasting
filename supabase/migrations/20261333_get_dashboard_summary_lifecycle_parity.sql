-- =============================================================================
-- Dashboard summary lifecycle parity (Agency + Client):
--   - Client open requests: COALESCE(client_organization_id, organization_id)
--   - Today's events: exclude cancelled + orphaned/rejected linked option rows
-- Realtime client filters should use both org id columns (see useOrgDashboardRealtimeBump).
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
SET row_security TO off
AS $$
DECLARE
  v_is_member      boolean;
  v_org_type       text;
  v_agency_id      uuid;
  v_open_options   integer := 0;
  v_unread_threads integer := 0;
  v_today_events   integer := 0;
BEGIN
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

  SELECT o.type::text, o.agency_id
  INTO   v_org_type, v_agency_id
  FROM   organizations o
  WHERE  o.id = p_org_id;

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
    WHERE  COALESCE(r.client_organization_id, r.organization_id) = p_org_id
      AND  r.status = 'in_negotiation';
  END IF;

  IF v_org_type = 'client' THEN
    SELECT COUNT(DISTINCT c.id)
    INTO   v_unread_threads
    FROM   conversations c
    JOIN   messages m ON m.conversation_id = c.id
    WHERE  c.type = 'direct'
      AND  c.context_id LIKE 'b2b:%'
      AND (c.client_organization_id = p_org_id OR c.agency_organization_id = p_org_id)
      AND  m.sender_id <> p_user_id
      AND  m.read_at IS NULL
      AND  NOT (
            m.message_type = 'booking'
            AND COALESCE(m.metadata->>'status', '') IN ('deleted', 'rejected')
          );
  ELSIF v_org_type = 'agency' THEN
    SELECT COUNT(DISTINCT c.id)
    INTO   v_unread_threads
    FROM   conversations c
    JOIN   messages m ON m.conversation_id = c.id
    WHERE  c.type = 'direct'
      AND  (
             (c.context_id LIKE 'b2b:%'
              AND (c.client_organization_id = p_org_id OR c.agency_organization_id = p_org_id))
          OR (c.context_id LIKE 'agency-model:%' AND c.agency_organization_id = p_org_id)
           )
      AND  m.sender_id <> p_user_id
      AND  m.read_at IS NULL
      AND  NOT (
            m.message_type = 'booking'
            AND COALESCE(m.metadata->>'status', '') IN ('deleted', 'rejected')
          );
  ELSE
    v_unread_threads := 0;
  END IF;

  SELECT COUNT(*)
  INTO   v_today_events
  FROM   user_calendar_events uce
  WHERE  uce.date = CURRENT_DATE
    AND  COALESCE(uce.status, 'active') <> 'cancelled'
    AND  (
           uce.source_option_request_id IS NULL
        OR EXISTS (
             SELECT 1
             FROM   option_requests orq
             WHERE  orq.id = uce.source_option_request_id
               AND  orq.status IS DISTINCT FROM 'rejected'
           )
         )
    AND  (
           uce.organization_id = p_org_id
        OR (
             v_org_type = 'agency'
             AND v_agency_id IS NOT NULL
             AND uce.owner_type = 'agency'
             AND uce.owner_id = v_agency_id
           )
        OR (
             v_org_type = 'client'
             AND uce.owner_type = 'client'
             AND uce.owner_id IN (
               SELECT om.user_id
               FROM organization_members om
               WHERE om.organization_id = p_org_id
             )
           )
         );

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

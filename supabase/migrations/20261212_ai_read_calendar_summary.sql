-- =============================================================================
-- Phase 2 AI Assistant Foundation: ai_read_calendar_summary
--
-- Purpose:
--   Narrow read-only live-data contract for the AI assistant's first allowlisted
--   intent: calendar_summary.
--
-- Security boundaries:
--   - No service_role path; called with the user's JWT through PostgREST.
--   - SECURITY DEFINER is used only to assemble a minimal read model while
--     explicitly validating auth.uid(), organization membership, org type, and
--     date/limit bounds inside the function.
--   - No free SQL, no arbitrary table/RPC access, no writes.
--   - Agency and Client only. Model, admin, billing, messages, team, invites,
--     GDPR export/delete, and cross-org data are intentionally outside scope.
--   - Returns product labels, not internal enum/status values.
--   - Excludes emails, billing/payment fields, message text, file URLs, and IDs.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.ai_read_calendar_summary(
  p_viewer_role text,
  p_start_date date,
  p_end_date date,
  p_limit integer DEFAULT 25
)
RETURNS TABLE(
  "date" date,
  start_time text,
  end_time text,
  kind text,
  title text,
  model_name text,
  counterparty_name text,
  status_label text,
  note text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_org_id uuid;
  v_agency_id uuid;
  v_org_count integer;
  v_limit integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF p_viewer_role NOT IN ('agency', 'client') THEN
    RAISE EXCEPTION 'unsupported_role';
  END IF;

  IF p_start_date IS NULL OR p_end_date IS NULL OR p_end_date < p_start_date THEN
    RAISE EXCEPTION 'invalid_date_range';
  END IF;

  IF (p_end_date - p_start_date) > 30 THEN
    RAISE EXCEPTION 'date_range_too_large';
  END IF;

  v_limit := LEAST(GREATEST(COALESCE(p_limit, 25), 1), 50);

  SELECT COUNT(*)::integer
  INTO v_org_count
  FROM public.organization_members om
  JOIN public.organizations o ON o.id = om.organization_id
  WHERE om.user_id = v_uid
    AND o.type::text = p_viewer_role
    AND (
      (p_viewer_role = 'agency' AND om.role IN ('owner'::org_member_role, 'booker'::org_member_role))
      OR
      (p_viewer_role = 'client' AND om.role IN ('owner'::org_member_role, 'employee'::org_member_role))
    );

  IF v_org_count = 0 THEN
    RAISE EXCEPTION 'org_context_missing';
  END IF;
  IF v_org_count > 1 THEN
    RAISE EXCEPTION 'org_context_ambiguous';
  END IF;

  SELECT o.id, o.agency_id
  INTO v_org_id, v_agency_id
  FROM public.organization_members om
  JOIN public.organizations o ON o.id = om.organization_id
  WHERE om.user_id = v_uid
    AND o.type::text = p_viewer_role
    AND (
      (p_viewer_role = 'agency' AND om.role IN ('owner'::org_member_role, 'booker'::org_member_role))
      OR
      (p_viewer_role = 'client' AND om.role IN ('owner'::org_member_role, 'employee'::org_member_role))
    )
  LIMIT 1;

  RETURN QUERY
  WITH option_rows AS (
    SELECT
      oq.requested_date AS event_date,
      COALESCE(ce.start_time::text, oq.start_time::text) AS event_start_time,
      COALESCE(ce.end_time::text, oq.end_time::text) AS event_end_time,
      CASE
        WHEN oq.final_status::text = 'job_confirmed' THEN 'job'
        WHEN COALESCE(oq.request_type::text, 'option') = 'casting' THEN 'casting'
        ELSE 'option'
      END AS event_kind,
      CASE
        WHEN oq.final_status::text = 'job_confirmed' THEN 'Job'
        WHEN COALESCE(oq.request_type::text, 'option') = 'casting' THEN 'Casting'
        ELSE 'Option'
      END AS event_title,
      NULLIF(BTRIM(oq.model_name), '') AS visible_model_name,
      CASE
        WHEN p_viewer_role = 'agency'
          THEN NULLIF(BTRIM(COALESCE(oq.client_organization_name, oq.client_name)), '')
        ELSE NULLIF(BTRIM(oq.agency_organization_name), '')
      END AS visible_counterparty_name,
      CASE
        WHEN oq.final_status::text = 'job_confirmed' THEN 'Job confirmed'
        WHEN COALESCE(oq.request_type::text, 'option') = 'casting'
             AND oq.final_status::text = 'option_confirmed' THEN 'Casting confirmed'
        WHEN oq.final_status::text = 'option_confirmed' THEN 'Option confirmed'
        ELSE 'In progress'
      END AS visible_status_label,
      NULL::text AS visible_note
    FROM public.option_requests oq
    LEFT JOIN LATERAL (
      SELECT ce2.start_time, ce2.end_time
      FROM public.calendar_entries ce2
      WHERE ce2.option_request_id = oq.id
        AND COALESCE(ce2.status::text, '') <> 'cancelled'
      ORDER BY ce2.created_at DESC
      LIMIT 1
    ) ce ON true
    WHERE oq.requested_date BETWEEN p_start_date AND p_end_date
      AND oq.status::text <> 'rejected'
      AND (
        (
          p_viewer_role = 'agency'
          AND (
            oq.agency_organization_id = v_org_id
            OR (v_agency_id IS NOT NULL AND oq.agency_id = v_agency_id)
          )
        )
        OR
        (
          p_viewer_role = 'client'
          AND (
            COALESCE(oq.client_organization_id, oq.organization_id) = v_org_id
            OR oq.client_id = v_uid
          )
        )
      )
  ),
  private_event_rows AS (
    SELECT
      uce.date AS event_date,
      uce.start_time::text AS event_start_time,
      uce.end_time::text AS event_end_time,
      'private_event'::text AS event_kind,
      uce.title AS event_title,
      NULL::text AS visible_model_name,
      NULL::text AS visible_counterparty_name,
      'Private event'::text AS visible_status_label,
      uce.note AS visible_note
    FROM public.user_calendar_events uce
    WHERE uce.date BETWEEN p_start_date AND p_end_date
      AND uce.owner_type = p_viewer_role
      AND uce.organization_id = v_org_id
      AND uce.source_option_request_id IS NULL
      AND COALESCE(uce.status, 'active') <> 'cancelled'
  ),
  booking_rows AS (
    SELECT
      be.date AS event_date,
      NULL::text AS event_start_time,
      NULL::text AS event_end_time,
      'booking'::text AS event_kind,
      COALESCE(NULLIF(BTRIM(be.title), ''), 'Booking') AS event_title,
      NULLIF(BTRIM(m.name), '') AS visible_model_name,
      CASE
        WHEN p_viewer_role = 'agency' THEN NULLIF(BTRIM(client_org.name), '')
        ELSE NULLIF(BTRIM(agency_org.name), '')
      END AS visible_counterparty_name,
      CASE
        WHEN be.status = 'completed' THEN 'Completed booking'
        WHEN be.status = 'model_confirmed' THEN 'Confirmed booking'
        WHEN be.status = 'agency_accepted' THEN 'Agency accepted'
        ELSE 'Pending booking'
      END AS visible_status_label,
      NULL::text AS visible_note
    FROM public.booking_events be
    LEFT JOIN public.models m ON m.id = be.model_id
    LEFT JOIN public.organizations client_org ON client_org.id = be.client_org_id
    LEFT JOIN public.organizations agency_org ON agency_org.id = be.agency_org_id
    WHERE be.date BETWEEN p_start_date AND p_end_date
      AND be.status <> 'cancelled'
      AND be.source_option_request_id IS NULL
      AND (
        (p_viewer_role = 'agency' AND be.agency_org_id = v_org_id)
        OR
        (p_viewer_role = 'client' AND be.client_org_id = v_org_id)
      )
  ),
  rows AS (
    SELECT * FROM option_rows
    UNION ALL
    SELECT * FROM private_event_rows
    UNION ALL
    SELECT * FROM booking_rows
  )
  SELECT
    rows.event_date AS "date",
    rows.event_start_time AS start_time,
    rows.event_end_time AS end_time,
    rows.event_kind AS kind,
    rows.event_title AS title,
    rows.visible_model_name AS model_name,
    rows.visible_counterparty_name AS counterparty_name,
    rows.visible_status_label AS status_label,
    rows.visible_note AS note
  FROM rows
  ORDER BY rows.event_date ASC, rows.event_start_time ASC NULLS LAST, rows.event_title ASC
  LIMIT v_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.ai_read_calendar_summary(text, date, date, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ai_read_calendar_summary(text, date, date, integer) TO authenticated;

COMMENT ON FUNCTION public.ai_read_calendar_summary(text, date, date, integer) IS
  'Phase 2 AI assistant read-only calendar summary. Validates auth.uid(), exactly one matching Agency/Client org membership, max 31-day range, and 1-50 row limit. Returns minimal product labels only; no IDs, emails, billing, message text, file URLs, or writes.';

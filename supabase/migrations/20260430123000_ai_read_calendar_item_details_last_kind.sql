-- AI Assistant: allow last-item RPC to filter by calendar kind (not only job).
-- p_last_kind: NULL = any kind; default 'job' preserves prior behavior when omitted.

DROP FUNCTION IF EXISTS public.ai_read_calendar_item_details(text, text, jsonb, date, date, integer);

CREATE OR REPLACE FUNCTION public.ai_read_calendar_item_details(
  p_viewer_role text,
  p_mode text DEFAULT 'reference',
  p_reference jsonb DEFAULT NULL,
  p_start_date date DEFAULT NULL,
  p_end_date date DEFAULT NULL,
  p_limit integer DEFAULT 2,
  p_last_kind text DEFAULT 'job'
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
  v_start_date date;
  v_end_date date;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF p_viewer_role NOT IN ('agency', 'client') THEN
    RAISE EXCEPTION 'unsupported_role';
  END IF;

  IF p_mode NOT IN ('reference', 'last_job') THEN
    RAISE EXCEPTION 'unsupported_mode';
  END IF;

  IF p_mode = 'last_job' AND p_last_kind IS NOT NULL AND p_last_kind NOT IN (
    'job', 'option', 'casting', 'booking', 'private_event'
  ) THEN
    RAISE EXCEPTION 'invalid_last_kind';
  END IF;

  v_limit := LEAST(GREATEST(COALESCE(p_limit, 2), 1), 2);

  IF p_mode = 'last_job' THEN
    IF p_start_date IS NULL OR p_end_date IS NULL OR p_end_date < p_start_date THEN
      RAISE EXCEPTION 'invalid_date_range';
    END IF;
    IF (p_end_date - p_start_date) > 89 THEN
      RAISE EXCEPTION 'date_range_too_large';
    END IF;
    v_start_date := p_start_date;
    v_end_date := p_end_date;
  ELSE
    IF p_reference IS NULL OR jsonb_typeof(p_reference) <> 'object' THEN
      RAISE EXCEPTION 'invalid_reference';
    END IF;
  END IF;

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
    );

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'org_context_missing';
  END IF;

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
      NULLIF(BTRIM(oq.job_description), '') AS visible_note
    FROM public.option_requests oq
    LEFT JOIN LATERAL (
      SELECT ce2.start_time, ce2.end_time
      FROM public.calendar_entries ce2
      WHERE ce2.option_request_id = oq.id
        AND COALESCE(ce2.status::text, '') <> 'cancelled'
      ORDER BY ce2.created_at DESC
      LIMIT 1
    ) ce ON true
    WHERE oq.status::text <> 'rejected'
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
      NULLIF(BTRIM(uce.note), '') AS visible_note
    FROM public.user_calendar_events uce
    WHERE uce.owner_type = p_viewer_role
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
      NULLIF(BTRIM(be.note), '') AS visible_note
    FROM public.booking_events be
    LEFT JOIN public.models m ON m.id = be.model_id
    LEFT JOIN public.organizations client_org ON client_org.id = be.client_org_id
    LEFT JOIN public.organizations agency_org ON agency_org.id = be.agency_org_id
    WHERE be.status <> 'cancelled'
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
  ),
  filtered AS (
    SELECT *
    FROM rows
    WHERE (
      p_mode = 'last_job'
      AND rows.event_date BETWEEN v_start_date AND v_end_date
      AND (p_last_kind IS NULL OR rows.event_kind = p_last_kind)
    )
    OR (
      p_mode = 'reference'
      AND rows.event_date::text = p_reference ->> 'date'
      AND rows.event_kind = p_reference ->> 'kind'
      AND rows.event_title = p_reference ->> 'title'
      AND COALESCE(rows.visible_model_name, '') = COALESCE(p_reference ->> 'model_name', '')
      AND COALESCE(rows.visible_counterparty_name, '') = COALESCE(p_reference ->> 'counterparty_name', '')
    )
  )
  SELECT
    filtered.event_date AS "date",
    filtered.event_start_time AS start_time,
    filtered.event_end_time AS end_time,
    filtered.event_kind AS kind,
    filtered.event_title AS title,
    filtered.visible_model_name AS model_name,
    filtered.visible_counterparty_name AS counterparty_name,
    filtered.visible_status_label AS status_label,
    filtered.visible_note AS note
  FROM filtered
  ORDER BY
    CASE WHEN p_mode = 'last_job' THEN filtered.event_date END DESC,
    CASE WHEN p_mode = 'last_job' THEN filtered.event_start_time END DESC NULLS LAST,
    CASE WHEN p_mode = 'reference' THEN filtered.event_date END ASC,
    filtered.event_title ASC
  LIMIT v_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.ai_read_calendar_item_details(text, text, jsonb, date, date, integer, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ai_read_calendar_item_details(text, text, jsonb, date, date, integer, text)
  TO authenticated;

COMMENT ON FUNCTION public.ai_read_calendar_item_details(text, text, jsonb, date, date, integer, text) IS
  'Phase 2 AI assistant read-only calendar item details. last_job mode supports optional p_last_kind (NULL = any kind; default job).';

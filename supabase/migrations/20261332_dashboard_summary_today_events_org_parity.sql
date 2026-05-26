-- =============================================================================
-- Dashboard "Today's Events" parity: synced user_calendar_events lacked
-- organization_id, so get_dashboard_summary always returned 0 for today_events
-- while the Calendar tab showed option/casting rows (owner_id match only).
--
-- Also backfills organization_id on historical synced rows and sets it in
-- sync_user_calendars_on_option_confirmed / sync_user_calendars_on_job_confirmed.
-- =============================================================================

-- Backfill client-party synced rows
UPDATE public.user_calendar_events uce
SET organization_id = COALESCE(orq.client_organization_id, orq.organization_id)
FROM public.option_requests orq
WHERE uce.source_option_request_id = orq.id
  AND uce.owner_type = 'client'
  AND uce.organization_id IS NULL
  AND COALESCE(orq.client_organization_id, orq.organization_id) IS NOT NULL;

-- Backfill agency-party synced rows
UPDATE public.user_calendar_events uce
SET organization_id = COALESCE(
  orq.agency_organization_id,
  (
    SELECT o.id
    FROM public.organizations o
    WHERE o.agency_id = orq.agency_id
      AND o.type = 'agency'
    ORDER BY o.created_at ASC
    LIMIT 1
  )
)
FROM public.option_requests orq
WHERE uce.source_option_request_id = orq.id
  AND uce.owner_type = 'agency'
  AND uce.organization_id IS NULL
  AND orq.agency_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.sync_user_calendars_on_option_confirmed()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_color text;
  v_label_prefix text;
  v_client_org_id uuid;
  v_agency_org_id uuid;
BEGIN
  IF NEW.final_status IS DISTINCT FROM 'option_confirmed' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.final_status = 'option_confirmed' THEN
    RETURN NEW;
  END IF;

  v_client_org_id := COALESCE(NEW.client_organization_id, NEW.organization_id);
  v_agency_org_id := COALESCE(
    NEW.agency_organization_id,
    (
      SELECT o.id
      FROM public.organizations o
      WHERE o.agency_id = NEW.agency_id
        AND o.type = 'agency'
      ORDER BY o.created_at ASC
      LIMIT 1
    )
  );

  IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND OLD.final_status IS DISTINCT FROM NEW.final_status) THEN
    IF NEW.request_type = 'casting' THEN
      v_color := '#1565C0';
      v_label_prefix := 'Casting – ';
    ELSE
      v_color := '#E65100';
      v_label_prefix := 'Option – ';
    END IF;

    IF NEW.client_id IS NOT NULL THEN
      INSERT INTO public.user_calendar_events (
        owner_id, owner_type, date, start_time, end_time, title, color, note,
        source_option_request_id, organization_id
      ) VALUES (
        NEW.client_id,
        'client',
        NEW.requested_date,
        NEW.start_time,
        NEW.end_time,
        v_label_prefix || COALESCE(NULLIF(NEW.model_name, ''), 'Model'),
        v_color,
        'Synced booking. Shared notes are stored in the app (calendar entry / booking details).',
        NEW.id,
        v_client_org_id
      )
      ON CONFLICT DO NOTHING;
    END IF;

    IF NEW.agency_id IS NOT NULL THEN
      INSERT INTO public.user_calendar_events (
        owner_id, owner_type, date, start_time, end_time, title, color, note,
        source_option_request_id, organization_id
      ) VALUES (
        NEW.agency_id,
        'agency',
        NEW.requested_date,
        NEW.start_time,
        NEW.end_time,
        v_label_prefix || COALESCE(
          NULLIF(NEW.client_organization_name, ''),
          NULLIF(NEW.client_name, ''),
          'Client'
        ),
        v_color,
        'Synced booking. Shared notes are stored in the app (calendar entry / booking details).',
        NEW.id,
        v_agency_org_id
      )
      ON CONFLICT DO NOTHING;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_user_calendars_on_option_job_confirmed()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client_title text;
  v_agency_title text;
  v_job_color    text := '#2E7D32';
  v_client_org_id uuid;
  v_agency_org_id uuid;
BEGIN
  IF NEW.final_status IS DISTINCT FROM 'job_confirmed' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.final_status = 'job_confirmed' THEN
    RETURN NEW;
  END IF;

  v_client_org_id := COALESCE(NEW.client_organization_id, NEW.organization_id);
  v_agency_org_id := COALESCE(
    NEW.agency_organization_id,
    (
      SELECT o.id
      FROM public.organizations o
      WHERE o.agency_id = NEW.agency_id
        AND o.type = 'agency'
      ORDER BY o.created_at ASC
      LIMIT 1
    )
  );

  v_client_title :=
    'Job – ' || COALESCE(NULLIF(NEW.model_name, ''), 'Model');
  v_agency_title :=
    'Job – ' || COALESCE(NULLIF(NEW.client_organization_name, ''),
                         NULLIF(NEW.client_name, ''),
                         NULLIF(NEW.agency_organization_name, ''),
                         'Client');

  UPDATE public.user_calendar_events
     SET title = v_client_title,
         color = v_job_color,
         organization_id = COALESCE(organization_id, v_client_org_id)
   WHERE source_option_request_id = NEW.id
     AND owner_id = NEW.client_id
     AND owner_type = 'client'
     AND COALESCE(status, 'active') <> 'cancelled';

  UPDATE public.user_calendar_events
     SET title = v_agency_title,
         color = v_job_color,
         organization_id = COALESCE(organization_id, v_agency_org_id)
   WHERE source_option_request_id = NEW.id
     AND owner_id = NEW.agency_id
     AND owner_type = 'agency'
     AND COALESCE(status, 'active') <> 'cancelled';

  IF NEW.client_id IS NOT NULL THEN
    INSERT INTO public.user_calendar_events (
      owner_id, owner_type, date, start_time, end_time,
      title, color, note, source_option_request_id, organization_id
    ) VALUES (
      NEW.client_id, 'client', NEW.requested_date, NEW.start_time, NEW.end_time,
      v_client_title, v_job_color,
      'Synced booking. Shared notes are stored in the app (calendar entry / booking details).',
      NEW.id,
      v_client_org_id
    )
    ON CONFLICT DO NOTHING;
  END IF;

  IF NEW.agency_id IS NOT NULL THEN
    INSERT INTO public.user_calendar_events (
      owner_id, owner_type, date, start_time, end_time,
      title, color, note, source_option_request_id, organization_id
    ) VALUES (
      NEW.agency_id, 'agency', NEW.requested_date, NEW.start_time, NEW.end_time,
      v_agency_title, v_job_color,
      'Synced booking. Shared notes are stored in the app (calendar entry / booking details).',
      NEW.id,
      v_agency_org_id
    )
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

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
    WHERE  r.organization_id = p_org_id
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

  -- Today: org-scoped rows OR legacy synced rows (owner_id party match) until backfill complete.
  SELECT COUNT(*)
  INTO   v_today_events
  FROM   user_calendar_events uce
  WHERE  uce.date = CURRENT_DATE
    AND  COALESCE(uce.status, 'active') <> 'cancelled'
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

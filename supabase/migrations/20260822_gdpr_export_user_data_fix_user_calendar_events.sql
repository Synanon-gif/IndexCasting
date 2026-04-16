-- =============================================================================
-- GDPR: export_user_data — fix user_calendar_events column drift (42703)
-- Replaces phantom columns start_date/end_date/event_type with real schema:
--   date, start_time, end_time, owner_type, color, note, source_option_request_id,
--   reminder_at, status, updated_at
-- Extends subject scope: org-shared rows via organization_id + organization_members.
-- Pre-deploy assert: required columns must exist on user_calendar_events.
-- =============================================================================

DO $$
DECLARE
  v_need text[] := ARRAY[
    'date', 'start_time', 'end_time', 'owner_type', 'title', 'organization_id',
    'created_by', 'status', 'updated_at'
  ];
  v_col text;
BEGIN
  FOREACH v_col IN ARRAY v_need LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'user_calendar_events'
        AND column_name = v_col
    ) THEN
      RAISE EXCEPTION '20260822 precheck: user_calendar_events missing column %', v_col;
    END IF;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.export_user_data(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
DECLARE
  v_uid    UUID := auth.uid();
  v_result JSONB;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'invalid_user_id';
  END IF;

  IF v_uid <> p_user_id
     AND NOT public.is_current_user_admin()
     AND NOT public.is_current_user_super_admin() THEN
    RAISE EXCEPTION 'permission_denied: can only export own data';
  END IF;

  SELECT jsonb_build_object(
    'export_version', 2,
    'exported_at',   now(),
    'user_id',         p_user_id,

    'profile', (
      SELECT row_to_json(p)::JSONB
      FROM (
        SELECT id, email, display_name, role, phone, website, country,
               company_name, created_at, tos_accepted, privacy_accepted,
               deletion_requested_at
        FROM public.profiles WHERE id = p_user_id
      ) p
    ),

    'consent_log', (
      SELECT jsonb_agg(row_to_json(c))
      FROM (
        SELECT consent_type, version, accepted_at, ip_address, withdrawn_at, withdrawal_reason
        FROM public.consent_log WHERE user_id = p_user_id
        ORDER BY accepted_at DESC
      ) c
    ),

    'legal_acceptances', (
      SELECT jsonb_agg(row_to_json(l))
      FROM (
        SELECT id, document_type, document_version, accepted, ip_address, user_agent, created_at
        FROM public.legal_acceptances WHERE user_id = p_user_id
        ORDER BY created_at DESC
      ) l
    ),

    'organizations', (
      SELECT jsonb_agg(row_to_json(o))
      FROM (
        SELECT om.role, om.created_at AS joined_at,
               org.type AS org_type, org.id AS org_id
        FROM public.organization_members om
        JOIN public.organizations org ON org.id = om.organization_id
        WHERE om.user_id = p_user_id
      ) o
    ),

    'messages_sent', (
      SELECT jsonb_agg(row_to_json(m))
      FROM (
        SELECT id, conversation_id, sender_id, text, file_url, file_type, read_at, created_at
        FROM public.messages
        WHERE sender_id = p_user_id
        ORDER BY created_at DESC
        LIMIT 1000
      ) m
    ),

    'messages_received', (
      SELECT jsonb_agg(row_to_json(m))
      FROM (
        SELECT m.id, m.conversation_id, m.sender_id, m.text, m.file_url, m.file_type, m.read_at, m.created_at
        FROM public.messages m
        INNER JOIN public.conversations c ON c.id = m.conversation_id
        WHERE p_user_id = ANY (c.participant_ids)
          AND m.sender_id IS DISTINCT FROM p_user_id
        ORDER BY m.created_at DESC
        LIMIT 1000
      ) m
    ),

    'conversations', (
      SELECT jsonb_agg(row_to_json(c))
      FROM (
        SELECT
          c.id, c.type, c.context_id, c.participant_ids, c.title, c.created_at, c.updated_at,
          c.created_by, c.client_organization_id, c.agency_organization_id, c.is_archived
        FROM public.conversations c
        WHERE p_user_id = ANY (c.participant_ids)
        ORDER BY c.updated_at DESC NULLS LAST
        LIMIT 500
      ) c
    ),

    'recruiting_chat_threads', (
      SELECT jsonb_agg(row_to_json(x))
      FROM (
        SELECT DISTINCT ON (t.id)
          t.id, t.application_id, t.model_name, t.agency_id, t.organization_id, t.created_by, t.created_at, t.chat_type
        FROM public.recruiting_chat_threads t
        LEFT JOIN public.model_applications app ON app.id = t.application_id
        WHERE t.created_by = p_user_id
           OR app.applicant_user_id = p_user_id
        ORDER BY t.id, t.created_at DESC
      ) x
    ),

    'recruiting_chat_messages', (
      SELECT jsonb_agg(row_to_json(m))
      FROM (
        SELECT m.id, m.thread_id, m.from_role, m.text, m.file_url, m.file_type, m.created_at
        FROM public.recruiting_chat_messages m
        WHERE EXISTS (
          SELECT 1
          FROM public.recruiting_chat_threads t
          LEFT JOIN public.model_applications app ON app.id = t.application_id
          WHERE t.id = m.thread_id
            AND (
              t.created_by = p_user_id
              OR app.applicant_user_id = p_user_id
            )
        )
        ORDER BY m.created_at DESC
        LIMIT 2000
      ) m
    ),

    'option_requests', (
      SELECT jsonb_agg(row_to_json(r))
      FROM (
        SELECT
          r.id, r.client_id, r.model_id, r.agency_id, r.requested_date, r.status, r.final_status,
          r.created_by, r.booker_id, r.agency_assignee_user_id, r.organization_id,
          r.agency_organization_id, r.client_organization_id,
          r.created_at, r.updated_at
        FROM public.option_requests r
        WHERE r.client_id = p_user_id
           OR r.created_by = p_user_id
           OR r.booker_id = p_user_id
           OR r.agency_assignee_user_id = p_user_id
           OR EXISTS (
             SELECT 1 FROM public.models mo
             WHERE mo.id = r.model_id AND mo.user_id = p_user_id
           )
        ORDER BY r.created_at DESC
        LIMIT 500
      ) r
    ),

    'calendar_events', (
      SELECT jsonb_agg(row_to_json(e))
      FROM (
        SELECT
          e.id, e.owner_id, e.owner_type, e.date, e.start_time, e.end_time,
          e.title, e.color, e.note, e.organization_id, e.created_by,
          e.source_option_request_id, e.reminder_at, e.status,
          e.created_at, e.updated_at
        FROM public.user_calendar_events e
        WHERE e.owner_id = p_user_id
           OR e.created_by = p_user_id
           OR (
             e.organization_id IS NOT NULL
             AND EXISTS (
               SELECT 1
               FROM public.organization_members om
               WHERE om.user_id = p_user_id
                 AND om.organization_id = e.organization_id
             )
           )
        ORDER BY e.created_at DESC
        LIMIT 500
      ) e
    ),

    'calendar_entries', (
      SELECT jsonb_agg(row_to_json(ce))
      FROM (
        SELECT
          ce.id, ce.model_id, ce.date, ce.status, ce.title, ce.entry_type, ce.option_request_id,
          ce.created_by_agency, ce.client_name, ce.created_at
        FROM public.calendar_entries ce
        WHERE EXISTS (
          SELECT 1 FROM public.models m
          WHERE m.id = ce.model_id AND m.user_id = p_user_id
        )
        OR EXISTS (
          SELECT 1 FROM public.option_requests orq
          WHERE orq.id = ce.option_request_id
            AND (
              orq.client_id = p_user_id
              OR orq.created_by = p_user_id
              OR orq.booker_id = p_user_id
              OR orq.agency_assignee_user_id = p_user_id
              OR EXISTS (SELECT 1 FROM public.models mo WHERE mo.id = orq.model_id AND mo.user_id = p_user_id)
            )
        )
        ORDER BY ce.created_at DESC NULLS LAST
        LIMIT 500
      ) ce
    ),

    'notifications', (
      SELECT jsonb_agg(row_to_json(n))
      FROM (
        SELECT id, type, title, message, metadata, is_read, organization_id, created_at
        FROM public.notifications
        WHERE user_id = p_user_id
        ORDER BY created_at DESC
        LIMIT 1000
      ) n
    ),

    'activity_logs', (
      SELECT jsonb_agg(row_to_json(a))
      FROM (
        SELECT id, org_id, user_id, action_type, entity_id, created_at
        FROM public.activity_logs
        WHERE user_id = p_user_id
        ORDER BY created_at DESC
        LIMIT 1000
      ) a
    ),

    'audit_trail', (
      SELECT jsonb_agg(row_to_json(a))
      FROM (
        SELECT action_type, entity_type, entity_id, created_at, source
        FROM public.audit_trail
        WHERE user_id = p_user_id
        ORDER BY created_at DESC
        LIMIT 500
      ) a
    ),

    'image_rights_confirmations', (
      SELECT jsonb_agg(row_to_json(i))
      FROM (
        SELECT model_id, confirmed_at, ip_address
        FROM public.image_rights_confirmations
        WHERE user_id = p_user_id
        ORDER BY confirmed_at DESC
      ) i
    ),

    'push_tokens', (
      SELECT jsonb_agg(row_to_json(pt))
      FROM (
        SELECT id, platform, is_active, token, created_at, updated_at
        FROM public.push_tokens
        WHERE user_id = p_user_id
        ORDER BY created_at DESC
      ) pt
    )
  ) INTO v_result;

  PERFORM public.log_audit_action(
    NULL,
    'data_exported',
    'profile',
    p_user_id,
    NULL,
    jsonb_build_object('requested_by', v_uid, 'exported_user', p_user_id, 'export_version', 2),
    NULL,
    'api'
  );

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.export_user_data(UUID) IS
  'GDPR Art. 15/20 — JSONB export (v2). SECURITY DEFINER + row_security=off. '
  'calendar_events uses user_calendar_events columns date/start_time/end_time (never start_date/end_date/event_type). '
  'Includes org-shared user_calendar_events via organization_members. '
  'Logged via log_audit_action (data_exported, source=api).';

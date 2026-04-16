-- =============================================================================
-- Private calendar feed (token hash on profiles) + service_role RPC for ICS data
-- Fixes anonymize_user_data: admin guard + recruiting_chat_messages.text + row_security off
-- Clears calendar_feed_token_hash on anonymization.
-- =============================================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS calendar_feed_token_hash TEXT;

COMMENT ON COLUMN public.profiles.calendar_feed_token_hash IS
  'SHA-256 hex digest of secret feed token (UTF-8). Plain token shown only once on rotate. NULL = feed disabled.';

-- ─── rotate_calendar_feed_token (authenticated, self only) ─────────────────
CREATE OR REPLACE FUNCTION public.rotate_calendar_feed_token()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
DECLARE
  v_uid  UUID := auth.uid();
  v_raw  TEXT;
  v_hash TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  v_raw := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  v_hash := encode(sha256(convert_to(v_raw, 'UTF8')), 'hex');

  UPDATE public.profiles
  SET calendar_feed_token_hash = v_hash
  WHERE id = v_uid;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile_not_found';
  END IF;

  RETURN jsonb_build_object(
    'token', v_raw,
    'rotated_at', to_jsonb(now())
  );
END;
$$;

REVOKE ALL ON FUNCTION public.rotate_calendar_feed_token() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rotate_calendar_feed_token() TO authenticated;

COMMENT ON FUNCTION public.rotate_calendar_feed_token() IS
  'Returns a new plaintext calendar feed token once; stores SHA-256 hex only. Self-service.';

-- ─── revoke_calendar_feed_token ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.revoke_calendar_feed_token()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  UPDATE public.profiles
  SET calendar_feed_token_hash = NULL
  WHERE id = v_uid;

  RETURN jsonb_build_object('revoked', true);
END;
$$;

REVOKE ALL ON FUNCTION public.revoke_calendar_feed_token() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.revoke_calendar_feed_token() TO authenticated;

-- ─── Shared event JSON (internal — no EXECUTE for API clients) ─────────────
CREATE OR REPLACE FUNCTION public.calendar_export_events_json(p_user_id UUID)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
  SELECT COALESCE(
    jsonb_agg(
      sub.row_data
      ORDER BY sub.sort_date NULLS LAST, sub.sort_created NULLS LAST
    ),
    '[]'::jsonb
  )
  FROM (
    SELECT
      jsonb_build_object(
        'kind', 'user_calendar_events',
        'id', e.id,
        'title', e.title,
        'description', COALESCE(e.note, ''),
        'date', e.date::text,
        'startTime', e.start_time,
        'endTime', e.end_time,
        'status', COALESCE(e.status, '')
      ) AS row_data,
      e.date AS sort_date,
      e.created_at AS sort_created
    FROM public.user_calendar_events e
    WHERE (e.status IS NULL OR e.status IS DISTINCT FROM 'cancelled')
      AND (
        e.owner_id = p_user_id
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
      )
    UNION ALL
    SELECT
      jsonb_build_object(
        'kind', 'calendar_entries',
        'id', ce.id,
        'title', COALESCE(ce.title, ce.entry_type, 'Booking'),
        'description', COALESCE(ce.client_name, ''),
        'date', ce.date::text,
        'startTime', CASE WHEN ce.start_time IS NULL THEN NULL ELSE ce.start_time::text END,
        'endTime', CASE WHEN ce.end_time IS NULL THEN NULL ELSE ce.end_time::text END,
        'status', ce.status
      ) AS row_data,
      ce.date AS sort_date,
      ce.created_at AS sort_created
    FROM public.calendar_entries ce
    WHERE (ce.status IS NULL OR ce.status IS DISTINCT FROM 'cancelled')
      AND (
        EXISTS (
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
              OR EXISTS (
                SELECT 1 FROM public.models mo
                WHERE mo.id = orq.model_id AND mo.user_id = p_user_id
              )
            )
        )
      )
  ) sub;
$$;

REVOKE ALL ON FUNCTION public.calendar_export_events_json(UUID) FROM PUBLIC;

COMMENT ON FUNCTION public.calendar_export_events_json(UUID) IS
  'Internal: merged user_calendar_events + calendar_entries for ICS/export. Not exposed via PostgREST.';

-- ─── Authenticated ICS download payload (self only) ─────────────────────────
CREATE OR REPLACE FUNCTION public.get_calendar_export_payload_for_me()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  RETURN jsonb_build_object(
    'events',
    COALESCE(public.calendar_export_events_json(v_uid), '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_calendar_export_payload_for_me() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_calendar_export_payload_for_me() TO authenticated;

COMMENT ON FUNCTION public.get_calendar_export_payload_for_me() IS
  'Returns the same event JSON shape as the private calendar feed, for authenticated download (.ics). Self only.';

-- ─── get_calendar_feed_payload — token auth, service_role only (Edge) ───────
CREATE OR REPLACE FUNCTION public.get_calendar_feed_payload(p_token TEXT)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
DECLARE
  v_uid   UUID;
  v_hash  TEXT;
BEGIN
  IF p_token IS NULL OR length(trim(p_token)) < 16 THEN
    RETURN jsonb_build_object('events', '[]'::jsonb);
  END IF;

  v_hash := encode(sha256(convert_to(trim(p_token), 'UTF8')), 'hex');

  SELECT id INTO v_uid
  FROM public.profiles
  WHERE calendar_feed_token_hash = v_hash
  LIMIT 1;

  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('events', '[]'::jsonb);
  END IF;

  RETURN jsonb_build_object(
    'events',
    COALESCE(public.calendar_export_events_json(v_uid), '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_calendar_feed_payload(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_calendar_feed_payload(TEXT) TO service_role;

COMMENT ON FUNCTION public.get_calendar_feed_payload(TEXT) IS
  'Returns JSON events for ICS generation. Plain p_token hashed and matched to profiles.calendar_feed_token_hash. '
  'EXECUTE restricted to service_role — call from calendar-feed Edge Function only.';

-- ─── anonymize_user_data — admin guard + valid recruiting update + token clear ─
CREATE OR REPLACE FUNCTION public.anonymize_user_data(p_user_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF v_uid <> p_user_id
     AND NOT public.is_current_user_admin()
     AND NOT public.is_current_user_super_admin() THEN
    RAISE EXCEPTION 'permission_denied';
  END IF;

  UPDATE public.profiles SET
    email                   = 'anon-' || p_user_id || '@deleted.invalid',
    display_name            = '[Anonymized]',
    phone                   = NULL,
    website                 = NULL,
    country                 = NULL,
    company_name            = NULL,
    verification_email      = NULL,
    calendar_feed_token_hash = NULL,
    deletion_requested_at   = COALESCE(deletion_requested_at, now())
  WHERE id = p_user_id;

  DELETE FROM public.organization_members WHERE user_id = p_user_id;

  UPDATE public.recruiting_chat_messages m
  SET text = '[Message anonymized per GDPR request]'
  WHERE EXISTS (
    SELECT 1
    FROM public.recruiting_chat_threads t
    LEFT JOIN public.model_applications app ON app.id = t.application_id
    WHERE t.id = m.thread_id
      AND (
        t.created_by = p_user_id
        OR app.applicant_user_id = p_user_id
      )
  );

  INSERT INTO public.audit_trail (
    user_id, org_id, action_type, entity_type, entity_id, new_data, created_at, source
  ) VALUES (
    v_uid, NULL, 'user_deleted', 'profile', p_user_id,
    jsonb_build_object('method', 'anonymize_user_data', 'requested_by', v_uid),
    now(),
    'api'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.anonymize_user_data(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.anonymize_user_data(UUID) TO authenticated;

COMMENT ON FUNCTION public.anonymize_user_data(UUID) IS
  'GDPR anonymization: profile PII, org memberships removed, recruiting messages scrubbed for user threads, '
  'calendar feed token cleared. Self or is_current_user_admin / is_current_user_super_admin. '
  'Retention: booking/legal rows may remain per separate policies; message content in B2B messages unchanged here.';

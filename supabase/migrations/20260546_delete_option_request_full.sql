-- =============================================================================
-- 20260546: delete_option_request_full — atomic cascade delete for option_requests
--
-- Fixes orphan calendar_entries / booking_events / user_calendar_events when
-- option_requests rows are removed (legacy calendar_entries.option_request_id
-- had no FK; booking_events uses ON DELETE SET NULL on source_option_request_id).
--
-- Product: delete blocked when final_status = 'job_confirmed'.
-- Auth: client, agency org member, linked model user, or admin (is_current_user_admin).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.delete_option_request_full(p_option_request_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET row_security TO 'off'
AS $$
DECLARE
  v_final_status text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated'
      USING ERRCODE = '28000';
  END IF;

  IF p_option_request_id IS NULL THEN
    RAISE EXCEPTION 'invalid_option_request_id'
      USING ERRCODE = '22023';
  END IF;

  SELECT orq.final_status
  INTO v_final_status
  FROM public.option_requests orq
  WHERE orq.id = p_option_request_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'option_request_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_final_status = 'job_confirmed' THEN
    RAISE EXCEPTION 'option_request_job_confirmed'
      USING ERRCODE = 'P0001';
  END IF;

  IF NOT (
    public.is_current_user_admin()
    OR public.option_request_visible_to_me(p_option_request_id)
  ) THEN
    RAISE EXCEPTION 'access_denied'
      USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.option_request_messages
  WHERE option_request_id = p_option_request_id;

  DELETE FROM public.option_documents
  WHERE option_request_id = p_option_request_id;

  DELETE FROM public.calendar_entries
  WHERE option_request_id = p_option_request_id;

  DELETE FROM public.booking_events
  WHERE source_option_request_id = p_option_request_id;

  DELETE FROM public.user_calendar_events
  WHERE source_option_request_id = p_option_request_id;

  DELETE FROM public.notifications
  WHERE metadata ? 'option_request_id'
    AND (metadata->>'option_request_id') = p_option_request_id::text;

  DELETE FROM public.user_thread_preferences
  WHERE thread_id = p_option_request_id::text;

  DELETE FROM public.option_requests
  WHERE id = p_option_request_id;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_option_request_full(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_option_request_full(uuid) TO authenticated;

COMMENT ON FUNCTION public.delete_option_request_full(uuid) IS
  'Participant or admin: deletes option_requests and dependent rows atomically. '
  'Blocks when final_status = job_confirmed. 20260546.';

DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'delete_option_request_full'
  ), 'FAIL: delete_option_request_full missing after 20260546';
END;
$$;

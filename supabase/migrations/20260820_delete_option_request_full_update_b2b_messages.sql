-- =============================================================================
-- 20260820: Comprehensive option-request deletion/rejection consistency
--
-- Fixes:
-- 1. Adds missing 'status' column to user_calendar_events (needed by
--    fn_cancel_calendar_on_option_rejected to mark mirrored calendar events
--    as cancelled on rejection).
-- 2. Extends delete_option_request_full to mark B2B booking-card messages
--    (messages.metadata.status) as 'deleted' so OrgMessengerInline shows
--    the correct state instead of stale 'pending'.
-- 3. Extends fn_cancel_calendar_on_option_rejected to also mark B2B
--    booking-card messages as 'rejected'.
-- =============================================================================

-- ─── 0. Add status column to user_calendar_events if missing ───

ALTER TABLE public.user_calendar_events
  ADD COLUMN IF NOT EXISTS status TEXT DEFAULT NULL;

COMMENT ON COLUMN public.user_calendar_events.status IS
  'NULL = active; cancelled = linked option_request was rejected or deleted. 20260820.';

-- ─── 1. Updated delete_option_request_full ───

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

  -- Mark B2B booking-card messages as deleted so OrgMessengerInline
  -- no longer shows stale 'pending' badges or 'Open related request' links.
  UPDATE public.messages
  SET metadata = jsonb_set(
    COALESCE(metadata, '{}'::jsonb),
    '{status}',
    '"deleted"'::jsonb
  )
  WHERE metadata IS NOT NULL
    AND metadata ? 'option_request_id'
    AND (metadata->>'option_request_id') = p_option_request_id::text;

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
  'Updates B2B chat booking-card messages to status=deleted. '
  'Blocks when final_status = job_confirmed. 20260820.';

-- ─── 2. Updated fn_cancel_calendar_on_option_rejected ───

CREATE OR REPLACE FUNCTION public.fn_cancel_calendar_on_option_rejected()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET row_security TO off
AS $$
BEGIN
  IF NEW.status = 'rejected' AND OLD.status IS DISTINCT FROM 'rejected' THEN
    UPDATE public.calendar_entries
    SET status = 'cancelled'
    WHERE option_request_id = NEW.id
      AND status IS DISTINCT FROM 'cancelled';

    UPDATE public.user_calendar_events
    SET
      status = 'cancelled',
      updated_at = now()
    WHERE source_option_request_id = NEW.id
      AND (status IS DISTINCT FROM 'cancelled' OR status IS NULL);

    -- Mark B2B booking-card messages as rejected
    UPDATE public.messages
    SET metadata = jsonb_set(
      COALESCE(metadata, '{}'::jsonb),
      '{status}',
      '"rejected"'::jsonb
    )
    WHERE metadata IS NOT NULL
      AND metadata ? 'option_request_id'
      AND (metadata->>'option_request_id') = NEW.id::text
      AND (metadata->>'status') IS DISTINCT FROM 'rejected';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_cancel_calendar_on_option_rejected ON public.option_requests;
CREATE TRIGGER tr_cancel_calendar_on_option_rejected
  AFTER UPDATE OF status ON public.option_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_cancel_calendar_on_option_rejected();

COMMENT ON FUNCTION public.fn_cancel_calendar_on_option_rejected() IS
  'Sets calendar_entries + user_calendar_events to cancelled and marks B2B messages as rejected '
  'when option_requests.status → rejected. 20260820.';

-- ─── 3. Verification ───

DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'user_calendar_events'
      AND column_name = 'status'
  ), 'FAIL: user_calendar_events.status column missing after 20260820';

  ASSERT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'delete_option_request_full'
  ), 'FAIL: delete_option_request_full missing after 20260820';

  ASSERT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'tr_cancel_calendar_on_option_rejected'
  ), 'FAIL: tr_cancel_calendar_on_option_rejected trigger missing after 20260820';
END;
$$;

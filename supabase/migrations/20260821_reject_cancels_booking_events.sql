-- =============================================================================
-- 20260821: booking_events cancelled on option_request rejection
--
-- Extends fn_cancel_calendar_on_option_rejected to also set booking_events
-- to 'cancelled' when the linked option_request is rejected.
-- delete_option_request_full already DELETEs booking_events — this covers
-- the reject-without-delete path.
-- =============================================================================

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

    UPDATE public.booking_events
    SET status = 'cancelled'
    WHERE source_option_request_id = NEW.id
      AND status IS DISTINCT FROM 'cancelled';

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
  'Sets calendar_entries + user_calendar_events + booking_events to cancelled '
  'and marks B2B messages as rejected when option_requests.status → rejected. 20260821.';

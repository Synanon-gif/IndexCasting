-- =============================================================================
-- 20260548: Ensure fn_cancel_calendar_on_option_rejected + trigger (idempotent)
-- Source: migration_consistency_sprint_2026_04.sql (root) — deployed via migrations.
-- When option_requests.status becomes 'rejected', cancel linked calendar rows.
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
      AND status IS DISTINCT FROM 'cancelled';
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
  'Sets calendar_entries + user_calendar_events to cancelled when option_requests.status → rejected. 20260548.';

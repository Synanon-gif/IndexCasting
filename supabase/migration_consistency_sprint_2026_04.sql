-- Migration: Medium/Consistency Sprint – 2026-04
--
-- 1. cancelled/rejected Option → calendar_entries.status → 'cancelled'
-- 2. Unique Constraint: Recruiting-Threads darf nicht doppelt angelegt werden
--    (1 Thread pro application_id + agency_id Kombination)

-- ─── 1. fn_cancel_calendar_on_option_rejected ──────────────────────────────
-- When an option_request transitions to rejected/cancelled, mark all linked
-- calendar_entries as 'cancelled' so the calendar no longer shows a ghost
-- booking that was never finalised.

CREATE OR REPLACE FUNCTION public.fn_cancel_calendar_on_option_rejected()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Fire only when status transitions TO 'rejected' from a non-rejected state.
  IF NEW.status = 'rejected' AND OLD.status <> 'rejected' THEN
    UPDATE public.calendar_entries
    SET status = 'cancelled'
    WHERE option_request_id = NEW.id
      AND status <> 'cancelled';

    UPDATE public.user_calendar_events
    SET
      status     = 'cancelled',
      updated_at = now()
    WHERE source_option_request_id = NEW.id
      AND status <> 'cancelled';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_cancel_calendar_on_option_rejected ON public.option_requests;
CREATE TRIGGER tr_cancel_calendar_on_option_rejected
  AFTER UPDATE OF status ON public.option_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_cancel_calendar_on_option_rejected();

COMMENT ON FUNCTION public.fn_cancel_calendar_on_option_rejected IS
  'Sets calendar_entries + user_calendar_events status to cancelled when an '
  'option_request is rejected, preventing ghost tentative entries in the calendar.';


-- ─── 2. Unique Constraint: recruiting threads per application+agency ─────────
-- Prevents a race condition where two concurrent acceptApplication() calls for
-- the same applicant/agency pair both create a recruiting thread.
-- Only one thread is allowed per application_id (regardless of agency, since an
-- application is scoped to one agency).

CREATE UNIQUE INDEX IF NOT EXISTS uidx_recruiting_threads_per_application
  ON public.recruiting_chat_threads (application_id)
  WHERE application_id IS NOT NULL;

COMMENT ON INDEX public.uidx_recruiting_threads_per_application IS
  'Ensures at most one recruiting_chat_thread per application — prevents duplicate '
  'threads from concurrent acceptApplication() calls.';

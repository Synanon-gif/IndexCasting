-- =============================================================================
-- 20260555: Reset final_status when model rejects option request
-- Audit finding C-4: When a model rejects (status → rejected), final_status
-- must be reset from option_confirmed to option_pending so downstream code
-- never treats a model-rejected option as confirmed.
--
-- This trigger extends fn_cancel_calendar_on_option_rejected (20260548) —
-- that trigger already cancels calendar entries; this one fixes the semantic
-- inconsistency of final_status staying 'option_confirmed' after rejection.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.fn_reset_final_status_on_rejection()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET row_security TO off
AS $$
BEGIN
  IF NEW.status = 'rejected'
     AND OLD.status IS DISTINCT FROM 'rejected'
     AND NEW.final_status = 'option_confirmed'
  THEN
    NEW.final_status := 'option_pending';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_reset_final_status_on_rejection ON public.option_requests;
CREATE TRIGGER tr_reset_final_status_on_rejection
  BEFORE UPDATE OF status ON public.option_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_reset_final_status_on_rejection();

COMMENT ON FUNCTION public.fn_reset_final_status_on_rejection() IS
  'Resets final_status from option_confirmed to option_pending when status → rejected '
  '(e.g. model decline). Prevents semantic inconsistency. 20260555 (audit C-4).';

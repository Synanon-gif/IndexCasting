-- =============================================================================
-- C-1 Fix: Migrate fn_ensure_calendar_on_option_confirmed from root SQL into
-- supabase/migrations/ to guarantee deployment parity.
--
-- Previously only in migration_calendar_booking_audit_fixes_2026_04.sql (root).
-- fn_cancel_calendar_on_option_rejected was already in migrations/20260548.
-- This closes the asymmetry: both create and cancel triggers are now canonical.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.fn_ensure_calendar_on_option_confirmed()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (OLD.final_status IS DISTINCT FROM 'option_confirmed')
     AND NEW.final_status = 'option_confirmed'
     AND NEW.model_id IS NOT NULL
  THEN
    INSERT INTO calendar_entries (
      model_id,
      date,
      start_time,
      end_time,
      title,
      status,
      client_name,
      option_request_id,
      entry_type,
      created_by_agency,
      booking_details
    )
    SELECT
      NEW.model_id,
      NEW.requested_date::date,
      NEW.start_time,
      NEW.end_time,
      CASE
        WHEN NEW.request_type = 'casting'
          THEN 'Casting – ' || COALESCE(NEW.client_name, 'Client')
        ELSE 'Option – ' || COALESCE(NEW.client_name, 'Client')
      END,
      'tentative',
      NEW.client_name,
      NEW.id,
      CASE
        WHEN NEW.request_type = 'casting' THEN 'casting'
        ELSE 'option'
      END,
      false,
      '{}'::jsonb
    WHERE NOT EXISTS (
      SELECT 1 FROM calendar_entries
       WHERE option_request_id = NEW.id
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ensure_calendar_on_option_confirmed ON public.option_requests;
CREATE TRIGGER trg_ensure_calendar_on_option_confirmed
  AFTER UPDATE ON public.option_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_ensure_calendar_on_option_confirmed();

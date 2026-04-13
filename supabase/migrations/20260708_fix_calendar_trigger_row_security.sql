-- C3: Add SET row_security TO off to fn_ensure_calendar_on_option_confirmed.
-- Required by system invariant I: SECURITY DEFINER functions writing RLS-protected
-- tables (calendar_entries) MUST have row_security=off.
CREATE OR REPLACE FUNCTION public.fn_ensure_calendar_on_option_confirmed()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security TO off
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

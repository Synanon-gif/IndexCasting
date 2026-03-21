-- Nach Änderung von Datum/Zeit einer Option: Kalenderzeilen und gespiegelte user_calendar_events aktualisieren
-- (SECURITY DEFINER, damit alle betroffenen Zeilen konsistent bleiben, unabhängig vom Aufrufer-RLS)

CREATE OR REPLACE FUNCTION public.sync_option_dates_to_calendars()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;
  IF NEW.requested_date IS NOT DISTINCT FROM OLD.requested_date
     AND COALESCE(NEW.start_time, '') IS NOT DISTINCT FROM COALESCE(OLD.start_time, '')
     AND COALESCE(NEW.end_time, '') IS NOT DISTINCT FROM COALESCE(OLD.end_time, '') THEN
    RETURN NEW;
  END IF;

  UPDATE public.calendar_entries
  SET
    date = NEW.requested_date,
    start_time = NEW.start_time,
    end_time = NEW.end_time
  WHERE option_request_id = NEW.id;

  UPDATE public.user_calendar_events
  SET
    date = NEW.requested_date,
    start_time = NEW.start_time,
    end_time = NEW.end_time,
    updated_at = now()
  WHERE source_option_request_id = NEW.id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_option_requests_schedule_sync ON public.option_requests;
CREATE TRIGGER tr_option_requests_schedule_sync
  AFTER UPDATE OF requested_date, start_time, end_time ON public.option_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_option_dates_to_calendars();

-- Model darf nur Datum/Zeit „seiner“ Option ändern (keine anderen Spalten)
CREATE OR REPLACE FUNCTION public.model_update_option_schedule(
  p_option_id UUID,
  p_date TEXT,
  p_start TEXT,
  p_end TEXT
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n integer;
BEGIN
  IF p_date !~ '^\d{4}-\d{2}-\d{2}$' THEN
    RAISE EXCEPTION 'invalid_date_format';
  END IF;
  UPDATE public.option_requests oq
  SET
    requested_date = p_date::date,
    start_time = NULLIF(trim(COALESCE(p_start, '')), ''),
    end_time = NULLIF(trim(COALESCE(p_end, '')), '')
  WHERE oq.id = p_option_id
    AND EXISTS (
      SELECT 1 FROM public.models m
      WHERE m.id = oq.model_id AND m.user_id = auth.uid()
    );
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 0 THEN
    RAISE EXCEPTION 'not_found_or_forbidden';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.model_update_option_schedule(UUID, TEXT, TEXT, TEXT) TO authenticated;

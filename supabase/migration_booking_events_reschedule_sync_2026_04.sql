-- Migration: booking_events Datum bei Reschedule synchronisieren (HIGH-B2)
--
-- HINTERGRUND:
--   sync_option_dates_to_calendars aktualisiert calendar_entries + user_calendar_events,
--   aber NICHT booking_events.date. Wenn ein Termin nach der Buchungsbestätigung verschoben
--   wird, zeigen Kalender und Booking-Event-Liste unterschiedliche Daten.
--
-- LÖSUNG:
--   Den bestehenden Trigger-Body um ein UPDATE auf booking_events.date erweitern.
--   booking_events.date ist kein timestamp-Feld — wir kopieren requested_date direkt.

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

  -- Skip early if none of the schedule columns actually changed.
  IF NEW.requested_date IS NOT DISTINCT FROM OLD.requested_date
     AND COALESCE(NEW.start_time, '') IS NOT DISTINCT FROM COALESCE(OLD.start_time, '')
     AND COALESCE(NEW.end_time, '') IS NOT DISTINCT FROM COALESCE(OLD.end_time, '') THEN
    RETURN NEW;
  END IF;

  -- ── calendar_entries ──────────────────────────────────────────────────────
  UPDATE public.calendar_entries
  SET
    date       = NEW.requested_date,
    start_time = NEW.start_time,
    end_time   = NEW.end_time
  WHERE option_request_id = NEW.id;

  -- ── user_calendar_events ──────────────────────────────────────────────────
  UPDATE public.user_calendar_events
  SET
    date       = NEW.requested_date,
    start_time = NEW.start_time,
    end_time   = NEW.end_time,
    updated_at = now()
  WHERE source_option_request_id = NEW.id;

  -- ── booking_events (HIGH-B2 fix) ─────────────────────────────────────────
  -- Keep booking_events.date in sync so the booking list and calendar show
  -- the same date after a reschedule. Only updates non-terminal bookings so
  -- completed/cancelled history is not silently rewritten.
  UPDATE public.booking_events
  SET
    date       = NEW.requested_date::text,
    updated_at = now()
  WHERE source_option_request_id = NEW.id
    AND status NOT IN ('completed', 'cancelled');

  RETURN NEW;
END;
$$;

-- Trigger stays the same; the updated function body takes effect immediately.
DROP TRIGGER IF EXISTS tr_option_requests_schedule_sync ON public.option_requests;
CREATE TRIGGER tr_option_requests_schedule_sync
  AFTER UPDATE OF requested_date, start_time, end_time ON public.option_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_option_dates_to_calendars();

COMMENT ON FUNCTION public.sync_option_dates_to_calendars IS
  'Keeps calendar_entries, user_calendar_events and booking_events.date in sync '
  'when an option_request schedule is updated (reschedule flow).';

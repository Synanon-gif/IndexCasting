-- =============================================================================
-- 20261208: sync_user_calendars_on_job_confirmed
--
-- Problem: when an option_request transitions to final_status='job_confirmed',
-- the existing user_calendar_events rows for client AND agency (created by
-- 20260716_sync_user_calendars_on_option_confirmed) keep their old "Option – …"
-- title and old colour. The TS helper `updateCalendarEntryToJob` only re-titles
-- rows the *acting* user can write under RLS — i.e. the agency cannot rewrite
-- the client's row and vice-versa, so each side sees its OWN colour update but
-- never the counterparty's.
--
-- Fix: a SECURITY DEFINER trigger that fires on the job_confirmed transition
-- and updates BOTH client and agency rows in user_calendar_events to the
-- canonical "Job – {Counterparty}" title with the green job colour (#2E7D32).
-- If a row is missing (e.g. job_confirmed reached without going through
-- option_confirmed first, an edge case in agency-only flows), we INSERT it.
--
-- Idempotent: re-runs of the same final_status transition no-op (UPDATE …
-- WHERE NOT … only flips colour/title once; INSERT … ON CONFLICT DO NOTHING
-- skips when a row exists).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.sync_user_calendars_on_option_job_confirmed()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client_title text;
  v_agency_title text;
  v_job_color    text := '#2E7D32';
BEGIN
  IF NEW.final_status IS DISTINCT FROM 'job_confirmed' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.final_status = 'job_confirmed' THEN
    RETURN NEW;
  END IF;

  v_client_title :=
    'Job – ' || COALESCE(NULLIF(NEW.model_name, ''), 'Model');
  v_agency_title :=
    'Job – ' || COALESCE(NULLIF(NEW.client_organization_name, ''),
                         NULLIF(NEW.client_name, ''),
                         NULLIF(NEW.agency_organization_name, ''),
                         'Client');

  -- Update existing rows (created by sync_user_calendars_on_option_confirmed
  -- when the request first hit option_confirmed). Bypasses per-user RLS so
  -- the counterparty's row is also updated, which the TS helper cannot do.
  UPDATE public.user_calendar_events
     SET title = v_client_title,
         color = v_job_color
   WHERE source_option_request_id = NEW.id
     AND owner_id = NEW.client_id
     AND owner_type = 'client'
     AND COALESCE(status, 'active') <> 'cancelled';

  UPDATE public.user_calendar_events
     SET title = v_agency_title,
         color = v_job_color
   WHERE source_option_request_id = NEW.id
     AND owner_id = NEW.agency_id
     AND owner_type = 'agency'
     AND COALESCE(status, 'active') <> 'cancelled';

  -- Insert any missing party rows. Covers agency-only confirms that never
  -- transitioned through option_confirmed, and historical requests created
  -- before 20260716 (no row to update).
  IF NEW.client_id IS NOT NULL THEN
    INSERT INTO public.user_calendar_events (
      owner_id, owner_type, date, start_time, end_time,
      title, color, note, source_option_request_id
    ) VALUES (
      NEW.client_id, 'client', NEW.requested_date, NEW.start_time, NEW.end_time,
      v_client_title, v_job_color,
      'Synced booking. Shared notes are stored in the app (calendar entry / booking details).',
      NEW.id
    )
    ON CONFLICT DO NOTHING;
  END IF;

  IF NEW.agency_id IS NOT NULL THEN
    INSERT INTO public.user_calendar_events (
      owner_id, owner_type, date, start_time, end_time,
      title, color, note, source_option_request_id
    ) VALUES (
      NEW.agency_id, 'agency', NEW.requested_date, NEW.start_time, NEW.end_time,
      v_agency_title, v_job_color,
      'Synced booking. Shared notes are stored in the app (calendar entry / booking details).',
      NEW.id
    )
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_option_requests_sync_calendars_on_job_confirmed
  ON public.option_requests;

CREATE TRIGGER tr_option_requests_sync_calendars_on_job_confirmed
  AFTER INSERT OR UPDATE OF final_status ON public.option_requests
  FOR EACH ROW
  WHEN (NEW.final_status = 'job_confirmed')
  EXECUTE FUNCTION public.sync_user_calendars_on_option_job_confirmed();

COMMENT ON FUNCTION public.sync_user_calendars_on_option_job_confirmed() IS
  'On final_status -> job_confirmed: recolour and re-title both client and '
  'agency user_calendar_events rows in green ("Job – …"). Bypasses RLS so '
  'one party''s confirmation is reflected in the counterparty''s calendar. 20261208.';

DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'tr_option_requests_sync_calendars_on_job_confirmed'
      AND tgrelid = 'public.option_requests'::regclass
  ), 'FAIL: tr_option_requests_sync_calendars_on_job_confirmed missing after 20261208';

  ASSERT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'sync_user_calendars_on_option_job_confirmed'
  ), 'FAIL: sync_user_calendars_on_option_job_confirmed missing after 20261208';
END;
$$;

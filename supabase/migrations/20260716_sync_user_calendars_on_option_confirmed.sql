-- Formalize sync_user_calendars_on_option_confirmed as a proper migration.
-- Previously only in root-SQL (migration_identity_negotiation_calendar.sql),
-- which means new deployments/staging may lack this trigger entirely.

-- Prerequisite column (idempotent)
ALTER TABLE public.user_calendar_events
  ADD COLUMN IF NOT EXISTS source_option_request_id UUID REFERENCES public.option_requests(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_user_calendar_events_option_party
  ON public.user_calendar_events (source_option_request_id, owner_type)
  WHERE source_option_request_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.sync_user_calendars_on_option_confirmed()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.final_status IS DISTINCT FROM 'option_confirmed' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.final_status = 'option_confirmed' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND OLD.final_status IS DISTINCT FROM NEW.final_status) THEN
    INSERT INTO public.user_calendar_events (
      owner_id, owner_type, date, start_time, end_time, title, color, note, source_option_request_id
    ) VALUES (
      NEW.client_id,
      'client',
      NEW.requested_date,
      NEW.start_time,
      NEW.end_time,
      CASE WHEN NEW.request_type = 'casting' THEN 'Casting – ' ELSE 'Option – ' END
        || COALESCE(NEW.model_name, 'Model'),
      '#1565C0',
      'Synced booking. Shared notes are stored in the app (calendar entry / booking details).',
      NEW.id
    )
    ON CONFLICT DO NOTHING;

    INSERT INTO public.user_calendar_events (
      owner_id, owner_type, date, start_time, end_time, title, color, note, source_option_request_id
    ) VALUES (
      NEW.agency_id,
      'agency',
      NEW.requested_date,
      NEW.start_time,
      NEW.end_time,
      CASE WHEN NEW.request_type = 'casting' THEN 'Casting – ' ELSE 'Option – ' END
        || COALESCE(NEW.client_name, 'Client'),
      '#2E7D32',
      'Synced booking. Shared notes are stored in the app (calendar entry / booking details).',
      NEW.id
    )
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_option_requests_sync_calendars ON public.option_requests;
CREATE TRIGGER tr_option_requests_sync_calendars
  AFTER INSERT OR UPDATE OF final_status ON public.option_requests
  FOR EACH ROW
  WHEN (NEW.final_status = 'option_confirmed')
  EXECUTE FUNCTION public.sync_user_calendars_on_option_confirmed();

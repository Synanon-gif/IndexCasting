-- =============================================================================
-- Calendar entry titles must use real organization names — never the generic
-- "Client" / "Agency" placeholder.
--
-- Source-of-truth priority for the title:
--   1. option_requests.client_organization_name  (canonical org display name)
--   2. option_requests.agency_organization_name  (used for agency-only events)
--   3. option_requests.client_name               (legacy fallback)
--
-- Applies to:
--   - fn_ensure_calendar_on_option_confirmed (option / casting create-on-confirm)
--
-- The Job upgrade title is fixed in src/services/calendarSupabase.ts
-- (updateCalendarEntryToJob) by reading client_organization_name from
-- option_requests; the trigger above only handles the Option / Casting phase.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.fn_ensure_calendar_on_option_confirmed()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_display_name text;
  v_label_prefix text;
BEGIN
  IF (OLD.final_status IS DISTINCT FROM 'option_confirmed')
     AND NEW.final_status = 'option_confirmed'
     AND NEW.model_id IS NOT NULL
  THEN
    -- Resolve canonical display name: real org name first, agency org second
    -- (for agency-only events), legacy client_name last. Never fall back to
    -- the generic "Client" placeholder if any real name is available.
    v_display_name := COALESCE(
      NULLIF(btrim(NEW.client_organization_name), ''),
      CASE WHEN COALESCE(NEW.is_agency_only, false)
        THEN NULLIF(btrim(NEW.agency_organization_name), '')
        ELSE NULL
      END,
      NULLIF(btrim(NEW.client_name), ''),
      NULLIF(btrim(NEW.agency_organization_name), ''),
      'Client'
    );

    v_label_prefix := CASE
      WHEN NEW.request_type = 'casting' THEN 'Casting – '
      ELSE 'Option – '
    END;

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
      v_label_prefix || v_display_name,
      'tentative',
      v_display_name, -- store the resolved display name, not the placeholder
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

-- =============================================================================
-- Backfill: existing calendar_entries with generic "– Client" titles get
-- their real client_organization_name (or agency_organization_name for
-- agency-only flows) when one is available on the linked option_request.
-- Safe & idempotent: only updates entries whose title still says "Client".
-- =============================================================================

UPDATE public.calendar_entries ce
SET
  title = CASE
            WHEN ce.entry_type = 'casting' THEN 'Casting – '
            WHEN ce.entry_type = 'booking' THEN 'Job – '
            ELSE 'Option – '
          END || resolved.display_name,
  client_name = resolved.display_name
FROM (
  SELECT
    o.id AS option_request_id,
    COALESCE(
      NULLIF(btrim(o.client_organization_name), ''),
      CASE WHEN COALESCE(o.is_agency_only, false)
        THEN NULLIF(btrim(o.agency_organization_name), '')
        ELSE NULL
      END,
      NULLIF(btrim(o.client_name), ''),
      NULLIF(btrim(o.agency_organization_name), ''),
      'Client'
    ) AS display_name
  FROM public.option_requests o
) resolved
WHERE ce.option_request_id = resolved.option_request_id
  AND resolved.display_name <> 'Client'
  AND (
    ce.title IS NULL
    OR ce.title ILIKE '%– Client'
    OR ce.title ILIKE '%- Client'
    OR ce.client_name = 'Client'
  );

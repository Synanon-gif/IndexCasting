-- =============================================================================
-- CALENDAR & BOOKING AUDIT FIXES – 2026-04
-- Fixes the following issues found in the deep logic/security audit:
--   BUG-2  : booking_events state-machine enforced at DB level
--   BUG-3  : UNIQUE constraint closes TOCTOU race in insertManualEvent
--   BUG-7  : fn_ensure_calendar_on_option_confirmed adds status + title
--   BUG-11 : fn_validate_option_status_transition trigger narrowed to OF status, final_status
-- =============================================================================


-- ─── BUG-11: Narrow option_requests status trigger ───────────────────────────
-- Previously the trigger fired on ALL column updates to option_requests, adding
-- unnecessary overhead on every metadata write (e.g. agency_assignee_user_id).
-- Narrow to the columns the state-machine actually cares about.
DROP TRIGGER IF EXISTS trg_validate_option_status ON public.option_requests;
CREATE TRIGGER trg_validate_option_status
  BEFORE UPDATE OF status, final_status ON public.option_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_validate_option_status_transition();


-- ─── BUG-7: Fix fn_ensure_calendar_on_option_confirmed ───────────────────────
-- The previous version omitted the `status` and `title` columns, producing
-- calendar_entries rows with NULL title and whatever DB default exists for
-- status — inconsistent with the client-side inserts that always set
-- status = 'tentative' and a descriptive title.
CREATE OR REPLACE FUNCTION public.fn_ensure_calendar_on_option_confirmed()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only fire when final_status transitions TO option_confirmed.
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

-- Re-attach the trigger so the updated function body takes effect.
DROP TRIGGER IF EXISTS trg_ensure_calendar_on_option_confirmed ON public.option_requests;
CREATE TRIGGER trg_ensure_calendar_on_option_confirmed
  AFTER UPDATE ON public.option_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_ensure_calendar_on_option_confirmed();


-- ─── BUG-2: booking_events status-transition guard ───────────────────────────
-- Enforces the ALLOWED_TRANSITIONS state machine at the DB level so that no
-- party (client, agency, or model) can bypass application logic by calling the
-- Supabase API directly to write an invalid status transition.
--
-- Valid transitions:
--   pending → agency_accepted
--   agency_accepted → model_confirmed
--   model_confirmed → completed
--   any non-terminal → cancelled   (cancel is always allowed)
--   completed, cancelled → (blocked — terminal states)
CREATE OR REPLACE FUNCTION public.fn_validate_booking_event_status_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Terminal states: no further transitions allowed.
  IF OLD.status IN ('completed', 'cancelled') AND NEW.status <> OLD.status THEN
    RAISE EXCEPTION
      'Cannot transition booking_event % from terminal state "%"', OLD.id, OLD.status;
  END IF;

  -- Allow cancel from any non-terminal state.
  IF NEW.status = 'cancelled' THEN
    RETURN NEW;
  END IF;

  -- Enforce strict forward-only progression.
  IF NOT (
    (OLD.status = 'pending'         AND NEW.status = 'agency_accepted') OR
    (OLD.status = 'agency_accepted' AND NEW.status = 'model_confirmed') OR
    (OLD.status = 'model_confirmed' AND NEW.status = 'completed')
  ) THEN
    RAISE EXCEPTION
      'Invalid booking_event status transition: "%" → "%" (id: %)',
      OLD.status, NEW.status, OLD.id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_booking_event_status ON public.booking_events;
CREATE TRIGGER trg_validate_booking_event_status
  BEFORE UPDATE OF status ON public.booking_events
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_validate_booking_event_status_transition();


-- ─── BUG-3: UNIQUE constraint for manual calendar events (user_calendar_events) ─
-- The application-level duplicate check in insertManualEvent has a TOCTOU race:
-- two concurrent requests with the same owner/date/title can both pass the SELECT
-- guard before either INSERT lands. This DB-level constraint closes that gap.
-- Scoped to rows without a source_option_request_id (manual/standalone events only).
CREATE UNIQUE INDEX IF NOT EXISTS uidx_user_calendar_events_manual_dedup
  ON public.user_calendar_events (owner_id, owner_type, date, title)
  WHERE source_option_request_id IS NULL;

-- =============================================================================
-- Trigger Security Definer Patch — 2026-04-04
-- Fixes 4 trigger functions that had SET search_path = public but were missing
-- SECURITY DEFINER. Without SECURITY DEFINER, the function runs with the
-- caller's privileges, which can expose it to search_path injection if a
-- privileged caller's search_path is manipulated before the trigger fires.
--
-- All functions below are re-created idempotently (CREATE OR REPLACE) with
-- SECURITY DEFINER added. Their logic is unchanged.
-- =============================================================================


-- ─── 1. fn_validate_booking_event_status_transition ─────────────────────────
--
-- Validates state-machine transitions on booking_events.status.
-- SECURITY DEFINER ensures the trigger runs with owner privileges regardless
-- of the caller's search_path.

CREATE OR REPLACE FUNCTION public.fn_validate_booking_event_status_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.status IN ('completed', 'cancelled') AND NEW.status <> OLD.status THEN
    RAISE EXCEPTION
      'Cannot transition booking_event % from terminal state "%"', OLD.id, OLD.status;
  END IF;

  IF NEW.status = 'cancelled' THEN
    RETURN NEW;
  END IF;

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

COMMENT ON FUNCTION public.fn_validate_booking_event_status_transition() IS
  'Trigger: enforces booking_event status state machine. '
  'SECURITY DEFINER added 2026-04-04 (trigger-audit patch).';


-- ─── 2. set_model_locations_updated_at ──────────────────────────────────────

CREATE OR REPLACE FUNCTION public.set_model_locations_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.set_model_locations_updated_at() IS
  'Trigger: auto-update updated_at on model_locations. '
  'SECURITY DEFINER added 2026-04-04 (trigger-audit patch).';


-- ─── 3. set_push_tokens_updated_at ──────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.set_push_tokens_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.set_push_tokens_updated_at() IS
  'Trigger: auto-update updated_at on push_tokens. '
  'SECURITY DEFINER added 2026-04-04 (trigger-audit patch).';


-- ─── 4. set_updated_at ──────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.set_updated_at() IS
  'Trigger: generic auto-update updated_at. '
  'SECURITY DEFINER added 2026-04-04 (trigger-audit patch).';

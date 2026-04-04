-- Supabase DB linter remediation (2026-04)
-- 0011_function_search_path_mutable: fn_validate_booking_event_status_transition
-- 0024_rls_policy_always_true: glal_insert_anon on guest_link_access_log
--
-- guest_link_access_log: INSERTs only occur from SECURITY DEFINER RPCs (e.g.
-- get_guest_link_models), which run as the function owner and bypass RLS like
-- other definer-side writes. Direct anon/authenticated INSERT is no longer allowed.

CREATE OR REPLACE FUNCTION public.fn_validate_booking_event_status_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
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

DROP POLICY IF EXISTS glal_insert_anon ON public.guest_link_access_log;

COMMENT ON TABLE public.guest_link_access_log IS
  'Audit log for guest link access events. '
  'Writes are performed only from SECURITY DEFINER RPCs after link validation; '
  'direct client INSERT is denied by RLS.';

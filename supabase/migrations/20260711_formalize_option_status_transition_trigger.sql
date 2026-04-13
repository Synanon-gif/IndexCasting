-- =============================================================================
-- 20260711: Formalize fn_validate_option_status_transition into migrations
-- =============================================================================
-- This trigger was previously only in root-SQL (migration_m3_m4_fixes.sql) and
-- never tracked via supabase/migrations/. Without a migration, any fresh DB
-- setup (staging, new project) would lack all status-transition guards.
--
-- This migration is IDEMPOTENT — CREATE OR REPLACE + DROP TRIGGER IF EXISTS.
-- Live DB already has the function and trigger; this formalizes them.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.fn_validate_option_status_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- status: rejected is terminal
  IF OLD.status = 'rejected' AND NEW.status IS DISTINCT FROM 'rejected' THEN
    RAISE EXCEPTION
      'option_requests: illegal status transition rejected → %. Rejected is terminal.',
      NEW.status
    USING ERRCODE = 'P0001';
  END IF;

  -- status: confirmed cannot revert to in_negotiation
  IF OLD.status = 'confirmed' AND NEW.status = 'in_negotiation' THEN
    RAISE EXCEPTION
      'option_requests: illegal status transition confirmed → in_negotiation. Confirmed cannot be reversed.'
    USING ERRCODE = 'P0001';
  END IF;

  -- final_status: job_confirmed is terminal
  IF OLD.final_status = 'job_confirmed' AND NEW.final_status IS DISTINCT FROM 'job_confirmed' THEN
    RAISE EXCEPTION
      'option_requests: illegal final_status transition job_confirmed → %. job_confirmed is terminal.',
      COALESCE(NEW.final_status, 'NULL')
    USING ERRCODE = 'P0001';
  END IF;

  -- final_status: option_confirmed cannot revert to option_pending
  IF OLD.final_status = 'option_confirmed' AND NEW.final_status = 'option_pending' THEN
    RAISE EXCEPTION
      'option_requests: illegal final_status transition option_confirmed → option_pending.'
    USING ERRCODE = 'P0001';
  END IF;

  -- model_approval: rejected is terminal
  IF OLD.model_approval = 'rejected'
     AND NEW.model_approval IS DISTINCT FROM 'rejected' THEN
    RAISE EXCEPTION
      'option_requests: illegal model_approval transition rejected → %. Model rejection is terminal.',
      NEW.model_approval
    USING ERRCODE = 'P0001';
  END IF;

  -- model_approval: approved cannot revert to pending
  IF OLD.model_approval = 'approved'
     AND NEW.model_approval = 'pending' THEN
    RAISE EXCEPTION
      'option_requests: illegal model_approval transition approved → pending.'
    USING ERRCODE = 'P0001';
  END IF;

  -- model_approval: cannot approve on an already-rejected request (timing exploit)
  IF NEW.status = 'rejected' AND NEW.model_approval = 'approved'
     AND OLD.model_approval = 'pending' AND OLD.status != 'rejected' THEN
    NULL;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.fn_validate_option_status_transition() IS
  'Trigger function: enforces the option_requests status state machine at DB level. '
  'Guards: status (rejected terminal, confirmed→in_negotiation blocked), '
  'final_status (job_confirmed terminal, option_confirmed→option_pending blocked), '
  'model_approval (rejected terminal, approved→pending blocked). '
  'Formalized from root-SQL migration_m3_m4_fixes.sql into migrations/ (20260711).';

DROP TRIGGER IF EXISTS trg_validate_option_status ON public.option_requests;

CREATE TRIGGER trg_validate_option_status
  BEFORE UPDATE OF status, final_status, model_approval
  ON public.option_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_validate_option_status_transition();

-- Verify: trigger exists
DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_validate_option_status'
  ), 'trg_validate_option_status trigger must exist after migration';
END;
$$;

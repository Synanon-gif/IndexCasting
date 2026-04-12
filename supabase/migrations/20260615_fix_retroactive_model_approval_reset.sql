-- =============================================================================
-- Fix: sync_model_account_linked must NOT retroactively reset model_approval
-- for already-confirmed lifecycles.
--
-- ROOT CAUSE:
--   The trigger resets model_approval from 'approved' to 'pending' for ALL
--   open requests when a model creates/claims an account. This is wrong for
--   requests where final_status is already 'option_confirmed' or 'job_confirmed'
--   because the agency already made a definitive availability decision under
--   the no-model-account flow.
--
-- FIX:
--   1. Updated trigger: only reset model_approval for requests where
--      final_status is NOT yet 'option_confirmed' or 'job_confirmed'.
--   2. Corrective backfill: restore model_approval='approved' for requests
--      that were already confirmed but got retroactively downgraded.
--
-- CANONICAL RULE:
--   A lifecycle item that was already validly confirmed under the
--   no-model-account branch must remain confirmed forever, even if the
--   model later gets an account.
-- =============================================================================


-- ─── A. Fix the AFTER UPDATE trigger on models ──────────────────────────────
-- Only reset model_approval for requests that are still pre-confirmation
-- (final_status NOT IN ('option_confirmed', 'job_confirmed')).

CREATE OR REPLACE FUNCTION public.sync_model_account_linked()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
BEGIN
  IF NEW.user_id IS NOT DISTINCT FROM OLD.user_id THEN
    RETURN NEW;
  END IF;

  UPDATE public.option_requests
  SET
    model_account_linked = (NEW.user_id IS NOT NULL),
    model_approval = CASE
      WHEN NEW.user_id IS NOT NULL
        AND model_account_linked = false
        AND model_approval = 'approved'
        AND final_status NOT IN ('option_confirmed', 'job_confirmed')
      THEN 'pending'
      ELSE model_approval
    END,
    model_approved_at = CASE
      WHEN NEW.user_id IS NOT NULL
        AND model_account_linked = false
        AND model_approval = 'approved'
        AND final_status NOT IN ('option_confirmed', 'job_confirmed')
      THEN NULL
      ELSE model_approved_at
    END,
    updated_at = now()
  WHERE
    model_id = NEW.id
    AND status IN ('in_negotiation', 'confirmed');

  RETURN NEW;
END;
$$;


-- ─── B. Corrective backfill ─────────────────────────────────────────────────
-- Restore model_approval='approved' for requests that were already confirmed
-- (final_status IN ('option_confirmed', 'job_confirmed')) but got their
-- model_approval retroactively reset to 'pending' by the old trigger.
-- These are requests where:
--   - model now has an account (model_account_linked = true)
--   - final_status is already confirmed (agency made the decision)
--   - model_approval is 'pending' (was reset by old trigger)
--   - status is still 'in_negotiation' or 'confirmed' (not rejected)

UPDATE public.option_requests
SET
  model_approval = 'approved',
  model_approved_at = COALESCE(model_approved_at, updated_at),
  updated_at = now()
WHERE
  model_account_linked = true
  AND model_approval = 'pending'
  AND final_status IN ('option_confirmed', 'job_confirmed')
  AND status IN ('in_negotiation', 'confirmed');


-- ─── C. Verification ────────────────────────────────────────────────────────

-- No confirmed requests should have pending model_approval
SELECT count(*) AS retroactive_pending_count
FROM public.option_requests
WHERE model_account_linked = true
  AND model_approval = 'pending'
  AND final_status IN ('option_confirmed', 'job_confirmed')
  AND status IN ('in_negotiation', 'confirmed');
-- Expected: 0

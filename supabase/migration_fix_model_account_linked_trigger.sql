-- =============================================================================
-- Fix: Sync option_requests.model_account_linked when models.user_id changes
--
-- Problem (HIGH-3 from 2026-04 System Audit):
--   option_requests.model_account_linked is set at INSERT time and backfilled
--   via migration_option_no_model_account.sql — but no trigger exists to keep
--   it in sync when models.user_id is updated later (e.g. after an agency
--   sends an invite link and the model signs up, or when agency_link_model_to_user
--   is called).
--
--   Without this trigger, existing in-negotiation option_requests for a model
--   that subsequently gains an account retain model_account_linked = false.
--   This means the agency's approval alone is sufficient to confirm the booking,
--   bypassing the required model confirmation step.
--
-- Fix:
--   AFTER UPDATE OF user_id ON models: update all in-negotiation option_requests
--   for that model:
--     - model_account_linked  ← (NEW.user_id IS NOT NULL)
--     - model_approval        ← reset to 'pending' only if the model just gained
--                               an account AND the request was previously auto-
--                               approved under the no-account path (approved +
--                               model_account_linked was false)
--
-- Safety:
--   - SECURITY DEFINER with SET search_path = public prevents search-path injection.
--   - Only touches rows with status = 'in_negotiation' (confirmed / rejected rows
--     are already finalised — changing model_account_linked there is harmless but
--     unnecessary and potentially confusing).
--   - Idempotent: safe to re-run; trigger body is CREATE OR REPLACE.
--
-- Run AFTER migration_option_no_model_account.sql (Phase 6, #67 in MIGRATION_ORDER.md).
-- Listed in MIGRATION_ORDER.md Phase 27 (#135).
-- =============================================================================


-- ─── Trigger function ────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.sync_model_account_linked()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only act when user_id actually changed
  IF NEW.user_id IS NOT DISTINCT FROM OLD.user_id THEN
    RETURN NEW;
  END IF;

  UPDATE public.option_requests
  SET
    model_account_linked = (NEW.user_id IS NOT NULL),
    model_approval = CASE
      -- Model just gained an account AND was previously auto-approved under the
      -- no-account path: reset to 'pending' so the model can now explicitly confirm.
      WHEN NEW.user_id IS NOT NULL
        AND model_account_linked = false
        AND model_approval = 'approved'
      THEN 'pending'
      -- All other cases: leave model_approval unchanged
      ELSE model_approval
    END,
    model_approved_at = CASE
      WHEN NEW.user_id IS NOT NULL
        AND model_account_linked = false
        AND model_approval = 'approved'
      THEN NULL   -- clear the auto-approval timestamp
      ELSE model_approved_at
    END
  WHERE
    model_id = NEW.id
    AND status = 'in_negotiation';

  RETURN NEW;
END;
$$;

-- ─── Attach trigger ──────────────────────────────────────────────────────────

-- Drop old trigger if it exists (idempotent re-run)
DROP TRIGGER IF EXISTS trg_model_user_id_changed ON public.models;

CREATE TRIGGER trg_model_user_id_changed
  AFTER UPDATE OF user_id
  ON public.models
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_model_account_linked();

-- ─── Verification ────────────────────────────────────────────────────────────

-- Confirm trigger is attached
SELECT tgname, tgtype, proname
FROM pg_trigger t
JOIN pg_proc p ON p.oid = t.tgfoid
WHERE tgrelid = 'public.models'::regclass
  AND tgname = 'trg_model_user_id_changed';

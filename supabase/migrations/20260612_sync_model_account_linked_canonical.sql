-- =============================================================================
-- Canonical fix: model_account_linked on option_requests
--
-- ROOT CAUSE (Critical Linkage Bug):
--   1. sync_model_account_linked trigger was only in root-SQL, never deployed
--      as a migration → models.user_id changes did not propagate to open requests.
--   2. No BEFORE INSERT trigger → new option_requests got column DEFAULT (false)
--      regardless of whether the model actually has an account.
--   3. insertOptionRequest (TypeScript) did not send model_account_linked.
--
-- FIX (three layers — defense in depth):
--   A. BEFORE INSERT trigger: derive model_account_linked from models.user_id
--   B. AFTER UPDATE trigger on models: sync existing open requests when user_id changes
--   C. Backfill: correct all currently-open requests
--
-- CANONICAL TRUTH: models.user_id IS NOT NULL → model has account
-- =============================================================================

-- ─── A. Column default (safe baseline) ──────────────────────────────────────

ALTER TABLE public.option_requests
  ALTER COLUMN model_account_linked SET DEFAULT false;

-- ─── B. BEFORE INSERT trigger on option_requests ────────────────────────────
-- Derives model_account_linked from models.user_id at insert time.
-- Defense-in-depth: even if TypeScript sends the value, this ensures correctness.

CREATE OR REPLACE FUNCTION public.fn_set_model_account_linked_on_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
DECLARE
  v_user_id uuid;
BEGIN
  SELECT m.user_id INTO v_user_id
  FROM public.models m
  WHERE m.id = NEW.model_id;

  NEW.model_account_linked := (v_user_id IS NOT NULL);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_option_request_set_model_account_linked
  ON public.option_requests;

CREATE TRIGGER trg_option_request_set_model_account_linked
  BEFORE INSERT
  ON public.option_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_set_model_account_linked_on_insert();


-- ─── C. AFTER UPDATE trigger on models (user_id change) ────────────────────
-- When a model gains or loses an account, update all open option_requests.
-- Also resets model_approval to 'pending' if the model just gained an account
-- and the request was previously auto-approved under the no-account path.

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
      THEN 'pending'
      ELSE model_approval
    END,
    model_approved_at = CASE
      WHEN NEW.user_id IS NOT NULL
        AND model_account_linked = false
        AND model_approval = 'approved'
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

DROP TRIGGER IF EXISTS trg_model_user_id_changed ON public.models;

CREATE TRIGGER trg_model_user_id_changed
  AFTER UPDATE OF user_id
  ON public.models
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_model_account_linked();


-- ─── D. Backfill existing open requests ─────────────────────────────────────
-- Correct model_account_linked for all non-terminal option_requests.
-- Also reset model_approval where a model now has an account but was
-- previously auto-approved under the no-account path.

UPDATE public.option_requests o
SET
  model_account_linked = (m.user_id IS NOT NULL),
  model_approval = CASE
    WHEN m.user_id IS NOT NULL
      AND o.model_account_linked = false
      AND o.model_approval = 'approved'
      AND o.status IN ('in_negotiation', 'confirmed')
    THEN 'pending'
    ELSE o.model_approval
  END,
  model_approved_at = CASE
    WHEN m.user_id IS NOT NULL
      AND o.model_account_linked = false
      AND o.model_approval = 'approved'
      AND o.status IN ('in_negotiation', 'confirmed')
    THEN NULL
    ELSE o.model_approved_at
  END,
  updated_at = now()
FROM public.models m
WHERE m.id = o.model_id
  AND o.status IN ('in_negotiation', 'confirmed')
  AND o.model_account_linked IS DISTINCT FROM (m.user_id IS NOT NULL);


-- ─── E. Verification queries ────────────────────────────────────────────────

-- Confirm BEFORE INSERT trigger exists
SELECT tgname, tgtype, proname
FROM pg_trigger t
JOIN pg_proc p ON p.oid = t.tgfoid
WHERE tgrelid = 'public.option_requests'::regclass
  AND tgname = 'trg_option_request_set_model_account_linked';

-- Confirm AFTER UPDATE trigger exists on models
SELECT tgname, tgtype, proname
FROM pg_trigger t
JOIN pg_proc p ON p.oid = t.tgfoid
WHERE tgrelid = 'public.models'::regclass
  AND tgname = 'trg_model_user_id_changed';

-- Confirm no stale open requests remain
SELECT count(*) AS stale_open_requests
FROM public.option_requests o
JOIN public.models m ON m.id = o.model_id
WHERE o.status IN ('in_negotiation', 'confirmed')
  AND o.model_account_linked IS DISTINCT FROM (m.user_id IS NOT NULL);

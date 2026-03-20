-- Options/castings without a model app account: no in-app model approval gate
-- =============================================================================

ALTER TABLE public.option_requests
  ADD COLUMN IF NOT EXISTS model_account_linked BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN public.option_requests.model_account_linked IS 'False when models.user_id is null — client & agency confirm without waiting for model app approval; calendars still sync on agency confirm.';

-- Backfill from current model records
UPDATE public.option_requests o
SET model_account_linked = (m.user_id IS NOT NULL)
FROM public.models m
WHERE m.id = o.model_id;

-- Existing pending rows where model has no app: auto-approve path
UPDATE public.option_requests o
SET
  model_approval = 'approved',
  model_approved_at = COALESCE(o.model_approved_at, now())
FROM public.models m
WHERE m.id = o.model_id
  AND m.user_id IS NULL
  AND o.model_approval = 'pending';

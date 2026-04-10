-- Freeze proposed_price / agency_counter_price after commercial acceptance + confirmation.
-- UI/RPC truth: client_price_status = accepted AND final_status IN (option_confirmed, job_confirmed).
-- Prevents direct API updates from mutating agreed amounts (defense in depth).

CREATE OR REPLACE FUNCTION public.fn_prevent_option_price_mutation_after_acceptance()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.client_price_status = 'accepted'
     AND OLD.final_status IN ('option_confirmed', 'job_confirmed')
     AND (
       NEW.proposed_price IS DISTINCT FROM OLD.proposed_price
       OR NEW.agency_counter_price IS DISTINCT FROM OLD.agency_counter_price
     )
  THEN
    RAISE EXCEPTION 'option_price_locked_after_acceptance'
      USING ERRCODE = 'P0001',
            MESSAGE = 'Cannot change proposed_price or agency_counter_price after price acceptance and confirmation.';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.fn_prevent_option_price_mutation_after_acceptance() IS
  'Blocks updates to proposed_price/agency_counter_price once deal is accepted and option or job is confirmed.';

DROP TRIGGER IF EXISTS trg_freeze_option_prices_on_acceptance ON public.option_requests;
CREATE TRIGGER trg_freeze_option_prices_on_acceptance
  BEFORE UPDATE OF proposed_price, agency_counter_price ON public.option_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_prevent_option_price_mutation_after_acceptance();

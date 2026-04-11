-- M3: Hide price-related system messages from model-role queries.
-- Adds a visible_to_model column (default true) and a trigger that sets it to false
-- for system messages containing commercial information.

ALTER TABLE public.option_request_messages
  ADD COLUMN IF NOT EXISTS visible_to_model boolean NOT NULL DEFAULT true;

-- Backfill: mark existing price-related system messages as hidden from model.
UPDATE public.option_request_messages
SET visible_to_model = false
WHERE from_role = 'system'
  AND (
    text LIKE 'Agency proposed %'
    OR text LIKE '%accepted the proposed price%'
    OR text LIKE '%declined the proposed price%'
    OR text LIKE '%accepted the counter offer%'
    OR text LIKE '%rejected the counter offer%'
  );

-- Trigger: auto-set visible_to_model = false for price-related system message kinds.
CREATE OR REPLACE FUNCTION public.fn_option_message_hide_price_from_model()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.from_role = 'system' AND (
    NEW.text LIKE 'Agency proposed %'
    OR NEW.text LIKE '%accepted the proposed price%'
    OR NEW.text LIKE '%declined the proposed price%'
    OR NEW.text LIKE '%accepted the counter offer%'
    OR NEW.text LIKE '%rejected the counter offer%'
  ) THEN
    NEW.visible_to_model := false;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_option_message_hide_price_from_model ON public.option_request_messages;
CREATE TRIGGER trg_option_message_hide_price_from_model
  BEFORE INSERT ON public.option_request_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_option_message_hide_price_from_model();

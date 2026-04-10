-- =============================================================================
-- 20260545: Option/Casting thread — authentic system messages (from_role=system)
--
-- - Enum chat_sender_type: add 'system'
-- - Trigger: allow from_role=system only when session flag set by RPC (spoofing)
-- - RPC insert_option_request_system_message: SECURITY DEFINER, kind→text (mirror uiCopy.systemMessages)
-- Idempotent where possible.
-- =============================================================================

-- 1) Enum value
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public'
      AND t.typname = 'chat_sender_type'
      AND e.enumlabel = 'system'
  ) THEN
    ALTER TYPE public.chat_sender_type ADD VALUE 'system';
  END IF;
END $$;

-- 2) Drop legacy CHECK on from_role if present (would block 'model' / 'system')
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class cl ON c.conrelid = cl.oid
    JOIN pg_namespace n ON cl.relnamespace = n.oid
    WHERE n.nspname = 'public'
      AND cl.relname = 'option_request_messages'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%from_role%'
  LOOP
    EXECUTE format('ALTER TABLE public.option_request_messages DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

-- 3) Trigger: system branch (session flag only; RPC sets app.option_request_system_message = '1')
CREATE OR REPLACE FUNCTION public.trg_enforce_option_message_from_role()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
DECLARE
  v_agency_id   uuid;
  v_model_id    uuid;
  v_org_id      uuid;
  v_client_id   uuid;
BEGIN
  SELECT agency_id, model_id, organization_id, client_id
    INTO v_agency_id, v_model_id, v_org_id, v_client_id
    FROM public.option_requests
   WHERE id = NEW.option_request_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'option_request_messages: parent option request % not found',
      NEW.option_request_id;
  END IF;

  IF NEW.from_role = 'agency' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.organizations o
      JOIN public.organization_members m ON m.organization_id = o.id
      WHERE o.agency_id = v_agency_id
        AND o.type      = 'agency'
        AND m.user_id   = auth.uid()
    ) THEN
      RAISE EXCEPTION
        'from_role validation failed: caller is not a member of the agency for this option request';
    END IF;

  ELSIF NEW.from_role = 'client' THEN
    IF NOT (
      v_client_id = auth.uid()
      OR (v_org_id IS NOT NULL AND EXISTS (
        SELECT 1
        FROM public.organization_members m
        JOIN public.organizations o ON o.id = m.organization_id
        WHERE m.organization_id = v_org_id
          AND o.type            = 'client'
          AND m.user_id         = auth.uid()
      ))
    ) THEN
      RAISE EXCEPTION
        'from_role validation failed: caller is not the client for this option request';
    END IF;

  ELSIF NEW.from_role = 'model' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.models mo
      WHERE mo.id      = v_model_id
        AND mo.user_id = auth.uid()
    ) THEN
      RAISE EXCEPTION
        'from_role validation failed: caller is not the model linked to this option request';
    END IF;

  ELSIF NEW.from_role = 'system' THEN
    IF current_setting('app.option_request_system_message', true) IS DISTINCT FROM '1' THEN
      RAISE EXCEPTION
        'from_role validation failed: system messages must use insert_option_request_system_message';
    END IF;

  ELSE
    RAISE EXCEPTION 'from_role validation failed: unsupported from_role %', NEW.from_role;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.trg_enforce_option_message_from_role() FROM PUBLIC;

DROP TRIGGER IF EXISTS enforce_option_message_from_role
  ON public.option_request_messages;

CREATE TRIGGER enforce_option_message_from_role
  BEFORE INSERT
  ON public.option_request_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_enforce_option_message_from_role();

COMMENT ON FUNCTION public.trg_enforce_option_message_from_role() IS
  'Validates from_role: agency/client/model match caller; system only via insert_option_request_system_message '
  '(session flag). H-1 + system workflow messages — 20260545.';

-- 4) RPC: insert system message (text must mirror src/constants/uiCopy.ts systemMessages)
CREATE OR REPLACE FUNCTION public.insert_option_request_system_message(
  p_option_request_id uuid,
  p_kind text,
  p_price numeric DEFAULT NULL,
  p_currency text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
DECLARE
  v_text text;
  v_id uuid;
  v_kind text := trim(lower(COALESCE(p_kind, '')));
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF NOT public.option_request_visible_to_me(p_option_request_id) THEN
    RAISE EXCEPTION 'access_denied';
  END IF;

  IF v_kind = 'agency_counter_offer' THEN
    IF p_price IS NULL OR p_currency IS NULL OR trim(p_currency) = '' THEN
      RAISE EXCEPTION 'agency_counter_offer requires p_price and p_currency';
    END IF;
    v_text := format('Agency proposed %s %s.', trim(p_price::text), trim(p_currency));
  ELSIF v_kind = 'no_model_account' THEN
    v_text :=
      'No model app account on file — you can negotiate and confirm with the client without waiting for model approval. The booking will appear in client and agency calendars when confirmed.';
  ELSIF v_kind = 'no_model_account_client_notice' THEN
    v_text :=
      'No model app account on file. The agency can negotiate and confirm with you without waiting for model approval. When confirmed, the booking appears in both calendars.';
  ELSIF v_kind = 'agency_accepted_price' THEN
    v_text := 'Agency accepted the proposed fee.';
  ELSIF v_kind = 'agency_declined_price' THEN
    v_text := 'Agency declined the proposed fee. A counter offer can be sent below.';
  ELSIF v_kind = 'client_accepted_counter' THEN
    v_text := 'Client accepted the agency proposal.';
  ELSIF v_kind = 'client_rejected_counter' THEN
    v_text := 'Client declined the counter offer.';
  ELSIF v_kind = 'job_confirmed_by_client' THEN
    v_text := 'Job confirmed by client.';
  ELSIF v_kind = 'model_approved_booking' THEN
    v_text := '✓ Approved by Model';
  ELSE
    RAISE EXCEPTION 'invalid_system_message_kind: %', p_kind;
  END IF;

  PERFORM set_config('app.option_request_system_message', '1', true);

  INSERT INTO public.option_request_messages (option_request_id, from_role, text)
  VALUES (p_option_request_id, 'system'::public.chat_sender_type, v_text)
  RETURNING id INTO v_id;

  PERFORM set_config('app.option_request_system_message', '', true);

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.insert_option_request_system_message(uuid, text, numeric, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.insert_option_request_system_message(uuid, text, numeric, text) TO authenticated;

COMMENT ON FUNCTION public.insert_option_request_system_message(uuid, text, numeric, text) IS
  'Workflow-only option_request_messages with from_role=system. Text mirrors uiCopy.systemMessages; '
  'guarded by option_request_visible_to_me + trigger session flag.';

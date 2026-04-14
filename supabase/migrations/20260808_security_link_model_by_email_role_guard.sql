-- F-01 Security fix: link_model_by_email must only operate for users with role='model'.
-- Previously any authenticated user (client, agent, guest) could auto-claim an unlinked
-- model record if their email matched. This migration adds a server-side role guard
-- as defense-in-depth (frontend also restricts calls to model role only).

CREATE OR REPLACE FUNCTION public.link_model_by_email()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET row_security TO 'off'
AS $function$
DECLARE
  u_email        text;
  v_already_linked boolean;
  v_caller_role  text;
BEGIN
  IF auth.uid() IS NULL THEN RETURN; END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.models WHERE user_id = auth.uid()
  ) INTO v_already_linked;

  IF v_already_linked THEN
    RETURN;
  END IF;

  -- GUARD: Only users with role='model' may auto-link via email.
  -- Prevents client/agent/guest from claiming unlinked model records.
  SELECT role INTO v_caller_role FROM public.profiles WHERE id = auth.uid();
  IF v_caller_role IS NULL OR v_caller_role != 'model' THEN
    RETURN;
  END IF;

  RAISE WARNING
    'link_model_by_email() is deprecated (Gefahr 2 in rls-security-patterns.mdc). '
    'Use generate_model_claim_token() + claim_model_by_token() instead. '
    'This function will be removed once all agencies have migrated to token flow.';

  SELECT email INTO u_email FROM auth.users WHERE id = auth.uid();
  IF u_email IS NULL OR trim(u_email) = '' THEN RETURN; END IF;

  UPDATE public.models
  SET user_id = auth.uid(), updated_at = now()
  WHERE lower(trim(email)) = lower(trim(u_email))
    AND user_id IS NULL;

  UPDATE public.profiles SET is_active = true WHERE id = auth.uid();
END;
$function$;

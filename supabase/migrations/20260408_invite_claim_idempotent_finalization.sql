-- =============================================================================
-- Idempotent accept_organization_invitation + claim_model_by_token
-- Safe to call finalize multiple times (refresh, retry) without false errors.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.accept_organization_invitation(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
DECLARE
  inv     public.invitations%ROWTYPE;
  org     public.organizations%ROWTYPE;
  uemail  text;
  prole   text;
  mem_cnt int;
  pending_inv boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  SELECT email INTO uemail FROM auth.users WHERE id = auth.uid();

  SELECT * INTO inv
  FROM public.invitations
  WHERE token = p_token
    AND (
      (status = 'pending' AND expires_at > now())
      OR
      (status IS NULL AND accepted_at IS NULL AND (expires_at IS NULL OR expires_at > now()))
    )
  LIMIT 1;

  pending_inv := FOUND;

  IF NOT pending_inv THEN
    SELECT * INTO inv
    FROM public.invitations
    WHERE token = p_token
    LIMIT 1;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'error', 'invalid_or_expired');
    END IF;

    IF inv.expires_at IS NOT NULL AND inv.expires_at <= now() THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.organization_members om
        WHERE om.user_id = auth.uid() AND om.organization_id = inv.organization_id
      ) THEN
        RETURN jsonb_build_object('ok', false, 'error', 'invalid_or_expired');
      END IF;
    END IF;
  END IF;

  IF lower(trim(COALESCE(uemail, ''))) IS DISTINCT FROM lower(trim(COALESCE(inv.email, ''))) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'email_mismatch');
  END IF;

  SELECT * INTO org FROM public.organizations WHERE id = inv.organization_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'org_not_found');
  END IF;

  SELECT role::text INTO prole FROM public.profiles WHERE id = auth.uid();

  IF org.type = 'agency' AND inv.role = 'booker' AND prole IS DISTINCT FROM 'agent' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'wrong_profile_role', 'expected', 'agent');
  END IF;

  IF org.type = 'client' AND inv.role IN ('employee', 'owner') AND prole IS DISTINCT FROM 'client' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'wrong_profile_role', 'expected', 'client');
  END IF;

  SELECT COUNT(*) INTO mem_cnt
  FROM public.organization_members
  WHERE user_id = auth.uid()
    AND organization_id <> inv.organization_id;

  IF mem_cnt > 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_member_of_another_org');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.organization_members om
    WHERE om.user_id = auth.uid() AND om.organization_id = inv.organization_id
  ) THEN
    RETURN jsonb_build_object('ok', true, 'organization_id', inv.organization_id);
  END IF;

  IF pending_inv THEN
    BEGIN
      UPDATE public.invitations
      SET status = 'accepted'
      WHERE id = inv.id;
    EXCEPTION WHEN undefined_column THEN
      UPDATE public.invitations
      SET accepted_at = now(), accepted_by = auth.uid()
      WHERE id = inv.id;
    END;
  END IF;

  INSERT INTO public.organization_members (user_id, organization_id, role)
  VALUES (
    auth.uid(),
    inv.organization_id,
    CASE inv.role
      WHEN 'booker'   THEN 'booker'::public.org_member_role
      WHEN 'employee' THEN 'employee'::public.org_member_role
      WHEN 'owner'    THEN 'owner'::public.org_member_role
      ELSE                 'employee'::public.org_member_role
    END
  )
  ON CONFLICT (user_id, organization_id) DO NOTHING;

  RETURN jsonb_build_object('ok', true, 'organization_id', inv.organization_id);
END;
$$;

REVOKE ALL    ON FUNCTION public.accept_organization_invitation(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.accept_organization_invitation(text) TO authenticated;

COMMENT ON FUNCTION public.accept_organization_invitation(text) IS
  'Secure invitation acceptance + idempotent replay: same user + target org returns ok without duplicate errors.';

-- ─── claim_model_by_token: same user / already linked → success without re-consuming ───

CREATE OR REPLACE FUNCTION public.claim_model_by_token(
  p_token text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
DECLARE
  v_claim_row public.model_claim_tokens%ROWTYPE;
  v_row_count integer;
  v_model_uid uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF p_token IS NULL OR length(trim(p_token)) < 10 THEN
    RAISE EXCEPTION 'invalid_token';
  END IF;

  SELECT * INTO v_claim_row
  FROM public.model_claim_tokens
  WHERE token = p_token;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'token_not_found';
  END IF;

  SELECT user_id INTO v_model_uid
  FROM public.models
  WHERE id = v_claim_row.model_id;

  IF v_model_uid IS NOT DISTINCT FROM auth.uid() THEN
    RETURN jsonb_build_object(
      'model_id',  v_claim_row.model_id,
      'agency_id', v_claim_row.agency_id
    );
  END IF;

  IF v_claim_row.used_at IS NOT NULL THEN
    IF v_claim_row.used_by_user_id IS NOT DISTINCT FROM auth.uid() THEN
      IF v_model_uid IS NOT DISTINCT FROM auth.uid() THEN
        RETURN jsonb_build_object(
          'model_id',  v_claim_row.model_id,
          'agency_id', v_claim_row.agency_id
        );
      END IF;
      IF v_model_uid IS NULL THEN
        UPDATE public.models
        SET user_id = auth.uid(), updated_at = now()
        WHERE id = v_claim_row.model_id
          AND user_id IS NULL;
        UPDATE public.profiles
        SET is_active = true
        WHERE id = auth.uid();
        RETURN jsonb_build_object(
          'model_id',  v_claim_row.model_id,
          'agency_id', v_claim_row.agency_id
        );
      END IF;
    END IF;
    RAISE EXCEPTION 'token_already_used';
  END IF;

  IF v_claim_row.expires_at < now() THEN
    RAISE EXCEPTION 'token_expired';
  END IF;

  IF v_model_uid IS NOT NULL AND v_model_uid IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'model_already_claimed';
  END IF;

  UPDATE public.model_claim_tokens
  SET used_at = now(), used_by_user_id = auth.uid()
  WHERE id = v_claim_row.id
    AND used_at IS NULL;

  GET DIAGNOSTICS v_row_count = ROW_COUNT;
  IF v_row_count = 0 THEN
    RAISE EXCEPTION 'token_already_used';
  END IF;

  UPDATE public.models
  SET user_id = auth.uid(), updated_at = now()
  WHERE id      = v_claim_row.model_id
    AND user_id IS NULL;

  UPDATE public.profiles
  SET is_active = true
  WHERE id = auth.uid();

  RETURN jsonb_build_object(
    'model_id',  v_claim_row.model_id,
    'agency_id', v_claim_row.agency_id
  );
END;
$$;

REVOKE ALL    ON FUNCTION public.claim_model_by_token(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_model_by_token(text) TO authenticated;

COMMENT ON FUNCTION public.claim_model_by_token(text) IS
  'Model claim by token; idempotent if model already linked to caller or token already consumed by caller.';

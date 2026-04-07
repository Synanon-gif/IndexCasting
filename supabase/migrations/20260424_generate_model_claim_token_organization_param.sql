-- =============================================================================
-- generate_model_claim_token — optional p_organization_id for unclaimed models
-- Date: 2026-04-24
--
-- Multi-org bookers: when models.agency_id IS NULL, passing p_organization_id
-- pins the token to that org's agency_id if the caller is a member; otherwise
-- falls back to oldest membership (previous behavior when param is NULL).
-- =============================================================================

DROP FUNCTION IF EXISTS public.generate_model_claim_token(uuid);

CREATE OR REPLACE FUNCTION public.generate_model_claim_token(
  p_model_id uuid,
  p_organization_id uuid DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
DECLARE
  v_caller_agency_id  uuid;
  v_model_agency_id   uuid;
  v_token             text;
  v_allowed           boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT agency_id INTO v_model_agency_id
  FROM public.models WHERE id = p_model_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'model_not_found';
  END IF;

  IF v_model_agency_id IS NOT NULL THEN
    v_allowed := (
      EXISTS (
        SELECT 1
        FROM public.organization_members om
        JOIN public.organizations org ON org.id = om.organization_id
        WHERE om.user_id = auth.uid()
          AND org.type = 'agency'
          AND org.agency_id = v_model_agency_id
      )
      OR EXISTS (
        SELECT 1 FROM public.bookers b
        WHERE b.agency_id = v_model_agency_id AND b.user_id = auth.uid()
      )
      OR EXISTS (
        SELECT 1 FROM public.agencies a
        WHERE a.id = v_model_agency_id AND a.owner_user_id = auth.uid()
      )
    );
    IF NOT v_allowed THEN
      RAISE EXCEPTION 'model_not_in_agency';
    END IF;
    v_caller_agency_id := v_model_agency_id;
  ELSE
    IF p_organization_id IS NOT NULL THEN
      SELECT o.agency_id INTO v_caller_agency_id
      FROM public.organization_members om
      JOIN public.organizations o ON o.id = om.organization_id
      WHERE om.user_id = auth.uid()
        AND o.id = p_organization_id
        AND o.type = 'agency'
        AND o.agency_id IS NOT NULL;

      IF v_caller_agency_id IS NULL THEN
        RAISE EXCEPTION 'not_member_of_organization';
      END IF;
    ELSE
      SELECT org.agency_id INTO v_caller_agency_id
      FROM public.organization_members om
      JOIN public.organizations org ON org.id = om.organization_id
      WHERE om.user_id = auth.uid()
        AND org.agency_id IS NOT NULL
        AND org.type = 'agency'
      ORDER BY om.created_at ASC
      LIMIT 1;

      IF v_caller_agency_id IS NULL THEN
        SELECT a.id INTO v_caller_agency_id
        FROM public.agencies a
        WHERE a.owner_user_id = auth.uid()
        ORDER BY a.created_at ASC
        LIMIT 1;
      END IF;

      IF v_caller_agency_id IS NULL THEN
        RAISE EXCEPTION 'not_in_agency';
      END IF;
    END IF;
  END IF;

  DELETE FROM public.model_claim_tokens
  WHERE model_id = p_model_id
    AND used_at IS NULL
    AND expires_at > now();

  v_token := encode(gen_random_bytes(32), 'hex');

  INSERT INTO public.model_claim_tokens (token, model_id, agency_id)
  VALUES (v_token, p_model_id, v_caller_agency_id);

  RETURN v_token;
END;
$$;

REVOKE ALL ON FUNCTION public.generate_model_claim_token(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.generate_model_claim_token(uuid, uuid) TO authenticated;

COMMENT ON FUNCTION public.generate_model_claim_token(uuid, uuid) IS
  'Agency-only RPC. Token agency_id matches models.agency_id when set. '
  'For unclaimed models, optional p_organization_id selects org membership; '
  'NULL keeps oldest-membership fallback (20260424).';

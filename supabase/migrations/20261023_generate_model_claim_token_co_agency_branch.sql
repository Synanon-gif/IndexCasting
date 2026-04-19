-- =============================================================================
-- 20261023_generate_model_claim_token_co_agency_branch.sql
--
-- Agency-to-Agency Roster Share — extend `generate_model_claim_token` so a
-- representing co-agency (listed in `model_agency_territories` for this model)
-- can also issue a claim token, even when it is NOT the home agency
-- (`models.agency_id`).
--
-- Existing branches (home-agency org-member / legacy bookers / agency owner)
-- remain untouched. New branch: caller is an authorized member of an agency
-- which has a `model_agency_territories` row for this model. In that case
-- the issued token is pinned to the caller's agency_id (NOT the model's home
-- agency_id) so the model claim flow associates the new account with the
-- correct representing agency for that territory.
--
-- Token agency_id semantics: still matches the agency that issued the token.
-- For a co-agency, that means the token represents the co-agency's
-- representation of the model. `claim_model_by_token` continues to work
-- against models.user_id only (token.agency_id is informational).
--
-- Idempotent. Single migration; not deployed via root supabase/*.sql.
-- =============================================================================

DROP FUNCTION IF EXISTS public.generate_model_claim_token(uuid, uuid);

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
  v_allowed_home      boolean := false;
  v_co_agency_id      uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT agency_id INTO v_model_agency_id
  FROM public.models WHERE id = p_model_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'model_not_found';
  END IF;

  -- Branch A: model has a home agency
  IF v_model_agency_id IS NOT NULL THEN
    -- A.1: caller is a member of the home agency (existing behavior)
    v_allowed_home := (
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

    IF v_allowed_home THEN
      v_caller_agency_id := v_model_agency_id;
    ELSE
      -- A.2 (NEW 20261023): caller is a co-agency for this model via MAT
      -- Resolve caller's agency_id from any agency membership that owns a MAT
      -- row for this model. p_organization_id pins the choice when supplied.
      IF p_organization_id IS NOT NULL THEN
        SELECT o.agency_id INTO v_co_agency_id
        FROM public.organization_members om
        JOIN public.organizations o ON o.id = om.organization_id
        JOIN public.model_agency_territories mat ON mat.agency_id = o.agency_id
        WHERE om.user_id = auth.uid()
          AND o.id = p_organization_id
          AND o.type = 'agency'
          AND o.agency_id IS NOT NULL
          AND mat.model_id = p_model_id
        LIMIT 1;
      END IF;

      IF v_co_agency_id IS NULL THEN
        -- Fallback: any agency membership of caller that holds a MAT row
        SELECT o.agency_id INTO v_co_agency_id
        FROM public.organization_members om
        JOIN public.organizations o ON o.id = om.organization_id
        JOIN public.model_agency_territories mat ON mat.agency_id = o.agency_id
        WHERE om.user_id = auth.uid()
          AND o.type = 'agency'
          AND o.agency_id IS NOT NULL
          AND mat.model_id = p_model_id
        ORDER BY om.created_at ASC
        LIMIT 1;
      END IF;

      IF v_co_agency_id IS NULL THEN
        -- Legacy bookers fallback for co-agency
        SELECT b.agency_id INTO v_co_agency_id
        FROM public.bookers b
        JOIN public.model_agency_territories mat ON mat.agency_id = b.agency_id
        WHERE b.user_id = auth.uid()
          AND mat.model_id = p_model_id
        LIMIT 1;
      END IF;

      IF v_co_agency_id IS NULL THEN
        -- Agency-owner fallback for co-agency
        SELECT a.id INTO v_co_agency_id
        FROM public.agencies a
        JOIN public.model_agency_territories mat ON mat.agency_id = a.id
        WHERE a.owner_user_id = auth.uid()
          AND mat.model_id = p_model_id
        LIMIT 1;
      END IF;

      IF v_co_agency_id IS NULL THEN
        RAISE EXCEPTION 'model_not_in_agency';
      END IF;

      v_caller_agency_id := v_co_agency_id;
    END IF;
  ELSE
    -- Branch B: unclaimed model (no home agency) — unchanged
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
  'Agency-only RPC. Home-agency members issue tokens pinned to models.agency_id. '
  'Co-agencies (members of an agency with a model_agency_territories row for this model) '
  'can also issue tokens; in that case the token agency_id is the co-agency''s id (20261023).';

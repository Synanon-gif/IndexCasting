-- =============================================================================
-- 20261207_fix_generate_model_claim_token_no_agencies_owner_user_id.sql
--
-- WHY: 20261023_generate_model_claim_token_co_agency_branch.sql added the
-- A2A co-agency branch but ALSO re-introduced references to
-- `public.agencies.owner_user_id` in three places (home-agency owner check,
-- co-agency owner fallback, claim-unowned fallback). That column does not
-- exist on production (cf. 20260427_fix_agency_guard_no_owner_user_id.sql,
-- which had explicitly stripped every such reference and asserted none
-- remained). Symptom: `column a.owner_user_id does not exist` (42703) on
-- generateModelClaimToken / handleAddModel from the Agency UI.
--
-- FIX: Replace `generate_model_claim_token(uuid, uuid)` with the same
-- semantics as 20261023 (home-agency members + bookers + NEW co-agency
-- branch via model_agency_territories) MINUS every owner_user_id reference.
-- Authorization for "is this caller an authorized member of <agency_id>" is
-- consistently:
--   1. organization_members JOIN organizations WHERE type='agency' AND agency_id match
--   2. legacy public.bookers
-- The verify block at the bottom asserts the function definition no longer
-- contains the substring `owner_user_id`.
--
-- Idempotent: full DROP + CREATE OR REPLACE of the (uuid, uuid) overload.
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
    -- A.1: caller is a member of the home agency (org_members or legacy bookers)
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
    );

    IF v_allowed_home THEN
      v_caller_agency_id := v_model_agency_id;
    ELSE
      -- A.2: caller is a co-agency for this model via model_agency_territories.
      -- Pin to caller's agency_id (NOT model's home agency) so the issued
      -- token represents the co-agency's representation of the model.
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
        RAISE EXCEPTION 'model_not_in_agency';
      END IF;

      v_caller_agency_id := v_co_agency_id;
    END IF;
  ELSE
    -- Branch B: unclaimed model (no home agency) — org_members + bookers only
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
        SELECT b.agency_id INTO v_caller_agency_id
        FROM public.bookers b
        WHERE b.user_id = auth.uid()
        ORDER BY b.created_at ASC
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
  'can also issue tokens; in that case the token agency_id is the co-agency''s id (20261023). '
  'FIXED 20261207: removed every reference to non-existent agencies.owner_user_id column '
  '(regression introduced in 20261023; production agencies table has no such column).';

-- ─── Verification ────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'generate_model_claim_token'
    AND p.pronargs = 2;

  ASSERT v_def IS NOT NULL,
    'FAIL: generate_model_claim_token(uuid,uuid) missing after 20261207';

  ASSERT v_def NOT ILIKE '%owner_user_id%',
    'FAIL: generate_model_claim_token still references owner_user_id after 20261207';

  ASSERT v_def ILIKE '%model_agency_territories%',
    'FAIL: generate_model_claim_token lost the co-agency MAT branch after 20261207';

  RAISE NOTICE 'PASS: 20261207 — generate_model_claim_token clean (no owner_user_id, MAT branch intact)';
END $$;

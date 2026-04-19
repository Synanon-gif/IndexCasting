-- =============================================================================
-- 20260419_generate_model_claim_token_drop_pgcrypto.sql
--
-- Security audit 2026-04-19 (Finding F2 — LOW, drift risk):
-- Replace `gen_random_bytes(32)` (pgcrypto) with a pgcrypto-free 256-bit token
-- derivation so this RPC remains correct even on Supabase projects where the
-- `pgcrypto` extension is not (re-)installed (system-invariants.mdc:
-- "KEIN pgcrypto / digest() — PFLICHT" for SECURITY DEFINER flows).
--
-- Replacement entropy: SHA-256 over the concatenation of two PG13+ built-in
-- `gen_random_uuid()` calls. UUID v4 contributes 122 bits of entropy each;
-- two of them concatenated and hashed yield a 64-char hex secret with well
-- over 240 bits of effective entropy — equivalent strength to the previous
-- `gen_random_bytes(32)` token for unguessable claim tokens.
--
-- Logic identical to 20261023 — only the v_token derivation changes.
-- Idempotent: DROP FUNCTION + CREATE OR REPLACE.
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
      -- A.2: caller is a co-agency for this model via MAT
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
        SELECT b.agency_id INTO v_co_agency_id
        FROM public.bookers b
        JOIN public.model_agency_territories mat ON mat.agency_id = b.agency_id
        WHERE b.user_id = auth.uid()
          AND mat.model_id = p_model_id
        LIMIT 1;
      END IF;

      IF v_co_agency_id IS NULL THEN
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

  -- 20260419 (Audit F2): pgcrypto-free 256-bit token derivation.
  -- Built-in PG13+ primitives only: gen_random_uuid() + sha256() + encode().
  v_token := encode(
    sha256(((gen_random_uuid()::text) || (gen_random_uuid()::text))::bytea),
    'hex'
  );

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
  'can also issue tokens; token agency_id is the co-agency''s id (20261023). '
  '20260419 audit fix: token derived from gen_random_uuid + sha256 (no pgcrypto).';

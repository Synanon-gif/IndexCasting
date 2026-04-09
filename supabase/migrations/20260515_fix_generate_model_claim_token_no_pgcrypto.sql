-- =============================================================================
-- 20260515_fix_generate_model_claim_token_no_pgcrypto.sql
--
-- Fixes: generate_model_claim_token uses gen_random_bytes(32) from pgcrypto,
-- which is not available on this Supabase project → function throws at runtime
-- → generateModelClaimToken returns 404 → Invite mail never sent.
--
-- Fix: replace gen_random_bytes(32) with sha256(gen_random_uuid()::text::bytea)
-- which is a PG13+ built-in, no extension required.
-- Invariante: gen_random_bytes() verboten (system-invariants.mdc KEIN pgcrypto / digest()).
--
-- Identical to 20260427 definition except the single token-generation line.
-- =============================================================================

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
  -- GUARD 1: Authentication
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  -- GUARD 2: Model existence
  SELECT agency_id INTO v_model_agency_id
  FROM public.models WHERE id = p_model_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'model_not_found';
  END IF;

  -- GUARD 3: Caller-Agency resolution + resource ownership
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

  -- Invalidate any existing unused tokens for this model (one active token at a time)
  DELETE FROM public.model_claim_tokens
  WHERE model_id = p_model_id
    AND used_at IS NULL
    AND expires_at > now();

  -- Generate 64-char hex token using PG13+ built-in sha256() — no pgcrypto needed.
  -- gen_random_uuid() is cryptographically secure; sha256 provides 32 bytes = 64 hex chars.
  v_token := encode(sha256((gen_random_uuid()::text)::bytea), 'hex');

  INSERT INTO public.model_claim_tokens (token, model_id, agency_id)
  VALUES (v_token, p_model_id, v_caller_agency_id);

  RETURN v_token;
END;
$$;

REVOKE ALL ON FUNCTION public.generate_model_claim_token(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.generate_model_claim_token(uuid, uuid) TO authenticated;

COMMENT ON FUNCTION public.generate_model_claim_token(uuid, uuid) IS
  'FIXED (20260515): replaced gen_random_bytes(pgcrypto) with sha256(gen_random_uuid()) — PG13+ built-in, no extension required. Guards: auth + agency membership + resource ownership.';

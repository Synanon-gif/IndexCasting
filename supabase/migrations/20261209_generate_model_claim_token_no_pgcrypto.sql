-- =============================================================================
-- 20261209: generate_model_claim_token — drop pgcrypto dependency (no gen_random_bytes)
--
-- THIRD regression of the same invariant. Previous milestones:
--   20260515  — first fix; switched gen_random_bytes(32) → sha256(gen_random_uuid())
--   20261023  — re-introduced gen_random_bytes(32) when adding the co-agency branch
--   20261207  — kept gen_random_bytes(32) while removing owner_user_id; broke prod
--               with `function gen_random_bytes(integer) does not exist` (42883)
--
-- ROOT CAUSE: pgcrypto on this Supabase project lives in the `extensions` schema,
-- not on the function's `search_path = public`. Running unqualified
-- `gen_random_bytes(int)` resolves against `public` only → 42883 → PostgREST 400
-- → "Add Model" button completely unusable from the agency UI.
--
-- FIX: Re-create generate_model_claim_token(uuid, uuid) keeping the entire
-- 20261207 branching logic intact, but produce the 256-bit token without any
-- pgcrypto symbol — using the PG13+ built-in `sha256()` over two
-- gen_random_uuid() values (256 bits of entropy, well above the 128-bit cap of
-- a single UUID).
--
-- Hardening: the verify block now ALSO asserts the function does NOT reference
-- gen_random_bytes / digest / pgp_sym_* anywhere — so future edits cannot
-- silently regress this for a fourth time.
--
-- Cf. .cursor/rules/system-invariants.mdc → "KEIN pgcrypto / digest()"
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

  -- pgcrypto-free 256-bit token (sha256 is built-in in PG13+):
  -- two UUIDs concatenated -> 256 bits of entropy. No pgcrypto symbols here;
  -- the verify block at the bottom of this migration enforces that.
  -- Cf. system-invariants.mdc invariant "KEIN pgcrypto".
  v_token := encode(
    sha256((gen_random_uuid()::text || gen_random_uuid()::text)::bytea),
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
  'can also issue tokens; in that case the token agency_id is the co-agency''s id. '
  'FIXED 20261209: token generation no longer depends on pgcrypto (gen_random_bytes); '
  'uses sha256(uuid || uuid) — see system-invariants.mdc.';

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
    'FAIL: generate_model_claim_token(uuid,uuid) missing after 20261209';

  ASSERT v_def NOT ILIKE '%owner_user_id%',
    'FAIL: generate_model_claim_token still references owner_user_id after 20261209';

  ASSERT v_def NOT ILIKE '%gen_random_bytes%',
    'FAIL: generate_model_claim_token still references gen_random_bytes (pgcrypto) after 20261209';

  ASSERT v_def NOT ILIKE '%pgp_sym_%',
    'FAIL: generate_model_claim_token references pgp_sym_* (pgcrypto) after 20261209';

  -- Allow `digest` only as the substring of `sha256(...)` etc — not as the standalone fn call.
  ASSERT (v_def !~* '\mdigest\s*\('),
    'FAIL: generate_model_claim_token still calls digest() (pgcrypto) after 20261209';

  ASSERT v_def ILIKE '%model_agency_territories%',
    'FAIL: generate_model_claim_token lost the co-agency MAT branch after 20261209';

  ASSERT v_def ILIKE '%sha256%',
    'FAIL: generate_model_claim_token does not use the pgcrypto-free sha256 token path after 20261209';
END;
$$;

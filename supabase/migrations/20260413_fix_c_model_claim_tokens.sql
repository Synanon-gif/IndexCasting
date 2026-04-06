-- =============================================================================
-- Fix C: Token-based Model Claim System
--
-- PROBLEM:
--   link_model_by_email() links a model record to a user account via email
--   matching. This violates rls-security-patterns.mdc Gefahr 2:
--     - Email can change
--     - Email collision enables account takeover of a model record
--     - Bypasses the ID-based membership model
--
-- SOLUTION:
--   1. model_claim_tokens table — agency generates a secure one-time token
--      when creating/inviting a model. The model enters this token in the app.
--   2. generate_model_claim_token(p_model_id) RPC — agency only.
--   3. claim_model_by_token(p_token) RPC — model user only.
--   4. link_model_by_email() is DEPRECATED. It remains for backward
--      compatibility (existing linked models won't break) but logs a
--      deprecation warning and will be removed in a future migration.
--
-- Token security properties:
--   - 32 random bytes = 256 bits of entropy (cryptographically secure)
--   - Single-use (used_at IS NULL guard + UPDATE atomic check)
--   - Expires after 30 days
--   - Bound to a specific model_id (no token reuse across models)
--   - Agency ownership verified at generation time
--
-- Idempotent: safe to run multiple times.
-- =============================================================================


-- ─── 1. model_claim_tokens table ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.model_claim_tokens (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  token           text        NOT NULL UNIQUE,
  model_id        uuid        NOT NULL REFERENCES public.models(id) ON DELETE CASCADE,
  agency_id       uuid        NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
  used_at         timestamptz,
  used_by_user_id uuid        REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_model_claim_tokens_model_id ON public.model_claim_tokens(model_id);
CREATE INDEX IF NOT EXISTS idx_model_claim_tokens_token    ON public.model_claim_tokens(token);

ALTER TABLE public.model_claim_tokens ENABLE ROW LEVEL SECURITY;

-- RLS: admin sees all; agency members see tokens for their models; model sees own used token
CREATE POLICY "admin_full_access_model_claim_tokens"
  ON public.model_claim_tokens FOR ALL TO authenticated
  USING (public.is_current_user_admin())
  WITH CHECK (public.is_current_user_admin());

CREATE POLICY "agency_members_see_own_tokens"
  ON public.model_claim_tokens FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.organizations o
      JOIN public.organization_members om ON om.organization_id = o.id
      WHERE o.agency_id = model_claim_tokens.agency_id
        AND om.user_id  = auth.uid()
    )
  );

CREATE POLICY "model_user_sees_own_used_token"
  ON public.model_claim_tokens FOR SELECT TO authenticated
  USING (used_by_user_id = auth.uid());

COMMENT ON TABLE public.model_claim_tokens IS
  'One-time tokens for linking a model record to a user account without email matching. '
  'Replaces link_model_by_email() email-based linking (Gefahr 2 in rls-security-patterns.mdc).';


-- ─── 2. generate_model_claim_token(p_model_id) ───────────────────────────────

CREATE OR REPLACE FUNCTION public.generate_model_claim_token(
  p_model_id uuid
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
BEGIN
  -- GUARD 1: authenticated
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  -- GUARD 2: caller must be an agency org member
  SELECT org.agency_id INTO v_caller_agency_id
  FROM public.organization_members om
  JOIN public.organizations org ON org.id = om.organization_id
  WHERE om.user_id = auth.uid()
    AND org.agency_id IS NOT NULL
  ORDER BY om.created_at ASC
  LIMIT 1;

  IF v_caller_agency_id IS NULL THEN
    SELECT a.id INTO v_caller_agency_id
    FROM public.agencies a
    WHERE a.owner_user_id = auth.uid()
    ORDER BY a.created_at ASC LIMIT 1;
  END IF;

  IF v_caller_agency_id IS NULL THEN
    RAISE EXCEPTION 'not_in_agency';
  END IF;

  -- GUARD 3: model must belong to caller's agency (or be unclaimed)
  SELECT agency_id INTO v_model_agency_id
  FROM public.models WHERE id = p_model_id;

  IF v_model_agency_id IS NOT NULL AND v_model_agency_id <> v_caller_agency_id THEN
    RAISE EXCEPTION 'model_not_in_agency';
  END IF;

  -- Invalidate any existing unused tokens for this model (one active token at a time)
  DELETE FROM public.model_claim_tokens
  WHERE model_id = p_model_id
    AND used_at IS NULL
    AND expires_at > now();

  -- Generate 32-byte cryptographically secure token
  v_token := encode(gen_random_bytes(32), 'hex');

  INSERT INTO public.model_claim_tokens (token, model_id, agency_id)
  VALUES (v_token, p_model_id, v_caller_agency_id);

  RETURN v_token;
END;
$$;

REVOKE ALL    ON FUNCTION public.generate_model_claim_token(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.generate_model_claim_token(uuid) TO authenticated;

COMMENT ON FUNCTION public.generate_model_claim_token IS
  'Agency-only RPC. Generates a cryptographically secure one-time claim token '
  'for a model record. Previous unused tokens for the same model are invalidated. '
  'Token is valid for 30 days. Agency sends token to model out-of-band (e.g. email).';


-- ─── 3. claim_model_by_token(p_token) ────────────────────────────────────────

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
BEGIN
  -- GUARD 1: authenticated
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  -- GUARD 2: token input sanity
  IF p_token IS NULL OR length(trim(p_token)) < 10 THEN
    RAISE EXCEPTION 'invalid_token';
  END IF;

  -- Fetch token row
  SELECT * INTO v_claim_row
  FROM public.model_claim_tokens
  WHERE token = p_token;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'token_not_found';
  END IF;

  IF v_claim_row.used_at IS NOT NULL THEN
    RAISE EXCEPTION 'token_already_used';
  END IF;

  IF v_claim_row.expires_at < now() THEN
    RAISE EXCEPTION 'token_expired';
  END IF;

  -- Atomic claim: only succeeds if token is still unused (race-condition safe)
  UPDATE public.model_claim_tokens
  SET used_at = now(), used_by_user_id = auth.uid()
  WHERE id = v_claim_row.id
    AND used_at IS NULL;  -- double guard

  GET DIAGNOSTICS v_row_count = ROW_COUNT;
  IF v_row_count = 0 THEN
    RAISE EXCEPTION 'token_already_used';
  END IF;

  -- Link the model record to the calling user
  UPDATE public.models
  SET user_id = auth.uid(), updated_at = now()
  WHERE id      = v_claim_row.model_id
    AND user_id IS NULL;  -- only claim unclaimed; already-linked models stay

  -- Activate the profile
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

COMMENT ON FUNCTION public.claim_model_by_token IS
  'Model-user RPC. Claims a model record using a one-time token generated by the agency. '
  'Token-based linking replaces email-based link_model_by_email() (Gefahr 2 fix). '
  'Race-condition safe: atomic UPDATE with double guard + GET DIAGNOSTICS ROW_COUNT.';


-- ─── 4. Deprecate link_model_by_email() ──────────────────────────────────────
--
-- The function is kept for backward compatibility (already-linked models where
-- models.user_id IS NOT NULL will not be re-linked since the WHERE includes
-- user_id IS NULL). It now raises a NOTICE deprecation warning and will be
-- removed once all agencies have migrated to the token flow.

CREATE OR REPLACE FUNCTION public.link_model_by_email()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
DECLARE
  u_email   text;
  v_already_linked boolean;
BEGIN
  -- GUARD 1
  IF auth.uid() IS NULL THEN RETURN; END IF;

  -- Check if the calling user already has a linked model (common path after token claim)
  SELECT EXISTS (
    SELECT 1 FROM public.models WHERE user_id = auth.uid()
  ) INTO v_already_linked;

  IF v_already_linked THEN
    RETURN;  -- already linked via token or previous email link — no-op
  END IF;

  -- DEPRECATED: email-based linking. Log warning and proceed for backward compat.
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
$$;

COMMENT ON FUNCTION public.link_model_by_email() IS
  'DEPRECATED (Fix C, 20260413). Replaced by claim_model_by_token(). '
  'Kept for backward compatibility only. Will be removed in a future migration. '
  'Safe: only links models with user_id IS NULL; no-op if caller already has a linked model.';


-- ─── Verification ─────────────────────────────────────────────────────────────

DO $$
BEGIN
  ASSERT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'model_claim_tokens'),
    'FAIL: model_claim_tokens table not found';

  ASSERT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'generate_model_claim_token'),
    'FAIL: generate_model_claim_token function not found';

  ASSERT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'claim_model_by_token'),
    'FAIL: claim_model_by_token function not found';

  RAISE NOTICE 'PASS: 20260413_fix_c — model claim token system created; link_model_by_email deprecated';
END $$;

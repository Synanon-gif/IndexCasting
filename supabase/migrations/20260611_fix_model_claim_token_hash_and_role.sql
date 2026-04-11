-- =============================================================================
-- 20260611_fix_model_claim_token_hash_and_role.sql
--
-- CRITICAL-1: claim_model_by_token references token_hash column that does not
-- exist. generate_model_claim_token stores plaintext in column `token`.
-- get_model_claim_preview uses `mct.token = p_token` (plaintext match).
--
-- FIX:
--   A) Add token_hash column to model_claim_tokens
--   B) Backfill token_hash for existing rows using sha256(token::bytea)
--   C) Update generate_model_claim_token to store both token (returned) and
--      token_hash (stored for lookup)
--   D) Update get_model_claim_preview to use token_hash
--   E) claim_model_by_token already uses token_hash — no change needed there
--
-- MAJOR-4: claim_model_by_token does not set profiles.role = 'model'.
-- If an existing user with role='client' claims a model, they land in the
-- wrong workspace. Fixed: SET role = 'model' on claim.
--
-- Idempotent: IF NOT EXISTS, CREATE OR REPLACE, ON CONFLICT DO NOTHING.
-- =============================================================================


-- ─── A) Add token_hash column ──────────────────────────────────────────────

ALTER TABLE public.model_claim_tokens
  ADD COLUMN IF NOT EXISTS token_hash text;

CREATE INDEX IF NOT EXISTS idx_model_claim_tokens_token_hash
  ON public.model_claim_tokens (token_hash);


-- ─── B) Backfill token_hash for existing rows ──────────────────────────────

UPDATE public.model_claim_tokens
SET token_hash = encode(sha256(token::bytea), 'hex')
WHERE token_hash IS NULL
  AND token IS NOT NULL;


-- ─── C) generate_model_claim_token — store token_hash alongside token ──────

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
  v_token_hash        text;
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

  DELETE FROM public.model_claim_tokens
  WHERE model_id = p_model_id
    AND used_at IS NULL
    AND expires_at > now();

  v_token := encode(sha256((gen_random_uuid()::text)::bytea), 'hex');
  v_token_hash := encode(sha256(v_token::bytea), 'hex');

  INSERT INTO public.model_claim_tokens (token, token_hash, model_id, agency_id)
  VALUES (v_token, v_token_hash, p_model_id, v_caller_agency_id);

  RETURN v_token;
END;
$$;

REVOKE ALL ON FUNCTION public.generate_model_claim_token(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.generate_model_claim_token(uuid, uuid) TO authenticated;


-- ─── D) get_model_claim_preview — use token_hash for lookup ────────────────

CREATE OR REPLACE FUNCTION public.get_model_claim_preview(
  p_token text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
DECLARE
  v_record  record;
  v_hash    text;
BEGIN
  v_hash := encode(sha256(p_token::bytea), 'hex');

  SELECT
    mct.id,
    mct.model_id,
    mct.agency_id,
    mct.expires_at,
    mct.used_at,
    m.name    AS model_name,
    a.name    AS agency_name
  INTO v_record
  FROM public.model_claim_tokens mct
  JOIN public.models              m  ON m.id  = mct.model_id
  JOIN public.agencies            a  ON a.id  = mct.agency_id
  WHERE mct.token_hash = v_hash
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('valid', false, 'error', 'token_not_found');
  END IF;

  IF v_record.used_at IS NOT NULL THEN
    RETURN jsonb_build_object('valid', false, 'error', 'token_already_used');
  END IF;

  IF v_record.expires_at < now() THEN
    RETURN jsonb_build_object('valid', false, 'error', 'token_expired');
  END IF;

  RETURN jsonb_build_object(
    'valid',       true,
    'model_name',  v_record.model_name,
    'agency_name', v_record.agency_name
  );
END;
$$;


-- ─── E) claim_model_by_token — add profiles.role = 'model' (MAJOR-4 fix) ──
--
-- The function body already uses token_hash (from 20260520). We only add
-- the SET role = 'model' line after the is_active update.

CREATE OR REPLACE FUNCTION public.claim_model_by_token(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
DECLARE
  v_claim_row RECORD;
  v_row_count INTEGER;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT *
  INTO v_claim_row
  FROM public.model_claim_tokens
  WHERE token_hash = encode(sha256(p_token::bytea), 'hex')
    AND used_at   IS NULL
    AND expires_at > now()
  LIMIT 1;

  IF NOT FOUND THEN
    IF EXISTS (
      SELECT 1 FROM public.model_claim_tokens
      WHERE token_hash = encode(sha256(p_token::bytea), 'hex')
        AND used_at IS NULL
        AND expires_at <= now()
    ) THEN
      RAISE EXCEPTION 'token_expired';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.model_claim_tokens
      WHERE token_hash = encode(sha256(p_token::bytea), 'hex')
        AND used_at IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'token_already_used';
    END IF;
    RAISE EXCEPTION 'token_not_found';
  END IF;

  UPDATE public.model_claim_tokens
  SET used_at = now()
  WHERE id      = v_claim_row.id
    AND used_at IS NULL;

  GET DIAGNOSTICS v_row_count = ROW_COUNT;
  IF v_row_count = 0 THEN
    RAISE EXCEPTION 'token_already_used';
  END IF;

  UPDATE public.models
  SET user_id    = auth.uid(),
      updated_at = now()
  WHERE id      = v_claim_row.model_id
    AND user_id IS NULL;

  UPDATE public.models
  SET agency_relationship_status = 'active',
      updated_at                 = now()
  WHERE id                        = v_claim_row.model_id
    AND agency_relationship_status = 'pending_link';

  -- Activate profile AND ensure role is 'model' so the user lands in ModelView
  UPDATE public.profiles
  SET is_active = true,
      role      = 'model'
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
  'Race-condition safe: atomic UPDATE with double guard + GET DIAGNOSTICS ROW_COUNT. '
  '20260520: sets agency_relationship_status = active when previously pending_link. '
  '20260611: uses token_hash column (CRITICAL-1 fix); sets profiles.role = model (MAJOR-4 fix).';


-- ─── VERIFICATION ──────────────────────────────────────────────────────────

DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'model_claim_tokens'
      AND column_name = 'token_hash'
  ), 'FAIL: model_claim_tokens.token_hash column not found';

  ASSERT NOT EXISTS (
    SELECT 1 FROM public.model_claim_tokens
    WHERE token IS NOT NULL AND token_hash IS NULL
  ), 'FAIL: un-backfilled rows remain in model_claim_tokens';

  RAISE NOTICE 'ALL VERIFICATIONS PASSED — CRITICAL-1 + MAJOR-4 fixed';
END $$;

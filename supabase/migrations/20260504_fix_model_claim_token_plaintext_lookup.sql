-- =============================================================================
-- 20260504_fix_model_claim_token_plaintext_lookup.sql
--
-- WHY — token_hash drift across three migrations:
--
--   20260611 added token_hash column to model_claim_tokens, updated
--     get_model_claim_preview to look up by token_hash, and updated
--     generate_model_claim_token to store both token + token_hash.
--
--   20261023 / 20261207 rewrote generate_model_claim_token to fix unrelated
--     regressions (owner_user_id column, co-agency MAT branch) but dropped
--     token_hash from the INSERT. All tokens generated after that deployment
--     have token_hash IS NULL.
--
--   Result: get_model_claim_preview and claim_model_by_token validate by
--     token_hash — which is NULL on every new token — so every preview and
--     claim call raises token_not_found. Model invite emails arrive but links
--     silently fail at the agency side (send-invite) and at the model claim
--     step.
--
-- FIX: revert all three functions to plaintext WHERE token = p_token lookup.
--   token_hash column is intentionally left in place; it is not dropped
--   because older rows were backfilled and dropping the column or its index
--   is outside this fix's scope.
--
-- Scope: model claim token RPCs only.
-- Does NOT touch: org invitation flows, send-invite Edge Function, frontend
--   services, billing, auth, or any table schema.
--
-- Idempotent: all CREATE OR REPLACE FUNCTION.
-- =============================================================================


-- ─── 1) get_model_claim_preview — plaintext lookup ───────────────────────────
--
-- Called by send-invite Edge Function before dispatching a model claim email.
-- Returns { valid, model_name, agency_name } or { valid: false, error }.
-- anon + authenticated can call (unauthenticated model recipients preview it).

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
BEGIN
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
  WHERE mct.token = p_token
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

GRANT EXECUTE ON FUNCTION public.get_model_claim_preview(text) TO anon, authenticated;

COMMENT ON FUNCTION public.get_model_claim_preview(text) IS
  'Public RPC: validates a model claim token and returns agency_name + model_name '
  'for display before account creation. Plaintext WHERE token = p_token lookup. '
  'token_hash drift fixed (20260504): 20260611 switched to token_hash lookup; '
  '20261207 stopped storing token_hash in INSERT; this migration reverts to plaintext.';


-- ─── 2) claim_model_by_token — plaintext lookup in all branches ───────────────
--
-- Called by finalizePendingInviteOrClaim after the model creates their account.
-- Atomically consumes the token, links models.user_id, flips agency_relationship_status
-- to active, and sets profiles.role = 'model'.

CREATE OR REPLACE FUNCTION public.claim_model_by_token(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
DECLARE
  v_claim_row    RECORD;
  v_model_user   uuid;
  v_caller       uuid := auth.uid();
  v_row_count    INTEGER;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  -- 1) Locate a still-valid token row by plaintext.
  SELECT *
  INTO v_claim_row
  FROM public.model_claim_tokens
  WHERE token      = p_token
    AND used_at   IS NULL
    AND expires_at > now()
  LIMIT 1;

  IF NOT FOUND THEN
    IF EXISTS (
      SELECT 1 FROM public.model_claim_tokens
      WHERE token    = p_token
        AND used_at IS NULL
        AND expires_at <= now()
    ) THEN
      RAISE EXCEPTION 'token_expired';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.model_claim_tokens
      WHERE token    = p_token
        AND used_at IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'token_already_used';
    END IF;
    RAISE EXCEPTION 'token_not_found';
  END IF;

  -- 2) Guard: abort without burning the token if another user already owns the model.
  --    Re-claim by the same user (retry/reload) is silently allowed.
  SELECT user_id
  INTO v_model_user
  FROM public.models
  WHERE id = v_claim_row.model_id
  LIMIT 1;

  IF v_model_user IS NOT NULL AND v_model_user <> v_caller THEN
    RAISE EXCEPTION 'model_already_claimed_by_other_user';
  END IF;

  -- 3) Atomically consume the token (ROW_COUNT guard defeats concurrent retries).
  UPDATE public.model_claim_tokens
  SET used_at = now()
  WHERE id      = v_claim_row.id
    AND used_at IS NULL;

  GET DIAGNOSTICS v_row_count = ROW_COUNT;
  IF v_row_count = 0 THEN
    RAISE EXCEPTION 'token_already_used';
  END IF;

  -- 4) Link the model to this auth user (no-op if already linked to caller).
  UPDATE public.models
  SET user_id    = v_caller,
      updated_at = now()
  WHERE id      = v_claim_row.model_id
    AND user_id IS NULL;

  -- 5) Flip relationship status to active for any home-agency row in pending_link.
  UPDATE public.models
  SET agency_relationship_status = 'active',
      updated_at                 = now()
  WHERE id                        = v_claim_row.model_id
    AND agency_relationship_status = 'pending_link';

  -- 6) Activate profile and pin role to 'model' so the user lands in ModelView.
  UPDATE public.profiles
  SET is_active = true,
      role      = 'model'
  WHERE id = v_caller;

  RETURN jsonb_build_object(
    'model_id',  v_claim_row.model_id,
    'agency_id', v_claim_row.agency_id
  );
END;
$$;

REVOKE ALL    ON FUNCTION public.claim_model_by_token(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_model_by_token(text) TO authenticated;

COMMENT ON FUNCTION public.claim_model_by_token IS
  'Model-user RPC. Claims a model record using a one-time token. '
  'Plaintext WHERE token = p_token lookup in all branches — token_hash drift fixed (20260504). '
  '20261205: guard against claiming a model already linked to another user. '
  '20260611: sets profiles.role = model. '
  '20260520: sets agency_relationship_status = active.';


-- ─── 3) generate_model_claim_token — plaintext-only INSERT ───────────────────
--
-- Re-declared to establish a single source of truth alongside the plaintext
-- lookup functions above. Preserves the full co-agency MAT branch from 20261207
-- and the owner_user_id removal from 20260427.
-- Stores only plaintext token — no token_hash written.

DROP FUNCTION IF EXISTS public.generate_model_claim_token(uuid, uuid);

CREATE OR REPLACE FUNCTION public.generate_model_claim_token(
  p_model_id        uuid,
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
    -- A.1: caller is a member of the home agency
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
      -- Token is pinned to the co-agency's agency_id, not the model's home agency.
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
    -- Branch B: unclaimed model (no home agency)
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

  -- Invalidate any unexpired unused token for this model before issuing a new one.
  DELETE FROM public.model_claim_tokens
  WHERE model_id = p_model_id
    AND used_at IS NULL
    AND expires_at > now();

  -- pgcrypto-free token: sha256 of a random UUID (built-in, no extension required).
  v_token := encode(sha256((gen_random_uuid()::text)::bytea), 'hex');

  INSERT INTO public.model_claim_tokens (token, model_id, agency_id)
  VALUES (v_token, p_model_id, v_caller_agency_id);

  RETURN v_token;
END;
$$;

REVOKE ALL ON FUNCTION public.generate_model_claim_token(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.generate_model_claim_token(uuid, uuid) TO authenticated;

COMMENT ON FUNCTION public.generate_model_claim_token(uuid, uuid) IS
  'Agency-only RPC. Generates a one-time plaintext claim token for a model. '
  'Home-agency members and co-agencies (via model_agency_territories) are allowed. '
  'Plaintext-only INSERT — no token_hash stored. Consistent with plaintext lookup '
  'in get_model_claim_preview and claim_model_by_token (20260504 drift fix). '
  'Co-agency MAT branch from 20261023/20261207 preserved. '
  'owner_user_id removed (20260427). pgcrypto-free (20260515).';


-- ─── Verification ─────────────────────────────────────────────────────────────

DO $$
DECLARE
  v_preview_def  text;
  v_claim_def    text;
  v_gen_def      text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_preview_def
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'get_model_claim_preview';

  SELECT pg_get_functiondef(p.oid) INTO v_claim_def
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'claim_model_by_token';

  SELECT pg_get_functiondef(p.oid) INTO v_gen_def
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'generate_model_claim_token'
    AND p.pronargs = 2;

  ASSERT v_preview_def IS NOT NULL,
    'FAIL: get_model_claim_preview missing after 20260504';
  ASSERT v_preview_def NOT ILIKE '%token_hash%',
    'FAIL: get_model_claim_preview still references token_hash';

  ASSERT v_claim_def IS NOT NULL,
    'FAIL: claim_model_by_token missing after 20260504';
  ASSERT v_claim_def NOT ILIKE '%token_hash%',
    'FAIL: claim_model_by_token still references token_hash';

  ASSERT v_gen_def IS NOT NULL,
    'FAIL: generate_model_claim_token(uuid,uuid) missing after 20260504';
  ASSERT v_gen_def NOT ILIKE '%token_hash%',
    'FAIL: generate_model_claim_token still references token_hash';
  ASSERT v_gen_def NOT ILIKE '%owner_user_id%',
    'FAIL: generate_model_claim_token still references owner_user_id';
  ASSERT v_gen_def ILIKE '%model_agency_territories%',
    'FAIL: generate_model_claim_token lost the co-agency MAT branch';

  RAISE NOTICE 'PASS: 20260504 — get_model_claim_preview, claim_model_by_token, '
               'and generate_model_claim_token all use plaintext token lookup / '
               'plaintext-only INSERT, no token_hash references remain';
END $$;

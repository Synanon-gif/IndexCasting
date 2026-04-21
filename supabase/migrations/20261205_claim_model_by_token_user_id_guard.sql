-- =============================================================================
-- 20261205_claim_model_by_token_user_id_guard.sql
--
-- Hardening: claim_model_by_token must NEVER silently succeed when the target
-- models row is already linked to a DIFFERENT auth user.
--
-- Background (audit finding, 2026-12):
--   The previous implementation (20260611) consumed the claim token, then
--   ran:
--       UPDATE models SET user_id = auth.uid() WHERE id = … AND user_id IS NULL
--   If models.user_id was already populated with some other user, the UPDATE
--   simply matched 0 rows. The token was burned, profiles.role was still set
--   to 'model', and the function returned a success-shaped JSON — the caller
--   (UI) had no way to distinguish "I just claimed the model" from "the model
--   was already claimed by someone else and I am now mis-roled to 'model'".
--
-- Fix:
--   Read the row BEFORE consuming the token. If models.user_id IS NOT NULL
--   AND ≠ auth.uid(), raise 'model_already_claimed_by_other_user' and abort
--   without touching the token, the model row, or the profile. If it equals
--   auth.uid() (re-claim by the same user, e.g. on retry/reload), treat as
--   idempotent success.
--
-- This complements the existing checks for token_expired / token_already_used
-- / token_not_found and the atomic UPDATE ROW_COUNT guard.
--
-- Idempotent: CREATE OR REPLACE FUNCTION.
-- =============================================================================

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

  -- 1) Locate a still-valid token row. Plaintext token is hashed before lookup.
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

  -- 2) NEW GUARD: read current user_id of the target model BEFORE we burn the
  --    token. If it is set to someone else, abort early with a distinct error
  --    so the UI can react (and so the caller's profile.role is not silently
  --    flipped to 'model').
  SELECT user_id
  INTO v_model_user
  FROM public.models
  WHERE id = v_claim_row.model_id
  LIMIT 1;

  IF v_model_user IS NOT NULL AND v_model_user <> v_caller THEN
    RAISE EXCEPTION 'model_already_claimed_by_other_user';
  END IF;

  -- 3) Atomically consume the token (race-condition guard: a second concurrent
  --    call will hit ROW_COUNT = 0 and bail).
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

  -- 5) Flip relationship status to active for any home-agency row still in
  --    pending_link state.
  UPDATE public.models
  SET agency_relationship_status = 'active',
      updated_at                 = now()
  WHERE id                        = v_claim_row.model_id
    AND agency_relationship_status = 'pending_link';

  -- 6) Activate profile and pin role to 'model' so the user lands in ModelView.
  --    Safe now that step 2 ensured we are claiming for ourselves (or freshly).
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
  'Model-user RPC. Claims a model record using a one-time token.'
  ' 20261205: adds early guard against silently re-claiming a model whose'
  ' models.user_id is already linked to a DIFFERENT auth user — raises'
  ' model_already_claimed_by_other_user without burning the token or'
  ' overwriting profiles.role.'
  ' 20260611: token_hash + sets profiles.role = model.'
  ' 20260520: sets agency_relationship_status = active.';


-- ─── Verification ──────────────────────────────────────────────────────────

DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname = 'claim_model_by_token'
      AND pronamespace = 'public'::regnamespace
  ), 'claim_model_by_token missing after migration';
END
$$;

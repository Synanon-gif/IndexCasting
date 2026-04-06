-- =============================================================================
-- get_model_claim_preview(p_token text)
--
-- PURPOSE:
--   Öffentlich zugängliche RPC (kein Auth erforderlich) die einen Model-Claim-
--   Token validiert und Kontext zurückgibt, der dem Model vor dem Login/Signup
--   angezeigt werden kann (Agency-Name, Model-Name).
--
--   Parallel zu get_invitation_preview() für Org-Einladungen.
--
-- SICHERHEIT:
--   - SECURITY DEFINER mit SET row_security TO off (liest model_claim_tokens, models, agencies)
--   - Interner Guard: Token muss existieren, unbenutzt (used_at IS NULL) und nicht abgelaufen sein
--   - Gibt NIE PII zurück — nur Name-Felder die dem eingeladenen Model gezeigt werden dürfen
--   - Token selbst wird nicht zurückgegeben (nur Validierungsstatus)
--
-- Idempotent: safe to run multiple times.
-- =============================================================================

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
  -- Validierung: Token muss existieren, unbenutzt und nicht abgelaufen sein
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

-- Kein REVOKE nötig: SECURITY DEFINER Funktion mit internem Guard ist für alle zugänglich
-- (auch anonym), gibt aber nur nicht-sensible Daten zurück.
COMMENT ON FUNCTION public.get_model_claim_preview(text) IS
  'Public RPC: validates a model claim token and returns agency_name + model_name '
  'for display before account creation. Does not expose PII or the token itself.';

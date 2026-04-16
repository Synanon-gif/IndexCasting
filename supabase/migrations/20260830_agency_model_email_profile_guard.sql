-- =============================================================================
-- 20260830: Agency roster — detect model email that matches a profile user_id
--           distinct from the model's linked user (no silent account binding).
-- Additive SECURITY DEFINER helper; no schema rewrite.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.agency_model_email_matches_unlinked_profile(
  p_model_id UUID,
  p_email    TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
DECLARE
  v_caller       UUID := auth.uid();
  v_model_agency UUID;
  v_model_uid    UUID;
  v_norm         TEXT;
  v_prof         UUID;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF p_model_id IS NULL OR p_email IS NULL OR length(trim(p_email)) = 0 THEN
    RETURN FALSE;
  END IF;

  SELECT m.agency_id, m.user_id
    INTO v_model_agency, v_model_uid
  FROM public.models m
  WHERE m.id = p_model_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'model_not_found';
  END IF;

  IF v_model_agency IS NULL THEN
    RAISE EXCEPTION 'access_denied';
  END IF;

  IF NOT (
    EXISTS (
      SELECT 1
      FROM public.organization_members om
      JOIN public.organizations o ON o.id = om.organization_id
      WHERE o.agency_id = v_model_agency
        AND o.type = 'agency'
        AND om.user_id = v_caller
    )
    OR EXISTS (
      SELECT 1 FROM public.bookers b
      WHERE b.agency_id = v_model_agency AND b.user_id = v_caller
    )
    OR public.is_current_user_admin()
  ) THEN
    RAISE EXCEPTION 'access_denied';
  END IF;

  v_norm := lower(trim(p_email));

  SELECT p.id
    INTO v_prof
  FROM public.profiles p
  WHERE lower(trim(coalesce(p.email, ''))) = v_norm
  LIMIT 1;

  IF v_prof IS NULL THEN
    RETURN FALSE;
  END IF;

  -- Risk: an account exists for this email but the model row is not (yet) that user.
  IF v_model_uid IS NULL OR v_model_uid IS DISTINCT FROM v_prof THEN
    RETURN TRUE;
  END IF;

  RETURN FALSE;
END;
$$;

REVOKE ALL ON FUNCTION public.agency_model_email_matches_unlinked_profile(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.agency_model_email_matches_unlinked_profile(UUID, TEXT) TO authenticated;

COMMENT ON FUNCTION public.agency_model_email_matches_unlinked_profile(UUID, TEXT) IS
  '20260830: True when p_email matches profiles.email for a user_id different from models.user_id '
  '(or model has no user_id). Agency/booker/admin only; use to avoid silent email→account mismatch on roster edits.';

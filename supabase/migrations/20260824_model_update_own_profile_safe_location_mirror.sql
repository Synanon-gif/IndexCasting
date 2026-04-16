-- =============================================================================
-- model_update_own_profile_safe — allow legacy models.* location mirror for
-- agency-linked models (live/current canonical data remains in model_locations).
--
-- Root cause: blanket `forbidden: agency_controls_profile` blocked ALL calls when
-- agency_id IS NOT NULL, even though this RPC only updates city, country,
-- current_location (no measurements, visibility, media, email, etc.).
-- K-1 column REVOKE + RLS model_update_own_profile (agency_id IS NULL) unchanged.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.model_update_own_profile_safe(
  p_city             text DEFAULT NULL,
  p_country          text DEFAULT NULL,
  p_current_location text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  -- Location mirror only (canonical priority: model_locations live > current > agency).
  -- Agency-controlled profile fields are not writable via this RPC.
  UPDATE public.models SET
    city             = COALESCE(p_city,             city),
    country          = COALESCE(p_country,          country),
    current_location = COALESCE(p_current_location, current_location)
  WHERE user_id = auth.uid();
END;
$$;

REVOKE ALL ON FUNCTION public.model_update_own_profile_safe(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.model_update_own_profile_safe(text, text, text) TO authenticated;

COMMENT ON FUNCTION public.model_update_own_profile_safe(text, text, text) IS
  'Model self-service: updates only models.city, country, current_location for auth.uid() row. '
  'Agency-linked models may sync legacy mirror fields; canonical location is model_locations. '
  'Does not expose agency-only profile columns.';

DO $$
DECLARE
  v_src text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_src
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'model_update_own_profile_safe'
  LIMIT 1;

  IF v_src IS NULL THEN
    RAISE EXCEPTION 'model_update_own_profile_safe missing after migration';
  END IF;

  IF position('forbidden: agency_controls_profile' in lower(v_src)) > 0 THEN
    RAISE EXCEPTION 'model_update_own_profile_safe still contains agency_controls_profile guard';
  END IF;
END $$;

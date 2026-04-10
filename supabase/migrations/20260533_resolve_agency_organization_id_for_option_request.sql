-- =============================================================================
-- resolve_agency_organization_id_for_option_request (20260533)
--
-- Clients cannot read foreign agency rows on public.organizations (RLS), so
-- agency_organization_id for option_requests cannot be resolved client-side.
-- This SECURITY DEFINER helper returns organizations.id (type=agency) for a
-- given agencies.id when the caller is allowed to target that model+agency
-- (territory alignment via model_agency_territories, or models.agency_id fallback
-- when no country code is provided).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.resolve_agency_organization_id_for_option_request(
  p_model_id uuid,
  p_agency_id uuid,
  p_country_code text
)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
DECLARE
  v_org_id uuid;
  v_cc text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF public.is_current_user_admin() THEN
    SELECT o.id INTO v_org_id
    FROM public.organizations o
    WHERE o.agency_id = p_agency_id
      AND o.type = 'agency'
    ORDER BY o.id ASC
    LIMIT 1;
    RETURN v_org_id;
  END IF;

  IF NOT (public.has_platform_access() AND public.caller_is_client_org_member()) THEN
    RAISE EXCEPTION 'access_denied';
  END IF;

  v_cc := upper(trim(COALESCE(p_country_code, '')));

  IF v_cc <> '' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.model_agency_territories mat
      WHERE mat.model_id = p_model_id
        AND mat.agency_id = p_agency_id
        AND upper(trim(mat.country_code)) = v_cc
    ) THEN
      RAISE EXCEPTION 'access_denied';
    END IF;
  ELSE
    IF NOT EXISTS (
      SELECT 1
      FROM public.models m
      WHERE m.id = p_model_id
        AND m.agency_id = p_agency_id
    ) THEN
      RAISE EXCEPTION 'access_denied';
    END IF;
  END IF;

  SELECT o.id INTO v_org_id
  FROM public.organizations o
  WHERE o.agency_id = p_agency_id
    AND o.type = 'agency'
  ORDER BY o.id ASC
  LIMIT 1;

  RETURN v_org_id;
END;
$$;

ALTER FUNCTION public.resolve_agency_organization_id_for_option_request(uuid, uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.resolve_agency_organization_id_for_option_request(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_agency_organization_id_for_option_request(uuid, uuid, text) TO authenticated;

COMMENT ON FUNCTION public.resolve_agency_organization_id_for_option_request(uuid, uuid, text) IS
  'Returns agency organizations.id for option_requests.agency_organization_id. '
  'Guards: admin; or has_platform_access + caller_is_client_org_member + MAT territory or models.agency_id match. '
  '20260533: connectionless client option flow.';

DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'resolve_agency_organization_id_for_option_request'
  ), 'FAIL: resolve_agency_organization_id_for_option_request missing after migration';
END;
$$;

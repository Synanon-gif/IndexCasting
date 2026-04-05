-- =============================================================================
-- Fix 1: get_territories_for_agency_roster auf model_assignments umstellen
--
-- Liest jetzt aus model_assignments (org-zentrisch) statt model_agency_territories.
-- Rückgabespalten r_model_id / r_country_code bleiben identisch → kein Frontend-Breaking-Change.
-- Parameter p_agency_id bleibt (agencies.id); intern JOIN via organizations.agency_id.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_territories_for_agency_roster(
  p_agency_id uuid
)
RETURNS TABLE (
  r_model_id    uuid,
  r_country_code text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
  SELECT
    ma.model_id   AS r_model_id,
    ma.territory  AS r_country_code
  FROM public.model_assignments ma
  JOIN public.organizations o ON o.id = ma.organization_id
  WHERE o.agency_id = p_agency_id
    AND o.type = 'agency'
  ORDER BY ma.territory;
$$;

REVOKE ALL ON FUNCTION public.get_territories_for_agency_roster(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_territories_for_agency_roster(uuid) TO authenticated;

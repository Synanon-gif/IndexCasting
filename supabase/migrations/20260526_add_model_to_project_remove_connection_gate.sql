-- =============================================================================
-- add_model_to_project — remove client_agency_connections prerequisite (2026-05-26)
--
-- Product: Discover visibility is the gate for add-to-project (same as option
-- request / B2B chat). No pre-existing accepted connection required.
-- Defense-in-depth: RPC still requires project org match + resolved model agency
-- (territory-aligned when p_country_iso is set).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.add_model_to_project(
  p_project_id UUID,
  p_model_id UUID,
  p_organization_id UUID DEFAULT NULL,
  p_country_iso TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
DECLARE
  v_caller_org_id       UUID;
  v_project_org_id      UUID;
  v_home_agency_id      UUID;
  v_territory_agency_id UUID;
  v_effective_agency_id UUID;
  v_is_member           BOOLEAN := false;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'add_model_to_project: not_authenticated';
  END IF;

  IF p_organization_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.organization_members om
      JOIN public.organizations org ON org.id = om.organization_id
                                   AND org.type = 'client'
      WHERE om.user_id = auth.uid()
        AND om.organization_id = p_organization_id
    ) INTO v_is_member;

    IF NOT v_is_member THEN
      RAISE EXCEPTION 'add_model_to_project: caller is not a member of the specified client organization';
    END IF;

    v_caller_org_id := p_organization_id;
  ELSE
    SELECT om.organization_id INTO v_caller_org_id
    FROM public.organization_members om
    JOIN public.organizations org ON org.id = om.organization_id
                                 AND org.type = 'client'
    WHERE om.user_id = auth.uid()
    ORDER BY om.created_at ASC
    LIMIT 1;
  END IF;

  IF v_caller_org_id IS NULL THEN
    RAISE EXCEPTION 'add_model_to_project: caller has no client organization';
  END IF;

  SELECT organization_id INTO v_project_org_id
  FROM public.client_projects
  WHERE id = p_project_id;

  IF v_project_org_id IS DISTINCT FROM v_caller_org_id THEN
    RAISE EXCEPTION 'add_model_to_project: project does not belong to caller organization';
  END IF;

  SELECT agency_id INTO v_home_agency_id
  FROM public.models
  WHERE id = p_model_id;

  IF p_country_iso IS NOT NULL AND trim(p_country_iso) <> '' THEN
    SELECT mat.agency_id INTO v_territory_agency_id
    FROM public.model_agency_territories mat
    WHERE mat.model_id = p_model_id
      AND mat.country_code = upper(trim(p_country_iso))
    LIMIT 1;
  END IF;

  v_effective_agency_id := COALESCE(v_territory_agency_id, v_home_agency_id);

  IF v_effective_agency_id IS NULL THEN
    RAISE EXCEPTION 'add_model_to_project: model has no agency or does not exist';
  END IF;

  INSERT INTO public.client_project_models (project_id, model_id)
  VALUES (p_project_id, p_model_id)
  ON CONFLICT DO NOTHING;

  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.add_model_to_project(UUID, UUID, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.add_model_to_project(UUID, UUID, UUID, TEXT) TO authenticated;

COMMENT ON FUNCTION public.add_model_to_project(UUID, UUID, UUID, TEXT) IS
  'Adds a model to a client project. Pass p_organization_id when known; p_country_iso aligns agency resolution with discovery (model_agency_territories). No client_agency_connections row required.';

-- RLS: align direct INSERT path with RPC (org membership + model row exists).
DROP POLICY IF EXISTS "client_project_models_agency_scoped" ON public.client_project_models;

CREATE POLICY "client_project_models_agency_scoped"
  ON public.client_project_models
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.client_projects cp
      JOIN public.organization_members om ON om.organization_id = cp.organization_id
      WHERE cp.id = client_project_models.project_id
        AND om.user_id = auth.uid()
    )
    AND EXISTS (
      SELECT 1
      FROM public.models m
      WHERE m.id = client_project_models.model_id
    )
  );
